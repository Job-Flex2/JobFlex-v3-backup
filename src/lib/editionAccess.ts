import "server-only";
// WHAT AN ORGANIZATION MAY OPEN, BY EDITION (2026-10-11, lib/editions): the
// facts are read off the subscription — the plan as stored, whether it has
// lapsed, the catalog plan's feature lines, the custom plan's pages — and the
// pure rules decide. The door a browser chose is a cookie.
import { cookies } from "next/headers";
import { getOrgPlanContext, getPlanCatalog } from "@/lib/planCatalogServer";
import { readCustomPages } from "@/lib/customPageAccess";
import { CUSTOM_PLAN_SLUG } from "@/lib/customPlan";
import { readAccessSubscription } from "@/lib/subscriptionAccess";
import { deckAddonHeld } from "@/lib/deckAddonBilling";
import { DOOR_COOKIE, canSwitch, editionLevel, hasEdition, homeFor, parseDoor, upgradeTargetFrom, workspaceFor, type AccessFacts, type Door, type EditionId, type EditionLevel, type Workspace } from "@/lib/editions";

export async function editionFacts(organizationId: string): Promise<AccessFacts> {
  const [ctx, sub] = await Promise.all([getOrgPlanContext(organizationId), readAccessSubscription(organizationId)]);
  const planSlug = ctx.rawPlan === "NONE" ? null : ctx.rawPlan;
  // A lapsed plan reads as FREE there whatever its name; FREE grants nothing here either.
  const lapsed = ctx.tier === "FREE";
  const [customPages, addon] = await Promise.all([
    planSlug && planSlug.toLowerCase() === CUSTOM_PLAN_SLUG ? readCustomPages(organizationId, planSlug).catch(() => null) : Promise.resolve(null),
    // The Deck Studio add-on (lib/deckAddon): its line on the subscription the organization is on.
    sub?.externalSubId ? deckAddonHeld(organizationId, sub.externalSubId).catch(() => false) : Promise.resolve(false),
  ]);
  return { planSlug, lapsed, features: ctx.plan?.features ?? [], customPages, trialing: !lapsed && sub?.status === "TRIALING", addon };
}

export async function readDoor(): Promise<Door | null> {
  try {
    return parseDoor((await cookies()).get(DOOR_COOKIE)?.value);
  } catch {
    return null;
  }
}

export interface WorkspaceView {
  facts: AccessFacts;
  door: Door | null;
  /** The workspace this request works in. */
  workspace: Workspace;
  /** The deck studio is open to the account. */
  deckAccess: boolean;
  /** How far: "full", "preview" (designs, saves nothing — lib/editions editionLevel) or "none". */
  deckLevel: EditionLevel;
  /** Both workspaces are open, so the switch is drawn. */
  switchable: boolean;
  /** Where a sign-in through the chosen door lands. */
  home: string;
}

export async function workspaceOf(organizationId: string): Promise<WorkspaceView> {
  const [facts, door] = await Promise.all([editionFacts(organizationId), readDoor()]);
  return { facts, door, workspace: workspaceFor(facts, door), deckAccess: hasEdition(facts, "deck"), deckLevel: editionLevel(facts, "deck"), switchable: canSwitch(facts), home: homeFor(facts, door) };
}

/** The catalog plan an existing customer is sent to for an edition (lib/editions upgradeTargetFrom), or null. */
export async function editionUpgradeTarget(edition: EditionId = "deck"): Promise<{ slug: string; name: string; priceCents: number } | null> {
  const plans = await getPlanCatalog().catch(() => []);
  const t = upgradeTargetFrom(plans, edition);
  return t ? { slug: t.slug, name: t.name, priceCents: t.priceCents } : null;
}
