// THE HOUSE'S STRUCTURE, READ FROM THE PLAN (Home Design Studio, milestone 5 — 2026-10-17). Owner: "even move some
// walls if it's not gonna destroy the structural, or request the engineering. Same thing for the windows."
//
// A plan doesn't say which walls carry the house — the joists, rafters and beams aren't on it — so this is a READING,
// with its reasons, never a determination:
//   · an outside wall carries the roof (and any floor above) down to the foundation: always bearing;
//   · floor joists and roof framing most often span the SHORT way across a house, so the interior walls that carry
//     them run the LONG way, near the middle of that span (or at its thirds in a wide house), and line up into one
//     long line through the house — those read "likely bearing";
//   · a wall running the short way (the way the joists run), or hugging an outside wall, reads "likely not";
//   · in a house narrow enough for joists or trusses to clear-span (14 ft or less), nothing inside is needed;
//   · anything else: "can't tell from the plan".
// What the contractor finds on site (the attic, the basement) outranks the reading. Then the design is compared with
// the house as it stood (doc.existing) — every wall taken out or moved, every new, wider or moved opening — and each
// change says what it needs: an engineer (a beam, a header in a bearing wall), a header from the code's tables, a
// look on site first, or nothing. Pure.
import type { DesignDoc, Opening, P, SiteFacts, Wall } from "./model";
import { ftIn } from "./model";
import { outsideWallIds, wallLen } from "./geometry";

export type BearingLevel = "outside" | "likely" | "unlikely" | "unknown" | "new";

export type WallReading = {
  wallId: string;
  level: BearingLevel;
  /** What the contractor found on site, when they have. */
  confirmed?: "bearing" | "not";
  /** Bearing as far as anyone knows: true, false, or null (not known yet). */
  bearing: boolean | null;
  reasons: string[];
  /** What to look at on site to settle it. */
  checks: string[];
  /** A thick interior wall: often plumbing. */
  plumbing?: string;
  /** The house's short span, feet (what the joists cross). */
  spanFt: number;
};

const NARROW_SPAN = 168; // 14 ft: joists and trusses clear-span it
const WIDE_SPAN = 336; // 28 ft: often two bearing lines

