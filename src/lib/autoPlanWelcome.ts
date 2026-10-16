// "YOU'RE ON PROFESSIONAL — CHANGE IT ANY TIME" (owner, 2026-10-15: "after they appear in JobFlex with the
// Professional plan, tell them that if they need a different package and tools they can adjust the plan at any
// time"). A shop that came in by the short sign-up (lib/signupAutoPlan) is marked `autoPlanWelcome:<orgId>` when it
// is created; the dashboard draws the welcome card from what the subscription really is (a visitor who backed out of
// the card page and picked Starter is told Starter) until the owner dismisses it or ten days pass.
import { db } from "@/lib/db";
import { getPlanCatalog } from "@/lib/planCatalogServer";
import { parseTradeTypes } from "@/lib/tradeTypes";

export const autoPlanWelcomeKey = (orgId: string) => `autoPlanWelcome:${orgId}`;
const SHOWN_FOR_MS = 10 * 86_400_000;

export type AutoPlanWelcomeView = {
  planName: string;
  /** On the free days still; the first charge falls on trialEndsAt. */
  trial: boolean;
  trialEndsAt: string | null;
  /** What the plan costs after the trial, in cents, and how often. */
  priceCents: number | null;
  interval: "MONTH" | "YEAR";
  /** Where Stripe sends the receipts — shown so a mistyped address is caught. */
  billingEmail: string | null;
  /** HOMEOWNER LEADS (owner, 2026-10-15: "set up your specialty — the lead home portal opens soon in your area"):
   *  the shop's town ("Bellevue, WA") when its address names one, the trades it takes, and whether both are in
   *  (address geocoded + at least one trade) — what lead matching needs (lib/leadSetup). */
  leads: { area: string | null; trades: string[]; ready: boolean };
};

/** "123 Main St, Bellevue, WA 98004, USA" → "Bellevue, WA"; null when the address doesn't say. */
export function areaFromAddress(address: string | null | undefined): string | null {
  const parts = (address ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !/^(usa|us|united states( of america)?)$/i.test(p));
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  const state = /^([A-Z]{2})\b/.exec(last)?.[1] ?? null;
  const city = parts[parts.length - 2];
  if (!state || !city || /\d/.test(city) || city.length > 40) return null;
  return `${city}, ${state}`;
}

/** The welcome card for this shop, or null (never marked, dismissed, stale, or no plan yet). Never throws. */
export async function autoPlanWelcomeView(orgId: string, now = new Date()): Promise<AutoPlanWelcomeView | null> {
  try {
    const row = await db.syncState.findUnique({ where: { key: autoPlanWelcomeKey(orgId) }, select: { cursor: true } });
    if (!row) return null;
    const mark = JSON.parse(row.cursor) as { at?: string; dismissedAt?: string };
    if (mark.dismissedAt) return null;
    if (mark.at && now.getTime() - Date.parse(mark.at) > SHOWN_FOR_MS) return null;
    const [sub, org] = await Promise.all([
      db.subscription.findUnique({ where: { organizationId: orgId }, select: { plan: true, status: true, trialEndsAt: true, stripePriceId: true } }),
      db.organization.findUnique({ where: { id: orgId }, select: { billingEmail: true, address: true, lat: true, lng: true, tradeTypesJson: true } }),
    ]);
    if (!sub || sub.plan === "FREE") return null;
    const slug = sub.plan.toLowerCase();
    const [catalog, price] = await Promise.all([
      getPlanCatalog({ includeInactive: true }),
      sub.stripePriceId ? db.planPrice.findUnique({ where: { stripePriceId: sub.stripePriceId }, select: { interval: true, unitAmountCents: true } }) : null,
    ]);
    const plan = catalog.find((p) => p.slug === slug);
    const interval = price?.interval === "YEAR" ? "YEAR" : "MONTH";
    return {
      planName: plan?.name ?? sub.plan.charAt(0) + sub.plan.slice(1).toLowerCase(),
      trial: sub.status === "TRIALING" && !!sub.trialEndsAt && sub.trialEndsAt > now,
      trialEndsAt: sub.trialEndsAt ? sub.trialEndsAt.toISOString() : null,
      priceCents: price?.unitAmountCents ?? (interval === "YEAR" ? plan?.yearlyPriceCents ?? null : plan?.priceCents ?? null),
      interval,
      billingEmail: org?.billingEmail ?? null,
      leads: (() => {
        const trades = parseTradeTypes(org?.tradeTypesJson).filter((t) => t !== "Other");
        const located = !!org?.address?.trim() && org.lat != null && org.lng != null;
        return { area: areaFromAddress(org?.address), trades, ready: located && trades.length > 0 };
      })(),
    };
  } catch (err) {
    console.warn("[autoPlanWelcome] read failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** "Got it": the card is not drawn again for this shop. */
export async function dismissAutoPlanWelcomeFor(orgId: string): Promise<void> {
  const key = autoPlanWelcomeKey(orgId);
  const row = await db.syncState.findUnique({ where: { key }, select: { cursor: true } });
  if (!row) return;
  let mark: Record<string, unknown> = {};
  try {
    mark = JSON.parse(row.cursor) as Record<string, unknown>;
  } catch {
    /* a broken mark is replaced */
  }
  await db.syncState.update({ where: { key }, data: { cursor: JSON.stringify({ ...mark, dismissedAt: new Date().toISOString() }) } });
}
