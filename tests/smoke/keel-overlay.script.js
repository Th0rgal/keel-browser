// Keel chrome overlay — Safari-style top ribbon with per-tab tinting.
// Injected into the page via CDP/Runtime.evaluate when Brave is launched in
// --app mode (no native tab strip / address bar).
//
// Layout (geometric viewport center for the URL pill, flex for the rest):
//
//   [⏺⏺⏺]  [☰ ‹ ›]  ……  [🔒 host.com (Aa)]  ……  [⇪ ▢]
//      ▲       ▲                ▲                  ▲
//   traffic  left icons    URL pill (favicon +     right icons
//                          host + reader badge)
//
// The ribbon is a 40-px translucent scrim with backdrop-filter blur(26)
// saturate(180%), a per-tab accent gradient layer (~18-24% opacity), a
// hairline border-bottom, a 1.5px accent stripe with a soft glow, and a
// soft drop shadow under the scrim.
//
// Per-tab identity (the chrome's signature):
//   - meta[theme-color] (or mask-icon color, or sampled page-top color)
//     becomes the page accent
//   - accent tints the scrim base, the bottom stripe, the URL pill bg,
//     the icon-hover background, and the URL-pill hover border
//   - the favicon (15x15, SVG preferred) carries visual brand
//   - clamped HSL: saturation ≤ 0.55, lightness ∈ [0.40, 0.70]
//
// Layout: the chrome occupies a permanent 40-px band at the top of the
// window, with page content pushed below via body padding-top. Mirrors
// macOS Safari's desktop chrome — chrome and page never overlap.
//
// State: visible by default. The chrome stays on top, no auto-hide.
// F11/fullscreen will hide it; keyboard shortcuts (F6, Cmd-L, Cmd-T)
// call show() to bring it back if hidden.
//
// A11y: prefers-reduced-motion swaps animations for opacity fades; the
// URL pill is tabbable (role=textbox), icons have aria-labels + focus
// rings. Print media hides the chrome entirely.

