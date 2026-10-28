// OPENING PRICED (2026-10-28): a lead from a website estimator — or from the house (/estimate/jobflex/<trade>, bought on
// the Lead Center) — carries the record the public page priced from (`webLead:<leadId>`, lib/webEstimator
// WebLeadRecord). The deck and the roof already open priced (actions/webEstimator openWebLeadInEstimator); the fence,
// HVAC and Smart Proposal estimators open with the address and the words only. These readers turn the record's facts
// into the one thing each of those estimators applies at open — the fence as drawn, the house with its tier, the
// generated lines — so the contractor opens it priced in their own book. The estimator's page reads the record by the
// seed's lead id (the seed cookie is ~4 KB and carries none of this). Pure; the server read is lib/webEstimatorServer
// readWebLeadFor. Design: docs/superpowers/specs/2026-10-28-home-portal-house-estimators-design.md.
import type { WebLeadRecord } from "./webEstimator";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pinOf = (v: unknown): { lat: number; lng: number } | null => {
  const p = v as { lat?: unknown; lng?: unknown } | null | undefined;
  const lat = num(p?.lat), lng = num(p?.lng);
  return lat !== null && lng !== null ? { lat, lng } : null;
};

// ── the fence: what webFencePrice stored (actions/webEstimator) ──

export type WebFenceSeed = {
  /** The address's pin: the local-feet frame the points are in; null when the feet were typed without a map. */
  pin: { lat: number; lng: number } | null;
  /** The path as drawn, in feet from the pin (components/estimator/fence PathPoint); empty when typed. */
  points: Array<{ x: number; y: number; gap?: boolean }>;
  runsFt: number[];
  /** The fence type's id (lib/fence/catalog FENCE_TYPES — the studio's own vocabulary). */
  type: string;
  heightFt: number;
  gates: number;
  doubles: number;
};

export function fenceSeedFromWebLead(rec: WebLeadRecord): WebFenceSeed | null {
  if (rec.trade !== "fence" || rec.estimate.trade !== "fence") return null;
  const f = rec.estimate.facts;
  const runsFt = Array.isArray(f.runsFt) ? f.runsFt.map(num).filter((n): n is number => n !== null && n > 0) : [];
  if (!runsFt.length) return null;
  const points = Array.isArray(f.points)
    ? f.points
        .map((p) => (p && typeof p === "object" ? { x: num((p as { x?: unknown }).x), y: num((p as { y?: unknown }).y), gap: (p as { gap?: unknown }).gap === true } : null))
        .filter((p): p is { x: number; y: number; gap: boolean } => !!p && p.x !== null && p.y !== null)
        .slice(0, 200)
        .map((p) => (p.gap ? { x: p.x, y: p.y, gap: true } : { x: p.x, y: p.y }))
    : [];
  return {
    pin: pinOf(f.pin),
    points,
    runsFt,
    type: typeof f.type === "string" ? f.type : "",
    heightFt: num(f.heightFt) ?? 6,
    gates: Math.max(0, Math.round(num(f.gates) ?? 0)),
    doubles: Math.max(0, Math.round(num(f.doubles) ?? 0)),
  };
}
