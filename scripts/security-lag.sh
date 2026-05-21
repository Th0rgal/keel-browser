#!/usr/bin/env bash
# Compute and report Keel's security lag against upstream Brave.
# Reads build/upstream.json (produced by sync-upstream.sh) and build/keel.json
# (the current Keel build's pinned Brave version), then prints a status block
# in the exact shape the spec mandates:
#
#   Upstream Brave:    1.xx.xxx
#   Upstream Chromium: 148.x.x.x
#   Keel:              1.xx.xxx-keel.1
#   Security lag:      0h
#   Patch status:      clean
#   Build status:      passing
#
# Exit codes:
#   0  lag ≤ 72h (acceptable)
#   2  72h < lag ≤ 5d (warn)
#   3  lag > 5d (fail — spec says recommend official Brave until catch-up)

. "$(dirname "$0")/_lib.sh"
need jq

UP="$KEEL_ROOT/build/upstream.json"
KEEL="$KEEL_ROOT/build/keel.json"

[[ -f "$UP" ]]   || die "missing $UP — run scripts/sync-upstream.sh first"
[[ -f "$KEEL" ]] || die "missing $KEEL — run a build or write a stub at $KEEL"

BRAVE_VERSION=$(jq -r '.brave_version' "$UP")
BRAVE_DATE=$(jq -r '.brave_release_date' "$UP")
CHROMIUM_VERSION=$(jq -r '.chromium_version' "$UP")
KEEL_VERSION=$(jq -r '.keel_version' "$KEEL")
KEEL_BRAVE=$(jq -r '.brave_version' "$KEEL")
PATCH_STATUS=$(jq -r '.patch_status // "unknown"' "$KEEL")
BUILD_STATUS=$(jq -r '.build_status // "unknown"' "$KEEL")

# Compute lag in hours from upstream Brave release date.
NOW_EPOCH=$(date -u +%s)
if BD_EPOCH=$(date -u -d "$BRAVE_DATE" +%s 2>/dev/null); then :
elif BD_EPOCH=$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$BRAVE_DATE" +%s 2>/dev/null); then :
else BD_EPOCH=$NOW_EPOCH
fi

if [[ "$KEEL_BRAVE" == "$BRAVE_VERSION" ]]; then
  LAG_HOURS=0
else
  LAG_HOURS=$(( (NOW_EPOCH - BD_EPOCH) / 3600 ))
fi

# Pretty-print
printf '\n'
printf '%-19s%s\n' "Upstream Brave:"    "$BRAVE_VERSION"
printf '%-19s%s\n' "Upstream Chromium:" "$CHROMIUM_VERSION"
printf '%-19s%s\n' "Keel:"              "$KEEL_VERSION"
printf '%-19s%dh\n' "Security lag:"     "$LAG_HOURS"
printf '%-19s%s\n' "Patch status:"      "$PATCH_STATUS"
printf '%-19s%s\n' "Build status:"      "$BUILD_STATUS"
printf '\n'

# Decide exit code
if   (( LAG_HOURS <= 72 ));  then ok    "Lag within SLA (≤72h)";        exit 0
elif (( LAG_HOURS <= 120 )); then warn  "Lag above SLA. Catch up soon."; exit 2
else                              err   "Lag exceeds 5d — recommend using official Brave until Keel catches up."
                                  exit 3
fi
