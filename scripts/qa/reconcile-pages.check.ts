// The six-hourly Stripe reconcile reads EVERY page (2026-10-15) — data-level check of lib/reconcile.
//
//   DATABASE_URL=file:/path/to/a/COPY.db npx tsx --tsconfig tsconfig.json scripts/qa/reconcile-pages.check.ts
//
// It used to read Stripe's newest 100 subscriptions only; once signups passed 100 in two
// weeks, the paying customers fell off the end and a dropped webhook was never repaired.
// Against the Stripe stand-in (lib/sdk/stripeMock) with a throwaway company, removed at the end:
//   1. a paying company whose subscription is OLDER than 230 newer ones: set to cancel in
//      Stripe, the mirror never heard — the reconcile writes the cancel
//   2. its renewal: the period end moves to Stripe's
//   3. an ended subscription older than 30 days is listed, not re-read
//   4. every page was asked for, and the newer ones (no company) are reported, not written
//   5. paid invoices: every page of the last 35 days is read
import "./_server-only";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const MOCK = path.join(os.tmpdir(), `jobflex-qa-reconcile-pages-${process.pid}.json`);
process.env.STRIPE_MOCK_FILE = MOCK;
for (const k of ["STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY_TEST", "SMTP_HOST", "RESEND_API_KEY", "NEXT_PUBLIC_POSTHOG_KEY"]) delete process.env[k];

import { PrismaClient } from "@prisma/client";
import { readMockStore, writeMockStore, type MockStore, type MockSubscription, type MockInvoice } from "../../src/lib/sdk/stripeMock";
import { reconcileStripe } from "../../src/lib/reconcile";

const db = new PrismaClient();
const TAG = "qa-reconcile-pages";
const DAY = 86400;
let failures = 0;
const check = (label: string, ok: boolean, detail = ""): void => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const price = { id: "price_qa_rp", unit_amount: 9500, currency: "usd", recurring: { interval: "month" as const, interval_count: 1 }, nickname: "JobFlex professional MONTH", metadata: { planSlug: "professional" }, active: true };

function sub(id: string, customer: string, created: number, over: Partial<MockSubscription> = {}): MockSubscription {
  return {
    id, customer, status: "trialing", created, currency: "usd",
    current_period_start: created, current_period_end: created + 7 * DAY,
    trial_start: created, trial_end: created + 7 * DAY,
    cancel_at_period_end: false, canceled_at: null, ended_at: null,
    metadata: {},
    items: { data: [{ id: `si_${id}`, price, quantity: 1 }] },
    discount: null, default_payment_method: null, pause_collection: null,
    ...over,
  };
}

