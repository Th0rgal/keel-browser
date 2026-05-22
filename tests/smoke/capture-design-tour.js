// Capture Keel chrome overlay on a curated set of beautifully-designed
// websites. Two screenshots per site: chrome hidden (steady state) and
// chrome visible (summoned).

import puppeteer from "puppeteer-core";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../..");
const OUT  = path.join(ROOT, "build/preview/tour");
await mkdir(OUT, { recursive: true });

const overlay = await readFile(path.join(ROOT, "tests/smoke/keel-overlay.script.js"), "utf8");

const sites = [
  { name: "01-verity",     url: "https://veritylang.com",    theme: "dark"  },
  { name: "02-apple",      url: "https://www.apple.com",     theme: "dark"  },
  { name: "03-linear",     url: "https://linear.app",        theme: "dark"  },
  { name: "04-vercel",     url: "https://vercel.com",        theme: "dark"  },
  { name: "05-stripe",     url: "https://stripe.com",        theme: "light" },
  { name: "06-anthropic",  url: "https://www.anthropic.com", theme: "light" },
  { name: "07-arxiv",      url: "https://arxiv.org",         theme: "light" },
  { name: "08-tailwind",   url: "https://tailwindcss.com",   theme: "light" },
  { name: "09-github",     url: "https://github.com",        theme: "dark"  },
  { name: "10-pitch",      url: "https://pitch.com",         theme: "dark"  },
  { name: "11-framer",     url: "https://www.framer.com",    theme: "light" },
  { name: "12-figma",      url: "https://www.figma.com",     theme: "light" },
  { name: "13-notion",     url: "https://www.notion.so",     theme: "light" },
  { name: "14-ramp",       url: "https://ramp.com",          theme: "dark"  },
  // Novel coverage: image-hero, terminal-style, magazine, news.
  { name: "15-pitchfork",  url: "https://pitchfork.com",     theme: "light" },
  { name: "16-supabase",   url: "https://supabase.com",      theme: "dark"  },
  { name: "17-readme",     url: "https://en.wikipedia.org/wiki/Mount_Everest", theme: "light" },
  { name: "18-news",       url: "https://news.ycombinator.com", theme: "light" },
  // Diversity: rich app, social, marketplace, media.
  { name: "19-youtube",    url: "https://www.youtube.com",   theme: "dark"  },
  { name: "20-airbnb",     url: "https://www.airbnb.com",    theme: "light" },
  { name: "21-spotify",    url: "https://www.spotify.com",   theme: "dark"  },
  { name: "22-mozilla",    url: "https://www.mozilla.org",   theme: "light" },
  // High-information density, content-heavy
  { name: "23-nyt",        url: "https://www.nytimes.com",   theme: "light" },
  { name: "24-reddit",     url: "https://www.reddit.com",    theme: "dark"  },
  { name: "25-bbc",        url: "https://www.bbc.com",       theme: "light" },
  { name: "26-substack",   url: "https://substack.com",      theme: "light" },
];

const isRoot = process.getuid && process.getuid() === 0;
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/brave-browser",
  headless: "new",
  defaultViewport: { width: 1400, height: 900 },
  args: ["--no-first-run","--no-default-browser-check",
         ...(isRoot ? ["--no-sandbox","--disable-dev-shm-usage"] : [])],
});

const results = [];
for (const s of sites) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1.5 });
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: s.theme }]);
    await page.goto(s.url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await new Promise(r => setTimeout(r, 2200));
    await page.evaluate(overlay);
    // Force hidden state for "steady" shot
    await new Promise(r => setTimeout(r, 2200)); // let initial flash fade
    await page.evaluate(() => {
      const k = document.getElementById("__keel_chrome__");
      if (k) k.dataset.state = "hidden";
    });
    await new Promise(r => setTimeout(r, 350));
    await page.screenshot({ path: path.join(OUT, `${s.name}_hidden.png`) });
    // Now force visible state for "summoned" shot
    await page.evaluate(() => {
      const k = document.getElementById("__keel_chrome__");
      if (k) k.dataset.state = "visible";
    });
    await new Promise(r => setTimeout(r, 350));
    await page.screenshot({ path: path.join(OUT, `${s.name}_summoned.png`) });
    console.log("ok", s.name);
    results.push({ name: s.name, ok: true });
  } catch (e) {
    console.log("fail", s.name, e.message?.slice(0, 80));
    results.push({ name: s.name, ok: false, err: e.message?.slice(0, 200) });
  }
  await page.close();
}
await browser.close();
console.log(JSON.stringify(results.filter(r=>!r.ok), null, 2));