/** The plan's own axes: the angle most of its wall length runs at (mod 90°). */
function planAngle(walls: Wall[]): number {
  const bins = new Array<number>(90).fill(0);
  for (const w of walls) {
    const a = ((Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI + 360) % 90;
    bins[Math.round(a) % 90] += wallLen(w);
  }
  let best = 0;
  for (let i = 1; i < 90; i++) if (bins[i] > bins[best]) best = i;
  return (best * Math.PI) / 180;
}

const rot = (p: P, ang: number): P => ({ x: p.x * Math.cos(-ang) - p.y * Math.sin(-ang), y: p.x * Math.sin(-ang) + p.y * Math.cos(-ang) });

/** The walls as they stood (doc.existing), or as they are when the plan wasn't kept. */
export const standingWalls = (doc: DesignDoc): Wall[] => (doc.existing?.walls ?? doc.walls).filter((w) => !w.boundary);
const standingOpenings = (doc: DesignDoc): Opening[] => doc.existing?.openings ?? doc.openings;

/** Every standing wall read — each floor of a whole house on its own footprint. */
export function readStructure(doc: DesignDoc): Map<string, WallReading> {
  const all = standingWalls(doc);
  const floors = [...new Set(all.map((w) => w.floor ?? ""))];
  if (floors.length <= 1) return readFloorStructure(doc, all);
  const out = new Map<string, WallReading>();
  for (const f of floors) for (const [k, v] of readFloorStructure(doc, all.filter((w) => (w.floor ?? "") === f))) out.set(k, v);
  return out;
}

function readFloorStructure(doc: DesignDoc, walls: Wall[]): Map<string, WallReading> {
  const out = new Map<string, WallReading>();
  if (!walls.length) return out;
  const outer = outsideWallIds({ walls, labels: doc.labels });
  const isOut = (w: Wall) => !!w.exterior || outer.has(w.id);
  const ang = planAngle(walls);
  const rw = walls.map((w) => ({ w, a: rot(w.a, ang), b: rot(w.b, ang) }));
  const shell = rw.filter((r) => isOut(r.w));
  const box = (shell.length >= 3 ? shell : rw).flatMap((r) => [r.a, r.b]);
  const minX = Math.min(...box.map((p) => p.x));
  const maxX = Math.max(...box.map((p) => p.x));
  const minY = Math.min(...box.map((p) => p.y));
  const maxY = Math.max(...box.map((p) => p.y));
  const W = maxX - minX;
  const D = maxY - minY;
  const longX = W >= D;
  const span = Math.min(W, D);
  const long = Math.max(W, D);
  const spanFt = Math.round(span / 12);
  const confirmedOf = (id: string) => doc.structure?.[id];

  for (const r of rw) {
    const w = r.w;
    const reasons: string[] = [];
    const checks: string[] = [];
    let level: BearingLevel;
    let plumbing: string | undefined;
    const dx = r.b.x - r.a.x;
    const dy = r.b.y - r.a.y;
    const L = Math.hypot(dx, dy) || 1;
    const alongX = Math.abs(dy) / L < 0.17;
    const alongY = Math.abs(dx) / L < 0.17;
    if (isOut(w)) {
      level = "outside";
      reasons.push("An outside wall: it carries the roof — and any floor above — down to the foundation.");
      checks.push("Any opening in it needs a header sized for its span (IRC R602.7, or the engineer's size).", "It's likely a braced wall line: a wider opening has to keep enough braced panel length (IRC R602.10).");
    } else {
      const runsLong = longX ? alongX : alongY;
      const runsShort = longX ? alongY : alongX;
      // Where it sits across the short span, 0 at one outside wall and 1 at the other.
      const c = longX ? (r.a.y + r.b.y) / 2 : (r.a.x + r.b.x) / 2;
      const t = span > 0 ? (c - (longX ? minY : minX)) / span : 0.5;
      // The line it makes with the walls in line with it, as a share of the house's length.
      const line = rw.filter((o) => !isOut(o.w) && (longX ? Math.abs(o.b.y - o.a.y) / (wallLen(o.w) || 1) < 0.17 : Math.abs(o.b.x - o.a.x) / (wallLen(o.w) || 1) < 0.17) && Math.abs((longX ? (o.a.y + o.b.y) / 2 : (o.a.x + o.b.x) / 2) - c) <= 4);
      const spans = line.map((o) => (longX ? [Math.min(o.a.x, o.b.x), Math.max(o.a.x, o.b.x)] : [Math.min(o.a.y, o.b.y), Math.max(o.a.y, o.b.y)]) as [number, number]).sort((p, q) => p[0] - q[0]);
      let covered = 0;
      let end = -Infinity;
      for (const [s0, s1] of spans) {
        if (s1 <= end) continue;
        covered += s1 - Math.max(s0, end);
        end = s1;
      }
      const cover = long > 0 ? covered / long : 0;
      const mid = t >= 0.3 && t <= 0.7;
      const thirds = span > WIDE_SPAN && ((t >= 0.25 && t <= 0.42) || (t >= 0.58 && t <= 0.75));
      if (span <= NARROW_SPAN) {
        level = "unlikely";
        reasons.push(`The house is only about ${spanFt} ft across: joists and trusses usually span that without a wall in the middle.`);
      } else if (runsLong && (mid || thirds) && cover >= 0.5) {
        level = "likely";
        reasons.push(
          mid
            ? `It runs the long way through the middle of a ${spanFt} ft span — where floor joists, ceiling joists or rafters usually land halfway across.`
            : `It runs the long way at about a third of a ${spanFt} ft span — wide houses often have two bearing lines.`,
          `It lines up with the walls in line with it into ${ftIn(covered)} — ${Math.round(cover * 100)}% of the house's length.`,
        );
      } else if (runsShort) {
        level = "unlikely";
        reasons.push("It runs across the short span — the way the joists usually run, so they rarely rest on it.");
      } else if (runsLong && (t < 0.2 || t > 0.8)) {
        level = "unlikely";
        reasons.push("It runs close beside an outside wall — joists landing there have the outside wall already.");
      } else if (runsLong) {
        level = "unknown";
        reasons.push(mid || thirds ? `It sits near the middle of the span but is short — ${ftIn(covered)} in line, ${Math.round(cover * 100)}% of the house's length.` : "It runs the long way, but away from the middle of the span.");
      } else {
        level = "unknown";
        reasons.push("It runs at an angle to the house — a plan can't say what lands on it.");
      }
      checks.push(
        "In the attic: do the ceiling joists or rafters land on it, or lap and splice over it?",
        "Below (basement or crawlspace): is there a beam, a wall or posts right under it?",
        "In it: a doubled top plate with joists landing, solid headers over its doors, a post?",
        "Above it: a floor, a post or anything else bearing down?",
      );
      // Not a structural sign: a plumbing one.
      if (w.thick >= 6) plumbing = `${Math.round(w.thick * 10) / 10} in thick — thicker than a 2×4 partition, so often a plumbing wall (drains and vents): look before opening it.`;
    }
    out.set(w.id, finish(w.id, level, reasons, checks, spanFt, confirmedOf(w.id), plumbing));
  }
  return out;
}

function finish(wallId: string, level: BearingLevel, reasons: string[], checks: string[], spanFt: number, confirmed?: "bearing" | "not", plumbing?: string): WallReading {
  const bearing = confirmed === "bearing" ? true : confirmed === "not" ? false : level === "outside" || level === "likely" ? true : level === "unlikely" || level === "new" ? false : null;
  return { wallId, level, ...(confirmed ? { confirmed } : {}), bearing, reasons, checks, spanFt, ...(plumbing ? { plumbing } : {}) };
}

/** One wall's reading — a standing wall, or "new" for one drawn into the design. */
export function readWall(doc: DesignDoc, wallId: string): WallReading | null {
  const r = readStructure(doc).get(wallId);
  if (r) return r;
  return doc.walls.some((w) => w.id === wallId) ? finish(wallId, "new", ["A new wall in the design — a partition, not carrying the house (unless the engineer makes it one)."], [], 0) : null;
}

export const LEVEL_WORDS: Record<BearingLevel, string> = {
  outside: "Outside wall — bearing",
  likely: "Likely bearing",
  unlikely: "Likely not bearing",
  unknown: "Can't tell from the plan",
  new: "New wall",
};

/** What a reading comes to, in a few words. */
export function readingWords(r: WallReading): string {
  if (r.confirmed === "bearing") return "Bearing — checked on site";
  if (r.confirmed === "not") return "Not bearing — checked on site";
  return LEVEL_WORDS[r.level];
}

/* ── The changes to the house ──────────────────────────────────────────────────────────────────────────────────── */

export type ChangeKind = "remove-wall" | "move-wall" | "new-wall" | "new-opening" | "wider-opening" | "moved-opening" | "closed-opening";
/** engineer: a beam or a header in a bearing wall, sized and stamped · header: an opening in an outside wall, sized from
 *  the code's tables · check: settle on site whether it's bearing first · none: a partition, framing only. */
export type ChangeNeeds = "engineer" | "header" | "check" | "none";

export type HouseChange = {
  id: string;
  kind: ChangeKind;
  wallId: string;
  openingId?: string;
  /** The length of wall taken out or moved, or the opening's width — inches. */
  inches: number;
  /** For a wider opening: the width it was. */
  was?: number;
  title: string;
  exterior: boolean;
  reading: WallReading;
  needs: ChangeNeeds;
  /** Why it needs that, in a sentence. */
  why: string;
};

const MOVED = 2; // inches: less is the same wall
/** How far a point sits off a wall's line (the infinite line, not the segment). */
const offLine = (w: Wall, p: P) => {
  const L = wallLen(w) || 1;
  return Math.abs(((w.b.x - w.a.x) * (p.y - w.a.y) - (w.b.y - w.a.y) * (p.x - w.a.x)) / L);
};
const OPENING_MOVED = 6;
const isWindow = (o: Opening) => o.kind === "window";
const openingWord = (o: Opening) => (isWindow(o) ? "window" : o.kind === "opening" ? "opening" : o.kind === "slider" ? "sliding door" : "door");

/** Every way the design differs from the house as it stood. Empty when the house wasn't kept (doc.existing). */
export function houseChanges(doc: DesignDoc): HouseChange[] {
  if (!doc.existing) return [];
  // Room boundaries are lines on the floor, not walls: never a change to the house.
  const before = doc.existing.walls.filter((w) => !w.boundary);
  const now = new Map(doc.walls.filter((w) => !w.boundary).map((w) => [w.id, w]));
  const was = new Map(before.map((w) => [w.id, w]));
  const readings = readStructure(doc);
  const out: HouseChange[] = [];
  const reading = (id: string) => readings.get(id) ?? readWall(doc, id)!;
  const wallNeeds = (r: WallReading): { needs: ChangeNeeds; why: string } =>
    r.bearing === true
      ? { needs: "engineer", why: r.confirmed === "bearing" ? "It's bearing (checked on site): a beam has to carry what it carried — sized and stamped by an engineer." : r.level === "outside" ? "An outside wall carries the roof: a beam or header sized and stamped by an engineer." : "It reads as bearing: a beam has to carry what it carried — sized and stamped by an engineer." }
      : r.bearing === null
        ? { needs: "check", why: "Can't tell from the plan whether it's bearing: look on site first — if it is, an engineer sizes the beam." }
        : r.confirmed === "not"
          ? { needs: "none", why: "Not bearing (checked on site): framing, drywall and finishes only." }
          : { needs: "check", why: "It reads as not bearing — confirm in the attic and below before it comes out." };

  for (const w0 of before) {
    const w = now.get(w0.id);
    const r = reading(w0.id);
    const L0 = wallLen(w0);
    if (!w) {
      const n = wallNeeds(r);
      out.push({ id: `rm:${w0.id}`, kind: "remove-wall", wallId: w0.id, inches: L0, title: `Take out ${ftIn(L0)} of ${r.level === "outside" ? "outside " : ""}wall`, exterior: r.level === "outside", reading: r, ...n });
      continue;
    }
    // Moved off its line, or cut shorter (or longer) along it.
    const off = Math.max(offLine(w0, w.a), offLine(w0, w.b));
    if (off > MOVED) {
      const n = wallNeeds(r);
      out.push({ id: `mv:${w0.id}`, kind: "move-wall", wallId: w0.id, inches: L0, title: `Move ${ftIn(L0)} of wall ${ftIn(off)} over`, exterior: r.level === "outside", reading: r, ...n });
    } else {
      const L = wallLen(w);
      if (L0 - L > MOVED) {
        const n = wallNeeds(r);
        out.push({ id: `cut:${w0.id}`, kind: "remove-wall", wallId: w0.id, inches: L0 - L, title: `Shorten a wall by ${ftIn(L0 - L)}`, exterior: r.level === "outside", reading: r, ...n });
      } else if (L - L0 > MOVED) {
        out.push({ id: `ext:${w0.id}`, kind: "new-wall", wallId: w0.id, inches: L - L0, title: `Extend a wall by ${ftIn(L - L0)}`, exterior: r.level === "outside", reading: r, needs: "none", why: "New partition framing." });
      }
    }
  }
  for (const w of doc.walls) {
    if (was.has(w.id) || w.boundary) continue;
    out.push({ id: `new:${w.id}`, kind: "new-wall", wallId: w.id, inches: wallLen(w), title: `New wall, ${ftIn(wallLen(w))}`, exterior: false, reading: readWall(doc, w.id)!, needs: "none", why: "A new partition: framing, drywall and finishes." });
  }

  // Openings in the walls that stood (a removed wall's openings go with it; a new wall's are part of it).
  const o0 = new Map(standingOpenings(doc).map((o) => [o.id, o]));
  const o1 = new Map(doc.openings.map((o) => [o.id, o]));
  const openingNeeds = (r: WallReading, width: number): { needs: ChangeNeeds; why: string } =>
    r.level === "outside" && r.confirmed !== "not"
      ? width >= 72
        ? { needs: "engineer", why: `A ${ftIn(width)} opening in an outside wall: its header and the wall's bracing (IRC R602.10) — an engineer's size and detail.` }
        : { needs: "header", why: "In an outside wall: a header from the code's span tables (IRC R602.7), jack and king studs, flashing." }
      : r.bearing === true
        ? { needs: "engineer", why: "In a bearing wall: a header sized for what lands on it — the engineer's size." }
        : r.bearing === null
          ? { needs: "check", why: "Can't tell whether the wall is bearing: look on site — if it is, an engineer sizes the header." }
          : r.confirmed !== "not" && width >= 48
            ? { needs: "check", why: "A wide opening in a wall that reads as not bearing — confirm in the attic and below first." }
            : { needs: "none", why: r.confirmed === "not" ? "Not bearing (checked on site): framing only." : "A door-size opening in a partition: framing only." };
  for (const [id, o] of o1) {
    if (!was.has(o.wallId) || !now.has(o.wallId)) continue;
    const r = reading(o.wallId);
    const prev = o0.get(id);
    if (!prev) {
      out.push({ id: `op:${id}`, kind: "new-opening", wallId: o.wallId, openingId: id, inches: o.width, title: `New ${openingWord(o)}, ${ftIn(o.width)} wide`, exterior: r.level === "outside", reading: r, ...openingNeeds(r, o.width) });
      continue;
    }
    if (o.width - prev.width > MOVED || (isWindow(prev) && !isWindow(o))) {
      out.push({ id: `wd:${id}`, kind: "wider-opening", wallId: o.wallId, openingId: id, inches: o.width, was: prev.width, title: isWindow(prev) && !isWindow(o) ? `A ${ftIn(prev.width)} window made a ${ftIn(o.width)} ${openingWord(o)}` : `Widen a ${openingWord(o)} from ${ftIn(prev.width)} to ${ftIn(o.width)}`, exterior: r.level === "outside", reading: r, ...openingNeeds(r, o.width) });
    } else if (Math.abs(o.at - prev.at) > OPENING_MOVED && prev.wallId === o.wallId) {
      out.push({ id: `mo:${id}`, kind: "moved-opening", wallId: o.wallId, openingId: id, inches: o.width, title: `Move a ${openingWord(o)} ${ftIn(Math.abs(o.at - prev.at))} along its wall`, exterior: r.level === "outside", reading: r, ...openingNeeds(r, o.width) });
    }
  }
  for (const [id, o] of o0) {
    if (o1.has(id) || !now.has(o.wallId)) continue;
    const r = reading(o.wallId);
    out.push({ id: `cl:${id}`, kind: "closed-opening", wallId: o.wallId, openingId: id, inches: o.width, title: `Close up a ${ftIn(o.width)} ${openingWord(o)}`, exterior: r.level === "outside", reading: r, needs: "none", why: r.level === "outside" ? "Framed in, sheathed, siding and drywall patched to match." : "Framed in and drywalled." });
  }
  return out;
}

/** Put one change back the way the house stood. */
export function undoChange(doc: DesignDoc, c: HouseChange): DesignDoc {
  if (!doc.existing) return doc;
  const d: DesignDoc = JSON.parse(JSON.stringify(doc));
  const w0 = doc.existing.walls.find((w) => w.id === c.wallId);
  const o0 = c.openingId ? doc.existing.openings.find((o) => o.id === c.openingId) : undefined;
  switch (c.kind) {
    case "remove-wall":
    case "move-wall": {
      if (!w0) break;
      const i = d.walls.findIndex((w) => w.id === w0.id);
      if (i >= 0) d.walls[i] = { ...w0 };
      else d.walls.push({ ...w0 });
      for (const o of doc.existing.openings.filter((x) => x.wallId === w0.id)) if (!d.openings.some((x) => x.id === o.id)) d.openings.push({ ...o });
      break;
    }
    case "new-wall":
      if (w0) {
        const i = d.walls.findIndex((w) => w.id === w0.id);
        if (i >= 0) d.walls[i] = { ...w0 };
      } else {
        d.walls = d.walls.filter((w) => w.id !== c.wallId);
        d.openings = d.openings.filter((o) => o.wallId !== c.wallId);
      }
      break;
    case "new-opening":
      d.openings = d.openings.filter((o) => o.id !== c.openingId);
      break;
    case "wider-opening":
    case "moved-opening":
    case "closed-opening":
      if (o0) {
        const i = d.openings.findIndex((o) => o.id === o0.id);
        if (i >= 0) d.openings[i] = { ...o0 };
        else d.openings.push({ ...o0 });
      }
      break;
  }
  return d;
}

/** A wall opened right up: a cased opening along most of it (a jamb's width left at each end). */
export function openUp(doc: DesignDoc, wallId: string, newOpeningId: string): DesignDoc {
  const d: DesignDoc = JSON.parse(JSON.stringify(doc));
  const w = d.walls.find((x) => x.id === wallId);
  if (!w) return doc;
  const L = wallLen(w);
  const width = Math.max(24, Math.floor(L - 2 * Math.max(3.5, w.thick)));
  d.openings = d.openings.filter((o) => o.wallId !== wallId);
  d.openings.push({ id: newOpeningId, wallId, kind: "opening", at: L / 2, width, height: Math.min(84, w.height - 8), sill: 0 });
  return d;
}

/* ── What the engineer is asked ────────────────────────────────────────────────────────────────────────────────── */

/** The questions for one change, in an engineer's words. */
export function engineerQuestions(c: HouseChange): string[] {
  const span = ftIn(c.inches);
  const where = c.exterior ? "outside wall" : c.reading.bearing === true ? "bearing wall" : "wall (bearing not yet confirmed)";
  switch (c.kind) {
    case "remove-wall":
      return [`Beam to replace ${span} of ${where}: flush or dropped; LVL, PSL or steel.`, "Posts at each end and the footings under them; the load path down to the foundation.", "Temporary shoring while the wall comes out."];
    case "move-wall":
      return [`The ${where} moves: a beam where it stood (${span}), or what the new location has to carry.`, "Posts, footings and the load path for the new arrangement.", "Temporary shoring during the change."];
    case "new-opening":
    case "wider-opening":
    case "moved-opening":
      return [`Header for a ${span} opening in the ${where}; jack and king studs.`, ...(c.exterior ? ["Does the wall still meet its bracing with the opening (IRC R602.10), or does it need a portal frame or hold-downs?"] : []), "Any point loads above that land in the opening."];
    default:
      return [];
  }
}

/** What the plan can't tell the engineer, and the contractor can. */
export function siteWords(s: SiteFacts | undefined): string[] {
  const above = s?.above === "floor" ? "A floor above" : s?.above === "roof" ? "The roof only above" : "Above: not known yet";
  const roof = s?.roof === "trusses" ? "roof framed with trusses" : s?.roof === "rafters" ? "roof framed with rafters (stick-framed)" : "roof framing not known yet";
  const below = s?.below === "slab" ? "Slab on grade" : s?.below === "crawl" ? "Crawlspace" : s?.below === "basement" ? "Basement" : "Foundation: not known yet";
  return [`${above}; ${roof}.`, `${below}.`];
}

/** The changes that go to the engineer (or may, once the site is checked). */
export const forEngineer = (cs: HouseChange[]) => cs.filter((c) => c.needs === "engineer" || c.needs === "check");
