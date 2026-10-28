// THE DECK PERMIT SET IN SACRAMENTO (2026-10-28, owner: "does it adapt per state, per city — the right code and the
// right submittal sizes?"): the County's figures, the City's own over them, the site-plan scale the City asks for,
// and the cover sheet's rows a California reviewer looks for.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-sacramento.check.ts
import { defaultDeckDesign, normalizeDeckDesign, type DeckDesign } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { cityKey, countyCodeFor, designCriteria, siteScaleWarning, siteScaleWords } from "../../../src/lib/deck/countyCodes";
import { permitNotes } from "../../../src/lib/deck/permit";
import { deckCodeFor } from "../../../src/lib/deck/stateCodes";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const design = (over: Record<string, unknown>): DeckDesign => normalizeDeckDesign({ ...defaultDeckDesign({ state: "CA", frostIn: 12 }), ...over });

// ── the state ──
const ca = deckCodeFor("CA");
check("California: the 2025 CRC on the 2024 IRC, in force 2026, guards 42 in.", ca.short === "CRC 2025" && ca.basis === 2024 && ca.since === 2026 && ca.guardIn === 42 && ca.statewide, `${ca.short} ${ca.since} ${ca.guardIn}`);

// ── the county, and the city over it ──
const county = countyCodeFor("CA", "Sacramento County");
check("Sacramento County is on file: 95 mph, SDC D, no snow, no frost (12-in. minimum), termite very heavy", !!county && county.windMph === 95 && county.sdc === "D" && county.groundSnowPsf === 0 && county.frostIn === 12 && county.termite === "Very Heavy" && !county.city, JSON.stringify({ w: county?.windMph, s: county?.sdc }));
check("…the County's own submittal rules: 11 x 17 to 24 x 36, one scale, the portal, the APN on the cover", !!county && county.deckNotes.some((n) => /11 x 17 in\. up to 24 x 36 in\./.test(n)) && county.deckNotes.some((n) => /Assessor's Parcel Number/.test(n)) && county.sources.length >= 3);
check("the county key reads the geocoder's spellings", countyCodeFor("CA", "Sacramento")?.county === "Sacramento County" && countyCodeFor("CA", "SACRAMENTO COUNTY")?.county === "Sacramento County");

const city = countyCodeFor("CA", "Sacramento County", "SACRAMENTO");
check("the City of Sacramento over the County: 110 mph, SDC D0, its own department, its own edition and notes", !!city && city.city === "Sacramento" && city.windMph === 110 && city.sdc === "D0" && /City of Sacramento Community Development/.test(city.jurisdiction) && /City Code Title 15/.test(city.edition ?? "") && city.deckNotes.some((n) => /Electronic Plan Check only/.test(n)), JSON.stringify({ w: city?.windMph, s: city?.sdc, j: city?.jurisdiction.slice(0, 40) }));
check("…what the City leaves out comes from the County, and both sets of sources are kept", !!city && city.frostIn === 12 && city.groundSnowPsf === 0 && city.termite === "Very Heavy" && city.sources.length === 4 + 3 && city.fips === "06067" && !("cities" in city));
check("…city spellings: 'City of Sacramento', 'Sacramento city'", countyCodeFor("CA", "Sacramento County", "City of Sacramento")?.city === "Sacramento" && countyCodeFor("CA", "Sacramento County", "Sacramento city")?.city === "Sacramento" && cityKey("Town of Elk Grove") === "elkgrove");
check("a city without its own entry (Elk Grove) reads the County's figures", countyCodeFor("CA", "Sacramento County", "Elk Grove")?.windMph === 95 && !countyCodeFor("CA", "Sacramento County", "Elk Grove")?.city);
check("a county not on file is still null", countyCodeFor("CA", "Yolo County") === null && countyCodeFor("CA", "Yolo County", "Davis") === null);

// ── the site plan's scale the City asks for ──
check("scale words", siteScaleWords(8) === "1/8 in. = 1 ft" && siteScaleWords(10) === "1 in. = 10 ft" && siteScaleWords(20) === "1 in. = 20 ft");
check("1/8 in. = 1 ft or larger passes in the City; 1 in. = 20 ft is said before the submittal", siteScaleWarning(city, 8) === null && siteScaleWarning(city, 5) === null && /City of Sacramento Community Development Department, Building Division asks the site plan at 1\/8 in\. = 1 ft or larger; this lot fits the 11 × 17 sheet only at 1 in\. = 20 ft\./.test(siteScaleWarning(city, 20) ?? ""), siteScaleWarning(city, 20) ?? "null");
check("the County names no minimum: no warning", siteScaleWarning(county, 20) === null && siteScaleWarning(null, 20) === null);

// ── the criteria table and the notes on a Sacramento deck ──
const s = buildStructure(design({ shape: { kind: "rect", widthFt: 16, depthFt: 12 }, placement: "attached", frostIn: 12 }));
const crit = designCriteria(s, city, "Sacramento · Sacramento County, CA");
const row = (label: string) => crit.rows.find((r) => r.label === label);
check("the code row names the City's edition and department", /2025 California Residential Code/.test(row("Code")?.value ?? "") && /City of Sacramento Community Development/.test(row("Code")?.source ?? ""), row("Code")?.source);
check("wind 110 mph with its basis; seismic D0; termite very heavy; weathering negligible", /^110 mph \(Table R301\.2 of the City's/.test(row("Wind")?.value ?? "") && row("Seismic category")?.value === "D0" && row("Termite")?.value === "Very Heavy" && row("Weathering")?.value === "Negligible", `${row("Wind")?.value.slice(0, 30)} · ${row("Seismic category")?.value}`);
check("frost: the deck's 12 in. meets the City's 12 — no warning; snow 0 — no warning", /^12 in\./.test(row("Frost depth")?.value ?? "") && /: 12 in\./.test(row("Frost depth")?.source ?? "") && row("Ground snow")?.value === "0 psf" && crit.warnings.length === 0, JSON.stringify(crit.warnings));
check("guards 42 in. by CRC 2025", row("Guard / stairs")?.value === "guard 42 in. · risers ≤ 7.75 in. · treads ≥ 10 in." && row("Guard / stairs")?.source === "CRC 2025");
const notes = permitNotes(s, crit.countyNotes, city?.edition ?? null);
check("the general notes open on the City's edition and end on the City's own rules", /^All work to the 2025 California Residential Code \(Title 24, Part 2\.5\), effective January 1, 2026, as adopted by the City of Sacramento/.test(notes[0]) && notes.filter((n) => n.startsWith("Local: ")).length === 6 && notes.some((n) => /Local: A permit is required for any deck attached to the house/.test(n)), notes[0].slice(0, 90));

// A deck dug to 24 in. in Sacramento: deeper than asked is never a warning.
const deep = buildStructure(design({ shape: { kind: "rect", widthFt: 16, depthFt: 12 }, placement: "attached", frostIn: 24 }));
check("footings deeper than the City's figure are not a warning", designCriteria(deep, city, null).warnings.length === 0);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
