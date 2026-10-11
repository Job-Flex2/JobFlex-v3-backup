// ELECTRICAL AND ACCESSORIES (Deck Studio M3, 2026-10-10) — pure.
//
// Owner: "LED lighting around the gazebo or the deck, plugs, heaters,
// chandeliers inside the gazebo, security lighting — click it on the gazebo
// and pick what I want; calculate the wiring and the labor separately; if
// the client buys the fixture himself, don't charge it — to be determined —
// but show a sample where it goes; the wiring and the stub-outs we count.
// All of it visual."
//
// The fixtures in the design (design.ts Fixture) say WHAT and, when the
// contractor placed one in the 3D, WHERE; this works out the rest:
//
//   · WHERE, when not placed: the smart default for its kind — strips along
//     the rails or under a roof's headers, caps on every rail post, riser
//     lights on every stair tread, sconces on the posts, a chandelier or a
//     fan at the peak, outlets on alternate posts or the house wall, heaters
//     under the roof at the centre or on the house wall, floods on the house
//     corners or the gable ends.
//   · THE WIRING: low voltage (strips, caps, riser and string lights) on a
//     12-volt transformer per 150 W, 16/2 wire run post to post; line
//     voltage on 20-A GFCI circuits (lights and outlets, 1,440 VA a circuit),
//     a circuit of its own for every heater (12/2 at 120 V, 10/2 two-pole at
//     240 V); a weatherproof box at every device, a switch per lighting group,
//     a dimmer for the chandelier, a speed control for the fan, a timer or
//     photocell when asked; the home run from the panel; a trench where the
//     structure stands away from the house. Lengths run along the frame
//     (Manhattan, up and down the posts), 15% on top.
//   · THE MONEY: wiring, boxes and devices on their rows; fixtures the shop
//     supplies on theirs; a fixture the client brings at $0, named "to be
//     determined", its box, wire and hanging still counted.
//   · THE PICTURE: each fixture a box in space (a sample when the client
//     brings it), the strips as thin glowing runs, the wires as thin runs
//     along the frame — the 3D lights them in its night view.

import type { DeckFrame } from "./frame";
import type { RoofFrame } from "./roof";
import type { StairBuild } from "./stairs";
import type { RailBuild } from "./rails";
import { FIXTURE_LABEL, type DeckDesign, type Fixture, type FixtureKind, type MountKind } from "./design";

/** Watts (or volt-amps for an outlet) a fixture draws, for the circuits and the transformer. */
export const FIXTURE_WATTS: Record<FixtureKind, number> = { "led-strip": 3, "post-cap": 1, "step-light": 1.5, "string-light": 12, sconce: 15, "ceiling-light": 25, chandelier: 60, fan: 75, outlet: 180, heater: 1500, flood: 30 };
/** Low-voltage kinds (one transformer per 150 W). */
export const LOW_VOLTAGE: ReadonlySet<FixtureKind> = new Set<FixtureKind>(["led-strip", "post-cap", "step-light", "string-light"]);
export const TRANSFORMER_WATTS = 150;
/** A 20-A circuit loaded to 1,440 VA (the usual 75% working figure). */
export const CIRCUIT_VA = 1440;
export const HEATER_240_WATTS = 4000;
/** Wire runs along the frame, not as the crow flies: 15% on top of the Manhattan length. */
export const WIRE_SLACK = 1.15;
/** A device's drop from the run: up or down the post, into the box. */
export const DROP_IN = 24;
/** String lights: one strand covers this much post-to-post. */
export const STRAND_FT = 48;

export type WireKind = "12/2" | "10/2" | "14/2" | "lv";

export interface PlacedFixture {
  id: string;
  kind: FixtureKind;
  label: string;
  supply: "we" | "client";
  qty: number;
  /** Where it is, inches, and what it is on. */
  x: number;
  y: number;
  z: number;
  on: MountKind;
  /** The piece as drawn: its size, inches. */
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  watts: number;
  lv: boolean;
  volts240: boolean;
  /** Placed by hand in the 3D, or by the smart default. */
  placed: boolean;
  /** Feet of strip or string this one is (strips and strands). */
  runFt: number;
  /** The glow colour in the night view. */
  glow: string;
}

