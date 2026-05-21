// Keel chrome overlay — standalone IIFE injected into the page via CDP.
// Reads optional params from window.__keelParams__ but defaults to detecting
// everything off the page itself (host, title, accent).
//
// This script paints the 28-px peek strip and the summoned single-row bar on
// top of the live page. It's the same shape as patches/0004 + 0005, but as
// CSS in a Shadow Root instead of Chromium Views — for sandbox preview only.

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
    if (s === 0) {
      r = g = b = l;
    } else {
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
    return P.accent || "#53DAC6";
  }

  const accent = pageAccent();
  const host  = (P.host  || location.host).replace(/</g, "&lt;");
  const title = (P.title || document.title || "").replace(/</g, "&lt;");

  const root = document.createElement("div");
  root.id = "__keel_chrome__";
  document.documentElement.appendChild(root);

  const shadow = root.attachShadow({ mode: "open" });

  // Build via DOM rather than string concat to avoid escape issues
  const style = document.createElement("style");
  style.textContent = [
    ":host { all: initial; }",
    ".strip {",
    "  position: fixed; top: 0; left: 0; right: 0;",
    "  height: 28px; z-index: 2147483646;",
    "  display: flex; align-items: center; padding: 0 14px;",
    "  font: 12px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif;",
    "  color: rgba(242,242,239,0.85);",
    "  background: rgba(15,18,20,0.55);",
    "  -webkit-backdrop-filter: blur(20px) saturate(160%);",
    "  backdrop-filter: blur(20px) saturate(160%);",
    "  border-bottom: 1px solid rgba(255,255,255,0.04);",
    "  box-shadow: 0 1px 0 0 " + accent + " inset, 0 0 24px -20px " + accent + ";",
    "  transition: opacity 180ms ease, transform 180ms ease;",
    "}",
    ".favicon { width:14px; height:14px; border-radius:4px; background:" + accent + "; margin-right:8px; box-shadow: 0 0 0 1px rgba(255,255,255,0.06) inset; }",
    ".host  { color: rgba(168,173,178,0.95); margin-right: 8px; white-space: nowrap; }",
    ".title { color: rgba(115,122,128,0.95); flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".traffic { display:flex; gap:8px; align-items:center; flex:0 0 auto; margin-left: 8px; }",
    ".traffic .dot { width:12px; height:12px; border-radius:50%; background:#3a3d40; }",
    ".strip:hover .traffic .dot:nth-child(1) { background:#ED6B5F; }",
    ".strip:hover .traffic .dot:nth-child(2) { background:#F5BD4F; }",
    ".strip:hover .traffic .dot:nth-child(3) { background:#62C554; }",

    ".bar {",
    "  position: fixed; top: 0; left: 0; right: 0;",
    "  height: 38px; z-index: 2147483647;",
    "  display: flex; align-items: center; gap: 12px; padding: 0 14px;",
    "  font: 12px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif;",
    "  color: rgba(242,242,239,0.95);",
    "  background: rgba(15,18,20,0.78);",
    "  -webkit-backdrop-filter: blur(28px) saturate(170%);",
    "  backdrop-filter: blur(28px) saturate(170%);",
    "  border-bottom: 1px solid rgba(255,255,255,0.05);",
    "  transform: translateY(-100%); opacity: 0;",
    "  transition: opacity 180ms ease, transform 180ms ease;",
    "  box-shadow: 0 1px 0 0 color-mix(in srgb, " + accent + " 60%, transparent);",
    "}",
    ".group { display:flex; align-items:center; gap:6px; flex:0 0 auto; }",
    ".traffic-inline { display:flex; gap:8px; padding-right:6px; margin-right:6px; border-right:1px solid #252A2E; }",
    ".traffic-inline .dot { width:12px; height:12px; border-radius:50%; background:#3a3d40; }",
    ".bar:hover .traffic-inline .dot:nth-child(1) { background:#ED6B5F; }",
    ".bar:hover .traffic-inline .dot:nth-child(2) { background:#F5BD4F; }",
    ".bar:hover .traffic-inline .dot:nth-child(3) { background:#62C554; }",
    "button.icon { width:26px; height:26px; border:none; background:transparent; color:rgba(168,173,178,0.95); border-radius:6px; font-size:14px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }",
    "button.icon:hover { background: rgba(255,255,255,0.05); color: #F2F2EF; }",
    ".tabs { display:flex; align-items:center; gap:4px; min-width:0; max-width:320px; }",
    ".tab { display:inline-flex; align-items:center; gap:6px; height:26px; padding:0 10px; border-radius:6px; color:#F2F2EF; background: color-mix(in srgb, " + accent + " 12%, rgba(255,255,255,0.04)); font-size:12px; border-left: 2px solid " + accent + "; max-width:220px; }",
    ".tab .favicon { width:12px; height:12px; border-radius:3px; }",
    ".tab span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",
    ".sep { width:1px; height:18px; background:#252A2E; flex:0 0 auto; }",
    ".address { flex:1 1 auto; min-width:0; height:28px; display:flex; align-items:center; gap:8px; padding:0 12px; background:#181C1F; border-radius:8px; color:#F2F2EF; box-shadow: 0 1px 0 0 " + accent + " inset; }",
    ".address .lock { color:#737A80; font-size:11px; }",
    ".address .text { flex:1 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",
    ":host([data-state='expanded']) .strip { opacity: 0; pointer-events: none; }",
    ":host([data-state='expanded']) .bar   { transform: translateY(0); opacity: 1; }",
    ".hotzone { position:fixed; top:0; left:0; right:0; height:60px; z-index: 2147483645; }",
  ].join("\n");
  shadow.appendChild(style);

  function el(tag, attrs, kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") e.className = v;
      else if (k === "id") e.id = v;
      else e.setAttribute(k, v);
    }
    for (const k of (kids || [])) {
      if (typeof k === "string") e.appendChild(document.createTextNode(k));
      else e.appendChild(k);
    }
    return e;
  }
  function dot(cls) { return el("span", { class: cls }); }

  const hotzone = el("div", { class: "hotzone", id: "hot" });
  shadow.appendChild(hotzone);

  const strip = el("div", { class: "strip", id: "strip" }, [
    el("div", { class: "favicon" }),
    el("span", { class: "host" }, [host]),
    el("span", { class: "title" }, [" · " + title]),
    el("div", { class: "traffic" }, [dot("dot"), dot("dot"), dot("dot")]),
  ]);
  shadow.appendChild(strip);

  const tabChip = el("div", { class: "tab" }, [
    el("span", { class: "favicon" }),
    el("span", null, [title || host]),
  ]);
  const bar = el("div", { class: "bar", id: "bar" }, [
    el("div", { class: "traffic-inline" }, [dot("dot"), dot("dot"), dot("dot")]),
    el("div", { class: "group" }, [
      el("button", { class: "icon", title: "Back"    }, ["‹"]),
      el("button", { class: "icon", title: "Forward" }, ["›"]),
      el("button", { class: "icon", title: "Reload"  }, ["⟲"]),
    ]),
    el("div", { class: "group tabs" }, [tabChip]),
    el("span", { class: "sep" }),
    el("div", { class: "address group" }, [
      el("span", { class: "lock" }, ["🔒"]),
      el("span", { class: "text" }, [host]),
    ]),
    el("div", { class: "group" }, [
      el("button", { class: "icon", title: "Extensions" }, ["🧩"]),
      el("button", { class: "icon", title: "Menu"       }, ["☰"]),
    ]),
  ]);
  shadow.appendChild(bar);

  const hostEl = shadow.host;
  hostEl.dataset.state = "collapsed";

  let dismiss;
  function expand()   { hostEl.dataset.state = "expanded"; clearTimeout(dismiss); }
  function collapse() { hostEl.dataset.state = "collapsed"; }
  function deferredCollapse() {
    clearTimeout(dismiss);
    dismiss = setTimeout(collapse, 1200);
  }
  hotzone.addEventListener("mouseenter", expand);
  bar.addEventListener("mouseenter", expand);
  bar.addEventListener("mouseleave", deferredCollapse);
  hotzone.addEventListener("mouseleave", deferredCollapse);

  // Reserve 28 px at the top so the page isn't covered by the strip — same
  // effect as BrowserView::Layout would have in the patched build.
  document.documentElement.style.scrollPaddingTop = "28px";
  document.body.style.paddingTop = "28px";
})();
