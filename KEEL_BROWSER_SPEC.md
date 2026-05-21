# Keel Browser Specification

## Overview

Keel Browser is a minimal, security-oriented, beautiful Brave-based browser distribution.

The goal is **not** to create a deep Chromium fork. The goal is to preserve Brave’s security/update pipeline while applying a thin product layer:

- policy-based debloating
- privacy-oriented defaults
- minimal branding
- a custom Safari-inspired top bar
- a clean new tab experience
- strict limits on security-sensitive code changes

Keel should feel like a polished, minimalist browser for researchers, builders, and technical users who want a calm, elegant interface without Brave’s crypto/product clutter.

## Core principle

Keel must stay as close as possible to upstream Brave.

The fork should only modify:

- browser UI/chrome
- top bar styling
- toolbar layout
- new tab page
- default preferences
- managed policies
- branding assets

Keel must avoid touching:

- V8
- Blink
- network service
- certificate verification
- sandboxing
- site isolation
- WebRTC
- WebGPU
- PDFium
- media parsers
- image parsers
- font parsers
- extension permission model
- password manager cryptography
- Safe Browsing/security interstitials

If a change requires touching security-sensitive browser internals, do not implement it unless explicitly approved.

## Base browser

Keel is based on **Brave Stable**.

The desired architecture is:

```text
Brave upstream
  + Keel policy pack
  + Keel branding
  + Keel UI patch stack
```

Keel should not become an independent Chromium fork.

The project should make it easy to rebase on new Brave releases with minimal conflicts.

## Security and update requirements

Keel must prioritize fast upstream security updates over heavy customization.

Target security SLA:

- Critical/exploited Chromium update: update within 24h
- High-severity stable update: update within 48h
- Normal Brave/Chromium update: update within 3-5 days
- If security lag >72h: recommend using official Brave until Keel catches up

The project should expose, at minimum:

- current upstream Brave version
- current upstream Chromium version
- current Keel version
- security lag
- patch application status
- build/test status

Example:

```text
Upstream Brave:    1.xx.xxx
Upstream Chromium: 148.x.x.x
Keel:              1.xx.xxx-keel.1
Security lag:      0h
Patch status:      clean
Build status:      passing
```

## Features to disable or hide by default

Keel should remove or hide Brave product clutter as much as possible using policies/default preferences before source patches.

Disable/hide by default:

- Brave Rewards
- Brave Wallet
- Brave News
- Brave VPN
- Brave Leo AI
- sponsored images
- crypto/Web3 buttons
- sidebar
- unnecessary promotional surfaces
- first-run promotional onboarding
- default cards/widgets on the new tab page
- shopping/deals/promotional integrations
- non-essential telemetry/usage pings where configurable

If a feature cannot be removed safely, hide it from the UI and document the limitation.

## Privacy/security defaults

Keel should default to a strict but usable configuration:

- strong ad/tracker blocking
- HTTPS-first / HTTPS-only behavior where practical
- third-party cookies blocked or restricted
- fingerprinting protection enabled
- autoplay restricted
- minimal extension surface
- no preinstalled non-essential extensions
- clear extension permission warnings
- no crypto-specific integrations enabled by default
- privacy-preserving search default, configurable by user

Do not degrade security by blindly removing upstream security services. In particular, be careful with:

- Safe Browsing or equivalent protections
- extension update mechanisms
- certificate/security update mechanisms
- component updates that carry security fixes

If disabling any upstream networked service, document the security/privacy tradeoff.

## Visual identity

Keel should look calm, elegant, and serious.

Design keywords:

- minimalist
- Safari-inspired
- macOS-native feeling
- research-lab aesthetic
- quiet luxury
- simple
- precise
- low visual noise
- beautiful but not playful
- suitable for mathematical researchers and technical founders

Avoid:

- bright colors
- crypto/product vibes
- heavy branding
- gamified UI
- busy dashboards
- visual clutter
- excessive rounded “toy app” aesthetics

## Top bar design

The top bar is the main custom UI goal.

It should be inspired by Safari, especially:

- compact vertical height
- refined spacing
- calm tab shape
- elegant address bar
- minimal toolbar icons
- native-feeling window chrome
- balanced empty space
- subtle translucency or blur where platform-appropriate
- clean integration with light/dark mode

Desired top bar behavior:

- tabs and address bar should feel visually unified
- active tab should be clear but not loud
- inactive tabs should recede softly
- toolbar icons should be minimal and monochrome
- the address bar should feel centered, calm, and lightweight
- avoid Brave/Chrome’s busier visual density
- avoid unnecessary separators
- keep browser controls discoverable

