// Chargebacks take the commission with them — through the REAL handlers, no
// Stripe call.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/billing/influencer-dispute.check.ts
//
// The owner's rule (2026-09-22): a lost chargeback removes the commission
// exactly as a full refund does; while a dispute is open the commission is HELD
// (out of pending, the clock stopped, out of any payout); a won dispute releases
// it with the hold restarted from the close date; a dispute after a payout drives
// the balance negative and is paid back from the next commissions.
//
// I–N cover the orders the first version got wrong: a clawback of paid money is
// a debt and is never frozen; a dispute that outruns its invoice; money released
// by a refused payout or a Retry while a dispute is open; a second dispute on the
// same payment; a refund netted into a payout before the commission was lost.
//
// Rows are written in **QA Co** (slug `qa-co`), prefixed `qa-dsp-`, and deleted
// on the way out, pass or fail. The payout step uses a recording stub in place
// of stripe.transfers.

delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY_TEST;

import "../_lib/_server-only"; // `server-only` outside Next — see the file
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  accrueForInvoice,
  holdForDispute,
  settleDispute,
  reverseForCharge,
  handleTransferEvent,
} from "../../../src/lib/stripeSync";
import { clearDueCommissions } from "../../../src/lib/reconcile";
import { processApprovedPayouts, releaseReversedPayout, type TransferApi } from "../../../src/lib/payouts";
import { ledgerBalances } from "../../../src/lib/commission";
import { moneyNotes } from "../../../src/lib/influencerNotes";

const db = new PrismaClient();
const QA_SLUG = "qa-co";
const P = "qa-dsp-";
const DAY = 24 * 60 * 60 * 1000;

let passes = 0;
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const c = (n: number) => `${n < 0 ? "-" : ""}$${(Math.abs(n) / 100).toFixed(2)}`;
const head = (s: string) => console.log(`\n── ${s}`);

const invoice = (id: string, sub: string, charge: string, paid: number) =>
  ({ id, subscription: sub, charge, paid: true, amount_paid: paid, subtotal: paid, currency: "usd", billing_reason: "subscription_cycle" }) as never;
const dispute = (id: string, charge: string, status: string, createdAt = Date.now()) =>
  ({ id, charge, amount: 7900, status, created: Math.floor(createdAt / 1000) }) as never;
const chargeObj = (id: string, amount: number, refunded: number, inv: string) =>
  ({ id, amount, amount_refunded: refunded, invoice: inv }) as never;

async function books(influencerId: string) {
  const rows = await db.commissionLedger.findMany({
    where: { influencerId },
    select: { entryType: true, amountCents: true, state: true, idempotencyKey: true, stripeChargeId: true, clearsAt: true },
  });
  const bal = ledgerBalances(rows);
  const net = (st: string) => rows.filter((r) => r.state === st).reduce((n, r) => n + r.amountCents, 0);
  return { rows, bal, paidNet: net("PAID"), voidNet: net("VOID") };
}

/** Balance = sum of the journal, and every row is in exactly one live bucket. */
async function invariant(label: string, influencerId: string) {
  const { bal, paidNet, voidNet, rows } = await books(influencerId);
  const sum = rows.reduce((n, r) => n + r.amountCents, 0);
  ok(`${label}: balance = sum of journal = pending + cleared + held (PAID and VOID net to zero)`,
    bal.balanceCents === sum && paidNet === 0 && voidNet === 0 &&
      bal.balanceCents === bal.pendingCents + bal.clearedCents + bal.heldCents,
    `balance ${c(bal.balanceCents)} · pending ${c(bal.pendingCents)} · cleared ${c(bal.clearedCents)} · held ${c(bal.heldCents)} · paid-net ${c(paidNet)} · void-net ${c(voidNet)}`);
}

