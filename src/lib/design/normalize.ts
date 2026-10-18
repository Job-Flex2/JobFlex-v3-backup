// A design arriving from the browser, made safe to store (Home Design Studio, 2026-10-17): every number finite and in
// range, ids short and plain, lists capped — a plan with thousands of drawn fixture lines keeps the first few
// thousand. Pure.
import type { DesignDoc, DesignItem, EngineeringState, Finishes, MarkRole, Opening, OpeningKind, P, PlanMark, RoomLabel, Wall } from "./model";
import { DEFAULT_CEILING } from "./model";
import { DEFAULT_FINISHES, lib } from "./library";

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
export const MAX_ITEMS = 600;

const hex = (v: unknown, dflt: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : dflt);
const oneOf = <T extends string>(v: unknown, list: readonly T[], dflt: T): T => (list.includes(v as T) ? (v as T) : dflt);

function normalizeItems(raw: unknown, wallIds: Set<string>, labelIds: Set<string>): DesignItem[] {
  return (Array.isArray(raw) ? raw : [])
    .slice(0, MAX_ITEMS)
    .filter((it) => it && typeof it.lib === "string" && !!lib(it.lib))
    .map((it, i) => {
      const opts: Record<string, string | number | boolean> = {};
      if (it.opts && typeof it.opts === "object")
        for (const [k, v] of Object.entries(it.opts as Record<string, unknown>).slice(0, 12))
          if (/^[a-z]{1,20}$/i.test(k) && (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= 30))) opts[k] = v as string | number | boolean;
      return {
        id: id(it.id, "i", i),
        lib: it.lib as string,
        x: num(it.x, -100000, 100000, 0),
        y: num(it.y, -100000, 100000, 0),
        rot: num(it.rot, -360, 360, 0),
        w: num(it.w, 1, 240, 24),
        d: num(it.d, 1, 120, 24),
        h: num(it.h, 0.5, 144, 34.5),
        z: num(it.z, 0, 144, 0),
        wallId: typeof it.wallId === "string" && wallIds.has(it.wallId) ? it.wallId : null,
        room: typeof it.room === "string" && labelIds.has(it.room) ? it.room : null,
        ...(Object.keys(opts).length ? { opts } : {}),
      };
    });
}

function normalizeFinishes(raw: unknown, labelIds: Set<string>, wallIds: Set<string>): Record<string, Finishes> {
  const out: Record<string, Finishes> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [room, v] of Object.entries(raw as Record<string, Partial<Finishes>>)) {
    if (!labelIds.has(room) || !v || typeof v !== "object") continue;
    const D = DEFAULT_FINISHES;
    out[room] = {
      wall: {
        color: hex(v.wall?.color, D.wall.color),
        name: str(v.wall?.name, 40) || D.wall.name,
        ...(v.wall?.code ? { code: str(v.wall.code, 40) } : {}),
        sheen: oneOf(v.wall?.sheen, ["flat", "eggshell", "satin", "semi"] as const, D.wall.sheen),
        texture: oneOf(v.wall?.texture, ["smooth", "orange", "knockdown", "skim"] as const, D.wall.texture),
      },
      accents: (Array.isArray(v.accents) ? v.accents : []).filter((a) => a && wallIds.has(String(a.wallId))).slice(0, 20).map((a) => ({ wallId: String(a.wallId), color: hex(a.color, D.wall.color), name: str(a.name, 40), ...(a.code ? { code: str(a.code, 40) } : {}) })),
      floor: { id: str(v.floor?.id, 40) || D.floor.id, pattern: oneOf(v.floor?.pattern, ["straight", "diagonal", "herringbone", "grid", "offset"] as const, D.floor.pattern), angle: num(v.floor?.angle, -180, 180, 0) },
      cabinets: {
        style: oneOf(v.cabinets?.style, ["shaker", "slab", "raised"] as const, D.cabinets.style),
        color: hex(v.cabinets?.color, D.cabinets.color),
        name: str(v.cabinets?.name, 40) || D.cabinets.name,
        ...(v.cabinets?.island ? { island: hex(v.cabinets.island, D.cabinets.color), islandName: str(v.cabinets.islandName, 40) } : {}),
        ...(v.cabinets?.uppers ? { uppers: hex(v.cabinets.uppers, D.cabinets.color), uppersName: str(v.cabinets.uppersName, 40) } : {}),
      },
      counter: { id: str(v.counter?.id, 40) || D.counter.id, edge: oneOf(v.counter?.edge, ["eased", "bevel", "ogee", "bullnose"] as const, D.counter.edge) },
      backsplash: { id: str(v.backsplash?.id, 40) || D.backsplash.id, height: oneOf(v.backsplash?.height, ["4in", "18in", "full"] as const, D.backsplash.height) },
      hardware: { kind: oneOf(v.hardware?.kind, ["bar", "knob", "cup"] as const, D.hardware.kind), finish: oneOf(v.hardware?.finish, ["black", "brass", "nickel", "chrome"] as const, D.hardware.finish) },
    };
  }
  return out;
}

