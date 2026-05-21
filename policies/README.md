# Keel Policies

This directory contains the Keel policy pack — the **first line of debloating**.

Whenever the spec lets us hide or disable a Brave feature via a managed policy or default preference, we do that here instead of patching Brave source. Policies survive Brave updates without rebasing.

## Files

| File | Purpose | Install location |
|------|---------|------------------|
| `linux/keel-managed-policy.json` | Enforced managed policies | `/etc/brave/policies/managed/` |
| `macos/com.brave.Browser.plist.xml` | macOS Configuration Profile (XML form) | `/Library/Managed Preferences/com.brave.Browser.plist` (after `plutil -convert binary1`) |
| `windows/keel.reg` | Windows registry policies | `HKLM\SOFTWARE\Policies\BraveSoftware\Brave` |
| `master_preferences.json` | Default profile preferences (user-overridable) | See file header for per-OS path |

## Verifying applied policies

After install, navigate to `brave://policy` in the running browser. Every policy in this directory should appear with **Source: Platform** (or **Cloud**) and **Status: OK**.

If a key shows **Status: Unknown policy**, that key isn't recognized by the current Brave build — remove it (Brave occasionally renames or retires policies between releases). Track the Brave policy list at:

- Brave repo: `components/brave_<feature>/common/pref_names.cc`
- Chromium policy templates: `chrome/app/policy/policy_templates.json`

## Security posture

These policies are deliberately conservative:

- **Safe Browsing is ON** (standard protection, level 1) — only extended reporting is disabled
- **Component updates are ON** — these carry security fixes
- **Password manager / leak detection are ON**
- **HTTPS-only mode is enforced**
- **Extension installs are allowed** — only the *type* is restricted to `extension`/`theme`

Anything that would degrade Brave's security envelope (Safe Browsing off, certificate-verification overrides, etc.) is intentionally absent.
