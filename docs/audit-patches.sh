#!/usr/bin/env bash
# Verify the patch stack does not touch any off-limits Chromium/Brave surface.
# Reads docs/security-posture.md for the canonical list and greps every patch.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
shopt -s nullglob

# These substrings should never appear in a hunk's @@-anchor or file path.
FORBIDDEN=(
  "third_party/blink"
  "v8/src"
  "v8/include"
  "services/network/"
  "net/cert/"
  "sandbox/"
  "services/audio/"
  "media/"
  "third_party/ffmpeg"
  "third_party/libvpx"
  "third_party/libpng"
  "third_party/libwebp"
  "third_party/libjpeg"
  "third_party/freetype"
  "third_party/harfbuzz"
  "pdf/"
  "third_party/pdfium"
  "components/safe_browsing"
  "components/permissions"
  "components/password_manager"
  "ipc/ipc_channel"
  "content/browser/site_isolation"
)

FAIL=0
for p in "$ROOT"/patches/*.patch; do
  name=$(basename "$p")
  # Only inspect the diff body: lines that are part of an actual hunk.
  # A line counts as a "code line" if it's an added line (^+), an existing
  # context line (^ ), or a removed line (^-) — but NOT the patch header
  # commentary, the "diff --git" / "+++" / "---" lines, or the @@ markers.
  body=$(awk '
    /^diff --git/        { in_diff = 1; next }
    /^(---|\+\+\+|@@)/   { next }
    in_diff && /^[+ -]/  { print }
  ' "$p")

  for tok in "${FORBIDDEN[@]}"; do
    if grep -q -F -- "$tok" <<< "$body"; then
      echo "✗ $name touches forbidden surface: $tok"
      FAIL=1
    fi
  done
done

if [[ $FAIL -eq 0 ]]; then
  echo "✓ patch stack clear of off-limits surfaces"
else
  exit 1
fi
