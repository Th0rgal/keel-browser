#!/usr/bin/env bash
# Fetch the latest upstream Brave Stable release info and write it to
# build/upstream.json. Pure metadata sync — does not modify the source tree.
#
# Output: build/upstream.json with:
#   brave_version, brave_tag, brave_release_date,
#   chromium_version, chromium_release_channel
#
# Used by:
#   scripts/security-lag.sh
#   ci/workflows/upstream-watch.yml

. "$(dirname "$0")/_lib.sh"
need curl
need jq

mkdir -p "$KEEL_ROOT/build"
OUT="$KEEL_ROOT/build/upstream.json"

log "Fetching latest Brave Stable release..."
BRAVE_REL_JSON=$(curl -sSfL https://api.github.com/repos/brave/brave-browser/releases/latest)

BRAVE_TAG=$(echo "$BRAVE_REL_JSON" | jq -r '.tag_name')
BRAVE_DATE=$(echo "$BRAVE_REL_JSON" | jq -r '.published_at')
BRAVE_VERSION=${BRAVE_TAG#v}

log "Brave Stable: $BRAVE_VERSION (released $BRAVE_DATE)"

# Try to pull the Chromium version off the release body, then fall back to
# the package.json on the tagged commit.
CHROMIUM_VERSION=$(echo "$BRAVE_REL_JSON" | jq -r '.body' \
  | grep -oE 'Chromium[[:space:]]+[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' \
  | head -n1 \
  | awk '{print $2}' || true)

if [[ -z "$CHROMIUM_VERSION" ]]; then
  log "Falling back to package.json on tag $BRAVE_TAG"
  PKG=$(curl -sSfL "https://raw.githubusercontent.com/brave/brave-browser/$BRAVE_TAG/package.json" || true)
  if [[ -n "$PKG" ]]; then
    CHROMIUM_VERSION=$(echo "$PKG" | jq -r '.config.projects.chrome.tag // empty')
  fi
fi

CHROMIUM_VERSION=${CHROMIUM_VERSION:-unknown}

jq -n \
  --arg bv  "$BRAVE_VERSION" \
  --arg bt  "$BRAVE_TAG" \
  --arg bd  "$BRAVE_DATE" \
  --arg cv  "$CHROMIUM_VERSION" \
  '{
    brave_version:   $bv,
    brave_tag:       $bt,
    brave_release_date: $bd,
    chromium_version: $cv,
    fetched_at: (now | todate)
  }' > "$OUT"

ok "Wrote $OUT"
jq '.' "$OUT"
