// THE SMART CHECKS (Home Design Studio, milestone 5 — 2026-10-17). The kitchen as designed, checked the way a kitchen
// designer and an inspector would: what the code requires (IRC, NEC), what the NKBA's kitchen planning guidelines
// recommend, and what plainly doesn't fit (two things in one spot, a cabinet across a door). Each finding names its
// source and the things it's about, so the studio can point at them; a few carry a one-click fix.
//
// Sources, worded as they are: IRC M1901.1 (30 in above a cooking top to unprotected combustibles, less per the hood's
// or range's listing), IRC R310 (a bedroom's emergency escape opening: 5.7 sq ft clear, 24 in high, 20 in wide, sill
// no higher than 44 in), IRC M1503.6 (makeup air past 400 cfm of kitchen exhaust), NEC 210.52(C) (countertop
// receptacles: no point along a wall counter more than 24 in from one), NEC 210.8(A) (GFCI). The NKBA guidelines are
// recommendations, not code, and are labelled so. Pure.
import type { DesignDoc, DesignItem, Opening, P } from "./model";
import { DEFAULT_CEILING, ftIn, newId } from "./model";
import { dot, pointInPoly, roomsOf, wallDir, type Room } from "./geometry";
import { cornersOf, frameOf, overlaps } from "./kitchen";
import { itemCode, lib, newItemFrom, UPPER_Z } from "./library";

export type CheckLevel = "code" | "guide" | "fit";
export type CheckFix = { label: string } & ({ kind: "add-hood"; cookId: string } | { kind: "set"; itemId: string; z?: number; h?: number });
export type Check = {
  id: string;
  level: CheckLevel;
  ok: boolean;
  title: string;
  detail: string;
  /** Where it comes from: "IRC M1901.1", "NKBA guideline", "Fit". */
  source: string;
  items?: string[];
  walls?: string[];
  fix?: CheckFix;
};

const COUNTER_TOP = 36;
const NKBA = "NKBA guideline";
const r0 = (n: number) => Math.round(n);
const angDiff = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
};
const center = (it: DesignItem): P => ({ x: it.x, y: it.y });
const frontMid = (it: DesignItem): P => {
  const { f } = frameOf(it);
  return { x: it.x + (f.x * it.d) / 2, y: it.y + (f.y * it.d) / 2 };
};
const name = (it: DesignItem) => `${lib(it.lib)?.name.toLowerCase() ?? "item"} (${itemCode(it)})`;
const inside = (p: P, it: DesignItem) => pointInPoly(p, cornersOf(it));

/** Things standing on the floor that make the working kitchen: cabinets, the island, appliances (not the cooktop
 *  in the counter, the hood or microwave on the wall, lights or chairs). */
const isFloor = (it: DesignItem) => {
  const c = lib(it.lib)?.cat;
  return it.z < 30 && (c === "base" || c === "tall" || c === "island" || c === "appliance");
};
const isCounter = (it: DesignItem) => !!lib(it.lib)?.counter;

/** The gap between two footprints (0 when they touch or overlap). */
function gap(a: DesignItem, b: DesignItem): number {
  if (overlaps(a, b, 0)) return 0;
  const ca = cornersOf(a);
  const cb = cornersOf(b);
  const segDist = (p: P, q1: P, q2: P) => {
    const dx = q2.x - q1.x;
    const dy = q2.y - q1.y;
    const L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - q1.x) * dx + (p.y - q1.y) * dy) / L2));
    return Math.hypot(p.x - (q1.x + t * dx), p.y - (q1.y + t * dy));
  };
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    for (const p of ca) best = Math.min(best, segDist(p, cb[i], cb[(i + 1) % 4]));
    for (const p of cb) best = Math.min(best, segDist(p, ca[i], ca[(i + 1) % 4]));
  }
  return best;
}

