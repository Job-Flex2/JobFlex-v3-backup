/** Browser-safe report contract. Only sanitized summaries, never provider bodies. */
export type HealthLevel = "ok" | "degraded" | "down" | "off" | "unknown";
export type EvidenceState = "ok" | "error" | "limited" | "unknown" | "unsupported";
export interface HealthEvidence {
  state: EvidenceState;
  detail: string;
  source: string;
  observedAt?: string;
  lastSuccessAt?: string;
}
export interface ServiceHealth {
  key: string;
  name: string;
  level: HealthLevel;
  reason: string;
  optional?: boolean;
  probeFailed?: boolean;
  note?: string;
  asOf?: string;
  checkedAt: string;
  authentication?: HealthEvidence;
  quota?: HealthEvidence;
  provider?: HealthEvidence;
  feature?: HealthEvidence;
}
export interface HealthReport {
  version?: number;
  ranAt: string;
  tookMs: number;
  worst: HealthLevel;
  services: ServiceHealth[];
  nextCheckAt?: string;
  failures?: number;
}
export const HEALTH_FRESH_MS = 10 * 60_000;
export const HEALTH_INTERVAL_MS = 5 * 60_000;
export function isFresh(at: string | undefined, now = Date.now()): boolean {
  const age = now - Date.parse(at ?? "");
  return Number.isFinite(age) && age >= 0 && age <= HEALTH_FRESH_MS;
}
export function evidence(state: EvidenceState, detail: string, source: string, observedAt?: string): HealthEvidence {
  return { state, detail, source, observedAt };
}
export function summarize(service: ServiceHealth, now = Date.now()): ServiceHealth {
  if (service.level === "off") return service;
  const parts = [service.authentication, service.quota, service.provider, service.feature];
  const fresh = parts.filter((p) => p && isFresh(p.observedAt, now));
  const failure = fresh.find((p) => p?.state === "error");
  const limited = fresh.find((p) => p?.state === "limited");
  // A metadata endpoint / public status page never proves a customer workflow.
  const complete = parts.every((p) => p?.state === "ok" && isFresh(p.observedAt, now));
  return { ...service, level: failure ? "down" : limited ? "degraded" : complete ? "ok" : "unknown",
    reason: failure?.detail ?? limited?.detail ?? (complete ? "All monitored dimensions verified" : "End-to-end availability is not verified") };
}
export function freshReport(report: HealthReport, now = Date.now()): HealthReport {
  const services = report.services.map((s) => summarize(s, now));
  const rank: Record<HealthLevel, number> = { ok: 0, off: 0, unknown: 1, degraded: 2, down: 3 };
  const worst = services.filter((s) => !s.optional).reduce<HealthLevel>((a, s) => rank[s.level] > rank[a] ? s.level : a, services.length ? "ok" : "unknown");
  return { ...report, services, worst };
}
