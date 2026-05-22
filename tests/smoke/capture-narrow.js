// Capture Keel chrome at a narrower viewport (800px) to verify the chrome
// adapts gracefully when there's less horizontal room than a typical desktop.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../..");
const OUT  = path.join(ROOT, "build/preview/narrow");
await mkdir(OUT, { recursive: true });

const overlay = await readFile(path.join(ROOT, "tests/smoke/keel-overlay.script.js"), "utf8");

const sites = [
  { name: "linear",    url: "https://linear.app",         theme: "dark"  },
  { name: "tailwind",  url: "https://tailwindcss.com",    theme: "light" },
  { name: "anthropic", url: "https://www.anthropic.com",  theme: "light" },
  { name: "github",    url: "https://github.com",         theme: "dark"  },
];

const isRoot = process.getuid && process.getuid() === 0;
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/brave-browser",
  headless: "new",
  defaultViewport: { width: 820, height: 700 },
  args: ["--no-first-run","--no-default-browser-check",
         ...(isRoot ? ["--no-sandbox","--disable-dev-shm-usage"] : [])],
});

for (const s of sites) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 820, height: 700, deviceScaleFactor: 1.5 });
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: s.theme }]);
    await page.goto(s.url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await new Promise(r => setTimeout(r, 2200));
    await page.evaluate(overlay);
    await new Promise(r => setTimeout(r, 2200));
    await page.evaluate(() => {
      const k = document.getElementById("__keel_chrome__");
      if (k) k.dataset.state = "visible";
    });
    await new Promise(r => setTimeout(r, 350));
    await page.screenshot({ path: path.join(OUT, `${s.name}.png`) });
    console.log("ok", s.name);
  } catch (e) {
    console.log("fail", s.name, e.message?.slice(0, 80));
  }
  await page.close();
}
await browser.close();
