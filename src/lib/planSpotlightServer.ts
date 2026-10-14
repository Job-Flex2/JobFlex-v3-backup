// The company's own spotlight (lib/planSpotlight), server side: the tool its
// signup carried (`landingTool:<org>` in SyncState — written by
// actions/signupCheckout at creation, no schema change) or, failing that, the
// landing trade the organization already records. Read by the Subscription
// and Upgrade pages so the plan the roofer came for stays marked after signup.

import { db } from "@/lib/db";
import { parseSpotlightTool, spotlightFromTrade, type SpotlightTool } from "@/lib/planSpotlight";

export const SPOTLIGHT_KEY = (organizationId: string) => `landingTool:${organizationId}`;

export async function orgSpotlight(organizationId: string): Promise<SpotlightTool | null> {
  const [row, org] = await Promise.all([
    db.syncState.findUnique({ where: { key: SPOTLIGHT_KEY(organizationId) }, select: { cursor: true } }).catch(() => null),
    db.organization.findUnique({ where: { id: organizationId }, select: { landingIndustry: true } }).catch(() => null),
  ]);
  return parseSpotlightTool(row?.cursor) ?? spotlightFromTrade(org?.landingIndustry) ?? null;
}
