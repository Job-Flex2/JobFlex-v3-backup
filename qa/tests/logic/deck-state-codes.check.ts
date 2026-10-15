// The framing code by state (2026-10-11, lib/deck/stateCodes): every state and DC
// present and sane, the figures the trade knows (California's 42-in. guards; the
// 8¼-in. risers of New Jersey, New York, Pennsylvania, Massachusetts, Virginia,
// North Carolina and Ohio; Wisconsin's and Utah's 8 on 9), the states that leave
// the code to their cities, and the engine reading them: the guard check, the
// stair rules, the site strip, the proposal's notes, a design that reads back.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-state-codes.check.ts
import { CODES_AS_OF, DECK_STATE_CODES, IRC_CODE, codeWords, deckCodeFor, inFrac, stateName } from "../../../src/lib/deck/stateCodes";
import { defaultDeckDesign, defaultStair, normalizeDeckDesign } from "../../../src/lib/deck/design";
import { BETWEEN_LEVELS_STAIR_ID, buildStructure } from "../../../src/lib/deck/structure";
import { deckChecks, applyDeckPatch } from "../../../src/lib/deck/checks";
import { priceDeck, deckNotes } from "../../../src/lib/deck/pricing";
import { siteFromAddress } from "../../../src/lib/deck/site";
import { stairRules } from "../../../src/lib/deck/stairs";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"];

console.log("── the table");
check("every state and the District are in the table, and nothing else", STATES.every((s) => !!DECK_STATE_CODES[s]) && Object.keys(DECK_STATE_CODES).length === STATES.length, `${Object.keys(DECK_STATE_CODES).length}`);
check("every entry is sane", STATES.every((s) => { const c = DECK_STATE_CODES[s]; return c.state === s && c.name.length > 10 && c.short.length >= 3 && [36, 42].includes(c.guardIn) && [7.75, 8, 8.25].includes(c.riserMaxIn) && [9, 10].includes(c.treadMinIn) && c.lateral && Array.isArray(c.notes) && (c.basis === null || [2015, 2018, 2021, 2024].includes(c.basis)); }));
check("a state with 8-in. or 8¼-in. risers always allows 9-in. treads, never the other way round", STATES.every((s) => { const c = DECK_STATE_CODES[s]; return (c.riserMaxIn === 7.75) === (c.treadMinIn === 10); }));
check("California asks 42-in. guards; every other state 36", DECK_STATE_CODES.CA.guardIn === 42 && STATES.filter((s) => s !== "CA").every((s) => DECK_STATE_CODES[s].guardIn === 36));
const eightQuarter = ["NJ", "NY", "PA", "MA", "VA", "NC", "OH"];
check("the 8¼-in. riser states", eightQuarter.every((s) => DECK_STATE_CODES[s].riserMaxIn === 8.25 && DECK_STATE_CODES[s].treadMinIn === 9) && STATES.filter((s) => !eightQuarter.includes(s)).every((s) => DECK_STATE_CODES[s].riserMaxIn !== 8.25));
check("Wisconsin's UDC and Utah: 8-in. risers on 9-in. treads", DECK_STATE_CODES.WI.riserMaxIn === 8 && DECK_STATE_CODES.WI.treadMinIn === 9 && DECK_STATE_CODES.WI.basis === null && DECK_STATE_CODES.UT.riserMaxIn === 8);
const local = STATES.filter((s) => !DECK_STATE_CODES[s].statewide);
check("the states that leave the code to their cities are flagged, each saying so", ["AK", "AZ", "CO", "DE", "IL", "KS", "MS", "MO", "NV", "SD", "TX", "VT", "WY"].every((s) => local.includes(s)) && local.every((s) => DECK_STATE_CODES[s].verify && DECK_STATE_CODES[s].notes[0].includes("no statewide")), local.join(","));
check("every state names itself", STATES.every((s) => !!stateName(s)) && stateName("ca") === "California" && stateName("XX") === null);
check("an unknown or empty state falls back to the IRC", deckCodeFor("XX") === IRC_CODE && deckCodeFor("") === IRC_CODE && deckCodeFor(null) === IRC_CODE && deckCodeFor("va").state === "VA");
check("fractions print as a carpenter says them", inFrac(7.75) === "7¾ in." && inFrac(8.25) === "8¼ in." && inFrac(8) === "8 in.");
check("the sentence names the code, the three figures and the year", /Builds to the 2021 Virginia Residential Code.*guards 36 in\., risers no more than 8¼ in\., treads at least 9 in\./.test(codeWords(DECK_STATE_CODES.VA)) && codeWords(DECK_STATE_CODES.TX).includes("no statewide code") && codeWords(IRC_CODE).includes("set the job address") && codeWords(DECK_STATE_CODES.VA).includes(String(CODES_AS_OF)));

