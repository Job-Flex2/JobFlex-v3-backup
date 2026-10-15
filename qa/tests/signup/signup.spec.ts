// SIGNUP — the passwordless sign-up from the first screen to the dashboard, and the ways it can go
// wrong. Every address is new: qa-<label>-<timestamp>@qa.jobflex.test; the code comes from the
// app's test endpoint (QA_TEST_MODE=1), never from a mailbox. Local servers only (lib/target.ts).
// Traces are off here: they would record the code typed into the field.
import { test, expect, open } from "../../lib/fixtures";
import { fetchOtp, qaEmail } from "../../lib/otp";
import { accountOf, checkoutConfigured, codeNote, enterCode, payWithTestCard, startPlan, startSignup, toPlanStep } from "../../lib/signup";
import { prisma } from "../../lib/db";
import { credentials } from "../../lib/roles";

test.use({ trace: "off" });

test.describe("the whole path", () => {
  test("code → plan step: the address is proven and the intent kept @signup @webkit", async ({ page, qa }) => {
    const email = qaEmail("plan");
    const { askedAt } = await test.step("name and email", () => startSignup(page, email));
    const token = await test.step("the emailed code", () => toPlanStep(page, email, askedAt));
    expect(token, "the plan step carries ?signup=").toBeTruthy();
    const row = await prisma().syncState.findUnique({ where: { key: `signup:${token}` } });
    const rec = row ? (JSON.parse(row.cursor) as { email?: string; emailVerifiedAt?: unknown; hashedPassword?: unknown }) : null;
    expect(rec?.email, "the pending sign-up is for this address").toBe(email);
    expect(rec?.emailVerifiedAt, "the address is marked proven").toBeTruthy();
    expect(rec?.hashedPassword ?? null, "no password in a passwordless sign-up").toBeNull();
    await qa.shot(page, "plan-step");
    expect(qa.collector.data.pageErrors).toEqual([]);
  });

  test("plan → test card 4242 → dashboard: company, owner seat and trial are right @signup @writes", async ({ page, qa }) => {
    test.setTimeout(6 * 60_000);
    const email = qaEmail("full");
    const { askedAt } = await test.step("name and email", () => startSignup(page, email, "QA Full Path"));
    await test.step("the emailed code", () => toPlanStep(page, email, askedAt));
    test.skip(!(await checkoutConfigured(page)), "the server under test has no Stripe key (the plan step says \"Checkout is not configured\") — start it with STRIPE_SECRET_KEY_TEST and dev.db stripe:mode=test");
    await test.step("Start free trial on Professional (monthly)", () => startPlan(page, "professional"));
    await test.step("Stripe Checkout, test card", () => payWithTestCard(page));
    await test.step("back in the app, signed in", async () => {
      await page.waitForURL((u) => u.hostname !== "checkout.stripe.com" && u.pathname.startsWith("/dashboard"), { timeout: 120_000 });
    });
    const who = await page.evaluate(async () => (await (await fetch("/api/auth/session")).json())?.user?.email ?? null);
    expect(who, "signed in as the new account").toBe(email);
    const acct = await accountOf(email);
    qa.meta({ account: acct });
    expect(acct?.emailVerified, "email marked verified").toBeTruthy();
    const seat = acct?.memberships[0];
    expect(seat?.role, "the new user owns the company").toBe("OWNER");
    const sub = seat?.organization.subscription;
    expect(sub?.status, "a trial").toBe("TRIALING");
    expect(sub?.provider).toBe("STRIPE");
    expect(sub?.externalSubId ?? "", "a Stripe subscription id").toMatch(/^sub_/);
    expect(String(sub?.plan).toLowerCase()).toContain("professional");
    const days = sub?.trialEndsAt ? (new Date(sub.trialEndsAt).getTime() - Date.now()) / 864e5 : 0;
    expect(days, "the trial ends about 7 days from now").toBeGreaterThan(6);
    expect(days).toBeLessThan(8.1);
    await qa.shot(page, "dashboard");
  });
});

