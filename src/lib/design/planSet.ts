// THE PLAN SET, READ FOR ITS SPACES (Home Design Studio, 2026-10-18). Owner: "ask what room you want to design and
// then you find it in the plan … offer all spaces that plan has and you select either all or one — super smart."
//
// Every sheet's own text is read for two things:
//   · the floor plans — a drawing title such as "MAIN FLOOR PLAN", "UPPER FLOOR PLAN", "SPANISH STYLE FLOOR PLAN"
//     (never a framing, foundation, roof, electrical, reflected-ceiling, site or utility plan, never a detail);
//     a title naming a level (main, upper, second, basement…) makes it a FLOOR of the house; one without (a style, an
//     option) makes it one of several ALTERNATIVE plans;
//   · the rooms drawn on each — the labels a plan prints ("MASTER" over "BEDROOM" is one room: Master bedroom), with
//     the size printed under the name when there is one ("13'-6\" X 12'-0\"") — never a spec table's "BEDROOM(S): 1",
//     a note, or a code section.
// A sheet holding two plans gives each its own rooms (the nearest title). The rooms of one plan also say where that
// plan sits on the sheet (the box to read when the sheet keeps no CAD layers). Pure.
import type { SheetText } from "./planRead";

export type FoundRoom = { name: string; at: { x: number; y: number }; h: number; size?: string; sqft?: number; /** Its extent on the sheet (points), when the picture was read for it. */ box?: { x0: number; y0: number; x1: number; y1: number } };
export type PlanTitle = { title: string; level: string | null; order: number; at: { x: number; y: number }; h: number };
export type SheetClass = { score: number; plans: PlanTitle[]; rooms: FoundRoom[]; why: string };

export type FloorPlan = {
  key: string;
  sheetKey: string;
  fileName: string;
  page: number;
  /** "Main floor", "Upper floor", "Spanish style floor plan". */
  name: string;
  /** A level of the house (floors stack into a whole house); null: an alternative plan. */
  level: string | null;
  order: number;
  rooms: FoundRoom[];
  /** Where this plan sits on the sheet (points), from its rooms and title — null when the sheet says too little. */
  region: { x: number; y: number; w: number; h: number } | null;
  /** The scale as printed, when it was read from the picture (a sheet without words). */
  scale?: string | null;
  /** Found by looking at the sheet (the vision model), not by its words. */
  seen?: boolean;
};

/** A floor plan the vision model found on a sheet without words (2026-10-18): its title's level and name, its rooms
 *  where their labels sit (fractions of the sheet → points), the drawing's box, the printed scale. Two labels of one
 *  name ("WIC" twice) are told apart ("Walk-in closet", "Walk-in closet 2"). */
export function floorFromVision(sheet: { key: string; fileName: string; page: number; width: number; height: number }, tri: { title: string | null; level: string | null }, read: { rooms: Array<{ name: string; x: number; y: number; size: string | null; box?: [number, number, number, number] | null }>; box: [number, number, number, number] | null; scale: string | null } | null): FloorPlan {
  const lv = levelOf(tri.title ?? (tri.level ? `${tri.level} floor plan` : "floor plan"));
  const seen = new Map<string, number>();
  const rooms: FoundRoom[] = (read?.rooms ?? []).map((r) => {
    const base = roomName(r.name);
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    const rb = r.box ? { x0: r.box[0] * sheet.width, y0: r.box[1] * sheet.height, x1: r.box[2] * sheet.width, y1: r.box[3] * sheet.height } : null;
    return { name: n > 1 ? `${base} ${n}` : base, at: { x: r.x * sheet.width, y: r.y * sheet.height }, h: 10, ...(r.size ? { size: r.size } : {}), ...(rb ? { box: rb } : {}) };
  });
  const b = read?.box;
  const pad = 0.015;
  const region = b ? { x: Math.max(0, (b[0] - pad) * sheet.width), y: Math.max(0, (b[1] - pad) * sheet.height), w: Math.min(1, b[2] - b[0] + 2 * pad) * sheet.width, h: Math.min(1, b[3] - b[1] + 2 * pad) * sheet.height } : null;
  return { key: `${sheet.key}~v`, sheetKey: sheet.key, fileName: sheet.fileName, page: sheet.page, name: lv.name, level: lv.level, order: lv.order, rooms, region, scale: read?.scale ?? null, seen: true };
}

