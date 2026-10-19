// Lawn & landscape estimator (2026-10-18): the yard read from a synthetic aerial photo (no real address in a public
// repo) — lawn, a tree, a bed, the driveway, the house — the outlines and edges traced from it, the lawn split front /
// back / side from the street, the labels' storage, the pricing against the market, the season by state, the tax.
//   npx tsx qa/tests/logic/lawn-estimator.check.ts
import { classify, CLS } from "../../../src/lib/lawn/classify";
import { traceLoops, signedArea, outlinesOf, edgeNeighbours } from "../../../src/lib/lawn/vectorize";
import { measureYard, slopeBands, confidenceOf, findHouse } from "../../../src/lib/lawn/measure";
import { encodeLabels, decodeLabels } from "../../../src/lib/lawn/site";
import { fillRings, ftPerPx, type Grid } from "../../../src/lib/lawn/geo";
import { priceYard, pickMower, difficultyOf, cleanLawnSettings, cleanOptions, DEFAULT_LAWN_SETTINGS, DEFAULT_OPTIONS } from "../../../src/lib/lawn/pricing";
import { climateFor, mowVisits, monthsOf, weeklyMonths, STATE_CLIMATE } from "../../../src/lib/lawn/season";
import { lawnTaxed, taxWords } from "../../../src/lib/lawn/tax";
import { rulesAt, inWindow, FERTILIZER, FLORIDA_SUMMER } from "../../../src/lib/lawn/rules";
import { seasonCalendar, planTotals, lawnSlots, toSchedule, mowHeightIn } from "../../../src/lib/lawn/calendar";

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
const c1 = confidenceOf({ photo: { date: "2019-01-10", gsdM: 0.6 }, parcel: false, footprints: false, canopyMap: false, lawnSqft: 3000, treeSqft: 6000, lotSqft: 10000, now: new Date("2026-10-18") });
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

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
