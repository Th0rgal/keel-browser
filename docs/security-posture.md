# Keel Security Posture

This document tracks the **off-limits surfaces** the spec mandates Keel must not touch, and proves Keel doesn't touch them.

## Off-limits (per spec)

Keel must not modify any of:

| Surface | Why | How Keel honours it |
|---|---|---|
| V8 | Exploit primitive | Not referenced in any patch. `grep -r v8/ patches/` returns nothing. |
| Blink | Web platform attack surface | Same. |
| Network service | TLS, HTTP, DNS | Same. |
| Certificate verification | Trust anchor | Same. |
| Sandboxing | Process isolation | Same. |
| Site isolation | Spectre/cross-origin | Same. |
| WebRTC | Networking, codecs | Same. |
| WebGPU | GPU attack surface | Same. |
| PDFium | Document parser | Same. |
| Media parsers | Format parsers | Same. |
| Image parsers | Format parsers | Same. |
| Font parsers | Format parsers | Same. |
| Extension permission model | Privilege boundary | Same. |
| Password manager crypto | Cred storage | Same. |
| Safe Browsing / interstitials | Phish blocking | Policy keeps it ON. |

The `patches/` directory contains six patches. Each is constrained to:

- Strings (`*.grdp`)
- Theme color maps (`ThemeProperties`)
- Toolbar `ShouldShow*` helpers
- Tab + omnibox layout constants
- New-tab WebUI data-source selection

Verification script:

```sh
docs/audit-patches.sh   # greps the patch stack for forbidden tokens
```

## Off-limits networked services

The spec also says: don't blindly disable upstream networked services. Specifically:

| Service | Keel state | Rationale |
|---|---|---|
| Safe Browsing | ON (standard / level 1) | Phishing & malware download blocking. Extended reporting OFF for privacy. |
| Component updates | ON | Delivers Subresource Filter, Certificate Error Assistant, etc. |
| Extension updates | ON | Patches go to extensions too. |
| Certificate revocation (CRLite/CRLSets) | ON (via component updates) | Trust anchor maintenance. |
| Brave Sync URL | unset | Sync is opt-in per user, but the sync server is upstream Brave's. We don't proxy or redirect. |
| Brave Talk | DISABLED | Pure product feature; no security loss. |
| Brave VPN | DISABLED | Off by default in Brave too. Disabling per spec product direction. |
| Brave Rewards / Ads | DISABLED | Per spec — no crypto integrations. |
| Brave AI Chat (Leo) | DISABLED | Per spec — privacy direction. |

## Privacy posture

Keel defaults are strict but should not break sites:

- HTTPS-only mode: enforced (policy `HttpsOnlyMode=force_enabled`)
- Third-party cookies: blocked (policy `BlockThirdPartyCookies=true`)
- Fingerprinting: Brave Shields default (strict but not "aggressive" — that breaks too many sites)
- Search suggestions: off
- Network prediction: off (`NetworkPredictionOptions=2`)
- Translate: off
- Alternate error pages (typo suggestions sent upstream): off
- URL-keyed anonymized data: off
- Spell check service (cloud): off
- Spell check (local dictionary): on
- Metrics reporting: off
- Brave P3A: off (master_preferences `brave.p3a.enabled=false`)

If a user wants to relax these, every one of them is user-overridable via Brave's `brave://settings`. We set defaults, not handcuffs.

## What we don't claim

Keel does not claim to make Brave "more secure than Brave." That would be a misleading claim — Keel's security surface is identical to Brave Stable plus our small UI deltas. What Keel does claim:

1. Tighter privacy defaults than Brave's stock new install
2. No product clutter (Rewards / Wallet / VPN / Leo / News surfaces hidden or off)
3. Fast follow on Brave security updates (≤72h SLA)
4. Transparent diff against Brave (six small patches, fully audit-able)
