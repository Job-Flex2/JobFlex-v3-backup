// THE SIGNUP, END TO END (2026-10-07). On every run-all --checks, against a PRODUCTION build
// (./_prod-server — the same .cache/next-sweep build the phone sweep uses; production is where
// a server action's thrown message is withheld and the visitor read "Minified React error #441"):
//   · landing (/, ?industry=hvac, roofing, fencing, painting) → hero CTA → step 1 → step 2
//     "Create account" → the plan sheet → "Start free trial" → /api/checkout/signup → the
//     browser leaves for checkout.stripe.com — at 390 (iPhone) and 1440 (desktop);
//   · the same email path in Instagram's webview, iOS and Android user agents (no Google
//     button on step 1 there);
//   · the Google buttons (landing at 1440, step 1 at 390) hand off to accounts.google.com;
//   · THE BRAKE: with one IP + User-Agent pair at its twenty step 2s for the hour
//     (lib/signupBrake, 2026-10-10; it was five per IP), the next shows the brake's own
//     words — "Too many sign-ups…" — not a React error; the same IP in another browser
//     (another User-Agent) still reaches the plan sheet;
//   · on every step: no console error, no page error, no 4xx/5xx from this server.
// Stripe is reached only in TEST mode (dev.db `stripe:mode` = test, the server started with
// STRIPE_SECRET_KEY blank); in live mode the run stops at the plan sheet and says so. The
// Checkout and Google pages themselves are never loaded — the hand-off is what is checked.
// Mail keys are blank on the server. Each run comes from its own made-up address (10.x, by
// x-forwarded-for); its pending signups and brake rows are removed after.
//   npx --no-install tsx --tsconfig tsconfig.json scripts/qa/signup-flow.check.ts
// QA_SIGNUP_URL=http://localhost:NNNN uses a server already up instead (no build, no start).
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ensureBuild, playwright, startServer, stopServer } from "./_prod-server";

