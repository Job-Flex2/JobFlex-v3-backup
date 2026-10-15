// runApprovedPayouts — exactly once, exactly what was approved. NO STRIPE CALL.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/billing/influencer-payout-run.check.ts
//
// processApprovedPayouts takes the transfers API as an argument, so every
// failure a real network can produce is scripted here instead: a lost response,
// a definite refusal, a database failure after the money left, a row clearing
// mid-flight, two runs at once, and an unknown outcome past Stripe's 24-hour key
// retention. The stub RECORDS every call, so the claims that matter — the same
// idempotency key on a retry, no second transfer, no call at all for a
// suspended partner — are asserted rather than assumed.
//
// Rows are written in **QA Co** (slug `qa-co`), prefixed `qa-run-`, and deleted
// on the way out, pass or fail.

delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY_TEST;

import "../_lib/_server-only";
import { PrismaClient } from "@prisma/client";
import { processApprovedPayouts, type TransferApi } from "../../../src/lib/payouts";
import { payoutRequestRefusal } from "../../../src/lib/payouts";
import { ledgerBalances } from "../../../src/lib/commission";
import { checkInfluencerPayouts } from "../../../src/lib/integrationsHealth";

const db = new PrismaClient();
const QA_SLUG = "qa-co";
const P = "qa-run-";

let passes = 0;
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const c = (n: number) => `$${(n / 100).toFixed(2)}`;
const head = (s: string) => console.log(`\n── ${s}`);

type Call = { amount: number; key: string; destination: string };

/** A transfers API that records every call and answers from a queue. */
function stub(answers: Array<{ id: string } | { error: string; type: string }>, onCall?: () => Promise<void>) {
  const calls: Call[] = [];
  let i = 0;
  const api: TransferApi = {
    async create(params, options) {
      calls.push({ amount: params.amount, key: options.idempotencyKey, destination: params.destination });
      if (onCall) await onCall();
      const a = answers[Math.min(i, answers.length - 1)];
      i++;
      if ("error" in a) {
        const e = new Error(a.error) as Error & { type: string };
        e.type = a.type;
        throw e;
      }
      return a;
    },
  };
  return { api, calls };
}

let seq = 0;
async function partner(suffix: string, over: Record<string, unknown> = {}) {
  return db.influencer.create({
    data: {
      email: `${P}${suffix}@jobflex.test`,
      displayName: `QA Run ${suffix}`,
      status: "ACTIVE",
      holdDays: 30,
      minPayoutCents: 2500,
      payoutsEnabled: true,
      connectStatus: "ENABLED",
      connectAccountId: `acct_${P}${suffix}`,
      defaultCurrency: "usd",
      ...over,
    },
  });
}
async function cleared(influencerId: string, cents: number, minutesAgo = 60) {
  seq++;
  return db.commissionLedger.create({
    data: {
      influencerId,
      entryType: cents >= 0 ? "ACCRUED" : "REVERSED",
      amountCents: cents,
      currency: "usd",
      stripeInvoiceId: `in_${P}${seq}`,
      state: "CLEARED",
      idempotencyKey: `${P}${seq}`,
      createdAt: new Date(Date.now() - minutesAgo * 60_000),
    },
  });
}
async function approved(influencerId: string, cents: number) {
  return db.payoutRequest.create({
    data: { influencerId, amountCents: cents, currency: "usd", status: "APPROVED" },
  });
}
async function books(influencerId: string) {
  const rows = await db.commissionLedger.findMany({
    where: { influencerId },
    select: { entryType: true, amountCents: true, state: true, payoutTransferId: true },
  });
  return { rows, bal: ledgerBalances(rows) };
}

async function cleanup() {
  const infs = await db.influencer.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = infs.map((i) => i.id);
  if (ids.length) {
    await db.commissionLedger.deleteMany({ where: { influencerId: { in: ids } } });
    await db.payoutTransfer.deleteMany({ where: { influencerId: { in: ids } } });
    await db.payoutRequest.deleteMany({ where: { influencerId: { in: ids } } });
    await db.influencer.deleteMany({ where: { id: { in: ids } } });
  }
  await db.commissionLedger.deleteMany({ where: { idempotencyKey: { startsWith: P } } });
  return ids.length;
}

