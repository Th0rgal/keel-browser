// Keel new-tab page.
// Minimal: render clock, render any pinned sites the user saved, route the
// search box to either a URL or the configured search provider. No telemetry,
// no remote fetches, no third-party scripts.

(() => {
  "use strict";

  // ---- clock ----------------------------------------------------------------
  const clockEl = document.getElementById("clock");
  function paintClock() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    clockEl.textContent = `${hh}:${mm}`;
    clockEl.dateTime = now.toISOString();
  }
  paintClock();
  setInterval(paintClock, 30 * 1000);

  // ---- pinned sites ---------------------------------------------------------
  // Stored in localStorage as { sites: [{title, url}] }. Nothing leaves the
  // device. If empty, render nothing — no defaults, no marketing tiles.
  const PINNED_KEY = "keel.pinned.v1";
  function readPinned() {
    try {
      const raw = localStorage.getItem(PINNED_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed?.sites)) return [];
      return parsed.sites.filter(s => typeof s?.url === "string");
    } catch (_) {
      return [];
    }
  }
  function renderPinned() {
    const container = document.getElementById("pinned");
    container.replaceChildren();
    for (const site of readPinned()) {
      const a = document.createElement("a");
      a.href = site.url;
      a.rel = "noopener noreferrer";
      const dot = document.createElement("span");
      dot.className = "dot";
      a.appendChild(dot);
      const label = document.createElement("span");
      label.textContent = site.title || hostFromUrl(site.url);
      a.appendChild(label);
      container.appendChild(a);
    }
  }
  function hostFromUrl(u) {
    try { return new URL(u).host; } catch (_) { return u; }
  }
  renderPinned();

  // ---- search box -----------------------------------------------------------
  // If the user types something that parses as a URL (or has a dot and no
  // spaces), navigate there directly. Otherwise submit to the configured
  // search provider. Keeps the new tab usable as a unified address box.
  const form = document.getElementById("search");
  const input = document.getElementById("q");

  form.addEventListener("submit", (ev) => {
    const raw = input.value.trim();
    if (!raw) { ev.preventDefault(); return; }

    if (looksLikeUrl(raw)) {
      ev.preventDefault();
      const url = raw.includes("://") ? raw : `https://${raw}`;
      window.location.assign(url);
    }
    // Else: let the form GET to the search provider.
  });

  function looksLikeUrl(s) {
    if (/\s/.test(s)) return false;
    if (s.startsWith("http://") || s.startsWith("https://")) return true;
    if (s.startsWith("about:") || s.startsWith("chrome://") || s.startsWith("brave://")) {
      window.location.assign(s);
      return true;
    }
    return /^[^\s]+\.[^\s.]+$/.test(s);
  }

  // ---- theme toggle ---------------------------------------------------------
  const THEME_KEY = "keel.theme.v1";
  const root = document.documentElement;
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "light") root.dataset.theme = saved;

  document.getElementById("toggle-theme").addEventListener("click", () => {
    const current = root.dataset.theme;
    const next = current === "dark" ? "light" : (current === "light" ? "auto" : "dark");
    root.dataset.theme = next;
    if (next === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
  });

  // Autofocus on load, but not if the user is already typing somewhere.
  if (document.activeElement === document.body) input.focus();
})();
