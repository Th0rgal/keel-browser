// Build a contact sheet (grid) from the design tour PNGs so we can review
// hidden vs summoned across all sites at once.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { readdir } from "node:fs/promises";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../..");
const TOUR = path.join(ROOT, "build/preview/tour");

const files = (await readdir(TOUR)).filter(f => /^\d\d-.+\.(hidden|summoned)\.png$|^\d\d-.+_(hidden|summoned)\.png$/.test(f));
const hidden = files.filter(f => /_hidden\.png$/.test(f)).sort();
const summoned = files.filter(f => /_summoned\.png$/.test(f)).sort();

const html = `<!DOCTYPE html><html><head><style>
  body { margin: 0; background: #1a1b1e; color: #e9ebef; font: 13px -apple-system, system-ui, sans-serif; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; }
  figure { margin: 0; background: #25262a; border-radius: 6px; overflow: hidden; }
  figcaption { padding: 6px 10px; font-size: 11px; color: #aab0b5; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  img { display: block; width: 100%; height: auto; }
  h2 { margin: 16px 12px 8px; font-size: 14px; font-weight: 500; color: #f0f1f3; }
</style></head><body>
<h2>Steady state (chrome hidden)</h2>
<div class="grid">${hidden.map(f => `<figure><img src="${f}"><figcaption>${f.replace('_hidden.png','')}</figcaption></figure>`).join("")}</div>
<h2>Summoned (chrome visible)</h2>
<div class="grid">${summoned.map(f => `<figure><img src="${f}"><figcaption>${f.replace('_summoned.png','')}</figcaption></figure>`).join("")}</div>
</body></html>`;

const html_path = path.join(TOUR, "_contact.html");
const fs = await import("node:fs/promises");
await fs.writeFile(html_path, html);

const isRoot = process.getuid && process.getuid() === 0;
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/brave-browser",
  headless: "new",
  defaultViewport: { width: 1600, height: 1200 },
  args: ["--no-first-run", ...(isRoot ? ["--no-sandbox","--disable-dev-shm-usage"] : [])],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
await page.goto("file://" + html_path, { waitUntil: "networkidle0", timeout: 20000 });
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: path.join(TOUR, "_contact.png"), fullPage: true });
await browser.close();
console.log("contact sheet: " + path.join(TOUR, "_contact.png"));
