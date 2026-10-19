// Lawn & landscape estimator (2026-10-18): the yard read from a synthetic aerial photo (no real address in a public
// repo) — lawn, a tree, a bed, the driveway, the house — the outlines and edges traced from it, the lawn split front /
// back / side from the street, the labels' storage, the pricing against the market, the season by state, the tax —
// and (2026-10-19) a wooded acreage: the maintained yard picked out of the woods, the field and the undergrowth, the
// pool told from a court and a pale roof, a lawn the tree-height map still calls woods — and the contractor's own
// shapes: their areas, a bed in a lawn coming off it, the names, the edges they meet, the photo's suggestions.
//   npx tsx qa/tests/logic/lawn-estimator.check.ts
import { classify, blueWater, CLS } from "../../../src/lib/lawn/classify";
import { traceLoops, signedArea, outlinesOf, edgeNeighbours } from "../../../src/lib/lawn/vectorize";
import { measureYard, slopeBands, confidenceOf, findHouse } from "../../../src/lib/lawn/measure";
import { encodeLabels, decodeLabels, withYard, type LawnSite } from "../../../src/lib/lawn/site";
import { fillRings, fromMerc, fromPx, ftPerPx, type Grid } from "../../../src/lib/lawn/geo";
import { ringSqft, pathFt, shapeAreas, measureShapes, suggestShapes, outlineAt, cleanShapes, labelPoint, nameFor, drawnShape, type LawnShape } from "../../../src/lib/lawn/shapes";
import { priceYard, pickMower, difficultyOf, cleanLawnSettings, cleanOptions, DEFAULT_LAWN_SETTINGS, DEFAULT_OPTIONS, mowBand, yardCanopyShare } from "../../../src/lib/lawn/pricing";
import { keepYard, shadedUndergrowth, yardArea, reReach, countPiece, fillPiece } from "../../../src/lib/lawn/yard";
import { climateFor, mowVisits, monthsOf, weeklyMonths, STATE_CLIMATE } from "../../../src/lib/lawn/season";
import { lawnTaxed, taxWords } from "../../../src/lib/lawn/tax";
import { rulesAt, inWindow, FERTILIZER, FLORIDA_SUMMER } from "../../../src/lib/lawn/rules";
import { seasonCalendar, planTotals, lawnSlots, toSchedule, mowHeightIn } from "../../../src/lib/lawn/calendar";
import { orderStops, balanceDays, onWeekday, nextWorkday, milesBetween, driveMinutes } from "../../../src/lib/lawn/routes";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/* A 0.3 m grid, 200 × 200 px (≈ 197 × 197 ft). The street runs along the bottom (y 170–200), outside the lot. */
const W = 200;
const H = 200;
const N = W * H;
const grid: Grid = { box: [0, 0, 60, 60], w: W, h: H, gsdM: 0.3, lat: 0 };
const fpp = ftPerPx(grid);
const rgb = new Uint8Array(N * 3);
const nir = new Uint8Array(N);
const chm = new Float32Array(N);
let seed = 3;
const noise = (amp: number) => {
  seed = (seed * 16807) % 2147483647;
  return ((seed / 2147483647) * 2 - 1) * amp;
};
const set = (x: number, y: number, r: number, g: number, b: number, n: number, height = 0) => {
  const i = y * W + x;
  rgb[i * 3] = r;
  rgb[i * 3 + 1] = g;
  rgb[i * 3 + 2] = b;
  nir[i] = n;
  chm[i] = height;
};
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const street = y >= 170;
    const house = x >= 70 && x < 130 && y >= 60 && y < 110;
    const drive = x >= 140 && x < 160 && y >= 110 && y < 170;
    const tree = (x - 40) ** 2 + (y - 140) ** 2 < 15 ** 2;
    const bed = x >= 70 && x < 130 && y >= 110 && y < 118;
    if (street || drive) set(x, y, 120 + noise(4), 120 + noise(4), 122 + noise(4), 115 + noise(4));
    else if (house) set(x, y, 150, 120, 100, 120);
    else if (tree) set(x, y, 40 + noise(20), 70 + noise(25), 35 + noise(15), 150 + noise(45), 9);
    else if (bed) set(x, y, 95 + noise(5), 70 + noise(5), 50 + noise(5), 85 + noise(5));
    else set(x, y, 70 + noise(3), 110 + noise(3), 55 + noise(3), 175 + noise(3)); // mown lawn: green, bright in NIR, smooth
  }
// The lot: everything above the street, inset 5 px from the sides and top.
const lotRing = [
  { x: 5, y: 5 },
  { x: 195, y: 5 },
  { x: 195, y: 168 },
  { x: 5, y: 168 },
];
const lot = fillRings(W, H, [lotRing]);
const houseMask = fillRings(W, H, [[{ x: 70, y: 60 }, { x: 130, y: 60 }, { x: 130, y: 110 }, { x: 70, y: 110 }]]);

console.log("── reading the yard");
const res = classify({ raster: { w: W, h: H, gsdM: 0.3, rgb, nir, chm }, lot, buildings: houseMask });
const L = res.labels;
const cls = (x: number, y: number) => L[y * W + x];
check("lawn reads as lawn", cls(30, 30) === CLS.LAWN && cls(170, 60) === CLS.LAWN, `${cls(30, 30)} ${cls(170, 60)}`);
check("the tree reads as a tree (its height)", cls(40, 140) === CLS.TREE);
check("the bed reads as a bed", cls(100, 114) === CLS.BED, String(cls(100, 114)));
check("the driveway reads as hard", cls(150, 140) === CLS.HARD);
check("the house is the house", cls(100, 80) === CLS.BUILDING);
check("the thresholds came from the photo", res.stats.vegT > 0.05 && res.stats.vegT < 0.31 && res.stats.canopy, JSON.stringify(res.stats));