export interface WireRun {
  kind: WireKind;
  /** [x, y, z] inches, a Manhattan path along the frame. */
  path: Array<[number, number, number]>;
  lengthFt: number;
}

export interface Circuit {
  id: string;
  kind: "lights-outlets" | "heater-120" | "heater-240";
  amps: 20 | 30;
  poles: 1 | 2;
  wire: WireKind;
  devices: number;
  va: number;
  wireFt: number;
}

export interface ElectricalBuild {
  on: boolean;
  fixtures: PlacedFixture[];
  /** The client's own fixtures: drawn as samples, priced at nothing. */
  byClient: PlacedFixture[];
  lv: { transformers: number; wireFt: number; stripFt: number; strands: number; watts: number } | null;
  circuits: Circuit[];
  feedFt: number;
  trenchFt: number;
  conduitFt: number;
  boxes: number;
  switches: number;
  dimmers: number;
  fanControls: number;
  timers: number;
  gfci: number;
  breakers20: number;
  breakers30: number;
  wires: WireRun[];
  /** Where the panel's feed arrives, and the low-voltage transformer. */
  feedAt: [number, number, number];
  transformerAt: [number, number, number] | null;
  labor: { devices: number; hang: number; circuits: number; wireFt: number; trenchFt: number; lvFixtures: number };
  notes: string[];
}

const GLOW: Record<FixtureKind, string> = { "led-strip": "#ffd98a", "post-cap": "#ffe3a3", "step-light": "#ffe9bd", "string-light": "#ffcf7a", sconce: "#ffd27a", "ceiling-light": "#fff1cf", chandelier: "#ffe7b0", fan: "#fff4dc", outlet: "#dfe9ff", heater: "#ff8a4a", flood: "#f4f8ff" };
const SIZE: Record<FixtureKind, [number, number, number]> = { "led-strip": [12, 0.5, 0.5], "post-cap": [6, 6, 3.5], "step-light": [4, 0.8, 2], "string-light": [12, 1, 2.5], sconce: [6, 4, 12], "ceiling-light": [12, 12, 4], chandelier: [22, 22, 24], fan: [52, 52, 14], outlet: [3, 1.5, 5], heater: [34, 8, 8], flood: [8, 7, 7] };

