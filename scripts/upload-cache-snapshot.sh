#!/usr/bin/env bash
# Quick wrapper: tar + zstd the ccache directory, upload to the release.
# Called from this terminal periodically while the long build is running.

. "$(dirname "$0")/_lib.sh"
need gh
need zstd
need tar

TAG="${1:-v0.1.0-prerelease}"
REPO="Th0rgal/keel-browser"

CCACHE_DIR_PATH="${CCACHE_DIR:-/workspaces/mission-c074b317/.sccache}"
WORK="/workspaces/mission-c074b317/.keel-logs/cache-tmp"
mkdir -p "$WORK"

# Compress at -3 (fast) for iteration; final upload uses -19.
LEVEL="${ZSTD_LEVEL:-3}"

CCACHE_BYTES=$(du -sb "$CCACHE_DIR_PATH" 2>/dev/null | awk '{print $1}')
CCACHE_GB=$(awk "BEGIN { printf \"%.2f\", $CCACHE_BYTES / 1073741824 }")
log "ccache size: ${CCACHE_GB} GiB ($CCACHE_BYTES bytes)"

rm -f "$WORK/ccache-cache.tar.zst"
tar -C "$CCACHE_DIR_PATH" --warning=no-file-changed --ignore-failed-read \
    -cf - . \
  | zstd -${LEVEL} -T0 -o "$WORK/ccache-cache.tar.zst" 2>&1 | tail -2

ARCHIVE_GB=$(du -sb "$WORK/ccache-cache.tar.zst" 2>/dev/null | awk '{ printf "%.2f", $1 / 1073741824 }')
log "archive: ${ARCHIVE_GB} GiB"

if gh release upload "$TAG" --repo "$REPO" --clobber "$WORK/ccache-cache.tar.zst" 2>&1 | tail -3 ; then
  ok "uploaded ccache-cache.tar.zst (${ARCHIVE_GB} GiB compressed from ${CCACHE_GB} GiB)"
else
  err "upload failed"
  exit 1
fi
