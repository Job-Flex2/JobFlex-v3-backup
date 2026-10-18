// A design arriving from the browser, made safe to store (Home Design Studio, 2026-10-17): every number finite and in
// range, ids short and plain, lists capped — a plan with thousands of drawn fixture lines keeps the first few
// thousand. Pure.
import type { DesignDoc, MarkRole, Opening, OpeningKind, P, PlanMark, RoomLabel, Wall } from "./model";
import { DEFAULT_CEILING } from "./model";

const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const id = (v: unknown, prefix: string, i: number) => (typeof v === "string" && /^[\w-]{1,40}$/.test(v) ? v : `${prefix}${i}`);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");
const pt = (v: unknown): P => {
  const o = (v ?? {}) as { x?: unknown; y?: unknown };
  return { x: num(o.x, -100000, 100000, 0), y: num(o.y, -100000, 100000, 0) };
};

const KINDS: OpeningKind[] = ["door", "double", "slider", "pocket", "window", "opening"];
const ROLES: MarkRole[] = ["cabinet", "appliance", "plumbing"];
export const MAX_WALLS = 400;
export const MAX_OPENINGS = 400;
export const MAX_MARK_LINES = 6000;

export function normalizeDesign(raw: unknown): DesignDoc {
  const d = (raw ?? {}) as Partial<DesignDoc>;
  const walls: Wall[] = (Array.isArray(d.walls) ? d.walls : []).slice(0, MAX_WALLS).map((w, i) => ({
    id: id(w?.id, "w", i),
    a: pt(w?.a),
    b: pt(w?.b),
    thick: num(w?.thick, 1, 36, 4.5),
    height: num(w?.height, 36, 360, DEFAULT_CEILING),
    ...(w?.exterior ? { exterior: true } : {}),
    ...(w?.from === "plan" || w?.from === "drawn" ? { from: w.from } : {}),
  }));
  const wallIds = new Set(walls.map((w) => w.id));
  const openings: Opening[] = (Array.isArray(d.openings) ? d.openings : [])
    .slice(0, MAX_OPENINGS)
    .filter((o) => wallIds.has(String(o?.wallId)))
    .map((o, i) => ({
      id: id(o.id, "o", i),
      wallId: String(o.wallId),
      kind: KINDS.includes(o.kind) ? o.kind : "door",
      at: num(o.at, 0, 100000, 0),
      width: num(o.width, 6, 360, 32),
      height: num(o.height, 6, 200, 80),
      sill: num(o.sill, 0, 120, 0),
      ...(o.hinge === "a" || o.hinge === "b" ? { hinge: o.hinge } : {}),
      ...(o.swing === "left" || o.swing === "right" ? { swing: o.swing } : {}),
      ...(o.tag ? { tag: str(o.tag, 12) } : {}),
    }));
  const labels: RoomLabel[] = (Array.isArray(d.labels) ? d.labels : []).slice(0, 120).map((l, i) => ({
    id: id(l?.id, "r", i),
    name: str(l?.name, 60) || "Room",
    at: pt(l?.at),
    ...(l?.ceiling != null ? { ceiling: num(l.ceiling, 60, 360, DEFAULT_CEILING) } : {}),
    ...(l?.planSqFt != null ? { planSqFt: num(l.planSqFt, 0, 100000, 0) } : {}),
  }));
  let lineBudget = MAX_MARK_LINES;
  const marks: PlanMark[] = [];
  for (const [i, m] of (Array.isArray(d.marks) ? d.marks : []).entries()) {
    if (lineBudget <= 0) break;
    const lines = (Array.isArray(m?.lines) ? m.lines : []).slice(0, lineBudget).map((l) => [pt(l?.[0]), pt(l?.[1])] as [P, P]);
    lineBudget -= lines.length;
    const b = (m?.box ?? {}) as { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
    marks.push({
      id: id(m?.id, "m", i),
      role: ROLES.includes(m?.role) ? m.role : "cabinet",
      lines,
      box: { x: num(b.x, -100000, 100000, 0), y: num(b.y, -100000, 100000, 0), w: num(b.w, 0, 100000, 0), h: num(b.h, 0, 100000, 0) },
      ...(m?.label ? { label: str(m.label, 40) } : {}),
    });
  }
  const src = (d.source ?? {}) as NonNullable<DesignDoc["source"]>;
  const kind = src.kind === "pdf" || src.kind === "image" || src.kind === "drawn" ? src.kind : "drawn";
  return {
    v: 1,
    title: str(d.title, 120) || "New design",
    walls,
    openings,
    labels,
    marks,
    focus: typeof d.focus === "string" && labels.some((l) => l.id === d.focus) ? d.focus : null,
    source: {
      kind,
      ...(src.fileName ? { fileName: str(src.fileName, 160) } : {}),
      ...(src.page ? { page: num(src.page, 1, 999, 1) } : {}),
      ...(src.scaleText ? { scaleText: str(src.scaleText, 40) } : {}),
      ...(src.scaleBy && ["title", "areas", "calibrated", "assumed"].includes(src.scaleBy) ? { scaleBy: src.scaleBy } : {}),
      ...(src.layers ? { layers: true } : {}),
    },
  };
}
