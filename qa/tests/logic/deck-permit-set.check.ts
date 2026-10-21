// The deck permit SUBMITTAL SET (2026-10-20): two 11 × 17 sheets for a deck,
// three with a roof; the site plan's geometry (the deck turned onto the back
// wall, the distances to the lot lines, a parcel turned to its street edge,
// the setback checks); the lateral load connection's devices; the county's
// own figures and the design criteria with what the county asks for more.
// Figures here are worked by hand, not copied from the engine.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-permit-set.check.ts
import { defaultDeckDesign, normalizeDeckDesign, type DeckDesign } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { lateralDevices, lateralDetail, permitNotes, permitSheets, roofDetails, detailDrawings } from "../../../src/lib/deck/permit";
import { BASE_SITE_PLAN, defaultSitePlan, lotFromRing, normalizeSitePlan, polygonArea, siteLayout, siteScale, streetFrom, turnLot, type SitePlan } from "../../../src/lib/deck/sitePlan";
import { countyKey, designCriteria, type DeckCountyCode } from "../../../src/lib/deck/countyCodes";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const near = (a: number, b: number, tol = 0.15) => Math.abs(a - b) <= tol;
const design = (over: Record<string, unknown>): DeckDesign => normalizeDeckDesign({ ...defaultDeckDesign({ state: "TX", frostIn: 12 }), ...over });

console.log("── the sheets");
{
  const deck = buildStructure(design({ shape: { kind: "rect", widthFt: 16, depthFt: 12 }, placement: "attached" }));
  const sheets = permitSheets(deck);
  check("a deck is two sheets: A1 site, S1 floor", sheets.map((x) => x.no).join() === "A1,S1" && sheets[1].kind === "floor", sheets.map((x) => x.no).join());
  const covered = buildStructure(design({ structure: "covered-deck", shape: { kind: "rect", widthFt: 14, depthFt: 12 } }));
  const cs = permitSheets(covered);
  check("a covered deck is three: A1, S1, S2 the roof", cs.map((x) => x.no).join() === "A1,S1,S2" && cs[2].kind === "roof", cs.map((x) => `${x.no}:${x.kind}`).join());
  check("the floor sheet's details hold no roof detail, the roof sheet's no floor detail", detailDrawings(covered, "floor").every((d) => !/rafter|truss/i.test(d.title)) && roofDetails(covered, null).every((d) => !/ledger|guard post|footing/i.test(d.title)));
  check("the roof sheet carries the uplift path", roofDetails(covered, 115).some((d) => d.title === "Uplift path" && d.notes.some((n) => /115 mph/.test(n))));
  check("at 140 mph the roof's wind design is said to leave the IRC's own provisions", roofDetails(covered, 140).some((d) => d.notes.some((n) => /R301\.2\.1\.1/.test(n))));
}

console.log("── the lateral load connection");
{
  const s = buildStructure(design({ shape: { kind: "rect", widthFt: 20, depthFt: 12 }, placement: "attached", ledger: { fastener: "lag", lateral: "two" } }));
  const f = s.frame!;
  const dv = lateralDevices(f);
  const x0 = Math.min(...f.ledgers.map((l) => l.x0));
  const x1 = Math.max(...f.ledgers.map((l) => l.x1));
  check("two 1,500-lb devices, one within 24 in. of each end of the ledger", dv.length === 2 && dv.every((d) => d.lb === 1500) && dv[0].x - x0 <= 24 && x1 - dv[1].x <= 24, dv.map((d) => d.x).join());
  check("each sits on a real joist, the first one in from the end (not the outside joist)", dv.every((d) => f.joists.some((j) => Math.abs(j.x - d.x) < 0.2)) && dv[0].x - x0 >= 6 && x1 - dv[1].x >= 6, dv.map((d) => d.x).join());
  const four = lateralDevices(buildStructure(design({ shape: { kind: "rect", widthFt: 20, depthFt: 12 }, placement: "attached", ledger: { fastener: "lag", lateral: "four" } })).frame!);
  check("four 750-lb devices, two at each end", four.length === 4 && four.every((d) => d.lb === 750) && four.filter((d) => d.x - x0 <= 24).length === 2 && four.filter((d) => x1 - d.x <= 24).length === 2, four.map((d) => d.x).join());
  check("the detail names the rule, the capacity and where", /R507\.9\.2/.test(lateralDetail(f)!.notes[0]) && /1,500-lb/.test(lateralDetail(f)!.notes[0]));
  const free = buildStructure(design({ shape: { kind: "rect", widthFt: 12, depthFt: 10 }, placement: "detached", heightIn: 48 }));
  check("a free-standing deck has no ledger devices; its bracing is its lateral system", lateralDevices(free.frame!).length === 0 && detailDrawings(free, "floor").some((d) => /bracing/i.test(d.title) && d.notes.some((n) => /lateral system/.test(n))));
  const notes = permitNotes(s, ["Decks over 30 in. need a permit."]);
  check("the general notes carry the lateral connection, the 811 call and the county's own rule", notes.some((n) => /Lateral load connection: 2 hold-down/.test(n)) && notes.some((n) => /811/.test(n)) && notes.some((n) => n === "Local: Decks over 30 in. need a permit."));
}