console.log("── outlines and edges");
{
  const w = 10;
  const h = 10;
  const T = new Uint8Array(w * h);
  for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) T[y * w + x] = 1;
  for (let y = 4; y < 6; y++) for (let x = 4; x < 6; x++) T[y * w + x] = 4;
  for (let y = 2; y < 8; y++) T[y * w + 8] = 3;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = T[i] === 1 ? 1 : 0;
  const loops = traceLoops(m, w, h);
  const areas = loops.map(signedArea).sort((a, b) => b - a);
  check("a lawn with a hole traces two loops: 36 out, 4 in", areas.length === 2 && areas[0] === 36 && areas[1] === -4, JSON.stringify(areas));
  const e = edgeNeighbours(outlinesOf(T, w, h, 1, 1), T, w, h, 1);
  check("each stretch named by what's across it", e.get(0) === 18 && e.get(3) === 6 && e.get(4) === 8, JSON.stringify([...e]));
}

console.log("── the yard in numbers");
const m = measureYard({ grid, labels: L, lot, lotRing, slope: slopeBands(null, 0, 0, 1), photo: { date: "2025-07-01", gsdM: 0.3 }, parcel: true, footprints: true, canopyMap: true });
const sqftPx = fpp * fpp;
check("the street side is the bottom edge", m.frontEdge === 2, String(m.frontEdge));
// Front: between the street and the house's front (y 110–168); back: above the house (y 5–60); sides: beside it.
const expectFront = 190 * 50 * sqftPx; // rough: the lot's width × the front yard's depth, less the drive, bed and tree
check("front lawn is the yard between the house and the street", m.lawnByZone.front > 0 && m.lawnByZone.front < expectFront, `${m.lawnByZone.front} vs < ${Math.round(expectFront)}`);
check("back lawn is behind the house", near(m.lawnByZone.back, 190 * 55 * sqftPx, 190 * 55 * sqftPx * 0.08), `${m.lawnByZone.back} vs ${Math.round(190 * 55 * sqftPx)}`);
check("side lawns beside the house", m.lawnByZone.side > 0, String(m.lawnByZone.side));
check("lawn = front + back + sides", m.lawnSqft === m.lawnByZone.front + m.lawnByZone.back + m.lawnByZone.side || near(m.lawnSqft, m.lawnByZone.front + m.lawnByZone.back + m.lawnByZone.side, 3));
check("the tree stands in the lawn", m.treesInLawn === 1, String(m.treesInLawn));
check("the house is about 60 × 50 px", near(m.houseSqft, 60 * 50 * sqftPx, 60 * 50 * sqftPx * 0.05), `${m.houseSqft}`);
check("hard edging along the drive", m.edges.hardFt > 60 * fpp, `${m.edges.hardFt} ft`);
check("foundation trim along the house's sides and back", m.edges.houseFt > 100 * fpp, `${m.edges.houseFt} ft`);
check("lot-line trim along the three lot lines", m.edges.lotLineFt > 300 * fpp, `${m.edges.lotLineFt} ft`);
check("a clear photo, a parcel and footprints: green", m.confidence.level === "green", JSON.stringify(m.confidence));

console.log("── without footprints, the house is found");
{
  const L2 = classify({ raster: { w: W, h: H, gsdM: 0.3, rgb, nir, chm }, lot, buildings: null }).labels;
  const n = findHouse(L2, lot, grid);
  check("a solid roof away from the lot line is the house", n > 0 && L2[80 * W + 100] === CLS.BUILDING && L2[140 * W + 150] !== CLS.BUILDING, `${n} px`);
}

console.log("── confidence");
const c1 = confidenceOf({ photo: { date: "2019-01-10", gsdM: 0.6 }, parcel: false, footprints: false, canopyMap: false, lawnSqft: 3000, canopySqft: 6000, groundSqft: 10000, now: new Date("2026-10-18") });
check("old winter 60 cm photo, no parcel, many trees: red with reasons", c1.level === "red" && c1.reasons.length >= 5, JSON.stringify(c1));

console.log("── slope");
{
  const cols = 5;
  const rows = 5;
  const flat = slopeBands(new Array(25).fill(100), cols, rows, 8);
  check("flat ground is flat", flat.flat === 1 && flat.source === "lidar");
  const steep = slopeBands(Array.from({ length: 25 }, (_, i) => (i % cols) * 2.4), cols, rows, 8); // 2.4 ft per 8 ft = 30%
  check("30% ground is steep, not over 33%", steep.steep === 1 && steep.tooSteep === 0, JSON.stringify(steep));
}

console.log("── storage");
{
  const enc = encodeLabels(L);
  const dec = decodeLabels(enc, N);
  check("labels survive the round trip", dec.every((v, i) => v === L[i]) && enc.length < N / 4, `${enc.length} chars for ${N} px`);
}

