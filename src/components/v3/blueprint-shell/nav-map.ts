// The blueprint navigation map — ONE source of truth for every shell that
// draws the nav: the desktop sidebar (blueprint-shell/sidebar.tsx) and the
// mobile hamburger drawers on both handheld surfaces.
//
// Extracted from sidebar.tsx on 2026-07-29. Until then the mobile drawers read
// a second, href-less copy of this list out of mobile-v2/mobile-data.ts, which
// is why every mobile nav item was a dead `href="#"` and the drawer could not
// change pages. Two lists meant two truths; there is now one.
//
// Plain data + a pure function, no "use client" — safe to import from a server
// component, a client component or a data module.
//
// Source of the ordering and grouping: design-system.md → "Sidebar navigation
// map". `href: "#"` marks a surface with no page yet; those stay deliberately
// dead rather than routing somewhere that 404s.

import { ROLE_ROUTE_GATES, isPathAllowed } from "@/lib/roleRoutes";
import { isCustomBlockedPath } from "@/lib/customPlan";
import { isHiddenHref } from "@/lib/earlyAccess";

export type NavItem = {
  label: string;
  icon: string;
  href: string;
  /** Custom-plan lock: the org's plan does not include this page. The item is
   *  still DRAWN (dimmed, with a padlock) and still navigates — the layout
   *  renders the upgrade offer at that URL — so the locked state is an ad for
   *  the page, not a hole where it used to be (owner's call, 2026-08-31). */
  locked?: boolean;
  /** Rows that fold under this one — the estimator's inventory (2026-09-20).
   *  Drawn indented beneath the parent with a chevron to fold them; the
   *  handheld drawer and the palette list them flat after the parent. */
  children?: NavItem[];
  /** Coming soon (2026-10-04): the row is shown with a "Soon" mark; the page
   *  itself says so to everyone but the admins who are testing it. */
  soon?: boolean;
};
export type NavSection = { label: string; items: NavItem[] };

