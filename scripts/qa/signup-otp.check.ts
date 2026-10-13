// THE PASSWORDLESS SIGN-UP, END TO END (2026-10-10; lib/signupOtp). On every run-all --checks,
// against the same production build as signup-flow.check (./_prod-server, .cache/next-sweep):
//   · /auth/register?flow=otp at 390 (iPhone, ?industry=roofing) and 1440: Google above the
//     email form, the trial line under Continue, Continue → the code screen (?d= in the
//     address), a wrong code counts down, the right one opens the plan sheet, and the plan's
//     start button hands off to Stripe Checkout (test mode only, as signup-flow.check);
//   · a reload on the code screen reopens it; the email's button in ANOTHER browser opens the
//     plan step and the waiting tab follows;
//   · five wrong codes burn the code; the 21st new account from one IP + User-Agent is
//     refused in words, another browser on the same IP is not;
//   · Instagram's webview (iOS): Google stays on top and hands the page to Safari with google=1;
//   · an address that has an account (qa@acme.test) — the register page's code and the sign-in
//     page's "Email me a code" both sign it in (QA Co only, CLAUDE.md);
//   · the six squares (otp-code-field, 2026-10-12) at 360 and 1440 in Chromium and 390 in
//     WebKit: one one-time-code field under them, focused; digit by digit, a letter ignored,
//     Backspace, select-and-replace, a whole code pasted with a space, a wrong code (red,
//     cleared, focused), an expired one, Resend after the countdown, sent on the sixth digit;
//     Use a different email; the old small print gone; the sign-in page's squares too;
//   · on every step: no console error, no page error, no 4xx/5xx from this server.
// A production build sends no mail here (mail keys blank) and keeps the code only as a salted
// hash, so the check writes its own code into the draft (the same hash lib/signupOtp keeps) and
// its own button secret — what the browser does with them is what is checked. Each run comes
// from made-up addresses (10.x by x-forwarded-for) and removes its drafts, intents and brake rows.
//   npx --no-install tsx --tsconfig tsconfig.json scripts/qa/signup-otp.check.ts
// QA_OTP_URL=http://localhost:NNNN uses a server already up instead (no build, no start).
import type { ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ensureBuild, playwright, startServer, stopServer } from "./_prod-server";