console.log("── the site plan");
{
  const s = buildStructure(design({ shape: { kind: "rect", widthFt: 16, depthFt: 12 }, placement: "attached", house: { storeys: 1, roof: "hip", leftFt: 6, rightFt: 10, jogs: [], siding: "cream", roofColour: "charcoal" } }));
  check("the street from the address", streetFrom("1840 Meadow Glen Dr, Allen, TX 75002") === "Meadow Glen Dr" && streetFrom("12B Elm St, X") === "Elm St");
  const plan: SitePlan = { ...defaultSitePlan(s, "1840 Meadow Glen Dr, Allen, TX"), lot: { kind: "typed", widthFt: 70, depthFt: 120 }, house: { widthFt: "auto", depthFt: 30, frontFt: 25, leftFt: 19, footprint: null } };
  const L = siteLayout(plan, s);
  // The wall is 6 + 16 + 10 = 32 ft from x = 19 to 51; the deck's left end (yard view) sits 6 ft in from the RIGHT corner (street view).
  check("the house is the studio's wall: 32 ft, 19 ft from the left line", near(L.houseBox.x0, 19) && near(L.houseBox.x1, 51) && L.houseWallFt === 32);
  check("the deck is turned onto the back wall: x from 29 to 45, y from 55 to 67", near(L.deckBox.x0, 29) && near(L.deckBox.x1, 45) && near(L.deckBox.y0, 55) && near(L.deckBox.y1, 67), JSON.stringify(L.deckBox));
  const rear = L.distances.find((d) => d.side === "rear")!;
  const left = L.distances.find((d) => d.side === "left")!;
  const right = L.distances.find((d) => d.side === "right")!;
  check("53 ft to the rear line, 29 to the left, 25 to the right", near(rear.ft, 53) && near(left.ft, 29) && near(right.ft, 25), `${rear.ft} ${left.ft} ${right.ft}`);
  check("the house is 25 ft from the front line", near(L.houseFrontFt, 25));
  const tight = siteLayout({ ...plan, setbackRearFt: 60, setbackSideFt: 10 }, s);
  check("a 60-ft rear setback is not met; the 10-ft sides are", tight.checks.some((c) => c.id === "site-rear" && c.level === "warn") && tight.checks.filter((c) => c.id.startsWith("site-") && c.id !== "site-rear").every((c) => c.level === "ok"));
  const over = siteLayout({ ...plan, lot: { kind: "typed", widthFt: 70, depthFt: 60 } }, s);
  check("a deck past the back line is caught", over.checks.some((c) => c.id === "site-outside"));
  check("the scale is the largest that fits: 1\" = 20' for a 70 × 120 ft lot in 7.7 × 5.5 in.", siteScale(70 * 1.18, 134 * 1.3, { w: 7.7, h: 5.5 }) === 40 && siteScale(80, 100, { w: 7.7, h: 5.5 }) === 20, `${siteScale(80, 100, { w: 7.7, h: 5.5 })}`);
  check("a stored plan reads back; junk falls to the default", normalizeSitePlan(JSON.parse(JSON.stringify(plan)), plan).lot.kind === "typed" && normalizeSitePlan({ v: 9 }, plan) === plan && normalizeSitePlan(null).lot.kind === "typed" && BASE_SITE_PLAN.v === 1);
  check("numbers are held to their limits", normalizeSitePlan({ ...plan, lot: { kind: "typed", widthFt: -5, depthFt: 99999 } }, plan).lot.kind === "typed" && (normalizeSitePlan({ ...plan, lot: { kind: "typed", widthFt: -5, depthFt: 99999 } }, plan).lot as { widthFt: number }).widthFt === 20);
  // The deck on the other walls (2026-10-21): turned onto each, never mirrored — the yard's left end stays on the left.
  const F = siteLayout({ ...plan, deckSide: "front" }, s);
  check("in front: x 25–41 (6 ft in from the house's left corner), y 13–25, 13 ft to the front line", near(F.deckBox.x0, 25) && near(F.deckBox.x1, 41) && near(F.deckBox.y0, 13) && near(F.deckBox.y1, 25) && near(F.distances.find((d) => d.side === "front")!.ft, 13) && !F.distances.some((d) => d.side === "rear"), JSON.stringify(F.deckBox));
  const Lf = siteLayout({ ...plan, deckSide: "left" }, s);
  check("on the left wall: x 7–19, y 33–49 (the yard's left end toward the back), 7 ft to the left line", near(Lf.deckBox.x0, 7) && near(Lf.deckBox.x1, 19) && near(Lf.deckBox.y0, 33) && near(Lf.deckBox.y1, 49) && near(Lf.distances.find((d) => d.side === "left")!.ft, 7) && !Lf.distances.some((d) => d.side === "right"), JSON.stringify(Lf.deckBox));
  const R = siteLayout({ ...plan, deckSide: "right" }, s);
  check("on the right wall: x 51–63, y 31–47, 7 ft to the right line", near(R.deckBox.x0, 51) && near(R.deckBox.x1, 63) && near(R.deckBox.y0, 31) && near(R.deckBox.y1, 47) && near(R.distances.find((d) => d.side === "right")!.ft, 7), JSON.stringify(R.deckBox));
  check("the side reads back; junk is the back", normalizeSitePlan({ ...plan, deckSide: "left" }, plan).deckSide === "left" && normalizeSitePlan({ ...plan, deckSide: "roof" }, plan).deckSide === "rear");
  const covered = buildStructure(design({ structure: "covered-deck", shape: { kind: "rect", widthFt: 14, depthFt: 12 } }));
  const CL = siteLayout(defaultSitePlan(covered, null), covered);
  check("a covered deck draws its roof's eaves on the site, and the eaves count in the distances", !!CL.roof && CL.roof.length >= 4);
}

