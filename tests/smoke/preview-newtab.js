// Render the Keel new tab page in dark + light, plus mobile, for the README.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { mkdir } from "node:fs/promises";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../..");
const OUT  = path.join(ROOT, "build/preview");
await mkdir(OUT, { recursive: true });

const isRoot = process.getuid && process.getuid() === 0;
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/brave-browser",
  headless: "new",
  defaultViewport: { width: 1280, height: 800 },
  args: ["--no-first-run","--no-default-browser-check",
         ...(isRoot ? ["--no-sandbox","--disable-dev-shm-usage"] : [])],
});

const cases = [
  { name: "newtab_dark_desktop",  width: 1280, height: 800, theme: "dark",  pinned: true  },
  { name: "newtab_light_desktop", width: 1280, height: 800, theme: "light", pinned: true  },
  { name: "newtab_dark_empty",    width: 1280, height: 800, theme: "dark",  pinned: false },
  { name: "newtab_mobile",        width:  390, height: 844, theme: "dark",  pinned: false },
];

for (const c of cases) {
  const page = await browser.newPage();
  await page.setViewport({ width: c.width, height: c.height, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: c.theme }]);
  await page.goto(`file://${ROOT}/newtab/index.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate((theme, pinned) => {
    document.documentElement.dataset.theme = theme;
    localStorage.removeItem("keel.pinned.v1");
    if (pinned) {
      localStorage.setItem("keel.pinned.v1", JSON.stringify({
        sites: [
          { title: "GitHub",        url: "https://github.com" },
          { title: "Hacker News",   url: "https://news.ycombinator.com" },
          { title: "arXiv",         url: "https://arxiv.org" },
          { title: "Brave Search",  url: "https://search.brave.com" },
          { title: "Docs",          url: "https://developer.mozilla.org" },
        ],
      }));
    }
  }, c.theme, c.pinned);
  await page.reload({ waitUntil: "networkidle0" });
  // Re-apply theme after reload since it's the runtime attribute, not stored.
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, c.theme);
  // Blur the input so the design preview doesn't show the focus ring.
  await page.evaluate(() => document.activeElement?.blur?.());
  await new Promise(r => setTimeout(r, 200));
  const out = path.join(OUT, `${c.name}.png`);
  await page.screenshot({ path: out });
  console.log("wrote", out);
  await page.close();
}
await browser.close();