/** A section's rows in reading order, children after their parent. */
export function flattenNavItems(items: readonly NavItem[]): NavItem[] {
  return items.flatMap((it) => [it, ...(it.children ?? [])]);
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Work",
    items: [
      { label: "Overview", icon: "i-grid", href: "/dashboard" },
      { label: "Proposals", icon: "i-file", href: "/dashboard/proposals" },
      { label: "Clients", icon: "i-users", href: "/dashboard/clients" },
      { label: "Leads", icon: "i-target", href: "/dashboard/leads" },
      { label: "Projects", icon: "i-folder", href: "/dashboard/projects" },
      { label: "CRM", icon: "i-crm", href: "/dashboard/crm" },
    ],
  },
  {
    label: "Delivery",
    items: [
      { label: "Calendar", icon: "i-cal", href: "/dashboard/calendar" },
      // Online booking (2026-09-23): the public /book/<slug> page's office side.
      { label: "Online booking", icon: "i-cal", href: "/dashboard/booking" },
      { label: "Jobs", icon: "i-jobs", href: "/dashboard/jobs" },
      { label: "Workers", icon: "i-hardhat", href: "/dashboard/workers" },
      { label: "Hire", icon: "i-userplus", href: "/dashboard/hire" },
      { label: "Company", icon: "i-building", href: "/dashboard/company" },
    ],
  },
  {
    label: "Money",
    items: [
      { label: "Financials", icon: "i-bank", href: "/dashboard/financials" },
      // Memberships (2026-09-22): the plans a shop sells, its members, the
      // visits and the bills they bring.
      { label: "Service plans", icon: "i-check", href: "/dashboard/service-plans" },
      // /dashboard/subscription IS the blueprint page now (owner promoted the
      // port 2026-08-12; the classic "Well-Kept Ledger" donor was deleted with
      // it and this URL taken over). The responsive staging build — desktop
      // fixture above 768px, handheld on REAL data at or below — still stands
      // at /dashboard/subscription-blueprint until its halves are folded into
      // the promoted route; nothing links to it.
      //
      // OWNER-only, enforced by OWNER_ONLY_HREFS below (2026-08-17). The gap
      // this comment used to record — "the blueprint shell filters NAV_SECTIONS
      // by nothing at all" — is closed: navSectionsFor() is now the one rule
      // both shells and the palette read. Financials, one line above, is NOT
      // owner-only: the production sidebar shows it to every office role.
      { label: "Subscription", icon: "i-card", href: "/dashboard/subscription" },
    ],
  },
  {
    label: "Automation",
    items: [
      // No "Estimators" item, deliberately: picking an engine is done in the
      // topbar's New Estimate dialog (estimators-blueprint/estimator-picker),
      // reachable from every page, so a nav entry would be a second door to a
      // decision you make on your way somewhere else. The engines themselves
      // keep their items below.
      { label: "Smart Proposal", icon: "i-bulb", href: "/dashboard/advanced-ai" },
      // Each estimator folds its own inventory under it (owner, 2026-10-10:
      // "a roofer doesn't have to see the other inventories"). The three
      // shared one page with a trade switch from 2026-09-29; before that they
      // folded here too (2026-09-20). Addresses: lib/inventory INVENTORY_PATH.
      {
        label: "Roof estimator",
        icon: "i-roof",
        href: "/dashboard/roof-estimator",
        children: [{ label: "Roofing inventory", icon: "i-folder", href: "/dashboard/roof-estimator/inventory" }],
      },
      {
        label: "Fence estimator",
        icon: "i-fence",
        href: "/dashboard/fence-estimator",
        children: [{ label: "Fence inventory", icon: "i-folder", href: "/dashboard/fence-estimator/inventory" }],
      },
      // Added 2026-08-22 with the Video estimator port. Its position — directly
      // after the other two engines — is the donor's own
      // (jobflex-videoestimator-blueprint.html sidebar). Not in ESTIMATOR's
      // ROLE_NAV plan below: that plan mirrors the production sidebar, which
      // does not list this surface, so adding it here would be inventing a
      // grant rather than reflecting one.
      { label: "Video estimator", icon: "i-video", href: "/dashboard/video-estimator" },
      // Added 2026-09-15; the heat pump glyph on 2026-09-18 (until then the
      // item asked for `i-bolt`, which only the Financials sprite carries, so
      // the sidebar drew a blank beside it on every other page).
      {
        label: "HVAC estimator",
        icon: "i-heatpump",
        href: "/dashboard/hvac-estimator",
        // The HVAC service menu is a tab of it.
        children: [{ label: "HVAC inventory", icon: "i-folder", href: "/dashboard/hvac-estimator/inventory" }],
      },
      // The deck estimator (2026-10-04): marked Coming soon for everyone,
      // open to admins for testing (lib/deck/access).
      {
        label: "Deck estimator",
        icon: "i-deck",
        href: "/dashboard/deck-estimator",
        soon: true,
        // Its inventory (the deck price book and stock, 2026-10-10) folds under it like the others'; the same Coming-soon door guards it.
        children: [{ label: "Deck inventory", icon: "i-folder", href: "/dashboard/deck-estimator/inventory", soon: true }],
      },
      { label: "Phone", icon: "i-phone", href: "/dashboard/phone" },
      { label: "Messages", icon: "i-msg", href: "/dashboard/messages" },
      { label: "Reviews", icon: "i-thumb", href: "/dashboard/reviews" },
      { label: "Trade board", icon: "i-board", href: "/dashboard/trade" },
      { label: "Referrals", icon: "i-gift", href: "/dashboard/referrals" },
      { label: "Reports", icon: "i-chart", href: "/dashboard/reports" },
    ],
  },
];

/**
 * The standalone handheld review URLs are the same SURFACES as their
 * /dashboard counterparts, so they must light the same nav item. Without this
 * the drawer opens with nothing active on /mobile-v2 and the sliding indicator
 * plate has no link to measure itself against.
 */
const SURFACE_ALIASES: Record<string, string> = {
  "/mobile-v2": "/dashboard",
  "/mobile-proposals-v2": "/dashboard/proposals",
  "/mobile-clients-v2": "/dashboard/clients",
  "/mobile-leads-v2": "/dashboard/leads",
  "/mobile-projects-v2": "/dashboard/projects",
  "/mobile-crm-v2": "/dashboard/crm",
  "/mobile-calendar-v2": "/dashboard/calendar",
  "/mobile-jobs-v2": "/dashboard/jobs",
  "/mobile-workers-v2": "/dashboard/workers",
  "/mobile-hire-v1": "/dashboard/hire",
  "/mobile-company-v2": "/dashboard/company",
  "/mobile-financials-v2": "/dashboard/financials",
  "/mobile-advanced-ai-v2": "/dashboard/advanced-ai",
  "/mobile-roof-estimator-v2": "/dashboard/roof-estimator",
  "/mobile-fence-estimator-v2": "/dashboard/fence-estimator",
  "/mobile-phone-v2": "/dashboard/phone",
  "/mobile-messages-v2": "/dashboard/messages",
  "/mobile-reviews-v2": "/dashboard/reviews",
  "/mobile-trade-v2": "/dashboard/trade",
  "/mobile-referrals-v2": "/dashboard/referrals",
  "/mobile-reports-v2": "/dashboard/reports",
};