async function main() {
  const now = Math.floor(Date.now() / 1000);
  const org = await db.organization.create({ data: { name: `${TAG} Co`, slug: `${TAG}-${Date.now().toString(36)}` } });
  const CUS = "cus_qa_rp_paying";
  const SUB = "sub_qa_rp_paying";
  const OLD = "sub_qa_rp_ended_long_ago";
  try {
    // The paying company: on Professional since 40 days ago, renewed 10 days ago, and — in
    // Stripe — set to cancel at the period's end yesterday. The mirror heard none of it.
    const created = now - 40 * DAY;
    const store: MockStore = {
      account: { default_currency: "usd" },
      customers: { [CUS]: { id: CUS, email: `${TAG}@example.test`, metadata: { organizationId: org.id }, balance: 0 } },
      prices: { [price.id]: price },
      subscriptions: {
        [SUB]: sub(SUB, CUS, created, {
          status: "active", trial_start: null, trial_end: null,
          current_period_start: now - 10 * DAY, current_period_end: now + 20 * DAY,
          cancel_at_period_end: true, canceled_at: now - DAY,
          metadata: { organizationId: org.id, planSlug: "professional", interval: "MONTH" },
        }),
        // An ended one from long ago, for the same company: listed, not re-read.
        [OLD]: sub(OLD, CUS, now - 90 * DAY, { status: "canceled", canceled_at: now - 60 * DAY, ended_at: now - 60 * DAY, metadata: { organizationId: org.id } }),
      },
      invoices: [],
      calls: [],
      paymentIntents: {},
      checkouts: {},
    };
    // 230 newer subscriptions — signups of the last days, for companies this database does not hold.
    for (let i = 0; i < 230; i++) {
      const id = `sub_qa_rp_new_${String(i).padStart(3, "0")}`;
      const cus = `cus_qa_rp_new_${i}`;
      store.customers[cus] = { id: cus, email: null, metadata: {} };
      store.subscriptions[id] = sub(id, cus, now - DAY - i * 60);
    }
    // 230 paid invoices in the last 35 days, and one older (not read).
    const inv = (n: number, at: number): MockInvoice => ({
      id: `in_qa_rp_${n}`, customer: "cus_qa_rp_new_0", subscription: "sub_qa_rp_new_000", status: "paid", paid: true,
      amount_paid: 0, amount_due: 0, subtotal: 0, total: 0, currency: "usd", created: at, billing_reason: "subscription_create",
      charge: null, number: null, hosted_invoice_url: null, invoice_pdf: null, lines: { data: [] },
    });
    for (let i = 0; i < 230; i++) store.invoices.push(inv(i, now - DAY - i * 600));
    store.invoices.push(inv(999, now - 50 * DAY));
    writeMockStore(MOCK, store);

    await db.subscription.create({
      data: {
        organizationId: org.id, plan: "PROFESSIONAL", status: "ACTIVE", provider: "STRIPE",
        externalCustomerId: CUS, externalSubId: SUB, stripePriceId: price.id,
        currentPeriodEnd: new Date((now - 10 * DAY) * 1000), canceledAt: null,
      },
    });
    await db.syncState.create({ data: { key: `mirrorSubAt:${org.id}`, cursor: String(created * 1000) } });

    const res = await reconcileStripe();
    const row = await db.subscription.findUnique({ where: { organizationId: org.id } });

    check("1. the cancel booked in Stripe reaches the mirror, 232 subscriptions deep", row?.canceledAt !== null && row?.canceledAt !== undefined && Math.abs(row.canceledAt.getTime() / 1000 - (now - DAY)) < 2, String(row?.canceledAt?.toISOString()));
    check("1. the company stays on its plan until then", row?.status === "ACTIVE" && row.externalSubId === SUB, `${row?.status} ${row?.externalSubId}`);
    check("2. the renewal: the period end is Stripe's", !!row?.currentPeriodEnd && Math.abs(row.currentPeriodEnd.getTime() / 1000 - (now + 20 * DAY)) < 2, String(row?.currentPeriodEnd?.toISOString()));
    const r = res as { listed?: number; endedLongAgo?: number; subscriptions?: number; invoices?: number; missingOrganization?: unknown[] };
    check("3. the subscription that ended 60 days ago is listed, not re-read", r.endedLongAgo === 1, String(r.endedLongAgo));
    check("4. every subscription was listed", r.listed === 232, String(r.listed));
    const calls = readMockStore(MOCK).calls.filter((c) => c.method === "subscriptions.list" && (c.args[0] as { status?: string })?.status === "all");
    check("4. Stripe was asked for every page (100 + 100 + 32)", calls.length === 3 && calls.slice(1).every((c) => typeof (c.args[0] as { starting_after?: string })?.starting_after === "string"), `${calls.length} calls`);
    const strays = await db.subscription.count({ where: { externalSubId: { startsWith: "sub_qa_rp_new_" } } });
    check("4. the newer ones with no company write nothing", strays === 0, `${strays} rows`);
    const dupCalls = readMockStore(MOCK).calls.filter((c) => c.method === "subscriptions.list" && (c.args[0] as { status?: string })?.status === "trialing");
    check("4. the duplicate scan pages the live ones too (230 trialing → 3 pages)", dupCalls.length === 3, `${dupCalls.length} calls`);
    check("5. paid invoices: all 230 of the last 35 days, not the older one", r.invoices === 230, String(r.invoices));
  } finally {
    await db.syncState.deleteMany({ where: { key: { in: [`mirrorSubAt:${org.id}`, `planGrant:${org.id}`, `subSyncing:${org.id}`] } } }).catch(() => {});
    await db.subscription.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await db.organization.delete({ where: { id: org.id } }).catch(() => {});
    await db.$disconnect();
    fs.rmSync(MOCK, { force: true });
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("CRASH", err);
  process.exit(2);
});
