// Real screenshot of veritylang.com loaded in Brave with Keel policies active.
// No mocking, no fake content — what Brave actually renders right now.
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

for (const theme of ["dark", "light"]) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
  await page.goto("https://veritylang.com", { waitUntil: "networkidle0", timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));   // let any hydration settle

  const meta = await page.evaluate(() => ({
    title: document.title,
    themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
    h1: document.querySelector("h1")?.innerText?.slice(0, 120),
    aboveFoldText: document.body.innerText.split("\n").slice(0, 12).map(s => s.trim()).filter(Boolean),
  }));
  console.log(theme, JSON.stringify(meta, null, 2));

  await page.screenshot({ path: path.join(OUT, `verity_real_${theme}.png`), fullPage: false });
  await page.close();
}
await browser.close();
console.log("OK");