(() => {
  if (document.getElementById("__keel_chrome__")) return;
  // Only inject into the top-level frame. Iframes shouldn't paint chrome;
  // they share the parent's chrome instead. Prevents nested chromes when
  // the overlay is naively dispatched into all frames.
  try { if (window !== window.top) return; } catch (e) { return; }
  const P = window.__keelParams__ || {};

  // ---- accent extraction (mirrors KeelTabAccent::GetAccentFor) -------------
  function parseColor(s) {
    if (!s) return null;
    if (s.startsWith("#")) {
      let h = s.slice(1);
      if (h.length === 3) h = h.split("").map(c => c+c).join("");
      const n = parseInt(h.slice(0, 6), 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
    const m = s.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3] };
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return [h, s, l];
  }
  function hslToCss(h, s, l) {
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      function f(t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      }
      r = f(h + 1/3); g = f(h); b = f(h - 1/3);
    }
    return "rgb(" + Math.round(r*255) + "," + Math.round(g*255) + "," + Math.round(b*255) + ")";
  }
  // Normalize an arbitrary color into a clamped accent (S <= 0.55,
  // L in [0.40, 0.70]). Greys (low saturation) return null so the caller
  // can fall through to the next signal instead of producing a dull accent.
  function toAccent(c) {
    if (!c) return null;
    const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
    if ((max - min) / 255 < 0.10) return null;
    let [h, s, l] = rgbToHsl(c.r, c.g, c.b);
    s = Math.min(s, 0.55);
    l = Math.min(Math.max(l, 0.40), 0.70);
    return hslToCss(h, s, l);
  }
  function pageAccent(tintColor) {
    // 1) Honour meta[name="theme-color"] if it's actually a color.
    const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
    const chosen =
      metas.find(m => /dark/.test(m.getAttribute("media") || "")) || metas[0];
    if (chosen) {
      const a = toAccent(parseColor(chosen.getAttribute("content") || ""));
      if (a) return a;
    }
    // 2) Try a link.rel=mask-icon color (Safari pinned-tab hint).
    const maskIcon = document.querySelector('link[rel="mask-icon"][color]');
    if (maskIcon) {
      const a = toAccent(parseColor(maskIcon.getAttribute("color")));
      if (a) return a;
    }
    // 3) Derive from the sampled page-top tint, which is always available.
    //    Sites without theme-color (HN, Wikipedia, ...) get a chrome accent
    //    that actually matches their visual identity instead of the default
    //    teal. Greys still fall through to the static default.
    const a = toAccent(parseColor(tintColor));
    if (a) return a;
    return P.accent || "#2F9D8C";
  }

  // Sample the page's near-edge background color to tint the ribbon. Walks
  // the DOM near the top viewport and picks the first opaque, *most saturated*
  // background it finds. This catches dark heroes / sticky nav bars / colored
  // table headers (HN's #ff6600) that the page's <html>/<body> bg would
  // otherwise miss. The bias toward saturation lets a small colored band
  // beat a large neutral background.
  function colorSaturation(rgbString) {
    const c = parseColor(rgbString);
    if (!c) return -1;
    const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
    return (max - min) / 255;
  }
  function pageTint() {
    const samplePoints = [
      [40,  10], [Math.floor(innerWidth/2), 10], [innerWidth - 40, 10],
      [40,  24], [Math.floor(innerWidth/2), 24], [innerWidth - 40, 24],
      [40,  44], [Math.floor(innerWidth/2), 44], [innerWidth - 40, 44],
    ];
    let best = null, bestSat = -1;
    for (const [x, y] of samplePoints) {
      // elementsFromPoint returns the stack at this coordinate so we don't
      // just get the topmost interactive element. Walk it from the most-
      // ancestral to the most-specific and prefer saturated colors.
      const stack = (document.elementsFromPoint ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)]).filter(Boolean);
      for (const el of stack) {
        const bg = getComputedStyle(el).backgroundColor;
        if (!bg || bg === "transparent" || /rgba?\(.*?,\s*0\s*\)/.test(bg)) continue;
        const sat = colorSaturation(bg);
        // Always keep the first opaque hit as a baseline so we don't fall
        // through to neutral defaults. Replace it only if a more saturated
        // candidate appears (within a small absolute threshold).
        if (best === null || sat > bestSat + 0.05) {
          best = bg; bestSat = sat;
        }
      }
    }
    if (best) return best;
    return getComputedStyle(document.documentElement).backgroundColor
        || getComputedStyle(document.body).backgroundColor || "rgb(247,246,242)";
  }

  // Strip leading "www." for a cleaner read in the URL pill — matches Safari
  // and Arc. The full host is still in the tooltip via `title`.
  const rawHost = (P.host || location.host).replace(/</g, "&lt;");
  const host    = rawHost.replace(/^www\./i, "");
  const title   = (P.title || document.title || "").replace(/</g, "&lt;");
  const tint    = pageTint();
  const accent  = pageAccent(tint);

  const root = document.createElement("div");
  root.id = "__keel_chrome__";
  document.documentElement.appendChild(root);
  const shadow = root.attachShadow({ mode: "open" });

  // Reserve 40px at the top of the page for the chrome — Safari-desktop
  // style. The chrome is always visible, so the page content always sits
  // below it. We ADD 40px to whatever body padding-top already exists
  // (instead of overwriting it) so pages with their own layout padding
  // don't get squished. scroll-padding-top via CSS so #anchor links land
  // below the chrome — matches real Safari.
  const pagePushStyle = document.createElement("style");
  pagePushStyle.id = "__keel_pagepush__";
  const origPaddingTop = document.body
    ? (parseInt(getComputedStyle(document.body).paddingTop, 10) || 0)
    : 0;
  pagePushStyle.textContent = `
    html { scroll-padding-top: 40px !important; }
    body {
      padding-top: ${origPaddingTop + 40}px !important;
      transition: padding-top 220ms cubic-bezier(.16,.84,.20,1);
    }
  `;
  // Preserve scroll position: if the user has already scrolled when chrome
  // injects, the added 40px would push everything down and the viewport
  // would now show content that was previously off-screen. Capture and
  // restore scroll Y so the page visually doesn't jump.
  const scrollY = window.scrollY;
  document.head.appendChild(pagePushStyle);
  if (scrollY > 0) {
    requestAnimationFrame(() => window.scrollTo({ top: scrollY + 40, behavior: "instant" }));
  }

  const isLight = (() => {
    // crude luminance check
    const c = parseColor(tint) || { r: 247, g: 246, b: 242 };
    return (0.2126*c.r + 0.7152*c.g + 0.0722*c.b) > 160;
  })();

  // ---- styles --------------------------------------------------------------
  // v5: Safari-style top "chrome zone" — when summoned, a 46px translucent
  // strip with backdrop blur sits above the page, containing all pills as a
  // single coherent bar. In hidden state, only a 2-px peek line remains.
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    /* Defensive box-sizing inside the shadow root — prevents page CSS
       that resets body { box-sizing: content-box } from interfering. */
    * { box-sizing: border-box; }

    /* The chrome zone — translucent strip at top, blurred so it visually
       contains the page content beneath. Pills float inside. */
    .ribbon {
      position: fixed; top: 0; left: 0; right: 0;
      height: 40px;
      z-index: 2147483647;
      display: flex; align-items: center;
      padding: 0 16px;
      gap: 3px;
      font: 13px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      pointer-events: none;
      transform: translateY(-100%) scale(0.985);
      transform-origin: 50% 0;
      opacity: 0;
      /* GPU-accelerate the transform + opacity. Apple does this for menu
         bars to keep them buttery smooth even on lower-end hardware. */
      will-change: transform, opacity;
      /* Exit (hidden state): faster, just retreat. Entrance overrides
         these in the :host([data-state="visible"]) rule below to spring
         in more deliberately — Apple uses asymmetric in/out timing on
         menu bars and tab pills. */
      transition: transform 160ms cubic-bezier(.5,0,.85,.4), opacity 140ms ease-in;
      /* The scrim base is light/dark neutral; the per-tab accent shows
         through as a very subtle (~8%) tint via a second layer. Matches
         Safari's "Show color in tab bar" — chrome quietly carries the
         page's brand color without becoming garish. */
      background:
        ${isLight
          ? 'linear-gradient(180deg, rgba(245,246,248,0.88) 0%, rgba(245,246,248,0.82) 78%, rgba(245,246,248,0) 100%),'
          : 'linear-gradient(180deg, rgba(22,23,26,0.82) 0%, rgba(22,23,26,0.74) 78%, rgba(22,23,26,0) 100%),'}
        linear-gradient(180deg, ${accent}${isLight ? '18' : '24'} 0%, ${accent}${isLight ? '10' : '18'} 60%, transparent 100%);
      backdrop-filter: blur(26px) saturate(180%);
      -webkit-backdrop-filter: blur(26px) saturate(180%);
      /* Soft drop-shadow under the scrim so the chrome reads as "floating
         above the page" rather than painted on top. Falls off quickly.
         Plus a 0.5px top highlight for a glass-like reflection. */
      box-shadow:
        inset 0 0.5px 0 0 ${isLight ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.06)'},
        0 8px 20px -10px ${isLight ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.55)'};
      border-bottom: 0.5px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)'};
    }
    .ribbon > * { pointer-events: auto; }
    /* Tint accent — a thin colored under-line that scrolls with the chrome.
       This is the ONLY per-tab tint indicator; the URL pill no longer
       carries its own inset to avoid double-marking the accent. A 6px
       soft glow above it (box-shadow) softens the transition into the
       page so the line doesn't read as a hard edge cut. */
    .ribbon::after {
      content: ""; position: absolute; left: 0; right: 0; bottom: 0;
      height: 1.5px;
      background: linear-gradient(90deg, transparent 0%, ${accent}a0 25%, ${accent}a0 75%, transparent 100%);
      opacity: 0.92;
      pointer-events: none;
      box-shadow: 0 -6px 12px -2px ${accent}3a;
    }

    /* Steady-state hairline — present even when ribbon is hidden so the user
       has a discoverable handle. Picks up the per-tab accent at low
       opacity, so the always-visible state quietly carries tab identity. */
    .peek {
      position: fixed; top: 0; left: 0; right: 0; height: 2px;
      pointer-events: none;
      z-index: 2147483646;
      background:
        linear-gradient(90deg, transparent 0%, ${accent}38 50%, transparent 100%),
        linear-gradient(180deg,
          ${isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)'} 0%,
          transparent 100%);
      transition: opacity 220ms;
    }
    :host([data-state="visible"]) .peek { opacity: 0; }

    /* Traffic lights — standalone, no pill */
    .traffic {
      display: flex; gap: 7px; align-items: center;
      padding: 0 10px 0 2px;
    }
    .traffic .dot {
      width: 11px; height: 11px; border-radius: 50%;
      background: ${isLight ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.18)'};
      /* macOS-style inner shadow: 0.5px highlight at top, 0.5px shadow
         at bottom. Gives the dots a faint dimensionality that reads
         like a real traffic light pip rather than a flat disc. */
      box-shadow:
        inset 0 0.5px 0 ${isLight ? 'rgba(255,255,255,0.30)' : 'rgba(255,255,255,0.10)'},
        inset 0 -0.5px 0 ${isLight ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.25)'};
      transition: background 120ms;
    }
    /* Traffic lights only color when the traffic *group* is hovered.
       Previously hovering anywhere in the ribbon lit them up which
       wasn't quite macOS-like — Safari/Finder only paint them when the
       cursor is near the actual close/min/max region. */
    .traffic:hover .dot:nth-child(1) { background: #ED6B5F; }
    .traffic:hover .dot:nth-child(2) { background: #F5BD4F; }
    .traffic:hover .dot:nth-child(3) { background: #62C554; }
    /* But still light them up subtly when ribbon is hovered as a whole,
       so the chrome looks "live" rather than greyed-out at rest. */
    .ribbon:hover .traffic .dot {
      background: ${isLight ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.28)'};
    }
    .traffic:hover .dot {
      transition: background 80ms ease;
    }

    /* Naked icon — no pill background, just hoverable. Safari-style.
       Slightly more muted than v15 (0.72->0.62) to match Safari's neutral
       graphite icons rather than its sharp button icons. */
    .icon {
      width: 28px; height: 28px;
      border: none; background: transparent;
      color: ${isLight ? '#1d1d1f' : '#e9ebef'};
      border-radius: 7px;
      font-size: 14px;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer;
      opacity: 0.62;
      transition: background 120ms ease, opacity 120ms ease;
    }
    /* Icon hover: mostly neutral fill with a faint tint of the per-tab
       accent layered in (~12%), so hovering an icon visually links it
       to the chrome's identity color without becoming garish. */
    .icon:hover {
      opacity: 1;
      background:
        linear-gradient(${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.09)'}, ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.09)'}),
        linear-gradient(${accent}1f, ${accent}1f);
    }
    /* SVG inside icon grows subtly on hover for tactile feedback —
       mirrors macOS Dock-style icon-bounce, scaled way down. */
    .icon svg { transition: transform 140ms cubic-bezier(.16,.84,.20,1); }
    .icon:hover svg { transform: scale(1.08); }
    .icon:active svg { transform: scale(0.92); }
    /* Share icon gets a tiny upward lift on hover, mirroring its
       "send up and out" affordance. */
    .icon[title="Share"]:hover svg { transform: scale(1.08) translateY(-1px); }
    /* Tab overview gets a tiny rotation, suggesting "shuffle/see all". */
    .icon[title="Tab overview"]:hover svg { transform: scale(1.08) rotate(-6deg); }
    /* Reload (if present) does a quarter-turn loop on hover. */
    .icon[title="Reload"]:hover svg { transform: scale(1.08) rotate(45deg); }
    .icon:focus-visible {
      opacity: 1;
      outline: none;
      box-shadow: 0 0 0 0.5px ${isLight ? '#fff' : '#000'},
                  0 0 0 2.5px ${accent}aa;
    }
    .icon:active {
      background:
        linear-gradient(${isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.14)'}, ${isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.14)'}),
        linear-gradient(${accent}33, ${accent}33);
      transform: scale(0.95);
      transition-duration: 50ms;
    }
    .icon-group { display: inline-flex; align-items: center; gap: 2px; }

    /* URL pill — the only pill. Geometrically centered in the viewport via
       position: absolute (not flex), since the icon groups on either side
       are asymmetric (more icons left). Matches Safari's URL bar layout.
       Border radius 9px matches macOS Safari's URL field. Dark mode: pill
       is *darker* than scrim, like Safari's recessed well effect. */
    .url-pill {
      position: absolute;
      left: 50%; top: 50%;
      transform: translate(-50%, -50%);
      display: inline-flex; align-items: center; gap: 8px;
      height: 27px; min-width: 280px; max-width: 520px;
      padding: 0 14px 0 10px;
      border-radius: 9px;
      overflow: hidden; /* contain the loading shimmer pseudo-element */
      /* Subtle internal gradient — slightly darker bottom for depth so the
         pill doesn't read as a perfectly flat fill. Mirrors Safari's URL
         field which has a faint vertical gradient. Layered over a very
         faint (~6%) page accent tint so the pill quietly carries page
         identity without overwhelming the host text. */
      background:
        ${isLight
          ? 'linear-gradient(180deg, rgba(255,255,255,0.66) 0%, rgba(255,255,255,0.58) 100%),'
          : 'linear-gradient(180deg, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0.26) 100%),'}
        ${accent}18;
      color: ${isLight ? '#1d1d1f' : '#f4f5f7'};
      box-shadow:
        /* hairline border */
        inset 0 0 0 0.5px ${isLight ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.04)'},
        /* top reflection */
        inset 0 0.5px 0 0 ${isLight ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.06)'},
        /* recessed well bottom shadow (dark mode only) */
        ${isLight ? '' : 'inset 0 -0.5px 0 0 rgba(0,0,0,0.20),'}
        /* outer soft halo to seat the pill in the scrim */
        0 1px 2px -0.5px ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.30)'};
      transition: background 140ms ease, box-shadow 140ms ease,
                  min-width 220ms cubic-bezier(.16,.84,.20,1);
    }
    .url-pill:hover,
    .url-pill:focus-visible {
      /* Bumps min-width on hover/focus to subtly hint at edit-on-click —
         Safari grows the URL bar slightly when focused. */
      min-width: 360px;
      background:
        ${isLight
          ? 'linear-gradient(180deg, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.78) 100%)'
          : 'linear-gradient(180deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.34) 100%)'};
      box-shadow:
        inset 0 0 0 0.5px ${accent}70,
        inset 0 0.5px 0 0 ${isLight ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.10)'},
        0 2px 10px -4px ${accent}33;
    }
    .url-pill:active {
      transform: translate(-50%, -50%) scale(0.99);
      transition-duration: 80ms;
    }
    /* Keyboard focus ring — visible only when reached via Tab/Cmd-L, not
       on mouse focus. Matches Safari's accessibility: 2px accent ring with
       a 0.5px inset white separator. */
    .url-pill:focus-visible {
      outline: none;
      box-shadow:
        inset 0 0 0 0.5px ${isLight ? 'rgba(0,0,0,0.13)' : 'rgba(255,255,255,0.10)'},
        inset 0 0.5px 0 0 ${isLight ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.10)'},
        0 0 0 0.5px ${isLight ? '#fff' : '#000'},
        0 0 0 2.5px ${accent}aa;
    }
    .url-pill .text {
      flex: 1 1 auto;
      text-align: center;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-size: 13px;
      font-weight: 500;
      letter-spacing: -0.005em;
      line-height: 15px;
      /* Tabular numerals so URLs with digits (ports, IPs, dates) align
         vertically when they change — no jitter as you navigate.
         Plus contextual alternates: lets the font pick better-shaped
         glyph variants for sequences like "ll" or "tt" in URLs.
         text-rendering hints the browser to prioritize legibility
         (kerning, ligatures) over render speed at this small size. */
      font-variant-numeric: tabular-nums;
      font-feature-settings: "calt" 1, "ss01" 1;
      text-rendering: optimizeLegibility;
      /* Soft fade at the edges so truncated URLs trail off rather than
         hitting a hard ellipsis. The mask reveals 100% of the text
         except a 6px fade zone on each side. */
      -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 6px, #000 calc(100% - 6px), transparent 100%);
      mask-image: linear-gradient(90deg, transparent 0, #000 6px, #000 calc(100% - 6px), transparent 100%);
      /* Subtle fade-in: URL text appears 80ms after the chrome arrives,
         creating a tiny layered presentation rather than everything
         showing simultaneously. */
      opacity: 0;
      transition: opacity 180ms ease-out;
      /* Offset text slightly left to optically center against the
         favicon's left-of-center weight. Removed when Aa badge is
         present (already provides right-side weight). */
      padding-right: 15px;
      /* Tiny text-shadow softens edges against the translucent glass and
         improves legibility when the scrim is busy (gradient sites). */
      text-shadow: ${isLight
        ? '0 1px 0 rgba(255,255,255,0.4)'
        : '0 1px 0 rgba(0,0,0,0.25)'};
    }
    .url-pill .lock { opacity: 0.42; flex: 0 0 auto; }
    /* When Reader badge is present, drop the text padding-right since the
       badge itself provides right-side visual weight, and grow the pill
       slightly to compensate for the badge taking horizontal space. */
    .url-pill:has(.reader-badge) .text { padding-right: 0; }
    .url-pill:has(.reader-badge) { min-width: 320px; max-width: 560px; }
    /* Loading state: shimmering accent border slides across the bottom of
       the URL pill while the page is still loading. */
    @keyframes url-loading-shimmer {
      0%   { background-position: 0% 0; }
      100% { background-position: 200% 0; }
    }
    .url-pill.loading::before {
      content: ""; position: absolute; left: 0; right: 0; bottom: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent 0%, ${accent}cc 50%, transparent 100%);
      background-size: 50% 100%;
      background-repeat: no-repeat;
      animation: url-loading-shimmer 1.2s linear infinite;
      pointer-events: none;
      border-bottom-left-radius: 9px;
      border-bottom-right-radius: 9px;
    }
    /* Hovering the favicon area gives it a tiny lift — feedback that it's
       interactive (will reveal site info / certificate). */
    .url-pill .favicon-holder:hover .favicon {
      transform: scale(1.08);
    }
    /* When URL pill is being pressed/clicked, the favicon briefly scales
       down — tactile press feedback like macOS Dock icon bounce. */
    .url-pill:active .favicon {
      transform: scale(0.92);
      transition-duration: 80ms;
    }
    /* Fixed-size holder so layout never jiggles when the favicon swaps in
       over the lock placeholder. */
    .url-pill .favicon-holder {
      position: relative;
      width: 15px; height: 15px;
      flex: 0 0 auto;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .url-pill .favicon-holder .lock {
      transition: opacity 160ms ease;
    }
    /* Initial favicon appearance: a tiny shimmer (scale 0.85 -> 1.0)
       to signal the chrome has loaded and identified the page. Only
       fires on initial inject. */
    @keyframes favicon-arrive {
      from { transform: scale(0.85); opacity: 0; }
      to   { transform: scale(1);    opacity: 1; }
    }
    .url-pill .favicon {
      width: 15px; height: 15px;
      object-fit: contain;
      border-radius: 4px;
      transition: opacity 160ms ease, transform 120ms ease;
      animation: favicon-arrive 320ms cubic-bezier(.16,.84,.20,1) backwards;
      animation-delay: 160ms;
      /* Hairline halo + 1px soft drop shadow: gives the favicon a faint
         "app icon" depth (Arc browser does this very subtly). Halo also
         protects dark-on-dark favicons (linear's circle, pitchfork's dot)
         against the recessed dark well. Stroke matches the chrome's
         border hairline vocabulary so the favicon reads as a chrome
         element rather than an embedded image. On dark mode, the halo
         picks up a hint of the per-tab accent so it carries identity. */
      filter: ${isLight
        ? 'drop-shadow(0 0.5px 1px rgba(0,0,0,0.10))'
        : `drop-shadow(0 0 0.5px ${accent}66) drop-shadow(0 0.5px 1px rgba(0,0,0,0.30))`};
      box-shadow: 0 0 0 0.5px ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)'};
    }
    .url-pill .right-icons { display: flex; align-items: center; gap: 0; margin-right: -6px; }
    .url-pill .right-icons .icon { width: 22px; height: 22px; font-size: 11px; opacity: 0.55; border-radius: 6px; }
    /* Safari-style Reader Mode badge — only appears for article-shaped pages.
       Hairline border + subtle accent text-color so the badge reads as
       a distinct interactive affordance rather than a passive label. */
    .url-pill .reader-badge {
      flex: 0 0 auto;
      margin-right: -4px;
      width: 20px; height: 16px;
      background: ${isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)'};
      color: ${isLight ? '#1d1d1f' : '#e9ebef'};
      border: 0.5px solid ${isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)'};
      border-radius: 4px;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif;
      font-weight: 600;
      font-size: 10px;
      cursor: pointer;
      opacity: 0.75;
      transition: opacity 120ms ease, background 120ms ease, border-color 120ms ease, color 120ms ease;
      display: inline-flex; align-items: center; justify-content: center;
      letter-spacing: -0.02em;
      box-sizing: border-box;
      /* Match URL host text-shadow so the badge feels typographically
         consistent with the host name beside it. */
      text-shadow: ${isLight
        ? '0 1px 0 rgba(255,255,255,0.4)'
        : '0 1px 0 rgba(0,0,0,0.25)'};
    }
    .url-pill .reader-badge:hover {
      opacity: 1;
      background: ${accent}22;
      color: ${accent};
      border-color: ${accent}66;
    }

    .spacer { flex: 1 1 auto; }

    /* Wide viewports (>1600px): widen the URL pill cap a bit so longer
       URLs (article slugs, long subdomains) don't truncate prematurely
       on big desktop displays where there's plenty of horizontal room. */
    @media (min-width: 1600px) {
      .url-pill { max-width: 620px; }
    }

    /* Narrow viewports: shrink URL pill so traffic lights + icon groups
       still have breathing room. Below 600px, ditch the traffic lights
       too — Safari does the same in compact / mobile layouts. */
    @media (max-width: 1000px) {
      .url-pill { min-width: 220px; max-width: 360px; }
    }
    @media (max-width: 700px) {
      .url-pill { min-width: 180px; max-width: 280px; }
      .url-pill .text { font-size: 12px; line-height: 14px; }
      .ribbon { padding: 0 10px; }
    }
    @media (max-width: 600px) {
      .traffic { display: none; }
    }
    /* Ultra-narrow (smartphone-like): hide back/forward + share icons too,
       leaving sidebar + URL pill + tab overview as the minimal chrome. */
    @media (max-width: 480px) {
      .icon[title="Back"], .icon[title="Forward"], .icon[title="Share"] {
        display: none;
      }
      .url-pill { min-width: 140px; max-width: 240px; }
    }

    :host([data-state="visible"]) .ribbon {
      transform: translateY(0) scale(1);
      opacity: 1;
      /* Entrance: spring-like. 220ms feels noticeably snappier than the
         previous 260ms — chrome arrives immediately on summon, lands
         with the same gentle settle. */
      transition: transform 220ms cubic-bezier(.16,.84,.20,1), opacity 160ms ease-out;
    }
    :host([data-state="visible"]) .url-pill .text {
      opacity: 1;
      transition-delay: 80ms;
    }
    /* Stronger drop shadow when the user has scrolled — cues that there's
       content above the chrome's band. Matches Safari's behavior on
       scrolled pages. */
    :host([data-scrolled="1"]) .ribbon {
      box-shadow:
        inset 0 0.5px 0 0 ${isLight ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.06)'},
        0 12px 28px -12px ${isLight ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.65)'};
      transition: box-shadow 220ms ease;
    }
    /* Unfocused window: chrome subtly dims, traffic lights desaturate.
       Matches macOS native chrome behavior. */
    :host([data-unfocused="1"]) .ribbon { opacity: 0.85; }
    :host([data-unfocused="1"]) .url-pill { filter: saturate(0.6); }
    :host([data-unfocused="1"]) .icon { opacity: 0.45; }

    /* Accessibility: honour prefers-reduced-motion. Replace the slide+scale
       with a simple opacity fade so the chrome still appears/disappears
       but without animated movement that could trigger vestibular issues. */
    @media (prefers-reduced-motion: reduce) {
      .ribbon {
        transform: none !important;
        transition: opacity 120ms ease !important;
      }
      :host([data-state="visible"]) .ribbon { transform: none !important; }
    }

    /* Don't print the chrome — useful for sites users save as PDF. */
    @media print {
      .ribbon, .peek { display: none !important; }
    }
  `;
  shadow.appendChild(style);

  // ---- DOM helper ----------------------------------------------------------
  function el(tag, attrs, kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") e.className = v;
      else if (k === "title") e.title = v;
      else e.setAttribute(k, v);
    }
    for (const k of (kids || [])) {
      if (typeof k === "string") e.appendChild(document.createTextNode(k));
      else e.appendChild(k);
    }
    return e;
  }

  // ---- icon set (SVG, 16×16 viewBox, 1.5px stroke, rounded caps) -----------
  // Crisp on all OSes and trivially restyleable via currentColor.
  // SF-Symbols-like icons. Each entry is a list of {tag, attrs} children to
  // append to an <svg>. Built with createElementNS (no innerHTML/DOMParser)
  // so we don't trip Trusted Types on sites like youtube.com.
  // Unified stroke width 1.5px across all icons for visual consistency.
  // Previously chevrons used 1.4 and the rest 1.25, which made the back/
  // forward arrows feel heavier than the surrounding icons.
  const STROKE = { stroke: "currentColor", "stroke-width": "1.5",
                   "stroke-linecap": "round", "stroke-linejoin": "round",
                   fill: "none" };
  const STROKE_JOIN = STROKE;
  const STROKE_THICK = STROKE;
  const ICONS = {
    sidebar: [["path", Object.assign({ d: "M3 4.5h10M3 8h10M3 11.5h10" }, STROKE)]],
    back:    [["path", Object.assign({ d: "M10 4l-4 4 4 4" }, STROKE_THICK)]],
    forward: [["path", Object.assign({ d: "M6 4l4 4-4 4" }, STROKE_THICK)]],
    reload:  [
      ["path", Object.assign({ d: "M3.5 8a4.5 4.5 0 1 1 1.3 3.15" }, STROKE)],
      ["path", Object.assign({ d: "M3.2 4v3h3" }, STROKE_JOIN)],
    ],
    share: [
      ["path", Object.assign({ d: "M8 2.5v8M5 5.5l3-3 3 3" }, STROKE_JOIN)],
      ["path", Object.assign({ d: "M4 8.5v4a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-4" }, STROKE)],
    ],
    plus: [["path", Object.assign({ d: "M8 3.5v9M3.5 8h9" }, STROKE)]],
    grid: [
      ["rect", { x: "3", y: "3", width: "4", height: "4", rx: "0.8", stroke: "currentColor", "stroke-width": "1.1", fill: "none" }],
      ["rect", { x: "9", y: "3", width: "4", height: "4", rx: "0.8", stroke: "currentColor", "stroke-width": "1.1", fill: "none" }],
      ["rect", { x: "3", y: "9", width: "4", height: "4", rx: "0.8", stroke: "currentColor", "stroke-width": "1.1", fill: "none" }],
      ["rect", { x: "9", y: "9", width: "4", height: "4", rx: "0.8", stroke: "currentColor", "stroke-width": "1.1", fill: "none" }],
    ],
    lock: [["path", {
      d: "M3 6V4a3 3 0 1 1 6 0v2h.5A1.5 1.5 0 0 1 11 7.5v4A1.5 1.5 0 0 1 9.5 13h-7A1.5 1.5 0 0 1 1 11.5v-4A1.5 1.5 0 0 1 2.5 6H3zm1 0h4V4a2 2 0 1 0-4 0v2z",
      fill: "currentColor",
    }]],
  };
  function svgIcon(name, opts) {
    opts = opts || {};
    const NS = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", name === "lock" ? "0 0 12 14" : "0 0 16 16");
    s.setAttribute("width",  String(opts.size || 16));
    s.setAttribute("height", String(opts.size || 16));
    s.setAttribute("aria-hidden", "true");
    if (opts.cls) s.setAttribute("class", opts.cls);
    for (const [tag, attrs] of ICONS[name]) {
      const child = document.createElementNS(NS, tag);
      for (const k in attrs) child.setAttribute(k, attrs[k]);
      s.appendChild(child);
    }
    return s;
  }
  function iconBtn(name, title, opts) {
    const b = el("button", {
      class: "icon", title: title,
      type: "button",
      "aria-label": title,
    }, []);
    b.appendChild(svgIcon(name, opts));
    return b;
  }

  // ---- ribbon --------------------------------------------------------------
  const traffic = el("div", { class: "traffic", role: "group", "aria-label": "Window controls" }, [
    el("div", { class: "dot", title: "Close" }),
    el("div", { class: "dot", title: "Minimize" }),
    el("div", { class: "dot", title: "Zoom" }),
  ]);

  const leftIcons = el("div", { class: "icon-group" }, [
    iconBtn("sidebar", "Sidebar"),
    iconBtn("back",    "Back"),
    iconBtn("forward", "Forward"),
  ]);

  // Find a favicon URL from the page's link tags. Apple-touch-icon or 32×32
  // takes precedence; fall back to /favicon.ico. If none load, the URL pill
  // shows the lock SVG instead.
  function findFaviconHref() {
    const links = [...document.querySelectorAll('link[rel*="icon"]')];
    const score = l => {
      const rel = (l.getAttribute("rel") || "").toLowerCase();
      const sizes = (l.getAttribute("sizes") || "").toLowerCase();
      const type = (l.getAttribute("type") || "").toLowerCase();
      const href = (l.getAttribute("href") || "").toLowerCase();
      let s = 0;
      // SVG favicons scale crisply at 15x15 — prefer over raster when offered.
      if (type === "image/svg+xml" || href.endsWith(".svg")) s += 8;
      if (rel.includes("apple-touch-icon")) s += 5;
      if (rel === "icon") s += 1;
      if (sizes.includes("32")) s += 3;
      if (sizes.includes("64") || sizes.includes("96") || sizes.includes("128")) s += 4;
      if (sizes.includes("192") || sizes.includes("256")) s += 2;
      return s;
    };
    links.sort((a, b) => score(b) - score(a));
    if (links[0]) {
      const href = links[0].getAttribute("href");
      if (href) return new URL(href, location.href).toString();
    }
    return location.origin + "/favicon.ico";
  }

  // Start with the lock SVG visible immediately, then crossfade to the
  // favicon when it's loaded successfully. Avoids the brief broken-image
  // placeholder flash that some browsers show during image fetch.
  const faviconHolder = document.createElement("span");
  faviconHolder.className = "favicon-holder";
  faviconHolder.title = location.protocol === "https:"
    ? `Connection is secure (${host})`
    : `Connection is not secure (${host})`;
  const lockGlyph = svgIcon("lock", { cls: "lock", size: 11 });
  faviconHolder.appendChild(lockGlyph);

  const faviconImg = document.createElement("img");
  faviconImg.className = "favicon";
  faviconImg.alt = "";
  faviconImg.referrerPolicy = "no-referrer";
  faviconImg.style.opacity = "0";
  faviconImg.style.position = "absolute";
  faviconImg.style.inset = "0";
  faviconImg.addEventListener("load", () => {
    // Sanity check: refuse to swap to favicon if it's a 1x1 transparent
    // placeholder (some sites return this when no favicon is configured).
    if (faviconImg.naturalWidth <= 1 || faviconImg.naturalHeight <= 1) {
      // Treat as failure — keep the lock visible.
      faviconImg.src = "";
      return;
    }
    faviconImg.style.opacity = "1";
    // The favicon now occupies the holder; hide the lock.
    lockGlyph.style.opacity = "0";
  });
  // On error, leave lock visible and never show the img.
  faviconImg.addEventListener("error", () => {
    // Lock SVG stays at opacity 1 since we never lowered it.
    faviconImg.style.display = "none";
  });
  faviconImg.src = findFaviconHref();
  faviconHolder.appendChild(faviconImg);

  // Detect if the page is "article-shaped" — significant article/main
  // element, multiple paragraphs, headings. If so, the URL pill shows a
  // Safari-style "Aa" Reader Mode badge.
  // Returns true only when the page is clearly an article (not a docs
  // landing page or a marketing page with paragraphs in the hero).
  function isArticleShaped() {
    // Require at least one of the strong signals to be present.
    const article = document.querySelector("article");
    const main = document.querySelector("main, [role=main]");
    const container = article || main;
    if (!container) return false;
    const ps = container.querySelectorAll("p");
    if (ps.length < 8) return false;
    // Count "long" paragraphs (>150 chars). Articles have many; marketing
    // copy with stylized paragraphs rarely crosses 150 chars per <p>.
    let longPs = 0, totalLen = 0;
    for (const p of ps) {
      const len = p.textContent.trim().length;
      totalLen += len;
      if (len > 150) longPs++;
    }
    // At least 5 long-form (>150 char) paragraphs AND average paragraph
    // length > 160. Pitch's marketing fails this — paragraphs are bigger
    // headings/CTAs, not flowing prose. Articles satisfy both.
    return longPs >= 5 && totalLen / ps.length > 160;
  }

  // URL pill: [favicon] [host] with optional [Aa Reader badge] on the right.
  // Reload is Cmd/Ctrl-R from the keyboard (already wired in patches/0004),
  // matching real Safari.
  const urlPill = el("div", { class: "url-pill", title: title, tabindex: "0", role: "textbox", "aria-label": "Address bar" }, [
    el("span", { class: "text" }, [host]),
  ]);
  urlPill.insertBefore(faviconHolder, urlPill.firstChild);

  if (isArticleShaped()) {
    const readerBadge = el("button", {
      class: "reader-badge",
      title: "Show Reader",
      "aria-label": "Show Reader",
    }, ["Aa"]);
    urlPill.appendChild(readerBadge);
  }

  // Loading state: if the page hasn't fully loaded yet, show a subtle
  // shimmering border on the URL pill. Clears on window.load.
  if (document.readyState !== "complete") {
    urlPill.classList.add("loading");
    const clearLoad = () => urlPill.classList.remove("loading");
    window.addEventListener("load", clearLoad, { once: true });
    // Fallback: if 'load' never fires (some SPAs), clear after 8s.
    setTimeout(clearLoad, 8000);
  }

  // Right side: just share + tab overview. New-tab moves to Ctrl/Cmd-T —
  // having three icons here always collides with site CTAs (Sign up, Try X,
  // Donate). Two icons leaves more breathing room.
  const rightIcons = el("div", { class: "icon-group" }, [
    iconBtn("share", "Share"),
    iconBtn("grid",  "Tab overview"),
  ]);

  // URL pill is position: absolute (centered), so flex order doesn't matter
  // for it. Left & right icon groups flank it via flex layout.
  const ribbon = el("div", { class: "ribbon" }, [
    traffic,
    leftIcons,
    el("div", { class: "spacer" }),
    rightIcons,
    urlPill, // last, but absolute-positioned so visually centered
  ]);

  const peek = el("div", { class: "peek" });
  shadow.appendChild(peek);
  shadow.appendChild(ribbon);

  // Visible by default (Safari desktop behavior). The reserved 40px band
  // is always shown with the chrome filling it. F11 / fullscreen mode
  // would hide the chrome temporarily; auto-hide on cursor leave is no
  // longer the default.
  const hostEl = shadow.host;
  hostEl.dataset.state = "visible";

  // The chrome stays visible by default — Safari-like permanent presence.
  // show() is kept for keyboard-summon shortcuts so the chrome can be
  // re-shown if it ever gets temporarily hidden (e.g., fullscreen toggle).
  const show = () => { hostEl.dataset.state = "visible"; };

  // Keyboard shortcuts still work — F6/Cmd+L focus the URL pill, but
  // since the chrome stays visible permanently, there's no need to
  // summon it first. Just ensure it's visible if anything ever hid it.
  document.addEventListener("keydown", e => {
    if (e.key === "F6" || (e.ctrlKey && (e.key === "l" || e.key === "L")) ||
        (e.ctrlKey && (e.key === "t" || e.key === "T"))) {
      show();
    }
  }, { passive: true });

  // Scroll-aware shadow: when the user has scrolled down, mark the
  // host so the chrome can carry a slightly stronger drop shadow,
  // indicating that there's content above the chrome boundary. Subtle
  // but a nice "depth" cue that Safari uses too.
  let lastScrolled = false;
  function syncScrolled() {
    const scrolled = window.scrollY > 4;
    if (scrolled !== lastScrolled) {
      hostEl.dataset.scrolled = scrolled ? "1" : "0";
      lastScrolled = scrolled;
    }
  }
  syncScrolled();
  window.addEventListener("scroll", syncScrolled, { passive: true });

  // Window-focus aware dimming: when the window loses focus, the chrome
  // subtly dims — mirrors macOS native window chrome behavior where the
  // active window's chrome is more saturated than inactive ones.
  function syncFocus() {
    hostEl.dataset.unfocused = document.hasFocus() ? "0" : "1";
  }
  syncFocus();
  window.addEventListener("focus", syncFocus, { passive: true });
  window.addEventListener("blur", syncFocus, { passive: true });
})();
