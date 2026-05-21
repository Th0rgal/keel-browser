#!/usr/bin/env bash
# Clone the upstream Brave source tree pinned to the version recorded in
# build/upstream.json. This is the heavy path — used only for the "source
# build" workflow (custom patches). Most Keel installs use install-policy.sh
# instead.

. "$(dirname "$0")/_lib.sh"
need git
need jq

UP="$KEEL_ROOT/build/upstream.json"
[[ -f "$UP" ]] || die "run scripts/sync-upstream.sh first"

TAG=$(jq -r '.brave_tag' "$UP")
TREE="$KEEL_ROOT/upstream/brave-browser"

if [[ -d "$TREE/.git" ]]; then
  log "Fetching $TAG into existing tree..."
  (cd "$TREE" && git fetch --tags --depth 1 origin "$TAG" && git checkout "$TAG")
else
  log "Cloning Brave at $TAG (shallow)..."
  git clone --depth 1 --branch "$TAG" https://github.com/brave/brave-browser.git "$TREE"
fi

ok "Upstream Brave checkout at $TREE (tag $TAG)"
warn "Brave's full build also pulls Chromium + chromium-src dependencies (~40GB)."
warn "See https://github.com/brave/brave-browser/wiki/Linux-Development-Environment"