/* ── Words ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

const ROOM =
  /\b(kitchen|living|dining|family|great\s*room|bed\s*room|bedroom|bed\s*rm|br|master|primary|owner'?s?\s*suite|suite|bath(room)?|powder|laundry|utility|mud\s*room|mudroom|pantry|closet|clos|clo|w\.?\s*i\.?\s*c\.?|walk[-\s]*in|garage|entry|foyer|hall(way)?|office|den|study|nook|bonus|media|theater|rec(reation)?\s*room|game\s*room|loft|mech(anical)?(\s*room)?|storage|stor|gym|flex|sun\s*room|sunroom|breakfast|butler'?s?|wine|library|nursery|guest|play\s*room|porch|patio|deck|vestibule|toilet|wc|shower|dressing|craft|workshop|exercise)\b/i;
// A label, not a note, a spec table, a code section or a fixture.
const NOT_ROOM =
  /plan|note|scale|\bsee\b|\bper\b|\btyp\b|faucet|code|exhaust|condens|\bdoor\b|req\.?|minimum|cabinets?\b|layout|detail|legend|measures|table|section|shall|\bfan\b|mandatory|water\s*closets?|fixture|existing|residence|cover\(|\(s\)|approved|limited|vent|disconnect|\bsf\b.*\bsf\b|electrical|panel|meter|smoke|alarm|heater|furnace|window|skylight|header|beam|joist|hardware|sheathing/i;
const QUALIFIER = /^(master|primary|owner'?s?|guest|main|half|powder|walk[-\s]*in|w\.?\s*i\.?|kids'?|breakfast|family|great|living|dining|bath|bathroom|bedroom|bed|room|suite|closet|nook|area|laundry|mud|rec|game|media|bonus|sun|butler'?s?|wine|play|entry|\d|#\s*\d|no\.\s*\d)$/i;
const PLAN_TITLE = /\b(floor|level)\s*plan\b|\b(basement|lower\s*level|upper\s*level|main\s*level|garage)\s+plan\b/i;
const NOT_FLOOR =
  /framing|foundation|roof|electrical|lighting|power|reflected|ceiling|plumbing|mechanical|hvac|demo(lition)?|site|energy|structural|shear|truss|joist|utility|enlarged|partial|furniture|key\s*plan|grading|landscape|irrigation|fire|sprinkler|life\s*safety|egress\s*plan|slab|floor\s*framing|at\s+(wall|intersect)|elevations?|schedules?|sections?|index|sheet/i;
// A sheet index line ("A1.0-s Spanish style floor plan, elevations, schedules") starts with a sheet number.
const SHEET_NO = /^[A-Z]{1,2}-?\d{1,2}(\.\d{1,2})?(-?[a-z])?\b/;
const DIM_PAIR = /(\d{1,2}\s*'\s*-?\s*\d{0,2}(?:\s*\d\/\d)?\s*"?)\s*[xX×]\s*(\d{1,2}\s*'\s*-?\s*\d{0,2}(?:\s*\d\/\d)?\s*"?)/;
const AREA = /(\d{2,4}(?:,\d{3})?)\s*(?:sq\.?\s*ft\.?|s\.?\s*f\.?|sf)\b/i;

/** The level a title names, its display name and its place in the house (main first, basement last). */
export function levelOf(title: string): { level: string | null; name: string; order: number } {
  const t = title.toLowerCase();
  const clean = titleCase(title.replace(/\|/g, " ").replace(/\s+/g, " ").trim());
  if (/\b(main|first|1st|ground|entry)\s*(floor|level)\b|\bmain\s+level\b|\blevel\s*1\b/.test(t)) return { level: "main", name: "Main floor", order: 1 };
  if (/\b(second|2nd|upper)\s*(floor|level)\b|\blevel\s*2\b|\bupper\s+level\b/.test(t)) return { level: "upper", name: "Upper floor", order: 2 };
  if (/\b(third|3rd)\s*(floor|level)\b|\blevel\s*3\b/.test(t)) return { level: "third", name: "Third floor", order: 3 };
  if (/\bbasement\b/.test(t)) return { level: "basement", name: "Basement", order: 4 };
  if (/\blower\s*(floor|level)\b/.test(t)) return { level: "lower", name: "Lower level", order: 4 };
  if (/\b(attic|loft|bonus)\b/.test(t)) return { level: "attic", name: clean, order: 5 };
  if (/\bgarage\b/.test(t)) return { level: "garage", name: "Garage", order: 6 };
  return { level: null, name: clean || "Floor plan", order: 9 };
}

