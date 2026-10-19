// EARLY-ACCESS PAGES (2026-09-23) — surfaces that are built but not open to
// customers yet. Owner: "hide the pages Online booking and Service plans, only
// available to see and use for phillippapetenok@gmail.com", on production and
// on localhost alike (no environment switch — the rule is the account).
//
// Two halves, both keyed off this one list:
//   · the nav (sidebar, handheld drawer, command palette) drops the rows —
//     the layout hands `hiddenPagesFor(email)` down through NavIdentity;
//   · each page's server component calls `canSeeEarlyAccess(email)` and
//     redirects everyone else, so a typed URL is refused too.
// To open a page to everyone, delete its href below.

/** Accounts that see every early-access page. Lower case. */
const EARLY_ACCESS_EMAILS: ReadonlySet<string> = new Set(["phillippapetenok@gmail.com"]);

/** Dashboard pages still behind early access. Prefix-matched (sub-routes too).
 *  Service plans left the list on 2026-10-18 as the HVAC services desk (owner: "for everybody"). */
export const EARLY_ACCESS_HREFS: readonly string[] = ["/dashboard/booking"];

export function canSeeEarlyAccess(email: string | null | undefined): boolean {
  return !!email && EARLY_ACCESS_EMAILS.has(email.trim().toLowerCase());
}

/** The hrefs this account must not see in the nav — empty for the allowlist. */
export function hiddenPagesFor(email: string | null | undefined): string[] {
  return canSeeEarlyAccess(email) ? [] : [...EARLY_ACCESS_HREFS];
}

/** True when `href` is (or is under) one of the hidden pages. */
export function isHiddenHref(hidden: readonly string[] | undefined, href: string): boolean {
  if (!hidden?.length) return false;
  const path = href.split("?")[0];
  return hidden.some((h) => path === h || path.startsWith(`${h}/`));
}
