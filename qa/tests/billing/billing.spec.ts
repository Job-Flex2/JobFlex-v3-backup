// BILLING — Stripe TEST mode only (a cs_live_ Checkout is a forbidden request, forbidden.yaml).
// Each test makes its own trial account through the real sign-up (lib/signup.ts) and then works
// on /dashboard/upgrade at 1440, checking the Subscription row after every action. In test mode
// the Checkout price comes from lib/signupPricing, not from the PlanPrice mirror (that is the
// live account's), so the row is compared with the price it started on. The rules
// these flows follow (proration, the YEAR → MONTH switch booked for the period end) are pinned at
// the data level by the legacy billing checks (plan-change.check.ts and others in this folder).
import { test, expect, open } from "../../lib/fixtures";
import { qaEmail } from "../../lib/otp";
import { accountOf, checkoutConfigured, payWithTestCard, startPlan, startSignup, toPlanStep } from "../../lib/signup";
import { prisma } from "../../lib/db";
import { advanceClock, stripe, stripeTestKey } from "../../lib/stripeTest";
import type { Page } from "@playwright/test";

test.use({ trace: "off", viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

const NO_STRIPE = "the server under test has no Stripe key (\"Checkout is not configured\") — start it with STRIPE_SECRET_KEY_TEST and dev.db stripe:mode=test";

/** A new trialing account on `plan` / `term`, signed in, or a skip when Checkout cannot open. */
async function trialAccount(page: Page, label: string, plan = "professional", term: "MONTH" | "YEAR" = "MONTH") {
  const email = qaEmail(label);
  const { askedAt } = await startSignup(page, email, `QA Billing ${label}`);
  await toPlanStep(page, email, askedAt);
  test.skip(!(await checkoutConfigured(page)), NO_STRIPE);
  await startPlan(page, plan, term);
  await payWithTestCard(page);
  await page.waitForURL((u) => u.hostname !== "checkout.stripe.com" && u.pathname.startsWith("/dashboard"), { timeout: 120_000 });
  const acct = await accountOf(email);
  const sub = acct?.memberships[0]?.organization.subscription;
  expect(sub?.status, "the new account is on a trial").toBe("TRIALING");
  return { email, orgId: acct!.memberships[0].organization.id };
}

async function subscriptionOf(orgId: string) {
  return prisma().subscription.findUnique({ where: { organizationId: orgId }, select: { plan: true, status: true, stripePriceId: true, externalSubId: true, trialEndsAt: true, currentPeriodEnd: true } });
}
async function chooseTerm(page: Page, term: "MONTH" | "YEAR") {
  await page.locator("[data-plan-term] button", { hasText: term === "YEAR" ? /annual/i : /monthly/i }).first().click();
  await page.waitForTimeout(600);
}

test("monthly → annual on the same plan: the subscription moves to the yearly price @billing @writes", async ({ page, qa }) => {
  test.setTimeout(8 * 60_000);
  const { orgId } = await test.step("a monthly trial account", () => trialAccount(page, "m2y"));
  const monthly = (await subscriptionOf(orgId))?.stripePriceId;
  await open(page, "/dashboard/upgrade", { settleMs: 1500 });
  await chooseTerm(page, "YEAR");
  const go = page.locator('[data-plan-card="professional"] .jf-up-go');
  await expect(go).toHaveText(/switch to annual/i);
  await go.click();
  await page.locator(".jf-confirm-btn.primary").click();
  await expect.poll(async () => (await subscriptionOf(orgId))?.stripePriceId, { timeout: 90_000, message: "the subscription row moves off the monthly price" }).not.toBe(monthly);
  await open(page, "/dashboard/upgrade", { settleMs: 1500 });
  await chooseTerm(page, "YEAR");
  await expect(page.locator('[data-plan-card="professional"]'), "on Annual, Professional is the current plan").toContainText(/current plan/i);
  const after = await subscriptionOf(orgId);
  qa.meta({ before: monthly, after });
  expect(after?.plan?.toLowerCase()).toContain("professional");
});

test("annual → monthly during a trial: the switch happens at once, on the monthly price @billing @writes", async ({ page, qa }) => {
  // The owner's rule (2026-10-14): during a TRIAL nothing has been paid, so annual → monthly switches
  // at once. (A PAID annual plan books the switch for the period end — lib/planChange; that case
  // needs a subscription past its trial, i.e. test clocks, like the card-after-trial test below.)
  test.setTimeout(8 * 60_000);
  const { orgId } = await test.step("an annual trial account", () => trialAccount(page, "y2m", "professional", "YEAR"));
  const yearly = (await subscriptionOf(orgId))?.stripePriceId;
  await open(page, "/dashboard/upgrade", { settleMs: 1500 });
  await chooseTerm(page, "YEAR");
  await expect(page.locator('[data-plan-card="professional"]'), "it starts on Annual").toContainText(/current plan/i);
  await chooseTerm(page, "MONTH");
  const go = page.locator('[data-plan-card="professional"] .jf-up-go');
  await expect(go).toHaveText(/switch to monthly/i);
  await go.click();
  await page.locator(".jf-confirm-btn.primary").click();
  await expect.poll(async () => (await subscriptionOf(orgId))?.stripePriceId, { timeout: 90_000, message: "the subscription row moves off the yearly price at once" }).not.toBe(yearly);
  await open(page, "/dashboard/upgrade", { settleMs: 1500 });
  await chooseTerm(page, "MONTH");
  await expect(page.locator('[data-plan-card="professional"]'), "on Monthly, Professional is the current plan").toContainText(/current plan/i);
  await expect(page.getByText(/switch booked|switches to monthly on/i), "nothing is booked for later").toHaveCount(0);
  const after = await subscriptionOf(orgId);
  qa.meta({ before: yearly, after });
  expect(after?.status, "still on the trial").toBe("TRIALING");
});

// DAY 8 (owner's money path): the 7-day trial ends, Stripe bills the card on file and the card is
// declined (4000 0000 0000 0341 attaches fine and fails every charge); Stripe's retry fails too; the
// owner puts a new card in through the app (/api/billing/update-card → Checkout in setup mode → back on
// /dashboard/subscription, which makes it the default and pays what is owed) and the plan is ACTIVE.
// Stripe TEST mode only: the clock is moved with STRIPE_TEST_SECRET_KEY / STRIPE_SECRET_KEY_TEST, which
// lib/stripeTest refuses unless it is sk_test_ / rk_test_.
// What the server under test needs: STRIPE_TEST_CLOCKS=1 (not a production build — the app attaches a
// clock to new test customers only outside NODE_ENV=production) and the Stripe webhooks forwarded to it
// (stripe listen --forward-to <server>/api/webhooks/stripe, its whsec_ as STRIPE_WEBHOOK_SECRET).
test("day 8: the first charge is declined, the retry fails, a new card pays @billing @writes", async ({ page, qa }) => {
  test.setTimeout(12 * 60_000);
  test.skip(!stripeTestKey(), "needs Stripe test clocks: no Stripe test key on the QA side (STRIPE_TEST_SECRET_KEY / STRIPE_SECRET_KEY_TEST)");
  const DECLINES = "4000000000000341";

  const { email, orgId } = await test.step("a trial account whose card will decline", async () => {
    const email = qaEmail("day8");
    const { askedAt } = await startSignup(page, email, "QA Billing day8");
    await toPlanStep(page, email, askedAt);
    test.skip(!(await checkoutConfigured(page)), NO_STRIPE);
    await startPlan(page, "professional", "MONTH");
    await payWithTestCard(page, DECLINES);
    await page.waitForURL((u) => u.hostname !== "checkout.stripe.com" && u.pathname.startsWith("/dashboard"), { timeout: 120_000 });
    const acct = await accountOf(email);
    return { email, orgId: acct!.memberships[0].organization.id };
  });

  const subId = (await subscriptionOf(orgId))?.externalSubId;
  expect(subId, "the trial has a Stripe subscription").toBeTruthy();
  const sub = await stripe<{ customer: string; trial_end: number | null; status: string }>("GET", `/subscriptions/${subId}`);
  const customer = await stripe<{ test_clock: string | null }>("GET", `/customers/${sub.customer}`);
  test.skip(!customer.test_clock, "needs Stripe test clocks: the server under test did not put the customer on a clock (start it with STRIPE_TEST_CLOCKS=1, not a production build)");
  expect(sub.status, "on Stripe the subscription is trialing").toBe("trialing");
  expect(sub.trial_end, "the trial has an end").toBeTruthy();
  qa.meta({ email, subscription: subId, clock: customer.test_clock });

  const invoice = await test.step("day 8: Stripe bills the card and it is declined", async () => {
    await advanceClock(customer.test_clock!, sub.trial_end! + 24 * 3600);
    const list = await stripe<{ data: { id: string; status: string; attempt_count: number; amount_due: number }[] }>("GET", "/invoices", { subscription: subId!, limit: 3 });
    const inv = list.data.find((i) => i.amount_due > 0);
    expect(inv, "an invoice for the first paid month").toBeTruthy();
    expect(inv!.status, "the declined invoice stays open").toBe("open");
    expect(inv!.attempt_count, "Stripe tried to charge it").toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await subscriptionOf(orgId))?.status, { timeout: 120_000, message: "the app hears the failed charge (webhook): past due or trial ended — if this times out, the webhooks are not forwarded to the server" }).toMatch(/^(PAST_DUE|TRIAL_ENDED)$/);
    return inv!;
  });

  await test.step("the retry fails too", async () => {
    // a manual retry does not move the invoice's attempt_count; the declined charges are the record
    const failedCharges = async () => (await stripe<{ data: { status: string }[] }>("GET", "/charges", { customer: sub.customer, limit: 20 })).data.filter((c) => c.status === "failed").length;
    const before = await failedCharges();
    const r = await stripe<{ status?: string }>("POST", `/invoices/${invoice.id}/pay`);
    expect(r.error?.code ?? r.error?.decline_code, "the old card is declined again").toMatch(/card_declined|insufficient_funds|generic_decline/);
    await expect.poll(failedCharges, { timeout: 30_000, message: "the retry is one more declined charge" }).toBeGreaterThan(before);
    expect((await stripe<{ status: string }>("GET", `/invoices/${invoice.id}`)).status, "still owed").toBe("open");
  });

  await test.step("a new card through the app pays what is owed", async () => {
    await open(page, "/dashboard/subscription", { settleMs: 1200 });
    const url = await page.evaluate(async () => {
      const r = await fetch("/api/billing/update-card", { method: "POST" });
      return ((await r.json().catch(() => ({}))) as { url?: string }).url ?? null;
    });
    expect(url, "/api/billing/update-card answers a Checkout URL").toBeTruthy();
    await page.goto(url!);
    await payWithTestCard(page);
    await page.waitForURL((u) => u.hostname !== "checkout.stripe.com", { timeout: 120_000 });
    await page.waitForLoadState("load").catch(() => {});
    await expect.poll(async () => (await stripe<{ status: string }>("GET", `/invoices/${invoice.id}`)).status, { timeout: 120_000, message: "the open invoice is paid with the new card" }).toBe("paid");
    await expect.poll(async () => (await subscriptionOf(orgId))?.status, { timeout: 120_000, message: "the subscription row is ACTIVE again" }).toBe("ACTIVE");
  });
});

