// THE SHEET SIZES, THE DEPARTMENT'S SCALES, ANY JURISDICTION (2026-10-28, owner: "it has to adapt for any state and
// city, and the contractor can scale the plans the way it's required"): lib/deck/plans/paper, lib/deck/seismic,
// countyCodes jurisdictionFor and the site plan's new fields.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-paper.check.ts
import { DEFAULT_SHEET_PREFS, PAPERS, PAPER_ORDER, archLabel, fitOn, normalizeSheetPrefs, pickPaper, siteBoxOn } from "../../../src/lib/deck/plans/paper";
import { ircSdcFromSds, parseUsgsSdc } from "../../../src/lib/deck/seismic";
import { EMPTY_JURISDICTION, TYPED_SOURCE, countyCodeFor, designCriteria, jurisdictionFor, jurisdictionTyped, normalizeJurisdiction } from "../../../src/lib/deck/countyCodes";
import { USGS_SOURCE } from "../../../src/lib/deck/seismic";
import { BASE_SITE_PLAN, normalizeSitePlan, siteScale } from "../../../src/lib/deck/sitePlan";
import { defaultDeckDesign, normalizeDeckDesign, type DeckDesign } from "../../../src/lib/deck/design";
import { buildStructure } from "../../../src/lib/deck/structure";
import { planModel } from "../../../src/lib/deck/plans/model";
import { framingPlan } from "../../../src/lib/deck/plans/framing";
import { permitSheetList } from "../../../src/lib/deck/plans/sheets";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;
const design = (over: Record<string, unknown>): DeckDesign => normalizeDeckDesign({ ...defaultDeckDesign({ state: "CA", frostIn: 12 }), ...over });

console.log("── the sheets");
check("three sizes, 11 × 17 the base: its drawing area is 1 × 1", PAPER_ORDER.join() === "B,C,D" && PAPERS.B.kx === 1 && PAPERS.B.ky === 1 && PAPERS.B.w === 17 && PAPERS.D.w === 36 && PAPERS.D.h === 24);
check("18 × 24 and 24 × 36 keep the title block's width: the drawing area grows 1.51 × 1.67 and 2.39 × 2.24", near(PAPERS.C.kx, 1.513) && near(PAPERS.C.ky, 1.667) && near(PAPERS.D.kx, 2.392) && near(PAPERS.D.ky, 2.238), `${PAPERS.C.kx.toFixed(3)} ${PAPERS.C.ky.toFixed(3)} ${PAPERS.D.kx.toFixed(3)} ${PAPERS.D.ky.toFixed(3)}`);
check("the site plan's box: 7.35 × 7.45 in. on 11 × 17; the street band and the north arrow keep their size on 24 × 36", near(siteBoxOn(PAPERS.B).w, 7.35) && near(siteBoxOn(PAPERS.B).h, 7.45) && near(siteBoxOn(PAPERS.D).w, 8.6 * PAPERS.D.kx - 1.25) && near(siteBoxOn(PAPERS.D).h, 9.2 * PAPERS.D.ky - 1.75));
check("the architect's labels", archLabel(0.25 / 12) === '1/4" = 1\'-0"' && archLabel(0.125 / 12) === '1/8" = 1\'-0"');
check("sheet prefs: the defaults, a bad record, a kept choice", JSON.stringify(normalizeSheetPrefs(null)) === JSON.stringify(DEFAULT_SHEET_PREFS) && normalizeSheetPrefs({ paper: "Z", minPlanInPerFt: 0.3, minSiteFtPerIn: 12 }).paper === "auto" && normalizeSheetPrefs({ paper: "D", minPlanInPerFt: 0.125, minSiteFtPerIn: 8 }).minSiteFtPerIn === 8 && normalizeSheetPrefs({ paper: "D", minPlanInPerFt: 0.125, minSiteFtPerIn: 8 }).paper === "D");
check("the permit sheets take the paper; the crew's stay letter", permitSheetList(buildStructure(design({})), { paper: "D" }).every((x) => x.paper === "D") && permitSheetList(buildStructure(design({}))).every((x) => x.paper === "B"));

