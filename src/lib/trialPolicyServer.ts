import "server-only";
// THE TRIAL'S CARD, SWITCHED BY THE OWNER (2026-10-07: "a switch in admin so
// I can turn on card needed or no card for free trials — smart, works right,
// and I don't have to worry about it").
//
// ONE ANSWER FOR EVERY DOOR (owner, 2026-10-07, second pass): signupTrialMode()
// says what a new signup gets right now — "card" or "no-card" — and the
// landing (trial line, FAQ, plan cards, footer), /pricing, the register
// page's plan step, the checkout route and requestCardlessTrial all ask it,
// nothing else. It is, in order:
//   1. the owner's switch — SyncState `trialPolicy` = { requiresCard, by, at },
//      set and reset on Admin → Trials;
//   2. with no row, the deployment's default (lib/trialPolicy: a card up
//      front unless TRIAL_REQUIRES_CARD=false);
//   3. when that says no card, the day's ceiling on card-less trials
//      (lib/trialDailyCap): past it the answer is "card" until the count drops.
// So the words a visitor reads and the step they get can never disagree.
// /terms does not ask: its sentence holds on either path.
//
// WHAT CANNOT GO WRONG BY DESIGN:
//   · a flip reaches a signup already on its way: requestCardlessTrial reads
//     the answer fresh and moves the plan step to the card; the checkout route
//     opens Checkout whatever the answer, since the visitor chose the card;
//   · trials already running keep their terms, and a confirmation link already
//     emailed is honoured (only the ceiling applies there — actions/signupCheckout);
//   · the answer is cached ten seconds per server instance, so the landing
//     costs no extra round trip; a flip or a reset clears this instance's copy.
import { db } from "@/lib/db";
import { trialRequiresCardEnv } from "@/lib/trialPolicy";
import { cardlessCeilingReached, cardlessStartsInLastDay, cardlessTrialsPerDay } from "@/lib/trialDailyCap";

export const TRIAL_POLICY_KEY = "trialPolicy";
const CACHE_MS = 10_000;

export type SignupTrialMode = "card" | "no-card";

export interface SignupTrialState {
  /** What a new signup gets right now. */
  mode: SignupTrialMode;
  /** The switch's own value (or the deployment's, with no row): a card or not. */
  requiresCard: boolean;
  /** Where that value came from: the owner's switch, or the deployment's default. */
  source: "admin" | "env";
  by: string | null;
  at: string | null;
  /** The deployment's own TRIAL_REQUIRES_CARD, for the admin page to show. */
  envDefault: boolean;
  /** The ceiling on card-less trials per day (CARDLESS_TRIALS_PER_DAY). */
  perDay: number;
  /** Card-less trials started in the last 24 hours; null when the switch asks
   *  for a card and the ceiling was not consulted. */
  startsLastDay: number | null;
  /** True when the switch says no card but the ceiling turned it into a card. */
  capReached: boolean;
}

let cache: { at: number; value: SignupTrialState } | null = null;

/** The whole answer. Never throws: a database hiccup falls back to the
 *  deployment's default for that read (not cached). `fresh` skips the cache —
 *  the signup action and the admin page read it that way. */
export async function signupTrialState({ fresh = false }: { fresh?: boolean } = {}): Promise<SignupTrialState> {
  const now = Date.now();
  if (!fresh && cache && now - cache.at < CACHE_MS) return cache.value;
  const envDefault = trialRequiresCardEnv();
  const perDay = cardlessTrialsPerDay();
  const fallback: SignupTrialState = {
    mode: envDefault ? "card" : "no-card", requiresCard: envDefault, source: "env", by: null, at: null,
    envDefault, perDay, startsLastDay: null, capReached: false,
  };
  let value: SignupTrialState;
  try {
    let policy = { requiresCard: envDefault, source: "env" as "admin" | "env", by: null as string | null, at: null as string | null };
    const row = await db.syncState.findUnique({ where: { key: TRIAL_POLICY_KEY }, select: { cursor: true } });
    if (row?.cursor) {
      const r = JSON.parse(row.cursor) as Record<string, unknown>;
      if (typeof r.requiresCard === "boolean") {
        policy = { requiresCard: r.requiresCard, source: "admin", by: typeof r.by === "string" ? r.by : null, at: typeof r.at === "string" ? r.at : null };
      }
    }
    const startsLastDay = policy.requiresCard ? null : await cardlessStartsInLastDay();
    const capReached = startsLastDay !== null && cardlessCeilingReached(startsLastDay, perDay);
    value = { ...policy, mode: policy.requiresCard || capReached ? "card" : "no-card", envDefault, perDay, startsLastDay, capReached };
  } catch (err) {
    console.warn("[trial-policy] read failed, using the deployment's default:", err);
    return fallback; // not cached: the next read tries the row again
  }
  cache = { at: now, value };
  return value;
}