/** Walk out from a point along a direction: how far to the next floor thing, or to the room's wall. */
function rayHit(from: P, dir: P, room: Room, others: DesignItem[], max = 72): { d: number; item: DesignItem | null } | null {
  for (let s = 1; s <= max; s += 1) {
    const p = { x: from.x + dir.x * s, y: from.y + dir.y * s };
    // The room's loop runs along the wall centerlines: the face is about half a wall nearer.
    if (!pointInPoly(p, room.poly)) return { d: Math.max(0, s - 2.25), item: null };
    const hit = others.find((o) => inside(p, o));
    if (hit) return { d: s, item: hit };
  }
  return null;
}

/** How much counter runs on each side of an item, along its run (the counters beside it, touching). */
function landing(t: DesignItem, items: DesignItem[]): { left: number; right: number } {
  // A cooktop sits in a counter: the run is its host's.
  const host = t.lib === "CT" ? items.find((o) => o.id !== t.id && isCounter(o) && inside(center(t), o)) ?? null : null;
  const seed = host ?? t;
  const { f, u } = frameOf(seed);
  const back = (it: DesignItem) => dot(center(it), f) - it.d / 2;
  const span = (it: DesignItem): [number, number] => {
    const c = dot(center(it), u);
    return [c - it.w / 2, c + it.w / 2];
  };
  const run = items.filter((o) => o.id !== t.id && isCounter(o) && angDiff(o.rot, seed.rot) < 2 && Math.abs(back(o) - back(seed)) < 4).map(span);
  const [t0, t1] = span(t);
  // From the item's own edges outward through touching counters.
  let lo = t0;
  let hi = t1;
  if (host) {
    const [h0, h1] = span(host);
    lo = Math.min(lo, h0);
    hi = Math.max(hi, h1);
  }
  for (let moved = true; moved; ) {
    moved = false;
    for (const [a, b] of run) {
      if (b >= lo - 1.5 && a < lo - 0.01) {
        lo = a;
        moved = true;
      }
      if (a <= hi + 1.5 && b > hi + 0.01) {
        hi = b;
        moved = true;
      }
    }
  }
  return { left: Math.max(0, t0 - lo), right: Math.max(0, hi - t1) };
}

