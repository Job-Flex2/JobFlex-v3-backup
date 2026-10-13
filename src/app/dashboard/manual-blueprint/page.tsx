// Manual proposal builder — house blueprint skin
// (route: /dashboard/manual-blueprint).
//
// The "Quiet" card-lab variant (/dashboard/manual-blueprint's donor lives at
// /dashboard/manual-quiet) rebuilt in the fleet's own visual system: 2px ink
// frames, hard offset shadows with no blur, near-square corners, caps 900 card
// titles, JetBrains Mono restricted to the drawing-annotation layer, and the
// Motion System "Balanced" entrance cascade.
//
// The donor route is deliberately NOT replaced. The two exist side by side so
// the composition (which was approved) can be judged separately from the skin
// (which is what changed).
//
// Top-level route under /dashboard on purpose: blueprint-shell's pageKey()
// reads the first path segment, so a child route would inherit its parent's
// page key and stylesheet. "manual-blueprint" is deliberately absent from the
// shell's PAGE_STYLES map — this page carries its own self-scoped module
// instead (see the scoping note at the top of manual-blueprint.module.css).
//
// ── NO LONGER A FIXTURE ─────────────────────────────────────────────
// The demo client, the seeded roof job and its five line items are gone. The
// page reads the org's real clients, projects and saved defaults, opens EMPTY,
// and Save / Save & send write through the existing `saveProposal` /
// `sendProposal` actions. Two URL parameters drive it:
//
//   ?client=<id>    the record to file against, the spelling every estimator
//                   already receives from the estimator picker;
//   ?proposal=<id>  an existing proposal to reopen. Written into the URL by the
//                   page itself after the first successful save, so navigating
//                   away and back finds the row instead of a blank sheet.
//   ?project=<id>   the project a NEW proposal is filed under (2026-09-18: the
//                   project page's "New proposal"); its client comes with it
//                   when no ?client= is given.
//
// See manual-blueprint-bridge.ts for what round-trips and what does not.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { NoOrgError, UnauthorizedError, isLimitedRole, isSalesRole, isWorkerRole, requireOrg } from "@/lib/orgContext";
import { isPageLocked } from "@/lib/customPageAccess";
import { canUseDeckEstimator } from "@/lib/deck/access";
import { clientLinksByProposal } from "@/lib/deck/clientLinksServer";
import { clientStanding, standingLine } from "@/lib/deck/clientDesign";
import { agoLabel } from "@/components/v3/proposals-blueprint/proposals-query";
import { ManualBlueprintContent } from "@/components/v3/manual-card-lab/manual-blueprint/manual-blueprint-content";
import { loadManualBuilder } from "@/components/v3/manual-card-lab/manual-blueprint/manual-blueprint-load";
import { readEstimateSeed } from "@/lib/estimateSeed";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Manual proposal",
  description:
    "Build a proposal by hand down one column, in the house blueprint system.",
};

/** First value only — `?client=a&client=b` is a malformed link, not a choice. */
function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ManualBlueprintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let ctx;
  try {
    ctx = await requireOrg();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/auth/login?next=%2Fdashboard%2Fmanual-blueprint");
    }
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }

  const params = await searchParams;
  // Opened from a lead (2026-09-22): the hand-off seed meant for the manual
  // proposal, this company only; null otherwise, never an error.
  const seed = await readEstimateSeed(ctx.organizationId, "manual").catch(() => null);
  const data = await loadManualBuilder({
    organizationId: ctx.organizationId,
    role: ctx.role,
    userId: ctx.user.id,
    clientId: one(params.client),
    proposalId: one(params.proposal),
    projectId: one(params.project),
    seed,
  });

  // A deck made in the Deck Studio opens there again to be changed — for whoever may use the studio (2026-10-12).
  if (data.proposal?.deckDrawing && !isLimitedRole(ctx.role)) {
    data.proposal.deckEditable = await canUseDeckEstimator(ctx.user, ctx.organizationId).catch(() => false);
    // The client's design link on it (2026-10-13), for the drawing card's line.
    const link = (await clientLinksByProposal(ctx.organizationId).catch(() => null))?.get(data.proposal.id);
    if (link) data.proposal.clientDesign = { line: standingLine(link, (iso) => agoLabel(new Date(iso)), { sentAt: link.sentAt, workAt: link.workAt, openedAt: link.openedAt, createdAt: link.createdAt }), standing: clientStanding(link), draftId: link.draftId, unseen: link.unseen };
  }

  // A roof made in the roof estimator opens there again to be rebuilt (owner, 2026-10-13) — for whoever may use
  // the estimator (estimators and managers; the add-on not locked). The estimator itself checks the rest.
  if (data.proposal?.trade === "roof" && !isWorkerRole(ctx.role) && !isSalesRole(ctx.role)) {
    data.proposal.roofEditable = !(await isPageLocked(ctx.organizationId, "roof-estimator").catch(() => true));
  }

  return <ManualBlueprintContent data={data} />;
}
