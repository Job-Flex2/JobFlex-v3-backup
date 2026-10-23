// THE LIVE VIEW'S SOUNDS (owner, 2026-10-23: "make sound when someone is signing up, and before, close to it, like
// adding a card"). Pure: given what the last poll had seen and the new live report, which moments are new —
// a visitor who has just reached the checkout ("card"), a sign-up that was not there before ("signup"). The first
// report only remembers, so opening the page never plays a sound for everyone already on it — and with `since`
// (when the page opened) a moment from before that stays quiet too: the page's first report can be a cached one
// up to a minute old, and the next poll would otherwise bring what happened in that minute as new.
import type { LiveReport, LiveStage } from "@/lib/traffic-live";

export type Chime = { kind: "card" | "signup"; key: string; who: string };
export type ChimeMemory = { stages: Map<string, LiveStage>; signups: Set<string> };

const placeOf = (v: { place?: string; city?: string; trade?: string }) =>
  [v.place || v.city || "", v.trade || ""].filter(Boolean).join(" · ") || "a visitor";

/** When it happened, in ms — or Infinity when the report does not say, so an undated moment still sounds. */
const when = (iso: string | null | undefined) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : Infinity; };

export function liveChimes(memory: ChimeMemory | null, report: Pick<LiveReport, "visitors" | "converted" | "otherSignups">, since = 0): { memory: ChimeMemory; chimes: Chime[] } {
  const first = memory === null;
  const next: ChimeMemory = memory ?? { stages: new Map(), signups: new Set() };
  const chimes: Chime[] = [];
  for (const v of report.visitors) {
    const key = v.id + "|" + v.firstAt;
    const was = next.stages.get(key);
    // Reaching the checkout is the moment; staying there, or coming back from a sign-up, is not.
    const reached = when(v.steps?.find((st) => st.kind === "checkout")?.at);
    if (!first && v.stage === "checkout" && was !== "checkout" && was !== "signed-up" && reached >= since) chimes.push({ kind: "card", key, who: placeOf(v) });
    next.stages.set(key, v.stage);
  }
  // One sign-up, wherever it is listed: the visit that made it, the day's converted list, or a sign-up with no visit.
  const signups: Array<{ key: string; who: string; at: number }> = [
    ...[...report.visitors, ...report.converted].filter((v) => v.stage === "signed-up").map((v) => ({ key: v.signup?.orgName || v.id, who: v.signup?.orgName || placeOf(v), at: when(v.signedUpAt ?? v.signup?.at) })),
    ...report.otherSignups.map((o) => ({ key: o.orgName, who: o.orgName, at: when(o.at) })),
  ];
  for (const s of signups) {
    if (next.signups.has(s.key)) continue;
    next.signups.add(s.key);
    if (!first && s.at >= since) chimes.push({ kind: "signup", key: s.key, who: s.who });
  }
  return { memory: next, chimes };
}