console.log("── pricing");
const base = { ...m, lawnSqft: 6000, lotSqft: 10500, lawnByZone: { front: 2000, back: 3500, side: 500 } };
const q = priceYard({ measures: base, settings: DEFAULT_LAWN_SETTINGS, options: DEFAULT_OPTIONS, locationFactor: 1, state: "IL", ownRate: false });
const mow = q.services.find((x) => x.id === "mow")!;
check("a quarter-acre lot mows inside the market's range", mow.unitPrice >= mow.market!.low * 0.85 && mow.unitPrice <= mow.market!.high * 1.15, `$${mow.unitPrice} vs $${mow.market!.low}–${mow.market!.high}`);
check("Illinois: 26 weekly cuts", q.visits === 26, String(q.visits));
check("a 6,000 sq ft lawn takes the rider when the crew has one", pickMower(base, ["21", "48", "61rider"]) === "61rider" && pickMower({ ...base, lawnSqft: 3000 }, ["21", "48", "61rider"]) === "48" && pickMower({ ...base, lawnSqft: 900 }, ["21", "48"]) === "21");
check("never below the minimum stop", priceYard({ measures: { ...base, lawnSqft: 400 }, settings: { ...DEFAULT_LAWN_SETTINGS, minimumStop: 60 }, options: DEFAULT_OPTIONS, locationFactor: 1, state: "IL", ownRate: true }).services.find((x) => x.id === "mow")!.unitPrice >= 60);
const fert = q.services.find((x) => x.id === "fert")!;
check("fertilizer in the market's range", fert.unitPrice >= 40 && fert.unitPrice <= 110, `$${fert.unitPrice}`);
const mulch = q.services.find((x) => x.id === "mulch");
check("mulch by the cubic yard: bed sq ft × depth ÷ 324 (+10%)", !!mulch && near(mulch.qty, Math.ceil(((base.bedSqft * 2) / 324) * 1.1 * 2) / 2, 0.01) && mulch.taxClass === "install", mulch ? `${mulch.qty} yd` : "none");
check("the company's own rate is used as set, the market's scaled by city", priceYard({ measures: base, settings: { ...DEFAULT_LAWN_SETTINGS, ratePerPersonHour: 80 }, options: DEFAULT_OPTIONS, locationFactor: 1.3, state: "IL", ownRate: true }).rate === 80 && priceYard({ measures: base, settings: DEFAULT_LAWN_SETTINGS, options: DEFAULT_OPTIONS, locationFactor: 1.3, state: "IL", ownRate: false }).rate === Math.round(55 * 1.3));
check("biweekly is about half the cuts", priceYard({ measures: base, settings: DEFAULT_LAWN_SETTINGS, options: { ...DEFAULT_OPTIONS, frequency: "biweekly" }, locationFactor: 1, state: "IL", ownRate: false }).visits === 15);
const many = difficultyOf({ ...base, treesInLawn: 12, slope: { flat: 0.5, moderate: 0.2, steep: 0.3, tooSteep: 0, samples: 50, source: "lidar" } });
check("trees and slope make it a difficult lawn", many.level === "difficult", JSON.stringify(many));
check("rates are held to sense", cleanLawnSettings({ ratePerPersonHour: -5, crewSize: 99, mowers: ["boat"] }).ratePerPersonHour === 15 && cleanLawnSettings({ crewSize: 99 }).crewSize === 8 && cleanLawnSettings({ mowers: ["boat"] }).mowers.length > 0);
check("options are held to sense", cleanOptions({ frequency: "daily", fertRounds: 40, mulchDepthIn: 9 }).frequency === "weekly" && cleanOptions({ fertRounds: 40 }).fertRounds === 10 && cleanOptions({ mulchDepthIn: 9 }).mulchDepthIn === 2);

console.log("── seasons, all 50 states and DC");
check("every state has a climate", Object.keys(STATE_CLIMATE).length === 51);
const visits = Object.fromEntries(Object.keys(STATE_CLIMATE).map((st) => [st, mowVisits(climateFor(st), "weekly")]));
check("Florida mows all year, Minnesota half of it", visits.FL >= 38 && visits.MN <= 24, `FL ${visits.FL}, MN ${visits.MN}`);
check("every state's weekly plan lands 18–45 cuts", Object.values(visits).every((v) => v >= 18 && v <= 45), JSON.stringify(visits));
check("a cool-season lawn mows weekly between its first and last month", JSON.stringify(weeklyMonths(climateFor("IL"))) === "[5,6,7,8,9]" && JSON.stringify(monthsOf(climateFor("IL"))) === "[4,5,6,7,8,9,10]");

console.log("── sales tax on lawn work");
check("Texas taxes mowing; Florida doesn't", lawnTaxed("TX", "service") && !lawnTaxed("FL", "service"));
check("New York taxes mowing but not installing (a capital improvement)", lawnTaxed("NY", "service") && !lawnTaxed("NY", "install") && /ST-124/.test(taxWords("NY")));
check("Arizona taxes installing, not mowing", !lawnTaxed("AZ", "service") && lawnTaxed("AZ", "install"));

