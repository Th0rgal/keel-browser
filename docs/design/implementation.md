# Implementation Guide — Keel Top Bar + Per-Tab Tint

How the design in `navbar-ideas.md` lands in Chromium source. Read alongside `patches/0004-keel-topbar-autohide.patch` and `patches/0005-keel-per-tab-accent-tint.patch`.

## Module map

```
brave/
├── browser/
│   ├── ui/
│   │   ├── keel/                              ← new
│   │   │   ├── BUILD.gn                       ← KeelTabAccent target
│   │   │   ├── keel_tab_accent.{cc,h}         ← per-tab page accent (KeyedService)
│   │   │   └── keel_tab_accent_factory.{cc,h} ← profile-scoped factory
│   │   │
│   │   └── views/keel/                        ← new
│   │       ├── BUILD.gn                       ← KeelViews target
│   │       ├── keel_autohide_controller.{cc,h}  ← state machine: Collapsed ↔ Expanded
│   │       └── keel_minimal_toolbar.{cc,h}      ← 28-px peek strip view
│
chrome/browser/ui/views/                       ← three surgical edits
├── frame/browser_view.{cc,h}                  ← own peek + controller
├── tabs/tab.cc                                ← paint per-tab marker
└── location_bar/location_bar_view.cc          ← paint accent underline
```

Total new files: 8 (6 source + 2 BUILD.gn). Edited files: 3.

## Class responsibility map

