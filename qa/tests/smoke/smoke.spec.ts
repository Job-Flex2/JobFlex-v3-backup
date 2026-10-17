// SMOKE — the checks that say "the product is up": 13 tests, under three minutes on a warm dev
// server. Safe against production: the ones that write (@writes) or sign in are skipped there by
// the fixture (lib/target.ts), the rest only read public pages.
import fs from "node:fs";
import { test, expect, open } from "../../lib/fixtures";
import { authFile, credentials } from "../../lib/roles";
import { fetchOtp, qaEmail, TestModeOff } from "../../lib/otp";
import { baseUrl } from "../../lib/env";
import { targetKind } from "../../lib/target";
import { prisma, QA_ORG_SLUG } from "../../lib/db";

/** No uncaught exception and no 5xx from this server, while the test ran. */
function cleanRun(qa: { collector: { data: { pageErrors: unknown[]; httpErrors: { status: number; sameOrigin: boolean; url: string }[] } } }) {
  const d = qa.collector.data;
  expect.soft(d.pageErrors, "uncaught exceptions in the page").toEqual([]);
  expect.soft(d.httpErrors.filter((e) => e.sameOrigin && e.status >= 500).map((e) => `${e.status} ${e.url}`), "5xx answers").toEqual([]);
}

test.describe("public pages", () => {
  test("home page opens with its headline @smoke @webkit", async ({ page, qa }) => {
    const r = await open(page, "/");
    expect(r.status).toBe(200);
    await expect(page).toHaveTitle(/JobFlex/i);
    await expect(page.locator("h1").first()).toBeVisible();
    cleanRun(qa);
  });

  test("pricing page lists the plans @smoke", async ({ page, qa }) => {
    const r = await open(page, "/pricing");
    expect(r.status).toBe(200);
    await expect(page.getByText(/\$\d+/).first()).toBeVisible();
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

  test("register page shows Google above the email form @smoke", async ({ page, qa }) => {
    const r = await open(page, "/auth/register?flow=otp");
    expect(r.status).toBe(200);
    const g = await page.locator("#googleBtn").boundingBox();
    const f = await page.locator("#email").boundingBox();
    expect(g && f && g.y < f.y, "Google button above the email field").toBeTruthy();
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
  });

  test("an owner's CSV export answers, a guest's does not @smoke", async ({ request, browser }) => {
    const guest = await request.get("/api/exports/clients.csv", { maxRedirects: 0 });
    expect(guest.status(), "guest gets no CSV").not.toBe(200);
    test.skip(targetKind() === "production", "signed-in half skipped against production");
    const file = authFile("owner");
    test.skip(!fs.existsSync(file), "no owner session");
    const ctx = await browser.newContext({ storageState: file });
    try {
      const r = await ctx.request.get(baseUrl() + "/api/exports/clients.csv");
      expect(r.status()).toBe(200);
      expect(r.headers()["content-type"] ?? "").toMatch(/csv|text/);
    } finally {
      await ctx.close();
    }
  });
});

test.describe("signed in", () => {
  test("sign-in with a password works @smoke @writes", async ({ page, qa }) => {
    const creds = credentials("owner");
    test.skip(!creds, "no QA_PASS_OWNER");
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

    for (const path of ["/dashboard/proposals", "/dashboard/projects", "/dashboard/financials"]) {
      test(`${path} loads @smoke`, async ({ page, qa }) => {
        const r = await open(page, path, { settleMs: 1200 });
        expect(r.status).toBe(200);
        expect(r.finalPath.startsWith(path), `stayed on ${path}, got ${r.finalPath}`).toBeTruthy();
        cleanRun(qa);
      });
    }

    test("a proposal draft is created and saved @smoke @writes", async ({ page, qa }) => {
      const title = `QA smoke draft ${Date.now()}`;
      await open(page, "/dashboard/manual-blueprint", { settleMs: 1500 });
      await page.fill("#q-title", title);
      await page.getByLabel("Line 1 description").fill("QA smoke line");
      await page.getByLabel("Line 1 quantity").fill("2");
      await page.getByLabel("Line 1 unit price").fill("150");
      await page.getByRole("button", { name: /^save$/i }).click();
      await page.waitForURL(/[?&]proposal=/, { timeout: 60_000 });
      const id = new URL(page.url()).searchParams.get("proposal")!;
      qa.meta({ proposalId: id });
      // What the database holds, then the draft is removed (QA Co only) — the monthly cap counts rows.
      const db = prisma();
      const row = await db.proposal.findUnique({ where: { id }, select: { title: true, status: true, organization: { select: { slug: true } } } });
      try {
        expect(row?.title).toBe(title);
        expect(row?.status).toBe("DRAFT");
        expect(row?.organization.slug).toBe(QA_ORG_SLUG);
      } finally {
        if (row?.organization.slug === QA_ORG_SLUG) {
          await db.activityEvent.deleteMany({ where: { proposalId: id } }).catch(() => {});
          await db.proposal.delete({ where: { id } }).catch(() => {});
        }
      }
      cleanRun(qa);
    });
  });
});

test("sign-up reaches the code step @smoke @writes @webkit", async ({ page, qa }) => {
  const email = qaEmail("smoke");
  await open(page, "/auth/register?flow=otp", { settleMs: 1200 });
  await page.fill("#name", "QA Smoke");
  await page.fill("#email", email);
  const asked = Date.now();
  await page.click("#nextBtn");
  await expect(page.locator("#otpCode")).toBeVisible({ timeout: 60_000 });
  try {
    const otp = await fetchOtp(email, { after: asked - 2000 });
    expect(otp.code, "the test endpoint kept a six-digit code").toMatch(/^\d{6}$/);
  } catch (e) {
    if (e instanceof TestModeOff) test.info().annotations.push({ type: "warning", description: e.message });
    else throw e;
  }
  cleanRun(qa);
});
