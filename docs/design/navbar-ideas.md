# Navbar Design Brainstorm

The spec's top-bar direction is clear: Safari-inspired, calm, low visual noise, compact vertical height, refined spacing. The user-stated goal that supersedes all of this is **"give the most space to the website, and bring the UI back on demand."**

This doc lists every navbar idea I think is worth considering, then picks one as Keel's target. The intent is to enable a single, opinionated design decision now and move on.

---

## Constraints

These ground the brainstorm:

1. **Keep upstream Brave's keyboard shortcuts.** No rebinding. Ctrl+L still focuses the URL, Ctrl+T still opens a tab, etc.
2. **Touch only `tab_strip_views/`, `toolbar_view/`, `location_bar/`, `omnibox/`, and the theme provider.** No site isolation, no input routing.
3. **No GPU compositor changes.** Translucency and blur are fine via existing `views::View::SetBackground(blur)` paths.
4. **Discoverable.** A user who has never seen Keel must figure out how to navigate within 10 seconds.
5. **Accessible.** Auto-hide is a known accessibility hazard — there must always be a way to summon the UI without a mouse hover.

---

## 14 ideas, with trade-offs

Each entry has the same shape so they're comparable.

### 1. Auto-hide on idle, peek on cursor proximity

**Visual:** When the page is being read (no input for ≥1.2s), the top bar shrinks to a 4-px colored strip that carries only the favicon + tab title sliver. Cursor enters the top 80 px of the window → full bar slides down at 180 ms ease-out. `Ctrl+L` or `F6` also summons it.

**Pros:** Maximum content area in the steady state. Discoverable by accident (anyone moves the mouse to the top to click the close button). Same shortcut summoning works for accessibility.

**Cons:** Click targets like the close/min/max buttons must stay reachable, so the strip can't be entirely empty. The "is it loading" affordance becomes the favicon + a thin progress bar inside the 4 px.

### 2. Always-visible bar that fades to 20 % opacity

**Visual:** Bar stays fixed. After 2 s of inactivity, opacity drops to ~20 %. Any cursor move / scroll / keypress restores 100 %.

**Pros:** Nothing surprises the user — chrome is always there. Accessibility-safe.
**Cons:** Doesn't actually give space back to the website. Just visually quieter.

### 3. Arc-style edge-floating pill

**Visual:** A glass pill (rounded 16 px, blur backdrop) floats at top-center. Just the URL (truncated). Click expands into the full toolbar. Tabs live in a vertical sidebar.

**Pros:** Extreme minimalism. Reads as "browser as window, not browser as app."
**Cons:** Vertical tab sidebar is a huge departure from Brave/Safari. Costs horizontal space (the very thing we want to give back). Discoverability suffers.

### 4. Single combined row (Safari single-bar mode)

**Visual:** One row only. Active tab pill on the left (favicon + 18 chars of title), URL on the right. Other tabs collapse to favicons; hover any favicon expands its title.

**Pros:** Saves an entire row vs Chromium's default two-row layout. Visually unified, exactly the spec's "tabs and address bar should feel visually unified."
**Cons:** Many tabs → favicon strip overflows. Need a "tab overflow" menu.

### 5. Bottom-anchored toolbar (mobile-Safari style on desktop)

**Visual:** Tabs at top (or hidden), URL + nav buttons at bottom. Bar slides out when you scroll down, returns when you scroll up.

**Pros:** Frees the top for content's natural reading flow. Reachable on tall laptop screens without mousing all the way up.
**Cons:** Breaks decades of muscle memory. Most desktop users instinctively look up.

### 6. Vertical tabs in a collapsible left rail

**Visual:** Top bar is just URL + extensions + menu. Tabs are a left sidebar that's 36 px wide by default, expands to 220 px on hover.

**Pros:** Lots of vertical real estate is wasted on most websites; a tab rail uses some of it productively. Scales to dozens of tabs without overflow.
**Cons:** Costs horizontal width even when collapsed. Big behavioral change.

### 7. Cmd-K command palette + minimal bar

**Visual:** The whole bar becomes a 28 px slim strip with just the active tab's favicon + close. Everything else — new tab, history, bookmarks, search, navigate-to — lives behind Ctrl/Cmd+K, which opens a Spotlight-style fuzzy finder.

**Pros:** Genuinely minimal. Power-user happy. Calm in steady state.
**Cons:** Discoverability cliff. Casual users will be lost.

