// SMOKE — the money path, in under three minutes: the landing and its HVAC variant, /pricing, sign-up
// with the emailed code up to Stripe Checkout (test mode, not paid — that is the billing suite), sign-in
// as qa@acme.test, a Smart Proposal from text, sending it to a test client and opening its public link,
// the CRM's follow-up rules and the platform admin's health page.
//
// Where it may run: every test here is safe against production — the ones that write (@writes) or sign
// in are skipped there by the fixture (lib/target.ts). A preview deployment shares the production
// database on this project (docs/qa-ci.md), so there @writes is skipped too unless
// QA_ALLOW_PREVIEW_WRITES=1; signed-in pages are only opened. Anything that needs a key the server
// under test does not have (Stripe) is skipped with the reason, never failed.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, open } from "../../lib/fixtures";
import { authFile, credentials } from "../../lib/roles";
import { qaEmail, TestModeOff } from "../../lib/otp";
import { baseUrl, runDir } from "../../lib/env";
import { targetKind } from "../../lib/target";
import { prisma, QA_ORG_SLUG } from "../../lib/db";
import { allowQaSend } from "../../lib/forbidden";
import { installBypass } from "../../lib/vercel";
import { checkoutConfigured, startPlan, toPlanStep } from "../../lib/signup";
import { addSecret } from "../../lib/redact";

/** No uncaught exception and no 5xx from this server, while the test ran. */
function cleanRun(qa: { collector: { data: { pageErrors: unknown[]; httpErrors: { status: number; sameOrigin: boolean; url: string }[] } } }) {
  const d = qa.collector.data;
  expect.soft(d.pageErrors, "uncaught exceptions in the page").toEqual([]);
  expect.soft(d.httpErrors.filter((e) => e.sameOrigin && e.status >= 500).map((e) => `${e.status} ${e.url}`), "5xx answers").toEqual([]);
}

const h1 = (page: Page) => page.locator("h1").first();

test.describe("public pages", () => {
  test("home page opens with its headline @smoke @webkit", async ({ page, qa }) => {
    const r = await open(page, "/");
    expect(r.status).toBe(200);
    await expect(page).toHaveTitle(/JobFlex/i);
    await expect(h1(page)).toBeVisible();
    await expect(h1(page), "the default landing, not a trade variant").not.toContainText(/HVAC/i);
    cleanRun(qa);
  });

  test("the HVAC landing opens with the HVAC headline @smoke", async ({ page, qa }) => {
    const r = await open(page, "/?industry=hvac");
    expect(r.status).toBe(200);
    await expect(page).toHaveTitle(/HVAC/i);
    await expect(h1(page)).toContainText(/HVAC Estimate/i);
    cleanRun(qa);
  });

  test("pricing shows the three plans with their prices @smoke @money", async ({ page, qa }) => {
    const r = await open(page, "/pricing");
    expect(r.status).toBe(200);
    const cards = page.locator(".lp-pw-plans article[data-plan-card]");
    await expect(cards.first()).toBeAttached();
    // by the name on the card: the slugs are older than the names (Advanced is `enterprise`)
    const plans = await cards.evaluateAll((els) => els.map((e) => ({ slug: e.getAttribute("data-plan-card") ?? "", name: (e.querySelector(".lp-pw-plan-n")?.textContent ?? "").trim(), cents: Number(e.getAttribute("data-monthly-cents")), price: (e.querySelector(".lp-pw-price")?.textContent ?? "").replace(/\s+/g, " ").trim() })));
    qa.meta({ route: "/pricing", money: true, plans });
    const THREE = ["Starter", "Professional", "Advanced"];
    expect(plans.map((p) => p.name), "Starter, Professional and Advanced are on /pricing").toEqual(expect.arrayContaining(THREE));
    for (const p of plans.filter((x) => THREE.includes(x.name))) {
      expect.soft(p.cents, `${p.name}: a monthly price above $0`).toBeGreaterThan(0);
      expect.soft(p.price, `${p.name}: a price on the card`).toMatch(/\$\s?\d/);
    }
    cleanRun(qa);
  });

  // Money (2026-10-17): "a $ and a digit" passed while every plan read $0. Each paid plan of the
  // local catalogue (PricingPlan, the one source every plan surface reads) must show its own monthly
  // price on /pricing. A failure here is P1 (analyze/group.ts, @money).
  test("pricing shows the catalogue's own prices @smoke @money", async ({ page, qa }) => {
    test.skip(targetKind() !== "local", "reads the local catalogue — not against a deployment");
    const plans = (await prisma().pricingPlan.findMany({ where: { active: true, priceCents: { gt: 0 } }, select: { slug: true, name: true, priceCents: true } })).filter((p) => !/deck/i.test(p.slug));
    expect(plans.length, "the catalogue has paid plans").toBeGreaterThan(0);
    const r = await open(page, "/pricing", { settleMs: 1500 });
    expect(r.status).toBe(200);
    const text = await page.evaluate(() => document.body.innerText);
    for (const p of plans) {
      const dollars = p.priceCents / 100;
      const price = "$" + (Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2));
      const shown = new RegExp(price.replace(/[$.]/g, "\\$&") + "(?![\\d.,])").test(text);
      expect.soft(shown, `${p.name}: the catalogue's ${price}/month is not on /pricing`).toBe(true);
    }
    qa.meta({ route: "/pricing", money: true, plans: plans.map((p) => `${p.slug} ${p.priceCents}`) });
    cleanRun(qa);
  });

  test("sign-in page shows email, code and Google sign-in @smoke @webkit", async ({ page, qa }) => {
    const r = await open(page, "/auth/login?email=nobody%40qa.jobflex.test");
    expect(r.status).toBe(200);
    await expect(page.locator("#loginEmail")).toBeVisible();
    await expect(page.locator("#googleBtn")).toBeVisible();
    await expect(page.locator("#emailCodeBtn")).toBeVisible();
    cleanRun(qa);
  });

  test("an unknown address answers 404 @smoke @expects-404", async ({ page, qa }) => {
    qa.expectStatus(404); // the 404 is the point of this test — not a finding
    const r = await open(page, "/qa-no-such-page-" + Date.now(), { settleMs: 0 });
    expect(r.status).toBe(404);
  });

  test("platform admin sign-in page opens @smoke", async ({ page, qa }) => {
    const r = await open(page, "/admin/login");
    expect(r.status).toBe(200);
    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    cleanRun(qa);
  });
});