const PORT = Number(process.env.QA_SIGNUP_PORT || 3312);
const BASE = (process.env.QA_SIGNUP_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const DESK = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const IG_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 Instagram 356.0.0.21.107 (iPhone15,3; iOS 18_1; en_US; en; scale=3.00; 1290x2796; 653423171)";
const IG_AND = "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240505.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.165 Mobile Safari/537.36 Instagram 334.0.0.42.95 Android (34/14; 420dpi; 1080x2205; Google/google; Pixel 8; shiba; shiba; en_US; 608720121)";
const INDUSTRIES = ["", "hvac", "roofing", "fencing", "painting"];
const STAMP = Date.now();
const MAIL_DOMAIN = `signupcheck${STAMP}.test`;
const db = new PrismaClient();
let bad = 0;
const check = (name: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const note = (name: string, extra = "") => console.log(`note ${name}${extra ? " — " + extra : ""}`);
const octet = () => 1 + Math.floor(Math.random() * 250);
const IPS: string[] = [];
const newIp = () => { const ip = `10.${octet()}.${octet()}.${octet()}`; IPS.push(ip); return ip; };

type Kind = "phone" | "desk" | "ig-ios" | "ig-android";
const UA: Record<Kind, string> = { phone: IPHONE, desk: DESK, "ig-ios": IG_IOS, "ig-android": IG_AND };

/** A fresh visitor from `ip`: declined optional cookies, third parties answered empty, and a
 *  log of everything that went wrong on the current step. */
async function visitor(browser: any, kind: Kind, ip: string) {
  const phone = kind !== "desk";
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1, userAgent: UA[kind], locale: "en-US" });
  const host = new URL(BASE).hostname;
  await ctx.addCookies([{ name: "jf_consent", value: encodeURIComponent(JSON.stringify({ v: 1, at: new Date().toISOString(), analytics: false, marketing: false, ack: true })), domain: host, path: "/" }]);
  const handoff: { checkout?: string; google?: string } = {};
  await ctx.route("**/*", (route: any) => {
    const u = route.request().url();
    if (u.startsWith(BASE)) return route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } });
    if (/^https:\/\/checkout\.stripe\.com\//.test(u)) { handoff.checkout = u; return route.fulfill({ status: 200, contentType: "text/html", body: "<title>checkout</title>" }); }
    if (/^https:\/\/accounts\.google\.com\//.test(u)) { handoff.google = u; return route.fulfill({ status: 200, contentType: "text/html", body: "<title>google</title>" }); }
    if (/facebook\.(com|net)|posthog|googletagmanager|google-analytics|doubleclick/.test(u)) return route.fulfill({ status: 204, body: "" });
    return route.continue();
  });
  const page = await ctx.newPage();
  const log = { step: "landing", errs: [] as string[] };
  const push = (what: string) => log.errs.push(`[${log.step}] ${what.replace(/\s+/g, " ").slice(0, 220)}`);
  page.on("console", (m: any) => { if (m.type() === "error") push("console: " + m.text()); });
  page.on("pageerror", (e: any) => push("pageerror: " + String(e?.message || e)));
  page.on("response", (r: any) => { if (r.status() >= 400 && r.url().startsWith(BASE)) push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(BASE.length)}`); });
  const step = (s: string) => { log.step = s; };
  const take = () => log.errs.splice(0).join(" | ");
  return { ctx, page, step, take, handoff };
}

async function landingToRegister(v: Awaited<ReturnType<typeof visitor>>, industry: string) {
  const { page } = v;
  v.step("landing");
  const res = await page.goto(`${BASE}/${industry ? "?industry=" + industry : ""}`, { waitUntil: "load", timeout: 180000 });
  const cta = page.locator('a[data-cta="hero"]').filter({ visible: true }).first();
  await cta.waitFor({ timeout: 60000 });
  // The gold "Just launched" link left the hero on 2026-10-14 (owner): no landing carries it.
  const launch = (await page.locator('[data-cta="pill"]').count()) + (await page.getByText("Just launched").count());
  v.step("landing → register");
  await Promise.all([page.waitForURL(/\/auth\/register/, { timeout: 120000 }), cta.click()]);
  return { status: res ? res.status() : 0, launch };
}

async function step1(v: Awaited<ReturnType<typeof visitor>>, email: string) {
  const { page } = v;
  v.step("step 1");
  await page.locator("#nextBtn").waitFor({ timeout: 120000 });
  await page.waitForTimeout(800);
  const google = await page.locator("#googleBtn").filter({ visible: true }).count();
  await page.getByPlaceholder("First and last").fill("Signup Check");
  await page.getByPlaceholder("you@yourshop.com").fill(email);
  const pw = page.locator('input[autocomplete="new-password"]');
  for (let i = 0; i < (await pw.count()); i++) if (await pw.nth(i).isVisible()) await pw.nth(i).fill("SignupCheck-2026!");
  await page.locator("#nextBtn").click();
  const ok = await page.getByPlaceholder("Company name").waitFor({ state: "visible", timeout: 60000 }).then(() => true).catch(() => false);
  const err = ok ? "" : (await page.locator("#step1 .err").innerText().catch(() => "")).trim();
  return { ok, google, err };
}

/** Step 2 filled and "Create account" pressed: the plan sheet, or the step's own error line. */
async function step2(v: Awaited<ReturnType<typeof visitor>>) {
  const { page } = v;
  v.step("step 2");
  await page.getByPlaceholder("Company name").fill("Signup Check Co");
  await page.getByPlaceholder("Street, city, state, ZIP").fill("142 Alder Ridge Rd, Seattle, WA 98101");
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.getByPlaceholder("Phone number").fill("2065550123");
  // A trade variant arrives with its trade picked; pressing it again would clear it.
  if (!(await page.locator("#step2 .chip.on").count())) await page.locator("#step2 .chip").first().click();
  await page.locator("#createBtn").click();
  const sheet = page.locator("section.plan-sheet.is-in");
  const err2 = page.locator("#err2:not(.is-hidden)");
  await Promise.race([sheet.waitFor({ timeout: 60000 }), err2.waitFor({ timeout: 60000 })]).catch(() => {});
  const ok = await sheet.count() > 0;
  const err = ok ? "" : (await page.locator("#err2").innerText().catch(() => "")).trim();
  return { ok, err };
}

/** The plan sheet's start → /api/checkout/signup → the browser heads for Stripe. A desk presses
 *  the first card's button; a phone (the swiped rail, 2026-10-14) the button of the card in the
 *  middle of the screen — the chosen one — and says which card that was. */
async function toCheckout(v: Awaited<ReturnType<typeof visitor>>) {
  const { page } = v;
  v.step("plan sheet → Checkout");
  const phone = page.viewportSize()!.width <= 768;
  const go = page.locator(`section.plan-sheet.is-in ${phone ? ".pw-plan.on" : ".pw-plan"} .pw-go`).filter({ visible: true }).first();
  await go.waitFor({ timeout: 60000 });
  await page.waitForTimeout(600);
  const middle = phone
    ? await page.evaluate(() => {
        const rail = document.querySelector("section.plan-sheet.is-in .pw-plans")!.getBoundingClientRect();
        const on = document.querySelector<HTMLElement>("section.plan-sheet.is-in .pw-plan.on")!;
        const b = on.getBoundingClientRect();
        return { slug: on.dataset.planCard ?? "", hero: on.classList.contains("pw-plan--hero"), off: Math.round(((b.left + b.right) / 2 - (rail.left + rail.right) / 2) * 10) / 10 };
      })
    : null;
  const answer = page.waitForResponse((r: any) => r.url().startsWith(BASE + "/api/checkout/signup"), { timeout: 90000 }).catch(() => null);
  await go.click();
  const r = await answer;
  for (let i = 0; i < 60 && !v.handoff.checkout; i++) await page.waitForTimeout(250);
  return { status: r ? r.status() : 0, url: v.handoff.checkout || "", middle };
}

async function emailPath(browser: any, kind: Kind, industry: string, ip: string, n: number, toStripe: boolean) {
  const name = `${kind} ${industry ? "?industry=" + industry : "/"}`;
  const v = await visitor(browser, kind, ip);
  try {
    const { status, launch } = await landingToRegister(v, industry);
    check(`${name}: no launch link above the headline`, launch === 0, `${launch} found`);
    check(`${name}: landing → register`, status === 200 && (!industry || v.page.url().includes(`industry=${industry}`)), `HTTP ${status} → ${v.page.url().slice(BASE.length)}${(() => { const e = v.take(); return e ? " · " + e : ""; })()}`);
    const s1 = await step1(v, `signup.${n}@${MAIL_DOMAIN}`);
    const webview = kind === "ig-ios" || kind === "ig-android";
    check(`${name}: step 1`, s1.ok && (webview ? s1.google === 0 : s1.google === 1), [`Google button ${s1.google}`, s1.err, v.take()].filter(Boolean).join(" · "));
    if (!s1.ok) return;
    const s2 = await step2(v);
    check(`${name}: step 2 Create account → plan sheet`, s2.ok, [s2.err, v.take()].filter(Boolean).join(" · "));
    if (!s2.ok) return;
    if (!toStripe) { const e = v.take(); check(`${name}: plan sheet`, !e, e); return; }
    const c = await toCheckout(v);
    if (c.middle) check(`${name}: the button pressed is the middle card's, the most-picked one (${c.middle.slug})`, Math.abs(c.middle.off) <= 1 && c.middle.hero, `${c.middle.slug} ${c.middle.off}px off the middle`);
    check(`${name}: Start free trial → Stripe Checkout`, c.status === 200 && /^https:\/\/checkout\.stripe\.com\//.test(c.url), [`/api/checkout/signup ${c.status}`, c.url ? "→ " + c.url.slice(0, 40) + "…" : "no hand-off", v.take()].filter(Boolean).join(" · "));
  } catch (e) {
    check(`${name}: ran through`, false, `${String((e as Error)?.message || e).split("\n")[0]} · ${v.take()}`);
  } finally {
    await v.ctx.close();
  }
}

