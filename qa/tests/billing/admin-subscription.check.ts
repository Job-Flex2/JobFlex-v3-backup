// The admin's subscription editor, both modes, through the REAL handlers
// against the Stripe MOCK (lib/sdk/stripeMock) — no Stripe call, no mail out.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/billing/admin-subscription.check.ts
//
// The owner's rules (2026-09-22): one organization, one subscription of
// record; "Change billed plan" edits the existing Stripe subscription and
// never creates one; "Grant plan (no charge)" cancels whatever bills first, so
// nothing is charged at a trial's end; Stripe first, then the mirror; a
// refusal from Stripe changes nothing; a comp has a term, a reason and an
// author, is noticed 7 days out and ended on its date; the reconcile replay
// never overwrites it; a checkout ends it.
//
// Runs in **QA Co** (slug `qa-co`). QA Co's mirror and its SyncState records
// are snapshotted first and put back at the end, pass or fail. The PlanPrice
// rows it needs are prefixed `price_qa_` and removed on the way out.

import "../_lib/_server-only"; // `server-only` outside Next — see the file
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const MOCK = path.join(os.tmpdir(), `jobflex-qa-stripe-mock-${process.pid}.json`);
const OUTBOX = path.join(os.tmpdir(), `jobflex-qa-outbox-${process.pid}`);
process.env.STRIPE_MOCK_FILE = MOCK;
process.env.EMAIL_DEV_OUTBOX = OUTBOX;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY_TEST;
delete process.env.NEXT_PUBLIC_POSTHOG_KEY;

import { PrismaClient } from "@prisma/client";
import { readMockStore, writeMockStore, runMockBilling, type MockStore, type MockSubscription } from "../../../src/lib/sdk/stripeMock";
import { applySubscriptionChange, previewSubscriptionChange, verifySubscriptionSync, endGrantNow } from "../../../src/lib/subscriptionEditor";
import { readPlanGrant, readSyncingMark, runPlanGrantExpiry, mirrorInvariantViolations } from "../../../src/lib/planGrant";
import { syncSubscriptionFromStripe } from "../../../src/lib/stripeSync";
import { reconcileStripe } from "../../../src/lib/reconcile";
import { recordPlanChange } from "../../../src/lib/subscriptionRecord";
import { getOrgPlanContext } from "../../../src/lib/planCatalogServer";
import { getOrgLimitUsage } from "../../../src/lib/limitsEngine";

const db = new PrismaClient();
const QA_SLUG = "qa-co";
const CUS = "cus_qa_editor";
const SUB = "sub_qa_editor_001";
const DAY = 86400;
const ADMIN = { id: "qa-admin", email: "qa-admin@jobflex.test" };

let passes = 0;
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const head = (s: string) => console.log(`\n── ${s}`);

const PRICES: Record<string, [string, number]> = {
  "starter:MONTH": ["price_qa_starter_month", 2900],
  "professional:MONTH": ["price_qa_professional_month", 7900],
  "enterprise:MONTH": ["price_qa_enterprise_month", 19900],
  "enterprise:YEAR": ["price_qa_enterprise_year", 199000],
};

let orgId = "";

function store(): MockStore {
  return readMockStore(MOCK);
}
function sub(id = SUB): MockSubscription | undefined {
  return store().subscriptions[id];
}
function writes(): string[] {
  return store().calls.filter((c) => /\.(update|cancel|create)$/.test(c.method)).map((c) => c.method);
}
function resetCalls() {
  const s = store();
  s.calls = [];
  writeMockStore(MOCK, s);
}
async function mirror() {
  return db.subscription.findUnique({ where: { organizationId: orgId } });
}

