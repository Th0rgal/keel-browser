#!/usr/bin/env bash
# Rasterize branding/icons/keel.svg to the sizes Chromium expects.
. "$(dirname "$0")/_lib.sh"

SRC="$KEEL_ROOT/branding/icons/keel.svg"
OUT="$KEEL_ROOT/branding/icons/png"
mkdir -p "$OUT"

if   command -v rsvg-convert >/dev/null 2>&1; then BACKEND=rsvg
elif command -v inkscape     >/dev/null 2>&1; then BACKEND=inkscape
else die "need rsvg-convert (librsvg2-bin) or inkscape"
fi

for sz in 16 24 32 48 64 96 128 256 512; do
  case "$BACKEND" in
    rsvg)     rsvg-convert -w "$sz" -h "$sz" "$SRC" -o "$OUT/keel-${sz}.png" ;;
    inkscape) inkscape "$SRC" -w "$sz" -h "$sz" -o "$OUT/keel-${sz}.png" ;;
  esac
  ok "rendered ${sz}x${sz}"
done