test.describe("API", () => {
  test("auth endpoints answer, and the QA endpoint is gated @smoke", async ({ request }) => {
    const session = await request.get("/api/auth/session");
    expect(session.status()).toBe(200);
    const providers = await request.get("/api/auth/providers");
    expect(providers.status()).toBe(200);
    const list = Object.keys((await providers.json()) as Record<string, unknown>);
    expect(list, "sign-in providers").toEqual(expect.arrayContaining(["credentials", "google"]));
    const csrf = await request.get("/api/auth/csrf");
    expect(csrf.status()).toBe(200);
    // The test endpoint is invisible without the right secret — a plain 404, here and on production.
    const otp = await request.get("/api/qa/otp?email=nobody%40qa.jobflex.test");
    expect(otp.status(), "/api/qa/otp without x-qa-secret answers 404").toBe(404);
    const wrong = await request.get("/api/qa/otp?email=nobody%40qa.jobflex.test", { headers: { "x-qa-secret": "not-the-secret" } });
    expect(wrong.status(), "/api/qa/otp with a wrong x-qa-secret answers 404").toBe(404);
    expect(await wrong.text(), "and says nothing").toBe("");
    // The alert door (/api/qa/alert) is as invisible without its secret.
    const alert = await request.post("/api/qa/alert", { data: { text: "probe" } });
    expect(alert.status(), "/api/qa/alert without x-qa-secret answers 404").toBe(404);
  });

  test("an owner's CSV export answers, a guest's does not @smoke", async ({ request, browser }) => {
    const guest = await request.get("/api/exports/clients.csv", { maxRedirects: 0 });
    expect(guest.status(), "guest gets no CSV").not.toBe(200);
    test.skip(targetKind() === "production", "signed-in half skipped against production");
    const file = authFile("owner");
    test.skip(!fs.existsSync(file), "no owner session");
    const ctx = await browser.newContext({ storageState: file });
    try {
      await installBypass(ctx);
      const r = await ctx.request.get(baseUrl() + "/api/exports/clients.csv");
      expect(r.status()).toBe(200);
      expect(r.headers()["content-type"] ?? "").toMatch(/csv|text/);
    } finally {
      await ctx.close();
    }
  });
});