// A long deck on a big lot: 11 × 17 cannot keep 1/4 in. framing and a 1/8 in. site plan; 24 × 36 can.
const big = buildStructure(design({ shape: { kind: "rect", widthFt: 40, depthFt: 16 }, placement: "attached" }));
const m = planModel(big);
const fits = (siteW: number, siteH: number) => (p: (typeof PAPERS)["B"]) => ({ planK: m ? fitOn(p, (sc) => framingPlan(m, sc, {}), 8.9, 9.45).scale : 1, siteFtPerIn: siteScale(siteW, siteH, siteBoxOn(p)) });
const autoBig = pickPaper({ paper: "auto", minPlanInPerFt: 0.25, minSiteFtPerIn: 8 }, fits(100, 150));
check("auto: a 40-ft deck on a 100 × 150 lot at 1/4 in. and 1/8 in. needs 24 × 36", autoBig.paper.key === "D" && autoBig.met && autoBig.planInPerFt >= 0.25 && autoBig.siteFtPerIn <= 8, `${autoBig.paper.key} · ${autoBig.words}`);
const small = planModel(buildStructure(design({ shape: { kind: "rect", widthFt: 16, depthFt: 12 }, placement: "attached" })));
const fitsSmall = (p: (typeof PAPERS)["B"]) => ({ planK: small ? fitOn(p, (sc) => framingPlan(small, sc, {}), 8.9, 9.45).scale : 1, siteFtPerIn: siteScale(60, 120, siteBoxOn(p)) });
const autoSmall = pickPaper(DEFAULT_SHEET_PREFS, fitsSmall);
check("auto with the usual minimums (1/4 in. plans, 1 in. = 20 ft site) stays on 11 × 17 for a 16-ft deck on a 60 × 120 lot", autoSmall.paper.key === "B" && autoSmall.met, autoSmall.words);
check("the 40-ft deck alone pushes the usual minimums to 18 × 24", pickPaper(DEFAULT_SHEET_PREFS, fits(60, 120)).paper.key === "C");
const forcedB = pickPaper({ paper: "B", minPlanInPerFt: 0.25, minSiteFtPerIn: 8 }, fits(100, 150));
check("11 × 17 forced on that lot: picked, and said to be under what was asked", forcedB.paper.key === "B" && !forcedB.met && /under the 1\/4" = 1'-0" \/ 1\/8 in\. = 1 ft asked for; pick a larger sheet or "Auto"/.test(forcedB.words), forcedB.words);
const never = pickPaper({ paper: "auto", minPlanInPerFt: 0.25, minSiteFtPerIn: 8 }, fits(400, 600));
check("a lot no sheet can hold at 1/8 in.: 24 × 36, said as under even there", never.paper.key === "D" && !never.met && /even on 24 × 36/.test(never.words), never.words);
check("the framing plan on 24 × 36 is drawn larger than on 11 × 17", fits(60, 120)(PAPERS.D).planK > fits(60, 120)(PAPERS.B).planK);

console.log("── the seismic category");
check("IRC Table R301.2.2.1.1 from S_DS", ircSdcFromSds(0.1) === "A" && ircSdcFromSds(0.33) === "B" && ircSdcFromSds(0.5) === "C" && ircSdcFromSds(0.65) === "D0" && ircSdcFromSds(0.8) === "D1" && ircSdcFromSds(1.0) === "D2" && ircSdcFromSds(1.3) === "E" && ircSdcFromSds(-1) === "");
check("the USGS answer for Sacramento (S_DS 0.65, letter D) reads D0 — the City's own figure", parseUsgsSdc({ response: { data: { sdc: "D", sds: 0.65 } } }) === "D0" && parseUsgsSdc({ response: { data: { sdc: "C" } } }) === "C" && parseUsgsSdc({ response: {} }) === null && parseUsgsSdc(null) === null);

