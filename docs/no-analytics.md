# Disabling Brave Analytics

This document is the canonical list of every analytics / telemetry surface Brave (and the Chromium it's built on) can use, what Keel does about each, and the trade-offs.

The TL;DR: **all Brave-controlled telemetry is off**. Chromium UMA + UKM are off. The Chromium Variations service is set to "critical fixes only" — full block is possible but breaks emergency-mitigation delivery, so we don't recommend it. Network-level egress blocking is a separate, recommended layer for users who want true defense-in-depth.

## Layered model

Keel disables analytics in three layers, in order of strength:

```
1. Managed policy        ← Mandatory. User cannot re-enable. Survives reinstall.
2. master_preferences    ← Defaults for new profiles. User can re-enable in settings.
3. Network-level block   ← Optional. /etc/hosts or DNS. Strongest guarantee.
```

Use as many layers as you trust. Layer 1 + 2 are shipped automatically by `scripts/install-policy.sh`. Layer 3 is documented at the bottom of this file.

## What gets disabled

### Brave-controlled

| Surface | Endpoint (typical) | Layer | Status |
|---|---|---|---|
| P3A (privacy-preserving analytics) | `p3a-creative.brave.com`, `p3a-json.brave.com` | 2 | `brave.p3a.enabled=false`, `notice_acknowledged=true` so no prompt |
| Stats updater (daily/weekly/monthly active user) | `laptop-updates.brave.com`, `static1.brave.com` | 2 | `brave.stats.reporting_enabled=false` + threshold flags |
| Brave Ads | varies | 2 | `brave.ads.enabled=false` |
| Brave News | `brave-today.brave.software` | 2 | `brave.brave_news.opted_in=false` (UI never offers it) |
| Brave Sync (if user opts in) | `sync.brave.com` | n/a | User-controlled. Sync URL not pre-populated. Opt-in only. |
| Brave Talk | n/a | 2 | `BraveTalkDisabled=true` policy |
| Weekly report sub-channel | P3A | 2 | `brave.weekly_report.enabled=false` |
| Core / misc / perf / uptime metrics | P3A sub-channels | 2 | All `enabled=false` |
| Welcome / first-run pings | n/a | 2 | `welcome_page_v3_shown=true`, `skip_first_run_ui=true` |
| Feedback dialog (sends text + URL) | n/a | 1 | `UserFeedbackAllowed=false`, `FeedbackSurveysEnabled=false` |

### Chromium-controlled

| Surface | Endpoint (typical) | Layer | Status |
|---|---|---|---|
| UMA (User Metrics Analysis) | `clients4.brave.com` (Brave proxy) / `clients4.google.com` (upstream) | 1 | `MetricsReportingEnabled=false` |
| UKM (URL-Keyed Metrics) | same | 1 | `UrlKeyedAnonymizedDataCollectionEnabled=false` |
| Domain Reliability monitor | `*.googleusercontent.com` | 1 | covered by UMA off |
| Crash reporter | `clients2.brave.com` | 1 | `MetricsReportingEnabled=false` implies crash off |
| Spell-check service (cloud) | `www.google.com` | 1 | `SpellCheckServiceEnabled=false` |
| Search suggest API | search provider | 1 | `SearchSuggestEnabled=false` |
| Translate language detect | `translate.googleapis.com` | 1 | `TranslateEnabled=false` |
| Alternate error pages (typo suggestions) | `clients4.google.com` | 1 | `AlternateErrorPagesEnabled=false` |
| Network prediction (preconnect) | varies | 1 | `NetworkPredictionOptions=2` (never preconnect) |
| Safe Browsing | `safebrowsing.brave.com` | n/a | **Kept ON.** Standard protection (level 1). Extended reporting OFF. |
| Safe Browsing extended reporting | `safebrowsing.brave.com` | 1 | `SafeBrowsingExtendedReportingEnabled=false` |
| Safe Browsing deep scanning | enterprise feature | 1 | `SafeBrowsingDeepScanningEnabled=false` |
| Variations service (Finch) | `variations.brave.com` | 1 | `ChromeVariations=1` (critical fixes only) — see trade-off below |
| Component update service | `componentupdater.brave.com` | n/a | **Kept ON.** Delivers Safe Browsing / Subresource Filter / cert-revocation updates. |
| Extension update service | Chrome Web Store | n/a | **Kept ON.** Extensions need their own update pipeline. |

### Not disabled (with rationale)

| Surface | Why |
|---|---|
| Safe Browsing core lookups | Phishing & malware blocking. Off means real risk. Standard protection (level 1) only sends hashed prefixes for navigations to suspicious domains. |
| Component updates | Carry security fixes including cert revocation, Subresource Filter, content settings. Disabling these is a security downgrade, not an upgrade. |
| Extension auto-update | Extensions are how users add features. Auto-update is how they get security fixes. |
| DNS-over-HTTPS | Privacy-preserving DNS. Policy `DnsOverHttpsMode=automatic`. |

## Trade-offs

### `ChromeVariations` = 1 vs 0

`ChromeVariations` controls whether Chromium downloads the "variations seed" from `variations.brave.com`. The seed turns features on and off via the Finch framework. Two reasonable choices:

- **`ChromeVariations=1`** (Keel default): allow critical security mitigations to be flipped on remotely, block A/B experiments. Used historically to flip emergency mitigations like the Spectre v2 retpolines, sandbox tightening for new CVEs, etc.
- **`ChromeVariations=0`**: block the seed entirely. No variations service traffic. But you lose the emergency-mitigation channel; in a critical exploit window before the next stable update lands, you're more exposed.

We chose `1` because the spec's first principle is "prioritize fast upstream security updates." If you want `0` and you accept the trade-off, change the line in `policies/linux/keel-managed-policy.json` and reinstall.

### P3A is "privacy-preserving"

Brave's P3A uses a constellation/STAR cryptographic mechanism designed so individual data points aren't linkable to a user. We still turn it off because: (a) the spec asks for it, (b) "privacy-preserving" still means data leaves the device, and (c) the prompt itself is a touchpoint we don't want.

## Layer 3: network-level block (optional)

For users who want defense-in-depth against any future Brave change that re-enables a telemetry endpoint despite our prefs:

### `/etc/hosts` (Linux / macOS)

```text
# Keel — block Brave telemetry endpoints
0.0.0.0  p3a-creative.brave.com
0.0.0.0  p3a-json.brave.com
0.0.0.0  laptop-updates.brave.com
0.0.0.0  static1.brave.com
0.0.0.0  variations.brave.com
0.0.0.0  brave-today.brave.software
```

Do NOT add:

- `safebrowsing.brave.com` — phishing block list lookups
- `componentupdater.brave.com` — security update delivery
- `clients2.brave.com` — used by Chromium update infrastructure (crash reporting also routes here, which we already disabled at the policy layer)

If you accidentally block one of those, Brave will keep working but you lose security signals.

### DNS-level (Pi-hole, NextDNS, etc.)

Same domains as above. Custom blocklists in NextDNS already cover most Chromium telemetry; you mostly need to add the `brave.com` / `brave.software` ones.

## Verifying

After install + restart:

1. Visit `brave://policy` — every policy in `policies/linux/keel-managed-policy.json` should show Status: **OK** / Source: **Platform** / Level: **Mandatory**.
2. Visit `brave://settings/privacy` — the "Help improve Brave" / "Send daily usage ping" / "Help improve Brave Search" toggles should be OFF and grayed out.
3. `tcpdump -i any -n host p3a-creative.brave.com or host laptop-updates.brave.com` for 10 minutes of normal use — should be empty.
4. The P3A acknowledgment prompt should never appear on a fresh profile.

If anything in step 1 shows "Unknown policy" — that key was renamed by Brave in a newer release. Update `policies/linux/keel-managed-policy.json`; the comment block describes each entry's purpose so you can find a replacement.