// ── ROLE FILTER ─────────────────────────────────────────────────────────────
// Added 2026-08-17. Until now the blueprint shell drew NAV_SECTIONS whole for
// everybody, so an INSTALLER invited as a field worker got the full 22-item
// sidebar and a drawer to match — every link a route their gate bounces.
//
// ONE RULE, THREE SHELLS. The desktop sidebar, the handheld drawer and the
// command palette all call navSectionsFor(); nothing filters on its own. Two
// filters would be two truths, which is the same mistake the href-less second
// nav list made before this module existed.
//
// SOURCE OF THE RULES, both halves:
//   · WHICH surfaces  — @/lib/roleRoutes ROLE_ROUTE_GATES, the same allow-list
//     the middleware and the (dashboard) layout enforce. Deriving from it (not
//     restating it) is what makes "the nav never shows a link the route-gate
//     would bounce" true by construction rather than by review.
//   · ORDER, GROUPING and LABELS — components/layout/Sidebar.tsx, the
//     production sidebar's WORKER_GROUPS / SALES_GROUPS / ESTIMATOR_GROUPS.
//     A worker's Calendar is titled "Schedule" there, so it is here.
//
// Nothing is invented: ROLE_NAV may only ever narrow. Any href in a plan that
// the role's gate does not allow is DROPPED rather than granted — see the
// filter in navSectionsFor.

/** Items only the organisation OWNER may see, whatever else their role allows.
 *  Matches the production sidebar, which drops Subscription for every non-owner
 *  office role; the page itself re-checks with isOwnerRole. */
const OWNER_ONLY_HREFS = new Set<string>([
  "/dashboard/subscription",
  "/dashboard/subscription-blueprint",
]);

/** A limited role's nav, as section titles plus the hrefs they hold. */
type RoleNavPlan = { label: string; hrefs: string[] }[];

const ROLE_NAV: Record<string, RoleNavPlan> = {
  // Field workers: their jobs and their schedule, plus the thread back to the
  // office. Read-only surfaces — every create path is elsewhere.
  INSTALLER: [
    {
      label: "Your work",
      hrefs: ["/dashboard/jobs", "/dashboard/calendar", "/dashboard/messages"],
    },
  ],
  // Sales reps: the pipeline slice.
  SALES: [
    {
      label: "Pipeline",
      hrefs: [
        "/dashboard/leads",
        "/dashboard/clients",
        "/dashboard/proposals",
        "/dashboard/crm",
      ],
    },
    {
      label: "Day to day",
      hrefs: ["/dashboard/calendar", "/dashboard/messages", "/dashboard/phone"],
    },
  ],
  // Estimators: proposals plus the estimating engines.
  ESTIMATOR: [
    { label: "Estimating", hrefs: ["/dashboard/proposals", "/dashboard/projects"] },
    {
      label: "Automation",
      // Roof and Fence are listed because the production sidebar lists them for
      // this role. They used to be listed and then DROPPED by the gate filter
      // below — the blueprint port had moved both surfaces off
      // /dashboard/advanced-ai/* (which ESTIMATOR holds) onto their own
      // top-level routes (which it did not). That gap was reconnected in
      // @/lib/roleRoutes on 2026-08-18, so these two now survive the filter and
      // the estimator sees the engines its role is named after.
      hrefs: [
        "/dashboard/advanced-ai",
        "/dashboard/roof-estimator",
        "/dashboard/fence-estimator",
        "/dashboard/hvac-estimator",
        "/dashboard/deck-estimator",
        "/dashboard/messages",
      ],
    },
  ],
};

/** Per-role label overrides, from the production sidebar's own wording. */
const ROLE_LABELS: Record<string, Record<string, string>> = {
  INSTALLER: { "/dashboard/calendar": "Schedule" },
};

/** Every item in the master map, by href — the icon and default label source. */
const ITEM_BY_HREF: Record<string, NavItem> = {};
for (const section of NAV_SECTIONS) {
  for (const item of section.items) {
    if (item.href !== "#") ITEM_BY_HREF[item.href] = item;
  }
}

/**
 * True when `role` may open `href`. The route allow-list decides for the three
 * limited roles; owner-only items are dropped for everyone else. Office roles
 * (OWNER / ADMIN / MANAGER and the legacy ACCOUNTANT / USER) have no gate, so
 * everything else is open to them — the same deny-list shape as
 * orgContext's isOwnerOrManager.
 *
 * Use it for anything that NAVIGATES but is not a nav item: the topbar's New
 * Estimate engines, the palette's Create rows.
 */
