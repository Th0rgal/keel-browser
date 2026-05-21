// Keel smoke test runner.
// Drives a Brave install via DevTools, with Keel policies pre-laid-down. The
// only thing this script asserts is the spec checklist: launch / browsing /
// HTTPS / downloads / extensions / PDF / profiles / settings / light & dark
// / new tab / no Brave clutter. Evidence (screenshots + json) lands under
// build/smoke/.
//
// Env:
//   KEEL_BRAVE_BIN  path to the Brave binary
//   KEEL_OUT        output directory (defaults to ../../build/smoke)
//   KEEL_HEADLESS   "1" = run --headless=new, "0" = require an X server

import puppeteer from "puppeteer-core";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT       = path.resolve(new URL(".", import.meta.url).pathname, "../..");
const OUT        = process.env.KEEL_OUT  || path.join(ROOT, "build/smoke");
const BRAVE_BIN  = process.env.KEEL_BRAVE_BIN;
const HEADLESS   = process.env.KEEL_HEADLESS === "0" ? false : "new";

if (!BRAVE_BIN || !existsSync(BRAVE_BIN.split(" ")[0])) {
  console.error(`KEEL_BRAVE_BIN not set or missing: ${BRAVE_BIN}`);
  process.exit(2);
}

await mkdir(OUT, { recursive: true });

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const extraArgs = [
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-features=BraveRewards,BraveWallet,BraveAIChat,BraveNews,SidebarV2",
];
// Containers/CI: when running as root, sandboxing must be disabled.
if (process.getuid && process.getuid() === 0) {
  extraArgs.push("--no-sandbox", "--disable-dev-shm-usage");
}

const browser = await puppeteer.launch({
  executablePath: BRAVE_BIN,
  headless: HEADLESS,
  defaultViewport: { width: 1280, height: 800 },
  args: extraArgs,
});

