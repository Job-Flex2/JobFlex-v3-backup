// STRAIGHT TO PROFESSIONAL, HANDED OFF BY THE SERVER (2026-10-17, 2026-10-18; rebuilt 2026-10-19 for
// app/(auth)/auth/register/checkout). With the admin switch on (Admin → Trials → "Plan at sign-up": Straight to
// Professional, SyncState `signupPlan`) and a card required, the sign-up never draws a screen of its own between step 1
// and Stripe: the next document after step 1 is Stripe's card page for Professional, monthly — a 303 from the server.
// On a production build, at 390 (iPhone):
//   · step 1 (name + email) → checkout.stripe.com, with JavaScript and without it;
//   · a returning visitor (a live proven draft in its cookie, the landing's "Start my 7-day FREE TRIAL"; the plan
//     step's own address ?signup=<token> in a new tab) → checkout.stripe.com, no plan cards;
//   · a tab drawn while the switch was OFF, the code typed after it went ON → checkout.stripe.com;
//   · the tab remembering Annual (?billing=annual) → the session bills the MONTHLY price (read back from the sandbox);
//   · Stripe's back arrow (?checkout=cancelled) and the browser's Back → ALL the plan cards, Professional chosen, the
//     calm note, never the old "Add your card" screen; Starter pressed → Stripe's card page for Starter;
//   · the card page did not open (?checkout=failed) → the cards with "Secure checkout didn't open — pick a plan to try
//     again";
//   · the switch OFF → the plan cards, as before;
//   · on every step: no console error, no page error, no 4xx/5xx from this server.
// The sessions are real sandbox sessions when the server has STRIPE_SECRET_KEY_TEST (they expire unpaid; Stripe's page
// loads and is not touched); the plan is then read back from the sandbox. dev.db's `signupPlan` row is put back as it was; the drafts, intents and brake rows the run writes are removed.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/signup/signup-auto-return.check.ts
// QA_AUTO_URL=http://localhost:NNNN uses a server already up instead (no build, no start). QA_DATABASE_URL=file:<copy>
// points the check (and the server it starts) at a copy of dev.db instead.
import type { ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { ROOT, ensureBuild, playwright, startServer, stopServer } from "../_lib/_prod-server";

const PORT = Number(process.env.QA_AUTO_PORT || 3314);
const BASE = (process.env.QA_AUTO_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const DB_URL = process.env.QA_DATABASE_URL || "";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const STAMP = Date.now();
const MAIL_DOMAIN = `autoreturn${STAMP}.test`;
const CODE = "864213";
const HOUR = 3_600_000;
const KEY = "signupPlan";
const FAILED_LINE = "Secure checkout didn't open — pick a plan to try again";
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
type Req = { url(): string; method(): string; headers(): Record<string, string>; isNavigationRequest(): boolean; frame(): unknown };
type Route = { request(): Req; continue(o?: object): Promise<void>; fulfill(o: object): Promise<void> };
type Msg = { type(): string; text(): string };
type Res = { status(): number; url(): string; request(): Req };

/* A phone, its own made-up IP. `out.stripe` is Stripe's card page the tab was sent to (the session id is in it; a
   page reached by a redirect cannot be answered by a route, so Stripe's own page loads and is left alone), `docs` every document the tab asked for with its status (303s included), `cardsSeen` whether
   plan cards were ever on screen and `autoSeen` whether the old "Add your card" screen ever was (both sampled every
   50 ms from the first script on). */
async function visitor(browser: Browser, opts: { js?: boolean } = {}) {
  const ip = `10.${octet()}.${octet()}.${octet()}`;
  IPS.push(ip);
  const js = opts.js !== false;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IPHONE, locale: "en-US", javaScriptEnabled: js });
  const out: { stripe: string | null; docs: string[]; cardsSeen: number; autoSeen: number } = { stripe: null, docs: [], cardsSeen: 0, autoSeen: 0 };
  if (js) {
    await ctx.addInitScript({ content: "window.__name = function (f) { return f; };" });
    await ctx.exposeBinding("__qaCards", (_src: unknown, n: number, a: number) => { out.cardsSeen = Math.max(out.cardsSeen, n); out.autoSeen = Math.max(out.autoSeen, a); });
    await ctx.addInitScript({
      content: `(function(){ if (location.pathname !== "/auth/register") return; setInterval(function(){
        var n = [].slice.call(document.querySelectorAll("section.plan-sheet.is-in .pw-plan")).filter(function(c){ return c.offsetParent !== null && getComputedStyle(c).visibility !== "hidden"; }).length;
        var a = document.querySelectorAll(".pw-auto, #autoGo, [data-auto-wait]").length + (/Add your card/.test(document.body ? document.body.innerText : "") ? 1 : 0);
        if (window.__qaCards) window.__qaCards(n, a); }, 50); })();`,
    });
  }
  const host = new URL(BASE).hostname;
  await ctx.addCookies([{ name: "jf_consent", value: encodeURIComponent(JSON.stringify({ v: 1, at: new Date().toISOString(), analytics: false, marketing: false, ack: true })), domain: host, path: "/" }]);
  await ctx.route("**/*", (route: Route) => {
    const req = route.request();
    const u = req.url();
    if (u.startsWith(BASE)) return route.continue({ headers: { ...req.headers(), "x-forwarded-for": ip } });
    if (/^https:\/\/accounts\.google\.com\//.test(u)) return route.fulfill({ status: 200, contentType: "text/html", body: "<title>google</title>" });
    if (/facebook\.(com|net)|posthog|googletagmanager|google-analytics|doubleclick/.test(u)) return route.fulfill({ status: 204, body: "" });
    return route.continue();
  });
  const page = await ctx.newPage();
  const log = { step: "", errs: [] as string[] };
  const push = (what: string) => log.errs.push(`[${log.step}] ${what.replace(/\s+/g, " ").slice(0, 220)}`);
  page.on("console", (m: Msg) => { if (m.type() === "error" && page.url().startsWith(BASE) && !/does not have a registered handler|^\[Report Only\]|delivered in report-only mode/.test(m.text())) push("console: " + m.text()); });
  page.on("pageerror", (e: Error) => push("pageerror: " + String(e?.message || e)));
  page.on("response", (r: Res) => {
    const q = r.request();
    if (!q.isNavigationRequest() || q.frame() !== page.mainFrame()) return void (r.status() >= 400 && r.url().startsWith(BASE) && push(`HTTP ${r.status()} ${q.method()} ${r.url().slice(BASE.length)}`));
    out.docs.push(`${r.status()} ${r.url().replace(BASE, "")}`);
    if (/^https:\/\/checkout\.stripe\.com\//.test(r.url()) && r.status() < 300) out.stripe = r.url();
    if (r.status() >= 400 && r.url().startsWith(BASE)) push(`HTTP ${r.status()} ${q.method()} ${r.url().slice(BASE.length)}`);
  });
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
/** This tab's memory from an earlier visit (sessionStorage). */
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

/* The sandbox key, for reading back the Checkout session the server made (never the live key). */
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
const SANDBOX = sandboxKey();
type Sold = { plan: string | null; amount: number | null; interval: string | null };
/** The plan and price of the session in a checkout.stripe.com address (the sandbox's answer), or nulls. */
async function sold(url: string | null): Promise<Sold> {
  const id = url?.match(/cs_test_[A-Za-z0-9]+/)?.[0];
  if (!id || !SANDBOX) return { plan: null, amount: null, interval: null };
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}/line_items?expand[]=data.price.product`, { headers: { Authorization: `Bearer ${SANDBOX}` } });
  const b = (await r.json().catch(() => ({}))) as { data?: { price?: { unit_amount: number | null; recurring: { interval: string } | null; product?: { name?: string } } }[] };
  const p = b.data?.[0]?.price;
  return { plan: p?.product?.name?.replace(/^JobFlex\s+/i, "").toLowerCase() ?? null, amount: p?.unit_amount ?? null, interval: p?.recurring?.interval ?? null };
}

type Seen = { stripe: boolean; next: string; sold: Sold; cardsSeen: number; autoSeen: number };
/** Until Stripe's page is reached (or `ms` pass): where the tab went, what it was sold, what was drawn on the way. */
async function outcome(v: V, ms = 30000): Promise<Seen> {
  for (let i = 0; i < ms / 100 && !v.out.stripe; i++) await v.page.waitForTimeout(100);
  // The first document drawn after the last page of this site the tab showed: every hop between is a redirect.
  const stripeAt = v.out.docs.findIndex((d) => /checkout\.stripe\.com/.test(d));
  const upTo = stripeAt < 0 ? v.out.docs.length : stripeAt;
  const lastOwn = v.out.docs.slice(0, upTo).map((d) => /^200 \//.test(d)).lastIndexOf(true);
  const next = v.out.docs.slice(lastOwn + 1).find((d) => !/^30[1-8] /.test(d)) ?? "";
  return { stripe: !!v.out.stripe, next, sold: await sold(v.out.stripe), cardsSeen: v.out.cardsSeen, autoSeen: v.out.autoSeen };
}
/** A new leg in the same tab. */
function fresh(v: V) {
  v.out.stripe = null;
  v.out.docs = [];
  v.out.cardsSeen = 0;
  v.out.autoSeen = 0;
}
/** Professional's card page, monthly, reached as the next document — no plan cards, no "Add your card" on the way. */
const straightToPro = (s: Seen) =>
  s.stripe && /checkout\.stripe\.com/.test(s.next) && s.cardsSeen === 0 && s.autoSeen === 0 && (!SANDBOX || (s.sold.plan === "professional" && s.sold.interval === "month"));

async function scenario(browser: Browser, name: string, run: (v: V) => Promise<void>, expect: (s: Seen) => boolean, opts: { js?: boolean } = {}) {
  const v = await visitor(browser, opts);
  try {
    v.step(name);
    await run(v);
    const s = await outcome(v);
    check(name, expect(s), JSON.stringify({ ...s, docs: v.out.docs.slice(-4) }));
    const e = v.take();
    check(`${name} — no console / page / HTTP errors`, !e, e);
  } catch (e) {
    check(`${name} ran through`, false, failed(e, v));
  } finally {
    await v.ctx.close();
  }
}
/** A scenario that makes its own checks (several legs in one tab). */
async function journey(browser: Browser, name: string, run: (v: V, name: string) => Promise<void>) {
  const v = await visitor(browser);
  try {
    v.step(name);
    await run(v, name);
    const e = v.take();
    check(`${name} — no console / page / HTTP errors`, !e, e);
  } catch (e) {
    check(`${name} ran through`, false, failed(e, v));
  } finally {
    await v.ctx.close();
  }
}

/** Step 1 of the short sign-up: name, email, the button. */
async function stepOne(v: V, email: string, js = true) {
  await v.page.goto(`${BASE}/auth/register?industry=hvac`, { waitUntil: "load", timeout: 180000 });
  await v.page.locator("#nextBtn").waitFor({ timeout: 120000 });
  if (js) await v.page.waitForFunction(() => (window as unknown as { __jfStep1?: { ready: boolean } }).__jfStep1?.ready, null, { timeout: 60000 }).catch(() => {});
  await v.page.fill("#name", "Straight Through");
  await v.page.fill("#email", email);
  await v.page.click("#nextBtn");
}

type Cards = { cards: number; chosen: string | null; note: boolean; failed: string | null; auto: number };
async function cards(v: V): Promise<Cards> {
  await v.page.locator("section.plan-sheet.is-in .pw-plan").first().waitFor({ timeout: 60000 });
  await v.page.waitForTimeout(600);
  return v.page.evaluate(() => ({
    cards: Array.from(document.querySelectorAll<HTMLElement>("section.plan-sheet.is-in .pw-plan")).filter((c) => c.offsetParent !== null).length,
    chosen: document.querySelector("section.plan-sheet.is-in .pw-plan.on")?.getAttribute("data-plan-card") ?? null,
    note: !!document.querySelector("[data-auto-plan-back]"),
    failed: document.querySelector("[data-checkout-failed]")?.textContent?.trim() ?? null,
    auto: document.querySelectorAll(".pw-auto, #autoGo, [data-auto-wait]").length + (/Add your card/.test(document.body.innerText) ? 1 : 0),
  }));
}
/** On the cards: a plan's own start button (a phone brings the card to the middle first). */
async function start(v: V, slug: string) {
  const card = v.page.locator(`section.plan-sheet.is-in .pw-plan[data-plan-card="${slug}"]`);
  await card.click({ position: { x: 16, y: 16 } }).catch(() => {});
  await v.page.waitForTimeout(700);
  await card.locator(".pw-go").first().click();
}

/* A REMEMBERED ANNUAL (2026-10-17): the tab chose Annual earlier and the link says ?billing=annual; straight to
   Professional has no term switch, so the session bills the monthly catalog price. */
async function rememberedAnnual(browser: Browser) {
  const pro = await db.pricingPlan.findUnique({ where: { slug: "professional" }, select: { priceCents: true } });
  if (!pro) return note("remembered Annual", "no professional plan in the catalog — skipped");
  if (!SANDBOX) note("remembered Annual", "no sandbox key — the session's price is not read back");
  await scenario(browser, "switch ON: the tab remembers Annual (?billing=annual) → Stripe bills the monthly price", async (v) => {
    const { draft } = await plantReturning(`back.annual.${STAMP}@${MAIL_DOMAIN}`, 3 * HOUR);
    await holdDraft(v, draft);
    await tabMemory(v, { jf_billing_term: "YEAR" });
    await v.page.goto(`${BASE}/auth/register?billing=annual`, { waitUntil: "load", timeout: 180000 });
  }, (s) => straightToPro(s) && (!SANDBOX || s.sold.amount === pro.priceCents));
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
    if (!SANDBOX) note("sandbox", "no STRIPE_SECRET_KEY_TEST — the plan of each card page is not read back");
    const browser = await pw.chromium.launch({ channel: "chrome", args: ["--disable-blink-features=AutomationControlled"] }).catch(() => pw.chromium.launch());
    try {
      await setSwitch("auto");
      await scenario(browser, "switch ON: step 1 (name + email) → the next document is Stripe's card page for Professional", (v) => stepOne(v, `step1.${STAMP}@${MAIL_DOMAIN}`), straightToPro);
      await scenario(
        browser,
        "switch ON, JavaScript off: step 1 → the next document is Stripe's card page for Professional",
        (v) => stepOne(v, `nojs.${STAMP}@${MAIL_DOMAIN}`, false),
        (s) => s.stripe && /checkout\.stripe\.com/.test(s.next) && (!SANDBOX || (s.sold.plan === "professional" && s.sold.interval === "month")),
        { js: false },
      );
      await rememberedAnnual(browser);
      await scenario(browser, "switch ON: returning with a live draft → landing \"Start my 7-day FREE TRIAL\" → Stripe, no plan cards", async (v) => {
        const { draft } = await plantReturning(`back.landing.${STAMP}@${MAIL_DOMAIN}`, 3 * HOUR);
        await holdDraft(v, draft);
        await tabMemory(v, { jf_signup_plan: "starter" });
        await v.page.goto(`${BASE}/`, { waitUntil: "load", timeout: 180000 });
        const cta = v.page.locator('[data-cta="hero"]').first();
        await cta.waitFor({ timeout: 120000 });
        check("the landing's hero button says the trial", /Start my \d+-day FREE TRIAL/.test((await cta.innerText()).trim()), (await cta.innerText()).trim());
        await cta.click();
      }, straightToPro);
      await scenario(browser, "switch ON: returning by the plan step's address (?signup=<token>) in a new tab → Stripe, no plan cards", async (v) => {
        const { signup } = await plantReturning(`back.signup.${STAMP}@${MAIL_DOMAIN}`, 20 * HOUR);
        await v.page.goto(`${BASE}/auth/register?signup=${signup}`, { waitUntil: "load", timeout: 180000 });
      }, straightToPro);
      await journey(browser, "switch ON: Stripe's back arrow (?checkout=cancelled)", async (v, name) => {
        const { signup } = await plantReturning(`back.cancelled.${STAMP}@${MAIL_DOMAIN}`, 3 * HOUR);
        await tabMemory(v, { jf_signup_plan: "starter" });
        await v.page.goto(`${BASE}/auth/register?signup=${signup}&checkout=cancelled`, { waitUntil: "load", timeout: 180000 });
        const c = await cards(v);
        check(`${name} → all the plan cards, Professional chosen, the note — no "Add your card" screen`, c.cards >= 3 && c.chosen === "professional" && c.note && !c.failed && c.auto === 0 && v.out.autoSeen === 0 && !v.out.stripe, JSON.stringify(c));
        fresh(v);
        await start(v, "starter");
        const s = await outcome(v);
        check(`${name}: Starter pressed → Stripe's card page for Starter`, s.stripe && (!SANDBOX || s.sold.plan === "starter"), JSON.stringify(s));
      });
      await journey(browser, "switch ON: the browser's Back from Stripe after step 1", async (v, name) => {
        await stepOne(v, `back.history.${STAMP}@${MAIL_DOMAIN}`);
        const first = await outcome(v);
        check(`${name}: step 1 → Stripe`, straightToPro(first), JSON.stringify(first));
        fresh(v);
        await v.page.goBack({ waitUntil: "load", timeout: 120000 });
        const c = await cards(v);
        check(`${name} → the plan cards — no "Add your card" screen, no second card page by itself`, c.cards >= 3 && c.auto === 0 && !v.out.stripe, JSON.stringify(c));
      });
      await journey(browser, "switch ON: the card page did not open (?checkout=failed)", async (v, name) => {
        const { signup } = await plantReturning(`back.failed.${STAMP}@${MAIL_DOMAIN}`, 3 * HOUR);
        await v.page.goto(`${BASE}/auth/register?signup=${signup}&checkout=failed`, { waitUntil: "load", timeout: 180000 });
        const c = await cards(v);
        check(`${name} → the cards with the line`, c.cards >= 3 && c.failed === FAILED_LINE && !c.note && c.auto === 0, JSON.stringify(c));
      });

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
        check("a tab drawn with the switch OFF, the code typed after it went ON → Stripe for Professional, no plan cards", straightToPro(s), JSON.stringify(s));
        const e = stale.take();
        check("stale tab — no console / page / HTTP errors", !e, e);
      } catch (e) {
        check("stale tab ran through", false, failed(e, stale));
      } finally {
        await stale.ctx.close();
      }

      await setSwitch("pick");
      await scenario(browser, "switch OFF: returning with a live draft → the plan cards, as before", async (v) => {
        const { draft } = await plantReturning(`back.off.${STAMP}@${MAIL_DOMAIN}`, 3 * HOUR);
        await holdDraft(v, draft);
        await tabMemory(v, { jf_signup_plan: "starter" });
        await v.page.goto(`${BASE}/auth/register?flow=otp`, { waitUntil: "load", timeout: 180000 });
        await v.page.locator("section.plan-sheet.is-in .pw-plan").first().waitFor({ timeout: 60000 });
      }, (s) => !s.stripe && s.autoSeen === 0 && s.cardsSeen > 0, {});
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
