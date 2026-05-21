// Keel chrome overlay — Safari-style floating segmented pills.
// Injected into the page via CDP/Runtime.evaluate when Brave is launched in
// --app mode (no native tab strip / address bar). The overlay paints a 60px
// transparent ribbon at the top with the page color bleeding through, and
// four separate rounded-white capsules floating on top of it.
//
// Layout (from left to right):
//   [traffic lights]   [sidebar ▾]   [⟨ ⟩]   ...space...   [host pill]   ...space...   [⇪ ⊕ ⌐]
//
// All capsules are 32px tall, ~14-16px border-radius, glass / blurred,
// with a single soft drop shadow. The strip itself has no background — the
// page color tints the area via the standard browser page background.

(() => {
  if (document.getElementById("__keel_chrome__")) return;
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
  function pageAccent() {
    const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
    const chosen =
      metas.find(m => /dark/.test(m.getAttribute("media") || "")) || metas[0];
    if (chosen) {
      const c = parseColor(chosen.getAttribute("content") || "");
      if (c) {
        const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
        if ((max - min) / 255 >= 0.10) {
          let [h, s, l] = rgbToHsl(c.r, c.g, c.b);
          s = Math.min(s, 0.55);
          l = Math.min(Math.max(l, 0.40), 0.70);
          return hslToCss(h, s, l);
        }
      }
    }
    return P.accent || "#2F9D8C";
  }

  // Sample the page's near-edge background color to tint the ribbon. Walks
  // the DOM near the top viewport and picks the first opaque background it
  // finds — this catches dark heroes / sticky nav bars that the page's
  // <html>/<body> bg would otherwise miss (apple.com, arxiv.org).
  function pageTint() {
    const samplePoints = [
      [40,  20], [Math.floor(innerWidth/2), 20], [innerWidth - 40, 20],
      [40,  44], [Math.floor(innerWidth/2), 44], [innerWidth - 40, 44],
    ];
    for (const [x, y] of samplePoints) {
      let el = document.elementFromPoint(x, y);
      while (el && el !== document.documentElement) {
        const bg = getComputedStyle(el).backgroundColor;
        if (bg && !/rgba?\(.*?,\s*0\s*\)/.test(bg) && bg !== "transparent") return bg;
        el = el.parentElement;
      }
    }
    return getComputedStyle(document.documentElement).backgroundColor
        || getComputedStyle(document.body).backgroundColor || "rgb(247,246,242)";
  }

  const accent = pageAccent();
  const host  = (P.host  || location.host).replace(/</g, "&lt;");
  const title = (P.title || document.title || "").replace(/</g, "&lt;");
  const tint  = pageTint();

  const root = document.createElement("div");
  root.id = "__keel_chrome__";
  document.documentElement.appendChild(root);
  const shadow = root.attachShadow({ mode: "open" });

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

    /* The chrome zone — translucent strip at top, blurred so it visually
       contains the page content beneath. Pills float inside. */
    .ribbon {
      position: fixed; top: 0; left: 0; right: 0;
      height: 46px;
      z-index: 2147483647;
      display: flex; align-items: center;
      padding: 0 12px;
      gap: 4px;
      font: 13px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif;
      pointer-events: none;
      transform: translateY(-100%);
      opacity: 0;
      transition: transform 220ms cubic-bezier(.2,.7,.1,1), opacity 220ms ease;
      background: ${isLight
        ? 'linear-gradient(180deg, rgba(245,246,248,0.88) 0%, rgba(245,246,248,0.82) 78%, rgba(245,246,248,0) 100%)'
        : 'linear-gradient(180deg, rgba(22,23,26,0.82) 0%, rgba(22,23,26,0.74) 78%, rgba(22,23,26,0) 100%)'};
      backdrop-filter: blur(26px) saturate(180%);
      -webkit-backdrop-filter: blur(26px) saturate(180%);
      /* Faint accent line at the bottom — the only colored chrome element,
         a single 1px-wide tab indicator (per-tab tint). */
      border-bottom: 0.5px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)'};
    }
    .ribbon > * { pointer-events: auto; }
    /* Tint accent — a thin colored under-line that scrolls with the chrome.
       This is the ONLY per-tab tint indicator; the URL pill no longer
       carries its own inset to avoid double-marking the accent. */
    .ribbon::after {
      content: ""; position: absolute; left: 0; right: 0; bottom: 0;
      height: 1.5px;
      background: linear-gradient(90deg, transparent 0%, ${accent}70 50%, transparent 100%);
      pointer-events: none;
    }

    /* Steady-state hairline — present even when ribbon is hidden so the user
       has a discoverable handle. */
    .peek {
      position: fixed; top: 0; left: 0; right: 0; height: 2px;
      pointer-events: none;
      z-index: 2147483646;
      background: linear-gradient(180deg,
        ${isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)'} 0%,
        transparent 100%);
      transition: opacity 220ms;
    }
    :host([data-state="visible"]) .peek { opacity: 0; }

    /* Traffic lights — standalone, no pill */
    .traffic {
      display: flex; gap: 8px; align-items: center;
      padding: 0 8px 0 2px;
    }
    .traffic .dot {
      width: 12px; height: 12px; border-radius: 50%;
      background: ${isLight ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.22)'};
      transition: background 120ms;
    }
    .ribbon:hover .traffic .dot:nth-child(1) { background: #ED6B5F; }
    .ribbon:hover .traffic .dot:nth-child(2) { background: #F5BD4F; }
    .ribbon:hover .traffic .dot:nth-child(3) { background: #62C554; }

    /* Naked icon — no pill background, just hoverable. Safari-style. */
    .icon {
      width: 30px; height: 30px;
      border: none; background: transparent;
      color: ${isLight ? '#1d1d1f' : '#e9ebef'};
      border-radius: 8px;
      font-size: 14px;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer;
      opacity: 0.72;
      transition: background 120ms ease, opacity 120ms ease;
    }
    .icon:hover { opacity: 1; background: ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.09)'}; }
    .icon-group { display: inline-flex; align-items: center; gap: 2px; }

    /* URL pill — the only pill. Centered. The per-tab accent shows only as
       the scrim underline, so no duplicate inset here. */
    .url-pill {
      display: inline-flex; align-items: center; gap: 6px;
      height: 28px; min-width: 240px; max-width: 440px;
      padding: 0 12px;
      border-radius: 8px;
      background: ${isLight ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.06)'};
      color: ${isLight ? '#1d1d1f' : '#f0f1f3'};
      box-shadow: inset 0 0 0 0.5px ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.07)'};
      transition: background 140ms ease;
    }
    .url-pill:hover {
      background: ${isLight ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.10)'};
    }
    .url-pill .text {
      flex: 1 1 auto;
      text-align: center;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-size: 12.5px;
      letter-spacing: -0.005em;
    }
    .url-pill .lock { opacity: 0.42; flex: 0 0 auto; }
    .url-pill .right-icons { display: flex; align-items: center; gap: 0; margin-right: -6px; }
    .url-pill .right-icons .icon { width: 22px; height: 22px; font-size: 11px; opacity: 0.55; border-radius: 6px; }

    .spacer { flex: 1 1 auto; }

    :host([data-state="visible"]) .ribbon {
      transform: translateY(0);
      opacity: 1;
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
  const ICONS = {
    sidebar:  '<path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    back:     '<path d="M10 4l-4 4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    forward:  '<path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    reload:   '<path d="M3.5 8a4.5 4.5 0 1 1 1.3 3.15" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/><path d="M3.2 4v3h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    share:    '<path d="M8 2.5v8M5 5.5l3-3 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M4 8.5v4a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/>',
    plus:     '<path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    grid:     '<rect x="3" y="3" width="4" height="4" rx="0.8" stroke="currentColor" stroke-width="1.2" fill="none"/><rect x="9" y="3" width="4" height="4" rx="0.8" stroke="currentColor" stroke-width="1.2" fill="none"/><rect x="3" y="9" width="4" height="4" rx="0.8" stroke="currentColor" stroke-width="1.2" fill="none"/><rect x="9" y="9" width="4" height="4" rx="0.8" stroke="currentColor" stroke-width="1.2" fill="none"/>',
    lock:     '<path d="M3 6V4a3 3 0 1 1 6 0v2h.5A1.5 1.5 0 0 1 11 7.5v4A1.5 1.5 0 0 1 9.5 13h-7A1.5 1.5 0 0 1 1 11.5v-4A1.5 1.5 0 0 1 2.5 6H3zm1 0h4V4a2 2 0 1 0-4 0v2z" fill="currentColor"/>',
  };
  function svgIcon(name, opts) {
    opts = opts || {};
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", name === "lock" ? "0 0 12 14" : "0 0 16 16");
    s.setAttribute("width",  String(opts.size || 16));
    s.setAttribute("height", String(opts.size || 16));
    s.setAttribute("aria-hidden", "true");
    if (opts.cls) s.setAttribute("class", opts.cls);
    s.innerHTML = ICONS[name];
    return s;
  }
  function iconBtn(name, title, opts) {
    const b = el("button", { class: "icon", title: title }, []);
    b.appendChild(svgIcon(name, opts));
    return b;
  }

  // ---- ribbon --------------------------------------------------------------
  const traffic = el("div", { class: "traffic" }, [
    el("div", { class: "dot" }),
    el("div", { class: "dot" }),
    el("div", { class: "dot" }),
  ]);

  const leftIcons = el("div", { class: "icon-group" }, [
    iconBtn("sidebar", "Sidebar"),
    iconBtn("back",    "Back"),
    iconBtn("forward", "Forward"),
  ]);

  const urlPill = el("div", { class: "url-pill", title: title }, [
    el("span", { class: "text" }, [host]),
    el("div", { class: "right-icons" }, [
      iconBtn("reload", "Reload", { size: 13 }),
    ]),
  ]);
  urlPill.insertBefore(svgIcon("lock", { cls: "lock", size: 11 }), urlPill.firstChild);

  // Right side: just share + tab overview. New-tab moves to Ctrl/Cmd-T —
  // having three icons here always collides with site CTAs (Sign up, Try X,
  // Donate). Two icons leaves more breathing room.
  const rightIcons = el("div", { class: "icon-group" }, [
    iconBtn("share", "Share"),
    iconBtn("grid",  "Tab overview"),
  ]);

  const ribbon = el("div", { class: "ribbon" }, [
    traffic,
    leftIcons,
    el("div", { class: "spacer" }),
    urlPill,
    el("div", { class: "spacer" }),
    rightIcons,
  ]);

  const peek = el("div", { class: "peek" });
  shadow.appendChild(peek);
  shadow.appendChild(ribbon);

  // Hidden by default — pages get the full viewport. The 3-px peek line is
  // the only steady-state hint. Move cursor into the top ~100px to summon.
  const hostEl = shadow.host;
  hostEl.dataset.state = "hidden";

  let idleT;
  const show = () => {
    hostEl.dataset.state = "visible";
    clearTimeout(idleT);
    idleT = setTimeout(() => { hostEl.dataset.state = "hidden"; }, 1200);
  };

  // Cursor proximity (Safari-style) — require 200ms dwell in top 60px to
  // avoid accidental summons. After cursor leaves top area, auto-hide in 1.2s.
  let dwellT, inTop = false;
  document.addEventListener("mousemove", e => {
    if (e.clientY < 60) {
      if (!inTop) {
        inTop = true;
        clearTimeout(dwellT);
        dwellT = setTimeout(() => { if (inTop) show(); }, 200);
      }
    } else {
      inTop = false;
      clearTimeout(dwellT);
    }
  }, { passive: true });

  // Always-summon shortcuts (mirrors patches/0004 KeelAutohideController)
  document.addEventListener("keydown", e => {
    if (e.key === "F6" || (e.ctrlKey && (e.key === "l" || e.key === "L")) ||
        (e.ctrlKey && (e.key === "t" || e.key === "T"))) {
      show();
    }
  }, { passive: true });

  // Brief flash on inject so the user sees the chrome exists, then auto-hide
  show();
})();