/** The run's setup (lib/global-setup.ts) for one role: did its sign-in through the page work? */
function setupOf(role: string): { ok: boolean; note: string } | null {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(runDir(), "setup.json"), "utf8")) as { role: string; ok: boolean; note: string }[];
    return list.find((s) => s.role === role) ?? null;
  } catch {
    return null;
  }
}

test.describe("signed in", () => {
  test("sign-in with a password works @smoke", async ({ page, qa }) => {
    test.skip(targetKind() === "production", "against production only guest pages are opened");
    const creds = credentials("owner");
    test.skip(!creds, "no QA_PASS_OWNER");
    if (targetKind() !== "local") {
      // A deployment: the run's setup has just signed qa@acme.test in through this same page
      // (lib/roles signInRole). A second sign-in would spend another try of the brake (8 per 15
      // minutes per address) — on the production database, where a burst of previews adds up.
      const s = setupOf("owner");
      qa.meta({ setup: s });
      expect(s?.ok, `the setup's sign-in as ${creds!.email}: ${s?.note ?? "no setup record"}`).toBe(true);
      return;
    }
    test.info().annotations.push({ type: "note", description: "spends one try of the sign-in brake (8 per 15 minutes) for the owner account" });
    await open(page, `/auth/login?email=${encodeURIComponent(creds!.email)}`);
    await page.waitForTimeout(1200);
    await expect(page.locator("#loginEmail")).toHaveValue(creds!.email);
    if (!(await page.locator("#loginPassword").isVisible())) await page.click("#usePasswordLink");
    await page.fill("#loginPassword", creds!.password);
    await page.click("#signInBtn");
    await page.waitForURL((u) => !u.pathname.startsWith("/auth/login"), { timeout: 60_000 });
    expect(new URL(page.url()).pathname).toMatch(/^\/dashboard/);
    const who = await page.evaluate(async () => (await (await fetch("/api/auth/session")).json())?.user?.email ?? null);
    expect(who).toBe(creds!.email);
    cleanRun(qa);
  });

  test.describe("as the owner", () => {
    test.use({ role: "owner" });

    test("dashboard loads @smoke @webkit", async ({ page, qa }) => {
      const r = await open(page, "/dashboard", { settleMs: 1500 });
      expect(r.status).toBe(200);
      expect(r.finalPath).toMatch(/^\/dashboard/);
      await expect(page.locator("main, [role=main], #main, .main").first()).toBeVisible();
      cleanRun(qa);
    });

    test("/dashboard/proposals loads @smoke", async ({ page, qa }) => {
      const r = await open(page, "/dashboard/proposals", { settleMs: 1200 });
      expect(r.status).toBe(200);
      expect(r.finalPath.startsWith("/dashboard/proposals"), `stayed on /dashboard/proposals, got ${r.finalPath}`).toBeTruthy();
      cleanRun(qa);
    });

    // Opening /dashboard/crm puts the starter follow-up rules in place when the company has none of
    // its own (lib/followUps/defaults — idempotent); Workflows lists them. On a phone (this project)
    // the page is the handheld build, mobile-crm-v2, where the tab reads "Rules"; at desk width it is
    // the Blueprint console's "Workflows" tab.
    test("CRM → Workflows lists the follow-up rules @smoke", async ({ page, qa }) => {
      const r = await open(page, "/dashboard/crm", { settleMs: 1200 });
      expect(r.status).toBe(200);
      const phoneTab = page.getByRole("button", { name: "Rules", exact: true });
      const deskTab = page.locator('#crmTabs button[data-tab="workflows"]');
      await expect(phoneTab.or(deskTab).first()).toBeVisible({ timeout: 60_000 });
      let names: string[];
      if (await phoneTab.isVisible()) {
        await phoneTab.click();
        const rows = page.getByRole("button", { name: /^Actions for / });
        await expect(rows.first(), "at least one follow-up rule").toBeVisible({ timeout: 30_000 });
        names = (await rows.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""))).map((n) => n.replace(/^Actions for /, ""));
      } else {
        await deskTab.click();
        const rows = page.locator("#rulesList li[data-rule]");
        await expect(rows.first(), "at least one follow-up rule").toBeVisible({ timeout: 30_000 });
        names = await rows.locator(".rule-name").allInnerTexts();
      }
      qa.meta({ route: "/dashboard/crm", rules: names });
      expect(names.length).toBeGreaterThan(0);
      cleanRun(qa);
    });

    // A Smart Proposal from a sentence, saved as a draft, sent to a test client, and its public link
    // opened by a stranger. Without OPENAI_API_KEY on the server the estimator answers its fixed
    // placeholder estimate ("Sample estimate · AI disabled") — enough for the path. With a key it is
    // one real generation, metered against QA Co's caps. Everything made here is removed at the end.
    test.describe("a proposal, from text to the client's link", () => {
      test.describe.configure({ mode: "serial" });
      const made: { proposalId?: string; clientName?: string; title?: string; savedFrom?: Date } = {};

      test.afterAll(async () => {
        if (targetKind() !== "local" || !made.proposalId) return;
        const db = prisma();
        const row = await db.proposal.findUnique({ where: { id: made.proposalId }, select: { organization: { select: { id: true, slug: true } } } });
        if (row?.organization.slug !== QA_ORG_SLUG) return;
        const orgId = row.organization.id;
        await db.followUp.deleteMany({ where: { proposalId: made.proposalId } }).catch(() => {});
        await db.activityEvent.deleteMany({ where: { proposalId: made.proposalId } }).catch(() => {});
        // the AiEstimate row the save wrote (the estimatorUses meter counts them); it carries no proposal id
        if (made.savedFrom) await db.aiEstimate.deleteMany({ where: { organizationId: orgId, createdAt: { gte: made.savedFrom } } }).catch(() => {});
        await db.proposal.delete({ where: { id: made.proposalId } }).catch(() => {});
        if (made.clientName) await db.client.deleteMany({ where: { organizationId: orgId, name: made.clientName } }).catch(() => {});
      });

      test("a Smart Proposal from text is saved as a draft @smoke @writes", async ({ page, qa }) => {
        await open(page, "/dashboard/advanced-ai", { settleMs: 1500 });
        const BRIEF = "Replace 120 ft of 6 ft cedar privacy fence with one 4 ft walk gate, haul away the old fence.";
        // The phone's wizard (mobile-advanced-ai-v2: brief → location → review) or the desk console.
        const phoneBrief = page.locator("#maBrief");
        const deskBrief = page.getByRole("textbox", { name: "The brief" });
        await expect(phoneBrief.or(deskBrief).first()).toBeVisible({ timeout: 60_000 });
        const generate = page.getByRole("button", { name: "Generate estimate" });
        if (await phoneBrief.isVisible()) {
          await phoneBrief.fill(BRIEF);
          for (let i = 0; i < 3 && !(await generate.isVisible()); i++) await page.getByRole("button", { name: "Next", exact: true }).click();
        } else {
          await deskBrief.fill(BRIEF);
        }
        await generate.click();
        // A thin brief with a live key may ask a question first; the smoke goes on without answers.
        const anyway = page.getByRole("button", { name: "Generate anyway" });
        const save = page.getByRole("button", { name: "Save as proposal" });
        // QA Co is on the Free plan: past its monthly proposal cap the estimator refuses (the limits
        // engine counts this month's proposal rows, which other checks keep). That is the server's state,
        // not the path breaking — skipped with the reason.
        const capped = page.getByText(/reached your plan limit/i).first();
        await expect(anyway.or(save).or(capped).first()).toBeVisible({ timeout: 120_000 });
        test.skip(await capped.isVisible(), "QA Co is at its plan's monthly proposal cap (Free plan; this month's proposal rows count) — nothing was generated");
        if (await anyway.isVisible()) await anyway.click();
        await expect(save).toBeVisible({ timeout: 120_000 });
        const placeholder = await page.getByText(/placeholder pricing|AI is switched off/i).first().isVisible().catch(() => false);
        test.info().annotations.push({ type: "note", description: placeholder ? "estimator without a key: the placeholder estimate" : "estimator with a live OpenAI key: one real generation" });
        made.savedFrom = new Date(Date.now() - 5000);
        await save.click();
        await page.waitForURL(/\/dashboard\/manual-blueprint\?(?:.*&)?proposal=/, { timeout: 90_000 });
        made.proposalId = new URL(page.url()).searchParams.get("proposal") ?? undefined;
        qa.meta({ proposalId: made.proposalId, placeholder });
        const row = await prisma().proposal.findUnique({ where: { id: made.proposalId }, select: { status: true, title: true, organization: { select: { slug: true } }, _count: { select: { lineItems: true } } } });
        expect(row?.organization.slug, "made in QA Co").toBe(QA_ORG_SLUG);
        expect(row?.status).toBe("DRAFT");
        expect(row?._count.lineItems, "saved with its lines").toBeGreaterThan(0);
        made.title = row?.title;
        cleanRun(qa);
      });

      test("the draft is sent to a test client and its public link opens @smoke @writes", async ({ page, browser, qa }) => {
        test.skip(!made.proposalId, "no draft from the Smart Proposal test");
        const email = qaEmail("smoke-client");
        made.clientName = `QA Smoke Client ${Date.now()}`;
        await open(page, `/dashboard/manual-blueprint?proposal=${made.proposalId}`, { settleMs: 1500 });
        await page.locator('button[aria-label="Client"]').click();
        await page.getByRole("option", { name: /type a name instead/i }).click();
        await page.getByPlaceholder("Who is this for?").fill(made.clientName);
        await page.locator("#q-email").fill(email);
        await allowQaSend(page, email);
        await page.getByRole("button", { name: /^save (&|and) send$/i }).click();
        await expect(page.locator('[aria-labelledby="mb-done-h"]'), "the “on its way” window").toBeVisible({ timeout: 90_000 });
        const row = await prisma().proposal.findUnique({ where: { id: made.proposalId }, select: { status: true, publicId: true, title: true, sentAt: true } });
        expect(row?.status).toBe("SENT");
        expect(row?.sentAt).toBeTruthy();
        addSecret(row!.publicId);
        // The client's link, opened by someone who is not signed in (a stranger's view counts).
        const ctx = await browser.newContext();
        try {
          await installBypass(ctx);
          const client = await ctx.newPage();
          const resp = await client.goto(`${baseUrl()}/portal/q/${row!.publicId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
          expect(resp?.status(), "the public link answers").toBe(200);
          await expect(client.locator("h1.pv-h1")).toContainText(row!.title.slice(0, 30));
        } finally {
          await ctx.close();
        }
        qa.meta({ proposalId: made.proposalId, status: row?.status });
        cleanRun(qa);
      });
    });
  });

  test.describe("as the platform admin", () => {
    test.use({ role: "admin" });

    test("/admin/health opens @smoke", async ({ page, qa }) => {
      const r = await open(page, "/admin/health", { settleMs: 1500 });
      expect(r.status).toBe(200);
      expect(r.finalPath, "not sent to /admin/login").toMatch(/^\/admin\/health/);
      await expect(page.locator("h1").filter({ hasText: /^Health$/ }).first()).toBeVisible({ timeout: 60_000 });
      cleanRun(qa);
    });
  });
});

// The sign-up up to Stripe's door: name + email, the emailed code (GET /api/qa/otp), the plan step,
// Start on Professional → Stripe Checkout in TEST mode. Not paid here (the billing suite pays); a
// LIVE Checkout never loads (forbidden.yaml), and the test fails if one is asked for.
test("sign-up with the emailed code reaches Stripe Checkout @smoke @writes", async ({ page, qa }) => {
  const email = qaEmail("smoke");
  await open(page, "/auth/register?flow=otp", { settleMs: 1200 });
  await page.fill("#name", "QA Smoke");
  await page.fill("#email", email);
  const asked = Date.now();
  await page.click("#nextBtn");
  await expect(page.locator("#otpCode")).toBeVisible({ timeout: 60_000 });
  try {
    await toPlanStep(page, email, asked);
  } catch (e) {
    if (e instanceof TestModeOff) test.skip(true, `needs an external key: ${e.message}`);
    throw e;
  }
  test.skip(!(await checkoutConfigured(page)), "the server under test has no Stripe key (\"Checkout is not configured\")");
  await startPlan(page, "professional");
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 90_000 });
  expect(page.url(), "a TEST Checkout session").toMatch(/cs_test_/);
  await expect(page.locator("#cardNumber, [data-testid='card-accordion-item-button'], [data-testid='hosted-payment-submit-button']").first()).toBeAttached({ timeout: 60_000 });
  qa.meta({ checkout: "opened (test mode), not paid" });
  cleanRun(qa);
});