/** "card" or "no-card": what a new signup gets right now. Every door asks this. */
export async function signupTrialMode(opts?: { fresh?: boolean }): Promise<SignupTrialMode> {
  return (await signupTrialState(opts)).mode;
}

/** The owner's switch. */
export async function setTrialRequiresCard(requiresCard: boolean, by: string | null): Promise<SignupTrialState> {
  const cursor = JSON.stringify({ requiresCard, by, at: new Date().toISOString() });
  await db.syncState.upsert({ where: { key: TRIAL_POLICY_KEY }, create: { key: TRIAL_POLICY_KEY, cursor }, update: { cursor } });
  cache = null;
  return signupTrialState({ fresh: true });
}

/** Back to the deployment's default: the row goes, TRIAL_REQUIRES_CARD decides. */
export async function resetTrialPolicy(): Promise<SignupTrialState> {
  await db.syncState.deleteMany({ where: { key: TRIAL_POLICY_KEY } });
  cache = null;
  return signupTrialState({ fresh: true });
}

/* ── THE SIGN-UP'S STEPS (owner, 2026-10-07: "fewer steps to get in, see if
   the conversion to the free trial is better; a switch for 2 or 3 steps").
   3 = account · company · plan, as built; 2 = one account step that also
   takes the business name and the trades (what the shop does — leads come
   once it sets its specialties and address on its company page), then the
   plan. SyncState `signupFlow` = { steps, by, at }; no row = 3. Read by the
   register page, cached ten seconds per instance like the card. ─────────── */
export const SIGNUP_FLOW_KEY = "signupFlow";
export type SignupSteps = 2 | 3;
/* PASSWORDLESS (2026-10-10): a third setting of the same switch — step 1 is
   name and email, the address is proven by a six-digit code from an email
   (lib/signupOtp), then the plan. Stored as `passwordless: true` beside
   `steps: 2`; a row without it reads as the password sign-up, as before. */
export interface SignupFlow { steps: SignupSteps; passwordless: boolean; source: "admin" | "default"; by: string | null; at: string | null }
const STEPS_CACHE_MS = 10_000;
let stepsCache: { at: number; value: SignupFlow } | null = null;

/** The sign-up's steps in force. Never throws: a hiccup reads as 3, uncached. */
export async function readSignupFlow({ fresh = false }: { fresh?: boolean } = {}): Promise<SignupFlow> {
  const now = Date.now();
  if (!fresh && stepsCache && now - stepsCache.at < STEPS_CACHE_MS) return stepsCache.value;
  let value: SignupFlow = { steps: 3, passwordless: false, source: "default", by: null, at: null };
  try {
    const row = await db.syncState.findUnique({ where: { key: SIGNUP_FLOW_KEY }, select: { cursor: true } });
    if (row?.cursor) {
      const r = JSON.parse(row.cursor) as Record<string, unknown>;
      if (r.steps === 2 || r.steps === 3) value = { steps: r.passwordless === true ? 2 : r.steps, passwordless: r.passwordless === true, source: "admin", by: typeof r.by === "string" ? r.by : null, at: typeof r.at === "string" ? r.at : null };
    }
  } catch (err) {
    console.warn("[signup-flow] read failed, using 3 steps:", err);
    return value;
  }
  stepsCache = { at: now, value };
  return value;
}
export async function signupSteps(): Promise<SignupSteps> {
  return (await readSignupFlow()).steps;
}
export async function setSignupSteps(steps: SignupSteps, by: string | null, passwordless = false): Promise<SignupFlow> {
  const at = new Date().toISOString();
  const cursor = JSON.stringify(passwordless ? { steps: 2, passwordless: true, by, at } : { steps, by, at });
  await db.syncState.upsert({ where: { key: SIGNUP_FLOW_KEY }, create: { key: SIGNUP_FLOW_KEY, cursor }, update: { cursor } });
  stepsCache = null;
  return readSignupFlow({ fresh: true });
}