/** QA Co on a subscription in the mock and the mirror. */
async function seed(status: "trialing" | "active" | "past_due", opts: { plan?: string; clockOffsetDays?: number } = {}) {
  const planSlug = opts.plan ?? "professional";
  const now = Math.floor(Date.now() / 1000);
  const created = now - 4 * DAY;
  const trialEnd = created + 14 * DAY;
  const prices: MockStore["prices"] = {};
  for (const [key, [id, cents]] of Object.entries(PRICES)) {
    const [slug, interval] = key.split(":");
    prices[id] = { id, unit_amount: cents, currency: "usd", recurring: { interval: interval === "YEAR" ? "year" : "month", interval_count: 1 }, nickname: `JobFlex ${slug} ${interval}`, metadata: { planSlug: slug }, active: true };
  }
  const priceId = PRICES[`${planSlug}:MONTH`][0];
  const periodEnd = status === "trialing" ? trialEnd : status === "past_due" ? now - DAY : created + 30 * DAY;
  const s: MockStore = {
    account: { default_currency: "usd" },
    customers: { [CUS]: { id: CUS, email: "qa@acme.test", metadata: { organizationId: orgId }, balance: 0 } },
    prices,
    subscriptions: {
      [SUB]: {
        id: SUB, customer: CUS, status, created, currency: "usd",
        current_period_start: created, current_period_end: periodEnd,
        trial_start: status === "trialing" ? created : null, trial_end: status === "trialing" ? trialEnd : null,
        cancel_at_period_end: false, canceled_at: null, ended_at: null,
        metadata: { organizationId: orgId, planSlug, interval: "MONTH" },
        items: { data: [{ id: "si_qa_editor_001", price: prices[priceId], quantity: 1 }] },
        discount: null, default_payment_method: "pm_qa", pause_collection: null,
      },
    },
    invoices: [],
    calls: [],
  };
  writeMockStore(MOCK, s);
  const st = status === "trialing" ? "TRIALING" : status === "active" ? "ACTIVE" : "PAST_DUE";
  await db.subscription.deleteMany({ where: { organizationId: orgId } });
  await db.syncState.deleteMany({ where: { key: { in: [`planGrant:${orgId}`, `subSyncing:${orgId}`, `mirrorSubAt:${orgId}`] } } });
  await db.subscription.create({
    data: {
      organizationId: orgId, plan: planSlug.toUpperCase(), status: st, provider: "STRIPE",
      externalCustomerId: CUS, externalSubId: SUB, stripePriceId: priceId,
      currentPeriodEnd: new Date(periodEnd * 1000), trialEndsAt: status === "trialing" ? new Date(trialEnd * 1000) : null,
    },
  });
  await db.syncState.create({ data: { key: `mirrorSubAt:${orgId}`, cursor: String(created * 1000) } });
  return { created, trialEnd, periodEnd };
}

function advanceTo(seconds: number) {
  const s = store();
  s.clock = seconds;
  writeMockStore(MOCK, s);
  return runMockBilling(MOCK);
}

const base = (over: Record<string, unknown>) => ({ organizationId: orgId, reason: "QA check", ...over });

