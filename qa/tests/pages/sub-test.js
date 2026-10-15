// Functional pass over /dashboard/subscription — rewritten 2026-10-01 for the rebuilt page:
// the current-plan hero, the upgrade page's own plan cards embedded (#plans), usage, billing,
// refer & earn, the comparison table, and the handheld build at 390.
//
// Nothing here reaches Stripe: a plan button opens the confirmation dialog and the script
// CANCELS it (a request to /api/checkout or a plan change fails the run); the page picker is
// opened, ticked and closed. The account is qa@acme.test, OWNER of QA Co.
// The server under test: QA_BASE_URL, else localhost:QA_PORT (default 3000) — see ./_qa.js.
const QA_BASE = require("../_lib/_qa").BASE;
const { launch, signIn } = require("../_lib/_qa");

let fails = 0;
const log = (ok, name, extra = "") => {
  if (!ok) fails++;
  console.log((ok ? "PASS" : "FAIL") + " | " + name + (extra ? " | " + extra : ""));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1728, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  const errors = [];
  const billing = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 200)));
  page.on("request", (r) => { if (/\/api\/checkout|stripe\.com/.test(r.url()) ) billing.push(r.method() + " " + r.url().slice(0, 90)); });

  await signIn(page);

  // ---- the sidebar reaches the page ----
  await page.goto(QA_BASE + "/dashboard", { waitUntil: "domcontentloaded" });
  await sleep(2500);
  const sbLink = page.locator('.sb a[href="/dashboard/subscription"]');
  log((await sbLink.count()) > 0, "sidebar: Subscription link present");
  await page.goto(QA_BASE + "/dashboard/subscription", { waitUntil: "domcontentloaded" });
  await sleep(3500);

  // ---- hero ----
  const planName = ((await page.locator("[class*=sub-hero-name]").first().textContent().catch(() => "")) || "").trim();
  log(planName.length > 0, "hero: current plan named", planName);
  const stamp = ((await page.locator("[class*=sub-stamp]").first().textContent().catch(() => "")) || "").trim();
  log(stamp.length > 0 && stamp !== "—", "hero: status stamp", stamp);

  // ---- plan cards (the upgrade page's own) ----
  const cards = page.locator("#plans .jf-up-plan");
  const nCards = await cards.count();
  log(nCards >= 3, "plans: cards render (catalog + build-your-own)", String(nCards));
  log((await page.locator("#plans .jf-up-plan.cur, #plans .jf-up-curlbl").count()) > 0 || /^(Free|None)$/i.test(planName), "plans: the current plan is marked (or the org has no paid plan)", planName);
  const go = page.locator("#plans .jf-up-plan:not(.custom) .jf-up-go:not([disabled])").first();
  if (await go.count()) {
    const label = ((await go.textContent()) || "").trim();
    const before = page.url();
    await go.click();
    await sleep(700);
    const dlg = page.locator(".jf-confirm.is-on");
    const open = (await dlg.count()) > 0;
    const title = open ? ((await dlg.locator(".jf-confirm-h").textContent()) || "").trim() : "";
    log(open && title.length > 0, `plans: "${label}" asks first (confirmation dialog)`, title);
    if (open) {
      await dlg.locator(".jf-confirm-btn:not(.primary)").click();
      await sleep(500);
    }
    log((await page.locator(".jf-confirm.is-on").count()) === 0 && page.url() === before, "plans: Cancel closes it and nothing moves");
  } else log(false, "plans: no plan button to press");
  const custom = page.locator("#plans .jf-up-plan.custom .jf-up-go");
  if (await custom.count()) {
    await custom.click();
    await sleep(600);
    const pick = page.locator(".jf-up-pick.is-on");
    log((await pick.count()) > 0, "plans: Choose pages opens the page picker");
    const rows = pick.locator(".jf-up-pick-row");
    const nRows = await rows.count();
    if (nRows) {
      const cls0 = await rows.first().getAttribute("class");
      await rows.first().click();
      await sleep(300);
      const cls1 = await rows.first().getAttribute("class");
      log(cls0 !== cls1, "plans: a page ticks in the picker", `${nRows} pages`);
      await rows.first().click();
      await sleep(200);
    } else log(false, "plans: the picker lists no pages");
    await pick.locator(".jf-up-pick-x").click();
    await sleep(500);
    log((await page.locator(".jf-up-pick.is-on").count()) === 0, "plans: the picker closes");
  } else log(false, "plans: no Build-your-plan card");

  // ---- usage ----
  const usRows = await page.locator("#usList [class*=us-row]").count();
  const usNote = await page.locator("#usList [class*=us-note]").count();
  log(usRows > 0 || usNote > 0, "usage: rows or an honest note", `${usRows} rows`);
  if (usRows) {
    const widths = await page.locator("#usList [class*=us-fill]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-w"), e.style.width]));
    log(widths.every(([w, s]) => s && (Number(w) === 0 || s !== "0px")), "usage: bars drawn to their share", JSON.stringify(widths.slice(0, 4)));
  }
  await page.evaluate(() => { const m = document.querySelector(".main"); if (m) m.scrollTop = 0; });
  await page.locator('#usageCard a[href="#plans"]').click();
  await sleep(1200);
  const plansTop = await page.evaluate(() => document.querySelector("#plans").getBoundingClientRect().top);
  log(plansTop < 400, "usage: Change plan brings the plans into view", `top ${Math.round(plansTop)}px`);

  // ---- billing ----
  log(await page.locator("#billCard").isVisible(), "billing: card renders");

  // ---- refer & earn ----
  const code = ((await page.locator("#refCode").textContent()) || "").trim();
  log(code.length > 0, "refer: the org's code is shown", code);
  await page.locator("#refCopy").click();
  await sleep(300);
  const lbl = ((await page.locator("#refCopyLbl").textContent()) || "").trim();
  let clip = "";
  try { clip = await page.evaluate(() => navigator.clipboard.readText()); } catch {}
  log(lbl === "Copied" && clip === code, "refer: Copy puts the code on the clipboard", `label=${lbl} clipboard=${clip}`);
  await sleep(1800);
  log(((await page.locator("#refCopyLbl").textContent()) || "").trim() === "Copy", "refer: the label comes back");

  // ---- compare ----
  const mx = await page.locator("#mxTable tbody tr").count();
  log(mx > 0, "compare: feature table rows", String(mx));

  // ---- the head's Upgrade plan goes to the upgrade page ----
  await page.locator('a[href="/dashboard/upgrade"]', { hasText: /Upgrade plan/i }).first().click();
  const toUpgrade = await page.waitForURL(/\/dashboard\/upgrade/, { timeout: 15000 }).then(() => true).catch(() => false);
  log(toUpgrade, "head: Upgrade plan opens /dashboard/upgrade");
  await sleep(2500);
  log((await page.locator(".jf-up-plan").count()) >= 3, "upgrade page: the same plan cards");

  log(billing.length === 0, "nothing reached Stripe or changed the plan", billing.join(" · "));
  log(errors.length === 0, "no console errors", errors.join(" / "));
  await page.screenshot({ path: "subscription_final.png", fullPage: false });

  // ---- the handheld build ----
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.addCookies(await ctx.cookies());
  const m = await phone.newPage();
  await m.goto(QA_BASE + "/dashboard/subscription", { waitUntil: "domcontentloaded" });
  await sleep(4000);
  const body = await m.evaluate(() => document.body.innerText);
  // innerText is the rendered text: the handheld hero is set in capitals.
  log(planName ? body.toUpperCase().includes(planName.toUpperCase()) : body.length > 200, "phone: the handheld build shows the plan", planName);
  log(!(await m.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "phone: no sideways scroll");
  await m.screenshot({ path: "subscription_phone.png" });

  await browser.close();
  console.log(`\n${fails ? fails + " failed" : "all passed"}`);
  if (fails) process.exit(1);
})().catch((e) => { console.error("HARNESS FAIL:", e.message); process.exit(1); });
