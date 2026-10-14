// Pure, client-safe definitions for per-plan numeric limits.
//
// NO server imports here (no Prisma, no "use server"). Both the admin Plans UI
// (client) and the server-side Limits Engine (src/lib/entitlements.ts) import
// these so the limit keys, scopes, and (de)serialization stay in one place.
//
// Storage: PricingPlan.limitsJson holds a JSON object keyed by LimitKey. A key
// that is absent, null, or negative means "unlimited".

import type { TrialCapKey } from "@/lib/trialCaps";

export const UNLIMITED = -1;

/**
 * Stable error message thrown by enforcePlanLimit and detected on the client to
 * raise the "limit reached" dialog. Kept here (client-safe) so both sides agree.
 */
export const PLAN_LIMIT_MESSAGE = "Plan limit reached";

export function isPlanLimitError(err: unknown): boolean {
  return err instanceof Error && err.message === PLAN_LIMIT_MESSAGE;
}

/**
 * Limit failure shape for actions that return result unions ({ ok: false })
 * instead of throwing (estimators / AI flows). Thrown Error messages are
 * redacted by Next.js in production, but a returned payload survives — so
 * union-returning actions signal a limit via `code` and the client detects it
 * with isPlanLimitFailure.
 */
export interface PlanLimitFailure {
  ok: false;
  error: string;
  code: "PLAN_LIMIT_REACHED";
  resource?: LimitKey;
  /** Set when the ceiling reached is the card-less trial's own, not the
   *  plan's (lib/trialCaps): the dialog asks for a card instead of a plan. */
  trialCap?: TrialCapKey;
  /** The card-less trial is over with no card: nothing paid runs. */
  trialEnded?: boolean;
}

export function isPlanLimitFailure(v: unknown): v is PlanLimitFailure {
  return (
    !!v &&
    typeof v === "object" &&
    (v as { ok?: unknown }).ok === false &&
    (v as { code?: unknown }).code === "PLAN_LIMIT_REACHED"
  );
}

/**
 * A returned `{ ok: false }` failure as a client-side Error, so a caller's
 * existing catch block handles it unchanged: a plan limit becomes the error
 * reportPlanLimit recognises (with its resource), anything else carries the
 * server's own words — which a thrown server-action error would not.
 */
export function failureAsError(res: { error: string; code?: string; resource?: string; trialCap?: string; trialEnded?: boolean }): Error {
  if (res.code === "PLAN_LIMIT_REACHED") {
    return Object.assign(new Error(PLAN_LIMIT_MESSAGE), { code: res.code, resource: res.resource, trialCap: res.trialCap, trialEnded: res.trialEnded });
  }
  return new Error(res.error);
}

/** How a limit's usage window is computed. */
export type LimitScope =
  | "monthly" // counted within the current billing cycle
  | "absolute"; // counted across the org's whole lifetime

export type LimitKey =
  | "proposalsCreated"
  | "proposalsAccepted"
  | "proposalsCompleted"
  | "calendarCards"
  | "calendarEvents"
  | "projects"
  | "jobs"
  | "workers"
  | "clients"
  | "estimatorUses"
  | "hvacEstimates"
  | "conversationsStarted"
  | "messagesSent"
  | "leads"
  | "aiPhoneCalls"
  | "deskMinutes"
  | "reviewRequests"
  | "teamSeats"
  | "managers";

export interface LimitDef {
  key: LimitKey;
  label: string;
  scope: LimitScope;
  hint: string;
}