const PORT = Number(process.env.QA_OTP_PORT || 3313);
const BASE = (process.env.QA_OTP_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const DESK = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const IG_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22B83 Instagram 356.0.0.21.107 (iPhone15,3; iOS 18_1; en_US; en; scale=3.00; 1290x2796; 653423171)";
const QA_EMAIL = "qa@acme.test";
const STAMP = Date.now();
const MAIL_DOMAIN = `otpcheck${STAMP}.test`;
const CODE = "246810";
const db = new PrismaClient();
let bad = 0;
const check = (name: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const note = (name: string, extra = "") => console.log(`note ${name}${extra ? " — " + extra : ""}`);
const octet = () => 1 + Math.floor(Math.random() * 250);
const IPS: string[] = [];
const DRAFTS: string[] = [];
const newIp = () => { const ip = `10.${octet()}.${octet()}.${octet()}`; IPS.push(ip); return ip; };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

type Kind = "phone" | "desk" | "ig-ios";
const UA: Record<Kind, string> = { phone: IPHONE, desk: DESK, "ig-ios": IG_IOS };

async function visitor(browser: any, kind: Kind, ip = newIp(), size?: { width: number; height: number }) {
  const phone = kind !== "desk";
  // isMobile is Chromium's; WebKit takes the phone's size, touch and User-Agent.
  const mobile = phone && browser.browserType().name() === "chromium";
  const ctx = await browser.newContext({ viewport: size ?? (phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }), isMobile: mobile, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1, userAgent: UA[kind], locale: "en-US" });
  // tsx names the helpers inside page.evaluate with esbuild's __name; the page has none.
  await ctx.addInitScript({ content: "window.__name = function (f) { return f; };" });
  const host = new URL(BASE).hostname;
  await ctx.addCookies([{ name: "jf_consent", value: encodeURIComponent(JSON.stringify({ v: 1, at: new Date().toISOString(), analytics: false, marketing: false, ack: true })), domain: host, path: "/" }]);
  const handoff: { checkout?: string } = {};
  await ctx.route("**/*", (route: any) => {
    const u = route.request().url();
    if (u.startsWith(BASE)) return route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } });
    if (/^https:\/\/checkout\.stripe\.com\//.test(u)) { handoff.checkout = u; return route.fulfill({ status: 200, contentType: "text/html", body: "<title>checkout</title>" }); }
    if (/^https:\/\/accounts\.google\.com\//.test(u)) return route.fulfill({ status: 200, contentType: "text/html", body: "<title>google</title>" });
    if (/facebook\.(com|net)|posthog|googletagmanager|google-analytics|doubleclick/.test(u)) return route.fulfill({ status: 204, body: "" });
    return route.continue();
  });
  const page = await ctx.newPage();
  const log = { step: "", errs: [] as string[] };
  const push = (what: string) => log.errs.push(`[${log.step}] ${what.replace(/\s+/g, " ").slice(0, 220)}`);
  // A custom-scheme hand-off (x-safari-https) cannot open in a desktop Chrome; that one line is expected.
  // WebKit also logs the report-only CSP (no report-to) and what it would refuse; report-only blocks nothing.
  page.on("console", (m: any) => { if (m.type() === "error" && !/does not have a registered handler|^\[Report Only\]|delivered in report-only mode/.test(m.text())) push("console: " + m.text()); });
  page.on("pageerror", (e: any) => push("pageerror: " + String(e?.message || e)));
  page.on("response", (r: any) => { if (r.status() >= 400 && r.url().startsWith(BASE)) push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(BASE.length)}`); });
  return { ctx, page, handoff, step: (s: string) => { log.step = s; }, take: () => log.errs.splice(0).join(" | ") };
}
type V = Awaited<ReturnType<typeof visitor>>;

/** The draft named in the address: its code becomes CODE (the hash lib/signupOtp keeps). */
async function plantCode(url: string): Promise<string> {
  const d = new URL(url).searchParams.get("d") ?? "";
  for (let i = 0; i < 20; i++) {
    const row = await db.syncState.findUnique({ where: { key: `otp:${d}` } });
    if (row) {
      const draft = JSON.parse(row.cursor);
      const salt = draft.code?.salt ?? randomBytes(8).toString("hex");
      draft.code = { salt, hash: sha(`${salt}:${CODE}`), exp: Date.now() + 10 * 60_000, tries: draft.code?.tries ?? 0 };
      await db.syncState.update({ where: { key: `otp:${d}` }, data: { cursor: JSON.stringify(draft) } });
      DRAFTS.push(d);
      return d;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no draft for " + url);
}
/** The email's button for that draft: a secret of our own, the hash the draft expects. */
async function plantLink(d: string): Promise<string> {
  const secret = randomBytes(32).toString("base64url");
  const row = await db.syncState.findUnique({ where: { key: `otp:${d}` } });
  const draft = JSON.parse(row!.cursor);
  if (draft.linkHash) await db.syncState.deleteMany({ where: { key: `otp-link:${draft.linkHash}` } });
  draft.linkHash = sha(secret);
  await db.syncState.update({ where: { key: `otp:${d}` }, data: { cursor: JSON.stringify(draft) } });
  await db.syncState.create({ data: { key: `otp-link:${draft.linkHash}`, cursor: d } });
  return `${BASE}/auth/register/code?k=${secret}`;
}

async function toCode(v: V, email: string, query = "") {
  const { page } = v;
  v.step("step 1");
  await page.goto(`${BASE}/auth/register?flow=otp${query}`, { waitUntil: "load", timeout: 180000 });
  await page.locator("#nextBtn").waitFor({ timeout: 120000 });
  await page.waitForTimeout(800);
  const g = await page.locator("#googleBtn").boundingBox();
  const f = await page.locator("#name").boundingBox();
  const trial = (await page.locator("#otpTrial").innerText().catch(() => "")).trim();
  await page.fill("#name", "Otp Check");
  await page.fill("#email", email);
  await page.click("#nextBtn");
  v.step("code screen");
  const ok = await page.locator("#otpCode").waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(600);
  return { ok, googleOnTop: !!g && !!f && g.y < f.y, trial, err: ok ? "" : (await page.locator("#err1").innerText().catch(() => "")).trim() };
}

async function codeNote(v: V) {
  return (await v.page.locator("#otpNote").innerText().catch(() => "")).trim();
}

/* THE SIX SQUARES (otp-code-field, 2026-10-12): one real field under six drawn squares. */
type Squares = { value: string; shown: string; current: number; selected: number; invalid: boolean; red: boolean; focused: boolean; msg: string; live: string | null; cells: number; fields: number; cw: number; cwMax: number; ch: number; gap: number; shadow: string; overflow: boolean };
type Page = V["page"];
type Browser = Parameters<typeof visitor>[0];
async function squares(page: Page, id: string): Promise<Squares> {
  return page.evaluate((id: string) => {
    const inp = document.getElementById(id) as HTMLInputElement;
    const cells = [...inp.parentElement!.querySelectorAll<HTMLElement>("[data-cell]")];
    const boxes = cells.map((c) => c.getBoundingClientRect());
    const field = inp.parentElement!.parentElement!;
    const msg = document.getElementById(inp.getAttribute("aria-describedby") || "");
    const danger = getComputedStyle(field).getPropertyValue("--danger").trim() || "#a83232";
    const probe = document.createElement("i");
    probe.style.color = danger;
    document.body.appendChild(probe);
    const red = getComputedStyle(probe).color;
    probe.remove();
    return {
      value: inp.value,
      shown: cells.map((c) => c.textContent).join(""),
      current: cells.findIndex((c) => c.hasAttribute("data-current")),
      selected: cells.filter((c) => c.hasAttribute("data-selected")).length,
      invalid: field.hasAttribute("data-invalid"),
      red: cells.every((c) => getComputedStyle(c).borderTopColor === red),
      focused: document.activeElement === inp,
      msg: (msg?.textContent || "").trim(),
      live: msg?.getAttribute("aria-live") ?? null,
      cells: cells.length,
      fields: document.querySelectorAll('input[autocomplete="one-time-code"]').length,
      cw: Math.min(...boxes.map((b) => b.width)),
      cwMax: Math.max(...boxes.map((b) => b.width)),
      shadow: [...new Set(cells.map((c) => getComputedStyle(c).boxShadow))].join(" | "),
      ch: Math.min(...boxes.map((b) => b.height)),
      gap: Math.round(boxes[1].left - boxes[0].right),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  }, id);
}
const sq = (s: Squares) => JSON.stringify({ value: s.value, shown: s.shown, current: s.current, invalid: s.invalid, red: s.red, focused: s.focused, msg: s.msg });
async function keys(page: Page, text: string) {
  for (const ch of text) { await page.keyboard.type(ch); await page.waitForTimeout(50); }
}
/** A paste as the phone's or the desk's clipboard delivers it. */
async function pasteInto(page: Page, id: string, text: string) {
  await page.evaluate(({ id, text }: { id: string; text: string }) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    document.getElementById(id)!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { id, text });
}
async function settle(page: Page, id: string, until: RegExp) {
  await page.waitForFunction(({ id, src }: { id: string; src: string }) => new RegExp(src).test(document.getElementById(id)?.textContent || ""), { id, src: until.source }, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(250); // the squares' 140ms colour change
}
const GONE_PHRASES = [/Check your email/, /Enter the code we sent to/, /It works for 10 minutes/, /Pasting it works too/, /No email\? Check spam/];

/** The register page's code screen, every way a code gets in — at one width in one engine. */
async function codeSquares(browser: Browser, width: number) {
  const engine = browser.browserType().name();
  const name = `squares ${engine} ${width}`;
  const v = await visitor(browser, width > 768 ? "desk" : "phone", newIp(), { width, height: width > 768 ? 900 : width < 380 ? 640 : 844 });
  const { page } = v;
  try {
    const s1 = await toCode(v, `otp.sq.${engine}.${width}.${STAMP}@${MAIL_DOMAIN}`);
    if (!s1.ok) return check(`${name}: code screen`, false, s1.err);
    // "Use a different email" goes back to the address, then Continue asks again.
    await page.click("#otpChange");
    await page.waitForTimeout(400);
    const back = await page.evaluate(() => ({ form: !!document.getElementById("email"), focus: document.activeElement?.id, d: new URL(location.href).searchParams.has("d") }));
    check(`${name}: "Use a different email" → the email screen, its field focused, no draft in the address`, back.form && back.focus === "email" && !back.d, JSON.stringify(back));
    await page.click("#nextBtn");
    await page.locator("#otpCode").waitFor({ timeout: 60000 });
    await page.waitForTimeout(500);
    await plantCode(page.url());

    const text = await page.locator("#step1").innerText();
    const h1 = (await page.locator("#step1 h1").innerText()).trim();
    const label = (await page.locator('label[for="otpCode"]').textContent())?.trim();
    const stale = GONE_PHRASES.filter((re) => re.test(text)).map(String);
    check(`${name}: the words — heading, address, label, one quiet foot line; the old phrases gone`, h1 === "We sent a 6-digit code to your email" && label === "Enter 6-digit code" && /Resend code in \d+ s/.test(text) && /Didn.t get it\? Check spam\./.test(text) && !stale.length, [h1, label, ...stale].join(" · "));
    let s = await squares(page, "otpCode");
    check(`${name}: six empty squares over ONE one-time-code field, focused, the first current, nothing under them`, s.cells === 6 && s.fields === 1 && s.shown === "" && s.focused && s.current === 0 && s.msg === "" && s.live === "polite" && (await page.locator("#otpBtn").isDisabled()), sq(s));
    check(`${name}: upright boxes 40–44 × 56–60, 6px apart, a frame and no shadow, no sideways scroll`, s.cw >= 40 && s.cwMax <= 44 && s.ch >= 56 && s.ch <= 60 && s.ch > s.cwMax && s.gap <= 6 && s.gap >= 5 && s.shadow === "none" && !s.overflow, JSON.stringify({ cw: s.cw, cwMax: s.cwMax, ch: s.ch, gap: s.gap, shadow: s.shadow, overflow: s.overflow }));
    // WHERE THE BLOCK STANDS (owner, 2026-10-12): a phone — about 12% of the screen under the steps
    // (clamp 40…96px), not pressed to them; with the keyboard up (the window 300px shorter) the boxes
    // and Continue in sight, the heading too from 390×844. A desk — centred in the column.
    const at = await page.evaluate(() => {
      const st = document.getElementById("stepper")!.getBoundingClientRect();
      const h = document.querySelector("#step1 h1")!.getBoundingClientRect();
      const col = document.querySelector(".auth-form")!.getBoundingClientRect();
      const block = document.querySelector("[data-otp-screen=code]")!.getBoundingClientRect();
      return { gap: Math.round(h.top - st.bottom), vh: innerHeight, above: Math.round(block.top - st.bottom), below: Math.round(Math.min(col.bottom, innerHeight) - block.bottom) };
    });
    const want = Math.min(96, Math.max(40, at.vh * 0.12));
    if (width <= 768) check(`${name}: the block stands ~12% of the screen under the steps (${Math.round(want)}px), not pressed to them`, Math.abs(at.gap - want) <= 4, JSON.stringify(at));
    else check(`${name}: on a desk the block is centred in the column`, Math.abs(at.above - at.below) <= 60, JSON.stringify(at));
    if (width <= 768) {
      const full = page.viewportSize()!;
      await page.setViewportSize({ width: full.width, height: full.height - 300 });
      await page.waitForTimeout(700);
      const kb = await page.evaluate(() => {
        const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
        const h = r("#step1 h1"), f = r("#otpCode"), b = r("#otpBtn");
        return { vh: innerHeight, h1: Math.round(h.top), boxes: Math.round(f.top), go: Math.round(b.bottom), focus: document.activeElement?.id };
      });
      const heading = full.height >= 800;
      check(`${name}: keyboard up (${full.width}×${full.height - 300}) — the boxes and Continue in sight${heading ? ", the heading too" : ""}`, kb.boxes >= 0 && kb.go <= kb.vh && (!heading || kb.h1 >= 0) && kb.focus === "otpCode", JSON.stringify(kb));
      await page.setViewportSize(full);
      await page.waitForTimeout(400);
    }

    await keys(page, "1a2");
    s = await squares(page, "otpCode");
    check(`${name}: digit by digit, one per square; a letter is ignored`, s.value === "12" && s.shown === "12" && s.current === 2, sq(s));
    await page.keyboard.press("Backspace");
    s = await squares(page, "otpCode");
    check(`${name}: Backspace takes the last digit`, s.value === "1" && s.current === 1, sq(s));
    await keys(page, "23");
    await page.keyboard.press("Control+A");
    await page.waitForTimeout(100);
    const all = (await squares(page, "otpCode")).selected;
    await keys(page, "7");
    s = await squares(page, "otpCode");
    check(`${name}: select all shows on the squares, a digit replaces it`, all === 3 && s.value === "7", `${all} selected → ${s.value}`);
    await page.keyboard.press("Backspace");

    // A whole code pasted with a space goes by itself; a wrong one: red, cleared, focus on the first.
    await pasteInto(page, "otpCode", "000 000");
    await settle(page, "otpNote", /tries left/);
    s = await squares(page, "otpCode");
    check(`${name}: "000 000" pasted → sent on its own; wrong: all six red, cleared, focused, the reason under them`, s.invalid && s.red && s.value === "" && s.focused && s.current === 0 && /^That code isn't right\. 4 tries left\.$/.test(s.msg), sq(s));
    await pasteInto(page, "otpCode", "Code: 12");
    s = await squares(page, "otpCode");
    check(`${name}: "Code: 12" pasted → 12, the red gone with the first digit`, s.value === "12" && !s.invalid && s.msg === "", sq(s));
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");

    // An expired code.
    const d = new URL(page.url()).searchParams.get("d")!;
    const row = await db.syncState.findUnique({ where: { key: `otp:${d}` } });
    const draft = JSON.parse(row!.cursor);
    draft.code.exp = Date.now() - 1000;
    draft.lastSentAt = Date.now() - 31_000; // and the resend countdown over: the screen's next look at the draft arms Resend
    await db.syncState.update({ where: { key: `otp:${d}` }, data: { cursor: JSON.stringify(draft) } });
    await keys(page, CODE);
    await settle(page, "otpNote", /expired/);
    s = await squares(page, "otpCode");
    check(`${name}: an expired code — red, cleared, says so`, s.invalid && s.red && s.value === "" && /expired/.test(s.msg), sq(s));

    // Resend once the countdown is over: a new code, the countdown again, the red gone.
    const armed = await page.waitForFunction(() => document.getElementById("otpResend")?.textContent?.trim() === "Resend code", null, { timeout: 15000 }).then(() => true).catch(() => false);
    await page.click("#otpResend");
    await page.waitForFunction(() => /Resend code in \d+ s/.test(document.getElementById("otpResend")?.textContent || ""), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(300);
    s = await squares(page, "otpCode");
    const again = (await page.locator("#otpResend").innerText()).trim();
    check(`${name}: after the countdown "Resend code" → the countdown again, the squares clear and focused`, armed && /Resend code in \d+ s/.test(again) && !s.invalid && s.msg === "" && s.focused, [again, sq(s)].join(" · "));
    await plantCode(page.url());

    // The sixth digit sends it: five keep Continue off.
    await keys(page, CODE.slice(0, 5));
    const five = await page.locator("#otpBtn").isDisabled();
    await page.keyboard.type(CODE[5]);
    const plan = await page.locator("section.plan-sheet.is-in").waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
    check(`${name}: five digits keep Continue off; the sixth sends the code → the plan step`, five && plan, page.url().slice(BASE.length));
    const e = v.take();
    check(`${name}: no console / page / HTTP errors`, !e, e);
  } catch (e) {
    check(`${name}: ran through`, false, `${String((e as Error)?.message || e).split("\n")[0]} · ${v.take()}`);
  } finally {
    await v.ctx.close();
  }
}

async function newAddress(browser: any, kind: Kind, industry: string, toStripe: boolean) {
  const name = `${kind}${industry ? " ?industry=" + industry : ""}`;
  const v = await visitor(browser, kind);
  try {
    const s1 = await toCode(v, `otp.${kind}.${STAMP}@${MAIL_DOMAIN}`, industry ? `&industry=${industry}` : "");
    check(`${name}: step 1 — Google on top, trial line, Continue → code screen`, s1.ok && s1.googleOnTop && /^\d-day free trial · (Card required|No card needed) · Cancel anytime$/.test(s1.trial), [s1.trial, s1.err, v.take()].filter(Boolean).join(" · "));
    if (!s1.ok) return;
    check(`${name}: the draft rides in the address`, /[?&]d=/.test(v.page.url()), v.page.url().slice(BASE.length));
    const d = await plantCode(v.page.url());
    await v.page.fill("#otpCode", "000000");
    await v.page.waitForTimeout(1500);
    check(`${name}: a wrong code says how many tries are left`, /4 tries left/.test(await codeNote(v)), await codeNote(v));
    if (kind === "desk") {
      v.step("reload on the code screen");
      await v.page.reload({ waitUntil: "load" });
      const back = await v.page.locator("#otpCode").waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
      check(`${name}: a reload reopens the code screen`, back);
      // The email's button in another browser; the waiting tab follows on its next look.
      const other = await visitor(browser, "phone");
      other.step("the email's button");
      await other.page.goto(await plantLink(d), { waitUntil: "load", timeout: 120000 });
      const there = await other.page.locator("section.plan-sheet.is-in").waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
      const here = await v.page.locator("section.plan-sheet.is-in").waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
      const e2 = other.take();
      check(`${name}: the email's button opens the plan in another browser, the waiting tab follows`, there && here && !e2, e2);
      await other.ctx.close();
    } else {
      v.step("the right code");
      await v.page.fill("#otpCode", CODE);
      const plan = await v.page.locator("section.plan-sheet.is-in").waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
      check(`${name}: the right code opens the plan sheet`, plan, v.page.url().slice(BASE.length));
      if (!plan) return;
    }
    const tok = new URL(v.page.url()).searchParams.get("signup");
    const rec = tok ? await db.syncState.findUnique({ where: { key: `signup:${tok}` } }) : null;
    const r = rec ? JSON.parse(rec.cursor) : {};
    check(`${name}: the intent — no password, address proven, name stands in${industry ? ", the trade" : ""}`, r.hashedPassword === null && !!r.emailVerifiedAt && r.nameUnset === true && (!industry || (r.tradeTypes ?? []).length === 1), JSON.stringify({ trades: r.tradeTypes, verified: !!r.emailVerifiedAt }));
    if (!toStripe) { const e = v.take(); check(`${name}: plan sheet`, !e, e); return; }
    v.step("plan → Checkout");
    const go = v.page.locator("section.plan-sheet.is-in .pw-plan .pw-go").filter({ visible: true }).first();
    await v.page.waitForTimeout(800);
    await go.click();
    for (let i = 0; i < 80 && !v.handoff.checkout; i++) await v.page.waitForTimeout(250);
    const e = v.take();
    check(`${name}: Start free trial → Stripe Checkout`, !!v.handoff.checkout && !e, [v.handoff.checkout ? "→ " + v.handoff.checkout.slice(0, 40) + "…" : "no hand-off", e].filter(Boolean).join(" · "));
  } catch (e) {
    check(`${name}: ran through`, false, `${String((e as Error)?.message || e).split("\n")[0]} · ${v.take()}`);
  } finally {
    await v.ctx.close();
  }
}

