import { redirect } from "next/navigation";
import { FREE_PLAN_NAME, onFreePlan } from "@/lib/freePlan";
import type { Route } from "next";
import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ROLE_ROUTE_GATES, isPathAllowed } from "@/lib/roleRoutes";
import { getBlockedCustomPages } from "@/lib/customPageAccess";
import { UpgradeGate } from "@/components/v3/upgrade-gate/upgrade-gate";
import { CustomGateSwap } from "@/components/v3/upgrade-gate/custom-gate-swap";
import { isCustomBlockedPath } from "@/lib/customPlan";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { CommandK } from "@/components/layout/CommandK";
import { PlanLimitDialog } from "@/components/billing/PlanLimitDialog";
import { LeadOfferPopup } from "@/components/leads/LeadOfferPopup";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { SupportWidget } from "@/components/v3/support-widget/support-widget";
import { SessionProvider } from "@/components/providers/SessionProvider";
import { getBadgeCounts } from "@/lib/badgeCounts";
import { getNavLimitCounters } from "@/lib/navLimits";
import { getPlanDisplayName } from "@/lib/planCatalogServer";
import { DashboardAnnouncementDismiss } from "./announcement-dismiss";
import { trialView } from "@/lib/cardlessTrial";
import { trialDismissCookie, trialNoticeDismissed } from "@/lib/trialNotice";
import { Sprite } from "@/components/v3/blueprint-shell/sprite";
import { TrialRibbon } from "@/components/v3/trial-card/trial-card";
import { PaymentRibbon } from "@/components/v3/payment-ribbon/payment-ribbon";
import { TrafficContext } from "@/components/providers/traffic-context";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  const activeOrgId = session.user.activeOrgId ?? null;

  const [memberships, subscription, announcements] = await Promise.all([
    db.membership.findMany({
      where: { userId: session.user.id },
      include: { organization: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    activeOrgId
      ? db.subscription.findUnique({
          where: { organizationId: activeOrgId },
          select: { plan: true, status: true, provider: true },
        })
      : Promise.resolve(null),
    activeOrgId
      ? db.announcement.findMany({
          where: {
            AND: [
              { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
              {
                OR: [
                  { organizationId: activeOrgId, scope: "ORG" },
                  { scope: "PLATFORM" },
                ],
              },
            ],
          },
          orderBy: [{ scope: "desc" }, { priority: "desc" }, { createdAt: "desc" }],
          take: 6,
        })
      : db.announcement.findMany({
          where: {
            scope: "PLATFORM",
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          orderBy: { createdAt: "desc" },
          take: 6,
        }),
  ]);

  const membershipItems = memberships.map((m) => ({
    organizationId: m.organizationId,
    organizationName: m.organization.name,
    role: m.role,
    current: m.organizationId === activeOrgId,
  }));

  // Active-org role drives the limited-role experiences (INSTALLER / SALES /
  // ESTIMATOR): a restricted nav and no org-wide manager tools (global search,
  // notifications). Office roles get the full dashboard.
  const activeRole =
    membershipItems.find((m) => m.current)?.role ?? membershipItems[0]?.role ?? null;
  const isWorker = activeRole === "INSTALLER";
  const routeGate = activeRole ? ROLE_ROUTE_GATES[activeRole] : undefined;
  const isLimited = Boolean(routeGate);
  // Lead pop-up: the OWNER's, and only theirs. Managers and sales can still see
  // and action every lead on the Leads page — this is the interruption, not the
  // permission (owner's call, 2026-08-27; the email follows the same rule, see
  // lib/notify's ownerEmailFor).
  const canHandleLeads = Boolean(activeOrgId) && activeRole === "OWNER";

  // Server-side limited-role route-gate (defense-in-depth behind the middleware).
  // Role comes from the DB above, and the path from the middleware-set header,
  // so this fails CLOSED even if the middleware's JWT decode threw and let a
  // limited role through to a manager route.
  if (routeGate) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    if (pathname && !isPathAllowed(routeGate, pathname)) redirect(routeGate.home as Route);
  }

  // THE CUSTOM PLAN'S PAGE GATE — the classic tree's copy of the check the
  // blueprint layout carries, because this group is a separate branch of app/
  // and inherits nothing from it. Same shape as the role gate above: plan from
  // the DB, path from the middleware-set header, fail-closed, bounce to
  // Overview. The classic sidebar's legacy estimator paths
  // (/dashboard/advanced-ai/roof, /fence/studio) fall under the
  // /dashboard/advanced-ai prefix, so they are covered by the same list.
  const lockedPages = activeOrgId ? await getBlockedCustomPages(activeOrgId) : null;
  // Renders the upgrade offer AT the blocked URL (not a redirect) — same
  // choice as the blueprint layout, see the note there.
  let customGate: React.ReactNode = null;
  if (lockedPages?.length) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    if (pathname && isCustomBlockedPath(lockedPages, pathname)) {
      customGate = <UpgradeGate pathname={pathname} locked={lockedPages} isOwner={activeRole === "OWNER"} />;
    }
  }

  // Workers see a read-only slice — no create surfaces, so no quota counters.
  const [badgeCounts, navLimits] = activeOrgId
    ? await Promise.all([
        getBadgeCounts(activeOrgId, session.user.id, activeRole),
        isWorker ? Promise.resolve({}) : getNavLimitCounters(activeOrgId),
      ])
    : [{}, {}];

  // The sidebar's limit pill names the plan by its catalog name, never the slug.
  // An ended subscription is the Free plan (lib/freePlan).
  const planName =
    subscription && subscription.provider !== "MANUAL" && onFreePlan(subscription)
      ? FREE_PLAN_NAME
      : subscription?.plan
        ? await getPlanDisplayName(subscription.plan)
        : undefined;
  // The card-less trial's ribbon — the blueprint layout's, for this tree's pages.
  const trial = activeOrgId ? await trialView(activeOrgId).catch(() => null) : null;
  // Dismissed on this step (lib/trialNotice): left out, not painted and removed.
  const showTrial =
    trial && activeOrgId && !trialNoticeDismissed(trial, (await cookies()).get(trialDismissCookie(activeOrgId))?.value) ? trial : null;

  return (
    <SessionProvider>
      {/* Role, plan and org id for the error reporter ($exception) — nothing personal. */}
      <TrafficContext role={activeRole} plan={subscription?.plan ?? null} organizationId={activeOrgId} userId={session.user.id} />
      <div className="flex">
        <Sidebar
          role={activeRole}
          badges={badgeCounts}
          limits={navLimits}
          plan={planName}
          lockedHrefs={lockedPages ?? undefined}
        />
        <main className="flex-1 min-w-0 min-h-dvh pb-24">
          <Topbar
            user={{ name: session.user.name, email: session.user.email ?? "" }}
            memberships={membershipItems}
            plan={planName}
            isWorker={isWorker}
            limited={isLimited}
          />
          <div className="px-6 lg:px-10 py-8 max-w-[1400px] mx-auto pb-24 md:pb-8">
            {showTrial && activeOrgId && <TrialRibbon view={showTrial} isOwner={activeRole === "OWNER"} orgId={activeOrgId} />}
            {/* A declined renewal Stripe is retrying (components/v3/payment-ribbon). */}
            {!trial && ["PAST_DUE", "UNPAID"].includes(subscription?.status ?? "") && <PaymentRibbon isOwner={activeRole === "OWNER"} />}
            <DashboardAnnouncementDismiss
              announcements={announcements.map((a) => ({
                id: a.id,
                title: a.title,
                body: a.body,
                priority: a.priority,
                createdAt: a.createdAt,
                expiresAt: a.expiresAt,
              }))}
            />
            {customGate ??
              (lockedPages?.length ? (
                // Client half of the gate: a layout only re-renders on a hard
                // load, so soft navigation needs the swap — see its header.
                <CustomGateSwap locked={lockedPages} isOwner={activeRole === "OWNER"}>
                  {children}
                </CustomGateSwap>
              ) : (
                children
              ))}
          </div>
        </main>
        {!isLimited && <CommandK />}
        {canHandleLeads && <LeadOfferPopup />}
        <PlanLimitDialog />
        {/* This shell has no icon sprite of its own; the trial ribbon's cross
            draws from the blueprint one. After the page, so a page that mounts
            its own sprite keeps its symbols (the first id in the document wins). */}
        {showTrial && <Sprite />}
        {/* The support composer. It was mounted in the two blueprint shells
            only, so ~50 routes had no Help control at all — every billing and
            settings surface among them, which is where the composer's Billing
            and Account categories point. Its launchers: the floating plate
            above 860px, the topbar button between 768 and 860, and the tab
            bar's More drawer below 768, where this group's bottom-right corner
            already belongs to the create button and the tab bar. */}
        <SupportWidget signedIn />
        <div className="md:hidden">
          <MobileTabBar role={activeRole} badges={badgeCounts} lockedHrefs={lockedPages ?? undefined} />
        </div>
      </div>
    </SessionProvider>
  );
}