console.log("── the rules at an address");
{
  const nj = rulesAt("NJ");
  check("New Jersey: phosphorus-limited, no fertilizer Dec 1 – Mar 1, 72-hour lawn signs, no neonicotinoids", nj.phosphorusLimited && nj.blackouts.some((w) => w.from === "12-01" && w.to === "03-01") && nj.rules.some((r) => /72 hours/.test(r.title)) && nj.rules.some((r) => /neonicotinoid/i.test(r.title)));
  check("a blackout over New Year: Jan 15 is in Dec 1 – Mar 1, Apr 15 isn't", inWindow(new Date("2027-01-15"), { from: "12-01", to: "03-01", what: "all" }) && !inWindow(new Date("2027-04-15"), { from: "12-01", to: "03-01", what: "all" }));
  const pin = rulesAt("FL", "Pinellas County");
  check("Pinellas County: the summer nitrogen ban and the state's applicator certificate", pin.blackouts.some((w) => w.what === "nitrogen-phosphorus" && w.from === "06-01") && pin.rules.some((r) => /LCFAC/.test(r.title)));
  check("Montgomery County bans cosmetic pesticides and gas blowers", rulesAt("MD", "Montgomery County").herbicideBan && rulesAt("MD", "Montgomery County").rules.some((r) => r.kind === "equipment"));
  check("Florida's summer-ban counties are 17", Object.keys(FLORIDA_SUMMER).length === 17);
  check("every rule says where it comes from", Object.values(FERTILIZER).every((f) => !!f.source) && rulesAt("CA").rules.every((r) => r.source.length > 10));
  check("a state with no fertilizer law still hears about the applicator's licence", rulesAt("GA").rules.some((r) => r.kind === "pesticide") && !rulesAt("GA").phosphorusLimited);
}

console.log("── the season, date by date");
{
  const yard = { ...base, bedSqft: 600, bedPerimeterFt: 160 };
  const opts = { ...DEFAULT_OPTIONS, irrigationZones: 5 };
  const picked = ["mow", "fert", "aerate", "overseed", "springCleanup", "fallCleanup", "mulch", "irrigationStart", "irrigationBlowout"] as const;
  const cal = (st: string, county: string | null = null) => {
    const q = priceYard({ measures: yard, settings: DEFAULT_LAWN_SETTINGS, options: opts, locationFactor: 1, state: st, ownRate: false });
    return { q, v: seasonCalendar({ start: new Date("2027-01-15"), quote: q, picked, fertRounds: 5, frequency: "weekly", rules: rulesAt(st, county), crewSize: 2 }) };
  };
  const il = cal("IL");
  const mows = il.v.filter((x) => x.service === "mow");
  check("Illinois mows as many times as the quote counts, April to October", mows.length === il.q.visits && mows[0].date.startsWith("2027-04") && mows[mows.length - 1].date.startsWith("2027-10"), `${mows.length} vs ${il.q.visits}, ${mows[0]?.date}–${mows[mows.length - 1]?.date}`);
  check("cool-season: aeration and overseeding in September, the blowout before the freeze", il.v.some((x) => x.service === "aerate" && x.date.slice(5, 7) === "09") && il.v.some((x) => x.service === "irrigationBlowout" && x.date.slice(5, 7) === "10"));
  const ferts = il.v.filter((x) => x.service === "fert");
  check("five fertilizer rounds, the first the crabgrass pre-emergent", ferts.length === 5 && /pre-emergent/.test(ferts[0].checklist[0]), JSON.stringify(ferts.map((f) => f.date)));
  const nj = cal("NJ").v.filter((x) => x.service === "fert");
  check("New Jersey: no round from Dec 1 to Mar 1", nj.every((f) => !inWindow(new Date(f.date), { from: "12-01", to: "03-01", what: "all" })), JSON.stringify(nj.map((f) => f.date)));
  const vt = cal("VT").v.filter((x) => x.service === "fert");
  check("Vermont: every round between Apr 1 and Oct 15", vt.every((f) => f.date.slice(5) >= "04-01" && f.date.slice(5) <= "10-15"), JSON.stringify(vt.map((f) => f.date)));
  const pin = cal("FL", "Pinellas County").v;
  const summer = pin.filter((x) => x.service === "fert" && x.date.slice(5) >= "06-01" && x.date.slice(5) <= "09-30");
  check("Pinellas: a summer round is iron and micronutrients, not nitrogen", summer.length > 0 && summer.every((x) => /Iron and micronutrients/.test(x.checklist[0])));
  check("Florida: no sprinkler start-up (never winterized), spring work in March", !pin.some((x) => x.service === "irrigationStart") && pin.find((x) => x.service === "springCleanup")?.date.slice(5, 7) === "03");
  check("bermuda (Arizona) gets winter rye in October", cal("AZ").v.some((x) => x.service === "overseed" && x.label === "Winter rye overseed" && x.date.slice(5, 7) === "10"));
  check("mowing height: bermuda 1.5 in, tall fescue 3.5 in, bluegrass 3 in raised to 3.5 in in July", mowHeightIn(climateFor("AZ"), 6) === 1.5 && mowHeightIn(climateFor("VA"), 5) === 3.5 && mowHeightIn(climateFor("IL"), 7) === 3.5);
  const t = planTotals(il.v, il.q, picked);
  check("the plan's season is every visit's price; a month is a twelfth", near(t.monthly, t.season / 12, 0.01) && t.visits === il.v.length);
  // Kept with the plan by month-day: the next term books the same season again.
  const slots = lawnSlots(toSchedule(il.v), new Date("2028-01-15"), 12);
  check("a renewal books the same season the next year", slots.length === il.v.length && slots[0].dueAt.getUTCFullYear() === 2028 && slots.every((x, i) => i === 0 || x.dueAt >= slots[i - 1].dueAt), `${slots.length} vs ${il.v.length}`);
  const mid = lawnSlots(toSchedule(il.v), new Date("2027-07-01"), 12);
  check("a plan started mid-season books what's left this year and the start of next", mid.length === il.v.length && mid[0].dueAt.getUTCMonth() === 6 && mid[mid.length - 1].dueAt.getUTCFullYear() === 2028);
}