async function main() {
  await cleanup();
  const qaOrg = await db.organization.findUnique({ where: { slug: QA_SLUG }, select: { name: true } });
  if (!qaOrg) {
    console.error(`FAIL  QA Co (slug ${QA_SLUG}) is not seeded in this database — run the seed first.`);
    process.exit(1);
  }
  console.log(`runApprovedPayouts, scripted failures · ${qaOrg.name} (${QA_SLUG}) · no Stripe calls`);

  // ═══ 1. The ordinary run ═══
  head("1 · an approved request is paid exactly once, for exactly the approved rows");
  {
    const inf = await partner("happy");
    for (const n of [1264, 1264, 1264]) await cleared(inf.id, n);
    const req = await approved(inf.id, 3792);
    const { api, calls } = stub([{ id: "tr_happy" }]);
    const res = await processApprovedPayouts(api);
    const t = await db.payoutTransfer.findUnique({ where: { idempotencyKey: `payout:${req.id}` } });
    const r = await db.payoutRequest.findUnique({ where: { id: req.id } });
    const { bal } = await books(inf.id);
    ok("one transfer of 3792¢, to the partner's account, keyed to the request",
      calls.length === 1 && calls[0].amount === 3792 && calls[0].key === `payout:${req.id}` &&
        calls[0].destination === `acct_${P}happy`,
      JSON.stringify(calls));
    ok("request and transfer both PAID, transfer carries the Stripe id",
      r?.status === "PAID" && t?.status === "PAID" && t?.stripeTransferId === "tr_happy");
    ok("nothing left cleared, balance nets to zero", bal.clearedCents === 0 && bal.balanceCents === 0,
      `cleared ${c(bal.clearedCents)} · balance ${c(bal.balanceCents)} · paid out ${c(bal.paidOutCents)}`);
    ok("the run reports it", res.paid === 1 && res.failed === 0, JSON.stringify(res));
  }

  // ═══ 2. A row clears while the transfer is in flight ═══
  head("2 · a row that clears mid-flight is NOT swept into PAID");
  {
    const inf = await partner("race");
    for (const n of [1580, 1580]) await cleared(inf.id, n);
    await approved(inf.id, 3160);
    // The clear cron flips a new row to CLEARED while Stripe is answering.
    const { api } = stub([{ id: "tr_race" }], async () => {
      await cleared(inf.id, 2000, 0);
    });
    await processApprovedPayouts(api);
    const { bal, rows } = await books(inf.id);
    ok("the 2000¢ that cleared mid-flight is still CLEARED and payable next time",
      bal.clearedCents === 2000, `cleared ${c(bal.clearedCents)}`);
    ok("only the two reserved rows were marked PAID",
      rows.filter((x) => x.entryType === "ACCRUED" && x.state === "PAID").length === 2);
    ok("balance is exactly what is still owed", bal.balanceCents === 2000, c(bal.balanceCents));
  }

  // ═══ 3. More cleared than was approved ═══
  head("3 · more cleared than the admin approved — only the approved amount leaves");
  {
    const inf = await partner("ceiling");
    for (const n of [1264, 1264]) await cleared(inf.id, n, 120);
    const req = await approved(inf.id, 2528);
    await cleared(inf.id, 5000, 30); // cleared after the request was made
    const { api, calls } = stub([{ id: "tr_ceiling" }]);
    await processApprovedPayouts(api);
    const { bal } = await books(inf.id);
    ok("the transfer is the approved 2528¢, not the 7528¢ now cleared",
      calls[0]?.amount === 2528, `sent ${c(calls[0]?.amount ?? 0)}`);
    ok("the newer 5000¢ stays cleared for the next payout", bal.clearedCents === 5000, c(bal.clearedCents));
    ok("the request records what was actually paid",
      (await db.payoutRequest.findUnique({ where: { id: req.id } }))?.amountCents === 2528);
  }

  // ═══ 4. A clawback is netted, never left behind ═══
  head("4 · a clawback (negative CLEARED row) is always netted into the payout");
  {
    const inf = await partner("clawback");
    await cleared(inf.id, 1580, 120);
    await cleared(inf.id, 1580, 110);
    await cleared(inf.id, -1580, 100); // a refund on an already-paid accrual
    await approved(inf.id, 1580);
    const { api, calls } = stub([{ id: "tr_claw" }]);
    await processApprovedPayouts(api);
    const { bal } = await books(inf.id);
    ok("sends 1580¢: two accruals minus the clawback",
      calls[0]?.amount === 1580, `sent ${c(calls[0]?.amount ?? 0)}`);
    ok("the clawback did not survive to reduce a later payout twice", bal.clearedCents === 0,
      `cleared ${c(bal.clearedCents)}`);
  }

  // ═══ 5. A lost response — the double-payment case ═══
  head("5 · Stripe's answer is lost: nothing is FAILED, nothing is released, the retry reuses the key");
  let lostReqId = "";
  let lostInfId = "";
  {
    const inf = await partner("lost");
    lostInfId = inf.id;
    for (const n of [4000, 4000]) await cleared(inf.id, n);
    const req = await approved(inf.id, 8000);
    lostReqId = req.id;
    const conn = { error: "socket hang up", type: "StripeConnectionError" };
    const { api, calls } = stub([conn, conn, conn]);
    const res = await processApprovedPayouts(api);
    const r = await db.payoutRequest.findUnique({ where: { id: req.id } });
    const t = await db.payoutTransfer.findUnique({ where: { idempotencyKey: `payout:${req.id}` } });
    const { rows } = await books(inf.id);
    ok("retried inside the run, every attempt with the SAME key",
      calls.length === 3 && calls.every((x) => x.key === `payout:${req.id}` && x.amount === 8000),
      calls.map((x) => x.key).join(", "));
    ok("the request stays PROCESSING — not FAILED", r?.status === "PROCESSING", String(r?.status));
    ok("the transfer stays PENDING with the reason on it",
      t?.status === "PENDING" && /Unconfirmed/.test(t?.failureReason ?? ""), `${t?.status} · ${t?.failureReason}`);
    ok("the rows stay reserved to it — not released for a second payout",
      rows.filter((x) => x.payoutTransferId === t?.id).length === 2);
    ok("reported as needing review, not as failed", res.needsReview === 1 && res.failed === 0, JSON.stringify(res));
    ok("the partner cannot file a second request meanwhile",
      payoutRequestRefusal({
        payoutsEnabled: true,
        connectStatus: "ENABLED",
        minPayoutCents: 2500,
        clearedCents: 8000,
        openRequestStatus: r?.status ?? null,
      }) !== null);
  }

  // ═══ 6. The next run, inside Stripe's window ═══
  head("6 · the next run retries with the same key, and Stripe hands back the same transfer");
  {
    const { api, calls } = stub([{ id: "tr_lost_original" }]);
    await processApprovedPayouts(api);
    const r = await db.payoutRequest.findUnique({ where: { id: lostReqId } });
    const { bal } = await books(lostInfId);
    const transfersForReq = await db.payoutTransfer.count({ where: { payoutRequestId: lostReqId } });
    ok("the retry used the ORIGINAL key and the original amount",
      calls.length === 1 && calls[0].key === `payout:${lostReqId}` && calls[0].amount === 8000,
      JSON.stringify(calls));
    ok("one transfer row, one payment, request PAID",
      transfersForReq === 1 && r?.status === "PAID", `${transfersForReq} row(s) · ${r?.status}`);
    ok("the books close to zero", bal.balanceCents === 0, c(bal.balanceCents));
  }

  // ═══ 7. A definite refusal ═══
  head("7 · Stripe definitely refuses: FAILED, and the rows are released");
  {
    const inf = await partner("refused");
    for (const n of [3000]) await cleared(inf.id, n);
    const req = await approved(inf.id, 3000);
    const { api, calls } = stub([{ error: "Insufficient funds in platform balance", type: "StripeInvalidRequestError" }]);
    const res = await processApprovedPayouts(api);
    const r = await db.payoutRequest.findUnique({ where: { id: req.id } });
    const { rows, bal } = await books(inf.id);
    ok("tried once, not three times — a refusal is not retried", calls.length === 1);
    ok("request FAILED with Stripe's words", r?.status === "FAILED" && /Insufficient/.test(r?.rejectedReason ?? ""),
      `${r?.status} · ${r?.rejectedReason}`);
    ok("rows released, so the money is claimable again",
      rows.every((x) => x.payoutTransferId === null) && bal.clearedCents === 3000, c(bal.clearedCents));
    ok("reported as failed", res.failed === 1, JSON.stringify(res));
  }

  // ═══ 8. The money leaves but the books fail ═══
  head("8 · the transfer succeeds and the books fail: the id is kept, nothing is FAILED");
  {
    const inf = await partner("books");
    await cleared(inf.id, 2600);
    const req = await approved(inf.id, 2600);
    // A row that already owns the PAID entry's unique key makes the books'
    // transaction throw after Stripe has answered.
    await db.commissionLedger.create({
      data: {
        influencerId: inf.id,
        entryType: "ADJUSTMENT",
        amountCents: 0,
        currency: "usd",
        state: "VOID",
        idempotencyKey: "pay:tr_books",
      },
    });
    const { api } = stub([{ id: "tr_books" }]);
    const res = await processApprovedPayouts(api);
    const t = await db.payoutTransfer.findUnique({ where: { idempotencyKey: `payout:${req.id}` } });
    const r = await db.payoutRequest.findUnique({ where: { id: req.id } });
    ok("the Stripe id was recorded before the books were attempted", t?.stripeTransferId === "tr_books");
    ok("neither the transfer nor the request is FAILED",
      t?.status !== "FAILED" && r?.status === "PROCESSING", `${t?.status} · ${r?.status}`);
    ok("reported as needing review", res.needsReview === 1, JSON.stringify(res));

    // Clear the blocker; the next run closes the books WITHOUT a second transfer.
    await db.commissionLedger.deleteMany({ where: { idempotencyKey: "pay:tr_books" } });
    const second = stub([{ id: "tr_SHOULD_NOT_BE_CALLED" }]);
    await processApprovedPayouts(second.api);
    const r2 = await db.payoutRequest.findUnique({ where: { id: req.id } });
    const { bal } = await books(inf.id);
    ok("the next run closes the books without calling Stripe again",
      second.calls.length === 0 && r2?.status === "PAID", `${second.calls.length} call(s) · ${r2?.status}`);
    ok("paid once, balance zero", bal.balanceCents === 0, c(bal.balanceCents));
  }

  // ═══ 9. A suspended partner ═══
  head("9 · a suspended partner's approved request is not paid");
  {
    const inf = await partner("suspended", { status: "SUSPENDED" });
    await cleared(inf.id, 5000);
    const req = await approved(inf.id, 5000);
    const { api, calls } = stub([{ id: "tr_never" }]);
    await processApprovedPayouts(api);
    const r = await db.payoutRequest.findUnique({ where: { id: req.id } });
    ok("Stripe is never called", calls.length === 0);
    ok("the request says why", r?.status === "FAILED" && /suspended/.test(r?.rejectedReason ?? ""),
      `${r?.status} · ${r?.rejectedReason}`);
  }

  // ═══ 10. Two runs at once ═══
  head("10 · two overlapping runs take the same request once");
  {
    const inf = await partner("overlap");
    await cleared(inf.id, 4400);
    const req = await approved(inf.id, 4400);
    const calls: Call[] = [];
    const shared: TransferApi = {
      async create(params, options) {
        calls.push({ amount: params.amount, key: options.idempotencyKey, destination: params.destination });
        await new Promise((r) => setTimeout(r, 30));
        return { id: "tr_overlap" };
      },
    };
    await Promise.all([processApprovedPayouts(shared), processApprovedPayouts(shared)]);
    const rows = await db.payoutTransfer.count({ where: { payoutRequestId: req.id } });
    const { bal } = await books(inf.id);
    ok("one transfer row for the request", rows === 1, `${rows} row(s)`);
    ok("the partner is paid once — every Stripe call carried the same key",
      calls.length >= 1 && calls.every((x) => x.key === `payout:${req.id}`) && bal.balanceCents === 0,
      `${calls.length} call(s) · balance ${c(bal.balanceCents)}`);
  }

  // ═══ 11. Past Stripe's 24-hour key retention ═══
  head("11 · an unknown outcome older than Stripe's key window is left for a person");
  {
    const inf = await partner("stale");
    const row = await cleared(inf.id, 3100);
    const req = await db.payoutRequest.create({
      data: { influencerId: inf.id, amountCents: 3100, currency: "usd", status: "PROCESSING" },
    });
    const t = await db.payoutTransfer.create({
      data: {
        influencerId: inf.id,
        payoutRequestId: req.id,
        amountCents: 3100,
        currency: "usd",
        status: "PENDING",
        stripeConnectAccountId: `acct_${P}stale`,
        idempotencyKey: `payout:${req.id}`,
        failureReason: "Unconfirmed: socket hang up",
        createdAt: new Date(Date.now() - 21 * 60 * 60 * 1000),
      },
    });
    await db.commissionLedger.update({ where: { id: row.id }, data: { payoutTransferId: t.id } });
    const { api, calls } = stub([{ id: "tr_would_double_pay" }]);
    const res = await processApprovedPayouts(api);
    ok("not retried — the key may have expired and a retry could pay twice", calls.length === 0);
    ok("counted for review", res.needsReview === 1, JSON.stringify(res));

    // …and a person is told, FIRST, because it is the only line with a clock on it.
    const health = await checkInfluencerPayouts(new Date().toISOString());
    ok("the Health row leads with the unconfirmed transfer and says what to do",
      health.level === "degraded" && /^1 transfer unconfirmed with Stripe/.test(health.reason) &&
        /dashboard/.test(health.reason),
      `${health.level} · ${health.reason}`);
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  const removed = await cleanup();
  console.log(`      · cleaned up ${removed} partner(s) and everything hanging off them`);
  await db.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\ncheck crashed:", err);
  try {
    await cleanup();
  } catch {
    /* best effort */
  }
  await db.$disconnect();
  process.exit(2);
});