test.describe("variants", () => {
  test("Google is offered on sign-up and sign-in, and goes to Google @signup", async ({ page }) => {
    const seen: string[] = [];
    await page.route(/accounts\.google\.com/, (route) => { seen.push(route.request().url()); return route.fulfill({ status: 200, contentType: "text/html", body: "<title>google</title>" }); });
    await open(page, "/auth/register?flow=otp");
    await expect(page.locator("#googleBtn")).toBeVisible();
    await page.click("#googleBtn");
    await expect.poll(() => seen.length, { timeout: 30_000, message: "the button leads to accounts.google.com" }).toBeGreaterThan(0);
    const u = new URL(seen[0]);
    expect(u.searchParams.get("client_id"), "a Google client id").toBeTruthy();
    expect(u.searchParams.get("redirect_uri") ?? "", "Google returns to NextAuth's callback").toMatch(/\/api\/auth\/callback\/google$/);
    seen.length = 0;
    await open(page, "/auth/login?email=nobody%40qa.jobflex.test");
    await page.click("#googleBtn");
    await expect.poll(() => seen.length, { timeout: 30_000, message: "sign-in's Google button too" }).toBeGreaterThan(0);
  });

  test("a wrong code is refused and says how many tries are left @signup", async ({ page }) => {
    const email = qaEmail("wrong");
    const { askedAt } = await startSignup(page, email);
    const otp = await fetchOtp(email, { after: askedAt - 2000 });
    const wrong = otp.code === "000000" ? "111111" : "000000";
    await enterCode(page, wrong);
    await expect.poll(() => codeNote(page), { timeout: 20_000 }).toMatch(/isn.t right.*4 tries left/i);
    await expect(page.locator("section.plan-sheet.is-in")).toHaveCount(0);
  });

  test("an expired code is refused with a way to get a new one @signup", async ({ page }) => {
    const email = qaEmail("expired");
    const { askedAt, draft } = await startSignup(page, email);
    const otp = await fetchOtp(email, { after: askedAt - 2000 });
    expect(draft, "the code screen names its draft (?d=)").toBeTruthy();
    // The code's ten minutes, run out: the draft's expiry set in the past (QA address, local DB).
    const db = prisma();
    const row = await db.syncState.findUniqueOrThrow({ where: { key: `otp:${draft}` } });
    const d = JSON.parse(row.cursor);
    expect(d.email).toBe(email);
    d.code.exp = Date.now() - 1000;
    await db.syncState.update({ where: { key: `otp:${draft}` }, data: { cursor: JSON.stringify(d) } });
    await enterCode(page, otp.code!);
    await expect.poll(() => codeNote(page), { timeout: 20_000 }).toMatch(/expired.*send a new code/i);
    await expect(page.locator("section.plan-sheet.is-in")).toHaveCount(0);
  });

  test("Resend sends a new code after the countdown; the old one stops working @signup", async ({ page }) => {
    test.setTimeout(3 * 60_000);
    const email = qaEmail("resend");
    const { askedAt } = await startSignup(page, email);
    const first = await fetchOtp(email, { after: askedAt - 2000 });
    await expect(page.locator("#otpResend")).toHaveText(/Resend code in \d+ s/);
    await expect(page.locator("#otpResend")).toBeEnabled({ timeout: 45_000 });
    const resent = Date.now();
    await page.click("#otpResend");
    const second = await fetchOtp(email, { after: resent - 500 });
    expect(second.at).toBeGreaterThan(first.at);
    if (second.code !== first.code) {
      await enterCode(page, first.code!);
      await expect.poll(() => codeNote(page), { timeout: 20_000, message: "the first code no longer works" }).toMatch(/isn.t right|tries left/i);
    }
    await page.locator("#otpCode").fill("");
    await enterCode(page, second.code!);
    await expect(page.locator("section.plan-sheet.is-in")).toBeVisible({ timeout: 60_000 });
  });

  test("an address that already has an account signs in, and no second company is made @signup", async ({ page }) => {
    const existing = credentials("manager")?.email;
    test.skip(!existing, "no QA manager account (npm run qa:seed-roles)");
    const db = prisma();
    const before = await db.membership.count({ where: { user: { email: existing! } } });
    const { askedAt } = await startSignup(page, existing!);
    const otp = await fetchOtp(existing!, { after: askedAt - 2000 });
    await enterCode(page, otp.code!);
    await page.waitForURL((u) => !u.pathname.startsWith("/auth/register"), { timeout: 60_000 });
    const who = await page.evaluate(async () => (await (await fetch("/api/auth/session")).json())?.user?.email ?? null);
    expect(who, "the existing account is signed in").toBe(existing);
    expect(await db.membership.count({ where: { user: { email: existing! } } }), "no new seat or company").toBe(before);
  });

  test("leaving the code screen and coming back keeps the address @signup @webkit", async ({ page }) => {
    const email = qaEmail("return");
    const { askedAt } = await startSignup(page, email);
    await open(page, "/");
    await open(page, "/auth/register?flow=otp", { settleMs: 1500 });
    await expect(page.locator("#otpCode"), "the code screen comes back").toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#otpAddr"), "with the address it was sent to").toContainText(email);
    const otp = await fetchOtp(email, { after: askedAt - 2000 });
    await enterCode(page, otp.code!);
    await expect(page.locator("section.plan-sheet.is-in")).toBeVisible({ timeout: 60_000 });
  });

  test("on a 390 phone: no sideways scroll on any step, Continue reachable @signup @webkit", async ({ page }) => {
    const email = qaEmail("phone");
    const scroll = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    await open(page, "/auth/register?flow=otp");
    expect(await scroll(), "step 1 scrolls sideways").toBe(false);
    const btn = await page.locator("#nextBtn").boundingBox();
    expect(btn && btn.height >= 44, "Continue is at least 44px tall").toBeTruthy();
    const { askedAt } = await startSignup(page, email);
    expect(await scroll(), "the code screen scrolls sideways").toBe(false);
    await toPlanStep(page, email, askedAt);
    expect(await scroll(), "the plan step scrolls sideways").toBe(false);
  });
});