console.log("── the engine reads the state");
const base = (state: string | null, over: Partial<ReturnType<typeof defaultDeckDesign>> = {}) => normalizeDeckDesign({ ...defaultDeckDesign({ state }), shape: { kind: "rect", widthFt: 16, depthFt: 12 }, heightIn: 40, stairs: [defaultStair("s1", "front", 8)], ...over });
const ca = base("CA");
check("a new California design starts with the 42-in. guard and its state on the site", ca.rail.heightIn === 42 && ca.site.state === "CA" && base("TX").rail.heightIn === 36 && base(null).site.state === null);
const sCA = buildStructure(ca);
check("the structure carries the state's code", sCA.code.state === "CA" && sCA.code.guardIn === 42 && buildStructure(base("nj")).code.state === "NJ" && buildStructure(base(null)).code === IRC_CODE);
const caLow = normalizeDeckDesign({ ...ca, rail: { ...ca.rail, type: "treated", heightIn: 36 } });
const caChecks = deckChecks(buildStructure(caLow));
const gh = caChecks.find((c) => c.id === "guard-height");
check("a 36-in. rail on a California deck fails the guard check, naming the state, with a fix to 42", !!gh && gh.level === "fail" && /42 in\. high in California/.test(gh.text) && gh.fix?.patch.rail?.heightIn === 42, gh?.text);
check("the fix makes it pass", !deckChecks(buildStructure(applyDeckPatch(caLow, gh!.fix!.patch))).some((c) => c.id === "guard-height"));
const waLow = normalizeDeckDesign({ ...base("WA"), rail: { ...ca.rail, type: "treated", heightIn: 36 } });
check("the same rail in Washington passes", !deckChecks(buildStructure(waLow)).some((c) => c.id === "guard-height"));
const nj = buildStructure(base("NJ"));
const njRiser = deckChecks(nj).find((c) => c.id === "stair-s1-riser");
check("the New Jersey stair check speaks in 8¼-in. risers and 9-in. treads, citing the New Jersey edition", !!njRiser && /8¼ in\. at most/.test(njRiser.text) && /9 in\. at least/.test(njRiser.text) && !!njRiser.rule && /IRC-NJ 2021 R311\.7\.5\.1/.test(njRiser.rule), `${njRiser?.text} (${njRiser?.rule})`);
const caRiser = deckChecks(sCA).find((c) => c.id === "stair-s1-riser");
check("the California one in 7¾ and 10, citing the CRC", !!caRiser && /7¾ in\. at most/.test(caRiser.text) && /10 in\. at least/.test(caRiser.text) && /CRC 2022/.test(caRiser.rule ?? ""), caRiser?.rule);
check("the riser count itself does not change by state (aimed at 7½ in. everywhere)", nj.stairs[0].risers === sCA.stairs[0].risers);
const njStep = buildStructure(base("NJ", { lower: { on: true, widthFt: 10, depthFt: 6, dropIn: 8, align: "centre" }, stairs: [] }));
const caStep = buildStructure(base("CA", { lower: { on: true, widthFt: 10, depthFt: 6, dropIn: 8, align: "centre" }, stairs: [] }));
check("an 8-in. step down to the lower level is one riser in New Jersey but takes a stair in California — the engine builds it there", !!njStep.stepDown && !njStep.stepDown.stairWanted && !njStep.stairs.some((b) => b.design.id === BETWEEN_LEVELS_STAIR_ID) && caStep.stairs.some((b) => b.design.id === BETWEEN_LEVELS_STAIR_ID && b.lands === "lower-deck"));
const codeCheck = deckChecks(sCA).find((c) => c.id === "code");
check("the code check tells the edition, as information for a statewide code", !!codeCheck && codeCheck.level === "info" && /California Residential Code/.test(codeCheck.text) && /42 in\./.test(codeCheck.text), codeCheck?.text);
const txCode = deckChecks(buildStructure(base("TX"))).find((c) => c.id === "code");
check("and warns where the city names the edition (Texas)", !!txCode && txCode.level === "warn" && /no statewide code/.test(txCode.text));
check("the state's notes ride along as information", deckChecks(sCA).some((c) => c.id === "code-0" && /42 in\. high at least/.test(c.text)) && deckChecks(buildStructure(base("FL"))).some((c) => c.part === "Code" && /hurricane ties/.test(c.text)));
check("the stair rules function speaks the state's figures", /8 in\./.test(stairRules(DECK_STATE_CODES.WI).riser) && /UDC R311/.test(stairRules(DECK_STATE_CODES.WI).riser) && /7¾/.test(stairRules().riser));
const pkg = priceDeck(ca);
check("the proposal's first note names the code", /Builds to the 2022 California Residential Code/.test(deckNotes(pkg)[0]) && deckNotes(pkg).length <= 20);
const facts = siteFromAddress("1600 Pennsylvania Ave, Washington, DC 20500", null);
check("the site facts carry the code and its line", facts.code.state === "DC" && /District of Columbia Residential Code/.test(facts.codeLine));
check("no address: the shop's own state", siteFromAddress("", "MN").code.state === "MN" && siteFromAddress(null, null).code === IRC_CODE);
const again = normalizeDeckDesign(JSON.parse(JSON.stringify(ca)));
check("a design with its state reads back the same, and an old one without a state takes the shop's", JSON.stringify(again) === JSON.stringify(ca) && normalizeDeckDesign({ ...ca, site: { ...ca.site, state: undefined } }, { state: "or" }).site.state === "OR" && normalizeDeckDesign({ ...ca, site: { ...ca.site, state: "junk" } }).site.state === null);

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
