// THE TRIAL METER (owner, 2026-10-02) — server only (database). Two jobs, one record.
//
// 1. THE CEILINGS. takeTrialCap(org, key) is called by every paid action
//    before it spends: on a card-less trial with no card it counts one use
//    against TRIAL_CAPS (lib/trialCaps) and refuses past the ceiling; with a
//    card on file — or no card-less trial at all — it lets the plan's own
//    limits decide and counts nothing; past the trial's end with no card it
//    refuses everything paid. A refusal is a PlanLimitFailure carrying
//    `trialCap`, so the existing client handling (reportPlanLimitResult)
//    raises the dialog, and the dialog asks for a card instead of a plan.
//    Where an action throws instead of returning, TrialCapError carries
//    Next's redirect digest to /dashboard/trial?cap=<key> — the screen that
//    says which ceiling it was and adds the card.
//
// 2. THE SPEND. notePaidCall(service, op) is called where a request to a paid
//    API is made (lib/externalCall, the OpenAI client, ReportAll, SerpAPI,
//    Twilio …). It knows the organization from the request — requireOrg notes
//    it, the way lib/trialLock notes a locked write — adds the call's price
//    (lib/paidApiCosts) to a per-request tally, and writes the tally once,
//    after the response (next/server `after`): for every organization to its
//    day in ApiSpendDaily (lib/apiSpend, 2026-10-22 — /admin/usage reads it),
//    and, while it is on a trial, to the meter below as well (/admin/trials
//    and the trial screens read that).
//
// THE RECORD is one SyncState row per organization, `trialMeter:<orgId>`,
// JSON, advanced with a compare-and-swap (the same pattern as
// lib/rateLimit's shared windows): two presses at once cannot both take the
// last use, and no schema change was needed. It is never deleted, so a used
// trial stays used.
import { db } from "@/lib/db";
import { cardlessTrialState } from "@/lib/trialState";
import { TRIAL_CAPS, TRIAL_CAP_KEYS, trialCapHref, trialCapMessage, type TrialCapKey } from "@/lib/trialCaps";
import type { PlanLimitFailure } from "@/lib/planLimits";
import { unitCents, type PaidService } from "@/lib/paidApiCosts";
import { recordApiSpend, type ApiSpendEntry } from "@/lib/apiSpend";

import { TRIAL_ENDED_MESSAGE as ENDED_MESSAGE } from "@/lib/trialLock";

export type TrialMeter = {
  /** Uses counted against each ceiling. */
  uses: Partial<Record<TrialCapKey, number>>;
  /** What a use was counted for, where the same thing twice is one use
   *  (the fence page's point). Newest last, a short list per key. */
  seen: Partial<Record<TrialCapKey, string[]>>;
  /** Estimated spend in cents, by service (lib/paidApiCosts). */
  spend: Partial<Record<PaidService, number>>;
  /** Billed requests, by service. */
  calls: Partial<Record<PaidService, number>>;
  /** First and last recorded spend. */
  first?: string;
  last?: string;
};

export const trialMeterKey = (orgId: string) => `trialMeter:${orgId}`;

const EMPTY = (): TrialMeter => ({ uses: {}, seen: {}, spend: {}, calls: {} });

function parseMeter(cursor: string | null | undefined): TrialMeter {
  if (!cursor) return EMPTY();
  try {
    const m = JSON.parse(cursor) as Partial<TrialMeter>;
    return { uses: m.uses ?? {}, seen: m.seen ?? {}, spend: m.spend ?? {}, calls: m.calls ?? {}, first: m.first, last: m.last };
  } catch {
    return EMPTY();
  }
}

export async function readTrialMeter(orgId: string): Promise<TrialMeter> {
  const row = await db.syncState.findUnique({ where: { key: trialMeterKey(orgId) } }).catch(() => null);
  return parseMeter(row?.cursor);
}

/** Every listed organization's meter, for the admin list. */
export async function readTrialMeters(orgIds: string[]): Promise<Map<string, TrialMeter>> {
  const out = new Map<string, TrialMeter>();
  if (!orgIds.length) return out;
  const rows = await db.syncState
    .findMany({ where: { key: { in: orgIds.map(trialMeterKey) } }, select: { key: true, cursor: true } })
    .catch(() => [] as Array<{ key: string; cursor: string }>);
  for (const r of rows) out.set(r.key.slice("trialMeter:".length), parseMeter(r.cursor));
  return out;
}