function normalizeWalls(raw: unknown): Wall[] {
  return (Array.isArray(raw) ? (raw as Partial<Wall>[]) : []).slice(0, MAX_WALLS).map((w, i) => ({
    id: id(w?.id, "w", i),
    a: pt(w?.a),
    b: pt(w?.b),
    thick: num(w?.thick, 1, 36, 4.5),
    height: num(w?.height, 36, 360, DEFAULT_CEILING),
    ...(w?.exterior ? { exterior: true } : {}),
    ...(w?.from === "plan" || w?.from === "drawn" ? { from: w.from } : {}),
    ...(w?.floor ? { floor: str(w.floor, 40) } : {}),
  }));
}

function normalizeOpenings(raw: unknown, wallIds: Set<string>): Opening[] {
  return (Array.isArray(raw) ? (raw as Partial<Opening>[]) : [])
    .slice(0, MAX_OPENINGS)
    .filter((o) => wallIds.has(String(o?.wallId)))
    .map((o, i) => ({
      id: id(o.id, "o", i),
      wallId: String(o.wallId),
      kind: KINDS.includes(o.kind as OpeningKind) ? (o.kind as OpeningKind) : "door",
      at: num(o.at, 0, 100000, 0),
      width: num(o.width, 6, 360, 32),
      height: num(o.height, 6, 200, 80),
      sill: num(o.sill, 0, 120, 0),
      ...(o.hinge === "a" || o.hinge === "b" ? { hinge: o.hinge } : {}),
      ...(o.swing === "left" || o.swing === "right" ? { swing: o.swing } : {}),
      ...(o.tag ? { tag: str(o.tag, 12) } : {}),
    }));
}

const SITE_ABOVE = ["roof", "floor", "unknown"] as const;
const SITE_ROOF = ["trusses", "rafters", "unknown"] as const;
const SITE_BELOW = ["slab", "crawl", "basement", "unknown"] as const;

/** The house as it stood, what the contractor found on site, the engineering request's state (milestone 5). */
function normalizeStructure(d: Partial<DesignDoc>): Pick<DesignDoc, "existing" | "structure" | "engineering"> {
  const out: Pick<DesignDoc, "existing" | "structure" | "engineering"> = {};
  const ex = d.existing as { walls?: unknown; openings?: unknown; at?: unknown } | undefined;
  if (ex && typeof ex === "object" && Array.isArray(ex.walls)) {
    const walls = normalizeWalls(ex.walls);
    out.existing = { walls, openings: normalizeOpenings(ex.openings, new Set(walls.map((w) => w.id))), at: str(ex.at, 40) || new Date(0).toISOString() };
  }
  if (d.structure && typeof d.structure === "object") {
    const s: Record<string, "bearing" | "not"> = {};
    for (const [k, v] of Object.entries(d.structure).slice(0, MAX_WALLS)) if (v === "bearing" || v === "not") s[str(k, 40)] = v;
    if (Object.keys(s).length) out.structure = s;
  }
  const e = d.engineering as EngineeringState | undefined;
  if (e && typeof e === "object") {
    const site = e.site && typeof e.site === "object" ? e.site : {};
    const eng: EngineeringState = {
      site: {
        ...(site.above ? { above: oneOf(site.above, SITE_ABOVE, "unknown") } : {}),
        ...(site.roof ? { roof: oneOf(site.roof, SITE_ROOF, "unknown") } : {}),
        ...(site.below ? { below: oneOf(site.below, SITE_BELOW, "unknown") } : {}),
      },
      ...(e.request && typeof e.request.token === "string" ? { request: { token: str(e.request.token, 64), to: str(e.request.to, 200), sentAt: str(e.request.sentAt, 40) } } : {}),
    };
    out.engineering = eng;
  }
  return out;
}

export function normalizeDesign(raw: unknown): DesignDoc {
  const d = (raw ?? {}) as Partial<DesignDoc>;
  const walls = normalizeWalls(d.walls);
  const wallIds = new Set(walls.map((w) => w.id));
  const openings = normalizeOpenings(d.openings, wallIds);
  const labels: RoomLabel[] = (Array.isArray(d.labels) ? d.labels : []).slice(0, 120).map((l, i) => ({
    id: id(l?.id, "r", i),
    name: str(l?.name, 60) || "Room",
    at: pt(l?.at),
    ...(l?.ceiling != null ? { ceiling: num(l.ceiling, 60, 360, DEFAULT_CEILING) } : {}),
    ...(l?.planSqFt != null ? { planSqFt: num(l.planSqFt, 0, 100000, 0) } : {}),
    ...(l?.floor ? { floor: str(l.floor, 40) } : {}),
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
  const labelIds = new Set(labels.map((l) => l.id));
  const items = normalizeItems(d.items, wallIds, labelIds);
  const finishes = normalizeFinishes(d.finishes, labelIds, wallIds);
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
    ...(items.length ? { items } : {}),
    ...(Object.keys(finishes).length ? { finishes } : {}),
    ...(d.estimate && typeof d.estimate === "object"
      ? {
          estimate: {
            scope: d.estimate.scope === "new" ? ("new" as const) : ("remodel" as const),
            roughIn: d.estimate.roughIn !== false,
            permits: d.estimate.permits !== false,
            appliances: d.estimate.appliances === "allowance" ? ("allowance" as const) : ("owner" as const),
            ...(d.estimate.address ? { address: str(d.estimate.address, 300) } : {}),
            ...(d.estimate.title ? { title: str(d.estimate.title, 160) } : {}),
          },
        }
      : {}),
    ...normalizeStructure(d),
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