async function partner(suffix: string, qaOrgId: string, over: Record<string, unknown> = {}) {
  const inf = await db.influencer.create({
    data: {
      email: `${P}${suffix}@jobflex.test`,
      displayName: `QA Dsp ${suffix}`,
      status: "ACTIVE",
      holdDays: 30,
      minPayoutCents: 100,
      payoutsEnabled: true,
      connectStatus: "ENABLED",
      connectAccountId: `acct_${P}${suffix}`,
      ...over,
    },
  });
  const promo = await db.promoCode.create({
    data: {
      influencerId: inf.id,
      code: `QADSP${suffix.toUpperCase().replace(/[^A-Z0-9]/g, "")}`,
      stripeCouponId: `local_coupon_${P}${suffix}`,
      stripePromotionCodeId: `local_promo_${P}${suffix}`,
      commissionType: "PERCENT",
      commissionRateBps: 2000,
      commissionBasis: "NET",
      durationType: "FOREVER",
    },
  });
  const sub = `sub_${P}${suffix}`;
  await db.attribution.create({
    data: {
      influencerId: inf.id,
      promoCodeId: promo.id,
      organizationId: qaOrgId,
      stripeCustomerId: `cus_${P}${suffix}`,
      stripeSubscriptionId: sub,
      status: "ACTIVE",
    },
  });
  return { inf, sub };
}

async function cleanup() {
  const infs = await db.influencer.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = infs.map((i) => i.id);
  if (ids.length) {
    await db.commissionLedger.deleteMany({ where: { influencerId: { in: ids } } });
    await db.payoutTransfer.deleteMany({ where: { influencerId: { in: ids } } });
    await db.payoutRequest.deleteMany({ where: { influencerId: { in: ids } } });
    await db.attribution.deleteMany({ where: { influencerId: { in: ids } } });
    await db.promoCode.deleteMany({ where: { influencerId: { in: ids } } });
    await db.influencer.deleteMany({ where: { id: { in: ids } } });
  }
  await db.syncState.deleteMany({ where: { key: { startsWith: `dispute:ch_${P}` } } });
  return ids.length;
}