console.log("── route days");
{
  // Eight yards on two streets a mile apart, west to east; the shop at the west end.
  const shop = { lat: 33.35, lng: -111.8 };
  const yards = Array.from({ length: 8 }, (_, i) => ({ id: `y${i}`, at: { lat: i % 2 ? 33.364 : 33.35, lng: -111.8 + 0.006 * i }, minutes: 40 + (i % 3) * 10 }));
  const shuffled = [yards[5], yards[0], yards[7], yards[2], yards[4], yards[1], yards[6], yards[3]];
  const { order, driveMinutes: dm } = orderStops(shop, shuffled);
  const naive = shuffled.reduce((a, y, i) => a + driveMinutes(i ? shuffled[i - 1].at : shop, y.at), 0);
  check("a day's stops ordered: shorter than the order they came in", dm < naive && order.length === 8, `${dm} vs ${naive} min`);
  check("the first stop is the nearest to the shop", order[0].id === "y0");
  check("a mile is a mile", near(milesBetween({ lat: 33.35, lng: -111.8 }, { lat: 33.3645, lng: -111.8 }), 1, 0.02));
  const days = balanceDays(yards, 2);
  const west = yards.filter((y) => days.get(y.id) === 0);
  const east = yards.filter((y) => days.get(y.id) === 1);
  check("two route days: the west half and the east half", west.length && east.length && Math.max(...west.map((y) => y.at.lng)) < Math.min(...east.map((y) => y.at.lng)), JSON.stringify([...days]));
  const loads = [0, 1].map((d) => yards.filter((y) => days.get(y.id) === d).reduce((a, y) => a + y.minutes, 0));
  check("the days are within a fifth of each other", Math.max(...loads) <= Math.min(...loads) * 1.2 + 30, JSON.stringify(loads));
  check("Wednesday of the week of Friday Oct 23, 2026 is Oct 21", onWeekday(new Date("2026-10-23T00:00:00Z"), 3).toISOString().startsWith("2026-10-21"));
  check("rained out on Saturday: Monday", nextWorkday(new Date("2026-10-24T00:00:00Z")).toISOString().startsWith("2026-10-26"));
}

