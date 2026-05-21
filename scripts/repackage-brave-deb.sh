#!/usr/bin/env bash
# Take an upstream brave-browser .deb and produce a Keel-branded variant that
# bundles the Keel policy pack + master_preferences + newtab bundle so that
# installing the .deb gives a working Keel out of the box.
#
# This is NOT the source-built Keel. The binary is unmodified Brave. But the
# policies + new tab page are baked into the package so apt installs them
# alongside the binary. Useful as the v0.1.0-prerelease 'final version'
# artifact while the full source build is running.

. "$(dirname "$0")/_lib.sh"
need dpkg-deb

SRC_DEB="${1:-}"
[[ -n "$SRC_DEB" && -f "$SRC_DEB" ]] || die "usage: $0 path/to/brave-browser_<version>_amd64.deb"

VER=$(jq -r .keel_version "$KEEL_ROOT/build/keel.json")
OUT="$KEEL_ROOT/build/keel_${VER}_amd64.deb"

WORK=$(mktemp -d)
trap "rm -rf $WORK" EXIT

log "Unpacking $SRC_DEB ..."
dpkg-deb -R "$SRC_DEB" "$WORK/keel"

# Bundle policy + master_preferences + newtab into the package layout that
# Brave already reads.
install -d -m 0755 "$WORK/keel/etc/brave/policies/managed"
install -d -m 0755 "$WORK/keel/etc/brave/policies/recommended"
install -d -m 0755 "$WORK/keel/etc/keel/newtab"

install -m 0644 "$KEEL_ROOT/policies/linux/keel-managed-policy.json" \
                "$WORK/keel/etc/brave/policies/managed/keel-managed-policy.json"
install -m 0644 "$KEEL_ROOT/policies/master_preferences.json" \
                "$WORK/keel/etc/brave/master_preferences"
install -m 0644 "$KEEL_ROOT/newtab/index.html" \
                "$KEEL_ROOT/newtab/style.css" \
                "$KEEL_ROOT/newtab/script.js" \
                "$WORK/keel/etc/keel/newtab/"

# Rewrite control fields. We keep the package name as 'brave-browser' so apt
# update on a real Brave repo keeps working — Keel is a thin overlay, not a
# fork of Brave's package channel. The Version field carries our suffix.
sed -i "s/^Version: 1.90.124$/Version: 1.90.124+keel.1/"      "$WORK/keel/DEBIAN/control"
sed -i "s/^Maintainer:.*/Maintainer: Keel <ci@keel.invalid>/" "$WORK/keel/DEBIAN/control"
sed -i "s|^Homepage:.*|Homepage: https://github.com/Th0rgal/keel-browser|" "$WORK/keel/DEBIAN/control"

# Bump installed-size by the bytes we added.
ADDED=$(du -ks "$WORK/keel/etc/keel" "$WORK/keel/etc/brave/policies" "$WORK/keel/etc/brave/master_preferences" 2>/dev/null | awk '{s+=$1} END{print s}')
CUR=$(awk '/^Installed-Size:/ {print $2}' "$WORK/keel/DEBIAN/control")
sed -i "s/^Installed-Size: .*$/Installed-Size: $((CUR + ADDED))/" "$WORK/keel/DEBIAN/control"

# Add a tiny post-install note as a conffile so the user sees what we did.
cat > "$WORK/keel/etc/keel/README.txt" <<EOF
Keel ${VER} (Brave 1.90.124 + Keel policy pack)

This package installs upstream Brave's binary and, alongside it, the Keel
policies in /etc/brave/policies/managed/ that disable Brave Rewards,
Wallet, VPN, Leo AI, Talk, telemetry, and other product surfaces — and
the Keel new tab bundle in /etc/keel/newtab/.

The source-built Keel binary (with the Safari-styled chrome) will ship as
a separate .deb in a later release. See:
  https://github.com/Th0rgal/keel-browser/releases
EOF

log "Building $OUT ..."
dpkg-deb --build "$WORK/keel" "$OUT"

ok "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