/** The checks for a kitchen: every one run, the passes kept too (the studio shows how many pass). */
export function kitchenChecks(doc: DesignDoc, labelId: string): Check[] {
  const room = roomsOf(doc).find((r) => r.labelId === labelId);
  if (!room) return [];
  const items = (doc.items ?? []).filter((i) => i.room === labelId);
  if (!items.length) return [];
  const out: Check[] = [];
  const ceiling = room.ceiling || DEFAULT_CEILING;
  const floor = items.filter(isFloor);
  const sinks = items.filter((i) => i.lib === "SB" || (i.lib === "ISL" && i.opts?.sink));
  const cooks = items.filter((i) => i.lib === "RNG" || i.lib === "CT");
  const fridge = items.find((i) => i.lib === "REF") ?? null;
  const dws = items.filter((i) => i.lib === "DW");

  /* ── Fit: nothing in the same spot, nothing outside the walls, doors and windows clear ── */
  const clashes: string[] = [];
  const clashIds = new Set<string>();
  const layer = (i: DesignItem) => (isFloor(i) ? "floor" : i.z >= 40 && lib(i.lib)?.cat !== "light" ? "wall" : null);
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (!layer(a) || layer(a) !== layer(b)) continue;
      if (overlaps(a, b, 1)) {
        clashes.push(`${itemCode(a)} and ${itemCode(b)}`);
        clashIds.add(a.id).add(b.id);
      }
    }
  out.push({ id: "fit-overlap", level: "fit", ok: !clashes.length, source: "Fit", title: clashes.length ? `${clashes.length === 1 ? "Two things" : `${clashes.length} pairs`} in the same spot` : "Nothing overlaps", detail: clashes.length ? `${clashes.slice(0, 4).join("; ")}${clashes.length > 4 ? "…" : ""} — move one or change its width.` : "Every cabinet and appliance has its own space.", items: [...clashIds] });

  const outside = items.filter((i) => lib(i.lib)?.cat !== "light" && !pointInPoly(center(i), room.poly));
  if (outside.length) out.push({ id: "fit-outside", level: "fit", ok: false, source: "Fit", title: `${outside.length === 1 ? "Something sits" : `${outside.length} things sit`} outside the room's walls`, detail: outside.map(name).join(", "), items: outside.map((i) => i.id) });

  const roomOpenings = doc.openings.filter((o) => room.wallIds.includes(o.wallId));
  const wallOf = (id: string) => doc.walls.find((w) => w.id === id) ?? null;
  const blocked: Array<{ o: Opening; it: DesignItem }> = [];
  for (const o of roomOpenings) {
    if (o.kind === "window") continue;
    const w = wallOf(o.wallId);
    if (!w) continue;
    const d = wallDir(w);
    const mid = { x: w.a.x + d.x * o.at, y: w.a.y + d.y * o.at };
    // The way through: the opening's width, 30 in out on both sides.
    const zone = { x: mid.x, y: mid.y, rot: (Math.atan2(d.x, -d.y) * 180) / Math.PI, w: o.width, d: w.thick + 60 };
    for (const it of floor) if (overlaps(zone, it, 1)) blocked.push({ o, it });
  }
  out.push({ id: "fit-doors", level: "fit", ok: !blocked.length, source: "Fit", title: blocked.length ? "Something stands in a doorway" : "Doorways are clear", detail: blocked.length ? blocked.map(({ o, it }) => `${name(it)} in front of a ${ftIn(o.width)} ${o.kind === "opening" ? "opening" : "door"}`).join("; ") : "30 in clear on both sides of every door and opening.", items: blocked.map((b) => b.it.id) });

  const covered: Array<{ o: Opening; it: DesignItem }> = [];
  for (const o of roomOpenings.filter((x) => x.kind === "window")) {
    const w = wallOf(o.wallId);
    if (!w) continue;
    const d = wallDir(w);
    for (const it of items) {
      if (it.wallId !== w.id) continue;
      const c = lib(it.lib)?.cat;
      if (c === "light" || c === "furniture") continue;
      const t = dot({ x: it.x - w.a.x, y: it.y - w.a.y }, d);
      const overlapAlong = Math.min(t + it.w / 2, o.at + o.width / 2) - Math.max(t - it.w / 2, o.at - o.width / 2);
      const top = it.z + it.h + (isCounter(it) ? 1.5 : 0);
      if (overlapAlong > 2 && top > o.sill + 1 && it.z < o.sill + o.height) covered.push({ o, it });
    }
  }
  out.push({ id: "fit-windows", level: "fit", ok: !covered.length, source: "Fit", title: covered.length ? "Something covers a window" : "Windows are clear", detail: covered.length ? covered.map(({ o, it }) => (isCounter(it) && it.z < 1 ? `the counter on ${itemCode(it)} rises above a window's ${ftIn(o.sill)} sill` : `${name(it)} across a window`)).join("; ") : "No cabinet or appliance in front of the glass.", items: covered.map((c) => c.it.id) });

  /* ── Aisles and walkways (NKBA: 42 in work aisle for one cook, 48 in for two; 36 in walkway) ── */
  const aisles = new Map<string, { d: number; a: DesignItem; b: DesignItem | null }>();
  for (const it of floor) {
    const { f, u } = frameOf(it);
    const dirs: P[] = it.lib === "ISL" ? [f, { x: -f.x, y: -f.y }] : [f];
    for (const dir of dirs) {
      const sign = dir === f ? 1 : -1;
      for (const k of [0.2, 0.5, 0.8]) {
        const p = { x: it.x + dir.x * (it.d / 2 + 0.5) + u.x * (k - 0.5) * it.w, y: it.y + dir.y * (it.d / 2 + 0.5) + u.y * (k - 0.5) * it.w };
        const hit = rayHit(p, dir, room, floor.filter((o) => o.id !== it.id), 72);
        if (!hit || hit.d < 3) continue;
        // The seating side of an island is measured by the seating rule, not as an aisle.
        if (it.lib === "ISL" && sign < 0 && it.opts?.seats) continue;
        const key = hit.item ? [it.id, hit.item.id].sort().join("|") : `${it.id}|wall`;
        const cur = aisles.get(key);
        if (!cur || hit.d < cur.d) aisles.set(key, { d: hit.d, a: it, b: hit.item });
      }
    }
  }
  const tight = [...aisles.values()].filter((x) => (x.b ? x.d < 42 : x.d < 36));
  out.push({
    id: "aisles",
    level: "guide",
    ok: !tight.length,
    source: NKBA,
    title: tight.length ? `${tight.length === 1 ? "An aisle is" : `${tight.length} aisles are`} narrow` : "Aisles and walkways are wide enough",
    detail: tight.length
      ? tight
          .sort((p, q) => p.d - q.d)
          .slice(0, 4)
          .map((x) => (x.b ? `${r0(x.d)} in between the ${lib(x.a.lib)?.name.toLowerCase()} and the ${lib(x.b.lib)?.name.toLowerCase()} (42 in for one cook, 48 in for two)` : `${r0(x.d)} in in front of the ${lib(x.a.lib)?.name.toLowerCase()} to the wall (36 in walkway)`))
          .join("; ")
      : "42 in or more between facing counters, 36 in or more to a wall.",
    items: [...new Set(tight.flatMap((x) => [x.a.id, ...(x.b ? [x.b.id] : [])]))],
  });

  /* ── Seating at the island (NKBA: 24 in wide a seat; 36 in behind to edge past, 44 in to walk past) ── */
  for (const isl of items.filter((i) => i.lib === "ISL" && i.opts?.seats)) {
    const { f, u } = frameOf(isl);
    const stools = items.filter((s) => s.lib === "STL" && Math.abs(dot({ x: s.x - isl.x, y: s.y - isl.y }, u)) <= isl.w / 2 + 6 && dot({ x: s.x - isl.x, y: s.y - isl.y }, f) < -isl.d / 2 + 2);
    const per = stools.length ? isl.w / stools.length : Infinity;
    const back = { x: -f.x, y: -f.y };
    const behind = rayHit({ x: isl.x + back.x * (isl.d / 2 + 0.5), y: isl.y + back.y * (isl.d / 2 + 0.5) }, back, room, floor.filter((o) => o.id !== isl.id), 72);
    const ok = per >= 24 && (!behind || behind.d >= 36);
    out.push({
      id: `seats:${isl.id}`,
      level: "guide",
      ok,
      source: NKBA,
      title: ok ? "Island seating has room" : per < 24 ? `${stools.length} seats on a ${ftIn(isl.w)} island` : `${r0(behind!.d)} in behind the island seats`,
      detail: per < 24 ? `About ${r0(per)} in a seat — 24 in each is the guideline. Take a stool away or lengthen the island.` : behind && behind.d < 36 ? `36 in behind seated people lets someone edge past; 44 in to walk past.` : `${stools.length} seats, 24 in or more each${behind ? `, ${r0(behind.d)} in behind` : ""}.`,
      items: [isl.id, ...stools.map((s) => s.id)],
    });
  }

  /* ── The work triangle (NKBA: each leg 4–9 ft, the three no more than 26 ft) ── */
  if (sinks.length && cooks.length && fridge) {
    const s = sinks[0].lib === "ISL" ? center(sinks[0]) : frontMid(sinks[0]);
    const c = cooks[0].lib === "CT" ? center(cooks[0]) : frontMid(cooks[0]);
    const r = frontMid(fridge);
    const legs = [Math.hypot(s.x - c.x, s.y - c.y), Math.hypot(c.x - r.x, c.y - r.y), Math.hypot(r.x - s.x, r.y - s.y)];
    const sum = legs.reduce((a, b) => a + b, 0);
    const badLeg = legs.some((l) => l < 48 || l > 108);
    const ok = !badLeg && sum <= 312;
    out.push({ id: "triangle", level: "guide", ok, source: NKBA, title: ok ? "Work triangle is in range" : sum > 312 ? `Work triangle is ${ftIn(sum)} around` : "A leg of the work triangle is off", detail: `Sink to cooktop ${ftIn(legs[0])}, cooktop to fridge ${ftIn(legs[1])}, fridge to sink ${ftIn(legs[2])} — each leg 4 to 9 ft, all three no more than 26 ft.`, items: [sinks[0].id, cooks[0].id, fridge.id] });
  }

  /* ── Dishwasher near the sink (NKBA: within 36 in of the sink's edge) ── */
  for (const dw of dws) {
    if (!sinks.length) break;
    const near = Math.min(...sinks.map((s) => gap(dw, s)));
    out.push({ id: `dw:${dw.id}`, level: "guide", ok: near <= 36, source: NKBA, title: near <= 36 ? "Dishwasher sits by the sink" : `Dishwasher is ${ftIn(near)} from the sink`, detail: "Within 36 in of the sink's edge, so dishes go from the sink straight in.", items: [dw.id, sinks[0].id] });
  }

  /* ── Landing areas (NKBA: sink 24 in one side + 18 in the other; cooking surface 12 + 15; fridge 15 in) ── */
  for (const s of sinks.filter((x) => x.lib === "SB")) {
    const l = landing(s, items);
    const big = Math.max(l.left, l.right);
    const small = Math.min(l.left, l.right);
    const ok = big >= 24 && small >= 18;
    out.push({ id: `land-sink:${s.id}`, level: "guide", ok, source: NKBA, title: ok ? "Counter on both sides of the sink" : "Short counter beside the sink", detail: `${r0(l.left)} in on one side, ${r0(l.right)} in on the other — 24 in on one side and 18 in on the other is the guideline.`, items: [s.id] });
  }
  for (const c of cooks) {
    const l = landing(c, items);
    const big = Math.max(l.left, l.right);
    const small = Math.min(l.left, l.right);
    const ok = big >= 15 && small >= 12;
    out.push({ id: `land-cook:${c.id}`, level: "guide", ok, source: NKBA, title: ok ? `Counter on both sides of the ${c.lib === "CT" ? "cooktop" : "range"}` : `Short counter beside the ${c.lib === "CT" ? "cooktop" : "range"}`, detail: `${r0(l.left)} in and ${r0(l.right)} in — 12 in on one side and 15 in on the other, for pot handles and a place to set things down.`, items: [c.id] });
  }
  if (fridge) {
    const l = landing(fridge, items);
    const { f } = frameOf(fridge);
    const across = rayHit({ x: fridge.x + f.x * (fridge.d / 2 + 0.5), y: fridge.y + f.y * (fridge.d / 2 + 0.5) }, f, room, floor.filter((o) => o.id !== fridge.id && isCounter(o)), 48);
    const ok = Math.max(l.left, l.right) >= 15 || !!(across?.item && across.d <= 48);
    out.push({ id: "land-fridge", level: "guide", ok, source: NKBA, title: ok ? "A place to set things by the fridge" : "No counter by the fridge", detail: "15 in of counter beside the fridge (the handle side), or a counter no more than 48 in across from it.", items: [fridge.id] });
  }

  /* ── The cooking surface: a hood, the clearance above it, not under a window ── */
  for (const c of cooks) {
    // Anything hung over any part of it (a 12 in wall cabinet covers the back burners of a 26 in range).
    const above = items.filter((o) => o.id !== c.id && o.z >= 40 && lib(o.lib)?.cat !== "light" && overlaps(o, c, 2));
    const vent = above.find((o) => o.lib === "HD" || o.lib === "MW") ?? null;
    out.push({ id: `vent:${c.id}`, level: "guide", ok: !!vent, source: NKBA, title: vent ? "The cooking surface is vented" : "No hood over the cooking surface", detail: vent ? `${vent.lib === "HD" ? "A hood" : "A microwave-hood"} over it — 150 cfm or more, ducted outside.` : "Every cooking surface gets ventilation: a hood of 150 cfm or more, ducted outside.", items: [c.id], ...(vent ? {} : { fix: { label: "Add a hood", kind: "add-hood" as const, cookId: c.id } }) });
    for (const o of above) {
      const clear = o.z - COUNTER_TOP;
      if (o.lib === "HD") {
        const ok = clear >= 24;
        out.push({ id: `hood-h:${o.id}`, level: "guide", ok, source: "Hood listing · NKBA", title: ok ? `Hood ${r0(clear)} in over the cooktop` : `Hood only ${r0(clear)} in over the cooktop`, detail: "24 in or more, and what the hood's listing says (often 24–30 in).", items: [o.id], ...(ok ? {} : { fix: { label: "Raise it to 30 in", kind: "set" as const, itemId: o.id, z: COUNTER_TOP + 30 } }) });
      } else if (lib(o.lib)?.cat === "wall") {
        const ok = clear >= 30;
        const h = Math.max(12, Math.min(o.h, ceiling - (COUNTER_TOP + 30)));
        out.push({ id: `combust:${o.id}`, level: "code", ok, source: "IRC M1901.1", title: ok ? "Cabinet over the cooktop is high enough" : `A cabinet ${r0(clear)} in over the cooking top`, detail: "30 in from the cooking top to unprotected combustibles above it (less only as the range or hood listing allows).", items: [o.id, c.id], ...(ok ? {} : { fix: { label: `Raise it to 30 in (${itemCode({ ...o, h })})`, kind: "set" as const, itemId: o.id, z: COUNTER_TOP + 30, h } }) });
      }
    }
    if (c.wallId) {
      const w = wallOf(c.wallId);
      if (w) {
        const d = wallDir(w);
        const t = dot({ x: c.x - w.a.x, y: c.y - w.a.y }, d);
        const win = doc.openings.find((o) => o.wallId === w.id && o.kind === "window" && Math.min(t + c.w / 2, o.at + o.width / 2) - Math.max(t - c.w / 2, o.at - o.width / 2) > 1);
        out.push({ id: `cook-win:${c.id}`, level: "guide", ok: !win, source: NKBA, title: win ? "The range is under a window" : "No window over the range", detail: win ? "Don't put a cooking surface under an operable window — a breeze blows out a flame and curtains catch." : "Nothing at the window behind the cooking surface.", items: [c.id] });
      }
    }
  }

  /* ── Wall cabinets clear of the counter (NKBA: 15 in, 18 in is the norm) ── */
  const low = items.filter((i) => i.lib === "W" && i.z - COUNTER_TOP < 15 && !cooks.some((c) => inside(center(c), i)));
  out.push({ id: "uppers", level: "guide", ok: !low.length, source: NKBA, title: low.length ? `${low.length === 1 ? "A wall cabinet hangs" : `${low.length} wall cabinets hang`} low` : "Wall cabinets clear the counter", detail: low.length ? `${low.map((i) => `${itemCode(i)} at ${r0(i.z - COUNTER_TOP)} in`).join(", ")} over the counter — 15 in at least, 18 in is the norm.` : "15 in or more between the counter and the wall cabinets.", items: low.map((i) => i.id), ...(low.length ? { fix: { label: "Hang them 18 in over the counter", kind: "set" as const, itemId: low.map((i) => i.id).join(","), z: UPPER_Z } } : {}) });

  /* ── The way in (NKBA: 32 in clear through a kitchen doorway) ── */
  const narrow = roomOpenings.filter((o) => (o.kind === "door" || o.kind === "pocket") && o.width < 32);
  if (narrow.length) out.push({ id: "entry", level: "guide", ok: false, source: NKBA, title: `${narrow.length === 1 ? "A door is" : `${narrow.length} doors are`} narrow for a kitchen`, detail: `${narrow.map((o) => ftIn(o.width)).join(", ")} — a doorway into a kitchen gives 32 in clear (a 2'-10" door).`, walls: narrow.map((o) => o.wallId) });

  /* ── Electrical and air (the code; counted, for the plan) ── */
  const wallCounterLf = items.filter((i) => isCounter(i) && i.lib !== "ISL" && i.wallId).reduce((s, i) => s + i.w, 0) / 12;
  if (wallCounterLf > 0) {
    const n = Math.ceil(wallCounterLf / 4) + items.filter((i) => i.lib === "ISL").length;
    out.push({ id: "receptacles", level: "code", ok: true, source: "NEC 210.52(C) · 210.8(A)", title: `${n} countertop outlets, GFCI`, detail: `About ${r0(wallCounterLf)} ft of wall counter: an outlet so no point is more than 24 in from one (about one every 4 ft), plus the island's — all GFCI protected, on two 20 A circuits.` });
  }
  if (items.some((i) => i.lib === "HD")) out.push({ id: "makeup-air", level: "code", ok: true, source: "IRC M1503.6", title: "Makeup air past 400 cfm", detail: "If the hood moves more than 400 cfm, the code calls for makeup air brought in to match — choose the hood with that in mind." });
  return out;
}