console.log("── the maintained yard on a wooded acreage");
{
  // 600 × 600 px at 0.3 m (≈ 590 ft square, 8 acres), all woods but: the house in the middle with ~100 ft of lawn round
  // it, a pool and (50 px south) a stretch of that lawn the height map still calls 14 m trees; out in the woods a canopy
  // gap, a clearing, a shaded patch of undergrowth by the woods' edge; a field to the south; a pool-blue court; a pale
  // blue shed roof.
  const W2 = 600;
  const H2 = 600;
  const N2 = W2 * H2;
  const g2: Grid = { box: [0, 0, 180, 180], w: W2, h: H2, gsdM: 0.3, lat: 0 };
  const rgb2 = new Uint8Array(N2 * 3);
  const nir2 = new Uint8Array(N2);
  const chm2 = new Float32Array(N2);
  const put = (i: number, r: number, gr: number, b: number, n: number, ht = 0) => {
    rgb2.set([r, gr, b], i * 3);
    nir2[i] = n;
    chm2[i] = ht;
  };
  const inBox = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) => x >= x0 && x < x1 && y >= y0 && y < y1;
  for (let y = 0; y < H2; y++)
    for (let x = 0; x < W2; x++) {
      const i = y * W2 + x;
      const yard = (x - 300) ** 2 + (y - 300) ** 2 < 100 ** 2;
      const lawn = (r = 1) => put(i, 70 + noise(3) * r, 110 + noise(3) * r, 55 + noise(3) * r, 175 + noise(3) * r);
      if (inBox(x, y, 280, 280, 320, 320)) put(i, 150, 120, 100, 120); // the house
      else if (inBox(x, y, 330, 250, 345, 275)) put(i, 79, 163, 200, 170); // the pool: bright cyan, bright in NIR on this flight
      else if (inBox(x, y, 260, 340, 330, 380)) put(i, 70 + noise(3), 110 + noise(3), 55 + noise(3), 175 + noise(3), 14); // felled since the height map
      else if (yard) lawn();
      else if (inBox(x, y, 40, 40, 48, 48)) lawn(); // a sunlit gap in the canopy
      else if (inBox(x, y, 500, 60, 525, 85)) lawn(); // a clearing deep in the woods
      else if (inBox(x, y, 430, 280, 480, 320)) put(i, 45 + noise(3), 75 + noise(3), 40 + noise(3), 85 + noise(3)); // undergrowth in the shade
      else if (y >= 470 && y < 590 && x >= 100 && x < 500) lawn(); // the field
      else if (inBox(x, y, 120, 150, 180, 180)) put(i, ...((x - 120) % 30 < 2 || (y - 150) % 15 < 2 ? ([235, 235, 232, 220] as const) : ([90, 178, 204, 172] as const))); // a pool-blue court, white lines
      else if (inBox(x, y, 450, 420, 470, 440)) put(i, 200, 225, 250, 240); // a pale blue shed roof
      else put(i, 40 + noise(20), 70 + noise(25), 35 + noise(15), 150 + noise(45), 15); // woods
    }
  const lot2 = fillRings(W2, H2, [[{ x: 5, y: 5 }, { x: 595, y: 5 }, { x: 595, y: 595 }, { x: 5, y: 595 }]]);
  const b2 = fillRings(W2, H2, [[{ x: 280, y: 280 }, { x: 320, y: 280 }, { x: 320, y: 320 }, { x: 280, y: 320 }]]);
  const read2 = classify({ raster: { w: W2, h: H2, gsdM: 0.3, rgb: rgb2, nir: nir2, chm: chm2 }, lot: lot2, buildings: b2 }).labels;
  const at = (L: Uint8Array, x: number, y: number) => L[y * W2 + x];
  check("the pool is water — pool-blue, though bright in the near-infrared", at(read2, 337, 262) === CLS.WATER, String(at(read2, 337, 262)));
  check("a pool-blue court split by its lines is paving, not a pool", at(read2, 135, 157) === CLS.HARD && at(read2, 165, 172) === CLS.HARD, `${at(read2, 135, 157)} ${at(read2, 165, 172)}`);
  check("a pale blue roof isn't water", at(read2, 460, 430) !== CLS.WATER, String(at(read2, 460, 430)));
  check("lawn the height map still calls trees reads as lawn", at(read2, 295, 360) === CLS.LAWN, String(at(read2, 295, 360)));
  check("the woods are trees", at(read2, 100, 300) === CLS.TREE && at(read2, 550, 300) === CLS.TREE);
  check("pool-blue: a pool yes; a slate roof, a white glint, sky-blue shade no", blueWater(79, 163, 200, 170) && blueWater(70, 107, 118, 37) && !blueWater(94, 123, 134, 97) && !blueWater(176, 197, 203, 189) && !blueWater(66, 113, 142, 95));
  const under = shadedUndergrowth(read2, lot2, g2, { rgb: rgb2, nir: nir2 });
  check("the shaded green the woods rim is undergrowth, set natural", at(read2, 455, 300) === CLS.NATURAL && under > 1000, `${at(read2, 455, 300)}, ${under} sq ft`);
  check("the lawn in the sun stays lawn", at(read2, 300, 230) === CLS.LAWN);
  const y200 = keepYard(read2, lot2, g2, { reachFt: 200 });
  const L2 = y200.labels;
  check("the yard round the house is kept", at(L2, 300, 230) === CLS.LAWN && at(L2, 380, 300) === CLS.LAWN, `${at(L2, 300, 230)} ${at(L2, 380, 300)}`);
  check("a gap in the canopy is the woods'", at(L2, 44, 44) === CLS.TREE, String(at(L2, 44, 44)));
  check("a clearing deep in the woods is left natural", at(L2, 512, 72) === CLS.NATURAL, String(at(L2, 512, 72)));
  check("the field: counted within 200 ft of the house, natural past it", at(L2, 300, 490) === CLS.LAWN && at(L2, 300, 570) === CLS.NATURAL, `${at(L2, 300, 490)} ${at(L2, 300, 570)}`);
  check("the reach is reported", y200.reachFt === 200 && y200.naturalSqft > 20000, JSON.stringify({ reach: y200.reachFt, natural: y200.naturalSqft }));
  const m2 = measureYard({ grid: g2, labels: L2, lot: lot2, lotRing: null, photo: { date: "2025-07-01", gsdM: 0.3 }, parcel: true, footprints: true, canopyMap: true });
  const sq2 = (0.3 * 3.280839895) ** 2;
  check("the lawn is the yard's and the field's near part, not the 8 acres", m2.lawnSqft > Math.PI * 95 ** 2 * sq2 * 0.8 && m2.lawnSqft < 70000, `${m2.lawnSqft} sq ft`);
  check("the trees that matter are the yard's: under a third of the woods", (m2.yardCanopySqft ?? 0) > 0 && (m2.yardCanopySqft ?? 0) < m2.treeCanopySqft / 3, `${m2.yardCanopySqft} of ${m2.treeCanopySqft}`);
  check("the maintained yard: one area round the house, far under the lot", (m2.yardSqft ?? 0) > m2.lawnSqft * 0.9 && (m2.yardSqft ?? 0) < m2.lotSqft / 2, `${m2.yardSqft} of ${m2.lotSqft}`);
  check("natural ground counted apart", (m2.naturalSqft ?? 0) === y200.naturalSqft, `${m2.naturalSqft} vs ${y200.naturalSqft}`);
  const ya = yardArea(L2, lot2, g2);
  check("the yard area takes in the house and pool, not the woods", ya.mask[300 * W2 + 300] === 1 && ya.mask[262 * W2 + 337] === 1 && ya.mask[300 * W2 + 100] === 0);
  // A wider reach takes in more of the field; an edit made before stays.
  const edited = new Uint8Array(L2);
  for (let y = 225; y < 235; y++) for (let x = 295; x < 305; x++) edited[y * W2 + x] = CLS.BED;
  const y300 = reReach(read2, edited, lot2, g2, 200, 300);
  check("300 ft takes in the field's far end", at(y300.labels, 300, 570) === CLS.LAWN, String(at(y300.labels, 300, 570)));
  check("the contractor's bed survives the reach change", at(y300.labels, 300, 230) === CLS.BED);
  check("a tap counts the field back in as grass to mow", at(countPiece(L2, read2, lot2, W2, H2, 570 * W2 + 300), 300, 570) === CLS.LAWN);
  check("a tap leaves a lawn piece out", at(fillPiece(L2, lot2, W2, H2, 230 * W2 + 300, CLS.NATURAL), 380, 300) === CLS.NATURAL);
  // No building on the lot: nothing to measure reach from, nothing cut.
  const noHouse = new Uint8Array(read2);
  for (let i = 0; i < N2; i++) if (noHouse[i] === CLS.BUILDING) noHouse[i] = CLS.HARD;
  check("no building: the field is all counted", at(keepYard(noHouse, lot2, g2).labels, 300, 570) === CLS.LAWN && keepYard(noHouse, lot2, g2).reachFt === null);
  // An estimate saved before the yard pass opens with it, its edit kept.
  {
    const oldEdit = new Uint8Array(read2);
    for (let y = 225; y < 235; y++) for (let x = 295; x < 305; x++) oldEdit[y * W2 + x] = CLS.BED;
    // The lot ring in lat/lng on g2's Mercator box (0.3 m a pixel, y down from the box's top).
    const ring = [{ x: 5, y: 5 }, { x: 595, y: 5 }, { x: 595, y: 595 }, { x: 5, y: 595 }].map((q) => fromMerc({ x: q.x * 0.3, y: 180 - q.y * 0.3 }));
    const fake = { v: 1, grid: { box: g2.box, w: W2, h: H2, gsdM: 0.3, lat: 0 }, lot: { ring, source: "parcel", parcelId: null, acreage: null, stories: null }, labels: encodeLabels(oldEdit), readLabels: encodeLabels(read2) } as unknown as LawnSite;
    const fresh = { ...fake, yard: { reachFt: 200 } } as LawnSite;
    check("a new estimate opens as saved", withYard(fresh, oldEdit).labels === oldEdit);
    const up = withYard(fake, oldEdit);
    check("an old estimate opens with the yard picked out, its edit kept", up.site.yard?.reachFt === 200 && up.labels[230 * W2 + 300] === CLS.BED && up.labels[570 * W2 + 300] === CLS.NATURAL, `${up.site.yard?.reachFt} ${up.labels[230 * W2 + 300]} ${up.labels[570 * W2 + 300]}`);
  }
  // The market by the lawn, the leaves by the yard's own trees.
  check("a 4,000 sq ft lawn on a 6-acre lot is a quarter-acre mow", mowBand(4000).band[0] === 41 && mowBand(30000).band[0] === 99 && mowBand(87120).band[1] === 528, JSON.stringify([mowBand(4000), mowBand(87120)]));
  check("the leaf factor is the yard's trees, not the woods'", near(yardCanopyShare({ lawnSqft: 4000, bedSqft: 1000, treeCanopySqft: 200000, lotSqft: 250000, yardCanopySqft: 5000 }), 0.5, 0.001) && near(yardCanopyShare({ lawnSqft: 4000, bedSqft: 1000, treeCanopySqft: 2000, lotSqft: 10000 }), 0.2, 0.001));
  const qWoods = priceYard({ measures: m2, settings: DEFAULT_LAWN_SETTINGS, options: DEFAULT_OPTIONS, locationFactor: 1, state: "WA", ownRate: false });
  const fall = qWoods.services.find((x) => x.id === "fallCleanup")!;
  check("the fall cleanup's market is the yard's acres, not the lot's", fall.market!.high < 2000, `$${fall.market!.low}–${fall.market!.high}`);
}

