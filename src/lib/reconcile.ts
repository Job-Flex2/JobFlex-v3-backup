// Server-only reconciliation backstop. Re-syncs the Subscription mirror and
// re-asserts commission accruals straight from Stripe, repairing any dropped
// webhook. Safe to re-run: syncSubscriptionFromStripe upserts, and accrual is
// guarded by the unique `accrue:<invoiceId>` ledger key.

import type Stripe from "stripe";
import { db } from "@/lib/db";
import { getStripe, isStripeEnabled } from "@/lib/sdk/stripe";
import { syncSubscriptionFromStripe, accrueForInvoice } from "@/lib/stripeSync";

// Flip accruals out of the hold window into CLEARED (payable). Reversals that
// offset a pending accrual carry the same clearsAt, so they net on the way out.
export async function clearDueCommissions() {
  const res = await db.commissionLedger.updateMany({
    where: { state: "PENDING", clearsAt: { lte: new Date() } },
    data: { state: "CLEARED" },
  });
  return { cleared: res.count };
}

/** An organization billed by more than one live subscription — reported, never cancelled here. */
export type DuplicateSubscriptions = {
  organizationId: string;
  subscriptions: { id: string; status: string; customer: string; created: string; mirrored: boolean }[];
};

const LIVE = ["active", "trialing", "past_due"] as const;

/**
 * TWO LIVE SUBSCRIPTIONS FOR ONE COMPANY (owner, 2026-10-12): a plan checkout
 * whose replaced subscription was never cancelled — before the webhook ran
 * that cancel too, a customer who closed the tab after paying kept both — or
 * anything else that left two billing. Every live subscription is read (all
 * pages, not the 100 newest), mapped to its organization by metadata, then by
 * the mirror's subscription or customer, and any organization with two or
 * more is reported in the log and in the cron's answer. Nothing is cancelled:
 * which one goes is a person's call.
 */
export async function findDuplicateSubscriptions(stripe: Stripe): Promise<DuplicateSubscriptions[]> {
  const live: Stripe.Subscription[] = [];
  for (const status of LIVE) {
    for await (const sub of stripe.subscriptions.list({ status, limit: 100 })) {
      live.push(sub);
      if (live.length >= 5000) break;
    }
  }
  if (live.length < 2) return [];
  const subIds = live.map((s) => s.id);
  const customers = Array.from(new Set(live.map((s) => (typeof s.customer === "string" ? s.customer : s.customer.id))));
  const rows = await db.subscription.findMany({
    where: { OR: [{ externalSubId: { in: subIds } }, { externalCustomerId: { in: customers } }] },
    select: { organizationId: true, externalSubId: true, externalCustomerId: true },
  });
  const bySub = new Map(rows.filter((r) => r.externalSubId).map((r) => [r.externalSubId as string, r.organizationId]));
  const byCustomer = new Map(rows.filter((r) => r.externalCustomerId).map((r) => [r.externalCustomerId as string, r.organizationId]));
  const mirrored = new Set(rows.map((r) => r.externalSubId).filter(Boolean) as string[]);
  const groups = new Map<string, DuplicateSubscriptions["subscriptions"]>();
  for (const sub of live) {
    const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const org = sub.metadata?.organizationId || bySub.get(sub.id) || byCustomer.get(customer);
    if (!org) continue;
    const list = groups.get(org) ?? [];
    list.push({ id: sub.id, status: sub.status, customer, created: new Date(sub.created * 1000).toISOString(), mirrored: mirrored.has(sub.id) });
    groups.set(org, list);
  }
  return Array.from(groups.entries())
    .filter(([, list]) => list.length > 1)
    .map(([organizationId, subscriptions]) => ({ organizationId, subscriptions }));
}

/** A subscription that names an organization which no longer exists. */
export type ReconcileSkip = { subscription: string; status: string; organizationId: string | null };
/** One row that threw; the run carried on past it. */
export type ReconcileFailure = { id: string; error: string };

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 300);

// Bounded recent sweep (last 100 subscriptions + 100 paid invoices). Enough as a
// backstop for dropped webhooks; widen / paginate via SyncState if volume grows.
//
// ONE ROW NEVER STOPS THE RUN. Each subscription and each invoice is synced in
// its own try/catch: a subscription whose organization was deleted is skipped
// and listed, any other failure is logged and listed, and the rest still sync.
export async function reconcileStripe() {
  if (!isStripeEnabled()) return { skipped: "stripe-disabled", subscriptions: 0, invoices: 0 };
  const stripe = getStripe();

  let subscriptions = 0;
  let invoices = 0;
  const missingOrganization: ReconcileSkip[] = [];
  const failed: ReconcileFailure[] = [];

  const subList = await stripe.subscriptions.list({ limit: 100, status: "all" });
  for (const sub of subList.data) {
    try {
      const res = await syncSubscriptionFromStripe(sub, stripe);
      if (!res.synced && res.reason === "organization-missing") {
        missingOrganization.push({ subscription: sub.id, status: sub.status, organizationId: res.organizationId });
        continue;
      }
      subscriptions++;
    } catch (err) {
      console.error(`[reconcile] subscription ${sub.id} failed:`, err);
      failed.push({ id: sub.id, error: errorText(err) });
    }
  }

  const invList = await stripe.invoices.list({ limit: 100, status: "paid" });
  for (const inv of invList.data) {
    try {
      await accrueForInvoice(inv, undefined, stripe);
      invoices++;
    } catch (err) {
      console.error(`[reconcile] invoice ${inv.id} failed:`, err);
      failed.push({ id: inv.id ?? "invoice", error: errorText(err) });
    }
  }

  const duplicateSubscriptions = await findDuplicateSubscriptions(stripe).catch((err) => {
    console.error("[reconcile] duplicate-subscription scan failed:", err);
    failed.push({ id: "duplicate-scan", error: errorText(err) });
    return [] as DuplicateSubscriptions[];
  });
  if (duplicateSubscriptions.length) {
    console.warn(
      `[reconcile] ${duplicateSubscriptions.length} organization(s) with more than one live subscription: ` +
        duplicateSubscriptions.map((d) => `${d.organizationId} → ${d.subscriptions.map((s) => `${s.id} (${s.status})`).join(", ")}`).join("; "),
    );
  }

  if (missingOrganization.length) {
    console.warn(
      `[reconcile] skipped ${missingOrganization.length} subscription(s) whose organization no longer exists: ` +
        missingOrganization.map((s) => `${s.subscription} (${s.status}) → ${s.organizationId}`).join(", "),
    );
  }

  await db.syncState.upsert({
    where: { key: "reconcile-stripe" },
    update: { cursor: String(Math.floor(Date.now() / 1000)) },
    create: { key: "reconcile-stripe", cursor: String(Math.floor(Date.now() / 1000)) },
  });

  return { subscriptions, invoices, missingOrganization, duplicateSubscriptions, failed };
}
