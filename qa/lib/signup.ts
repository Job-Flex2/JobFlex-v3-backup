// The passwordless sign-up, step by step, for the signup and billing suites:
//   /auth/register?flow=otp → name + email → the code (from /api/qa/otp) → the plan step →
//   Stripe Checkout in TEST mode with 4242… → back in the app, signed in.
// A live Checkout (cs_live_) never loads: forbidden.yaml aborts it before a card can be typed.
import { expect, type Page } from "@playwright/test";
import { open } from "./fixtures";
import { fetchOtp } from "./otp";
import { prisma } from "./db";

export async function startSignup(page: Page, email: string, name = "QA Lab"): Promise<{ askedAt: number; draft: string | null }> {
  await open(page, "/auth/register?flow=otp", { settleMs: 1200 });
  await page.fill("#name", name);
  await page.fill("#email", email);
  const askedAt = Date.now();
  await page.click("#nextBtn");
  await expect(page.locator("#otpCode")).toBeVisible({ timeout: 60_000 });
  return { askedAt, draft: new URL(page.url()).searchParams.get("d") };
}

/** Types a code into the six squares (the field submits on the sixth digit). */
export async function enterCode(page: Page, code: string): Promise<void> {
  await page.locator("#otpCode").fill(code);
}

export async function codeNote(page: Page): Promise<string> {
  return (await page.locator("#otpNote").innerText().catch(() => "")).trim();
}

export async function toPlanStep(page: Page, email: string, askedAt: number): Promise<string | null> {
  const otp = await fetchOtp(email, { after: askedAt - 2000 });
  await enterCode(page, otp.code!);
  await expect(page.locator("section.plan-sheet.is-in")).toBeVisible({ timeout: 60_000 });
  return new URL(page.url()).searchParams.get("signup");
}

/** "Checkout is not configured": the server under test has no Stripe key at all. */
export async function checkoutConfigured(page: Page): Promise<boolean> {
  const go = page.locator("section.plan-sheet.is-in .pw-go").filter({ visible: true }).first();
  await go.waitFor({ timeout: 30_000 });
  return !/not configured/i.test(await go.innerText());
}

/** Picks a plan card by its slug (the phone's rail centres it first) and presses its Start. */
export async function startPlan(page: Page, slug: string, term: "MONTH" | "YEAR" = "MONTH"): Promise<void> {
  if (term === "YEAR") {
    await page.locator("section.plan-sheet.is-in [data-plan-term] button", { hasText: /annual/i }).first().click();
    await expect(page.locator("section.plan-sheet.is-in [data-plan-term]")).toHaveAttribute("data-plan-term", "YEAR");
  }
  const card = page.locator(`section.plan-sheet.is-in [data-plan-card="${slug}"]`).first();
  await card.evaluate((e) => e.scrollIntoView({ inline: "center", block: "nearest" }));
  await page.waitForTimeout(900);
  await card.locator(".pw-go").click();
}

/** Stripe's hosted Checkout, test mode: the 4242 card, any future date, any CVC. */
export async function payWithTestCard(page: Page, card = "4242424242424242"): Promise<void> {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 90_000 });
  expect(page.url(), "Stripe Checkout must be a TEST session").toMatch(/cs_test_/);
  // Checkout may lead with Link or a wallet; the card form is behind "Pay with card" then.
  // The methods are an accordion (Card, Cash App, Klarna, …). Its Card button is a zero-size
  // overlay Playwright calls invisible, so it is pressed in the page; with a single method the
  // card fields are already open and the button is absent.
  const cardButton = page.locator('[data-testid="card-accordion-item-button"]');
  await cardButton.waitFor({ state: "attached", timeout: 20_000 }).catch(() => {});
  if (await cardButton.count()) await cardButton.first().evaluate((b) => (b as HTMLButtonElement).click());
  await page.locator("#cardNumber").fill(card, { timeout: 60_000 });
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  const name = page.locator("#billingName");
  if (await name.isVisible().catch(() => false)) await name.fill("QA Lab");
  const zip = page.locator("#billingPostalCode");
  if (await zip.isVisible().catch(() => false)) await zip.fill("98033");
  // Link's "save my info" would ask for a phone number; leave it off.
  const save = page.locator("#enableStripePass, input[name=enableStripePass]");
  if (await save.isChecked().catch(() => false)) await save.evaluate((c) => (c as HTMLInputElement).click());
  await page.locator('[data-testid="hosted-payment-submit-button"], button.SubmitButton, button[type=submit]').first().click();
}

/** What the database says about the account a sign-up made. */
export async function accountOf(email: string) {
  const db = prisma();
  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true, emailVerified: true,
      memberships: { select: { role: true, organization: { select: { id: true, name: true, slug: true, billingEmail: true, subscription: { select: { plan: true, status: true, provider: true, trialEndsAt: true, externalSubId: true, stripePriceId: true, currentPeriodEnd: true } } } } } },
    },
  });
  return user;
}
