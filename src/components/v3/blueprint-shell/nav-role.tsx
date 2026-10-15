"use client";

// Who is looking at the blueprint chrome — read once, on the server, and handed
// down to every client piece that has to reason about it.
//
// WHY A CONTEXT AND NOT A PROP. The three consumers sit at very different
// depths. The desktop sidebar is a direct child of BlueprintShell, but the
// handheld drawer (components/v3/mobile-shell/mobile-nav) is mounted by each
// mobile page component from inside its own tree, and the command palette is a
// sibling of both. Threading a `role` prop to the drawer would mean touching
// every handheld surface that renders <MobileNav />. The blueprint tree has no
// SessionProvider — that is deliberate, see the layout's header — so `useSession`
// is not an option either. One provider at the layout is.
//
// SCOPE. Mounted by src/app/dashboard/layout.tsx, so it covers every blueprint
// route and both viewports of them. The standalone /mobile-*-v2 review URLs are
// NOT under that layout and therefore have no provider; they fall back to the
// unfiltered nav, which is what they showed before. Those routes are outside
// the middleware's matcher too, so they have no role route-gate of their own —
// one gap, in one place, rather than two half-answers.
//
// NOT A SECURITY BOUNDARY. This decides what the chrome DRAWS. What a role may
// open is decided server-side by the route gate in the layout and by the guards
// in @/lib/orgContext.

import { createContext, useContext } from "react";
import type { Workspace } from "@/lib/editions";

/** `preview` (2026-10-15): pages this account may USE though they are not sold yet — a
 *  platform admin or the early-access account testing Deck Studio (lib/deck/access).
 *  The sidebar still says Soon for them; the New estimate dialog opens the card with a Preview tag. */
export type NavView = { workspace: Workspace; unlocked: string[]; switchable: boolean; preview?: string[] };
const PLATFORM_VIEW: NavView = { workspace: "platform", unlocked: [], switchable: false };

export type NavIdentity = {
  /** Raw Membership.role — "OWNER", "INSTALLER", … Never humanised: the nav
   *  rules match on the enum value, and display formatting is the caller's. */
  role: string | null;
  /** Display name for the account block. */
  name: string | null;
  /** Early-access pages this account may not see (lib/earlyAccess). The nav
   *  drops them; the pages themselves also refuse the account server-side. */
  hidden?: string[];
  /** The edition's view (lib/editions): the workspace this request works in, the rows that stop saying Soon, whether a switch is drawn. */
  view?: NavView;
};

const EMPTY: NavIdentity = { role: null, name: null };

const NavRoleContext = createContext<NavIdentity>(EMPTY);

// Nav badge counts, keyed by nav href ("/dashboard/leads" → 3). Computed once,
// server-side, by the layout (getBadgeCounts in @/lib/badgeCounts) and handed
// down here for the same reason the identity is: the desktop sidebar, the
// handheld drawer and any future tab bar sit at very different depths, and the
// drawer is mounted by every mobile page from inside its own tree. Same
// provider, second channel — NOT folded into NavIdentity, because "who is
// looking" and "what is unread" change for different reasons.
const EMPTY_BADGES: Record<string, number> = {};

const NavBadgesContext = createContext<Record<string, number>>(EMPTY_BADGES);

// The custom plan's page gate, third channel. Hrefs the active org may NOT
// open — computed once, server-side, by the layout (lib/customPageAccess) and
// read by every chrome filter alongside the role. Empty for every plan that is
// not the custom one. Same reason it is not folded into NavIdentity: "who is
// looking" and "what their plan bought" change for different reasons.
const EMPTY_LOCKED: string[] = [];

const NavLockedContext = createContext<string[]>(EMPTY_LOCKED);

// What is LEFT on each metered page, fourth channel: remaining / limit by nav
// href (lib/navLimits), computed by the layout beside the badges. Empty when
// the plan caps nothing, so nothing is drawn — the same rule as the badges.
export type NavLimit = {
  remaining: number;
  limit: number;
  label: string;
  scope: "monthly" | "absolute";
};
const EMPTY_LIMITS: Record<string, NavLimit> = {};

