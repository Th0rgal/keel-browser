// Capture a screenshot of brave://policy filtered to the new analytics keys.
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
  defaultViewport: { width: 1400, height: 900 },
  args: ["--no-first-run","--no-default-browser-check",
         ...(isRoot ? ["--no-sandbox","--disable-dev-shm-usage"] : [])],
});

const targets = [
  "MetricsReporting", "Url", "Safe", "Variations", "Feedback",
  "Predict", "AlternateError", "SearchSuggest", "Translate",
];

const page = await browser.newPage();
await page.goto("chrome://policy/", { waitUntil: "networkidle0", timeout: 30000 });
await new Promise(r => setTimeout(r, 1500));

// Sift policies that match our analytics-keyword list and snapshot their state
const matched = await page.evaluate((targets) => {
  const out = [];
  function walk(root) {
    if (!root) return;
    root.querySelectorAll("policy-row").forEach(row => {
      const sr = row.shadowRoot;
      if (!sr) return;
      const name = sr.querySelector(".name")?.textContent?.trim();
      if (!name || name === "Policy name") return;
      if (targets.some(t => name.toLowerCase().includes(t.toLowerCase()))) {
        out.push({
          name,
          value: sr.querySelector(".value")?.textContent?.trim() || "",
          source: sr.querySelector(".source")?.textContent?.trim() || "",
          level: sr.querySelector(".level")?.textContent?.trim() || "",
        });
      }
    });
    root.querySelectorAll("*").forEach(el => { if (el.shadowRoot) walk(el.shadowRoot); });
  }
  walk(document);
  return out.sort((a,b) => a.name.localeCompare(b.name));
}, targets);

console.log(JSON.stringify(matched, null, 2));

// Filter the page to "Metric" so the screenshot shows our additions
const filter = await page.$("cr-input, input[type=search]");
if (filter) {
  await filter.type("Metric", { delay: 20 });
  await new Promise(r => setTimeout(r, 500));
}
await page.screenshot({ path: path.join(OUT, "keel_policy_hardened.png") });

await browser.close();
console.log("OK");
