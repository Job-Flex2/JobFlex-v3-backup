// EDITIONS — the vertical doors of one platform (owner, 2026-10-11: "let's do
// vertical"). A deck builder signs up at the deck door and works in the Deck
// Studio workspace: the deck studio and the office around it — proposals,
// clients, calendar, jobs, crew, money — and nothing of the other trades. It
// is the same account, the same data and the same sign-in as the whole
// platform; the edition is a view, never a second app. The door a browser
// last chose is a cookie; whether the account holds the studio is read off its
// subscription (the trial, the Deck Studio plan, the Advanced plan, the add-on,
// a grant) and the asking user. Pure — the server reads the facts, this decides.

export type EditionId = "platform" | "deck";
export type Door = EditionId;
export type Workspace = EditionId;

/** The door a browser last chose, remembered a year. */
export const DOOR_COOKIE = "jf_door";
export const DOOR_MAX_AGE_S = 60 * 60 * 24 * 365;

export interface Edition {
  id: EditionId;
  /** "JobFlex Deck Studio" */
  name: string;
  /** "Deck Studio" */
  short: string;
  tagline: string;
  /** The trade its sign-up pre-selects (lib/tradeTypes), null for the whole platform. */
  industry: "decking" | null;
  /** Its landing page and where a sign-in lands. */
  landingPath: string;
  homeHref: string;
  /** The sidebar rows of its workspace; null = everything. */
  nav: readonly string[] | null;
}

const DECK_NAV: readonly string[] = [
  "/dashboard",
  "/dashboard/proposals",
  "/dashboard/clients",
  "/dashboard/leads",
  "/dashboard/projects",
  "/dashboard/crm",
  "/dashboard/calendar",
  "/dashboard/booking",
  "/dashboard/jobs",
  "/dashboard/workers",
  "/dashboard/hire",
  "/dashboard/company",
  "/dashboard/financials",
  "/dashboard/service-plans",
  "/dashboard/subscription",
  "/dashboard/deck-estimator",
  "/dashboard/deck-estimator/inventory",
  "/dashboard/phone",
  // Texting left Settings for its own page (2026-10-16); the studio had it under Settings, so it keeps it.
  "/dashboard/texting",
  "/dashboard/messages",
  "/dashboard/reviews",
  "/dashboard/referrals",
  "/dashboard/reports",
  "/dashboard/settings",
];

export const EDITIONS: Record<EditionId, Edition> = {
  platform: {
    id: "platform",
    name: "JobFlex",
    short: "JobFlex",
    tagline: "The whole business — every trade's estimator and the office",
    industry: null,
    landingPath: "/",
    homeHref: "/dashboard",
    nav: null,
  },
  deck: {
    id: "deck",
    name: "JobFlex Deck Studio",
    short: "Deck Studio",
    tagline: "Design the deck in 3D, check it to the state's code, print the permit set, send the proposal — with the office included",
    industry: "decking",
    landingPath: "/deck",
    homeHref: "/dashboard/deck-estimator",
    nav: DECK_NAV,
  },
};

export const EDITION_IDS: readonly EditionId[] = ["platform", "deck"];

/**
 * IS THE EDITION OPEN? (owner, 2026-10-11: "make that studio coming soon".) While an edition is NOT open nothing
 * sells it and nothing opens it: the landing, the sign-up, the upgrade page and the studio's own page say it is
 * coming soon, a "deck" door reads as no door, and only the platform admins (lib/fullAccess) work in it.
 * OPENED 2026-10-19 (owner: "now you can make deck estimator available to users").
 */
export const EDITION_OPEN: Record<EditionId, boolean> = { platform: true, deck: true };
export const isEditionOpen = (edition: EditionId): boolean => EDITION_OPEN[edition];

/** "deck" | "platform" from a cookie or a query value; null for anything else —
 *  and for "deck" while the Deck Studio is coming soon (no door to it yet). */
export function parseDoor(v: string | null | undefined, deckOpen: boolean = EDITION_OPEN.deck): Door | null {
  const s = (v ?? "").trim().toLowerCase();
  return s === "deck" ? (deckOpen ? "deck" : null) : s === "platform" || s === "jobflex" ? "platform" : null;
}

