#!/usr/bin/env bash
# Build Keel from source. Wraps the brave-core build flow with sccache and
# Keel patch application. Idempotent — second run reuses the source tree
# and the sccache cache.
#
# Usage:
#   scripts/build-keel.sh                  dev build (component, fastest iteration)
#   scripts/build-keel.sh --release        release build (official, slow, produces .deb)
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

# Brave-core lives at upstream/chromium-build/src/brave by Brave's convention.
BUILD_ROOT="$KEEL_ROOT/upstream/chromium-build"
BRAVE_SRC="$BUILD_ROOT/src/brave"
OUT_DIR="out/Component"
[[ "$MODE" == "release" ]] && OUT_DIR="out/Release"

export SCCACHE_DIR="${SCCACHE_DIR:-$KEEL_ROOT/../.sccache}"
export SCCACHE_CACHE_SIZE="${SCCACHE_CACHE_SIZE:-40G}"
sccache --start-server 2>/dev/null || true

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

if [[ ! -d "$BUILD_ROOT/src/v8" ]]; then
  log "Running npm run init (gclient sync, large download, ~30-60 min)..."
  (cd "$BRAVE_SRC" && npm run init)
fi

log "Applying Keel patch stack (tolerant — patches that don't apply are skipped)..."
bash "$KEEL_ROOT/scripts/apply-patches-tolerant.sh" --tree "$BRAVE_SRC"
log "Patch status:"
cat "$KEEL_ROOT/build/patch_status.txt" | sed 's/^/  /'

ARGS_DEST="$BUILD_ROOT/src/$OUT_DIR/args.gn"
mkdir -p "$BUILD_ROOT/src/$OUT_DIR"
cp "$KEEL_ROOT/scripts/build-args.gn" "$ARGS_DEST"
if [[ "$MODE" == "release" ]]; then
  sed -i \
    -e 's|//brave/build/args/dev.gni|//brave/build/args/release.gni|' \
    -e 's|is_component_build = true|is_component_build = false|' \
    "$ARGS_DEST"
fi

(cd "$BUILD_ROOT/src" && gn gen "$OUT_DIR")
(cd "$BUILD_ROOT/src" && autoninja -C "$OUT_DIR" brave)

sccache --show-stats | head -10
ok "Build complete: $BUILD_ROOT/src/$OUT_DIR/brave"

if [[ "$MODE" == "release" ]]; then
  log "Packaging .deb..."
  (cd "$BUILD_ROOT/src" && ninja -C "$OUT_DIR" brave/installer/linux/brave_deb)
  find "$BUILD_ROOT/src/$OUT_DIR" -name '*.deb' -exec ls -la {} +
fi