/** Checks for the whole house: bedrooms' emergency escape windows (IRC R310). */
export function houseChecks(doc: DesignDoc): Check[] {
  const out: Check[] = [];
  for (const r of roomsOf(doc)) {
    if (!r.names.some((n) => /bed|sleep/i.test(n))) continue;
    const windows = doc.openings.filter((o) => o.kind === "window" && r.wallIds.includes(o.wallId));
    // The rough size can only be larger than the clear opening: below 5.7 sq ft rough it can't qualify.
    const could = windows.filter((o) => o.sill <= 44 && o.width >= 20 && o.height >= 24 && (o.width * o.height) / 144 >= 5.7);
    out.push({
      id: `egress:${r.key}`,
      level: "code",
      ok: could.length > 0,
      source: "IRC R310",
      title: could.length ? `${r.name}: an escape window` : `${r.name}: no window that can be an escape opening`,
      detail: could.length
        ? `A ${ftIn(could[0].width)} × ${ftIn(could[0].height)} window, sill ${ftIn(could[0].sill)} — confirm its NET clear opening on the window's spec: 5.7 sq ft (5.0 at grade), 24 in high, 20 in wide, sill no higher than 44 in.`
        : windows.length
          ? `${windows.map((o) => `${ftIn(o.width)} × ${ftIn(o.height)}, sill ${ftIn(o.sill)}`).join("; ")} — a sleeping room needs one with 5.7 sq ft clear, 24 in high, 20 in wide, sill no higher than 44 in.`
          : "No window in the room: a sleeping room needs an emergency escape opening.",
      walls: [...new Set(windows.map((o) => o.wallId))],
    });
  }
  return out;
}