/** What the server reads off an organization's subscription — and the asking user — for these rules. */
export interface AccessFacts {
  /** The plan is over (lib/planStatus — Free, cancelled, an ended trial): no paid plan runs. */
  lapsed: boolean;
  /** The plan is a running free trial (lib/planStatus: TRIALING and not lapsed). */
  trialing?: boolean;
  /** The Deck Studio add-on is on the subscription (lib/deckAddon addonHeld). */
  addon?: boolean;
  /** A Custom plan whose bought pages include "deck-estimator" (lib/customPlan) — the add-on, bought as a page. */
  customDeckPage?: boolean;
  /** The Deck Studio plan itself (lib/customPlan DECK_PLAN_SLUG), running. */
  deckPlan?: boolean;
  /** The Advanced plan (slug "enterprise", sold as "Advanced" — lib/planCatalog planDisplayName), running. */
  advancedPlan?: boolean;
  /** A complimentary plan (a grant, provider MANUAL — lib/planGrant) that has not ended. */
  granted?: boolean;
  /** The asking user sees everything in this organization (lib/fullAccess hasFullAccess — a platform admin). */
  fullAccess?: boolean;
}

/**
 * WHO HOLDS THE DECK STUDIO (owner, 2026-10-20 — CLAUDE.md):
 *   1. the 7-day free trial, without the add-on;
 *   2. the Deck Studio plan ($45/month, its own card on the pricing page — lib/customPlan DECK_PLAN_SLUG) and the
 *      Advanced plan;
 *   3. on any other plan — Starter, Professional, Custom, monthly or yearly — the $45/month add-on ($450 on a yearly
 *      plan, lib/deckAddon). A Custom plan whose pages include "deck-estimator" bought it as a page: that counts as
 *      the add-on, with no second line;
 *   4. a platform admin (hasFullAccess) and a complimentary grant, always.
 */
export function hasEdition(facts: AccessFacts, edition: EditionId = "deck", open: boolean = isEditionOpen(edition)): boolean {
  if (edition === "platform") return true;
  if (facts.fullAccess) return true;
  if (!open) return false;
  if (facts.granted) return true;
  if (facts.lapsed) return false;
  return !!facts.trialing || !!facts.deckPlan || !!facts.advancedPlan || !!facts.addon || !!facts.customDeckPage;
}

/** The account is the Deck Studio plan and nothing more: the studio's workspace is the only one it has. */
export function editionOnly(facts: AccessFacts): boolean {
  return !facts.lapsed && !!facts.deckPlan && !facts.fullAccess;
}

/**
 * HOW FAR THE STUDIO OPENS: "full" — the account holds it (hasEdition); "preview" — everyone else, an ended trial
 * and the Free plan included: the studio designs, and saves, sends and prints nothing; a saved deck opens to look at
 * and to print, not to change; "none" — the edition is coming soon: the studio's coming-soon page.
 */
export type EditionLevel = "full" | "preview" | "none";
export function editionLevel(facts: AccessFacts, edition: EditionId = "deck", open: boolean = isEditionOpen(edition)): EditionLevel {
  if (hasEdition(facts, edition, open)) return "full";
  return open ? "preview" : "none";
}

/** Both workspaces are open to the account, so a switch is worth drawing. */
export function canSwitch(facts: AccessFacts, open: boolean = isEditionOpen("deck")): boolean {
  return hasEdition(facts, "deck", open) && !editionOnly(facts);
}

/** The workspace a request works in: the studio's on the Deck Studio plan, or through the deck door when the
 *  account holds the studio; else the whole platform. */
export function workspaceFor(facts: AccessFacts, door: Door | null, open: boolean = isEditionOpen("deck")): Workspace {
  if (editionOnly(facts)) return "deck";
  return door === "deck" && hasEdition(facts, "deck", open) ? "deck" : "platform";
}

/** Where a sign-in lands: the deck door opens the studio (its page makes the offer to an account without it), the
 *  platform door the overview. */
export function homeFor(door: Door | null): string {
  return door === "deck" ? EDITIONS.deck.homeHref : EDITIONS.platform.homeHref;
}

/** A sidebar row stays in the workspace: everything on the platform; the edition's own list in its workspace. */
export function navAllowed(workspace: Workspace, href: string): boolean {
  const list = EDITIONS[workspace].nav;
  if (!list) return true;
  const path = href.split("?")[0];
  return list.some((h) => path === h || (h !== "/dashboard" && path.startsWith(h + "/")));
}

/** The sidebar rows that stop saying "Soon" once the account holds the edition. */
export function unlockedByEdition(edition: EditionId): readonly string[] {
  return edition === "deck" ? ["/dashboard/deck-estimator", "/dashboard/deck-estimator/inventory"] : [];
}

/** The sign-up link of a door, with the landing's own parameters kept. */
export function registerHref(edition: EditionId, extra: Record<string, string | undefined> = {}): string {
  const e = EDITIONS[edition];
  const q = new URLSearchParams();
  if (e.industry) q.set("industry", e.industry);
  if (edition !== "platform") q.set("edition", edition);
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  const s = q.toString();
  return `/auth/register${s ? `?${s}` : ""}`;
}
