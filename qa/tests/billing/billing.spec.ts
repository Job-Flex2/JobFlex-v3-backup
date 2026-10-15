// BILLING — Stripe TEST mode only (a cs_live_ Checkout is a forbidden request, forbidden.yaml).
// Each test makes its own trial account through the real sign-up (lib/signup.ts) and then works
// on /dashboard/upgrade at 1440, checking the Subscription row after every action. The rules
// these flows follow (proration, the YEAR → MONTH switch booked for the period end) are pinned at
// the data level by the legacy billing checks (plan-change.check.ts and others in this folder).
import { test, expect, open } from "../../lib/fixtures";
import { qaEmail } from "../../lib/otp";
import { accountOf, checkoutConfigured, payWithTestCard, startPlan, startSignup, toPlanStep } from "../../lib/signup";
import { prisma } from "../../lib/db";
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

async function priceOf(plan: string, interval: "MONTH" | "YEAR"): Promise<string | null> {
  const row = await prisma().planPrice.findFirst({ where: { planSlug: plan, interval, active: true }, select: { stripePriceId: true } });
  return row?.stripePriceId ?? null;
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
  const yearly = await priceOf("professional", "YEAR");
  test.skip(!yearly, "no active yearly price for professional in PlanPrice (sync plans in /admin/plans)");
  await open(page, "/dashboard/upgrade", { settleMs: 1500 });
  await chooseTerm(page, "YEAR");
  const go = page.locator('[data-plan-card="professional"] .jf-up-go');
  await expect(go).toHaveText(/switch to annual/i);
  await go.click();
  await page.locator(".jf-confirm-btn.primary").click();
  await expect.poll(async () => (await subscriptionOf(orgId))?.stripePriceId, { timeout: 90_000, message: "the subscription row carries the yearly price" }).toBe(yearly);
  qa.meta({ after: await subscriptionOf(orgId) });
});

test("annual → monthly: the switch is booked for the period end, the yearly price stays until then @billing @writes", async ({ page, qa }) => {
  test.setTimeout(8 * 60_000);
  const { orgId } = await test.step("an annual trial account", () => trialAccount(page, "y2m", "professional", "YEAR"));
  const yearly = await priceOf("professional", "YEAR");
  expect((await subscriptionOf(orgId))?.stripePriceId, "starts on the yearly price").toBe(yearly);
  await open(page, "/dashboard/upgrade", { settleMs: 1500 });
  await chooseTerm(page, "MONTH");
  const go = page.locator('[data-plan-card="professional"] .jf-up-go');
  await expect(go).toHaveText(/switch to monthly/i);
  await go.click();
  await page.locator(".jf-confirm-btn.primary").click();
  await expect(page.getByText(/booked|switches to monthly|from .* monthly/i).first(), "the page says when the switch happens").toBeVisible({ timeout: 60_000 });
  const after = await subscriptionOf(orgId);
  qa.meta({ after });
  expect(after?.stripePriceId, "still yearly until the period ends").toBe(yearly);
  expect(after?.status).toBe("TRIALING");
});

test("adding a card after the trial ended @billing @writes", async () => {
  test.skip(true, [
    "needs Stripe test clocks: the trial has to END on Stripe's side, which only a test clock can do in a test run.",
    "What it takes: start the dev server with STRIPE_TEST_CLOCKS=1 (lib: api/checkout/signup attaches a clock to test customers),",
    "a webhook forward (stripe listen --events customer.subscription.updated,invoice.payment_failed,checkout.session.completed --forward-to <server>/api/webhooks/stripe)",
    "and STRIPE_WEBHOOK_SECRET from `stripe listen --print-secret`; then the test advances the clock past trial_end, expects the TRIAL_ENDED / PAST_DUE ribbon,",
    "opens /api/billing/update-card (Checkout in setup mode), pays with 4242 and expects ACTIVE. The harness .cache/trial/card-flow.cjs did this by hand on 2026-10-06.",
  ].join(" "));
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
