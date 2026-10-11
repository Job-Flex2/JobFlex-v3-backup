import "server-only";
// WHAT LEADS NEED (owner, 2026-10-07): the two-step sign-up takes no address,
// so a new shop cannot be matched to homeowner jobs until it adds its address
// (geocoded on save) and its specialties — the Lead Center's trade profile —
// on the company page. This is the one reading of that gap, asked by the daily
// reminder (lib/leadSetupReminders); the dashboard's own "Complete your
// profile" banner (components/dashboard/CompleteLeadProfileBanner) reads the
// same fields its own way.
import { db } from "@/lib/db";
import { parseTradeTypes } from "@/lib/tradeTypes";

export interface LeadSetupNeed {
  needsAddress: boolean;
  needsTrades: boolean;
  /** The company name is still the passwordless sign-up's stand-in (lib/orgName, 2026-10-10). */
  needsName: boolean;
  needs: boolean;
}

export function leadSetupNeedOf(org: { address: string | null; lat: number | null; lng: number | null; tradeTypesJson: string | null }, nameUnset = false): LeadSetupNeed {
  const needsAddress = !org.address?.trim() || org.lat == null || org.lng == null;
  const needsTrades = parseTradeTypes(org.tradeTypesJson).length === 0;
  return { needsAddress, needsTrades, needsName: nameUnset, needs: needsAddress || needsTrades || nameUnset };
}

/** The shop's gap, or null when the shop is unknown (or the read fails: no ribbon is better than a crash). */
export async function leadSetupNeed(orgId: string): Promise<LeadSetupNeed | null> {
  try {
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { address: true, lat: true, lng: true, tradeTypesJson: true } });
    return org ? leadSetupNeedOf(org) : null;
  } catch {
    return null;
  }
}