/**
 * What the nav says about a quota, if anything (owner, 2026-09-21). A full
 * meter is not news: the pill is drawn only when the plan is nearly used up
 * (a fifth or less left) or used up — "2 left" in blueprint, "none left" in
 * red. Every other value draws nothing, so a row never carries a number that
 * only means "you are fine".
 */
export function quotaPill(q: NavLimit): { text: string; out: boolean } | null {
  if (q.remaining <= 0) return { text: "none left", out: true };
  if (q.limit > 0 && q.remaining / q.limit <= 0.2) return { text: `${q.remaining} left`, out: false };
  return null;
}

const NavLimitsContext = createContext<Record<string, NavLimit>>(EMPTY_LIMITS);
// Fifth channel: the caps do not apply to this user here (a platform admin
// in an organization they own) — the shell says so once instead of counting.
const NavLimitsExemptContext = createContext<boolean>(false);

export function NavRoleProvider({
  identity,
  badges,
  locked,
  limits,
  limitsExempt,
  children,
}: {
  identity?: NavIdentity;
  /** Unread/pending counts by nav href, from the layout's getBadgeCounts. */
  badges?: Record<string, number>;
  /** Custom-plan blocked hrefs, from the layout's getBlockedCustomPages. */
  locked?: string[];
  /** Remaining plan quota by nav href, from the layout's getNavLimitCounters. */
  limits?: Record<string, NavLimit>;
  /** The caps do not apply to this user here (lib/navLimits getNavLimitState). */
  limitsExempt?: boolean;
  children: React.ReactNode;
}) {
  return (
    <NavRoleContext.Provider value={identity ?? EMPTY}>
      <NavBadgesContext.Provider value={badges ?? EMPTY_BADGES}>
        <NavLockedContext.Provider value={locked ?? EMPTY_LOCKED}>
          <NavLimitsContext.Provider value={limits ?? EMPTY_LIMITS}>
            <NavLimitsExemptContext.Provider value={limitsExempt ?? false}>{children}</NavLimitsExemptContext.Provider>
          </NavLimitsContext.Provider>
        </NavLockedContext.Provider>
      </NavBadgesContext.Provider>
    </NavRoleContext.Provider>
  );
}

/** Early-access hrefs this account may not see — empty outside the provider. */
/** The edition's view, or the whole platform outside the provider. */
export function useNavView(): NavView {
  return useContext(NavRoleContext).view ?? PLATFORM_VIEW;
}

export function useNavHidden(): string[] {
  return useContext(NavRoleContext).hidden ?? EMPTY_LOCKED;
}

/** Remaining quota by nav href, or an empty map outside the provider. */
export function useNavLimits(): Record<string, NavLimit> {
  return useContext(NavLimitsContext);
}

/** True when the plan's caps do not apply to this user in this organization. */
export function useNavLimitsExempt(): boolean {
  return useContext(NavLimitsExemptContext);
}

/** The custom plan's blocked hrefs, or an empty list outside the provider and
 *  on every non-custom plan — which draws everything, the pre-existing nav. */
export function useNavLocked(): string[] {
  return useContext(NavLockedContext);
}

/** Badge counts by nav href, or an empty map outside the provider (the
 *  standalone /mobile-*-v2 review URLs), which renders no badges — exactly
 *  what those fixture routes showed before. */
export function useNavBadges(): Record<string, number> {
  return useContext(NavBadgesContext);
}

/** The signed-in identity, or a null identity outside the provider. A null role
 *  means "do not filter" — the pre-existing behaviour for surfaces that have no
 *  provider, and the safe answer for a shell rendered before the session
 *  resolves, since the server gate is the real boundary either way. */
export function useNavIdentity(): NavIdentity {
  return useContext(NavRoleContext);
}

/** Shorthand for the common case. */
export function useNavRole(): string | null {
  return useContext(NavRoleContext).role;
}
