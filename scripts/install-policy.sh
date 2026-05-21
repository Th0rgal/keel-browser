#!/usr/bin/env bash
# Install Keel's managed policy and master_preferences alongside an existing
# upstream Brave installation. This is the "no recompile" Keel — it gets you
# ~80% of the spec's debloating without touching a line of Brave source.
#
# Tested with: brave-browser (apt), Brave .dmg, Brave .msi (run from MSYS2).
#
# Run as root on Linux / sudo on macOS. On Windows, run the .reg via:
#   reg import policies/windows/keel.reg

. "$(dirname "$0")/_lib.sh"

PLATFORM=$(keel_platform)
DRY_RUN=${KEEL_DRY_RUN:-0}

run() {
  if [[ "$DRY_RUN" == "1" ]]; then echo "+ $*"; else "$@"; fi
}

case "$PLATFORM" in
  linux)
    [[ "$(id -u)" -eq 0 ]] || die "must run as root on Linux"
    log "Installing Linux managed policy..."
    run install -d -m 0755 /etc/brave/policies/managed
    run install -d -m 0755 /etc/brave/policies/recommended
    run install -m 0644 "$KEEL_ROOT/policies/linux/keel-managed-policy.json" \
      /etc/brave/policies/managed/keel-managed-policy.json
    run install -m 0644 "$KEEL_ROOT/policies/master_preferences.json" \
      /etc/brave/master_preferences
    log "Installing Keel new-tab bundle to /etc/keel/newtab/"
    run install -d -m 0755 /etc/keel/newtab
    run install -m 0644 "$KEEL_ROOT/newtab/"{index.html,style.css,script.js} /etc/keel/newtab/
    ok "Installed. Restart Brave so the policies take effect."
    ;;
  macos)
    [[ "$(id -u)" -eq 0 ]] || die "must run with sudo on macOS"
    log "Converting plist XML → binary..."
    PLIST_OUT="/Library/Managed Preferences/com.brave.Browser.plist"
    run install -d -m 0755 "/Library/Managed Preferences"
    run plutil -convert binary1 \
      -o "$PLIST_OUT" \
      "$KEEL_ROOT/policies/macos/com.brave.Browser.plist.xml"
    log "Installing Keel new-tab bundle to /Library/Application Support/Keel/newtab/"
    run install -d -m 0755 "/Library/Application Support/Keel/newtab"
    run install -m 0644 "$KEEL_ROOT/newtab/"{index.html,style.css,script.js} \
      "/Library/Application Support/Keel/newtab/"
    ok "Installed. Restart Brave so the policies take effect."
    ;;
  windows)
    log "On Windows, run from an elevated PowerShell:"
    echo "    reg import \"$KEEL_ROOT/policies/windows/keel.reg\""
    echo "Then copy the new-tab bundle to %ProgramData%\\Keel\\newtab\\"
    ;;
  *) die "unknown platform: $PLATFORM" ;;
esac