export function canOpen(
  role: string | null | undefined,
  href: string,
  /** Custom-plan blocked hrefs (useNavLocked). Optional so the review URLs and
   *  older callers keep their unfiltered nav; the layouts always pass it. */
  locked?: readonly string[],
): boolean {
  if (href === "#") return false;
  if (OWNER_ONLY_HREFS.has(href) && role !== "OWNER") return false;
  // The custom plan's gate cuts ACROSS roles: an owner on the custom plan
  // still cannot open a page the plan did not buy. Same prefix rule the
  // layout's redirect uses, so the nav never draws a link the server bounces.
  if (locked && isCustomBlockedPath(locked, href.split("?")[0])) return false;
  const gate = role ? ROLE_ROUTE_GATES[role] : undefined;
  if (!gate) return true;
  // Strip a query string before matching: the gate reasons about pathnames.
  return isPathAllowed(gate, href.split("?")[0]);
}

/**
 * True for the roles that carry a route gate — INSTALLER, SALES, ESTIMATOR.
 * Asked of ROLE_ROUTE_GATES rather than written out again, so a role that gains
 * or loses a gate does not need a second edit here.
 *
 * The shell footer's sign out is drawn for exactly these roles (owner's call,
 * 2026-08-18): their allow-lists keep them off the account and settings pages
 * that carry the office roles' own sign out, so the footer is the only place
 * they can leave the app from.
 */
export function isLimitedRole(role: string | null | undefined): boolean {
  return !!role && !!ROLE_ROUTE_GATES[role];
}

/**
 * The nav this role should see. Limited roles get their own grouping from the
 * production sidebar, intersected with their route gate; office roles get the
 * full map minus anything owner-only.
 */
export function navSectionsFor(
  role: string | null | undefined,
  locked?: readonly string[],
  /** Early-access pages this account may not see (lib/earlyAccess) — dropped. */
  hidden?: readonly string[],
): NavSection[] {
  if (hidden?.length) {
    return navSectionsFor(role, locked)
      .map((section) => ({
        label: section.label,
        items: section.items
          .filter((item) => !isHiddenHref(hidden, item.href))
          .map((item) => (item.children ? { ...item, children: item.children.filter((c) => !isHiddenHref(hidden, c.href)) } : item)),
      }))
      .filter((section) => section.items.length > 0);
  }
  // Role rules DROP an item (a worker has no business seeing Financials); the
  // custom-plan lock only MARKS it — the page exists, the plan just does not
  // include it yet, and a dimmed padlocked row that opens the upgrade offer
  // sells the add-on where a missing row sells nothing.
  const mark = (item: NavItem): NavItem => {
    const marked = locked && isCustomBlockedPath(locked, item.href.split("?")[0]) ? { ...item, locked: true } : item;
    // The rows folded under it follow the same rules.
    return marked.children ? { ...marked, children: marked.children.filter((c) => canOpen(role, c.href, locked)).map((c) => (locked && isCustomBlockedPath(locked, c.href.split("?")[0]) ? { ...c, locked: true } : c)) } : marked;
  };

  const plan = role ? ROLE_NAV[role] : undefined;
  if (plan) {
    const labels = (role && ROLE_LABELS[role]) || {};
    return plan
      .map((group) => ({
        label: group.label,
        items: group.hrefs
          .filter((href) => canOpen(role, href))
          .map((href) => {
            const item = ITEM_BY_HREF[href];
            if (!item) return null;
            return mark(labels[href] ? { ...item, label: labels[href] } : item);
          })
          .filter((item): item is NavItem => item !== null),
      }))
      .filter((group) => group.items.length > 0);
  }

  // Office roles. OWNER sees the map as authored; everyone else loses the
  // owner-only items, and any section they emptied goes with them.
  if (role === "OWNER" && !locked?.length) return NAV_SECTIONS;
  return NAV_SECTIONS.map((section) => ({
    label: section.label,
    items: section.items.filter((item) => canOpen(role, item.href)).map(mark),
  })).filter((section) => section.items.length > 0);
}

/**
 * The nav item that owns this path, by longest-prefix match, so child routes
 * (e.g. /dashboard/workers/[id]) keep their parent item lit. Returns null when
 * nothing in the map claims the path.
 */
export function activeHref(pathname: string): string | null {
  const path = SURFACE_ALIASES[pathname] ?? pathname;
  let best: string | null = null;
  for (const section of NAV_SECTIONS) {
    for (const item of flattenNavItems(section.items)) {
      if (item.href === "#") continue;
      const hit = path === item.href || path.startsWith(item.href + "/");
      if (hit && (best === null || item.href.length > best.length)) best = item.href;
    }
  }
  return best;
}
