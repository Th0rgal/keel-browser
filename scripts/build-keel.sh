#!/usr/bin/env bash
# Build Keel from source. Wraps the brave-core build flow with sccache and
# Keel patch application. Idempotent — second run reuses the source tree
# and the sccache cache.
#
# Usage:
#   scripts/build-keel.sh                  dev build (component, fastest iteration)
#   scripts/build-keel.sh --release        release build (non-official, produces .deb)
#   scripts/build-keel.sh --restore-cache  download sccache snapshot before building

. "$(dirname "$0")/_lib.sh"
need git
need curl

MODE="dev"
RESTORE=0
while (( $# > 0 )); do
  case "$1" in
    --release)       MODE="release"; shift ;;
    --restore-cache) RESTORE=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

BUILD_ROOT="$KEEL_ROOT/upstream/chromium-build"
BRAVE_SRC="$BUILD_ROOT/src/brave"
OUT_DIR="out/Component"
[[ "$MODE" == "release" ]] && OUT_DIR="out/Release"

export SCCACHE_DIR="${SCCACHE_DIR:-$KEEL_ROOT/../.sccache}"
export SCCACHE_CACHE_SIZE="${SCCACHE_CACHE_SIZE:-40G}"
sccache --start-server 2>/dev/null || true

# ---- ALL THE WORKAROUNDS REQUIRED FOR A FRESH BUILD ----------------------
# Discovered while bootstrapping the v0.1.0-prerelease build. Without these,
# the various depot_tools / Brave / Python interactions fail mid-pipeline.
export DEPOT_TOOLS_UPDATE=0
export PIP_BREAK_SYSTEM_PACKAGES=1       # Ubuntu 24.04 PEP 668 lockdown
export GCLIENT_SUPPRESS_GIT_VERSION_WARNING=1

if [[ "$RESTORE" == "1" ]]; then
  log "Restoring sccache snapshot from latest release..."
  TMPF="$(mktemp -d)/sccache.tar.zst"
  curl -fsSL -o "$TMPF" \
    "https://github.com/Th0rgal/keel-browser/releases/latest/download/sccache-cache.tar.zst"
  mkdir -p "$SCCACHE_DIR"
  zstd -d "$TMPF" -c | tar -xC "$SCCACHE_DIR"
  ok "Cache restored to $SCCACHE_DIR"
fi

if [[ ! -d "$BRAVE_SRC/.git" ]]; then
  TAG=$(jq -r .brave_tag "$KEEL_ROOT/build/upstream.json")
  log "Cloning brave-core at $TAG ..."
  mkdir -p "$BUILD_ROOT/src"
  git clone --depth 1 -b "$TAG" https://github.com/brave/brave-core.git "$BRAVE_SRC"
fi

(cd "$BRAVE_SRC" && npm install --no-audit --no-fund)

# Upgrade pip ahead of Brave's hooks (Brave runs `pip install -U pip` which
# fails on Ubuntu's debian-managed pip with the cryptic "RECORD file not found"
# unless we replace it first).
python3 -m pip install --upgrade --ignore-installed --quiet pip || true

if [[ ! -d "$BUILD_ROOT/src/v8" ]]; then
  log "Running npm run init (gclient sync, large download, ~30-60 min)..."
  PYTHONPATH="$BRAVE_SRC/script:${PYTHONPATH:-}" \
    yes y | (cd "$BRAVE_SRC" && npm run init) || warn "npm run init exited non-zero — retrying hooks separately"
fi

# Bootstrap depot_tools' python_bin_reldir + symlink to system python.
DT="$BRAVE_SRC/vendor/depot_tools"
if [[ ! -f "$DT/python3_bin_reldir.txt" ]]; then
  log "Bootstrapping depot_tools python..."
  python3 "$DT/bootstrap/bootstrap.py" --bootstrap-name python3 || true
fi
if [[ ! -e "$DT/python3/python3/bin/python3" ]]; then
  mkdir -p "$DT/python3/python3/bin"
  ln -sf /usr/bin/python3 "$DT/python3/python3/bin/python3"
fi

# Re-run any hooks that failed earlier.
export PATH="$DT:$PATH"
export PYTHONPATH="$BRAVE_SRC/script:${PYTHONPATH:-}"
log "Running gclient hooks (idempotent if already done)..."
yes y | (cd "$BUILD_ROOT" && gclient runhooks) 2>&1 | tail -3 || true

log "Applying Keel patch stack (tolerant)..."
bash "$KEEL_ROOT/scripts/apply-patches-tolerant.sh" --tree "$BRAVE_SRC"
log "Patch status:"
cat "$KEEL_ROOT/build/patch_status.txt" | sed 's/^/  /'

# Brave's per-build gn args + native autoninja.
# is_official_build=false skips the BAT/Rewards client-id assertions that
# Brave hard-enforces on official builds.
log "Running gn gen $OUT_DIR..."
GN_ARGS=(
  --gn=cc_wrapper:sccache
  --gn=use_remoteexec:false
  --gn=is_official_build:false
  --gn=enable_brave_rewards:false
  "--gn=is_component_build:$([[ "$MODE" == release ]] && echo false || echo true)"
)

(cd "$BRAVE_SRC" && yes y | npm run build -- "${OUT_DIR##*/}" "${GN_ARGS[@]}" --offline)

sccache --show-stats | head -10
ok "Build complete: $BUILD_ROOT/src/$OUT_DIR/brave"

if [[ "$MODE" == "release" ]]; then
  log "Packaging .deb..."
  (cd "$BUILD_ROOT/src" && autoninja -C "$OUT_DIR" brave/installer/linux:brave_deb || \
                            autoninja -C "$OUT_DIR" chrome/installer/linux:beta_deb || true)
  find "$BUILD_ROOT/src/$OUT_DIR" -name '*.deb' -exec ls -la {} \;
fi
