// Launch Brave on veritylang.com, inject the Keel chrome overlay, screenshot
// in both states (collapsed strip + summoned bar) in dark and light.

import puppeteer from "puppeteer-core";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../..");
const OUT  = path.join(ROOT, "build/preview");
await mkdir(OUT, { recursive: true });

const overlay = await readFile(path.join(ROOT, "tests/smoke/keel-overlay.script.js"), "utf8");

const isRoot = process.getuid && process.getuid() === 0;
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/brave-browser",
  headless: "new",
  defaultViewport: { width: 1400, height: 900 },
  args: [
    "--no-first-run", "--no-default-browser-check",
    ...(isRoot ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
  ],
});

async function shoot(theme) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
  await page.goto("https://veritylang.com", { waitUntil: "networkidle0", timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));

  await page.evaluate(overlay);
  await new Promise(r => setTimeout(r, 250));

  await page.screenshot({ path: path.join(OUT, `verity_keel_${theme}_collapsed.png`) });

  await page.evaluate(() => {
    document.getElementById("__keel_chrome__").dataset.state = "expanded";
  });
  await new Promise(r => setTimeout(r, 250));
  await page.screenshot({ path: path.join(OUT, `verity_keel_${theme}_expanded.png`) });

  console.log("wrote", `verity_keel_${theme}_{collapsed,expanded}.png`);
  await page.close();
}

await shoot("dark");
await shoot("light");

await browser.close();
console.log("OK");