async function main() {
  await cleanup();
  const qaOrg = await db.organization.findUnique({ where: { slug: QA_SLUG }, select: { id: true, name: true } });
  if (!qaOrg) {
    console.error(`FAIL  QA Co (slug ${QA_SLUG}) is not seeded in this database — run the seed first.`);
    process.exit(1);
  }
  console.log(`chargebacks · ${qaOrg.name} (${QA_SLUG}) · real handlers · no Stripe calls`);

  // ═══ A. Open dispute → HELD ═══
  head("A · a dispute opens on a pending commission: HELD, out of pending, out of payouts");
  const a = await partner("open", qaOrg.id);
  await accrueForInvoice(invoice(`in_${P}a`, a.sub, `ch_${P}a`, 7900));
  const opened = new Date("2026-09-01T12:00:00Z");
  const held = (await holdForDispute(dispute(`du_${P}a`, `ch_${P}a`, "needs_response"), opened)) as { heldRows?: number };
  let bk = await books(a.inf.id);
  ok("the accrual is HELD", held.heldRows === 1 && bk.rows.every((r) => r.state === "HELD"), JSON.stringify(held));
  ok("not in pending, not in cleared, counted as held",
    bk.bal.pendingCents === 0 && bk.bal.clearedCents === 0 && bk.bal.heldCents === 1580, c(bk.bal.heldCents));
  ok("the hold clock is stopped (no clearsAt)", bk.rows.every((r) => r.clearsAt === null));
  await clearDueCommissions();
  bk = await books(a.inf.id);
  ok("the clear cron does not release it", bk.rows.every((r) => r.state === "HELD"));
  await db.payoutRequest.create({ data: { influencerId: a.inf.id, amountCents: 1580, currency: "usd", status: "APPROVED" } });
  const calls: number[] = [];
  const stubApi: TransferApi = { async create(p) { calls.push(p.amount); return { id: `tr_${P}${calls.length}` }; } };
  await processApprovedPayouts(stubApi);
  ok("a payout run cannot take it — no transfer, request fails for want of cleared money",
    calls.length === 0, `${calls.length} transfer(s)`);
  const notesA = await moneyNotes(a.inf.id);
  ok("the portal says 'on hold' with the date the dispute opened",
    notesA.length === 1 && notesA[0].kind === "held" && notesA[0].amountCents === 1580 && notesA[0].date === opened.toISOString(),
    JSON.stringify(notesA[0]));
  await invariant("A", a.inf.id);

  // ═══ B. Lost → REVERSED, idempotent by dispute id ═══
  head("B · the dispute is lost: the whole commission is reversed, once");
  const lostRes = (await settleDispute(dispute(`du_${P}a`, `ch_${P}a`, "lost"), `evt_${P}lost`, new Date("2026-09-20T00:00:00Z"))) as { reversedCents?: number };
  bk = await books(a.inf.id);
  const cb = bk.rows.filter((r) => r.idempotencyKey.startsWith("dispute:"));
  ok("a REVERSED entry for the full 1580¢, keyed by the dispute id",
    lostRes.reversedCents === 1580 && cb.length === 1 && cb[0].amountCents === -1580 && cb[0].idempotencyKey.startsWith(`dispute:du_${P}a:`),
    JSON.stringify(lostRes));
  ok("the accrual and the chargeback close together as VOID — nothing left owed",
    bk.rows.every((r) => r.state === "VOID") && bk.bal.balanceCents === 0, c(bk.bal.balanceCents));
  const again = (await settleDispute(dispute(`du_${P}a`, `ch_${P}a`, "lost"), `evt_${P}lost2`)) as { skipped?: string };
  ok("the same dispute closing again changes nothing", again.skipped === "already-closed" &&
    (await books(a.inf.id)).rows.filter((r) => r.idempotencyKey.startsWith("dispute:")).length === 1, String(again.skipped));
  const lateOpen = (await holdForDispute(dispute(`du_${P}a`, `ch_${P}a`, "needs_response"))) as { skipped?: string };
  ok("a dispute.created that arrives after the close is ignored", lateOpen.skipped === "already-closed", String(lateOpen.skipped));
  const notesB = await moneyNotes(a.inf.id);
  ok("the portal shows a 'chargeback' line dated the day the dispute was lost",
    notesB.some((n) => n.kind === "chargeback" && n.amountCents === -1580 && n.date === "2026-09-20T00:00:00.000Z"),
    JSON.stringify(notesB));
  await invariant("B", a.inf.id);

  // ═══ C. Won → PENDING, hold restarted from the close date ═══
  head("C · the dispute is won: nothing reversed, back to PENDING, hold counted from the close");
  const cP = await partner("won", qaOrg.id);
  await accrueForInvoice(invoice(`in_${P}c`, cP.sub, `ch_${P}c`, 7900));
  await holdForDispute(dispute(`du_${P}c`, `ch_${P}c`, "needs_response"), new Date("2026-09-01T00:00:00Z"));
  const closed = new Date("2026-10-15T00:00:00Z");
  const won = (await settleDispute(dispute(`du_${P}c`, `ch_${P}c`, "won"), `evt_${P}won`, closed)) as { released?: number };
  bk = await books(cP.inf.id);
  ok("released, nothing reversed", won.released === 1 && !bk.rows.some((r) => r.entryType === "REVERSED"), JSON.stringify(won));
  ok("back to PENDING with clearsAt = close date + 30 days",
    bk.rows[0].state === "PENDING" && bk.rows[0].clearsAt?.getTime() === closed.getTime() + 30 * DAY,
    `${bk.rows[0].state} · clears ${bk.rows[0].clearsAt?.toISOString()}`);
  const wonAgain = (await settleDispute(dispute(`du_${P}c`, `ch_${P}c`, "won"), `evt_${P}won2`, new Date())) as { skipped?: string };
  ok("closing again does not move the clock", wonAgain.skipped === "already-closed" &&
    (await books(cP.inf.id)).rows[0].clearsAt?.getTime() === closed.getTime() + 30 * DAY);
  await invariant("C", cP.inf.id);

  // ═══ D. Dispute on money already cleared (not yet paid) ═══
  head("D · a dispute on CLEARED, unpaid commission freezes it too — won brings it back as PENDING");
  const d = await partner("cleared", qaOrg.id);
  await accrueForInvoice(invoice(`in_${P}d`, d.sub, `ch_${P}d`, 7900));
  await db.commissionLedger.updateMany({ where: { influencerId: d.inf.id }, data: { state: "CLEARED" } });
  await holdForDispute(dispute(`du_${P}d`, `ch_${P}d`, "needs_response"));
  bk = await books(d.inf.id);
  ok("taken out of the payable balance", bk.bal.clearedCents === 0 && bk.bal.heldCents === 1580);
  await settleDispute(dispute(`du_${P}d`, `ch_${P}d`, "warning_closed"), `evt_${P}d`, new Date());
  bk = await books(d.inf.id);
  ok("an inquiry closed without a chargeback releases it like a win — PENDING, not CLEARED",
    bk.rows[0].state === "PENDING" && !!bk.rows[0].clearsAt, bk.rows[0].state);
  await invariant("D", d.inf.id);

  // ═══ E. Dispute AFTER the payout ═══
  head("E · a dispute after the money was paid: balance goes negative, the next commission pays it back");
  const e = await partner("afterpay", qaOrg.id);
  await accrueForInvoice(invoice(`in_${P}e1`, e.sub, `ch_${P}e1`, 6320));
  await db.commissionLedger.updateMany({ where: { influencerId: e.inf.id }, data: { state: "CLEARED" } });
  await db.payoutRequest.create({ data: { influencerId: e.inf.id, amountCents: 1264, currency: "usd", status: "APPROVED" } });
  const eCalls: number[] = [];
  await processApprovedPayouts({ async create(p) { eCalls.push(p.amount); return { id: `tr_${P}e` }; } });
  ok("paid out 1264¢ first", eCalls[0] === 1264);
  const eHold = (await holdForDispute(dispute(`du_${P}e`, `ch_${P}e1`, "needs_response"))) as { heldRows?: number };
  ok("nothing is held — the money has already left", eHold.heldRows === 0, JSON.stringify(eHold));
  await settleDispute(dispute(`du_${P}e`, `ch_${P}e1`, "lost"), `evt_${P}e`, new Date());
  bk = await books(e.inf.id);
  ok("the chargeback lands CLEARED and drives the balance to −1264¢",
    bk.bal.clearedCents === -1264 && bk.bal.balanceCents === -1264, `cleared ${c(bk.bal.clearedCents)}`);
  ok("the portal shows it as a chargeback", (await moneyNotes(e.inf.id)).some((n) => n.kind === "chargeback" && n.amountCents === -1264));
  await accrueForInvoice(invoice(`in_${P}e2`, e.sub, `ch_${P}e2`, 7900));
  await db.commissionLedger.updateMany({ where: { influencerId: e.inf.id, state: "PENDING" }, data: { clearsAt: new Date(Date.now() - 1000) } });
  await clearDueCommissions();
  bk = await books(e.inf.id);
  ok("the next commission pays it back first: 1580 − 1264 = 316¢ payable",
    bk.bal.clearedCents === 316, c(bk.bal.clearedCents));
  await db.payoutRequest.create({ data: { influencerId: e.inf.id, amountCents: 316, currency: "usd", status: "APPROVED" } });
  await processApprovedPayouts({ async create(p) { eCalls.push(p.amount); return { id: `tr_${P}e2` }; } });
  ok("the next payout is the netted 316¢ — never more than approved", eCalls[1] === 316, `sent ${c(eCalls[1] ?? 0)}`);
  await invariant("E", e.inf.id);

  // ═══ F. Partial refund, then a lost dispute ═══
  head("F · half refunded, then disputed and lost: the rest is reversed, never more than the whole");
  const f = await partner("partial", qaOrg.id);
  await accrueForInvoice(invoice(`in_${P}f`, f.sub, `ch_${P}f`, 7900));
  await reverseForCharge(chargeObj(`ch_${P}f`, 7900, 3950, `in_${P}f`));
  await holdForDispute(dispute(`du_${P}f`, `ch_${P}f`, "needs_response"));
  bk = await books(f.inf.id);
  ok("the accrual and its refund reversal are frozen together", bk.rows.every((r) => r.state === "HELD") && bk.bal.heldCents === 790);
  const fLost = (await settleDispute(dispute(`du_${P}f`, `ch_${P}f`, "lost"), `evt_${P}f`, new Date())) as { reversedCents?: number };
  bk = await books(f.inf.id);
  ok("only the remaining 790¢ is reversed", fLost.reversedCents === 790, JSON.stringify(fLost));
  ok("everything nets to zero", bk.bal.balanceCents === 0 && bk.rows.every((r) => r.state === "VOID"));
  await invariant("F", f.inf.id);

  // ═══ G. A refund while the dispute is open stays frozen with it ═══
  head("G · a refund during an open dispute is held with the commission");
  const g = await partner("refundheld", qaOrg.id);
  await accrueForInvoice(invoice(`in_${P}g`, g.sub, `ch_${P}g`, 7900));
  await holdForDispute(dispute(`du_${P}g`, `ch_${P}g`, "needs_response"));
  await reverseForCharge(chargeObj(`ch_${P}g`, 7900, 3950, `in_${P}g`));
  bk = await books(g.inf.id);
  ok("the refund reversal is written HELD, not PENDING", bk.rows.every((r) => r.state === "HELD") && bk.bal.heldCents === 790);
  await invariant("G", g.inf.id);

  // ═══ I. A clawback of commission already paid is a debt — never frozen ═══
  head("I · paid, half refunded, then disputed and lost: the refund clawback keeps netting, nothing stays HELD");
  const i = await partner("paidclaw", qaOrg.id);
  await accrueForInvoice(invoice(`in_${P}i1`, i.sub, `ch_${P}i1`, 7900));
  await db.commissionLedger.updateMany({ where: { influencerId: i.inf.id }, data: { state: "CLEARED" } });
  await db.payoutRequest.create({ data: { influencerId: i.inf.id, amountCents: 1580, currency: "usd", status: "APPROVED" } });
  const iCalls: number[] = [];
  await processApprovedPayouts({ async create(p) { iCalls.push(p.amount); return { id: `tr_${P}i${iCalls.length}` }; } });
  await reverseForCharge(chargeObj(`ch_${P}i1`, 7900, 3950, `in_${P}i1`));
  const iHold = (await holdForDispute(dispute(`du_${P}i`, `ch_${P}i1`, "needs_response"))) as { heldRows?: number };
  bk = await books(i.inf.id);
  ok("the dispute holds nothing — the commission was paid and its clawback is owed",
    iHold.heldRows === 0 && bk.bal.heldCents === 0 && bk.bal.clearedCents === -790, `held ${c(bk.bal.heldCents)} · cleared ${c(bk.bal.clearedCents)}`);
  await settleDispute(dispute(`du_${P}i`, `ch_${P}i1`, "lost"), `evt_${P}i`, new Date());
  bk = await books(i.inf.id);
  ok("lost: the rest (790¢) is charged back — cleared −1580¢, nothing HELD",
    bk.bal.heldCents === 0 && bk.bal.clearedCents === -1580 && bk.bal.balanceCents === -1580, `cleared ${c(bk.bal.clearedCents)}`);
  await accrueForInvoice(invoice(`in_${P}i2`, i.sub, `ch_${P}i2`, 7900));
  await db.commissionLedger.updateMany({ where: { influencerId: i.inf.id, state: "PENDING" }, data: { clearsAt: new Date(Date.now() - 1000) } });
  await clearDueCommissions();
  bk = await books(i.inf.id);
  ok("the next 1580¢ commission pays the whole debt back — 0 payable", bk.bal.clearedCents === 0, c(bk.bal.clearedCents));
  await invariant("I", i.inf.id);

  // ═══ J. The dispute outruns the invoice ═══
  head("J · dispute events before the invoice: the late commission is born held, or charged back");
  const j = await partner("late", qaOrg.id);
  await holdForDispute(dispute(`du_${P}j1`, `ch_${P}j1`, "needs_response"), new Date("2026-09-02T00:00:00Z"));
  await settleDispute(dispute(`du_${P}j1`, `ch_${P}j1`, "lost"), `evt_${P}j1`, new Date("2026-09-05T00:00:00Z"));
  const jLost = (await accrueForInvoice(invoice(`in_${P}j1`, j.sub, `ch_${P}j1`, 7900))) as { dispute?: string };
  bk = await books(j.inf.id);
  ok("created → closed(lost) → invoice.paid: the accrual is charged back on arrival — balance 0, all VOID",
    jLost.dispute === "lost" && bk.bal.balanceCents === 0 && bk.rows.every((r) => r.state === "VOID") &&
      bk.rows.filter((r) => r.idempotencyKey.startsWith(`dispute:du_${P}j1:`)).length === 1,
    JSON.stringify(jLost));
  await holdForDispute(dispute(`du_${P}j2`, `ch_${P}j2`, "needs_response"));
  const jHeld = (await accrueForInvoice(invoice(`in_${P}j2`, j.sub, `ch_${P}j2`, 7900))) as { dispute?: string };
  bk = await books(j.inf.id);
  const j2 = bk.rows.filter((r) => r.stripeChargeId === `ch_${P}j2`);
  ok("created → invoice.paid: the accrual arrives HELD, clock stopped",
    jHeld.dispute === "held" && j2.length === 1 && j2[0].state === "HELD" && j2[0].clearsAt === null, JSON.stringify(jHeld));
  await db.payoutRequest.create({ data: { influencerId: j.inf.id, amountCents: 1580, currency: "usd", status: "APPROVED" } });
  const jCalls: number[] = [];
  await processApprovedPayouts({ async create(p) { jCalls.push(p.amount); return { id: `tr_${P}j` }; } });
  ok("and no payout can take it", jCalls.length === 0, `${jCalls.length} transfer(s)`);
  await invariant("J", j.inf.id);

  // ═══ K. Refused payout during an open dispute ═══
  head("K · a dispute opens while the money is in a payout, then Stripe refuses the transfer: the rows come back HELD");
  const k = await partner("refused", qaOrg.id);
  await accrueForInvoice(invoice(`in_${P}k`, k.sub, `ch_${P}k`, 7900));
  await db.commissionLedger.updateMany({ where: { influencerId: k.inf.id }, data: { state: "CLEARED" } });
  await db.payoutRequest.create({ data: { influencerId: k.inf.id, amountCents: 1580, currency: "usd", status: "APPROVED" } });
  let kHeldAtOpen = -1;
  await processApprovedPayouts({
    async create() {
      // The dispute opens while the rows are reserved to this transfer.
      kHeldAtOpen = ((await holdForDispute(dispute(`du_${P}k`, `ch_${P}k`, "needs_response"))) as { heldRows?: number }).heldRows ?? -1;
      throw Object.assign(new Error("No such destination"), { type: "StripeInvalidRequestError" });
    },
  });
  bk = await books(k.inf.id);
  ok("in the payout when the dispute opened, so nothing could be held then", kHeldAtOpen === 0, String(kHeldAtOpen));
  ok("the refusal hands the rows back HELD, not CLEARED", bk.bal.heldCents === 1580 && bk.bal.clearedCents === 0,
    `held ${c(bk.bal.heldCents)} · cleared ${c(bk.bal.clearedCents)}`);
  await invariant("K", k.inf.id);

  // ═══ L. Retry payout during an open dispute ═══
  head("L · transfer reversed, then a dispute opens, then the admin clicks Retry: HELD, not payable");
  const l = await partner("retry", qaOrg.id);
  await accrueForInvoice(invoice(`in_${P}l`, l.sub, `ch_${P}l`, 7900));
  await db.commissionLedger.updateMany({ where: { influencerId: l.inf.id }, data: { state: "CLEARED" } });
  const lReq = await db.payoutRequest.create({ data: { influencerId: l.inf.id, amountCents: 1580, currency: "usd", status: "APPROVED" } });
  await processApprovedPayouts({ async create() { return { id: `tr_${P}l` }; } });
  await handleTransferEvent({ id: `tr_${P}l`, amount: 1580, amount_reversed: 1580, reversed: true } as never, true);
  await holdForDispute(dispute(`du_${P}l`, `ch_${P}l`, "needs_response"));
  const lRetry = await releaseReversedPayout(lReq.id);
  bk = await books(l.inf.id);
  ok("Retry returns it to HELD while the dispute is open", lRetry.ok && bk.bal.heldCents === 1580 && bk.bal.clearedCents === 0,
    `${JSON.stringify(lRetry)} · held ${c(bk.bal.heldCents)} · cleared ${c(bk.bal.clearedCents)}`);
  await settleDispute(dispute(`du_${P}l`, `ch_${P}l`, "lost"), `evt_${P}l`, new Date());
  bk = await books(l.inf.id);
  ok("lost afterwards: the commission and its chargeback close VOID — balance 0", bk.bal.balanceCents === 0 && bk.bal.heldCents === 0,
    c(bk.bal.balanceCents));
  await invariant("L", l.inf.id);

  // ═══ M. A second dispute on the same payment ═══
  head("M · an inquiry closes, then a new dispute on the same payment: held again, and lost");
  const m = await partner("second", qaOrg.id);
  await accrueForInvoice(invoice(`in_${P}m`, m.sub, `ch_${P}m`, 7900));
  await holdForDispute(dispute(`du_${P}m1`, `ch_${P}m`, "warning_needs_response"));
  await settleDispute(dispute(`du_${P}m1`, `ch_${P}m`, "warning_closed"), `evt_${P}m1`, new Date());
  const mOpened = new Date("2026-10-01T00:00:00Z");
  const mHold = (await holdForDispute(dispute(`du_${P}m2`, `ch_${P}m`, "needs_response"), mOpened)) as { heldRows?: number };
  bk = await books(m.inf.id);
  ok("the second dispute holds the commission again", mHold.heldRows === 1 && bk.bal.heldCents === 1580, JSON.stringify(mHold));
  const mNotes = await moneyNotes(m.inf.id);
  ok("the portal dates the hold by the dispute that is open now",
    mNotes.length === 1 && mNotes[0].kind === "held" && mNotes[0].date === mOpened.toISOString(), JSON.stringify(mNotes));
  const mStale = (await settleDispute(dispute(`du_${P}m1`, `ch_${P}m`, "warning_closed"), `evt_${P}m1b`, new Date())) as { skipped?: string };
  ok("a redelivered close of the FIRST dispute does not release it", mStale.skipped === "already-closed" &&
    (await books(m.inf.id)).bal.heldCents === 1580, String(mStale.skipped));
  const mLost = (await settleDispute(dispute(`du_${P}m2`, `ch_${P}m`, "lost"), `evt_${P}m2`, new Date())) as { reversedCents?: number };
  bk = await books(m.inf.id);
  ok("lost: the whole 1580¢ reversed, balance 0", mLost.reversedCents === 1580 && bk.bal.balanceCents === 0, JSON.stringify(mLost));
  await invariant("M", m.inf.id);

  // ═══ N. A refund netted into a payout, then the commission is lost ═══
  head("N · the refund of an unpaid commission was already netted into a payout, then the dispute is lost: the deduction comes back");
  const nP = await partner("split", qaOrg.id);
  await accrueForInvoice(invoice(`in_${P}n1`, nP.sub, `ch_${P}n1`, 7900));
  await accrueForInvoice(invoice(`in_${P}n2`, nP.sub, `ch_${P}n2`, 7900));
  await db.commissionLedger.updateMany({ where: { influencerId: nP.inf.id }, data: { state: "CLEARED" } });
  await reverseForCharge(chargeObj(`ch_${P}n2`, 7900, 3950, `in_${P}n2`));
  await db.payoutRequest.create({ data: { influencerId: nP.inf.id, amountCents: 790, currency: "usd", status: "APPROVED" } });
  const nCalls: number[] = [];
  await processApprovedPayouts({ async create(p) { nCalls.push(p.amount); return { id: `tr_${P}n` }; } });
  bk = await books(nP.inf.id);
  const n2 = bk.rows.filter((r) => r.stripeChargeId === `ch_${P}n2`);
  ok("set-up: the −790¢ refund rode the payout, its 1580¢ commission did not",
    nCalls[0] === 790 && n2.find((r) => r.entryType === "REVERSED")?.state === "PAID" && n2.find((r) => r.entryType === "ACCRUED")?.state === "CLEARED",
    n2.map((r) => `${r.entryType} ${r.amountCents} ${r.state}`).join(" · "));
  await holdForDispute(dispute(`du_${P}n`, `ch_${P}n2`, "needs_response"));
  await settleDispute(dispute(`du_${P}n`, `ch_${P}n2`, "lost"), `evt_${P}n`, new Date());
  bk = await books(nP.inf.id);
  ok("the partner is owed the 790¢ the refund took off the payout — earned 1580, received 790",
    bk.bal.clearedCents === 790 && bk.bal.balanceCents === 790, `cleared ${c(bk.bal.clearedCents)} · balance ${c(bk.bal.balanceCents)}`);
  const nAgain = (await settleDispute(dispute(`du_${P}n`, `ch_${P}n2`, "lost"), `evt_${P}n2`, new Date())) as { skipped?: string };
  ok("closing again returns nothing twice", nAgain.skipped === "already-closed" && (await books(nP.inf.id)).bal.clearedCents === 790);
  await invariant("N", nP.inf.id);

  // ═══ H. The webhook accepts both events ═══
  head("H · the webhook routes both dispute events");
  const route = readFileSync("src/app/api/webhooks/stripe/route.ts", "utf8");
  ok("charge.dispute.created → holdForDispute", /case "charge\.dispute\.created":[\s\S]{0,300}holdForDispute\(/.test(route));
  ok("charge.dispute.closed → settleDispute", /case "charge\.dispute\.closed":[\s\S]{0,300}settleDispute\(/.test(route));

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