const CAS_ATTEMPTS = 8;

/**
 * Read, change, write only if nobody wrote in between; again on a lost race.
 * `change` returns the next meter, or null to leave the row as it is (and
 * answer null). Throws when the race is lost every time.
 */
async function mutateMeter(orgId: string, change: (m: TrialMeter) => TrialMeter | null): Promise<TrialMeter | null> {
  const key = trialMeterKey(orgId);
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const row = await db.syncState.findUnique({ where: { key } });
    const next = change(parseMeter(row?.cursor));
    if (!next) return null;
    const cursor = JSON.stringify(next);
    if (!row) {
      try {
        await db.syncState.create({ data: { key, cursor } });
        return next;
      } catch {
        continue; // created by someone else first — read again
      }
    }
    const { count } = await db.syncState.updateMany({ where: { key, cursor: row.cursor }, data: { cursor } });
    if (count === 1) return next;
    await new Promise((r) => setTimeout(r, 5 + Math.random() * 20 * (attempt + 1)));
  }
  throw new Error(`trial meter for ${orgId} is under contention`);
}

// ── the ceilings ───────────────────────────────────────────────────────────

/** none — the plan's limits apply (no card-less trial, a card on file, or a
 *  trial that ran out — the Free plan's limits then, lib/freePlan);
 *  capped — card-less, no card: TRIAL_CAPS apply. "ended" is no longer
 *  answered (owner, 2026-10-14). */
export type TrialCapScope = "none" | "capped" | "ended";

export async function trialCapScope(orgId: string): Promise<TrialCapScope> {
  const state = await cardlessTrialState(orgId).catch(() => null);
  if (!state) return "none";
  if (state.kind === "ended") return "none";
  return state.hasCard ? "none" : "capped";
}

export type TrialGate =
  | { ok: true; counted: boolean; refund: () => Promise<void> }
  | { ok: false; failure: PlanLimitFailure; ended: boolean };

const NOTHING = async () => {};

/** A map point as a dedupe name: about eleven metres, so one pin asked by two
 *  requests at once is one use. */
export const trialPointKey = (lat: number, lng: number) => `pt:${lat.toFixed(4)},${lng.toFixed(4)}`;

export function trialCapFailure(key: TrialCapKey, ended = false): PlanLimitFailure {
  return {
    ok: false,
    code: "PLAN_LIMIT_REACHED",
    error: ended ? ENDED_MESSAGE : trialCapMessage(key),
    trialCap: key,
    ...(ended ? { trialEnded: true } : {}),
  };
}

/**
 * One use of `key`, or the refusal. `dedupe` names what is being paid for
 * when the same thing twice should count once (a fence point): a name seen
 * before passes without counting. `refund()` gives the use back — for an
 * action that turned out to spend nothing (a stored answer reused) or failed
 * before it spent.
 */
export async function takeTrialCap(
  orgId: string,
  key: TrialCapKey,
  opts: {
    dedupe?: string;
    /** Ceilings that, already taken in this same request, cover this one: an
     *  HVAC site lookup asks for the lot's outline on its own use, not on a
     *  fence lookup's. Request-scoped, so a browser cannot claim it. */
    coveredBy?: TrialCapKey[];
  } = {},
): Promise<TrialGate> {
  const scope = await trialCapScope(orgId);
  if (scope === "none") return { ok: true, counted: false, refund: NOTHING };
  if (scope === "ended") return { ok: false, failure: trialCapFailure(key, true), ended: true };
  const note = await currentNote();
  if (opts.coveredBy?.some((k) => note?.gated.has(k))) return { ok: true, counted: false, refund: NOTHING };
  const cap = TRIAL_CAPS[key];
  const out: { verdict: "counted" | "seen" | "full" } = { verdict: "full" };
  try {
    await mutateMeter(orgId, (m) => {
      const seen = m.seen[key] ?? [];
      if (opts.dedupe && seen.includes(opts.dedupe)) {
        out.verdict = "seen";
        return null;
      }
      const used = m.uses[key] ?? 0;
      if (used >= cap) {
        out.verdict = "full";
        return null;
      }
      out.verdict = "counted";
      return {
        ...m,
        uses: { ...m.uses, [key]: used + 1 },
        seen: opts.dedupe ? { ...m.seen, [key]: [...seen, opts.dedupe].slice(-40) } : m.seen,
      };
    });
  } catch (err) {
    // The meter could not be written: refuse rather than spend unmetered.
    console.warn(`[trial-meter] ${key} for ${orgId} not counted:`, err);
    return { ok: false, failure: trialCapFailure(key), ended: false };
  }
  if (out.verdict === "full") return { ok: false, failure: trialCapFailure(key), ended: false };
  note?.gated.add(key);
  if (out.verdict === "seen") return { ok: true, counted: false, refund: NOTHING };
  let refunded = false;
  return {
    ok: true,
    counted: true,
    refund: async () => {
      if (refunded) return;
      refunded = true;
      await mutateMeter(orgId, (m) => {
        const used = m.uses[key] ?? 0;
        if (used <= 0) return null;
        const seen = m.seen[key];
        return {
          ...m,
          uses: { ...m.uses, [key]: used - 1 },
          seen: opts.dedupe && seen ? { ...m.seen, [key]: seen.filter((s) => s !== opts.dedupe) } : m.seen,
        };
      }).catch((err) => console.warn(`[trial-meter] ${key} refund for ${orgId} lost:`, err));
    },
  };
}