### 8. Translucent / blur tinting, but no layout change

**Visual:** Same Chromium layout, but tab strip + toolbar use a backdrop-blur with subtle tint pulled from the page's dominant color (Safari does this).

**Pros:** Cheap. No layout disruption. Just feels "calm and macOS-native" per the spec.
**Cons:** Doesn't give space back. Only addresses the spec's "subtle translucency" line.

### 9. Two-row collapsing to one row on focus loss

**Visual:** Default: classic two-row (tabs above, toolbar below). When the page has been focused for 800 ms with no interaction toward chrome, the two rows collapse into one (active tab + omnibox merge). Hover top → back to two rows.

**Pros:** Familiar default. Saves a row in the steady state. Easy to roll back.
**Cons:** The collapse animation will be noticed; if it happens too often it feels jittery.

### 10. Reader-mode-triggered minimal chrome

**Visual:** When the page's DOM looks article-like (Mozilla Readability heuristic), drop into minimal chrome automatically. Otherwise stay in full chrome.

**Pros:** Smart. Calm where it matters, full chrome where users need it.
**Cons:** False positives (e.g., a docs page vs an app page). Two-mode behavior is itself confusing.

### 11. Drag-from-top reveal (macOS menu-bar style)

**Visual:** Chrome hidden. Push cursor against the top edge of the viewport for 80 ms → bar slides down. Hard threshold prevents accidental triggers.

**Pros:** Familiar to macOS users. Resists accidental triggers.
**Cons:** Not familiar to Windows / Linux users. Linux uses bottom panels, Windows uses bottom taskbars.

### 12. Many-tabs → single icon proxy

**Visual:** Tabs collapse to one icon with the active favicon + a small badge for "+ N more". Click expands an overlay grid (Mission Control-style).

**Pros:** Drastic horizontal savings. Looks elegant with 1-2 tabs.
**Cons:** Heavy interaction for tab switching with 5-20 tabs. Switches are a high-frequency action.

### 13. Per-tab persistent thin strip + summoned full bar

**Visual:** Hybrid of #1 and #4. Persistent 28 px strip shows: favicon + 24 chars of title + Reload + Close. Cursor enters top zone OR `F6` pressed → full bar slides down. Includes tabs / URL / extensions.