console.log("── any jurisdiction");
const typedRaw = { department: " Yolo County Building Division ", edition: "2022 CRC", windMph: 95, sdc: "d1", frostIn: 12, groundSnowPsf: 0, termite: "Moderate to heavy", weathering: "", notes: ["Two sets of plans.", "", "  Site plan at 1 in. = 20 ft  "] };
const typed = normalizeJurisdiction(typedRaw);
check("typed figures are cleaned: trimmed, the category upper-cased, blank notes dropped", typed.department === "Yolo County Building Division" && typed.sdc === "D1" && typed.notes.length === 2 && typed.windMph === 95 && normalizeJurisdiction({ sdc: "zz", windMph: 9999 }).sdc === "" && normalizeJurisdiction({ sdc: "zz", windMph: 9999 }).windMph === null && !jurisdictionTyped(EMPTY_JURISDICTION) && jurisdictionTyped(typed));
check("nothing on file, nothing typed, no USGS: null — the state's figures", jurisdictionFor(null, EMPTY_JURISDICTION, null, "Yolo County, CA", "CA") === null);
const usgsOnly = jurisdictionFor(null, EMPTY_JURISDICTION, "D1", "Yolo County, CA", "CA");
check("only the USGS category: a record of the county's name with the category from the USGS, said so", !!usgsOnly && usgsOnly.sdc === "D1" && usgsOnly.fieldSources?.sdc === USGS_SOURCE && /not among the counties on file/.test(usgsOnly.jurisdiction) && usgsOnly.windMph === null);
const typedOnly = jurisdictionFor(null, typed, "D0", "Yolo County, CA", "CA");
check("typed over nothing: the department, its edition, its figures — each marked typed; the typed category beats the USGS", !!typedOnly && typedOnly.jurisdiction === "Yolo County Building Division" && typedOnly.edition === "2022 CRC" && typedOnly.sdc === "D1" && typedOnly.fieldSources?.sdc === TYPED_SOURCE && typedOnly.fieldSources?.windMph === TYPED_SOURCE && typedOnly.weathering === null && typedOnly.deckNotes.length === 2);
const sac = countyCodeFor("CA", "Sacramento County", "Sacramento");
const over = jurisdictionFor(sac, normalizeJurisdiction({ windMph: 100 }), "D1", null, "CA");
check("typed over the City of Sacramento: the wind is the typed 100, the rest the City's (D0 stays — the file beats the USGS)", !!over && over.windMph === 100 && over.windBasis === "the department's Table R301.2, as typed" && over.fieldSources?.windMph === TYPED_SOURCE && over.sdc === "D0" && over.fieldSources?.sdc === undefined && over.frostIn === 12 && /City of Sacramento/.test(over.jurisdiction) && over.sources.length === sac!.sources.length);

const s16 = buildStructure(design({ shape: { kind: "rect", widthFt: 16, depthFt: 12 }, placement: "attached", frostIn: 24 }));
const crit = designCriteria(s16, typedOnly, "Yolo County, CA");
const row = (label: string) => crit.rows.find((r) => r.label === label);
check("the criteria table says where each figure came from: typed, the USGS, the department", row("Wind")?.source === TYPED_SOURCE && row("Seismic category")?.source === TYPED_SOURCE && row("Code")?.value === "2022 CRC" && row("Code")?.source === TYPED_SOURCE && /typed by the contractor/.test(row("Frost depth")?.source ?? ""), JSON.stringify(crit.rows.map((r) => [r.label, r.source.slice(0, 30)])));
check("footings dug 24 in. where 12 is asked: a hint, not a warning", crit.warnings.length === 0 && crit.hints.length === 1 && /asks footings 12 in\. deep and the drawings show 24 in\./.test(crit.hints[0]), crit.hints[0]);
check("the typed rules go to the notes", crit.countyNotes[0] === "Two sets of plans.");
const critUsgs = designCriteria(s16, usgsOnly, "Yolo County, CA");
check("…and the USGS category with its source", row === row && critUsgs.rows.find((r) => r.label === "Seismic category")?.value === "D1" && critUsgs.rows.find((r) => r.label === "Seismic category")?.source === USGS_SOURCE);

console.log("── the site plan keeps it");
const kept = normalizeSitePlan({ ...BASE_SITE_PLAN, county: { name: "Yolo County", state: "ca", source: "census", city: "Davis", sdc: "d1" }, jurisdiction: typedRaw, sheets: { paper: "C", minPlanInPerFt: 0.25, minSiteFtPerIn: 10 } });
check("the county's city and USGS category, the typed jurisdiction and the sheet prefs survive a round trip", kept.county?.city === "Davis" && kept.county?.sdc === "D1" && kept.county?.state === "CA" && kept.jurisdiction.department === "Yolo County Building Division" && kept.sheets.paper === "C" && kept.sheets.minSiteFtPerIn === 10, JSON.stringify({ c: kept.county, j: kept.jurisdiction.department, s: kept.sheets }));
check("an old record without them reads the empty jurisdiction and the default sheets", JSON.stringify(normalizeSitePlan({ ...BASE_SITE_PLAN, jurisdiction: undefined, sheets: undefined }).sheets) === JSON.stringify(DEFAULT_SHEET_PREFS) && !jurisdictionTyped(normalizeSitePlan({}).jurisdiction));

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
