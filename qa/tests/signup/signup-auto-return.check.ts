// STRAIGHT TO PROFESSIONAL FOR A RETURNING VISITOR (2026-10-17; lib/signupAutoPlanServer). With the admin switch on
// (Admin → Trials → "Plan at sign-up": Straight to Professional, SyncState `signupPlan`), a visitor who proved their
// address on an earlier visit and comes back while the draft (cookie jf_otp_draft, 24 h) and its intent are alive goes
// to the card page for Professional — the plan cards are never drawn. On a production build, at 390 (iPhone):
//   · the landing's "Start my 7-day FREE TRIAL" with a live draft cookie (the intent written before the switch, no
//     autoPlan mark; Starter remembered by the phone) → Professional, no cards;
//   · the plan step's own address (?signup=<token>) and a `?checkout=cancelled` address opened anywhere but the tab
//     that handed off → Professional, no cards;
//   · a tab drawn while the switch was OFF, the code typed after it went ON → Professional, no cards (the step asks
//     the server as it opens, not the page's copy);
//   · the tab remembering Annual (and ?billing=annual) → the screen prints the MONTHLY price and Checkout is opened on
//     it — read back from Stripe's sandbox when dev.db is in test mode;
//   · backing out of the card page in the same tab → the cards with the calm note, Professional chosen (as built);
//   · the switch OFF → the plan cards, as before;
//   · on every step: no console error, no page error, no 4xx/5xx from this server.
// The card page is not opened: /api/checkout/signup is answered here with a fake Checkout address, so the check reads
// which plan the page asked for and creates nothing at Stripe. dev.db's `signupPlan` row is put back as it was; the
// drafts, intents and brake rows the run writes are removed.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/signup/signup-auto-return.check.ts
// QA_AUTO_URL=http://localhost:NNNN uses a server already up instead (no build, no start). QA_DATABASE_URL=file:<copy>
// points the check (and the server it starts) at a copy of dev.db instead.
import type { ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { ROOT, ensureBuild, playwright, startServer, stopServer } from "../_lib/_prod-server";
import { autoPlanPrice } from "../../../src/lib/signupAutoPlan";

const PORT = Number(process.env.QA_AUTO_PORT || 3314);
const BASE = (process.env.QA_AUTO_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const DB_URL = process.env.QA_DATABASE_URL || "";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const STAMP = Date.now();
const MAIL_DOMAIN = `autoreturn${STAMP}.test`;
const CODE = "864213";
const HOUR = 3_600_000;
const KEY = "signupPlan";
const db = new PrismaClient(DB_URL ? { datasources: { db: { url: DB_URL } } } : undefined);
let bad = 0;
const check = (name: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const note = (name: string, extra = "") => console.log(`note ${name}${extra ? " — " + extra : ""}`);
const octet = () => 1 + Math.floor(Math.random() * 250);
const IPS: string[] = [];
const DRAFTS: string[] = [];
const SIGNUPS: string[] = [];
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** The switch, as Admin → Trials writes it; the server reads it through a 10 s cache. */
async function setSwitch(mode: "auto" | "pick") {
  const cursor = JSON.stringify({ mode, by: "signup-auto-return.check", at: new Date().toISOString() });
  await db.syncState.upsert({ where: { key: KEY }, create: { key: KEY, cursor }, update: { cursor } });
  await new Promise((r) => setTimeout(r, 11_000));
}

// Playwright is loaded at run time (../_lib/_prod-server); its types come from wherever it was found.
type Browser = Awaited<ReturnType<ReturnType<typeof playwright>["chromium"]["launch"]>>;
type Req = { url(): string; method(): string; headers(): Record<string, string>; postData(): string | null };
type Route = { request(): Req; continue(o?: object): Promise<void>; fulfill(o: object): Promise<void>; fetch(o?: object): Promise<{ json(): Promise<unknown> }> };
type Msg = { type(): string; text(): string };
type Res = { status(): number; url(): string; request(): Req };

/* A phone, its own made-up IP; the card page answered here. `seen()` says whether plan cards were ever on screen
   (sampled every 50 ms from the first script on), `asked` which plan the page sent to the card page. */
async function visitor(browser: Browser, opts: { realCheckout?: boolean } = {}) {
  const ip = `10.${octet()}.${octet()}.${octet()}`;
  IPS.push(ip);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IPHONE, locale: "en-US" });
  await ctx.addInitScript({ content: "window.__name = function (f) { return f; };" });
  const out: { asked: string | null; interval: string | null; session: string | null; checkout: boolean; cardsSeen: number; autoText: string } = { asked: null, interval: null, session: null, checkout: false, cardsSeen: 0, autoText: "" };
  // Every 50 ms on the register page: how many plan cards are on screen — reported out, so a hand-off can't lose it.
  await ctx.exposeBinding("__qaCards", (_src: unknown, n: number) => { out.cardsSeen = Math.max(out.cardsSeen, n); });
  // …and the straight-to-Professional screen's own words (its price line), the moment it is drawn.
  await ctx.exposeBinding("__qaAuto", (_src: unknown, t: string) => { if (t) out.autoText = t; });
  await ctx.addInitScript({
    content: `(function(){ if (location.pathname !== "/auth/register") return; setInterval(function(){
      var n = [].slice.call(document.querySelectorAll("section.plan-sheet.is-in .pw-plan")).filter(function(c){ return c.offsetParent !== null && getComputedStyle(c).visibility !== "hidden"; }).length;
      if (n && window.__qaCards) window.__qaCards(n);
      var a = document.querySelector(".pw-auto .pw-auto-p"); if (a && window.__qaAuto) window.__qaAuto(a.textContent || ""); }, 50); })();`,
  });
  const host = new URL(BASE).hostname;
  await ctx.addCookies([{ name: "jf_consent", value: encodeURIComponent(JSON.stringify({ v: 1, at: new Date().toISOString(), analytics: false, marketing: false, ack: true })), domain: host, path: "/" }]);
  await ctx.route("**/*", (route: Route) => {
    const req = route.request();
    const u = req.url();
    if (u.startsWith(`${BASE}/api/checkout/signup`) && req.method() === "POST") {
      try { const b = JSON.parse(req.postData() || "{}"); out.asked = b.planSlug ?? null; out.interval = b.interval ?? null; } catch { out.asked = "?"; }
      // The real route (Stripe's sandbox), when the run can read the session it makes; a stand-in address otherwise.
      if (opts.realCheckout) {
        return route.fetch({ headers: { ...req.headers(), "x-forwarded-for": ip } }).then(async (resp) => {
          const body = (await resp.json().catch(() => ({}))) as { url?: string };
          out.session = body.url?.match(/cs_test_[A-Za-z0-9]+/)?.[0] ?? null;
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "https://checkout.stripe.com/c/pay/qa-auto-return" }) });
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "https://checkout.stripe.com/c/pay/qa-auto-return" }) });
    }
    if (u.startsWith(BASE)) return route.continue({ headers: { ...req.headers(), "x-forwarded-for": ip } });
    if (/^https:\/\/checkout\.stripe\.com\//.test(u)) { out.checkout = true; return route.fulfill({ status: 200, contentType: "text/html", body: "<title>checkout</title>" }); }
    if (/^https:\/\/accounts\.google\.com\//.test(u)) return route.fulfill({ status: 200, contentType: "text/html", body: "<title>google</title>" });
    if (/facebook\.(com|net)|posthog|googletagmanager|google-analytics|doubleclick/.test(u)) return route.fulfill({ status: 204, body: "" });
    return route.continue();
  });
  const page = await ctx.newPage();
  const log = { step: "", errs: [] as string[] };
  const push = (what: string) => log.errs.push(`[${log.step}] ${what.replace(/\s+/g, " ").slice(0, 220)}`);
  page.on("console", (m: Msg) => { if (m.type() === "error" && !/does not have a registered handler|^\[Report Only\]|delivered in report-only mode/.test(m.text())) push("console: " + m.text()); });
  page.on("pageerror", (e: Error) => push("pageerror: " + String(e?.message || e)));
  page.on("response", (r: Res) => { if (r.status() >= 400 && r.url().startsWith(BASE)) push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(BASE.length)}`); });
  return { ctx, page, out, step: (s: string) => { log.step = s; }, take: () => log.errs.splice(0).join(" | ") };
}
type V = Awaited<ReturnType<typeof visitor>>;
const failed = (e: unknown, v: V) => `${String((e as Error)?.message || e).split("\n")[0]} · ${v.take()}`;

/* A draft proven `age` ago and the intent it became, as lib/signupOtp wrote them BEFORE the switch (no autoPlan
   mark); the browser that proved it holds the draft's cookie. */
async function plantReturning(email: string, age: number): Promise<{ draft: string; signup: string }> {
  const draft = randomUUID();
  const signup = randomUUID();
  const at = Date.now() - age;
  const d = { v: 1, kind: "signup", email, name: "Back Later", createdAt: at - 5 * 60_000, code: null, lastSentAt: at - 4 * 60_000, linkHash: null, verifiedAt: at, via: "code", signupToken: signup, trialOffer: { variant: "b", days: 7 } };
  await db.syncState.create({ data: { key: `otp:${draft}`, cursor: JSON.stringify(d) } });
  DRAFTS.push(draft);
  const rec = { trialOffer: { variant: "b", days: 7 }, name: "Back Later", businessName: "Back Later", email, tradeTypes: [], signupVariant: "e", attribution: null, customPages: [], hashedPassword: null, viaGoogle: false, image: null, createdAt: at, emailVerifiedAt: at, nameUnset: true, signupMode: "passwordless" };
  await db.syncState.create({ data: { key: `signup:${signup}`, cursor: JSON.stringify(rec) } });
  SIGNUPS.push(signup);
  return { draft, signup };
}
async function holdDraft(v: V, draft: string) {
  await v.ctx.addCookies([{ name: "jf_otp_draft", value: draft, domain: new URL(BASE).hostname, path: "/" }]);
}
/** This tab's memory from the earlier visit: the phone's chosen card, and (optionally) the intent it handed off. */
async function tabMemory(v: V, mem: Record<string, string>) {
  await v.page.goto(`${BASE}/robots.txt`, { timeout: 120000 });
  await v.page.evaluate((m: Record<string, string>) => { for (const [k, val] of Object.entries(m)) sessionStorage.setItem(k, val); }, mem);
}
/** The code the draft named in the address expects (the salted hash lib/signupOtp keeps). */
async function plantCode(url: string) {
  const d = new URL(url).searchParams.get("d") ?? "";
  for (let i = 0; i < 40; i++) {
    const row = await db.syncState.findUnique({ where: { key: `otp:${d}` } });
    if (row) {
      const draft = JSON.parse(row.cursor);
      const salt = draft.code?.salt ?? randomBytes(8).toString("hex");
      draft.code = { salt, hash: sha(`${salt}:${CODE}`), exp: Date.now() + 10 * 60_000, tries: 0 };
      await db.syncState.update({ where: { key: `otp:${d}` }, data: { cursor: JSON.stringify(draft) } });
      DRAFTS.push(d);
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no draft for " + url);
}

type Seen = { asked: string | null; checkout: boolean; cardsSeen: number; autoShown: boolean; chosen: string | null; note: boolean; gate: string | null };
/** Until the card page is asked for (or `ms` pass): what the page asked for and whether cards were drawn. */
async function outcome(v: V, ms = 15000): Promise<Seen> {
  let autoShown = false;
  for (let i = 0; i < ms / 100 && !v.out.checkout; i++) {
    if (!autoShown) autoShown = (await v.page.locator(".pw-auto[data-auto-plan]").count().catch(() => 0)) > 0;
    await v.page.waitForTimeout(100);
  }
  const here = v.out.checkout ? null : await v.page.evaluate(() => ({
    chosen: document.querySelector("section.plan-sheet.is-in .pw-plan.on")?.getAttribute("data-plan-card") ?? null,
    note: !!document.querySelector("[data-auto-plan-back]"),
    gate: document.getElementById("planGate")?.getAttribute("data-gate") ?? null,
  }));
  return { asked: v.out.asked, checkout: v.out.checkout, autoShown, cardsSeen: v.out.cardsSeen, chosen: here?.chosen ?? null, note: here?.note ?? false, gate: here?.gate ?? null };
}

async function scenario(browser: Browser, name: string, run: (v: V) => Promise<void>, expect: (s: Seen) => boolean) {
  const v = await visitor(browser);
  try {
    v.step(name);
    await run(v);
    const s = await outcome(v);
    check(name, expect(s), JSON.stringify(s));
    const e = v.take();
    check(`${name} — no console / page / HTTP errors`, !e, e);
  } catch (e) {
    check(`${name} ran through`, false, failed(e, v));
  } finally {
    await v.ctx.close();
  }
}
const straightToPro = (s: Seen) => s.asked === "professional" && s.checkout && s.cardsSeen === 0;

/* The sandbox key, for reading back the Checkout session the route made (never the live key). */
function sandboxKey(): string | null {
  for (const file of [".env.local", ".env"]) {
    try {
      for (const line of fs.readFileSync(path.join(ROOT, file), "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*STRIPE_SECRET_KEY_TEST\s*=\s*"?([^"\s]+)"?/);
        if (m && m[1].startsWith("sk_test_")) return m[1];
      }
    } catch { /* no file */ }
  }
  return null;
}

/* A REMEMBERED ANNUAL (2026-10-17): the tab chose Annual earlier and the link says ?billing=annual; straight to
   Professional has no term switch, so it prints the MONTHLY price and opens Checkout on the monthly price. With the
   sandbox in reach the session the route made is read back from Stripe: its price is the catalog's monthly one. */
async function rememberedAnnual(browser: Browser) {
  const pro = await db.pricingPlan.findUnique({ where: { slug: "professional" }, select: { priceCents: true, yearlyPriceCents: true } });
  if (!pro) return note("remembered Annual", "no professional plan in the catalog — skipped");
  const mode = (await db.syncState.findUnique({ where: { key: "stripe:mode" } }))?.cursor;
  const key = mode === "test" ? sandboxKey() : null;
  if (!key) note("remembered Annual", `dev.db stripe:mode is "${mode ?? "live"}" or no sandbox key — the session is not read back, only the term asked`);
  const v = await visitor(browser, { realCheckout: !!key });
  const name = "switch ON: the tab remembers Annual (and the link says ?billing=annual) → the screen shows the monthly price, Checkout on the monthly price";
  try {
    v.step(name);
    const { draft } = await plantReturning(`back.annual.${STAMP}@${MAIL_DOMAIN}`, 3 * HOUR);
    await holdDraft(v, draft);
    await tabMemory(v, { jf_billing_term: "YEAR" });
    await v.page.goto(`${BASE}/auth/register?billing=annual`, { waitUntil: "load", timeout: 180000 });
    const s = await outcome(v);
    // The words lib/signupAutoPlan autoPlanPrice prints for the catalog's monthly price.
    const monthly = autoPlanPrice({ priceCents: pro.priceCents });
    const said = v.out.autoText.replace(/\s+/g, " ");
    const yearly = pro.yearlyPriceCents ? said.includes(`$${pro.yearlyPriceCents / 100}`) : false;
    check(`${name}: the screen`, said.includes(monthly) && !yearly && !/\/yr|\/year/.test(said), `"${said}" · expected ${monthly}`);
    check(`${name}: Checkout asked for`, straightToPro(s) && v.out.interval === "MONTH", JSON.stringify({ ...s, interval: v.out.interval }));
    if (key) {
      const sessionId = v.out.session;
      type StripePrice = { unit_amount: number | null; recurring: { interval: string } | null };
      let price = null as StripePrice | null;
      if (sessionId) {
        const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items?expand[]=data.price`, { headers: { Authorization: `Bearer ${key}` } });
        const b = (await r.json().catch(() => ({}))) as { data?: { price?: StripePrice }[] };
        price = b.data?.[0]?.price ?? null;
      }
      check(`${name}: the Stripe session's price = the catalog's monthly price`, !!price && price.unit_amount === pro.priceCents && price.recurring?.interval === "month", JSON.stringify({ sessionId, unitAmount: price?.unit_amount ?? null, interval: price?.recurring?.interval ?? null, catalogMonthly: pro.priceCents }));
    }
    const e = v.take();
    check(`${name} — no console / page / HTTP errors`, !e, e);
  } catch (e) {
    check(`${name} ran through`, false, failed(e, v));
  } finally {
    await v.ctx.close();
  }
}

