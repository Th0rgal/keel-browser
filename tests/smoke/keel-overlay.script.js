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

  // Sample the page's near-edge background color to tint the ribbon.
  function pageTint() {
    const bg = getComputedStyle(document.documentElement).backgroundColor
            || getComputedStyle(document.body).backgroundColor || "rgb(247,246,242)";
    return bg;
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
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }

    /* The chrome ribbon — sits at top:0, lets the page background show through */
    .ribbon {
      position: fixed; top: 0; left: 0; right: 0;
      height: 56px;
      z-index: 2147483647;
      display: flex; align-items: center;
      padding: 0 18px;
      gap: 10px;
      font: 13px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif;
      pointer-events: none;
      /* No background — the page provides the color */
    }
    .ribbon > * { pointer-events: auto; }

    /* Traffic lights — standalone, no pill */
    .traffic {
      display: flex; gap: 8px; align-items: center;
      padding-right: 4px;
    }
    .traffic .dot {
      width: 13px; height: 13px; border-radius: 50%;
      background: #c0c0c0;
      transition: background 120ms;
    }
    .ribbon:hover .traffic .dot:nth-child(1) { background: #ED6B5F; }
    .ribbon:hover .traffic .dot:nth-child(2) { background: #F5BD4F; }
    .ribbon:hover .traffic .dot:nth-child(3) { background: #62C554; }

    /* Pill base */
    .pill {
      display: inline-flex; align-items: center; gap: 0;
      height: 32px;
      padding: 0 8px;
      border-radius: 16px;
      background: ${isLight
        ? 'rgba(255,255,255,0.78)'
        : 'rgba(34,36,40,0.72)'};
      box-shadow:
        0 1px 0 0 ${isLight ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.04)'} inset,
        0 0 0 1px ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'},
        0 4px 14px -6px rgba(0,0,0,0.18);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      color: ${isLight ? '#1d1d1f' : '#f0f1f3'};
      transition: background 140ms ease, box-shadow 140ms ease;
    }

    /* Icon button inside a pill */
    .icon {
      width: 28px; height: 28px;
      border: none; background: transparent;
      color: inherit;
      border-radius: 14px;
      font-size: 13px;
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer;
      opacity: 0.78;
    }
    .icon:hover { opacity: 1; background: ${isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)'}; }
    .caret {
      width: 16px; height: 28px;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 9px; opacity: 0.5;
      margin-right: 2px;
    }

    /* URL pill — wider, centered */
    .url-pill {
      display: inline-flex; align-items: center; gap: 8px;
      height: 32px; min-width: 360px; max-width: 520px;
      padding: 0 14px;
      border-radius: 16px;
      background: ${isLight ? 'rgba(255,255,255,0.86)' : 'rgba(34,36,40,0.78)'};
      box-shadow:
        0 1px 0 0 ${isLight ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.04)'} inset,
        0 0 0 1px ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'},
        0 4px 18px -6px rgba(0,0,0,0.22);
      backdrop-filter: blur(22px) saturate(180%);
      -webkit-backdrop-filter: blur(22px) saturate(180%);
      color: ${isLight ? '#1d1d1f' : '#f0f1f3'};
      /* per-tab tint — 1px accent line at the bottom-inside */
      box-shadow:
        0 1px 0 0 ${isLight ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.04)'} inset,
        0 -1px 0 0 ${accent}50 inset,
        0 0 0 1px ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'},
        0 6px 18px -6px rgba(0,0,0,0.22);
    }
    .url-pill .text {
      flex: 1 1 auto;
      text-align: center;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-size: 13px;
      letter-spacing: -0.01em;
    }
    .url-pill .lock { opacity: 0.45; font-size: 11px; }
    .url-pill .right-icons { display: flex; align-items: center; gap: 4px; opacity: 0.6; }
    .url-pill .right-icons .icon { width: 22px; height: 22px; font-size: 11px; }

    .spacer { flex: 1 1 auto; }

    /* Hot-zone for cursor-summon (chrome auto-fades after idle) */
    .hotzone {
      position: fixed; top: 0; left: 0; right: 0; height: 80px;
      pointer-events: none;
      z-index: 2147483646;
    }

    :host([data-state="hidden"]) .ribbon {
      transform: translateY(-100%);
      opacity: 0;
      transition: transform 220ms ease, opacity 220ms ease;
    }
    :host([data-state="visible"]) .ribbon {
      transform: translateY(0);
      opacity: 1;
      transition: transform 220ms ease, opacity 220ms ease;
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

  // ---- ribbon --------------------------------------------------------------
  const traffic = el("div", { class: "traffic" }, [
    el("div", { class: "dot" }),
    el("div", { class: "dot" }),
    el("div", { class: "dot" }),
  ]);

  const sidebarPill = el("div", { class: "pill" }, [
    el("button", { class: "icon", title: "Sidebar" }, ["▥"]),
    el("span", { class: "caret" }, ["▾"]),
  ]);

  const navPill = el("div", { class: "pill" }, [
    el("button", { class: "icon", title: "Back" }, ["‹"]),
    el("button", { class: "icon", title: "Forward" }, ["›"]),
  ]);

  const urlPill = el("div", { class: "url-pill", title: title }, [
    el("span", { class: "lock" }, ["🔒"]),
    el("span", { class: "text" }, [host]),
    el("div", { class: "right-icons" }, [
      el("button", { class: "icon", title: "Translate" }, ["⇪"]),
      el("button", { class: "icon", title: "Reload" }, ["⟲"]),
    ]),
  ]);

  const sharePill = el("div", { class: "pill" }, [
    el("button", { class: "icon", title: "Share" }, ["⤴"]),
    el("button", { class: "icon", title: "New tab" }, ["+"]),
    el("button", { class: "icon", title: "Tab overview" }, ["▢"]),
  ]);

  const ribbon = el("div", { class: "ribbon" }, [
    traffic,
    sidebarPill,
    navPill,
    el("div", { class: "spacer" }),
    urlPill,
    el("div", { class: "spacer" }),
    sharePill,
  ]);

  const hotzone = el("div", { class: "hotzone" });

  shadow.appendChild(hotzone);
  shadow.appendChild(ribbon);

  // Reserve the top 56px so the page content isn't covered.
  // Use scroll-padding + viewport height adjustment for sticky elements.
  document.documentElement.style.scrollPaddingTop = "56px";
  document.body.style.paddingTop = "56px";

  // Visibility state: visible by default; hide after 1.6s of no input,
  // resummon on mouse-enter at top 80px or any keyboard event.
  const hostEl = shadow.host;
  hostEl.dataset.state = "visible";
  let idleT;
  const reset = () => {
    hostEl.dataset.state = "visible";
    clearTimeout(idleT);
    idleT = setTimeout(() => { hostEl.dataset.state = "hidden"; }, 1600);
  };
  reset();
  document.addEventListener("mousemove", e => {
    if (e.clientY < 80) reset();
  }, { passive: true });
  document.addEventListener("keydown", reset, { passive: true });
})();
