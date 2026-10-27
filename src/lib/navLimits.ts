// Server-only plain module (NOT "use server" — mirrors badgeCounts.ts so it
// can't be invoked as an unauthenticated POST endpoint; the layout passes a
// trusted organizationId).
//
// Maps sidebar nav hrefs to their metered resource(s) and returns the
// remaining/limit pair for each LIMITED one. Unlimited resources are simply
// absent, so the sidebar renders no counter for them. When one nav surface is
// governed by two quotas (calendar: job events + appointment cards), the
// tighter remaining wins.
import { getOrgLimitOverview } from "@/lib/limitsEngine";
import { LIMIT_DEFS, type LimitKey } from "@/lib/planLimits";

export interface NavLimitInfo {
  remaining: number;
  limit: number;
  /** The tighter resource bounding this one (e.g. estimators tied to proposals). */
  cappedBy?: LimitKey;
  /** The metered thing, lower-cased for a sentence ("proposals created"). */
  label: string;
  /** "monthly" resets each cycle; "absolute" is a standing seat count. */
  scope: "monthly" | "absolute";
}

const NAV_LIMIT_KEYS: Record<string, LimitKey[]> = {
  "/dashboard/proposals": ["proposalsCreated"],
  "/dashboard/clients": ["clients"],
  "/dashboard/leads": ["leads"],
  "/dashboard/projects": ["projects"],
  "/dashboard/calendar": ["calendarEvents", "calendarCards"],
  "/dashboard/jobs": ["jobs"],
  "/dashboard/workers": ["workers"],
  "/dashboard/messages": ["messagesSent", "conversationsStarted"],
  "/dashboard/phone": ["aiPhoneCalls"],
  "/dashboard/reviews": ["reviewRequests"],
  // Every estimator surface draws down the same meter (and, through
  // CAPPED_BY, the proposals it would create).
  "/dashboard/advanced-ai": ["estimatorUses"],
  "/dashboard/roof-estimator": ["estimatorUses"],
  "/dashboard/fence-estimator": ["estimatorUses"],
  // HVAC has its own meter (hvacEstimates) on top of the shared gate.
  "/dashboard/hvac-estimator": ["hvacEstimates", "estimatorUses"],
  "/dashboard/video-estimator": ["estimatorUses"],
  "/dashboard/deck-estimator": ["estimatorUses"],
  // Classic-shell paths, kept for the old sidebar.
  "/dashboard/advanced-ai/roof": ["estimatorUses"],
  "/dashboard/advanced-ai/fence/studio": ["estimatorUses"],
};

/* How the sidebar names each meter — a plain noun, not the admin label
   ("Total workers" → "worker seats"). Falls back to the LIMIT_DEFS label. */
const NAV_NOUN: Partial<Record<LimitKey, string>> = {
  proposalsCreated: "proposals",
  clients: "clients",
  leads: "leads",
  projects: "projects",
  jobs: "jobs",
  calendarEvents: "calendar events",
  calendarCards: "appointments",
  workers: "worker seats",
  teamSeats: "team seats",
  managers: "manager seats",
  messagesSent: "messages",
  conversationsStarted: "conversations",
  aiPhoneCalls: "AI phone calls",
  reviewRequests: "review requests",
  estimatorUses: "estimator runs",
  hvacEstimates: "HVAC estimates",
  roofMeasurements: "roof measurements",
  manualJReports: "Manual J reports",
};

export async function getNavLimitCounters(
  organizationId: string,
): Promise<Record<string, NavLimitInfo>> {
  return (await getNavLimitState(organizationId)).counters;
}

/**
 * The counters plus whether the caps apply to the current user here at all
 * (a platform admin in their own organization): the sidebar then draws
 * "Unlimited · platform admin" and no pill.
 */
export async function getNavLimitState(
  organizationId: string,
): Promise<{ counters: Record<string, NavLimitInfo>; exempt: boolean }> {
  // One plan resolution + one COUNT per limited key (unlimited keys cost
  // nothing) — cheap enough to run on every dashboard layout render.
  const { usage, exempt } = await getOrgLimitOverview(organizationId);
  const byKey = new Map(usage.map((s) => [s.resource, s]));

  const out: Record<string, NavLimitInfo> = {};
  for (const [href, keys] of Object.entries(NAV_LIMIT_KEYS)) {
    let tightest: NavLimitInfo | null = null;
    for (const key of keys) {
      const s = byKey.get(key);
      if (!s || s.limit === null || s.remaining === null) continue;
      if (!tightest || s.remaining < tightest.remaining) {
        const def = LIMIT_DEFS.find((d) => d.key === (s.cappedBy ?? key));
        tightest = {
          remaining: s.remaining,
          limit: s.limit,
          cappedBy: s.cappedBy,
          label: NAV_NOUN[s.cappedBy ?? key] ?? (def?.label ?? key).toLowerCase(),
          scope: def?.scope === "absolute" ? "absolute" : "monthly",
        };
      }
    }
    if (tightest) out[href] = tightest;
  }
  return { counters: out, exempt };
}