console.log("── a parcel, turned to its street");
{
  // A 60 × 100 ft lot, its street on the EAST side: corners in feet (east, north) → lat/lng about 30° N.
  const lat0 = 30, lng0 = -97;
  const FT_LAT = 364000, FT_LNG = FT_LAT * Math.cos((lat0 * Math.PI) / 180);
  const ll = (e: number, n: number) => ({ lat: lat0 + n / FT_LAT, lng: lng0 + e / FT_LNG });
  const ring = [ll(0, 0), ll(100, 0), ll(100, 60), ll(0, 60)];
  const street = ll(130, 30); // on the street, east of the lot
  const t = lotFromRing(ring, street, ll(80, 30))!;
  const b = { w: Math.max(...t.ring.map((p) => p[0])) - Math.min(...t.ring.map((p) => p[0])), h: Math.max(...t.ring.map((p) => p[1])) - Math.min(...t.ring.map((p) => p[1])) };
  check("the street edge (60 ft, on the east) lies along the bottom; the lot runs 100 ft back", near(b.w, 60, 0.5) && near(b.h, 100, 0.5), JSON.stringify(b));
  check("its area is kept", near(Math.abs(polygonArea(t.ring)), 6000, 20));
  // Standing on the street east of the lot, facing it (west), north is on the right hand: 90° from up.
  check("north points right on the sheet (the street is on the east)", t.northDeg === 90, `${t.northDeg}`);
  const house = t.toSite(ll(80, 30));
  check("the house's point lands 20 ft in from the street, mid-lot", near(house[1], 20, 0.5) && near(house[0], 30, 0.5), JSON.stringify(house));
  const plan: SitePlan = { ...BASE_SITE_PLAN, lot: { kind: "parcel", ring: t.ring, source: "cache", apn: "R123", areaSqFt: 6000 }, northDeg: t.northDeg };
  const turned = turnLot(plan);
  // The next edge is the lot's north side: on that street, facing the lot (south), north points down.
  check("turning the lot makes the next edge the street and turns north with it", turned.lot.kind === "parcel" && near(Math.abs(polygonArea(turned.lot.ring)), 6000, 20) && turned.northDeg === 180, `${turned.northDeg}`);
}

console.log("── the county");
{
  check("county names key alike", countyKey("Harris County") === countyKey("harris") && countyKey("Orleans Parish") === "orleans" && countyKey("Saint Louis County") === countyKey("St. Louis"));
  const s = buildStructure(design({ shape: { kind: "rect", widthFt: 16, depthFt: 12 }, placement: "attached", frostIn: 12 }));
  const county: DeckCountyCode = { state: "TX", county: "Test County", fips: null, jurisdiction: "Test County Building", edition: "2021 IRC", frostIn: 24, groundSnowPsf: 5, windMph: 115, windBasis: "Vult", sdc: "A", weathering: "negligible", termite: "very heavy", deckNotes: ["A deck over 30 in. needs a permit."], note: null, sources: [], confidence: "high" };
  const c = designCriteria(s, county, "Test County, TX");
  check("the county's deeper frost line is flagged against the drawn footings", c.warnings.some((w) => /24 in\./.test(w)) && c.rows.find((r) => r.label === "Frost depth")?.short === true);
  check("wind and seismic come from the county", /115 mph/.test(c.rows.find((r) => r.label === "Wind")!.value) && c.rows.find((r) => r.label === "Seismic category")!.value === "A");
  check("its deck rule reaches the notes", c.countyNotes[0] === "A deck over 30 in. needs a permit.");
  const none = designCriteria(s, null, null);
  check("with no county the table says where to look", /jurisdiction's map/.test(none.rows.find((r) => r.label === "Wind")!.value) && none.warnings.length === 0);
}

console.log(bad ? `\n${bad} FAILED` : "\nall green");
process.exit(bad ? 1 : 0);
