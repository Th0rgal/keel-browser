// Render the navbar mockup in several states: 4 tabs (verity / hn / arxiv / github).
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
  defaultViewport: { width: 1360, height: 920 },
  args: ["--no-first-run","--no-default-browser-check",
         ...(isRoot ? ["--no-sandbox","--disable-dev-shm-usage"] : [])],
});

async function shot(name, tabKey) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 920, deviceScaleFactor: 2 });
  await page.goto(`file://${ROOT}/docs/design/navbar-mockup.html`, { waitUntil: "domcontentloaded" });
  await new Promise(r => setTimeout(r, 250));
  if (tabKey) {
    await page.evaluate(t => { window.activate?.(t); }, tabKey);
    await new Promise(r => setTimeout(r, 250));
  }
  // Clip to just the window
  const clip = await page.evaluate(() => {
    const w = document.getElementById("win").getBoundingClientRect();
    return { x: Math.floor(w.x), y: Math.floor(w.y), width: Math.ceil(w.width), height: Math.ceil(w.height) };
  });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), clip });
  console.log("wrote", `${name}.png`);
  await page.close();
}

await shot("navbar_safari_verity", "verity");
await shot("navbar_safari_hn", "hn");
await shot("navbar_safari_arxiv", "arxiv");
await shot("navbar_safari_github", "github");

// Full-page (window + legend + decisions) for the canonical README image
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 1180, deviceScaleFactor: 2 });
  await page.goto(`file://${ROOT}/docs/design/navbar-mockup.html`, { waitUntil: "domcontentloaded" });
  await new Promise(r => setTimeout(r, 250));
  await page.screenshot({ path: path.join(OUT, "navbar_safari_full.png"), fullPage: true });
  console.log("wrote", "navbar_safari_full.png");
  await page.close();
}

await browser.close();
console.log("OK");
