#!/usr/bin/env bash
# After autoninja produces the brave binary, this packages it as a .deb
# using Brave's create_dist target.
#
# Run this AFTER the main compile finishes (brave binary exists in
# out/Release/), but BEFORE scripts/upload-release.sh.

. "$(dirname "$0")/_lib.sh"
need git

BUILD_ROOT="$KEEL_ROOT/upstream/chromium-build"
BRAVE_SRC="$BUILD_ROOT/src/brave"
OUT_DIR="out/Release"
[[ -x "$BUILD_ROOT/src/$OUT_DIR/brave" ]] || die "no brave binary at $BUILD_ROOT/src/$OUT_DIR/brave — run scripts/build-keel.sh --release first"

export NVM_DIR="$HOME/.config/nvm"
[[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"
nvm use 24 >/dev/null 2>&1 || true

export DEPOT_TOOLS_UPDATE=0
export PIP_BREAK_SYSTEM_PACKAGES=1
export PYTHONPATH="$BRAVE_SRC/script:${PYTHONPATH:-}"
export PATH="$BRAVE_SRC/vendor/depot_tools:$PATH"
export CCACHE_DIR="${CCACHE_DIR:-/workspaces/mission-c074b317/.sccache}"

log "Running npm run create_dist Release in $BRAVE_SRC..."
(cd "$BRAVE_SRC" && yes y | npm run create_dist -- Release --offline 2>&1) | tail -20

# Find the produced .deb
DEB=$(find "$BUILD_ROOT/src/$OUT_DIR" -maxdepth 4 -name '*.deb' 2>/dev/null | head -1)
if [[ -n "$DEB" ]]; then
  ok "Produced: $DEB ($(du -h "$DEB" | cut -f1))"
else
  warn "No .deb found in $BUILD_ROOT/src/$OUT_DIR after create_dist"
  # Fallback: directly invoke the installer ninja target
  log "Trying installer ninja target directly..."
  (cd "$BUILD_ROOT/src" && autoninja -C "$OUT_DIR" chrome/installer/linux:beta_deb 2>&1 | tail -5) || true
  (cd "$BUILD_ROOT/src" && autoninja -C "$OUT_DIR" brave/installer:create_dist 2>&1 | tail -5) || true
  DEB=$(find "$BUILD_ROOT/src/$OUT_DIR" -maxdepth 4 -name '*.deb' 2>/dev/null | head -1)
  if [[ -n "$DEB" ]]; then
    ok "Produced (via direct ninja): $DEB"
  else
    err "Still no .deb. The 'brave' binary exists at $BUILD_ROOT/src/$OUT_DIR/brave — manual packaging required."
    exit 1
  fi
fi