// The order here is the order shown in the admin "Plan Limits" section.
// `scope` is the single source of truth the engine uses to decide whether a
// usage count is windowed to the billing cycle (monthly) or counted in full
// (absolute). Flip a `scope` here and the engine follows automatically.
export const LIMIT_DEFS: readonly LimitDef[] = [
  { key: "proposalsCreated", label: "Proposals created", scope: "monthly", hint: "New proposals per billing cycle" },
  { key: "proposalsAccepted", label: "Proposals accepted", scope: "monthly", hint: "Accepted per billing cycle" },
  { key: "proposalsCompleted", label: "Proposals completed", scope: "monthly", hint: "Completed/paid per billing cycle" },
  { key: "calendarCards", label: "Calendar cards", scope: "monthly", hint: "Appointments scheduled per cycle" },
  { key: "calendarEvents", label: "Calendar events", scope: "monthly", hint: "Job events scheduled per cycle" },
  { key: "projects", label: "Total projects", scope: "monthly", hint: "New projects per billing cycle" },
  { key: "jobs", label: "Total jobs", scope: "monthly", hint: "New jobs per billing cycle" },
  { key: "workers", label: "Total workers", scope: "absolute", hint: "Worker seats in the org (lifetime)" },
  { key: "clients", label: "Clients", scope: "absolute", hint: "Client records in the org (lifetime)" },
  { key: "estimatorUses", label: "Estimator uses", scope: "monthly", hint: "AI estimator runs per cycle" },
  // The HVAC estimator's own meter (owner, 2026-09-25): new HVAC estimates
  // saved per cycle. It never created AiEstimate rows, so "estimatorUses"
  // only ever gated it — it never counted it. Absent from a plan = unlimited.
  { key: "hvacEstimates", label: "HVAC estimates", scope: "monthly", hint: "New HVAC estimates saved per cycle" },
  { key: "conversationsStarted", label: "Conversations started", scope: "monthly", hint: "New message threads per cycle" },
  { key: "messagesSent", label: "Messages sent", scope: "monthly", hint: "Messages sent per cycle" },
  { key: "leads", label: "Leads captured", scope: "monthly", hint: "New leads per cycle (all sources)" },
  { key: "aiPhoneCalls", label: "AI phone calls", scope: "monthly", hint: "AI receptionist calls per cycle" },
  // The AI desk's minutes (2026-10-13): per CALENDAR month, not the cycle — the desk
  // keeps its own month row (lib/aiDesk/usage). Past these, minute packs (lib/aiDesk/minutes).
  { key: "deskMinutes", label: "AI desk minutes", scope: "monthly", hint: "Minutes the AI desk is on the line per calendar month; packs add more" },
  { key: "reviewRequests", label: "Review requests", scope: "monthly", hint: "Review asks per cycle (incl. auto)" },
  { key: "teamSeats", label: "Office team seats", scope: "absolute", hint: "Non-worker members + pending invites" },
  // Manager seats specifically (owner's call, 2026-08-31): some plans sell NO
  // managers, others one or more. Counted as MANAGER-role members plus pending
  // MANAGER invites; absent from a plan's limitsJson = unlimited, so nothing
  // changes for a plan until /admin/plans sets a number.
  { key: "managers", label: "Manager seats", scope: "absolute", hint: "MANAGER members + pending manager invites" },
] as const;

export const LIMIT_KEYS = LIMIT_DEFS.map((d) => d.key) as LimitKey[];

export type PlanLimits = Partial<Record<LimitKey, number>>;

/**
 * Safety-net caps applied ONLY when a lapsed subscription must fall back to
 * FREE limits but no "free" PricingPlan row exists in the catalog. Without
 * this, parsePlanLimits(null) = {} = unlimited, and a canceled org would keep
 * unlimited usage — the exact hole the lapsed rule closes. A real "free" plan
 * row in /admin/plans always wins over these values.
 */
export const DEFAULT_FREE_LIMITS: PlanLimits = {
  proposalsCreated: 3,
  calendarCards: 10,
  calendarEvents: 10,
  projects: 2,
  jobs: 3,
  workers: 1,
  clients: 10,
  estimatorUses: 3,
  hvacEstimates: 3,
  conversationsStarted: 5,
  messagesSent: 50,
  leads: 10,
  aiPhoneCalls: 5,
  deskMinutes: 0,
  reviewRequests: 3,
  teamSeats: 1,
};

/** A limit is "unlimited" when missing, null, or negative (e.g. the -1 sentinel). */
export function isUnlimited(v: number | null | undefined): boolean {
  return v === null || v === undefined || !Number.isFinite(v) || v < 0;
}

/** Parse PricingPlan.limitsJson into a typed, validated PlanLimits object. */
export function parsePlanLimits(json: string | null | undefined): PlanLimits {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object") return {};
  const rec = raw as Record<string, unknown>;
  const out: PlanLimits = {};
  for (const def of LIMIT_DEFS) {
    const v = rec[def.key];
    if (typeof v === "number" && Number.isFinite(v)) out[def.key] = Math.trunc(v);
  }
  return out;
}

/**
 * Serialize a PlanLimits-like object for storage. Only known keys with a
 * finite, non-negative cap are persisted; unlimited values are simply omitted
 * (absent key === unlimited on read), keeping the JSON small and intentional.
 */
export function serializePlanLimits(limits: Record<string, number | null | undefined>): string {
  const out: Record<string, number> = {};
  for (const def of LIMIT_DEFS) {
    const v = limits[def.key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[def.key] = Math.trunc(v);
  }
  return JSON.stringify(out);
}