/** The 21st step 2 from one IP + User-Agent: the brake answers in words. The pair's count
 *  is set to the allowance first (lib/signupBrake's key) rather than spent by twenty runs. */
async function brake(browser: any, ip: string) {
  const key = `rl:signup-start:${ip}:${createHash("sha256").update(IPHONE).digest("hex").slice(0, 16)}`;
  const full = `20:${Date.now() + 3_600_000}`;
  await db.syncState.upsert({ where: { key }, create: { key, cursor: full }, update: { cursor: full } });
  const v = await visitor(browser, "phone", ip);
  try {
    await v.page.goto(`${BASE}/auth/register`, { waitUntil: "load", timeout: 180000 });
    const s1 = await step1(v, `signup.brake@${MAIL_DOMAIN}`);
    if (!s1.ok) return check("brake: step 1", false, [s1.err, v.take()].filter(Boolean).join(" · "));
    const s2 = await step2(v);
    check("brake: a 21st Create account from one IP + User-Agent says why", !s2.ok && /^Too many sign-ups\. Try again in /.test(s2.err) && !/React|#\d{3}/.test(s2.err), `"${s2.err || "(no message)"}"${s2.ok ? " — the plan sheet opened" : ""}`);
    const e = v.take();
    check("brake: no console error, no 4xx/5xx", !e, e);
  } finally {
    await v.ctx.close();
  }
  // The same network, another browser: its own count.
  const w = await visitor(browser, "desk", ip);
  try {
    await w.page.goto(`${BASE}/auth/register`, { waitUntil: "load", timeout: 180000 });
    const s1 = await step1(w, `signup.brake2@${MAIL_DOMAIN}`);
    const s2 = s1.ok ? await step2(w) : { ok: false, err: s1.err };
    const e = w.take();
    check("brake: the same IP in another browser still reaches the plan sheet", s2.ok && !e, [s2.err, e].filter(Boolean).join(" · "));
  } finally {
    await w.ctx.close();
  }
}

/** The Google buttons hand off to Google: the landing's at 1440, step 1's at 390. */
async function google(browser: any) {
  for (const [kind, where] of [["desk", "landing"], ["phone", "step 1"]] as Array<[Kind, string]>) {
    const v = await visitor(browser, kind, newIp());
    try {
      await v.page.goto(`${BASE}/${where === "landing" ? "" : "auth/register"}`, { waitUntil: "load", timeout: 180000 });
      v.step(`${where} Google`);
      const btn = where === "landing" ? v.page.locator("button.lp-cta--ghost").filter({ visible: true }).first() : v.page.locator("#googleBtn");
      await btn.waitFor({ timeout: 60000 });
      await v.page.waitForTimeout(800);
      await btn.click();
      for (let i = 0; i < 120 && !v.handoff.google; i++) await v.page.waitForTimeout(250);
      const e = v.take();
      check(`Google button (${where}, ${kind === "desk" ? 1440 : 390}) → accounts.google.com`, !!v.handoff.google && !e, [v.handoff.google ? "→ " + v.handoff.google.slice(0, 48) + "…" : "no hand-off", e].filter(Boolean).join(" · "));
    } finally {
      await v.ctx.close();
    }
  }
}

async function main() {
  const pw = playwright();
  let server: ChildProcess | null = null;
  try {
    if (!process.env.QA_SIGNUP_URL) {
      ensureBuild(note);
      server = await startServer(PORT, { STRIPE_SECRET_KEY: "", RESEND_API_KEY: "", SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "" }, "QA_SIGNUP_PORT");
    }
    const mode = (await db.syncState.findUnique({ where: { key: "stripe:mode" } }))?.cursor;
    const toStripe = mode === "test";
    if (!toStripe) note("Stripe", `dev.db stripe:mode is "${mode ?? "live"}" — runs stop at the plan sheet (a check never opens a live Checkout)`);
    const browser = await pw.chromium.launch({ channel: "chrome", args: ["--disable-blink-features=AutomationControlled"] }).catch(() => pw.chromium.launch());
    try {
      let n = 0;
      const phoneIp = newIp();
      for (const industry of INDUSTRIES) await emailPath(browser, "phone", industry, phoneIp, n++, toStripe);
      const deskIp = newIp();
      for (const industry of INDUSTRIES) await emailPath(browser, "desk", industry, deskIp, n++, toStripe);
      const igIp = newIp();
      await emailPath(browser, "ig-ios", "", igIp, n++, toStripe);
      await emailPath(browser, "ig-android", "roofing", igIp, n++, toStripe);
      await brake(browser, phoneIp);
      await google(browser);
    } finally {
      await browser.close();
    }
  } finally {
    stopServer(server);
    // This run's pending signups and brake rows (lib/rateLimit keeps them as rl:<key>).
    await db.syncState.deleteMany({ where: { key: { startsWith: "signup:" }, cursor: { contains: MAIL_DOMAIN } } }).catch(() => {});
    await db.syncState.deleteMany({ where: { OR: [...IPS.map((ip) => ({ key: { startsWith: "rl:", endsWith: ":" + ip } })), ...IPS.map((ip) => ({ key: { startsWith: `rl:signup-start:${ip}:` } }))] } }).catch(() => {});
    await db.$disconnect();
  }
  console.log(bad ? `\n${bad} failing` : "\nall green");
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log("\n1 failing"); process.exit(1); });