| Class | Lives in | Responsibility |
|---|---|---|
| `KeelMinimalToolbar` | `views/` | Paint the 28-px strip. Receive `SetActiveAccent(SkColor)` from the autohide controller and repaint the bottom glow. Stateless beyond `active_accent_`. |
| `KeelAutohideController` | `views/` | State machine: Collapsed ↔ Expanded. Owns the dwell timer and the dismiss timer. Pre-targets the BrowserView for mouse events to detect hot-zone enter/exit. Reads `ui::PrefersReducedMotion()` to pick instant vs 180 ms tweens. Holds the pinned-visible flag. |
| `KeelTabAccent` | `ui/keel/` | Per-profile `KeyedService`. Maps `WebContents*` → calmed `SkColor`. Observes navigation + favicon-URL updates to invalidate. Extraction order: `<meta theme-color>` (via `WebContents::GetThemeColor()`), then favicon dominant color (via `ImageFetcher`'s `PaletteExtractor`), then `kStaticAccent`. Clamps result through HSL. LRU caches favicon-dominant lookups (256 entries). |
| `KeelTabAccentFactory` | `ui/keel/` | Standard `BrowserContextKeyedServiceFactory`. |

## State machine

```
        ┌───────────────────────────────────────────┐
        │                Collapsed                  │
        │   peek strip visible, toolbar hidden      │
        └─┬──────────────────────────────────┬──────┘
          │                                  │
   hot-zone dwell ≥ 80ms                     │
   F6 / Ctrl+L / Ctrl+T                      │   timer fires
   extension popup opens                     │
   pinned=true                               │
          │                                  │
          ▼                                  │
        ┌───────────────────────────────────────────┐
        │                Expanded                   │
        │   toolbar visible, peek strip hidden      │
        └─┬─────────────────────────────────────────┘
          │
   cursor leaves bar AND page focused
          │
          ▼
   start dismiss_timer (1200ms)
   ...timer fires → back to Collapsed
   (unless pinned=true, in which case ignored)
```

Pinned-visible flag is per-window, persisted to the profile prefs as `keel.chrome_pinned`.

## Accent extraction pipeline

```
                          ┌──────────────────────────┐
                          │   page commits load      │
                          └────────────┬─────────────┘
                                       │
                       ┌───────────────┴───────────────┐
                       │  KeelTabAccent::DidFinish    │
                       │  Navigation invalidates     │
                       │  per_tab_[contents]         │
                       └───────────────┬──────────────┘
                                       │
                       on next GetAccentFor(contents):
                                       │
            ┌──────────────────────────┴─────────────────────────┐
            │                                                    │
            ▼                                                    │
   ReadMetaThemeColor():                                         │
     contents->GetThemeColor() (cached by Blink                  │
     via DocumentMetadataExtractor)                              │
            │                                                    │
       found?─yes─→ ClampToKeelPalette() → return                │
            │                                                    │
            no                                                   │
            │                                                    │
            ▼                                                    │
   FaviconDominantColor(favicon_url):                            │
     check favicon_dominant_lru_                                 │
            │                                                    │
       hit?─yes─→ ClampToKeelPalette() → return                  │
            │                                                    │
            no                                                   │
            │                                                    │
            ▼                                                    │
   schedule async PaletteExtractor fetch.                        │
   For now, paint kStaticAccent.                                 │
   When fetch resolves, store in LRU and notify                  │
   listeners (Tab, LocationBarView, KeelMinimalToolbar).         │
            │                                                    │
            └─────── on completion: SchedulePaint() ─────────────┘
```

## HSL clamping

```cpp
constexpr float kHslSatMax    = 0.55f;
constexpr float kHslLightMin  = 0.40f;
constexpr float kHslLightMax  = 0.70f;
```

These mirror `theme/tokens.json.tab_tint`. The clamp is what keeps loud brand colors (HN orange `#FF6600`, arXiv crimson `#B31B1B`) calm in chrome (`#C97A4A`, `#C0606A`). Lightness floor + ceiling guarantee contrast against both the dark `#0F1214` toolbar and the light toolbar `#F0EFEA`.

## Where each piece of paint lives

| Visual | Painted by | Source |
|---|---|---|
| Strip background | `KeelMinimalToolbar::OnPaint` | rgba(15,18,20,0.55) + 20-px backdrop blur |
| Strip glow at bottom | `KeelMinimalToolbar::OnPaint` | 1-px line + 12-sigma Skia blur with active_accent_ at 0x20 |
| Strip favicon dot | child `views::View` | tinted with active_accent_ |
| Strip host/title labels | `views::Label` × 2 | `ELIDE_TAIL` for truncation |
| Strip traffic lights | child `views::View` per dot | painted by us; on macOS native controls overlay |
| Bar background | `ToolbarView` (unchanged) | Brave default; we only override colors in 0005 |
| Bar bottom hairline | `LocationBarView::OnPaint` (edited) | 1-px line, accent at 0x99 (60%) |
| Tab background (active) | `Tab::PaintTab` (unchanged) | Brave default |
| Tab left marker | `Tab::PaintTab` (edited) | 2-px rect at x=0, height-8 with accent |

## What we deliberately don't touch

These are listed in `docs/security-posture.md` and `docs/audit-patches.sh` enforces. The implementation respects:

- No edits under `third_party/` (Blink, V8, ffmpeg, libvpx, libpng, libwebp, libjpeg, freetype, harfbuzz)
- No edits under `services/network/`, `net/cert/`
- No edits under `sandbox/`, `content/browser/site_isolation/`
- No edits under `services/audio/`, `media/`, `pdf/`, `third_party/pdfium`
- No edits under `components/safe_browsing`, `components/permissions`, `components/password_manager`
- No `ipc/ipc_channel`

Only `chrome/browser/ui/views/*` and new files in `brave/browser/ui/{keel,views/keel}/`. The `docs/audit-patches.sh` script greps both 0004 and 0005 for forbidden tokens and exits non-zero if any appear.

## Build cost

Per the BUILD.gn changes:

- `:keel_views` adds ~280 lines compiled into the existing `chrome/browser/ui/views` target. ~3 seconds on a warm build.
- `:keel_tab_accent` adds ~210 lines compiled into `chrome/browser/ui` deps. ~3 seconds.
- Three edited files in `chrome/browser/ui/views/{frame,tabs,location_bar}/` recompile (~30 seconds combined on warm).

So a rebase + recompile after `apply-patches.sh` is roughly a one-minute incremental build on a typical Chromium developer workstation. Cold build is governed by upstream Chromium, not Keel.

## Accessibility

| Concern | Mitigation |
|---|---|
| Chrome hidden = user can't find UI | `F6` summons; `Ctrl+L` summons + focuses URL; any keyboard shortcut that touches chrome (e.g. `Ctrl+T`) also summons. |
| Reduced motion | `KeelAutohideController::ShouldAnimate()` returns false when `ui::PrefersReducedMotion()`; transitions become instant. |
| Forced colors / high contrast | `KeelMinimalToolbar::OnPaint` checks `views::View::IsForcedColors()` and switches to 100 % opaque background + system colors; per-tab tints are suppressed (forced-colors users get a consistent system look). |
| Screen readers | The peek strip exposes its label tree via `views::ViewAccessibility::SetRole(ax::mojom::Role::kToolBar)` so AT software still finds the tab title. Summoning the full toolbar fires `AXEventGenerator::Event::ALERT` for screen readers. |
| Touch / pen | Tap on the strip summons. There is no cursor-proximity mechanism for pure-touch devices; tap is the only summon. |
| Pinned-visible escape hatch | Right-click the strip → "Keep chrome visible" sets `keel.chrome_pinned=true` for the window. Per-profile preference, survives restart. |

## Testing

The smoke runner in `tests/smoke/run.js` already covers:
- Brave launches with the patch stack applied (`01_launch`)
- Settings page reachable (`05_settings_renders`)
- New tab clean (`04b_keel_ntp_clean`)

Add when this patch is applied:
- `11_strip_visible_after_idle`: launch, navigate, wait 2 s, assert toolbar is hidden + strip painted
- `12_summon_on_f6`: press F6, assert toolbar visible within 250 ms
- `13_per_tab_accent`: open 3 tabs with known `<meta theme-color>` pages, sample paint for each, assert the per-tab accent matches the clamped value

Skip if patch not applied — the policy-only install path doesn't get this UI.
