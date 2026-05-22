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
// The ribbon is a 40-px translucent scrim with backdrop-filter blur(28)
// saturate(200%), a per-tab accent gradient layer (~9-14% opacity), a
// hairline border-bottom, a 1.5px accent stripe with a soft upward
// glow, and a layered drop shadow (close-in + extended) under the
// scrim for elevated-above-the-page depth.
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
// Browser fullscreen (Cmd-Ctrl-F) makes the chrome retreat off-screen
// via a :host-context(:fullscreen) rule; the page gets the full
// viewport. Exiting fullscreen brings the chrome back automatically.
//
// A11y: prefers-reduced-motion disables all geometric motion — chrome
// entrance translate, favicon-arrive scale, hover/active SVG scale +
// rotate + translate transforms, and the loading shimmer's background-
// position cycle. Opacity / background-color transitions still apply,
// so the chrome remains visually responsive without animating motion.
// The URL pill is tabbable (role=textbox), icons have aria-labels +
// keyboard focus rings (2.5px accent ring at 80% alpha). Print media
// hides the chrome entirely.
//
// Interaction rhythm: hover affordances throughout follow a "snappy in,
// graceful out" timing — cursor entry wakes the element in ~90-140ms,
// cursor leave settles back over ~180-220ms with a spring curve. Press
// (active) states snap in under 80ms for tactile feedback. Smaller
// elements (traffic dots) use tighter timings (~80/120ms) than larger
// ones (URL pill: 140/220ms) so all motion feels proportional to scale.

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
    // Emit hex (#rrggbb) — many template literals append an alpha byte to
    // the accent (e.g. `${accent}18` for ~9% alpha), which requires a hex
    // base. Returning `rgb(...)` here would silently produce invalid CSS
    // like `rgb(...)18` and the per-tab tint would not paint.
    const h2 = (n) => Math.round(n*255).toString(16).padStart(2, "0");
    return "#" + h2(r) + h2(g) + h2(b);
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
  function pageAccent(tintColor, prefersDark) {
    // 1) Honour meta[name="theme-color"] if it's actually a color.
    //    Sites often ship two variants: <meta name="theme-color"
    //    media="(prefers-color-scheme: dark)"> and a default one for
    //    light. We pick the variant that matches the chrome's actual
    //    paint mode (derived from page-top luminance) so the accent
    //    matches the visual context, not just whatever was declared
    //    first.
    const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
    const chosen = prefersDark
      ? (metas.find(m => /dark/.test(m.getAttribute("media") || "")) || metas[0])
      : (metas.find(m => !/dark/.test(m.getAttribute("media") || "")) || metas[0]);
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
  // Compute the chrome's light/dark mode from the sampled tint first
  // so theme-color selection can match the visual context.
  const isLightForAccent = (() => {
    const c = parseColor(tint) || { r: 247, g: 246, b: 242 };
    return (0.2126*c.r + 0.7152*c.g + 0.0722*c.b) > 160;
  })();
  const accent  = pageAccent(tint, !isLightForAccent);

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
  // Defensive: if a page has no <head> (rare, possible for some early
  // injection points), create one. Otherwise the appendChild would throw.
  if (!document.head) {
    const h = document.createElement("head");
    document.documentElement.insertBefore(h, document.documentElement.firstChild);
  }
  document.head.appendChild(pagePushStyle);

  // Print-mode: clear the body padding-top added by the chrome's
  // reserved band, so printed/saved-as-PDF pages don't have a 40px gap
  // at the top where the chrome would have been. Same for browser
  // fullscreen — the chrome retreats off-screen via :host-context
  // (:fullscreen), so the page should reclaim that 40px band rather
  // than leave an empty gap at the viewport top.
  const pagePrintStyle = document.createElement("style");
  pagePrintStyle.id = "__keel_pageprint__";
  pagePrintStyle.textContent = `
    @media print {
      body { padding-top: ${origPaddingTop}px !important; }
    }
    :fullscreen body, :-webkit-full-screen body {
      padding-top: ${origPaddingTop}px !important;
    }
  `;
  document.head.appendChild(pagePrintStyle);
  if (scrollY > 0) {
    requestAnimationFrame(() => window.scrollTo({ top: scrollY + 40, behavior: "instant" }));
  }

  // Already computed above as isLightForAccent so theme-color selection
  // could match the chrome's actual paint mode.
  const isLight = isLightForAccent;

  // ---- styles --------------------------------------------------------------
  // 40-px translucent ribbon at the top of the viewport, always visible
  // (Safari-desktop layout). The .peek hairline is kept for the rare
  // hidden state (e.g. browser fullscreen, where the chrome retreats).
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
      font: 13px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "Inter", system-ui, sans-serif;
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
          ? 'radial-gradient(ellipse 320px 50px at 50% 60%, rgba(255,255,255,0.20), transparent 60%),'
          : 'radial-gradient(ellipse 320px 50px at 50% 60%, rgba(255,255,255,0.12), transparent 60%),'}
        ${isLight
          ? 'linear-gradient(180deg, rgba(245,246,248,0.88) 0%, rgba(245,246,248,0.82) 78%, rgba(245,246,248,0) 100%),'
          : 'linear-gradient(180deg, rgba(22,23,26,0.85) 0%, rgba(22,23,26,0.78) 78%, rgba(22,23,26,0) 100%),'}
        linear-gradient(180deg, ${accent}${isLight ? '18' : '24'} 0%, ${accent}${isLight ? '10' : '18'} 60%, transparent 100%);
      backdrop-filter: blur(28px) saturate(200%);
      -webkit-backdrop-filter: blur(28px) saturate(200%);
      /* Soft drop-shadow under the scrim so the chrome reads as "floating
         above the page" rather than painted on top. Two layers for more
         realistic depth: a close-in 2px shadow that defines the immediate
         edge, plus a wider 20px shadow that fades into the page. Apple's
         elevation system uses this same close+wide pairing.
         Plus a 0.5px top highlight for a glass-like reflection. */
      box-shadow:
        inset 0 0.5px 0 0 ${isLight ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.06)'},
        0 2px 4px -2px ${isLight ? 'rgba(0,0,0,0.10)' : 'rgba(0,0,0,0.30)'},
        0 8px 20px -10px ${isLight ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.45)'};
      border-bottom: 0.5px solid ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)'};
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
      background: linear-gradient(90deg, transparent 0%, ${accent}a0 18%, ${accent}b8 50%, ${accent}a0 82%, transparent 100%);
      opacity: 0.92;
      pointer-events: none;
      box-shadow: 0 -8px 14px -2px ${accent}48;
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
      /* Default invisible — only shows when chrome is hidden (rare, e.g.
         keyboard summon away in some flow). Previously default was
         opacity 1 with state=visible overriding to 0, which caused a
         brief flash of the peek line during inject before the override
         applied. Invert: peek invisible by default, becomes visible
         only when state is explicitly "hidden". Snapped from 220ms to
         180ms to better match the chrome's own retreat/arrive timing
         (140-160ms range) — feels coordinated when state transitions. */
      opacity: 0;
      transition: opacity 180ms ease;
    }
    :host([data-state="hidden"]) .peek { opacity: 1; }

    /* Traffic lights — standalone, no pill */
    .traffic {
      display: flex; gap: 8px; align-items: center;
      padding: 0 10px 0 2px;
      user-select: none;
      -webkit-user-select: none;
    }
    .traffic .dot {
      width: 11px; height: 11px; border-radius: 50%;
      background: ${isLight ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.22)'};
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
       Idle opacity 0.62 matches Safari's ~0.6-0.65 neutral graphite
       icons (was 0.58, which read a touch too dim — icons looked
       almost dormant rather than discoverably interactive). */
    .icon {
      width: 28px; height: 28px;
      border: none; background: transparent;
      color: ${isLight ? '#1d1d1f' : '#e9ebef'};
      border-radius: 7px;
      font: inherit;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      opacity: 0.62;
      /* Asymmetric: 180ms when fading back to idle (slow, graceful
         retreat), 90ms on hover-in (snappy "wake up"). Hover rule below
         overrides during the cursor-in phase. */
      transition: background 180ms ease, opacity 180ms ease;
    }
    /* Icon hover: mostly neutral fill with a tint of the per-tab accent
       layered in (~14%), so hovering an icon visually links it to the
       chrome's identity color without becoming garish. The accent layer
       is now actually painting post-v125 hex fix, so the previous 12%
       calibration was slightly understated for sites with strong brand
       colors — bumped to 14% to read clearly as "this hover belongs to
       this tab's chrome." */
    .icon:hover {
      opacity: 1;
      background:
        linear-gradient(${isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.10)'}, ${isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.10)'}),
        linear-gradient(${accent}24, ${accent}24);
      transition: background 90ms ease, opacity 90ms ease;
    }
    /* SVG inside icon grows subtly on hover for tactile feedback —
       mirrors macOS Dock-style icon-bounce, scaled way down. */
    .icon svg { transition: transform 140ms cubic-bezier(.16,.84,.20,1); }
    .icon:hover svg { transform: scale(1.10); }
    /* Active: snap to compressed state in 50ms — matches the button-bg
       50ms duration in .icon:active above. Without this, the bg flashed
       in 50ms but the icon kept transitioning at the default 140ms,
       which read as slightly disconnected. */
    .icon:active svg { transform: scale(0.94); transition-duration: 50ms; }
    /* Share icon gets a tiny upward lift on hover, mirroring its
       "send up and out" affordance. */
    .icon[title="Share"]:hover svg { transform: scale(1.10) translateY(-1px); }
    /* Tab overview gets a tiny rotation, suggesting "shuffle/see all". */
    .icon[title="Tab overview"]:hover svg { transform: scale(1.10) rotate(-6deg); }
    /* Back/forward chevrons get a tiny directional nudge, so hovering
       reads as "this will take you that direction." */
    .icon[title="Back"]:hover svg    { transform: scale(1.10) translateX(-1px); }
    .icon[title="Forward"]:hover svg { transform: scale(1.10) translateX(1px); }
    .icon:focus-visible {
      opacity: 1;
      outline: none;
      box-shadow: 0 0 0 0.5px ${isLight ? '#fff' : '#000'},
                  0 0 0 2.5px ${accent}cc;
    }
    .icon:active {
      background:
        linear-gradient(${isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.14)'}, ${isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.14)'}),
        linear-gradient(${accent}33, ${accent}33);
      transition-duration: 50ms;
      /* No transform here — the SVG inside (.icon:active svg { scale: 0.92 })
         handles the press feel. Previously the button also scaled to 0.95,
         compounding with the SVG's 0.92 to ~0.87 — too compressed. Dock-style
         press: button stays in place, icon inside presses into it. */
    }
    .icon-group { display: inline-flex; align-items: center; gap: 3px; }

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
      height: 27px; min-height: 27px;
      min-width: 280px; max-width: 520px;
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
        /* recessed well bottom shadow — both modes. Light mode gets a
           faint inset so the pill reads as recessed below the scrim
           plane (matches Safari light), not as an elevated white card. */
        inset 0 -0.5px 0 0 ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.20)'},
        /* outer soft halo to seat the pill in the scrim */
        0 1px 2px -0.5px ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.30)'};
      transition: background 140ms ease, box-shadow 140ms ease,
                  border-radius 220ms cubic-bezier(.16,.84,.20,1),
                  min-width 220ms cubic-bezier(.16,.84,.20,1);
    }
    .url-pill:hover,
    .url-pill:focus-visible {
      /* Bumps min-width on hover/focus to subtly hint at edit-on-click —
         Safari grows the URL bar slightly when focused. Border-radius
         also nudges slightly larger for an "expand" feel. Snap-in faster
         (140ms) than the default 220ms hover-out — matches the
         "snappy in / graceful out" pattern used elsewhere (v149, v150,
         v155). The pill's default transition rule provides the slower
         hover-out timing automatically. */
      min-width: 360px;
      border-radius: 10px;
      transition: min-width 140ms cubic-bezier(.16,.84,.20,1),
                  border-radius 140ms cubic-bezier(.16,.84,.20,1);
    }
    .url-pill:hover .text,
    .url-pill:focus-visible .text {
      /* Slight text size bump on hover — read as "zooming for input".
         All animated properties at 140ms snappy in (the default rule's
         220ms takes over on hover-out for graceful settle). */
      font-size: 13.5px;
      transition: font-size 140ms cubic-bezier(.16,.84,.20,1),
                  background 140ms cubic-bezier(.16,.84,.20,1),
                  box-shadow 140ms cubic-bezier(.16,.84,.20,1);
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
        0 0 0 2.5px ${accent}cc;
    }
    .url-pill .text {
      flex: 1 1 auto;
      text-align: center;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      /* URL hosts are always LTR (ASCII-only). Force ltr direction even
         if the page document is RTL — otherwise the favicon would
         appear on the wrong side, and ellipsis truncation would behave
         oddly. */
      direction: ltr;
      unicode-bidi: isolate;
      font-size: 13px;
      font-weight: 500;
      letter-spacing: -0.005em;
      line-height: 16px;
      /* Tabular numerals so URLs with digits (ports, IPs, dates) align
         vertically when they change — no jitter as you navigate.
         Plus contextual alternates: lets the font pick better-shaped
         glyph variants for sequences like "ll" or "tt" in URLs.
         (Dropped "ss01" 1 — that's SF Pro's single-story-a stylistic
         set, which makes URL "a" letters look like Arial/Helvetica
         instead of the warmer double-story default. Subtle, but it
         made the host name read less Apple-like.)
         text-rendering hints the browser to prioritize legibility
         (kerning, ligatures) over render speed at this small size. */
      font-variant-numeric: tabular-nums;
      font-feature-settings: "calt" 1;
      text-rendering: optimizeLegibility;
      /* Soft fade at the edges so truncated URLs trail off rather than
         hitting a hard ellipsis. The mask reveals 100% of the text
         except a 6px fade zone on each side. */
      -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 6px, #000 calc(100% - 6px), transparent 100%);
      mask-image: linear-gradient(90deg, transparent 0, #000 6px, #000 calc(100% - 6px), transparent 100%);
      /* Subtle fade-in: URL text appears 80ms after the chrome arrives,
         creating a tiny layered presentation rather than everything
         showing simultaneously. The font-size + background + box-shadow
         transitions are the "hover-out" timings (220ms graceful spring);
         the :hover rule overrides font-size with a faster 140ms snap on
         hover-in. Pre-v167 background and box-shadow weren't in the
         transition list — they snapped on hover-out, which felt
         abrupt against the smoothly-animating font-size. */
      opacity: 0;
      transition: opacity 180ms ease-out,
                  font-size 220ms cubic-bezier(.16,.84,.20,1),
                  background 220ms cubic-bezier(.16,.84,.20,1),
                  box-shadow 220ms cubic-bezier(.16,.84,.20,1);
      /* Offset text slightly left to optically center against the
         favicon's left-of-center weight. Removed when Aa badge is
         present (already provides right-side weight). */
      padding-right: 15px;
      /* Tiny text-shadow softens edges against the translucent glass and
         improves legibility when the scrim is busy (gradient sites).
         Light mode uses a soft white outline so dark text reads on
         busy gradient backgrounds (Stripe); dark mode uses a soft
         black underline for the same legibility benefit. */
      text-shadow: ${isLight
        ? '0 1px 0 rgba(255,255,255,0.5), 0 0 1px rgba(255,255,255,0.4)'
        : '0 1px 0 rgba(0,0,0,0.3), 0 0 1px rgba(0,0,0,0.2)'};
    }
    .url-pill .lock {
      opacity: 0.55;
      flex: 0 0 auto;
      color: ${isLight ? 'currentColor' : accent};
    }
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
      height: 1.5px;
      background: linear-gradient(90deg, transparent 0%, ${accent}cc 50%, transparent 100%);
      background-size: 50% 100%;
      background-repeat: no-repeat;
      animation: url-loading-shimmer 1.4s linear infinite;
      pointer-events: none;
      border-bottom-left-radius: 9px;
      border-bottom-right-radius: 9px;
    }
    /* Hovering the favicon area gives it a tiny lift — feedback that it's
       interactive (will reveal site info / certificate). The lock fallback
       gets the same treatment for consistency. Scale matches the toolbar
       icons' hover scale (1.10) so hover affordances feel uniform across
       the chrome. */
    .url-pill .favicon-holder:hover .favicon,
    .url-pill .favicon-holder:hover .lock {
      transform: scale(1.10);
      transition: transform 140ms cubic-bezier(.16,.84,.20,1);
    }
    /* Hovering anywhere on the pill nudges the favicon a hair (1.04) —
       layered with the favicon-holder:hover 1.10 above. Cursor anywhere
       in the pill wakes the favicon subtly; cursor specifically on the
       favicon wakes it more. Two-stage affordance — the more-specific
       favicon-holder:hover selector naturally wins via cascade order
       when both match. */
    .url-pill:hover .favicon,
    .url-pill:focus-visible .favicon {
      transform: scale(1.04);
      transition: transform 140ms cubic-bezier(.16,.84,.20,1);
    }
    /* When URL pill is being pressed/clicked, the favicon briefly scales
       down — tactile press feedback like macOS Dock icon bounce. Aligned
       to 0.94 (matches the toolbar icon active scale post-v164) — the
       0.92 was slightly too compressed compound with the pill's 0.99
       scale (final ~0.91 vs the icon's 0.94). */
    .url-pill:active .favicon {
      transform: scale(0.94);
      transition-duration: 80ms;
    }
    /* Fixed-size holder so layout never jiggles when the favicon swaps in
       over the lock placeholder. */
    .url-pill .favicon-holder {
      position: relative;
      width: 16px; height: 16px;
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
      width: 16px; height: 16px;
      object-fit: contain;
      border-radius: 4px;
      /* 220ms transform = the "graceful retreat" timing for hover-out
         (matches v149/v150/v160 pattern). favicon-holder:hover overrides
         this with 140ms spring for the snappy wake. Active state has
         its own 80ms snap via .url-pill:active .favicon. */
      transition: opacity 160ms ease, transform 220ms cubic-bezier(.16,.84,.20,1);
      animation: favicon-arrive 320ms cubic-bezier(.16,.84,.20,1) backwards;
      animation-delay: 160ms;
      /* Hairline halo + 1px soft drop shadow: gives the favicon a faint
         "app icon" depth (Arc browser does this very subtly). Halo also
         protects dark-on-dark favicons (linear's circle, pitchfork's dot)
         against the recessed dark well. Stroke matches the chrome's
         border hairline vocabulary so the favicon reads as a chrome
         element rather than an embedded image. On dark mode, the halo
         picks up a hint of the per-tab accent so it carries identity.
         Light mode halo bumped from 0.06 -> 0.10 alpha + drop-shadow
         from 0.10 -> 0.14 so favicons feel more lifted from the
         (now recessed) light pill rather than disappearing into it. */
      filter: ${isLight
        ? 'drop-shadow(0 0.5px 1px rgba(0,0,0,0.14))'
        : `drop-shadow(0 0 0.5px ${accent}66) drop-shadow(0 0.5px 1px rgba(0,0,0,0.30))`};
      box-shadow: 0 0 0 0.5px ${isLight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.05)'};
    }
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
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "Inter", system-ui, sans-serif;
      font-weight: 600;
      font-size: 10px;
      cursor: pointer;
      opacity: 0.75;
      /* Asymmetric like the toolbar icons (v149): slow graceful retreat
         (180ms) when cursor leaves, snappy wake (90ms) on hover-in
         via the :hover rule. */
      transition: opacity 180ms ease, background 180ms ease, border-color 180ms ease, color 180ms ease;
      display: inline-flex; align-items: center; justify-content: center;
      letter-spacing: -0.02em;
      box-sizing: border-box;
      /* Match URL host text-shadow so the badge feels typographically
         consistent with the host name beside it. Dual-layer shadow
         (matches v99 host treatment). */
      text-shadow: ${isLight
        ? '0 1px 0 rgba(255,255,255,0.5), 0 0 1px rgba(255,255,255,0.4)'
        : '0 1px 0 rgba(0,0,0,0.3), 0 0 1px rgba(0,0,0,0.2)'};
    }
    .url-pill .reader-badge:hover {
      opacity: 1;
      background: ${accent}22;
      color: ${accent};
      border-color: ${accent}66;
      transform: translateY(-0.5px);
      transition: opacity 90ms ease, background 90ms ease, border-color 90ms ease, color 90ms ease, transform 90ms ease;
    }

    .spacer { flex: 1 1 auto; }

    /* Wide viewports (>1600px): widen the URL pill cap a bit so longer
       URLs (article slugs, long subdomains) don't truncate prematurely
       on big desktop displays where there's plenty of horizontal room.
       Article pages with the Reader badge get even more space. */
    @media (min-width: 1600px) {
      .url-pill { min-width: 320px; max-width: 620px; }
      .url-pill:has(.reader-badge) { min-width: 360px; max-width: 680px; }
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
        0 3px 6px -3px ${isLight ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.40)'},
        0 12px 28px -12px ${isLight ? 'rgba(0,0,0,0.26)' : 'rgba(0,0,0,0.55)'};
      transition: box-shadow 220ms ease;
    }
    /* Accent line thickens to 2px when scrolled, becoming a slightly
       more present brand indicator while there's content above. */
    :host([data-scrolled="1"]) .ribbon::after {
      height: 2px;
      transition: height 220ms ease;
    }
    /* Unfocused window: chrome subtly dims, traffic lights desaturate.
       Matches macOS native chrome behavior. The transitions used here
       hook into the existing transition rules with filter/opacity added
       as auto-animating properties (not overriding). */
    :host([data-unfocused="1"]) .ribbon { opacity: 0.85; }
    :host([data-unfocused="1"]) .url-pill { filter: saturate(0.6); }
    :host([data-unfocused="1"]) .icon { opacity: 0.45; }
    :host([data-unfocused="1"]) .ribbon::after { opacity: 0.5; }
    :host([data-unfocused="1"]) .favicon { filter: saturate(0.7); }

    /* Accessibility: honour prefers-reduced-motion. Replace the slide+scale
       with a simple opacity fade so the chrome still appears/disappears
       but without animated movement that could trigger vestibular issues. */
    @media (prefers-reduced-motion: reduce) {
      .ribbon {
        transform: none !important;
        transition: opacity 120ms ease !important;
      }
      :host([data-state="visible"]) .ribbon { transform: none !important; }
      /* Disable hover/active SVG transforms on icons + favicon — these
         move/rotate/scale geometry which is exactly what reduced-motion
         users want to avoid. Opacity / background hover changes still
         apply, so icons still indicate hover state. */
      .icon svg, .icon:hover svg, .icon:active svg,
      .icon[title="Share"]:hover svg,
      .icon[title="Tab overview"]:hover svg,
      .icon[title="Back"]:hover svg,
      .icon[title="Forward"]:hover svg,
      .url-pill .favicon-holder:hover .favicon,
      .url-pill .favicon-holder:hover .lock,
      .url-pill:active .favicon,
      .url-pill:hover .favicon,
      .url-pill:focus-visible .favicon,
      .url-pill .reader-badge:hover { transform: none !important; }
      /* Replace the favicon-arrive scale+fade with a pure opacity fade. */
      .url-pill .favicon { animation: none !important; }
      /* The loading-shimmer cycles a background-position translation
         which can read as motion. Show a static, full-width accent
         bar instead while loading. */
      .url-pill.loading::before {
        animation: none !important;
        background-size: 100% 100% !important;
      }
    }

    /* Don't print the chrome — useful for sites users save as PDF. */
    @media print {
      .ribbon, .peek { display: none !important; }
    }
    /* In browser fullscreen mode, the chrome should retreat — let the
       page have the whole viewport (Safari on macOS: Cmd-Ctrl-F;
       Windows/Linux: F11). The transform matches the chrome's initial
       inject state (translateY(-100%) scale(0.985)) so entering and
       exiting fullscreen feel like the chrome's own arrive/retreat
       animation, not a separate hide/show motion. */
    :host-context(:fullscreen) .ribbon,
    :host-context(:fullscreen) .peek {
      transform: translateY(-100%) scale(0.985) !important;
      opacity: 0 !important;
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
  const ICONS = {
    sidebar: [["path", Object.assign({ d: "M3 4.5h10M3 8h10M3 11.5h10" }, STROKE)]],
    back:    [["path", Object.assign({ d: "M10 4l-4 4 4 4" }, STROKE)]],
    forward: [["path", Object.assign({ d: "M6 4l4 4-4 4" }, STROKE)]],
    share: [
      ["path", Object.assign({ d: "M8 2.5v8M5 5.5l3-3 3 3" }, STROKE)],
      ["path", Object.assign({ d: "M4 8.5v4a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-4" }, STROKE)],
    ],
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
      // Use document.baseURI so <base href> tags are respected when the
      // favicon href is relative. Falls back to location.href if baseURI
      // is somehow unset.
      if (href) return new URL(href, document.baseURI || location.href).toString();
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

  // Slow-favicon timeout: if the favicon hasn't loaded in 4 seconds,
  // give up and let the lock fallback stand. Prevents hung load on
  // sites with broken / unreachable favicon endpoints.
  setTimeout(() => {
    if (!faviconImg.complete || faviconImg.naturalWidth <= 1) {
      faviconImg.style.display = "none";
    }
  }, 4000);

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
  const urlTextSpan = el("span", { class: "text" }, [host]);
  const urlPill = el("div", { class: "url-pill", title: title, tabindex: "0", role: "textbox", "aria-label": "Address bar" }, [
    urlTextSpan,
  ]);
  urlPill.insertBefore(faviconHolder, urlPill.firstChild);

  // SPA navigation: when popstate/hashchange fires, refresh the URL host
  // display. The favicon doesn't auto-refresh — that would require a new
  // injection cycle. We also briefly dip the URL text opacity so the
  // change is visible — without this, the text just snaps to the new
  // host and the user might miss the transition. The dip-and-restore
  // rides on the existing `transition: opacity 180ms` rule.
  function refreshUrl() {
    const newHost = location.host.replace(/^www\./i, "").replace(/</g, "&lt;");
    if (urlTextSpan.textContent !== newHost) {
      urlTextSpan.style.opacity = "0.4";
      requestAnimationFrame(() => {
        urlTextSpan.textContent = newHost;
        urlPill.title = document.title || newHost;
        // Restore on the next frame so the fade-down completes briefly
        // before the fade-up starts — feels like a real "page changed".
        setTimeout(() => { urlTextSpan.style.opacity = "1"; }, 90);
      });
    }
  }
  window.addEventListener("popstate", refreshUrl, { passive: true });
  window.addEventListener("hashchange", refreshUrl, { passive: true });

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
  // Match both metaKey (macOS Cmd) and ctrlKey (Linux/Windows) so the
  // platform-native shortcut works regardless of host OS.
  document.addEventListener("keydown", e => {
    const accel = e.metaKey || e.ctrlKey;
    if (e.key === "F6" || (accel && (e.key === "l" || e.key === "L")) ||
        (accel && (e.key === "t" || e.key === "T"))) {
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

  // Push down position:fixed / position:sticky elements anchored at the
  // viewport top — the body padding-top trick only pushes normal-flow
  // content, so sticky/fixed headers (tailwindcss.com, supabase.com, many
  // marketing pages) would otherwise sit underneath the chrome at the
  // same viewport coordinates and overlap. We bump their top by 40px so
  // they stack cleanly below the chrome band, matching the no-overlap
  // promise that body padding-top already gives normal-flow pages.
  //
  // Heuristic: only nudge elements anchored within 5px of the viewport
  // top. Higher offsets are deliberate (toasts at top:20, modals at
  // top:50%, etc.) and should not be moved.
  const KEEL_PUSH_FLAG = "__keelPushed__";
  function nudgeIfTopAnchored(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.id === "__keel_chrome__" || el.dataset[KEEL_PUSH_FLAG]) return;
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "sticky") return;
    const topPx = parseFloat(cs.top);
    if (isNaN(topPx) || topPx < 0 || topPx > 5) return;
    // Preserve the inline-style top (if any) so we layer additively.
    el.dataset[KEEL_PUSH_FLAG] = "1";
    el.style.top = (topPx + 40) + "px";
  }
  function scanAndNudge(root) {
    // Bounded scan: only elements actually present in the DOM at call time.
    // 5000+ elements take <50ms; well within page-load budget.
    const all = (root || document.body || document.documentElement).querySelectorAll("*");
    for (const el of all) nudgeIfTopAnchored(el);
  }
  // First pass after initial styles settle.
  setTimeout(() => scanAndNudge(), 100);
  // Second pass for sites that mount sticky headers after first paint
  // (Next.js hydration, late-loading nav frameworks, etc.).
  setTimeout(() => scanAndNudge(), 1500);
  // Catch dynamically inserted headers (SPA route changes, banner mounts).
  const mo = new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        nudgeIfTopAnchored(node);
        if (node.querySelectorAll) {
          for (const child of node.querySelectorAll("*")) nudgeIfTopAnchored(child);
        }
      }
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