/** Apply a check's one-click fix. */
export function applyFix(doc: DesignDoc, fix: CheckFix): DesignDoc {
  const d: DesignDoc = JSON.parse(JSON.stringify(doc));
  const items = d.items ?? (d.items = []);
  if (fix.kind === "set") {
    for (const id of fix.itemId.split(",")) {
      const it = items.find((i) => i.id === id);
      if (!it) continue;
      if (fix.z != null) it.z = fix.z;
      if (fix.h != null) it.h = fix.h;
    }
    return d;
  }
  const c = items.find((i) => i.id === fix.cookId);
  if (!c) return doc;
  const { f } = frameOf(c);
  // Against the wall behind a range (its back where the range's back is); over the middle of an island cooktop.
  const hd = newItemFrom("HD", c.wallId ? { x: c.x - f.x * ((c.d - 20) / 2), y: c.y - f.y * ((c.d - 20) / 2), rot: c.rot, wallId: c.wallId, room: c.room } : { x: c.x, y: c.y, rot: c.rot, wallId: null, room: c.room }, newId("i"), Math.max(30, c.w));
  if (!hd) return doc;
  hd.z = COUNTER_TOP + 30;
  // Whatever wall cabinet was over the range makes way.
  d.items = items.filter((o) => !(lib(o.lib)?.cat === "wall" && overlaps(o, c, 2)));
  d.items.push(hd);
  return d;
}

export const LEVEL_NAME: Record<CheckLevel, string> = { code: "Code", guide: "Guideline", fit: "Fit" };

/** Walls the studio should mark with a check (for the plan). */
export const flaggedWalls = (cs: Check[]) => new Set(cs.filter((c) => !c.ok).flatMap((c) => c.walls ?? []));
export const flaggedItems = (cs: Check[]) => new Set(cs.filter((c) => !c.ok).flatMap((c) => c.items ?? []));
