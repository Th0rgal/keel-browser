// Render the navbar mockup in several states for the README + design doc.
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
  defaultViewport: { width: 1320, height: 1100 },
  args: ["--no-first-run","--no-default-browser-check",
         ...(isRoot ? ["--no-sandbox","--disable-dev-shm-usage"] : [])],
});

async function screenshot(name, fn) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1320, height: 1100, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.goto(`file://${ROOT}/docs/design/navbar-mockup.html`, { waitUntil: "domcontentloaded" });
  await new Promise(r => setTimeout(r, 300));
  await fn(page);
  await new Promise(r => setTimeout(r, 250));
  // Clip to just the window (drop the legend rows below it) for the main shots.
  const clipFull = { x: 0, y: 0, width: 1320, height: 1100 };
  const clipWindow = await page.evaluate(() => {
    const w = document.getElementById("win").getBoundingClientRect();
    return { x: Math.floor(w.x), y: Math.floor(w.y), width: Math.ceil(w.width), height: Math.ceil(w.height) };
  });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), clip: clipWindow });
  console.log("wrote", `${name}.png`);
  await page.close();
}

await screenshot("navbar_collapsed", async (page) => {
  // Verity active, collapsed strip
  await page.evaluate(() => window.activate?.(0));
});

await screenshot("navbar_expanded", async (page) => {
  await page.evaluate(() => {
    window.activate?.(0);
    document.getElementById("win").dataset.state = "expanded";
  });
});

await screenshot("navbar_expanded_hn", async (page) => {
  await page.evaluate(() => {
    // Switch to Hacker News (warm tab accent), expanded
    document.querySelectorAll(".tab")[1]?.click?.();
    document.getElementById("win").dataset.state = "expanded";
  });
});

await screenshot("navbar_expanded_arxiv_truncate", async (page) => {
  await page.evaluate(() => {
    // arXiv has the long title — shows truncation
    document.querySelectorAll(".tab")[2]?.click?.();
    document.getElementById("win").dataset.state = "expanded";
  });
});

await screenshot("navbar_collapsed_github", async (page) => {
  await page.evaluate(() => {
    // Cycle to GitHub — green accent — collapsed
    document.querySelectorAll(".tab")[3]?.click?.();
  });
});

// Full-page shot (window + legend + decisions row) as the canonical design preview
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1320, height: 1100, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.goto(`file://${ROOT}/docs/design/navbar-mockup.html`, { waitUntil: "domcontentloaded" });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => {
    document.getElementById("win").dataset.state = "expanded";
  });
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: path.join(OUT, "navbar_full_design.png"), fullPage: true });
  console.log("wrote", "navbar_full_design.png");
  await page.close();
}

await browser.close();
console.log("OK");