async function burn(browser: any) {
  const v = await visitor(browser, "phone");
  try {
    const s1 = await toCode(v, `otp.burn.${STAMP}@${MAIL_DOMAIN}`);
    if (!s1.ok) return check("five wrong codes: code screen", false, s1.err);
    await plantCode(v.page.url());
    for (let i = 0; i < 5; i++) { await v.page.fill("#otpCode", "000000"); await v.page.waitForTimeout(1300); }
    const n5 = await codeNote(v);
    await v.page.fill("#otpCode", CODE);
    await v.page.waitForTimeout(1500);
    const after = await codeNote(v);
    const e = v.take();
    check("five wrong codes burn the code; the right one is refused after", /used up/.test(n5) && /can't be used/.test(after) && !(await v.page.locator("section.plan-sheet.is-in").count()) && !e, `${n5} / ${after}${e ? " · " + e : ""}`);
  } finally {
    await v.ctx.close();
  }
}

/** THE NEW-ACCOUNT BRAKE: twenty an hour per IP + User-Agent (lib/signupOtp). With this
 *  browser's pair already at twenty, a proven new address is refused in words and the code
 *  stays good; the same IP in another browser (another User-Agent) goes through. */
async function brake(browser: any) {
  const ip = newIp();
  const v = await visitor(browser, "phone", ip);
  try {
    const s1 = await toCode(v, `otp.brake.${STAMP}@${MAIL_DOMAIN}`);
    if (!s1.ok) return check("brake: code screen", false, s1.err);
    await plantCode(v.page.url());
    const key = `rl:otp-signup:${ip}:${sha(IPHONE).slice(0, 16)}`;
    await db.syncState.upsert({ where: { key }, create: { key, cursor: `20:${Date.now() + 3_600_000}` }, update: { cursor: `20:${Date.now() + 3_600_000}` } });
    v.step("the 21st new account from this IP + browser");
    await v.page.fill("#otpCode", CODE);
    await v.page.waitForTimeout(1800);
    const said = await codeNote(v);
    const e = v.take();
    check("brake: the 21st new account from one IP + User-Agent is refused in words", /^Too many sign-ups. Try again in /.test(said) && !(await v.page.locator("section.plan-sheet.is-in").count()) && !e, said + (e ? " · " + e : ""));
  } finally {
    await v.ctx.close();
  }
  const w = await visitor(browser, "desk", ip);
  try {
    const s1 = await toCode(w, `otp.brake2.${STAMP}@${MAIL_DOMAIN}`);
    if (!s1.ok) return check("brake: other browser code screen", false, s1.err);
    await plantCode(w.page.url());
    await w.page.fill("#otpCode", CODE);
    const plan = await w.page.locator("section.plan-sheet.is-in").waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
    check("brake: the same IP in another browser still signs up", plan, w.take());
  } finally {
    await w.ctx.close();
  }
}

async function instagram(browser: any) {
  const v = await visitor(browser, "ig-ios");
  try {
    v.step("Instagram step 1");
    await v.page.goto(`${BASE}/auth/register?flow=otp&industry=fencing&fbclid=QaZ9`, { waitUntil: "load", timeout: 180000 });
    await v.page.locator("#googleBtn").waitFor({ timeout: 120000 });
    await v.page.waitForTimeout(800);
    // The hand-off itself: a desktop Chrome has no handler for x-safari-https and says which address it was given.
    const launched: string[] = [];
    v.page.on("console", (m: any) => { const x = /Failed to launch '([^']+)'/.exec(m.text()); if (x) launched.push(x[1]); });
    await v.page.click("#googleBtn");
    await v.page.waitForTimeout(2200);
    const target = launched[0] ?? "";
    const help = await v.page.locator("[data-handoff-help]").count();
    const e = v.take();
    check("Instagram (iOS): Google hands the page to Safari with google=1 and the trade; the help shows when it stays", /^x-safari-https?:\/\/.*google=1/.test(target) && /industry=fencing/.test(target) && help > 0 && !e, [target.slice(0, 90), e].filter(Boolean).join(" · "));
  } finally {
    await v.ctx.close();
  }
}

/** qa@acme.test (QA Co): the register page's code and the sign-in page's both sign it in. */
async function existing(browser: any) {
  const qa = await db.user.findUnique({ where: { email: QA_EMAIL }, select: { id: true } });
  if (!qa) return note("existing account", `${QA_EMAIL} is not seeded — skipped`);
  const v = await visitor(browser, "phone");
  try {
    const s1 = await toCode(v, QA_EMAIL);
    check("register with an address that has an account: the same code screen", s1.ok, s1.err);
    if (!s1.ok) return;
    await plantCode(v.page.url());
    v.step("the code signs in");
    await v.page.fill("#otpCode", CODE);
    const ok = await v.page.waitForURL(/\/dashboard/, { timeout: 60000 }).then(() => true).catch(() => false);
    const e = v.take();
    check("…and the code signs it in (no 'account exists' dead end)", ok && !e, [v.page.url().slice(BASE.length), e].filter(Boolean).join(" · "));
  } finally {
    await v.ctx.close();
  }
  const l = await visitor(browser, "desk");
  try {
    l.step("sign-in page");
    // ?email= names the address in every mode: a dev server otherwise prefills
    // the owner's, and a fill before hydration would ask a code for it.
    await l.page.goto(`${BASE}/auth/login?email=${encodeURIComponent(QA_EMAIL)}`, { waitUntil: "load", timeout: 180000 });
    await l.page.locator("#emailCodeBtn").waitFor({ timeout: 120000 });
    await l.page.waitForTimeout(800);
    await l.page.fill('input[type="email"]', QA_EMAIL);
    if ((await l.page.inputValue('input[type="email"]')) !== QA_EMAIL) throw new Error(`the sign-in field does not hold ${QA_EMAIL}`);
    await l.page.click("#emailCodeBtn");
    await l.page.locator("#loginCode").waitFor({ timeout: 60000 });
    await l.page.waitForTimeout(500);
    // The sign-in draft is not in the address: the newest one for this address.
    const row = await db.syncState.findFirst({ where: { key: { startsWith: "otp:" }, cursor: { contains: `"email":"${QA_EMAIL}"` } }, orderBy: { updatedAt: "desc" } });
    const d = row!.key.slice(4);
    await plantCode(`${BASE}/?d=${d}`);
    // The same six squares as the register page (otp-code-field).
    const form = await l.page.locator("form").first().innerText();
    const label = (await l.page.locator('label[for="loginCode"]').textContent())?.trim();
    let s = await squares(l.page, "loginCode");
    check("/auth/login: the six upright boxes (no shadow, ≤6px apart) over one one-time-code field, focused; the account line kept, \"It works for 10 minutes.\" gone", s.cells === 6 && s.fields === 1 && s.focused && s.current === 0 && s.ch > s.cwMax && s.gap <= 6 && s.shadow === "none" && label === "Enter 6-digit code" && /If\s+qa@acme\.test\s+has a JobFlex account, a 6-digit code is on its way\./.test(form) && !/It works for 10 minutes/.test(form), [label, sq(s)].join(" · "));
    await pasteInto(l.page, "loginCode", "999 999");
    await settle(l.page, "loginCodeMsg", /isn't right/);
    s = await squares(l.page, "loginCode");
    check("/auth/login: a wrong code pasted — red, cleared, focused, the reason under the squares", s.invalid && s.red && s.value === "" && s.focused && /isn't right/.test(s.msg), sq(s));
    await keys(l.page, CODE);
    const ok = await l.page.waitForURL(/\/dashboard/, { timeout: 60000 }).then(() => true).catch(() => false);
    const e = l.take();
    check("/auth/login → Email me a code → the code digit by digit → signed in", ok && !e, [l.page.url().slice(BASE.length), e].filter(Boolean).join(" · "));
  } finally {
    await l.ctx.close();
  }
}

async function main() {
  const pw = playwright();
  let server: ChildProcess | null = null;
  try {
    if (!process.env.QA_OTP_URL) {
      ensureBuild(note);
      server = await startServer(PORT, { STRIPE_SECRET_KEY: "", RESEND_API_KEY: "", SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "" }, "QA_OTP_PORT");
    }
    const mode = (await db.syncState.findUnique({ where: { key: "stripe:mode" } }))?.cursor;
    const toStripe = mode === "test";
    if (!toStripe) note("Stripe", `dev.db stripe:mode is "${mode ?? "live"}" — runs stop at the plan sheet`);
    const browser = await pw.chromium.launch({ channel: "chrome", args: ["--disable-blink-features=AutomationControlled"] }).catch(() => pw.chromium.launch());
    try {
      await newAddress(browser, "phone", "roofing", toStripe);
      await newAddress(browser, "desk", "", toStripe);
      await burn(browser);
      await brake(browser);
      await instagram(browser);
      await existing(browser);
      await codeSquares(browser, 360);
      await codeSquares(browser, 390);
      await codeSquares(browser, 1440);
    } finally {
      await browser.close();
    }
    // The squares in Safari's engine too, when Playwright's WebKit is installed.
    const wk = await pw.webkit.launch().catch(() => null);
    if (!wk) note("WebKit", "not installed (npx playwright install webkit) — the squares ran in Chromium only");
    else {
      try {
        await codeSquares(wk, 360);
        await codeSquares(wk, 390);
      } finally {
        await wk.close();
      }
    }
  } finally {
    stopServer(server);
    await db.syncState.deleteMany({ where: { key: { startsWith: "signup:" }, cursor: { contains: MAIL_DOMAIN } } }).catch(() => {});
    await db.syncState.deleteMany({ where: { key: { startsWith: "otp:" }, cursor: { contains: MAIL_DOMAIN } } }).catch(() => {});
    await db.syncState.deleteMany({ where: { key: { in: DRAFTS.map((d) => `otp:${d}`) } } }).catch(() => {});
    await db.syncState.deleteMany({ where: { key: { startsWith: "otp-link:" }, cursor: { in: DRAFTS } } }).catch(() => {});
    await db.syncState.deleteMany({ where: { OR: [...IPS.map((ip) => ({ key: { startsWith: "rl:", endsWith: ":" + ip } })), ...IPS.map((ip) => ({ key: { startsWith: `rl:otp-signup:${ip}:` } })), { key: `rl:otp-mail:${QA_EMAIL}` }, { key: { startsWith: "rl:otp-mail:", contains: MAIL_DOMAIN } }] } }).catch(() => {});
    await db.$disconnect();
  }
  console.log(bad ? `\n${bad} failing` : "\nall green");
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log("\n1 failing"); process.exit(1); });
