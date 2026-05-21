#!/usr/bin/env bash
# Tar the sccache directory and upload the build .deb + cache snapshot to a
# GitHub release. Requires GH_TOKEN with `repo` scope.
#
# Usage:
#   scripts/upload-release.sh                       upload to v0.1.0-prerelease
#   scripts/upload-release.sh v0.1.1-keel.1         upload to specific tag

. "$(dirname "$0")/_lib.sh"
need gh
need zstd
need tar

TAG="${1:-v0.1.0-prerelease}"
REPO="Th0rgal/keel-browser"

BUILD_ROOT="$KEEL_ROOT/upstream/chromium-build"
SCCACHE_DIR="${SCCACHE_DIR:-$KEEL_ROOT/../.sccache}"

# Find the .deb
DEB=$(find "$BUILD_ROOT/src/out" -name 'brave-browser*.deb' -o -name 'keel*.deb' 2>/dev/null | head -1)
[[ -n "$DEB" ]] || warn "No .deb found yet — uploading cache only"

WORK=$(mktemp -d)
trap "rm -rf $WORK" EXIT

if [[ -n "$DEB" ]]; then
  cp "$DEB" "$WORK/keel-$(jq -r .keel_version "$KEEL_ROOT/build/keel.json")-linux-amd64.deb"
fi

log "Compressing sccache directory ($(du -sh "$SCCACHE_DIR" | cut -f1))..."
tar -C "$SCCACHE_DIR" -cf - . | zstd -19 -T0 -o "$WORK/sccache-cache.tar.zst"
ok "Cache compressed to $(du -sh "$WORK/sccache-cache.tar.zst" | cut -f1)"

log "Uploading to $REPO release $TAG..."
gh release upload "$TAG" --repo "$REPO" --clobber "$WORK"/*

ok "Uploaded."
gh release view "$TAG" --repo "$REPO" --web
