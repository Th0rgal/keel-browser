# Keel Patch Stack

The patch stack is deliberately small. Most of Keel's product behaviour is delivered by **policies** and **default preferences** (see `../policies/`), which require no source changes and survive Brave updates cleanly.

Patches only exist for things that the policy system cannot express:

| # | File | What it does | Touches security internals? |
|---|------|--------------|----------------------------|
| 0001 | `0001-keel-branding-strings.patch` | Override `IDS_PRODUCT_NAME` and friends with "Keel" | No |
| 0002 | `0002-keel-default-prefs.patch`     | Apply Keel default-pref bundle at profile creation | No |
| 0003 | `0003-keel-hide-brave-surfaces.patch` | Hide toolbar buttons for Rewards/Wallet/Leo even when the feature isn't fully disabled | No (UI only) |
| 0004 | `0004-keel-topbar-autohide.patch`    | 28-px peek strip + summoned single-row toolbar with autohide controller | No (UI only) |
| 0005 | `0005-keel-per-tab-accent-tint.patch` | Per-tab page-accent color extraction + tint on URL underline / tab marker / strip glow | No (UI only) |
| 0006 | `0006-keel-new-tab.patch`           | Swap default new-tab WebUI source for Keel's static bundle | No (UI only) |

**No patch in this directory touches V8, Blink, the network service, certificate verification, sandboxing, site isolation, WebRTC, WebGPU, PDFium, media/image/font parsers, the extension permission model, password manager crypto, or Safe Browsing.** If a future patch needs to, the maintainer must escalate per the spec.

## Rebasing onto a new Brave

```sh
scripts/sync-upstream.sh                  # fetch latest Brave tag
scripts/apply-patches.sh --check          # dry-run apply
scripts/apply-patches.sh                  # real apply, fail fast on conflict
scripts/security-lag.sh                   # update lag report
```

When `--check` reports a conflict, fix the patch in `patches/` (not the source tree) and re-run. Keep patches minimal — the smaller the surface, the less rebase work.

## Patch hygiene

- One concern per patch
- Smallest possible diff
- No reformatting of surrounding code
- Subject line: `keel: <area>: <change>`
- Body explains *why*, not *what*
- Line numbers will drift between Brave releases; rely on context, not offsets
