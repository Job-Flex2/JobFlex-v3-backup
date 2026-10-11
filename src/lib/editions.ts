// EDITIONS — the vertical doors of one platform (owner, 2026-10-11: "let's do
// vertical"). A deck builder signs up at the deck door and works in the Deck
// Studio workspace: the deck studio and the office around it — proposals,
// clients, calendar, jobs, crew, money — and nothing of the other trades. It
// is the same account, the same data and the same sign-in as the whole
// platform; the edition is a plan and a view, never a second app. The door a
// browser last chose is a cookie; the workspace an account may use is read
// off its plan. Pure — the server reads the plan, this decides.

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
  /** The catalog plans that ARE this edition (an account on one works in its workspace only). */
  planSlugs: readonly string[];
  /** A plan whose slug starts with this is the edition's too ("deck-studio-yearly"). */
  planPrefix: string | null;
  /** A plan whose feature list says one of these includes the edition as an add-on. */
  featureWords: readonly string[];
  /** The custom plan's page that is the edition (lib/customPlan). */
  customPage: string | null;
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
    planSlugs: [],
    planPrefix: null,
    featureWords: [],
    customPage: null,
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
    planSlugs: ["deck-studio", "deck"],
    planPrefix: "deck-",
    featureWords: ["deck studio", "deck estimator"],
    customPage: "deck-estimator",
    nav: DECK_NAV,
  },
};

export const EDITION_IDS: readonly EditionId[] = ["platform", "deck"];

/** "deck" | "platform" from a cookie or a query value; null for anything else. */
export function parseDoor(v: string | null | undefined): Door | null {
  const s = (v ?? "").trim().toLowerCase();
  return s === "deck" ? "deck" : s === "platform" || s === "jobflex" ? "platform" : null;
}

/** True when the plan slug IS the edition (an account on it works in that workspace only). */
export function isEditionPlan(slug: string | null | undefined, edition: EditionId = "deck"): boolean {
  const e = EDITIONS[edition];
  const s = (slug ?? "").trim().toLowerCase();
  if (!s) return false;
  return e.planSlugs.includes(s) || (!!e.planPrefix && s.startsWith(e.planPrefix));
}

/** What the server reads off an organization's subscription for these rules. */
export interface AccessFacts {
  /** Subscription.plan as stored ("PROFESSIONAL", "deck-studio", "custom"), or null. */
  planSlug: string | null;
  /** The plan is over (lib/planStatus): nothing is granted by it. */
  lapsed: boolean;
  /** The catalog plan's feature lines, as the admin wrote them. */
  features: readonly string[];
  /** The custom plan's pages the organization holds; null on any other plan. */
  customPages: readonly string[] | null;
}

/** The edition is open to the account: its own plan, a plan whose features name it, or the custom plan's page. */
export function hasEdition(facts: AccessFacts, edition: EditionId = "deck"): boolean {
  if (edition === "platform") return true;
  if (facts.lapsed) return false;
  const e = EDITIONS[edition];
  if (isEditionPlan(facts.planSlug, edition)) return true;
  const words = facts.features.map((f) => f.toLowerCase());
  if (words.some((f) => e.featureWords.some((w) => f.includes(w)))) return true;
  return !!e.customPage && !!facts.customPages?.includes(e.customPage);
}

/** The account is the edition and nothing more: its workspace is the only one it has. */
export function editionOnly(facts: AccessFacts, edition: EditionId = "deck"): boolean {
  return !facts.lapsed && isEditionPlan(facts.planSlug, edition);
}

/** Both workspaces are open to the account, so a switch is worth drawing. */
export function canSwitch(facts: AccessFacts): boolean {
  return hasEdition(facts, "deck") && !editionOnly(facts, "deck");
}

/**
 * The workspace a request works in: the edition's when the account is the
 * edition alone; else the door the browser chose when the account may use
 * it; else the whole platform.
 */
export function workspaceFor(facts: AccessFacts, door: Door | null): Workspace {
  if (editionOnly(facts, "deck")) return "deck";
  if (door === "deck" && hasEdition(facts, "deck")) return "deck";
  return "platform";
}

/**
 * Where a sign-in lands: the deck door opens the studio even without the
 * plan — the studio's page then makes the offer — and the platform door the
 * overview; an account that is the edition alone always lands in the studio.
 */
export function homeFor(facts: AccessFacts | null, door: Door | null): string {
  if (facts && editionOnly(facts, "deck")) return EDITIONS.deck.homeHref;
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

/**
 * THE PLAN AN EXISTING CUSTOMER UPGRADES TO for an edition (owner,
 * 2026-10-11: no separate add-on — the top plan carries "Deck Studio" as a
 * feature line): the dearest plan on sale whose features name the edition
 * and which is not the edition's own plan; else the edition's own plan when
 * it is on sale; else nothing to point at.
 */
export function upgradeTargetFrom<P extends { slug: string; priceCents: number; features: readonly string[]; active: boolean }>(plans: readonly P[], edition: EditionId = "deck"): P | null {
  const e = EDITIONS[edition];
  const onSale = plans.filter((p) => p.active);
  const names = (p: P) => p.features.some((f) => e.featureWords.some((w) => f.toLowerCase().includes(w)));
  const tops = onSale.filter((p) => names(p) && !isEditionPlan(p.slug, edition)).sort((a, b) => b.priceCents - a.priceCents);
  if (tops[0]) return tops[0];
  return onSale.find((p) => isEditionPlan(p.slug, edition)) ?? null;
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
