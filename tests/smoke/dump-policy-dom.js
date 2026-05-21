// Debug helper. Dump the structure of brave://policy so we can write robust
// selectors. Not part of the smoke run.

import puppeteer from "puppeteer-core";
import { writeFile } from "node:fs/promises";

const isRoot = process.getuid && process.getuid() === 0;
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/brave-browser",
  headless: "new",
  defaultViewport: { width: 1280, height: 800 },
  args: [
    "--no-first-run", "--no-default-browser-check",
    ...(isRoot ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
  ],
});
const page = await browser.newPage();
await page.goto("chrome://policy/", { waitUntil: "networkidle0", timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));
const html = await page.content();
await writeFile("/workspaces/mission-c074b317/keel-browser/build/smoke/policy-dom.html", html);
const policies = await page.evaluate(() => {
  // Walk shadow roots
  const all = [];
  function walk(root) {
    if (!root) return;
    const els = root.querySelectorAll("*");
    els.forEach(el => {
      const tag = el.tagName.toLowerCase();
      if (tag.includes("policy") || el.classList?.contains?.("name") || el.classList?.contains?.("policy-name")) {
        all.push({
          tag,
          classes: [...(el.classList||[])].join(" "),
          text: (el.textContent || "").trim().slice(0,80),
        });
      }
      if (el.shadowRoot) walk(el.shadowRoot);
    });
  }
  walk(document);
  return all.slice(0, 60);
});
console.log(JSON.stringify(policies, null, 2));
await browser.close();
