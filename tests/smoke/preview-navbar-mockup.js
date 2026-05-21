// Render the navbar-ideas mockup in both states (collapsed + expanded).
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
  defaultViewport: { width: 1320, height: 800 },
  args: ["--no-first-run","--no-default-browser-check",
         ...(isRoot ? ["--no-sandbox","--disable-dev-shm-usage"] : [])],
});

const page = await browser.newPage();
await page.setViewport({ width: 1320, height: 800, deviceScaleFactor: 2 });
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
await page.goto(`file://${ROOT}/docs/design/navbar-mockup.html`, { waitUntil: "domcontentloaded" });
await new Promise(r => setTimeout(r, 400));

await page.screenshot({ path: path.join(OUT, "navbar_collapsed.png") });

await page.evaluate(() => document.getElementById("win").dataset.state = "expanded");
await new Promise(r => setTimeout(r, 250));
await page.screenshot({ path: path.join(OUT, "navbar_expanded.png") });

await browser.close();
console.log("OK");