async function main() {
  const org = await db.organization.findUnique({ where: { slug: QA_SLUG }, select: { id: true } });
  if (!org) throw new Error("QA Co (qa-co) is not seeded");
  orgId = org.id;
  const qaUser = await db.user.findUnique({ where: { email: "qa@acme.test" }, select: { id: true } });
  if (qaUser) ADMIN.id = qaUser.id; // actorId is a User FK on ActivityEvent
  // Texts name the plan by its CATALOG name (owner, 2026-09-25: the enterprise slug is sold as "Advanced").
  const ENT = (await db.pricingPlan.findFirst({ where: { slug: "enterprise" }, select: { name: true } }))?.name ?? "Enterprise";
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // ── snapshot QA Co ──
  const savedMirror = await mirror();
  const savedState = await db.syncState.findMany({ where: { key: { in: [`planGrant:${orgId}`, `subSyncing:${orgId}`, `mirrorSubAt:${orgId}`] } } });
  const savedActivityIds = new Set((await db.activityEvent.findMany({ where: { organizationId: orgId, kind: "PLAN_CHANGE" }, select: { id: true } })).map((a) => a.id));
  await db.planPrice.deleteMany({ where: { stripePriceId: { startsWith: "price_qa_" } } });
  for (const [key, [id, cents]] of Object.entries(PRICES)) {
    const [slug, interval] = key.split(":");
    await db.planPrice.create({ data: { planSlug: slug, stripePriceId: id, stripeProductId: `prod_qa_${slug}`, interval, unitAmountCents: cents, currency: "usd", active: true } });
  }
  fs.mkdirSync(OUTBOX, { recursive: true });

  try {
    /* ── A. THE BUG'S SCENARIO, DONE RIGHT: trial → grant ────────────── */
    head("A · trial → Grant plan (no charge): the trial is cancelled, nothing bills at its end");
    let t = await seed("trialing");
    const endsAt = new Date(Date.now() + 30 * DAY * 1000);
    const pre = await previewSubscriptionChange(base({ mode: "grant", planSlug: "enterprise", endsAt: endsAt.toISOString(), fallback: "free" }));
    ok("A preview ok", pre.ok && !pre.blocked, pre.ok ? pre.blocked ?? "" : pre.error);
    if (pre.ok) {
      ok("A preview now: customer pays $79 trial", pre.now.payer === "customer" && pre.now.priceCents === 7900 && pre.now.status === "TRIALING");
      ok("A preview becomes: nobody pays, complimentary until the date", pre.becomes.payer === "nobody" && pre.becomes.status === "COMPLIMENTARY" && pre.becomes.endsAt === endsAt.toISOString());
      ok("A preview says the trial is cancelled now", /Cancel .* now/.test(pre.stripeAction), pre.stripeAction);
    }
    const noReason = await applySubscriptionChange(base({ mode: "grant", planSlug: "enterprise", endsAt: endsAt.toISOString(), reason: "" }), ADMIN);
    ok("A refuses without a reason", !noReason.ok && /reason/i.test(noReason.ok ? "" : noReason.error));
    const a = await applySubscriptionChange(base({ mode: "grant", planSlug: "enterprise", endsAt: endsAt.toISOString(), fallback: "free", reason: "Partner shop — comp for the case study" }), ADMIN);
    ok("A applied", a.ok, a.ok ? a.summary : a.error);
    ok("A Stripe: the trial subscription was cancelled, nothing else", writes().join(",") === "subscriptions.cancel" && sub()?.status === "canceled", writes().join(","));
    let m = await mirror();
    ok("A one row, MANUAL ACTIVE ENTERPRISE, no Stripe id", (await db.subscription.count({ where: { organizationId: orgId } })) === 1 && m?.provider === "MANUAL" && m.status === "ACTIVE" && m.plan === "ENTERPRISE" && m.externalSubId === null && m.externalCustomerId === CUS);
    ok("A the row's period end is the grant's end", m?.currentPeriodEnd?.toISOString() === endsAt.toISOString());
    let g = await readPlanGrant(orgId);
    ok("A grant record: term, reason, author, replaced sub", !!g && g.endsAt === endsAt.toISOString() && g.reason.includes("Partner shop") && g.actorEmail === ADMIN.email && g.replaced?.subId === SUB && g.replaced.action === "canceled_now");
    ok("A invariant holds", mirrorInvariantViolations(m, g).length === 0, mirrorInvariantViolations(m, g).join("; "));
    const act = await db.activityEvent.findFirst({ where: { organizationId: orgId, kind: "PLAN_CHANGE" }, orderBy: { createdAt: "desc" } });
    ok("A activity event written", !!act && new RegExp("Complimentary " + esc(ENT)).test(act.summary) && JSON.parse(act.meta ?? "{}").reason?.includes("Partner shop"), act?.summary);
    let ctx = await getOrgPlanContext(orgId);
    ok("A getOrgPlanContext (sidebar / entitlements) reads Enterprise", ctx.plan?.slug === "enterprise", ctx.rawPlan);
    const entLimits = await getOrgLimitUsage(orgId);
    // the reconcile replay of the cancelled trial must not take the mirror back
    const cancelled = sub()!;
    await syncSubscriptionFromStripe(cancelled as never);
    m = await mirror();
    ok("A reconcile replay of the cancelled trial leaves the comp", m?.provider === "MANUAL" && m.status === "ACTIVE" && m.plan === "ENTERPRISE");
    // a replay of the OLD event (as it looked while trialing) — a stale webhook
    await syncSubscriptionFromStripe({ ...cancelled, status: "trialing", canceled_at: null, ended_at: null } as never);
    m = await mirror();
    ok("A stale 'trialing' event leaves the comp", m?.provider === "MANUAL" && m.plan === "ENTERPRISE");
    const billed = advanceTo(t.trialEnd + 60);
    ok("A at the trial's end: no invoice, nothing charged", billed.invoiced.length === 0 && store().invoices.length === 0);
    await reconcileStripe();
    m = await mirror();
    ok("A reconcile cron after the trial date leaves the comp", m?.provider === "MANUAL" && m.plan === "ENTERPRISE");
    // edit the standing grant
    const a2 = await applySubscriptionChange(base({ mode: "grant", planSlug: "professional", openEnded: true, reason: "extended, no end" }), ADMIN);
    g = await readPlanGrant(orgId);
    m = await mirror();
    ok("A editing the grant: plan + open-ended, history kept", a2.ok && g?.endsAt === null && m?.plan === "PROFESSIONAL" && m.currentPeriodEnd === null && g?.replaced?.subId === SUB);
    const ended = await endGrantNow(orgId, "free", "case study shipped", ADMIN);
    m = await mirror();
    ok("A end now → FREE, grant record gone", ended.ok && m?.status === "FREE" && m.plan === "FREE" && (await readPlanGrant(orgId)) === null);
    const freeLimits = await getOrgLimitUsage(orgId);
    ok("A limits moved with the plan", JSON.stringify(freeLimits.map((u) => u.limit)) !== JSON.stringify(entLimits.map((u) => u.limit)));

    /* ── B. trial → Change billed plan, trial kept ───────────────────── */
    head("B · trial → Change billed plan (trial kept): the subscription is updated, first charge at the trial's end at the new price");
    t = await seed("trialing");
    const pb = await previewSubscriptionChange(base({ mode: "billed", planSlug: "enterprise" }));
    ok("B preview: no charge today, first charge $199 at the trial end", pb.ok && pb.chargeNowCents === null && pb.becomes.nextChargeCents === 19900 && pb.becomes.nextChargeAt === new Date(t.trialEnd * 1000).toISOString(), pb.ok ? JSON.stringify([pb.chargeNowCents, pb.becomes.nextChargeAt, pb.becomes.nextChargeCents]) : pb.error);
    const b = await applySubscriptionChange(base({ mode: "billed", planSlug: "enterprise", reason: "agreed on the call" }), ADMIN);
    ok("B applied", b.ok && b.syncing, b.ok ? b.summary : b.error);
    ok("B Stripe: one update, no create, no cancel", writes().join(",") === "subscriptions.update" && Object.keys(store().subscriptions).length === 1);
    const sb = sub()!;
    ok("B Stripe: still trialing, on the Enterprise price, proration create_prorations", sb.status === "trialing" && sb.items.data[0].price.id === "price_qa_enterprise_month" && sb.trial_end === t.trialEnd && JSON.stringify(store().calls.find((c) => c.method === "subscriptions.update")?.args[1]).includes("create_prorations"));
    m = await mirror();
    ok("B mirror from Stripe's reply: STRIPE TRIALING ENTERPRISE, same sub id", m?.provider === "STRIPE" && m.status === "TRIALING" && m.plan === "ENTERPRISE" && m.externalSubId === SUB && m.stripePriceId === "price_qa_enterprise_month");
    ok("B marked syncing", (await readSyncingMark(orgId))?.subId === SUB);
    const again = await previewSubscriptionChange(base({ mode: "grant", planSlug: "starter", openEnded: true }));
    ok("B a second change is blocked while syncing", again.ok && /syncing/i.test(again.blocked ?? ""), again.ok ? again.blocked ?? "" : again.error);
    const v = await verifySubscriptionSync(orgId);
    ok("B verify: Stripe confirms, mark cleared", v.ok && v.confirmed && (await readSyncingMark(orgId)) === null);
    const bb = advanceTo(t.trialEnd + 60);
    ok("B at the trial's end: one invoice, $199", bb.invoiced.length === 1 && bb.invoiced[0].amount_paid === 19900);
    await reconcileStripe();
    m = await mirror();
    ok("B reconcile after the trial: mirror ACTIVE ENTERPRISE", m?.status === "ACTIVE" && m.plan === "ENTERPRISE");

    /* ── C. trial → billed, trial ended now ──────────────────────────── */
    head("C · trial → Change billed plan, end the trial now: charged today");
    t = await seed("trialing");
    const pc = await previewSubscriptionChange(base({ mode: "billed", planSlug: "enterprise", endTrialNow: true }));
    ok("C preview: charged today $199", pc.ok && pc.chargeNowCents === 19900 && pc.becomes.status === "ACTIVE", pc.ok ? String(pc.chargeNowCents) : pc.error);
    const c = await applySubscriptionChange(base({ mode: "billed", planSlug: "enterprise", endTrialNow: true, reason: "wants to start now" }), ADMIN);
    m = await mirror();
    ok("C applied: Stripe active on Enterprise, one invoice $199 now, mirror ACTIVE", c.ok && sub()?.status === "active" && store().invoices.length === 1 && store().invoices[0].amount_paid === 19900 && m?.status === "ACTIVE" && m.plan === "ENTERPRISE" && m.trialEndsAt !== null);

    /* ── D. active → billed up (prorated) and down (none) ───────────── */
    head("D · active → Change billed plan: up with prorations, down with none");
    t = await seed("active");
    const pd = await previewSubscriptionChange(base({ mode: "billed", planSlug: "enterprise" }));
    ok("D preview up: nothing today, next invoice > $199 (proration added)", pd.ok && pd.chargeNowCents === null && (pd.becomes.nextChargeCents ?? 0) > 19900 && pd.becomes.nextChargeAt === new Date(t.periodEnd * 1000).toISOString(), pd.ok ? JSON.stringify([pd.becomes.nextChargeCents, pd.becomes.nextChargeAt]) : pd.error);
    const d = await applySubscriptionChange(base({ mode: "billed", planSlug: "enterprise", reason: "upgrade" }), ADMIN);
    ok("D up applied: no invoice now, proration pending on the subscription", d.ok && store().invoices.length === 0 && (sub()?.pending_proration_cents ?? 0) > 0);
    await verifySubscriptionSync(orgId);
    const pdy = await previewSubscriptionChange(base({ mode: "billed", planSlug: "enterprise", interval: "YEAR", proration: "always_invoice" }));
    ok("D yearly + always_invoice previews a charge today", pdy.ok && pdy.chargeNowCents !== null && pdy.becomes.interval === "YEAR", pdy.ok ? String(pdy.chargeNowCents) : pdy.error);
    const dd = await applySubscriptionChange(base({ mode: "billed", planSlug: "starter", proration: "none", reason: "downgrade" }), ADMIN);
    m = await mirror();
    ok("D down applied with no proration: mirror STARTER, no invoice", dd.ok && m?.plan === "STARTER" && store().invoices.length === 0 && sub()?.items.data[0].price.id === "price_qa_starter_month");
    await verifySubscriptionSync(orgId);
    const same = await previewSubscriptionChange(base({ mode: "billed", planSlug: "starter" }));
    ok("D the same price is refused", same.ok && /Already on/.test(same.blocked ?? ""));
    const noPrice = await previewSubscriptionChange(base({ mode: "billed", planSlug: "starter", interval: "YEAR" }));
    ok("D a plan whose yearly price is not on Stripe is refused, naming Admin → Plans", noPrice.ok && /No Stripe price for Starter \(year\)/.test(noPrice.blocked ?? ""), noPrice.ok ? noPrice.blocked ?? "" : noPrice.error);

    /* ── E. active → grant: cancel at period end (default) / now ────── */
    head("E · active → Grant plan: the paid subscription cancels at the period end (or now)");
    t = await seed("active");
    const pe = await previewSubscriptionChange(base({ mode: "grant", planSlug: "enterprise", endsAt: endsAt.toISOString() }));
    ok("E preview books the cancellation for the period end", pe.ok && /Book .* to cancel on/.test(pe.stripeAction) && pe.warnings.some((w) => /keeps the paid/.test(w)), pe.ok ? pe.stripeAction : pe.error);
    const e = await applySubscriptionChange(base({ mode: "grant", planSlug: "enterprise", endsAt: endsAt.toISOString(), reason: "comp" }), ADMIN);
    m = await mirror();
    g = await readPlanGrant(orgId);
    ok("E applied: cancel_at_period_end on Stripe, mirror MANUAL ENTERPRISE, replaced recorded", e.ok && sub()?.cancel_at_period_end === true && sub()?.status === "active" && m?.provider === "MANUAL" && m.plan === "ENTERPRISE" && g?.replaced?.action === "cancel_at_period_end");
    const ee = advanceTo(t.periodEnd + 60);
    ok("E at the period end: the paid subscription ends, no renewal invoice", ee.ended.includes(SUB) && ee.invoiced.length === 0);
    await reconcileStripe();
    m = await mirror();
    ok("E reconcile of the ended subscription leaves the comp", m?.provider === "MANUAL" && m.plan === "ENTERPRISE");
    await seed("active");
    const en = await applySubscriptionChange(base({ mode: "grant", planSlug: "enterprise", endsAt: endsAt.toISOString(), cancelNow: true, reason: "comp now" }), ADMIN);
    ok("E cancel-now variant cancels at once", en.ok && sub()?.status === "canceled" && writes().join(",") === "subscriptions.cancel");

    /* ── F. past_due: both modes ─────────────────────────────────────── */
    head("F · past_due → both modes");
    await seed("past_due");
    const f1 = await applySubscriptionChange(base({ mode: "billed", planSlug: "starter", proration: "none", reason: "cheaper plan while they sort the card" }), ADMIN);
    m = await mirror();
    ok("F billed on past_due: updated, mirror PAST_DUE STARTER, no new subscription", f1.ok && m?.status === "PAST_DUE" && m.plan === "STARTER" && Object.keys(store().subscriptions).length === 1);
    await verifySubscriptionSync(orgId);
    const f2 = await applySubscriptionChange(base({ mode: "grant", planSlug: "professional", endsAt: endsAt.toISOString(), reason: "comp while past due" }), ADMIN);
    m = await mirror();
    ok("F grant on past_due: cancellation booked, mirror MANUAL", f2.ok && sub()?.cancel_at_period_end === true && m?.provider === "MANUAL" && m.status === "ACTIVE");

    /* ── G. a comp, then the customer checks out ─────────────────────── */
    head("G · comp → the customer buys a plan: the grant ends, the replaced subscription is cancelled");
    await seed("active");
    await applySubscriptionChange(base({ mode: "grant", planSlug: "enterprise", endsAt: endsAt.toISOString(), reason: "comp" }), ADMIN);
    resetCalls();
    await recordPlanChange({ organizationId: orgId, planSlug: "professional", status: "ACTIVE", customerId: CUS, subId: "sub_qa_new_paid", trialEnd: null, periodEnd: new Date(Date.now() + 30 * DAY * 1000) });
    m = await mirror();
    ok("G checkout return: mirror STRIPE PROFESSIONAL on the new sub, grant gone", m?.provider === "STRIPE" && m.plan === "PROFESSIONAL" && m.externalSubId === "sub_qa_new_paid" && (await readPlanGrant(orgId)) === null);
    ok("G the winding-down subscription was cancelled at once", sub()?.status === "canceled" && writes().includes("subscriptions.cancel"));
    const gAct = await db.activityEvent.findFirst({ where: { organizationId: orgId, kind: "PLAN_CHANGE" }, orderBy: { createdAt: "desc" } });
    ok("G activity: the comp ended because the org subscribed", /ended — the organization subscribed/.test(gAct?.summary ?? ""), gAct?.summary);

    /* ── H. Stripe refuses → nothing changes ─────────────────────────── */
    head("H · Stripe refuses: nothing changes in the database");
    await seed("trialing");
    {
      const s = store();
      delete s.prices.price_qa_enterprise_month; // the update will fail on the price
      writeMockStore(MOCK, s);
    }
    const before = await mirror();
    const h = await applySubscriptionChange(base({ mode: "billed", planSlug: "enterprise", reason: "price missing on Stripe" }), ADMIN);
    const after = await mirror();
    ok("H refused with Stripe's message", !h.ok && /Stripe refused/.test(h.ok ? "" : h.error), h.ok ? "" : h.error);
    ok("H mirror untouched, no grant, no syncing mark", JSON.stringify(before) === JSON.stringify(after) && (await readSyncingMark(orgId)) === null && (await readPlanGrant(orgId)) === null);

    /* ── I. the invariant: two live subscriptions on Stripe ──────────── */
    head("I · two live Stripe subscriptions for one organization: both modes refuse");
    await seed("active");
    {
      const s = store();
      s.subscriptions.sub_qa_second = { ...s.subscriptions[SUB], id: "sub_qa_second", created: s.subscriptions[SUB].created + 100 };
      writeMockStore(MOCK, s);
    }
    const i1 = await previewSubscriptionChange(base({ mode: "billed", planSlug: "enterprise" }));
    const i2 = await previewSubscriptionChange(base({ mode: "grant", planSlug: "enterprise", openEnded: true }));
    ok("I billed blocked", i1.ok && /2 live subscriptions/.test(i1.blocked ?? ""), i1.ok ? i1.blocked ?? "" : i1.error);
    ok("I grant blocked", i2.ok && /2 live subscriptions/.test(i2.blocked ?? ""));
    const i3 = await applySubscriptionChange(base({ mode: "grant", planSlug: "enterprise", openEnded: true, reason: "x" }), ADMIN);
    ok("I apply refused, no Stripe write", !i3.ok && writes().length === 0);

    /* ── J. the grant's term: notice at 7 days, revert on the date ──── */
    head("J · the grant's term: the owner is emailed 7 days out, the row reverts on the date");
    await seed("trialing");
    const soon = new Date(Date.now() + 5 * DAY * 1000);
    await applySubscriptionChange(base({ mode: "grant", planSlug: "enterprise", endsAt: soon.toISOString(), fallback: "free", reason: "short comp" }), ADMIN);
    const j1 = await runPlanGrantExpiry();
    const mails = fs.readdirSync(OUTBOX);
    ok("J notice sent once, to the owner, naming the date", j1.noticed === 1 && mails.length === 1 && new RegExp("complimentary-" + esc(ENT).replace(/\s+/g, "-") + "-plan-ends", "i").test(mails[0]), mails.join(","));
    const mail = fs.readFileSync(path.join(OUTBOX, mails[0]), "utf8");
    ok("J the email says nothing is charged and what follows", /Nothing is charged automatically/.test(mail) && /the Free plan/.test(mail) && /qa@acme\.test/.test(mail));
    const j2 = await runPlanGrantExpiry();
    ok("J a second run sends nothing more", j2.noticed === 0 && fs.readdirSync(OUTBOX).length === 1);
    ok("J not ended before the date", (await mirror())?.provider === "MANUAL" && (await mirror())?.status === "ACTIVE");
    const j3 = await runPlanGrantExpiry(new Date(soon.getTime() + 60_000));
    m = await mirror();
    ok("J on the date: reverted to FREE, grant gone, activity written", j3.ended === 1 && m?.status === "FREE" && m.plan === "FREE" && (await readPlanGrant(orgId)) === null);
    const jAct = await db.activityEvent.findFirst({ where: { organizationId: orgId, kind: "PLAN_CHANGE" }, orderBy: { createdAt: "desc" } });
    ok("J activity: ended — now on the Free plan", /ended — now on the Free plan/.test(jAct?.summary ?? ""), jAct?.summary);
    ctx = await getOrgPlanContext(orgId);
    ok("J entitlements read FREE after the term", ctx.tier === "FREE");
    // the "expired" fallback
    await seed("trialing");
    await applySubscriptionChange(base({ mode: "grant", planSlug: "enterprise", endsAt: soon.toISOString(), fallback: "expired", reason: "short comp" }), ADMIN);
    await runPlanGrantExpiry(new Date(soon.getTime() + 60_000));
    m = await mirror();
    ok("J 'expired' fallback: status EXPIRED, plan kept for the record", m?.status === "EXPIRED" && m.plan === "ENTERPRISE");
    // a grant that was superseded by a webhook write (the org paid) is dropped, not reverted
    await seed("trialing");
    await applySubscriptionChange(base({ mode: "grant", planSlug: "enterprise", endsAt: soon.toISOString(), reason: "comp" }), ADMIN);
    await db.subscription.update({ where: { organizationId: orgId }, data: { provider: "STRIPE", externalSubId: "sub_qa_paid_later", status: "ACTIVE", plan: "PROFESSIONAL" } });
    const j4 = await runPlanGrantExpiry(new Date(soon.getTime() + 60_000));
    m = await mirror();
    ok("J a paid mirror is never reverted by the cron", j4.superseded === 1 && j4.ended === 0 && m?.provider === "STRIPE" && m.plan === "PROFESSIONAL" && (await readPlanGrant(orgId)) === null);

    /* ── K. nothing on Stripe: a grant on an org without a subscription ─ */
    head("K · an organization with no subscription at all");
    await db.subscription.deleteMany({ where: { organizationId: orgId } });
    await db.syncState.deleteMany({ where: { key: { in: [`planGrant:${orgId}`, `subSyncing:${orgId}`, `mirrorSubAt:${orgId}`] } } });
    {
      const s = store();
      s.subscriptions = {};
      s.calls = [];
      writeMockStore(MOCK, s);
    }
    const k1 = await previewSubscriptionChange(base({ mode: "billed", planSlug: "enterprise" }));
    ok("K billed is blocked without a subscription", k1.ok && /no live Stripe subscription/.test(k1.blocked ?? ""), k1.ok ? k1.blocked ?? "" : k1.error);
    const k2 = await applySubscriptionChange(base({ mode: "grant", planSlug: "starter", openEnded: true, reason: "welcome comp" }), ADMIN);
    m = await mirror();
    ok("K grant creates the row, no Stripe write", k2.ok && m?.provider === "MANUAL" && m.plan === "STARTER" && writes().length === 0);
  } finally {
    // ── put QA Co back ──
    await db.subscription.deleteMany({ where: { organizationId: orgId } });
    if (savedMirror) {
      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = savedMirror;
      void _id; void _c; void _u;
      await db.subscription.create({ data: rest });
    }
    await db.syncState.deleteMany({ where: { key: { in: [`planGrant:${orgId}`, `subSyncing:${orgId}`, `mirrorSubAt:${orgId}`] } } });
    for (const r of savedState) await db.syncState.create({ data: { key: r.key, cursor: r.cursor } });
    await db.activityEvent.deleteMany({ where: { organizationId: orgId, kind: "PLAN_CHANGE", id: { notIn: [...savedActivityIds] } } });
    await db.planPrice.deleteMany({ where: { stripePriceId: { startsWith: "price_qa_" } } });
    fs.rmSync(OUTBOX, { recursive: true, force: true });
    fs.rmSync(MOCK, { force: true });
    await db.$disconnect();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