export function titleCase(s: string): string {
  const small = new Set(["a", "an", "and", "at", "of", "or", "the", "to", "in", "on"]);
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.replace(/^([("']*)(\p{L})/u, (_, p: string, c: string) => p + c.toUpperCase())))
    .join(" ");
}

/** A room's name as people say it: "(N) BEDROOM 1" → "Bedroom 1", "MSTR. BATH" → "Master bath". */
export function roomName(raw: string): string {
  const s = raw
    .replace(/\((n|e|new|exist\.?|existing|optional|opt\.?)\)/gi, "")
    .replace(/\bmstr\b\.?/gi, "master")
    .replace(/\bbed\s*rm\b\.?/gi, "bedroom")
    .replace(/\bbdrm\b\.?/gi, "bedroom")
    .replace(/\bbr\b\.?/gi, "bedroom")
    .replace(/\bliv\b\.?/gi, "living")
    .replace(/\bdin\b\.?/gi, "dining")
    .replace(/\bkit\b\.?/gi, "kitchen")
    .replace(/\bclos?\b\.?/gi, "closet")
    .replace(/\bstor\b\.?/gi, "storage")
    .replace(/\bmech\b\.?/gi, "mechanical")
    .replace(/[:;]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  // Said as people write it: "Master bedroom", "Walk-in closet", "Bedroom 2".
  const t = s.toLowerCase().replace(/\bw\.?\s*i\.?\s*c\.?/g, "walk-in closet").replace(/\bwc\b/g, "WC");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* ── One sheet ─────────────────────────────────────────────────────────────────────────────────────────────────── */

type Line = { str: string; x: number; y: number; h: number; x1: number };

/** The sheet's text as lines: items on one baseline, close together, joined ("MAIN FLOOR" + "PLAN"). */
function linesOf(texts: SheetText[]): Line[] {
  const items = texts.filter((t) => t.str.trim()).map((t) => ({ str: t.str.trim(), x: t.x, y: t.y, h: t.h ?? 8 }));
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Line[] = [];
  const used = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const a = items[i];
    let line: Line = { str: a.str, x: a.x, y: a.y, h: a.h, x1: a.x + a.str.length * a.h * 0.6 };
    used.add(i);
    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j)) continue;
      const b = items[j];
      if (Math.abs(b.y - line.y) > line.h * 0.4) {
        if (b.y - line.y > line.h) break;
        continue;
      }
      if (Math.abs(b.h - line.h) > line.h * 0.35) continue;
      const gap = b.x - line.x1;
      if (gap < -line.h || gap > line.h * 1.8) continue;
      line = { ...line, str: `${line.str} ${b.str}`, x1: Math.max(line.x1, b.x + b.str.length * b.h * 0.6) };
      used.add(j);
    }
    out.push(line);
  }
  return out;
}

export function classifySheet(texts: SheetText[], width: number, height: number): SheetClass {
  const lines = linesOf(texts);
  const why: string[] = [];
  // Drawing titles that name a floor plan.
  const plans: PlanTitle[] = [];
  for (const l of lines) {
    if (l.str.length > 70 || !PLAN_TITLE.test(l.str) || NOT_FLOOR.test(l.str) || SHEET_NO.test(l.str)) continue;
    // A sentence in the notes that happens to say "floor plan" is not a title.
    if (/\b(shall|see|per|refer|provide|verify|as\s+shown|on\s+the|this|these|approved)\b/i.test(l.str)) continue;
    const lv = levelOf(l.str);
    plans.push({ title: l.str.replace(/\s*\|\s*$/, ""), level: lv.level, order: lv.order, at: { x: (l.x + l.x1) / 2, y: l.y }, h: l.h });
  }
  // The drawing's own title, and the title block's: a plain "FLOOR PLAN" on the drawing takes the title block's more
  // telling name ("Spanish style floor plan"); the title block's never stands beside the drawing's as a second plan.
  const inBlock = (p: PlanTitle) => p.at.x >= width * 0.86 || (p.at.x >= width * 0.6 && p.at.y >= height * 0.85);
  const drawn = plans.filter((p) => !inBlock(p));
  const block = plans.filter(inBlock);
  if (drawn.length) {
    if (block.length === 1 && drawn.length === 1 && /^floor\s*plan$/i.test(drawn[0].title.trim())) {
      const lv = levelOf(block[0].title);
      drawn[0] = { ...drawn[0], title: block[0].title, level: lv.level, order: lv.order };
    }
    plans.splice(0, plans.length, ...drawn);
  }
  // One title can be printed twice (the drawing and the title block): keep the larger.
  const seen = new Set<string>();
  const plansU = [...plans]
    .sort((a, b) => b.h - a.h)
    .filter((p) => {
      const k = levelOf(p.title).name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  // Room labels, stacked words joined, sizes under them.
  // (An open room is often labelled with its parts: "ENTRY / LIVING ROOM / KITCHEN / DINING".)
  const cand = lines.filter((l) => {
    const slashed = l.str.includes("/");
    return l.str.length <= (slashed ? 52 : 32) && ROOM.test(l.str) && !NOT_ROOM.test(l.str) && !/:\s*[-\d]/.test(l.str) && !/\d\.\d/.test(l.str) && l.str.split(/\s+/).length <= (slashed ? 9 : 5);
  });
  const rooms: FoundRoom[] = [];
  const taken = new Set<Line>();
  for (const c of cand) {
    if (taken.has(c)) continue;
    taken.add(c);
    const cx = (c.x + c.x1) / 2;
    let parts: Line[] = [c];
    // A qualifier word on the line above or below ("MASTER" / "BEDROOM", "BEDROOM" / "#2").
    for (const dir of [-1, 1]) {
      const edge = dir < 0 ? parts[0] : parts[parts.length - 1];
      const near = lines.find((o) => o !== c && !taken.has(o) && !parts.includes(o) && Math.abs(o.h - c.h) <= c.h * 0.3 && Math.abs((o.x + o.x1) / 2 - cx) <= c.h * 3 && (dir < 0 ? edge.y - o.y : o.y - edge.y) > c.h * 0.4 && (dir < 0 ? edge.y - o.y : o.y - edge.y) <= c.h * 1.7 && o.str.split(/\s+/).every((w) => QUALIFIER.test(w) || ROOM.test(w)));
      if (near) {
        taken.add(near);
        parts = dir < 0 ? [near, ...parts] : [...parts, near];
      }
    }
    const name = roomName(parts.map((p) => p.str).join(" "));
    if (!name || name.length < 3) continue;
    const bottom = parts[parts.length - 1];
    const sizeLine = lines.find((o) => o.y > bottom.y && o.y - bottom.y <= c.h * 3 && Math.abs((o.x + o.x1) / 2 - cx) <= c.h * 5 && (DIM_PAIR.test(o.str) || AREA.test(o.str)));
    const dm = sizeLine?.str.match(DIM_PAIR);
    const am = sizeLine?.str.match(AREA);
    const at = { x: cx, y: (parts[0].y + bottom.y) / 2 };
    if (rooms.some((r) => r.name === name && Math.hypot(r.at.x - at.x, r.at.y - at.y) < c.h * 2)) continue;
    rooms.push({ name, at, h: c.h, ...(dm ? { size: `${dm[1].replace(/\s+/g, "")} × ${dm[2].replace(/\s+/g, "")}` } : {}), ...(am ? { sqft: Number(am[1].replace(/,/g, "")) } : {}) });
  }
  // Paragraph notes: a notes or spec sheet, not a plan.
  const prose = texts.filter((t) => t.str.length > 60).length;
  const titleBlock = lines.filter((l) => l.x >= width * 0.86 || (l.x >= width * 0.6 && l.y >= height * 0.8)).map((l) => l.str).join(" ");
  let score = 0;
  if (plansU.length) {
    score += 6;
    why.push(plansU.map((p) => levelOf(p.title).name).join(" · "));
  }
  // Room names alone (a load calculation or a schedule lists them too) say little without a plan's title.
  score += Math.min(rooms.length, 14) * (plansU.length ? 0.6 : 0.15);
  if (rooms.length) why.push(`${rooms.length} room${rooms.length === 1 ? "" : "s"}`);
  score -= Math.min(prose, 60) * 0.08;
  if (!plansU.length && NOT_FLOOR.test(titleBlock)) score -= 3;
  return { score: Math.round(score * 10) / 10, plans: plansU, rooms, why: why.join(" · ") };
}

/* ── The whole set ─────────────────────────────────────────────────────────────────────────────────────────────── */

export type SheetForSet = { key: string; fileName: string; page: number; width: number; height: number; texts: SheetText[]; cls?: SheetClass };

/** Every floor plan in the set, one per floor (or per alternative), the main floor first. */
export function findFloorPlans(sheets: SheetForSet[]): FloorPlan[] {
  const out: FloorPlan[] = [];
  for (const s of sheets) {
    const cls = s.cls ?? classifySheet(s.texts, s.width, s.height);
    if (!cls.plans.length) continue;
    // Each room to the plan whose title is nearest — a title sits under (or beside) its drawing.
    const byPlan = cls.plans.map(() => [] as FoundRoom[]);
    for (const r of cls.rooms) {
      if (r.at.x >= s.width * 0.88) continue; // the title block's own words
      let best = 0;
      let bestD = Infinity;
      cls.plans.forEach((p, i) => {
        const below = p.at.y >= r.at.y - p.h * 2 ? 0 : s.height * 0.25; // a title above its rooms is the next drawing's
        const d = Math.abs(p.at.x - r.at.x) + Math.abs(p.at.y - r.at.y) * 0.35 + below;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      byPlan[best].push(r);
    }
    cls.plans.forEach((p, i) => {
      const lv = levelOf(p.title);
      const rooms = byPlan[i];
      let region: FloorPlan["region"] = null;
      if (rooms.length >= 2) {
        const xs = [...rooms.map((r) => r.at.x), p.at.x];
        const ys = [...rooms.map((r) => r.at.y), p.at.y];
        const w0 = Math.max(...xs) - Math.min(...xs);
        const h0 = Math.max(...ys) - Math.min(...ys);
        // Labels sit mid-room: the outside walls are half a room (and the dimension strings more) beyond them.
        const pad = Math.max(160, 0.3 * Math.max(w0, h0));
        const x = Math.max(0, Math.min(...xs) - pad);
        const y = Math.max(0, Math.min(...ys) - pad);
        region = { x, y, w: Math.min(s.width * 0.88, Math.max(...xs) + pad) - x, h: Math.min(s.height, Math.max(...ys) + pad) - y };
      }
      out.push({ key: `${s.key}~${i}`, sheetKey: s.key, fileName: s.fileName, page: s.page, name: lv.name, level: lv.level, order: lv.order, rooms, region });
    });
  }
  // One plan a name: a floor drawn again on another sheet (a dimension plan, an option) keeps the one with more rooms;
  // the same name in two files stays apart (two houses dropped together).
  const best = new Map<string, FloorPlan>();
  for (const f of out) {
    const k = `${f.fileName}|${f.name.toLowerCase()}`;
    const cur = best.get(k);
    if (!cur || f.rooms.length > cur.rooms.length) best.set(k, f);
  }
  return [...best.values()].sort((a, b) => a.order - b.order || a.fileName.localeCompare(b.fileName) || a.page - b.page);
}

/** True when the plans found are floors of one house (two or more levels) — so "the whole house" means them all. */
export const isMultiFloor = (floors: FloorPlan[]) => new Set(floors.filter((f) => f.level).map((f) => `${f.fileName}|${f.level}`)).size >= 2;

/* ── Finding a room by what people call it ─────────────────────────────────────────────────────────────────────── */

const SYNONYMS: Array<[RegExp, string]> = [
  [/\b(primary|owner'?s?|main)\b/g, "master"],
  [/\bbed\s*room\b|\bbdrm\b|\bbr\b/g, "bedroom"],
  [/\bbathroom\b|\bba\b/g, "bath"],
  [/\bhalf\s*bath\b|\bpowder\s*room\b/g, "powder"],
  [/\bfamily\s*room\b|\bgreat\s*room\b|\bliving\s*room\b|\blounge\b/g, "living"],
  [/\bwalk[-\s]*in\s*closet\b|\bw\.?i\.?c\.?\b/g, "closet"],
  [/\bdining\s*room\b/g, "dining"],
  [/\blaundry\s*room\b|\butility\s*room\b/g, "laundry"],
  [/\bmudroom\b/g, "mud room"],
  [/\bstudy\b|\bden\b/g, "office"],
];
const norm = (s: string) => {
  let t = ` ${s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ")} `;
  for (const [re, to] of SYNONYMS) t = t.replace(re, to);
  return t.replace(/\s+/g, " ").trim();
};

/** How well a room's name answers what was typed (0: not at all, 1: the same). */
export function matchScore(query: string, name: string): number {
  const q = norm(query).split(" ").filter(Boolean);
  const n = norm(name).split(" ").filter(Boolean);
  if (!q.length) return 0;
  const hit = q.filter((w) => n.some((x) => x === w || (w.length >= 3 && x.startsWith(w)))).length;
  if (!hit) return 0;
  return hit / q.length - Math.max(0, n.length - hit) * 0.05;
}

/** The rooms that answer a query, best first. */
export function findSpaces(query: string, floors: FloorPlan[]): Array<{ floor: FloorPlan; room: FoundRoom; score: number }> {
  return floors
    .flatMap((floor) => floor.rooms.map((room) => ({ floor, room, score: matchScore(query, room.name) })))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score || a.floor.order - b.floor.order);
}

/** Two room names for the same room? ("Master bedroom" / "Primary Bedroom", "Bedroom 2" / "Bedroom #2"). */
export const sameRoom = (a: string, b: string) => norm(a).replace(/#/g, "") === norm(b).replace(/#/g, "");