**Pros:** Compromise between aggressive auto-hide (#1) and always-visible (#2). Discoverable: clicking the favicon area gives obvious chrome. Keyboard-summon works for accessibility.
**Cons:** 28 px is more than 4 px — slightly less content space than #1.

### 14. Picture-in-picture style: chrome floats inside the viewport

**Visual:** Toolbar is a draggable floating panel inside the page area, like a PiP video. User drags it anywhere they want.

**Pros:** Maximum customization.
**Cons:** Cognitive load. Goes against "calm" and against "simple". I'd not ship this.

---

## Recommendation

**Combine #13 (peek strip + summon) + #8 (translucency) + #4 (single combined row).**

In one sentence: **a 28-px translucent strip that shows the active tab's identity, with a full single-row bar that slides down on cursor proximity or `F6`/`Ctrl+L`.**

### Why this combination

- **#13 over #1** because 28 px (vs 4 px) keeps the close/minimize buttons reachable, gives the active tab identity at a glance, and resists accidental hide-show triggers. The user sees enough to feel oriented but the website still owns the screen.
- **#4 (single combined row)** as the expanded form because the spec explicitly says "tabs and address bar should feel visually unified" — a single row is the simplest expression of that. Other tabs are favicon chips; titles expand on hover.
- **#8 translucency** as the visual treatment because the spec says "subtle translucency or blur where platform-appropriate" — this is the cheap, native-feeling way to get there without layout disruption.

### Steady state vs summoned

```
┌────────────────────────────────────────────────────────────────┐
│ ▾ veritylang.com  ·  Verity — Formally Verified…       ✕  ─ □  │  ← 28 px strip, ~70% opacity, blur backdrop
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│                  PAGE CONTENT FILLS EVERYTHING                  │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

Cursor near top, or `F6` pressed:

```
┌────────────────────────────────────────────────────────────────┐
│ ◐ ⟨ ⟩ ⟲   verity (active)  ●  hn  ●  arXiv  ●  +              │  ← tabs row, 30 px
│   ┌──────────────────────────────────────────────┐              │
│   │ 🔒 veritylang.com                       ⚙   │ ⊕ 🧩 ☰        │  ← URL row, 30 px (one row total with #4)
│   └──────────────────────────────────────────────┘              │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│                  PAGE CONTENT                                   │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

Actually with #4 those two collapse into one row:

```
┌────────────────────────────────────────────────────────────────┐
│ ⟨ ⟩ ⟲   verity ●  hn  arXiv  +   │  veritylang.com    🧩 ☰     │
├────────────────────────────────────────────────────────────────┤
│                  PAGE CONTENT                                   │
└────────────────────────────────────────────────────────────────┘
```

### Behavior rules

1. **Steady state:** 28 px strip, 70 % opacity, backdrop blur, accent (`#53DAC6`) only on focus rings.
2. **Summon triggers:**
   - Cursor moves into the top 60 px of the viewport for ≥ 80 ms
   - `F6` (always works)
   - `Ctrl+L` (focuses URL inside the summoned bar)
   - `Ctrl+T` (creates a tab, which also summons)
   - Any extension popup opening
3. **Dismiss triggers:** Cursor leaves the bar AND the page is focused (i.e., last input was a page interaction, not a chrome interaction) AND 1.2 s elapsed.
4. **Pinned-visible state:** Right-click strip → "Keep chrome visible." Sets a per-window preference. For users who want classic always-on chrome.
5. **Fullscreen (`F11`):** completely hides the strip too. Cursor near top still summons.

### Accessibility & sanity

- **`F6` and `Ctrl+L` always summon** — no input modality is locked out.
- **High-contrast / forced-colors mode:** strip switches to 100 % opacity, no translucency, system colors.
- **Reduced motion:** the slide-down becomes a 0 ms instant.
- **Touch / pen:** tap the strip = summon. There's no "cursor proximity" without a pointer device, so touchscreens summon on tap.

### What this is NOT

- Not a tab sidebar. Vertical tabs require too much horizontal real estate even when collapsed; doesn't match "give most space to the website."
- Not Arc's command bar. Cool, but discoverability is too poor for the spec's "research-lab" audience that includes people who just want to *browse the web*.
- Not bottom-anchored. Desktop muscle memory is top-anchored; fighting that loses more than it gains.

---

## Implementation cost

| Component | Where | Effort |
|---|---|---|
| 28 px strip layout when "collapsed" | `chrome/browser/ui/views/frame/browser_view.cc` + a new `KeelMinimalToolbar` view | M |
| Single-row tab+omnibox layout (expanded) | `chrome/browser/ui/views/tabs/tab_strip.cc`, `location_bar_view.cc` | M-L |
| Cursor-proximity detector | `KeelChromeAutohideController` listening to `BrowserView::OnMouseMoved` | S |
| Translucent backdrop | `views::View::SetBackground(MakeBlurBackground(...))` — already supported | S |
| `F6` summon binding | `chrome/browser/ui/views/accelerator_table.cc` (already exists, repurpose) | S |
| Per-window "pinned chrome" preference | new pref in `chrome/browser/ui/views/frame/browser_view.cc` | S |
| Theme tokens for the strip's translucent state | `theme/tokens.json` adds `topbar.strip_*` group | S |
| Reduced-motion + high-contrast branches | `KeelChromeAutohideController::ShouldAnimate()` | S |

Total: roughly two new C++ files (~300 lines each), three small changes to existing Chromium UI files, and one new patch file in `patches/`. Existing `patches/0004` and `patches/0005` would become this new larger patch.

---

## Why not just ship #1 (4 px strip)

I'd love to. But:

- The window title and close button live in that area on most platforms.
- The current loading-progress indicator needs at least ~24 px to be visible.
- Brave's update / "managed by organization" badges need somewhere to live.

28 px is the smallest height that keeps these affordances visible while still feeling minimal.

---

## Open questions for the user

1. **macOS native title bar:** keep it (with `windowControlsOverlay`-style flush integration) or replace it entirely? Replacing it lets us recover a few px but adds platform-specific code.
2. **Per-tab color tinting:** Safari draws a tint on the active tab borrowed from the page's accent color. Do you want that, or stay strictly monochrome?
3. **Tab title scrolling:** when the active tab's title is longer than the slot, do we let it scroll on hover, or just truncate?

My defaults for these would be: (1) replace it on macOS too (consistent across platforms), (2) keep strictly monochrome (the page already has its own colors — the chrome shouldn't compete), (3) truncate with `…`, no scroll.
