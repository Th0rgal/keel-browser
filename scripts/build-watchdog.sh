#!/usr/bin/env bash
# Watchdog: restart siso if it dies. Loops until brave binary exists.

set -uo pipefail

KEEL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRAVE_SRC="$KEEL_ROOT/upstream/chromium-build/src/brave"
BRAVE_BIN="$KEEL_ROOT/upstream/chromium-build/src/out/Release/brave"
LOG="/workspaces/mission-c074b317/.keel-logs/build.log"

log() { echo "[watchdog $(date -u +%T)] $*"; }

export PATH="$BRAVE_SRC/vendor/depot_tools:$PATH"
export NVM_DIR="$HOME/.config/nvm"
[[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null 2>&1
export DEPOT_TOOLS_UPDATE=0
export PYTHONPATH="$BRAVE_SRC/script:${PYTHONPATH:-}"
export PIP_BREAK_SYSTEM_PACKAGES=1
export CCACHE_DIR="/workspaces/mission-c074b317/.sccache"

# Match the actual siso binary, not any bash referencing the string.
siso_alive() {
  pgrep -af 'third_party/siso/cipd/siso' | grep -v 'watchdog' > /dev/null 2>&1
}

RESTARTS=0
MAX_RESTARTS=15

while true; do
  if [[ -x "$BRAVE_BIN" ]]; then
    log "brave binary at $BRAVE_BIN — watchdog exiting clean"
    break
  fi

  if siso_alive; then
    sleep 60
    continue
  fi

  if (( RESTARTS >= MAX_RESTARTS )); then
    log "max restarts ($MAX_RESTARTS) reached"; exit 2
  fi
  RESTARTS=$((RESTARTS + 1))
  log "siso dead. Restart attempt $RESTARTS/$MAX_RESTARTS"

  (
    cd "$BRAVE_SRC"
    yes y | npm run build -- Release \
      --gn=cc_wrapper:ccache \
      --gn=use_remoteexec:false \
      --gn=is_official_build:false \
      --gn=enable_brave_rewards:false \
      --gn=is_component_build:false \
      --gn=use_clang_modules:false \
      --offline 2>&1
  ) >> "$LOG" 2>&1 &
  disown $!
  sleep 45
done

log "Running create_dist to produce .deb..."
(cd "$BRAVE_SRC" && yes y | npm run create_dist -- Release --offline 2>&1) >> "$LOG"
DEB=$(find "$KEEL_ROOT/upstream/chromium-build/src/out/Release" -maxdepth 4 -name '*.deb' 2>/dev/null | head -1)
[[ -n "$DEB" ]] && log "deb: $DEB" || log "no .deb produced"