export interface ElectricalInput {
  design: DeckDesign;
  frame: DeckFrame | null;
  roof: RoofFrame | null;
  stairs: StairBuild[];
  rails: RailBuild;
  /** The main deck's size, inches, and whether it stands on the house. */
  widthIn: number;
  depthIn: number;
  onHouse: boolean;
  floorIn: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const manhattan = (a: [number, number, number], b: [number, number, number]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
/** A path along the frame: across at the run's height, then up or down to the device. */
const pathTo = (from: [number, number, number], to: [number, number, number], runZ: number): Array<[number, number, number]> => [from, [from[0], from[1], runZ], [to[0], from[1], runZ], [to[0], to[1], runZ], to];

export function buildElectrical(input: ElectricalInput): ElectricalBuild {
  const { design, frame, roof, stairs, rails } = input;
  const e = design.electrical;
  const W = input.widthIn;
  const D = input.depthIn;
  const floorIn = input.floorIn;
  const notes: string[] = [];
  const fixtures: PlacedFixture[] = [];
  const posts = [...(frame?.posts.filter((p) => !p.roof).map((p) => ({ x: p.x, y: p.y, top: frame.joistBottomIn, kind: "deck" as const })) ?? []), ...(roof?.posts.map((p) => ({ x: p.x, y: p.y, top: p.topIn, kind: "roof" as const })) ?? [])];
  const railPosts = rails.members.filter((m) => m.role === "rail-post");
  const empty: ElectricalBuild = { on: false, fixtures: [], byClient: [], lv: null, circuits: [], feedFt: e.feedFt, trenchFt: 0, conduitFt: 0, boxes: 0, switches: 0, dimmers: 0, fanControls: 0, timers: 0, gfci: 0, breakers20: 0, breakers30: 0, wires: [], feedAt: [0, 0, 0], transformerAt: null, labor: { devices: 0, hang: 0, circuits: 0, wireFt: 0, trenchFt: 0, lvFixtures: 0 }, notes };
  if (e.fixtures.length === 0) return empty;

  // The feed arrives at the house wall's chosen end (or the nearest corner of a detached structure), 18 in. above the floor.
  const feedX = e.panelSide === "left" ? 0 : W;
  const feedAt: [number, number, number] = [feedX, 0, floorIn + 18];
  const runZ = roof ? roof.headerBottomIn - 2 : floorIn + 18;
  const ceilingZ = roof ? roof.headerBottomIn + (roof.peakIn - roof.headerBottomIn) * 0.45 : floorIn + 96;
  const centre: [number, number] = roof ? [roof.centreX, roof.centreY] : [W / 2, D / 2];

  const place = (f: Fixture): Array<Omit<PlacedFixture, "id" | "kind" | "label" | "supply" | "qty" | "watts" | "lv" | "volts240" | "placed" | "glow">> => {
    const [sx, sy, sz] = SIZE[f.kind];
    const one = (x: number, y: number, z: number, on: MountKind, yaw = 0, runFt = 0, size: [number, number, number] = [sx, sy, sz]) => ({ x, y, z, on, sx: size[0], sy: size[1], sz: size[2], yaw, runFt });
    if (f.at) return [one(f.at.x, f.at.y, f.at.z, f.at.on)];
    switch (f.kind) {
      case "led-strip": {
        // Under the rail's top (a deck) or under the headers all round (a roof).
        const headers = roof ? roof.headers.filter((h) => h.lengthIn > 1) : [];
        if (roof && headers.length) return headers.map((h) => one((h.x0 + h.x1) / 2, (h.y0 + h.y1) / 2, roof.headerBottomIn - 1, "header", Math.atan2(h.y1 - h.y0, h.x1 - h.x0), h.lengthIn / 12, [h.lengthIn, 0.6, 0.6]));
        if (rails.segments.length) return rails.segments.map((sg) => one((sg.x0 + sg.x1) / 2, (sg.y0 + sg.y1) / 2, (frame?.surfaceIn ?? floorIn) + rails.heightIn - 4, "rail", Math.atan2(sg.y1 - sg.y0, sg.x1 - sg.x0), sg.lengthIn / 12, [sg.lengthIn, 0.6, 0.6]));
        // No rail and no roof: along the rim.
        return [one(W / 2, D, (frame?.joistBottomIn ?? floorIn) + 2, "deck", 0, W / 12, [W, 0.6, 0.6])];
      }
      case "post-cap":
        return railPosts.length ? railPosts.map((p) => one(p.cx, p.cy, p.cz + p.sz / 2 + 1.75, "rail")) : posts.map((p) => one(p.x, p.y, p.top + 2, "post"));
      case "step-light": {
        const out: ReturnType<typeof one>[] = [];
        for (const st of stairs) for (const m of st.members.filter((mm) => mm.role === "riser")) out.push(one(m.cx, m.cy, m.cz, "stair", m.yaw, 0, [4, 0.8, 2]));
        return out.length ? out : [one(W / 2, D + 1, floorIn - 4, "stair")];
      }
      case "string-light": {
        // Post to post around the open sides, hung from the posts' tops.
        const ring = roof ? roof.posts.map((p) => ({ x: p.x, y: p.y, z: p.topIn })) : railPosts.filter((_, i) => i % 2 === 0).map((p) => ({ x: p.cx, y: p.cy, z: p.cz + p.sz / 2 }));
        if (ring.length < 2) return [one(W / 2, D / 2, floorIn + 96, "post", 0, (W + D) / 6)];
        const out: ReturnType<typeof one>[] = [];
        for (let i = 0; i + 1 < ring.length; i++) {
          const a = ring[i];
          const b = ring[i + 1];
          const L = Math.hypot(b.x - a.x, b.y - a.y);
          if (L < 1) continue;
          out.push(one((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2 - 6, "post", Math.atan2(b.y - a.y, b.x - a.x), L / 12, [L, 1, 2.5]));
        }
        return out.length ? out : [one(W / 2, D / 2, floorIn + 96, "post", 0, (W + D) / 6)];
      }
      case "sconce": {
        const list = (roof ? roof.posts.map((p) => ({ x: p.x, y: p.y })) : posts.map((p) => ({ x: p.x, y: p.y }))).slice(0, Math.max(1, f.qty));
        return list.length ? list.map((p) => one(p.x, p.y, floorIn + 72, "post")) : [one(0, D / 2, floorIn + 72, "wall")];
      }
      case "ceiling-light": {
        const n = Math.max(1, f.qty);
        const out: ReturnType<typeof one>[] = [];
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          out.push(one(roof ? roof.centreX - (W * 0.3) + W * 0.6 * t : W * t, centre[1], ceilingZ, "ceiling"));
        }
        return out;
      }
      case "chandelier":
        return [one(centre[0], centre[1], roof ? roof.peakIn - 30 : floorIn + 90, "peak")];
      case "fan":
        return [one(centre[0], centre[1], roof ? Math.min(roof.peakIn - 20, roof.headerBottomIn + 10) : floorIn + 96, "peak")];
      case "outlet": {
        const n = Math.max(1, f.qty);
        const out: ReturnType<typeof one>[] = [];
        const spots = roof ? roof.posts.filter((_, i) => i % 2 === 0) : posts;
        for (let k = 0; k < n; k++) {
          if (input.onHouse && k === 0) out.push(one(W * 0.25, 1.5, floorIn + 18, "wall"));
          else if (input.onHouse && k === 1) out.push(one(W * 0.75, 1.5, floorIn + 18, "wall"));
          else {
            const p = spots[(k - (input.onHouse ? 2 : 0)) % Math.max(1, spots.length)];
            out.push(p ? one(p.x, p.y, floorIn + 18, "post") : one(W / 2, D, floorIn + 18, "deck"));
          }
        }
        return out;
      }
      case "heater": {
        const n = Math.max(1, f.qty);
        const out: ReturnType<typeof one>[] = [];
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          if (roof) out.push(one(roof.centreX - W * 0.25 + W * 0.5 * t, roof.centreY, roof.headerBottomIn - 6, "ceiling"));
          else out.push(one(W * t, 2, floorIn + 84, "wall"));
        }
        return out;
      }
      case "flood": {
        const n = Math.max(1, f.qty);
        const out: ReturnType<typeof one>[] = [];
        for (let k = 0; k < n; k++) {
          if (input.onHouse) out.push(one(k % 2 === 0 ? 6 : W - 6, 1.5, floorIn + 108, "wall"));
          else if (roof && roof.posts[k]) out.push(one(roof.posts[k].x, roof.posts[k].y, roof.headerBottomIn - 4, "post"));
          else out.push(one(k % 2 === 0 ? 0 : W, D, floorIn + 96, "post"));
        }
        return out;
      }
      default:
        return [one(W / 2, D / 2, floorIn + 60, "deck")];
    }
  };

  for (const f of e.fixtures) {
    const spots = place(f);
    const perSpot = f.kind === "led-strip" || f.kind === "string-light" || f.kind === "post-cap" || f.kind === "step-light" ? 1 : f.qty > spots.length ? Math.ceil(f.qty / spots.length) : 1;
    spots.forEach((sp, i) => {
      const watts = f.kind === "heater" && f.volts240 ? HEATER_240_WATTS : f.kind === "led-strip" ? FIXTURE_WATTS["led-strip"] * Math.max(1, sp.runFt) : FIXTURE_WATTS[f.kind];
      fixtures.push({ id: spots.length > 1 ? `${f.id}-${i + 1}` : f.id, kind: f.kind, label: FIXTURE_LABEL[f.kind], supply: f.supply, qty: perSpot, ...sp, watts, lv: LOW_VOLTAGE.has(f.kind), volts240: f.kind === "heater" && !!f.volts240, placed: !!f.at, glow: GLOW[f.kind] });
    });
  }

  // Low voltage: a transformer at the feed (one per 150 W), 16/2 to every low-voltage fixture.
  const lvFixtures = fixtures.filter((f) => f.lv);
  const wires: WireRun[] = [];
  let lv: ElectricalBuild["lv"] = null;
  let transformerAt: ElectricalBuild["transformerAt"] = null;
  if (lvFixtures.length) {
    transformerAt = [feedX, input.onHouse ? 2 : 2, floorIn + 30];
    const watts = lvFixtures.reduce((a, f) => a + f.watts * (f.kind === "led-strip" ? 1 : f.qty), 0);
    const stripFt = lvFixtures.filter((f) => f.kind === "led-strip").reduce((a, f) => a + f.runFt, 0);
    const strands = lvFixtures.filter((f) => f.kind === "string-light").reduce((a, f) => a + Math.max(1, Math.ceil(f.runFt / STRAND_FT)), 0);
    let wireIn = 0;
    for (const f of lvFixtures) {
      const to: [number, number, number] = [f.x, f.y, f.z];
      const path = pathTo(transformerAt, to, f.on === "stair" || f.on === "deck" ? floorIn - 4 : runZ);
      const L = manhattan(transformerAt, to) * WIRE_SLACK;
      wireIn += L;
      wires.push({ kind: "lv", path, lengthFt: round1(L / 12) });
    }
    lv = { transformers: Math.max(1, Math.ceil(watts / TRANSFORMER_WATTS)), wireFt: Math.ceil(wireIn / 12), stripFt: Math.ceil(stripFt), strands, watts: Math.round(watts) };
  }

  // Line voltage: lights and outlets share 20-A GFCI circuits; every heater has its own.
  const line = fixtures.filter((f) => !f.lv);
  const circuits: Circuit[] = [];
  let conduitFt = 0;
  const lightsOutlets = line.filter((f) => f.kind !== "heater");
  if (lightsOutlets.length) {
    const va = lightsOutlets.reduce((a, f) => a + f.watts * f.qty, 0);
    const count = Math.max(1, Math.ceil(va / CIRCUIT_VA));
    const per = Math.ceil(lightsOutlets.length / count);
    for (let c = 0; c < count; c++) {
      const mine = lightsOutlets.slice(c * per, (c + 1) * per);
      let wireIn = e.feedFt * 12;
      let last: [number, number, number] = feedAt;
      for (const f of mine) {
        const to: [number, number, number] = [f.x, f.y, f.z];
        wires.push({ kind: "12/2", path: pathTo(last, to, runZ), lengthFt: round1((manhattan(last, to) * WIRE_SLACK) / 12) });
        wireIn += manhattan(last, to) * WIRE_SLACK + DROP_IN;
        last = to;
      }
      circuits.push({ id: `c${circuits.length + 1}`, kind: "lights-outlets", amps: 20, poles: 1, wire: "12/2", devices: mine.length, va: Math.round(mine.reduce((a, f) => a + f.watts * f.qty, 0)), wireFt: Math.ceil(wireIn / 12) });
      conduitFt += Math.ceil(wireIn / 12) * 0.5;
    }
  }
  for (const h of line.filter((f) => f.kind === "heater")) {
    const to: [number, number, number] = [h.x, h.y, h.z];
    const L = e.feedFt * 12 + manhattan(feedAt, to) * WIRE_SLACK + DROP_IN;
    wires.push({ kind: h.volts240 ? "10/2" : "12/2", path: pathTo(feedAt, to, runZ), lengthFt: round1((manhattan(feedAt, to) * WIRE_SLACK) / 12) });
    circuits.push({ id: `c${circuits.length + 1}`, kind: h.volts240 ? "heater-240" : "heater-120", amps: h.volts240 ? 30 : 20, poles: h.volts240 ? 2 : 1, wire: h.volts240 ? "10/2" : "12/2", devices: h.qty, va: h.watts * h.qty, wireFt: Math.ceil(L / 12) });
    conduitFt += Math.ceil(L / 12) * 0.5;
  }
  // The transformer is a device on the first lighting circuit (or a circuit of its own when there is nothing else).
  if (lv && !circuits.length) circuits.push({ id: "c1", kind: "lights-outlets", amps: 20, poles: 1, wire: "12/2", devices: 1, va: lv.watts, wireFt: e.feedFt + 4 });

  const detached = !input.onHouse;
  const trenchFt = detached ? Math.max(10, Math.round(e.feedFt * 0.6)) : 0;
  if (detached) notes.push(`The structure stands away from the house: the feed runs underground, about ${trenchFt} ft of trench and conduit, 18 in. deep (NEC 300.5).`);
  const boxes = line.reduce((a, f) => a + f.qty, 0) + (lv ? 1 : 0);
  const lightGroups = new Set(line.filter((f) => f.kind !== "outlet" && f.kind !== "heater" && f.kind !== "fan" && f.kind !== "chandelier" && f.kind !== "flood").map((f) => f.kind)).size + (lv ? 1 : 0);
  const switches = lightGroups + line.filter((f) => f.kind === "heater").reduce((a, f) => a + f.qty, 0);
  const dimmers = line.filter((f) => f.kind === "chandelier").length;
  const fanControls = line.filter((f) => f.kind === "fan").length;
  const timers = e.timer ? 1 : 0;
  const gfci = circuits.filter((c) => c.kind === "lights-outlets").length;
  const breakers20 = circuits.filter((c) => c.amps === 20).length;
  const breakers30 = circuits.filter((c) => c.amps === 30).length;
  const totalWireFt = circuits.reduce((a, c) => a + c.wireFt, 0) + (lv?.wireFt ?? 0);
  const byClient = fixtures.filter((f) => f.supply === "client");
  if (byClient.length) notes.push(`${byClient.length === 1 ? "One fixture is" : `${byClient.length} fixtures are`} the client's to buy — drawn as a sample, priced at nothing; the box, the wire and the hanging are in the price.`);
  if (line.some((f) => f.kind === "heater")) notes.push("Infrared heaters are hard-wired on a circuit of their own, mounted with the maker's clearances to the roof and the rails.");
  notes.push("Outdoor wiring is a licensed electrician's work and an inspection item; the permit is not in this price.");

  return {
    on: true,
    fixtures,
    byClient,
    lv,
    circuits,
    feedFt: e.feedFt,
    trenchFt,
    conduitFt: Math.ceil(conduitFt + trenchFt),
    boxes,
    switches,
    dimmers,
    fanControls,
    timers,
    gfci,
    breakers20,
    breakers30,
    wires,
    feedAt,
    transformerAt,
    labor: { devices: line.reduce((a, f) => a + f.qty, 0), hang: fixtures.filter((f) => f.kind === "chandelier" || f.kind === "fan" || f.kind === "heater").reduce((a, f) => a + f.qty, 0), circuits: circuits.length, wireFt: totalWireFt, trenchFt, lvFixtures: lvFixtures.reduce((a, f) => a + (f.kind === "led-strip" ? Math.ceil(f.runFt / 10) : f.qty), 0) },
    notes,
  };
}

/** "8 fixtures · 2 circuits · 160 ft of wire" */
export function electricalWords(el: ElectricalBuild): string {
  if (!el.on) return "No electrical";
  const n = el.fixtures.reduce((a, f) => a + (f.kind === "led-strip" ? 1 : f.qty), 0);
  return `${n} ${n === 1 ? "fixture" : "fixtures"} · ${el.circuits.length} ${el.circuits.length === 1 ? "circuit" : "circuits"} · ${el.labor.wireFt} ft of wire${el.byClient.length ? ` · ${el.byClient.length} by the client` : ""}`;
}