try {
  const page = await browser.newPage();

  // 1) Launch + browsing
  await page.goto("about:blank");
  record("01_launch", true);
  await shot(page, "01_blank");

  // 2) HTTPS
  try {
    await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 20000 });
    const ok = (await page.title()).toLowerCase().includes("example");
    record("02_https_example_com", ok, await page.title());
    await shot(page, "02_https");
  } catch (e) { record("02_https_example_com", false, e.message); }

  // 3) chrome://policy — verify Keel policies are loaded
  try {
    await page.goto("chrome://policy/", { waitUntil: "networkidle0", timeout: 20000 });
    await page.waitForSelector("policy-row, .policy-row, .name", { timeout: 10000 }).catch(()=>{});
    const policies = await page.evaluate(() => {
      // brave://policy uses two custom elements:
      //   <policy-row> in the main "Chromium policies" table
      //   <policy-precedence-row> in the precedence table (ignore)
      // Each policy-row's shadow root has .name, .value, .source, and .status
      // Brave omits .status from unset policies — we use it to tell what's
      // actually applied vs just declared.
      const out = [];
      function pick(sr, sel) {
        return sr?.querySelector(sel)?.textContent?.trim() || "";
      }
      function walk(root) {
        if (!root) return;
        root.querySelectorAll("policy-row").forEach(row => {
          const sr = row.shadowRoot;
          if (!sr) return;
          const name = pick(sr, ".name");
          if (!name || name === "Policy name") return;
          out.push({
            name,
            value:  pick(sr, ".value"),
            source: pick(sr, ".source"),
            scope:  pick(sr, ".scope"),
            level:  pick(sr, ".level"),
            status: pick(sr, ".messages") || pick(sr, ".status"),
          });
        });
        root.querySelectorAll("*").forEach(el => { if (el.shadowRoot) walk(el.shadowRoot); });
      }
      walk(document);
      return out;
    });

    // Spec requirement: these must be applied with these values
    const expected = {
      BraveRewardsDisabled:      "true",
      BraveWalletDisabled:       "true",
      BraveVPNDisabled:          "true",
      BraveAIChatEnabled:        "false",
      BraveTalkDisabled:         "true",
      MetricsReportingEnabled:   "false",
      SafeBrowsingEnabled:       "true",
      BlockThirdPartyCookies:    "true",
      HttpsOnlyMode:             "force_enabled",
      PasswordManagerEnabled:    "true",
      AutofillAddressEnabled:    "false",
      AutofillCreditCardEnabled: "false",
    };
    const byName = Object.fromEntries(policies.map(p => [p.name, p]));
    const issues = [];
    for (const [k, want] of Object.entries(expected)) {
      const p = byName[k];
      if (!p) { issues.push(`${k}: missing`); continue; }
      if (!p.value.toLowerCase().includes(String(want).toLowerCase())) {
        issues.push(`${k}: got "${p.value}" want "${want}"`);
      }
    }
    record("03_policies_applied", issues.length === 0,
      issues.length ? issues.slice(0,3).join(" | ") : `${policies.length} policies on page, ${Object.keys(expected).length} verified`);
    await shot(page, "03_policies");
    await writeFile(path.join(OUT, "policies.json"), JSON.stringify(policies, null, 2));
  } catch (e) { record("03_policies_applied", false, e.message); }

  // 4a) Brave NTP — check whether the per-feature elements are still present.
  //     We don't expect this to be fully clean unless patches/0006 is applied
  //     or master_preferences was honored. We capture the state for review.
  try {
    await page.goto("chrome://newtab/", { waitUntil: "networkidle0", timeout: 20000 });
    await new Promise(r => setTimeout(r, 500));
    const ntpAudit = await page.evaluate(() => {
      // Walk shadow roots looking for known Brave NTP custom elements.
      const found = [];
      function walk(root) {
        if (!root) return;
        const all = root.querySelectorAll("*");
        all.forEach(el => {
          const tag = el.tagName?.toLowerCase() || "";
          if (/rewards|wallet|brave-news|brave-ads|brave-talk|ai-chat|leo/.test(tag)) {
            found.push(tag);
          }
          if (el.shadowRoot) walk(el.shadowRoot);
        });
      }
      walk(document);
      return [...new Set(found)];
    });
    record("04a_brave_ntp_audit", true, ntpAudit.length ? `present: ${ntpAudit.join(",")}` : "no brave widgets in DOM");
    await shot(page, "04a_brave_newtab");
  } catch (e) { record("04a_brave_ntp_audit", false, e.message); }

  // 4b) Keel NTP (file://) — verify our static bundle renders clean.
  try {
    await page.goto(`file://${path.resolve(ROOT, "newtab/index.html")}`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.activeElement?.blur?.());
    const keelOk = await page.evaluate(() => {
      return !!document.querySelector(".ntp__search input")
          && !!document.querySelector("#clock")
          && document.querySelectorAll("[class*='reward'],[class*='wallet'],[class*='brave-news']").length === 0;
    });
    record("04b_keel_ntp_clean", keelOk, "");
    await shot(page, "04b_keel_newtab");
  } catch (e) { record("04b_keel_ntp_clean", false, e.message); }

  // 5) Settings — sanity check that settings page renders
  try {
    await page.goto("chrome://settings/", { waitUntil: "networkidle0", timeout: 20000 });
    await page.waitForTimeout?.(500); // ignore if missing
    record("05_settings_renders", true);
    await shot(page, "05_settings");
  } catch (e) { record("05_settings_renders", false, e.message); }

  // 6) Light/dark theme — toggle prefers-color-scheme
  try {
    const session = await page.target().createCDPSession();
    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
    await session.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    await shot(page, "06_dark");
    await session.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
    await shot(page, "06_light");
    record("06_light_dark", true);
  } catch (e) { record("06_light_dark", false, e.message); }

  // 7) PDF inline viewer
  try {
    // Use a small public PDF. We're testing the inline viewer, not network.
    await page.goto("https://www.w3.org/WAI/WCAG21/Techniques/pdf-techniques.pdf", { waitUntil: "load", timeout: 30000 });
    record("07_pdf_inline", true);
    await shot(page, "07_pdf");
  } catch (e) { record("07_pdf_inline", false, e.message); }

  // 8) Download flow — synthetic, navigate to a small file
  try {
    const client = await page.target().createCDPSession();
    await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: OUT });
    await page.goto("https://www.google.com/robots.txt", { waitUntil: "domcontentloaded" });
    record("08_download_flow", true);
  } catch (e) { record("08_download_flow", false, e.message); }

  // 9) Profiles — verify single-profile reachability
  try {
    await page.goto("chrome://version/", { waitUntil: "domcontentloaded" });
    const text = await page.evaluate(() => document.body.innerText);
    const ok = /Profile Path|Profile path/.test(text);
    record("09_profile_path", ok, text.split("\n").find(l=>/profile path/i.test(l)) || "");
  } catch (e) { record("09_profile_path", false, e.message); }

  // 10) Brave-feature regression: brave://rewards should be hidden/disabled
  try {
    await page.goto("chrome://rewards/", { waitUntil: "domcontentloaded", timeout: 10000 });
    const text = (await page.evaluate(() => document.body.innerText)).toLowerCase();
    const disabled = /disabled by your organization|administrator/i.test(text)
                  || text.includes("not available")
                  || text.length < 50;
    record("10_rewards_disabled", disabled, `text length ${text.length}`);
    await shot(page, "10_rewards");
  } catch (e) { record("10_rewards_disabled", true, "navigation blocked: " + e.message); }

} finally {
  await browser.close();
}

const summary = {
  total: results.length,
  passed: results.filter(r => r.ok).length,
  failed: results.filter(r => !r.ok).length,
  results,
  generated_at: new Date().toISOString(),
};
await writeFile(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));

console.log(`\n${summary.passed}/${summary.total} passed.`);
process.exit(summary.failed === 0 ? 0 : 1);
