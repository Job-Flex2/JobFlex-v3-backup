// Signs qa@acme.test in on the roof demo stand ($BASE) and keeps the session in $STAND/state.json.
const { chromium } = require("playwright-core");
const fs = require("fs");
const BASE = process.env.BASE || "http://localhost:3511";
const STAND = process.env.STAND || ".cache/roof-rec";
const pass = fs.readFileSync("C:/Projects/JobFlex-v3-copy/.env.local", "utf8").match(/^QA_PASS_OWNER=(.*)$/m)[1].replace(/^"|"$/g, "").trim();
(async () => {
  const b = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/auth/login?email=qa%40acme.test`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.locator("#loginEmail").waitFor({ timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.locator('[data-consent="accept-all"]').first().click({ timeout: 2000 }).catch(() => {});
  for (let i = 0; i < 5 && (await page.inputValue("#loginEmail")) !== "qa@acme.test"; i++) { await page.fill("#loginEmail", "qa@acme.test"); await page.waitForTimeout(400); }
  if (!(await page.locator("#loginPassword").isVisible().catch(() => false))) await page.click("#usePasswordLink");
  await page.fill("#loginPassword", pass);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/auth/login"), { timeout: 60000 }).catch(() => {}), page.click("#signInBtn")]);
  console.log("at", page.url());
  await ctx.storageState({ path: `C:/Projects/JobFlex-v3-copy/${STAND}/state.json` });
  await b.close();
})().catch((e) => { console.error("LOGIN ERROR", e.message.split("\n")[0]); process.exit(1); });