console.log("── the contractor's shapes");
{
  // The first synthetic yard as a site: 0.3 m pixels, the lot inset 5 px, the house at x 70–130, y 60–110.
  const ringOf = (pts: Array<[number, number]>) => pts.map(([x, y]) => fromPx(grid, { x, y }));
  const site = { v: 1, address: "", lat: 0, lng: 0, state: "IL", place: "", locationFactor: 1, photo: null, grid, lot: { ring: ringOf(lotRing.map((q) => [q.x, q.y] as [number, number])), source: "parcel", parcelId: null, acreage: null, stories: null }, labels: encodeLabels(L), readLabels: encodeLabels(L), slope: slopeBands(null, 0, 0, 1), sources: { parcel: true, footprints: true, canopyMap: true, lidar: false }, readAt: "" } as unknown as LawnSite;
  const px = (n: number) => n * fpp; // pixels → feet
  const back = ringOf([[10, 10], [190, 10], [190, 60], [10, 60]]);
  check("a drawn rectangle's area: 180 × 50 px", near(ringSqft(back), px(180) * px(50), 1), `${Math.round(ringSqft(back))} vs ${Math.round(px(180) * px(50))}`);
  check("and its length round", near(pathFt(back), 2 * (px(180) + px(50)), 0.5), `${Math.round(pathFt(back))} ft`);
  const lawnA: LawnShape = { id: "a", kind: "lawn", name: "Back lawn", ring: back };
  const bedIn: LawnShape = { id: "b", kind: "bed", name: "Back bed", ring: ringOf([[40, 20], [60, 20], [60, 40], [40, 40]]) };
  const cutIn: LawnShape = { id: "c", kind: "cut", name: "Not mowed", ring: ringOf([[120, 20], [140, 20], [140, 30], [120, 30]]) };
  const a1 = shapeAreas(site, [lawnA, bedIn, cutIn]);
  const exact = ringSqft(back) - ringSqft(bedIn.ring) - ringSqft(cutIn.ring);
  check("a bed and a cut-out inside a lawn come off it — exactly", near(a1.lawnSqft, exact, 1) && near(a1.each.a.net, exact, 0.01), `${a1.lawnSqft} vs ${Math.round(exact)}`);
  check("the bed counts as bed", near(a1.bedSqft, ringSqft(bedIn.ring), 1), String(a1.bedSqft));
  // Two lawns drawn over each other count the overlap once.
  const lawnB: LawnShape = { id: "d", kind: "lawn", name: "Back lawn 2", ring: ringOf([[100, 10], [190, 10], [190, 60], [100, 60]]) };
  const a2 = shapeAreas(site, [lawnA, lawnB]);
  check("a lawn drawn inside another (sharing its edge) isn't counted twice", near(a2.lawnSqft, ringSqft(back), 1), `${a2.lawnSqft} vs ${Math.round(ringSqft(back))}`);
  const bedBeside: LawnShape = { id: "f", kind: "bed", name: "Side bed", ring: ringOf([[190, 10], [195, 10], [195, 60], [190, 60]]) };
  check("a bed snapped against the lawn's edge, outside it, takes nothing off", near(shapeAreas(site, [lawnA, bedBeside]).lawnSqft, ringSqft(back), 1));
  const crossing: LawnShape = { id: "e", kind: "lawn", name: "x", ring: ringOf([[150, 30], [195, 30], [195, 100], [150, 100]]) };
  const a3 = shapeAreas(site, [lawnA, crossing]);
  const union = ringSqft(back) + ringSqft(crossing.ring) - px(40) * px(30);
  check("lawns that cross count their overlap once (to the pixel)", near(a3.lawnSqft, union, union * 0.02), `${a3.lawnSqft} vs ${Math.round(union)}`);
  // The measures: the shapes' areas; the edges from what they meet.
  const ms = measureShapes(site, L, [lawnA, bedIn]).measures;
  check("measured lawn is the shapes' lawn", near(ms.lawnSqft, ringSqft(back) - ringSqft(bedIn.ring), 1), String(ms.lawnSqft));
  check("the drawn lawn is behind the house", ms.lawnByZone.back === ms.lawnSqft, JSON.stringify(ms.lawnByZone));
  check("its edge along the house is foundation trim", ms.edges.houseFt > px(50), `${ms.edges.houseFt} ft`);
  check("its edge round the bed is a bed edge", ms.edges.bedFt > px(60), `${ms.edges.bedFt} ft`);
  check("the bed's edge is its own outline", near(ms.bedPerimeterFt, pathFt(bedIn.ring), 1), `${ms.bedPerimeterFt} ft`);
  check("nothing drawn: nothing to mow", measureShapes(site, L, []).measures.lawnSqft === 0);
  // Names for where they lie.
  check("a shape drawn in the front yard is the front lawn", drawnShape(site, "lawn", ringOf([[10, 120], [60, 120], [60, 160], [10, 160]]), L, []).name === "Front lawn");
  check("a second one is numbered", nameFor("lawn", "back", ["Back lawn"]) === "Back lawn 2" && nameFor("cut", "front", []) === "Not mowed");
  // The photo's suggestions and the one-tap outline.
  const sug = suggestShapes(site, L);
  const sugLawn = sug.filter((x) => x.kind === "lawn").reduce((t, x) => t + ringSqft(x.ring), 0);
  check("suggestions outline the lawn the photo reads", sug.some((x) => x.kind === "lawn") && near(sugLawn, m.lawnSqft + m.treeCanopySqft * 0, m.lawnSqft * 0.2), `${Math.round(sugLawn)} vs ${m.lawnSqft}`);
  check("and the bed", sug.some((x) => x.kind === "bed"), sug.map((x) => x.name).join(", "));
  const one = outlineAt(site, L, fromPx(grid, { x: 30, y: 30 }), []);
  check("a tap on the lawn outlines that piece", !!one && one.kind === "lawn" && ringSqft(one.ring) > 1000, one ? `${one.name} ${Math.round(ringSqft(one.ring))}` : "none");
  check("a tap on the house outlines nothing", outlineAt(site, L, fromPx(grid, { x: 100, y: 80 }), []) === null);
  // The label sits inside the lawn, clear of the bed in it.
  const lp = labelPoint(back, [bedIn.ring]);
  const lpx = (() => { const q = fromPx(grid, { x: 0, y: 0 }); return q; })();
  void lpx;
  check("the label sits in the lawn, off the bed", lp.lat <= back[0].lat && lp.lat >= back[2].lat && !(lp.lng > bedIn.ring[0].lng && lp.lng < bedIn.ring[1].lng && lp.lat < bedIn.ring[0].lat && lp.lat > bedIn.ring[2].lat));
  // Off the wire: junk out.
  const cleaned = cleanShapes([{ kind: "lawn", ring: back, name: "  Back  " }, { kind: "pool", ring: back }, { kind: "bed", ring: [{ lat: 1, lng: 1 }] }, { kind: "cut", ring: [{ lat: "x" }, ...back] }]);
  check("saved shapes are held to sense", !!cleaned && cleaned.length === 2 && cleaned[0].name === "Back" && cleaned[1].ring.length === 4, JSON.stringify(cleaned?.map((x) => [x.kind, x.name, x.ring.length])));
}

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
