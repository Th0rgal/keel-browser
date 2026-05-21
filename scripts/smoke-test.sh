#!/usr/bin/env bash
# Headless smoke test for a Keel install. Launches Brave under Xvfb (Linux) or
# in --headless=new mode, drives it through the spec's checklist via the
# DevTools protocol, and writes evidence into build/smoke/.
#
# Verifies:
#   - browser launches
#   - chrome://policy reports our policies applied
#   - chrome://newtab loads with no Rewards/Wallet/News surfaces
#   - HTTPS sites work
#   - light/dark theme renders
#   - PDF inline viewer works
#
# This script is a runner — the actual assertions live in tests/smoke/*.js
# (puppeteer). Install puppeteer with:  npm i --prefix tests puppeteer

. "$(dirname "$0")/_lib.sh"
need node

OUT="$KEEL_ROOT/build/smoke"
mkdir -p "$OUT"

PLATFORM=$(keel_platform)
BRAVE_BIN=""
case "$PLATFORM" in
  linux)
    for c in brave-browser brave brave-browser-stable; do
      command -v "$c" >/dev/null 2>&1 && BRAVE_BIN="$c" && break
    done
    ;;
  macos)
    BRAVE_BIN="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
    [[ -x "$BRAVE_BIN" ]] || BRAVE_BIN=""
    ;;
esac
[[ -n "$BRAVE_BIN" ]] || die "Brave not installed. Install Brave Stable first."

export KEEL_BRAVE_BIN="$BRAVE_BIN"
export KEEL_OUT="$OUT"

(
  cd "$KEEL_ROOT/tests"
  node smoke/run.js
) | tee "$OUT/smoke.log"

ok "Smoke output: $OUT"
