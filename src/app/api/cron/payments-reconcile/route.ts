import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contractSchedule } from "@/lib/contractTotal";
import { isCronAuthorized } from "@/lib/cronAuth";
import { InstallmentStatus, ProposalStatus } from "@/lib/prismaEnums";
import { resolveSchedule } from "@/lib/paymentSchedule";
import { verifyCheckoutRef } from "@/lib/payments/verify";
import { releaseStaleClaims } from "@/lib/payments/checkouts";
import { reconcileFinancing } from "@/lib/financing/service";

export const runtime = "nodejs";

// Backstop for webhooks that never arrive. Every 30 min:
//   1) PENDING stages older than 15 min → ask the provider; paid → settle,
//      expired → release, still open → leave (Stripe sessions live 1 h).
//   2) Claims with no ref / older than 24 h → release (a Square link has no
//      expiry, but a client who has not paid in a day gets a fresh one).
//   3) ACCEPTED proposals whose stages are all settled → flip PAID.
const VERIFY_AFTER_MS = 15 * 60 * 1000;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pending = await db.installment.findMany({
    where: {
      status: InstallmentStatus.PENDING,
      checkoutRef: { not: null },
      checkoutOpenedAt: { lt: new Date(Date.now() - VERIFY_AFTER_MS) },
    },
    select: { proposalId: true, checkoutRef: true },
    distinct: ["checkoutRef"],
    take: 200,
  });

  const tally = { checked: 0, paid: 0, expired: 0, open: 0, unavailable: 0 };
  for (const row of pending) {
    tally.checked += 1;
    const v = await verifyCheckoutRef(row.proposalId, row.checkoutRef!);
    if (v.state === "paid") tally.paid += 1;
    else if (v.state === "open") tally.open += 1;
    else if (v.state === "unavailable") tally.unavailable += 1;
    else {
      tally.expired += 1;
      await db.installment.updateMany({
        where: { checkoutRef: row.checkoutRef!, status: InstallmentStatus.PENDING },
        data: {
          status: InstallmentStatus.UNPAID,
          checkoutProvider: null,
          checkoutRef: null,
          checkoutOrderId: null,
          checkoutOpenedAt: null,
        },
      });
    }
  }

  const released = await releaseStaleClaims(24 * 60 * 60 * 1000);

  // Consistency: ACCEPTED with nothing owed → PAID.
  const accepted = await db.proposal.findMany({
    where: { status: ProposalStatus.ACCEPTED, installments: { some: { status: InstallmentStatus.PAID } } },
    select: { id: true, total: true, currency: true, installments: true, changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true } } },
    take: 500,
  });
  let flipped = 0;
  for (const p of accepted) {
    const s = resolveSchedule({ ...contractSchedule(p.total, p.changeOrders), currency: p.currency, installments: p.installments });
    if (s.remainingMinor <= 0 && s.totalMinor > 0) {
      await db.proposal.update({ where: { id: p.id }, data: { status: ProposalStatus.PAID, paidAt: new Date() } });
      flipped += 1;
    }
  }

  // Wisetack financing (lib/financing): applications in review, open loans, the office's reminders — the backstop for
  // a webhook that never came. Its own failure never fails the card reconcile above.
  const financing = await reconcileFinancing(new Date()).catch(() => null);

  return NextResponse.json({ ...tally, released, flipped, financing });
}