test("custom plan: the price follows the pages picked, and the subscription takes it @billing @writes", async ({ page, qa }) => {
  test.setTimeout(8 * 60_000);
  const { orgId } = await test.step("a monthly trial account", () => trialAccount(page, "custom"));
  await open(page, "/dashboard/upgrade", { settleMs: 1500 });
  const card = page.locator('[data-plan-card="custom"]');
  test.skip(!(await card.count()), "the custom plan is off on this server (CUSTOM_PLAN_ENABLED is not true)");
  const price = async () => Number(await card.getAttribute("data-monthly-cents"));
  const before = await price();
  const pick = card.locator('input[type="checkbox"], [role="checkbox"]').first();
  await pick.click();
  await expect.poll(price, { message: "picking a page changes the custom price" }).not.toBe(before);
  qa.meta({ priceBefore: before, priceAfter: await price() });
  await card.locator(".jf-up-go, button", { hasText: /switch|upgrade|start|choose/i }).first().click();
  const confirm = page.locator(".jf-confirm-btn.primary");
  if (await confirm.isVisible({ timeout: 10_000 }).catch(() => false)) await confirm.click();
  else await payWithTestCard(page);
  await expect.poll(async () => (await subscriptionOf(orgId))?.plan?.toLowerCase(), { timeout: 120_000, message: "the subscription is on the custom plan" }).toContain("custom");
});