/**
 * The refusal for an action that throws rather than returns. Its message is
 * the ceiling's sentence (for an action that catches and shows it); its
 * digest is Next's redirect, so one that lets it propagate sends the browser
 * to the trial page — in a production build too, where a thrown message would
 * be replaced by React's generic one.
 */
export class TrialCapError extends Error {
  readonly digest: string;
  readonly code = "PLAN_LIMIT_REACHED";
  constructor(
    readonly trialCap: TrialCapKey,
    readonly trialEnded = false,
  ) {
    super(trialEnded ? ENDED_MESSAGE : trialCapMessage(trialCap));
    this.name = "TrialCapError";
    this.digest = `NEXT_REDIRECT;push;${trialEnded ? "/dashboard/trial?locked=1" : trialCapHref(trialCap)};303;`;
  }
}

/** takeTrialCap that throws TrialCapError on a refusal. */
export async function enforceTrialCap(orgId: string, key: TrialCapKey, opts: { dedupe?: string } = {}) {
  const gate = await takeTrialCap(orgId, key, opts);
  if (!gate.ok) throw new TrialCapError(key, gate.ended);
  return gate;
}

/**
 * A text the trial may not send: everything but the verification code, on a
 * card-less trial with no card (smsOutbound), and everything after it ended.
 * Counts the text when the ceiling allows some. No organization (the platform's
 * own replies) is never the trial's.
 */
export async function trialBlocksText(orgId: string | null | undefined, kind: string): Promise<boolean> {
  if (!orgId || kind === "verify") return false;
  const gate = await takeTrialCap(orgId, "smsOutbound");
  return !gate.ok;
}

/** What the trial page and the admin read: each ceiling, its uses, its number. */
export async function trialCapUsage(orgId: string): Promise<Array<{ key: TrialCapKey; used: number; cap: number }>> {
  const m = await readTrialMeter(orgId);
  return TRIAL_CAP_KEYS.map((key) => ({ key, used: m.uses[key] ?? 0, cap: TRIAL_CAPS[key] }));
}

// ── the spend ──────────────────────────────────────────────────────────────

/** Per organization, per `service op`. */
type Tally = Map<string, Map<string, ApiSpendEntry>>;
type RequestNote = { orgId: string | null; tally: Tally; scheduled: boolean; gated: Set<TrialCapKey> };

/** Keyed by the request's headers object — the same object for every
 *  `headers()` call in one request (lib/trialLock relies on the same). */
const notes = new WeakMap<object, RequestNote>();

async function requestHeaders(): Promise<object | null> {
  try {
    const { headers } = await import("next/headers");
    return (await headers()) as unknown as object;
  } catch {
    return null; // a script, a cron outside a request, a cached scope
  }
}

/** This request's note, made on first use; null outside a request. */
async function currentNote(): Promise<RequestNote | null> {
  const h = await requestHeaders();
  if (!h) return null;
  let note = notes.get(h);
  if (!note) {
    note = { orgId: null, tally: new Map(), scheduled: false, gated: new Set() };
    notes.set(h, note);
  }
  return note;
}

/** Called by requireOrg: paid calls made in this request are this organization's. */
export async function noteRequestOrg(orgId: string): Promise<void> {
  const note = await currentNote();
  if (note) note.orgId = orgId;
}