The browser should feel closer to Safari/Orion than Chrome/Brave, while still remaining Brave under the hood.

## Theme details

Default theme:

- dark mode first
- near-black background, not pure black
- subtle contrast
- soft grey borders
- minimal accent color
- no saturated colors except possibly one restrained accent

Suggested palette:

| Token            | Value     |
| ---------------- | --------- |
| Background       | `#0B0D0E` |
| Elevated surface | `#111416` |
| Toolbar          | `#0F1214` |
| Address bar      | `#181C1F` |
| Border           | `#252A2E` |
| Text primary     | `#F2F2EF` |
| Text secondary   | `#A8ADB2` |
| Muted text       | `#737A80` |
| Accent           | `#53DAC6` |

Light mode should exist but can be secondary:

| Token            | Value     |
| ---------------- | --------- |
| Background       | `#F7F6F2` |
| Elevated surface | `#FFFFFF` |
| Toolbar          | `#F0EFEA` |
| Address bar      | `#FFFFFF` |
| Border           | `#D9D7D0` |
| Text primary     | `#161616` |
| Text secondary   | `#555A60` |
| Accent           | `#53DAC6` |

The accent color `#53DAC6` should be used sparingly.

## New tab page

The new tab page should be minimal.

Default layout:

- no news
- no sponsored images
- no crypto cards
- no ads
- no clutter
- no gamified widgets

Preferred content:

- centered search/address input
- optionally a small list of pinned sites
- optionally a quiet clock
- optionally a minimal background
- no default distractions

The new tab should feel like a clean workspace, not a portal.

## Branding

Use the name:

**Keel Browser**

Brand direction:

- minimal nautical/structural metaphor
- elegant technical identity
- no cartoonish logo
- no heavy corporate branding
- should feel like a serious browser for deep work

Branding changes should include, where practical:

- app name
- icon
- about page branding
- update/version labels
- new tab branding
- profile directory naming if safe

Avoid changing internal identifiers unless necessary. Branding should not make rebases harder.

## Repository structure

Aim for a structure like:

```text
keel-browser/
  README.md
  KEEL_BROWSER_SPEC.md
  upstream/
    brave-browser/
  patches/
    0001-keel-branding.patch
    0002-keel-default-prefs.patch
    0003-keel-hide-brave-surfaces.patch
    0004-keel-topbar-layout.patch
    0005-keel-topbar-style.patch
    0006-keel-new-tab.patch
  policies/
    macos/
    linux/
    windows/
  scripts/
    sync-upstream.sh
    apply-patches.sh
    build-macos.sh
    build-linux.sh
    build-windows.sh
    smoke-test.sh
    security-lag.sh
  ci/
    upstream-watch.yml
    build.yml
```

The patch stack should be small, readable, and easy to reapply.

## Implementation strategy

Implement in this order:

1. Set up Brave upstream build.
2. Add Keel policy pack to debloat Brave without source changes.
3. Add Keel branding.
4. Add custom new tab page.
5. Patch the top bar UI/style.
6. Add smoke tests.
7. Add upstream update monitoring.
8. Add security-lag reporting.
9. Document exactly what changed from Brave.

Prefer policies/defaults over patches whenever possible.

Prefer CSS/layout/token changes over logic changes.

Prefer small patches over broad refactors.

## Testing requirements

At minimum, verify:

- browser builds successfully
- browser launches successfully
- browsing works
- HTTPS sites work
- downloads work
- extensions can be installed if allowed
- password manager is not broken
- profiles work
- settings page works
- Brave-specific disabled features stay hidden/disabled
- top bar renders correctly in light and dark mode
- new tab page has no unwanted Brave clutter
- update metadata/version reporting works
- no accidental changes were made to security-sensitive components

Smoke test pages:

- normal HTTPS website
- website with login form
- website with video
- website with WebGL/WebGPU if supported
- extension store / extension install flow
- PDF opening
- download flow

## Definition of done

Keel is acceptable when:

- it builds cleanly from a documented upstream Brave version
- patches apply cleanly
- disabled features are actually hidden or disabled
- the top bar visually matches the Safari-inspired design goal
- the new tab page is minimal and distraction-free
- the browser remains close to upstream Brave
- security-sensitive internals are untouched
- update/rebase process is documented
- smoke tests pass
- the final diff is understandable and maintainable

Do not over-engineer. The goal is a beautiful, minimal, security-oriented Brave distribution with a very thin customization layer.
