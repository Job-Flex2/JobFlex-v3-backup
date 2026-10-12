// PLANS & UPGRADE — /dashboard/upgrade.
//
// The plans page for an org that ALREADY EXISTS — the one surface the app was
// missing: the signup plan step only runs inside registration, and
// /dashboard/subscription's plan strip was a static fixture. This page reads
// the SAME live catalog /admin/plans drives (getPlanCatalog — never a copy)
// and its CTAs open a real Stripe Checkout for the signed-in org via
// /api/checkout/subscription, which follows the admin's live/sandbox switch.
//
// It is also where the custom plan's upgrade gate points: a custom-plan org
// that opens a page it didn't buy lands on the gate, and the gate's one
// button lands here.
//
// THE RETURN LEG IS VERIFIED HERE, not by the webhook: checkout's success_url
// comes back with ?session_id, and this page retrieves the session under the
// SAME mode switch, checks it belongs to THIS org, and writes the plan change
// itself. The live webhook cannot see sandbox events at all, and even live,
// the customer lands here before the event does — same arrangement as the
// signup flow's completePendingSignup.

import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { getPlanCatalog } from "@/lib/planCatalogServer";
import { editionUpgradeTarget } from "@/lib/editionAccess";
import { isEditionOpen } from "@/lib/editions";
import { isStripeEnabled } from "@/lib/sdk/stripe";
import { getStripeMode } from "@/lib/stripeMode";
import { isOwnerRole } from "@/lib/orgContext";
import { normalizeCustomPages } from "@/lib/customPlan";
import { customPlanOffered } from "@/lib/customPlanFlag";
import type { UpgradePlan } from "@/components/v3/upgrade-blueprint/upgrade-content";
// One URL, two designs: the desktop build above 768px, the handheld build in
// components/v3/mobile-upgrade at or below it. Same props, one loader — see
// upgrade-responsive.tsx.
import { UpgradeResponsive } from "./upgrade-responsive";
// TEMP (2026-09-19): the dev-only plan simulator; see lib/devSimulation.
import { isDevSimulationEnabled } from "@/lib/devSimulation";
import { DevPlanSimulator } from "./dev-plan-simulator";
import { applyCheckoutReturn } from "@/lib/checkoutReturn";
import { planTermState } from "@/lib/planChange";

export const metadata = { title: "Plans & upgrade — JobFlex" };
export const dynamic = "force-dynamic";

/** The checkout return, processed once (lib/checkoutReturn): a second visit
 *  of the same success URL changes nothing. */
function verifyReturn(organizationId: string, sessionId: string): Promise<string | null> {
  return applyCheckoutReturn(organizationId, sessionId, "upgrade");
}

export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; checkout?: string; simulated?: string; dir?: string; edition?: string }>;
}) {
  let ctx: Awaited<ReturnType<typeof requireOrg>>;
  try {
    ctx = await requireOrg();
  } catch {
    redirect("/auth/login?next=%2Fdashboard%2Fupgrade");
  }

  const params = await searchParams;
  // TEMP (2026-09-19): ?simulated=&dir= is the dev simulator's return leg —
  // read ONLY behind the server gate, so on Vercel both parameters are inert.
  const devSim = isDevSimulationEnabled();
  const upgradedTo = params.session_id
    ? await verifyReturn(ctx.organizationId, params.session_id)
    : devSim && params.simulated
      ? params.simulated
      : null;
  // A checkout return is always a step up; only the simulator can say "down".
  const upgradedDirection: "up" | "down" = !params.session_id && devSim && params.dir === "down" ? "down" : "up";

  const [catalog, sub, mode, term] = await Promise.all([
    getPlanCatalog(),
    db.subscription.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { plan: true, status: true },
    }),
    getStripeMode(),
    planTermState(ctx.organizationId).catch(() => ({ currentInterval: null, scheduledSwitch: null })),
  ]);

  // The pages a custom-plan org owns, for the "add a page" card.
  let customPages: string[] = [];
  if ((sub?.plan ?? "").toUpperCase() === "CUSTOM") {
    const row = await db.syncState
      .findUnique({ where: { key: `orgPages:${ctx.organizationId}` } })
      .catch(() => null);
    try {
      customPages = normalizeCustomPages(row ? (JSON.parse(row.cursor) as string[]) : []);
    } catch {
      customPages = [];
    }
  }

  const plans: UpgradePlan[] = catalog
    .filter((p) => !p.isFree)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      description: p.description,
      priceCents: p.priceCents,
      yearlyPriceCents: p.yearlyPriceCents,
      trialDays: p.trialDays,
      features: p.features,
      highlight: p.highlight,
    }));

  // ?edition=deck (lib/editions): an existing customer adding the Deck Studio is pointed at the plan that carries it.
  const target = params.edition === "deck" ? await editionUpgradeTarget("deck").catch(() => null) : null;
  return (
    <UpgradeResponsive
      focusSlug={target?.slug ?? null}
      focusWords={target ? `Deck Studio comes with ${target.name} — pick it below.` : params.edition === "deck" ? (isEditionOpen("deck") ? "No plan carries the Deck Studio yet — ask us to add it." : "Deck Studio is coming soon — it isn't on sale yet.") : null}
      plans={plans}
      currentPlan={sub?.plan ?? null}
      currentInterval={term.currentInterval}
      scheduledSwitch={term.scheduledSwitch}
      customPages={customPages}
      isOwner={isOwnerRole(ctx.role)}
      checkoutReady={isStripeEnabled()}
      customOffered={customPlanOffered()}
      sandbox={mode === "test"}
      upgradedTo={upgradedTo}
      upgradedDirection={upgradedDirection}
      cancelled={params.checkout === "cancelled"}
      /* TEMP (2026-09-19): the DEV ONLY block — not rendered at all unless the
         server gate is open; handed to the content so it sits inside both
         builds (above the handheld shell it fell under the fixed header). */
      devTools={devSim ? <DevPlanSimulator currentPlan={sub?.plan ?? null} plans={plans} /> : undefined}
    />
  );
}