/** The organization requireOrg noted for this request; null outside a request
 *  or before requireOrg ran. lib/emailLog files each letter under it. */
export async function requestOrgId(): Promise<string | null> {
  const h = await requestHeaders();
  return (h && notes.get(h)?.orgId) || null;
}

/**
 * One billed request to a paid API. Priced from lib/paidApiCosts (`units`
 * of `op`), or `cents` when the caller knows better (an OpenAI response's own
 * token count). The organization is the request's (requireOrg), or `orgId`
 * where the caller has one and no request does. Never throws, never blocks
 * the call it records.
 */
export async function notePaidCall(
  service: PaidService,
  op: string,
  opts: { units?: number; cents?: number; orgId?: string | null } = {},
): Promise<void> {
  try {
    const cents = opts.cents ?? unitCents(service, op, opts.units ?? 1);
    const calls = 1;
    const note = await currentNote();
    const orgId = opts.orgId ?? note?.orgId ?? null;
    if (!orgId) return;
    if (!note) {
      await writeSpend(orgId, [{ service, op, cents, calls }]);
      return;
    }
    const byOp = note.tally.get(orgId) ?? new Map<string, ApiSpendEntry>();
    const key = `${service} ${op}`;
    const cur = byOp.get(key) ?? { service, op, cents: 0, calls: 0 };
    byOp.set(key, { ...cur, cents: cur.cents + cents, calls: cur.calls + calls });
    note.tally.set(orgId, byOp);
    if (!note.scheduled) {
      note.scheduled = true;
      const pending = note;
      try {
        const { after } = await import("next/server");
        after(() => flushNote(pending));
      } catch {
        await flushNote(pending); // no `after` here — write now
      }
    }
  } catch (err) {
    console.warn(`[trial-meter] ${service} ${op} not recorded:`, err);
  }
}

async function flushNote(note: RequestNote): Promise<void> {
  const tally = note.tally;
  note.tally = new Map();
  note.scheduled = false;
  for (const [orgId, byOp] of tally) await writeSpend(orgId, [...byOp.values()]);
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/* Whether an organization is on a trial, remembered for a minute per
   instance: the map tiles record a call per tile, and an organization that is
   not on a trial should not cost a query per tile. */
const trialingSeen = new Map<string, { trialing: boolean; at: number }>();
async function isTrialing(orgId: string): Promise<boolean> {
  const hit = trialingSeen.get(orgId);
  if (hit && Date.now() - hit.at < 60_000) return hit.trialing;
  const sub = await db.subscription.findUnique({ where: { organizationId: orgId }, select: { status: true } });
  const trialing = sub?.status === "TRIALING";
  if (trialingSeen.size > 2000) trialingSeen.clear();
  trialingSeen.set(orgId, { trialing, at: Date.now() });
  return trialing;
}

/** A request's spend: the organization's day (every organization), and its
 *  trial meter while it is on a trial. */
async function writeSpend(orgId: string, entries: ApiSpendEntry[]): Promise<void> {
  await Promise.all([recordApiSpend(orgId, entries), writeTrialSpend(orgId, entries)]);
}

/** Add a request's spend to the organization's meter — only while it is on a trial. */
async function writeTrialSpend(orgId: string, entries: ApiSpendEntry[]): Promise<void> {
  try {
    if (!(await isTrialing(orgId))) return;
    const byService = new Map<PaidService, { cents: number; calls: number }>();
    for (const e of entries) {
      const cur = byService.get(e.service) ?? { cents: 0, calls: 0 };
      byService.set(e.service, { cents: cur.cents + e.cents, calls: cur.calls + e.calls });
    }
    const now = new Date().toISOString();
    await mutateMeter(orgId, (m) => {
      const spend = { ...m.spend };
      const calls = { ...m.calls };
      for (const [service, v] of byService) {
        spend[service] = round4((spend[service] ?? 0) + v.cents);
        calls[service] = (calls[service] ?? 0) + v.calls;
      }
      return { ...m, spend, calls, first: m.first ?? now, last: now };
    });
  } catch (err) {
    console.warn(`[trial-meter] spend for ${orgId} not written:`, err);
  }
}

/** The meter's total, in cents. */
export function meterSpendCents(m: TrialMeter | null | undefined): number {
  if (!m) return 0;
  return Object.values(m.spend).reduce<number>((n, c) => n + (c ?? 0), 0);
}