async function main() {
  const pw = playwright();
  let server: ChildProcess | null = null;
  const before = await db.syncState.findUnique({ where: { key: KEY } });
  try {
    if (!process.env.QA_AUTO_URL) {
      ensureBuild(note);
      server = await startServer(PORT, { STRIPE_SECRET_KEY: "", RESEND_API_KEY: "", SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "", SMTP_PASSWORD: "", ...(DB_URL ? { DATABASE_URL: DB_URL } : {}) }, "QA_AUTO_PORT");
    }
    const browser = await pw.chromium.launch({ channel: "chrome", args: ["--disable-blink-features=AutomationControlled"] }).catch(() => pw.chromium.launch());
    try {
      await setSwitch("auto");
      await rememberedAnnual(browser);
      await scenario(browser, "switch ON: returning with a live draft → landing \"Start my 7-day FREE TRIAL\" → Professional's card page, no plan cards", async (v) => {
        const { draft } = await plantReturning(`back.landing.${STAMP}@${MAIL_DOMAIN}`, 3 * HOUR);
        await holdDraft(v, draft);
        await tabMemory(v, { jf_signup_plan: "starter" });
        await v.page.goto(`${BASE}/`, { waitUntil: "load", timeout: 180000 });
        const cta = v.page.locator('[data-cta="hero"]').first();
        await cta.waitFor({ timeout: 120000 });
        check("the landing's hero button says the trial", /Start my \d+-day FREE TRIAL/.test((await cta.innerText()).trim()), (await cta.innerText()).trim());
        await Promise.all([v.page.waitForURL(/\/auth\/register/, { timeout: 120000 }), cta.click()]);
      }, straightToPro);
      await scenario(browser, "switch ON: returning by the plan step's address (?signup=<token>) → Professional, no plan cards", async (v) => {
        const { draft, signup } = await plantReturning(`back.signup.${STAMP}@${MAIL_DOMAIN}`, 20 * HOUR);
        await holdDraft(v, draft);
        await v.page.goto(`${BASE}/auth/register?signup=${signup}`, { waitUntil: "load", timeout: 180000 });
      }, straightToPro);
      await scenario(browser, "switch ON: a ?checkout=cancelled address opened outside the tab that handed off → Professional, no plan cards", async (v) => {
        const { draft, signup } = await plantReturning(`back.cancelled.${STAMP}@${MAIL_DOMAIN}`, 3 * HOUR);
        await holdDraft(v, draft);
        await v.page.goto(`${BASE}/auth/register?signup=${signup}&checkout=cancelled`, { waitUntil: "load", timeout: 180000 });
      }, straightToPro);
      await scenario(browser, "switch ON: backing out of the card page in the same tab → the cards with the calm note, Professional chosen (Starter remembered is ignored)", async (v) => {
        const { draft, signup } = await plantReturning(`back.out.${STAMP}@${MAIL_DOMAIN}`, 3 * HOUR);
        await holdDraft(v, draft);
        await tabMemory(v, { jf_signup_plan: "starter", jf_signup_handoff: signup });
        await v.page.goto(`${BASE}/auth/register?signup=${signup}&checkout=cancelled`, { waitUntil: "load", timeout: 180000 });
        await v.page.locator("section.plan-sheet.is-in .pw-plan").first().waitFor({ timeout: 60000 });
      }, (s) => !s.checkout && !s.asked && s.cardsSeen > 0 && s.note && s.chosen === "professional");

      // A tab drawn while the switch was OFF: the code screen waits, the owner turns it ON, the code is typed.
      await setSwitch("pick");
      const stale = await visitor(browser);
      try {
        stale.step("stale tab");
        await stale.page.goto(`${BASE}/auth/register?flow=otp`, { waitUntil: "load", timeout: 180000 });
        await stale.page.locator("#nextBtn").waitFor({ timeout: 120000 });
        await stale.page.waitForTimeout(800);
        await stale.page.fill("#name", "Stale Tab");
        await stale.page.fill("#email", `stale.${STAMP}@${MAIL_DOMAIN}`);
        await stale.page.click("#nextBtn");
        await stale.page.locator("#otpCode").waitFor({ timeout: 60000 });
        await plantCode(stale.page.url());
        await setSwitch("auto");
        await stale.page.locator("#otpCode").focus();
        await stale.page.keyboard.type(CODE);
        const s = await outcome(stale);
        check("a tab drawn with the switch OFF, the code typed after it went ON → Professional, no plan cards", straightToPro(s), JSON.stringify(s));
        const e = stale.take();
        check("stale tab — no console / page / HTTP errors", !e, e);
      } catch (e) {
        check("stale tab ran through", false, failed(e, stale));
      } finally {
        await stale.ctx.close();
      }

      await setSwitch("pick");
      await scenario(browser, "switch OFF: returning with a live draft → the plan cards, as before (the phone's Starter chosen)", async (v) => {
        const { draft } = await plantReturning(`back.off.${STAMP}@${MAIL_DOMAIN}`, 3 * HOUR);
        await holdDraft(v, draft);
        await tabMemory(v, { jf_signup_plan: "starter" });
        await v.page.goto(`${BASE}/auth/register?flow=otp`, { waitUntil: "load", timeout: 180000 });
        await v.page.locator("section.plan-sheet.is-in .pw-plan").first().waitFor({ timeout: 60000 });
      }, (s) => !s.checkout && !s.asked && !s.autoShown && s.cardsSeen > 0 && s.chosen === "starter");
    } finally {
      await browser.close();
    }
  } finally {
    stopServer(server);
    if (before) await db.syncState.upsert({ where: { key: KEY }, create: { key: KEY, cursor: before.cursor }, update: { cursor: before.cursor } }).catch(() => {});
    else await db.syncState.deleteMany({ where: { key: KEY } }).catch(() => {});
    await db.syncState.deleteMany({ where: { key: { startsWith: "signup:" }, cursor: { contains: MAIL_DOMAIN } } }).catch(() => {});
    await db.syncState.deleteMany({ where: { key: { startsWith: "otp:" }, cursor: { contains: MAIL_DOMAIN } } }).catch(() => {});
    await db.syncState.deleteMany({ where: { key: { in: [...DRAFTS.map((d) => `otp:${d}`), ...SIGNUPS.map((t) => `signup:${t}`)] } } }).catch(() => {});
    await db.syncState.deleteMany({ where: { key: { startsWith: "otp-link:" }, cursor: { in: DRAFTS } } }).catch(() => {});
    await db.syncState.deleteMany({ where: { OR: [...IPS.map((ip) => ({ key: { startsWith: "rl:", endsWith: ":" + ip } })), ...IPS.map((ip) => ({ key: { startsWith: `rl:otp-signup:${ip}:` } })), { key: { startsWith: "rl:otp-mail:", contains: MAIL_DOMAIN } }] } }).catch(() => {});
    await db.$disconnect();
  }
  console.log(bad ? `\n${bad} failing` : "\nall green");
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log("\n1 failing"); process.exit(1); });
