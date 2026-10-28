// OPENING PRICED (lib/webHandoff, 2026-10-28): a website or house lead's record (webLead:<leadId>) turned into what
// each estimator applies at open — the fence as drawn, the house with its tier, the smart lines. Pure parts only; the
// estimators themselves are walked on the stand.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/web-handoff.check.ts
import { fenceSeedFromWebLead, hvacSeedFromWebLead, smartSeedFromWebLead } from "../../../src/lib/webHandoff";
import type { WebLeadRecord } from "../../../src/lib/webEstimator";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const base: WebLeadRecord = {
  leadId: "lead_1", trade: "fence", at: "2026-10-28T12:00:00Z", contact: { name: "Sarah Stand", phone: "(716) 555-0100", email: "s@example.com", note: null },
  estimate: {
    token: "tok", organizationId: "org_buyer", trade: "fence", at: "2026-10-28T11:00:00Z", address: "418 Linden Ave", city: "Buffalo", state: "NY", zip: "14216",
    summary: "180 ft of fence in 3 runs, 1 walk gate.", choice: "Cedar privacy, 6 ft", cents: 821000, band: { low: 7200, high: 9400 }, show: "range",
    facts: { runsFt: [60, 60, 60], type: "cedar-privacy", heightFt: 6, gates: 1, doubles: 0, drawn: true, points: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }, { x: 0, y: 60 }], pin: { lat: 42.948, lng: -78.853 } },
  },
};
const withFacts = (facts: Record<string, unknown>, trade: WebLeadRecord["trade"] = "fence"): WebLeadRecord => ({ ...base, trade, estimate: { ...base.estimate, trade, facts } });

// ── the fence ──
const drawn = fenceSeedFromWebLead(base);
check("a drawn fence: the pin, the points, the style, the height, the gates, the runs", !!drawn && drawn.pin?.lat === 42.948 && drawn.pin?.lng === -78.853 && drawn.points.length === 4 && drawn.points[2].x === 60 && drawn.type === "cedar-privacy" && drawn.heightFt === 6 && drawn.gates === 1 && drawn.doubles === 0 && drawn.runsFt.join() === "60,60,60", JSON.stringify(drawn));
const typed = fenceSeedFromWebLead(withFacts({ runsFt: [150], type: "vinyl-privacy", heightFt: 6, gates: 2, doubles: 1, drawn: false, points: null, pin: null }));
check("typed feet: no points, no pin, the runs", !!typed && typed.points.length === 0 && typed.pin === null && typed.runsFt.join() === "150" && typed.gates === 2 && typed.doubles === 1 && typed.type === "vinyl-privacy", JSON.stringify(typed));
check("the height and the gates default when missing; odd points are dropped", (() => { const s = fenceSeedFromWebLead(withFacts({ runsFt: [40], type: "x", points: [{ x: 1 }, "bad", { x: 2, y: 3 }] })); return !!s && s.heightFt === 6 && s.gates === 0 && s.doubles === 0 && s.points.length === 1 && s.points[0].y === 3; })());
check("not a fence, or no runs: nothing", fenceSeedFromWebLead(withFacts(base.estimate.facts, "hvac")) === null && fenceSeedFromWebLead(withFacts({})) === null && fenceSeedFromWebLead(withFacts({ runsFt: [] })) === null);

// ── HVAC ──
const site = { address: "418 Linden Ave, Buffalo, NY 14216", state: "NY", lat: 42.948, lng: -78.853, livingSqft: 2100, storeys: 2, yearBuilt: 1962, county: "Erie", sources: { living: "assessor" } };
const withSite = hvacSeedFromWebLead(withFacts({ site, sqft: 2100, storeys: 2, yearBuilt: 1962, existing: "split-ac-furnace", gas: "yes", outdoorKind: "air-conditioner", tier: "mid", itemId: "carrier-24abc636", pin: { lat: 42.948, lng: -78.853 } }, "hvac"));
check("a record with the site: the site as stored, what is there, the gas, the kind, the tier, the unit", !!withSite && withSite.site.livingSqft === 2100 && withSite.site.sources.living === "assessor" && withSite.site.county === "Erie" && withSite.existing === "split-ac-furnace" && withSite.gas === "yes" && withSite.outdoorKind === "air-conditioner" && withSite.tier === "mid" && withSite.itemId === "carrier-24abc636", JSON.stringify(withSite));
const older = hvacSeedFromWebLead(withFacts({ sqft: 1800, storeys: 1, yearBuilt: 1995, existing: "heat-pump", gas: "no", outdoorKind: "heat-pump", tier: "premium", pin: { lat: 42.948, lng: -78.853 } }, "hvac"));
check("an older record (no site): rebuilt from the address, the pin and the square feet; no unit id", !!older && older.site.address === "418 Linden Ave, Buffalo, NY 14216" && older.site.state === "NY" && older.site.lat === 42.948 && older.site.lng === -78.853 && older.site.livingSqft === 1800 && older.site.storeys === 1 && older.site.yearBuilt === 1995 && Object.keys(older.site.sources).length === 0 && older.itemId === null && older.tier === "premium" && older.outdoorKind === "heat-pump" && older.gas === "no", JSON.stringify(older));
check("the defaults when the words are odd", (() => { const s = hvacSeedFromWebLead(withFacts({ site, tier: "mid", existing: 7, gas: null, outdoorKind: "x" }, "hvac")); return !!s && s.existing === "split-ac-furnace" && s.gas === "yes" && s.outdoorKind === "air-conditioner"; })());
check("not hvac, or no tier: nothing", hvacSeedFromWebLead(withFacts({ site, tier: "mid" }, "fence")) === null && hvacSeedFromWebLead(withFacts({ site }, "hvac")) === null && hvacSeedFromWebLead(withFacts({ site, tier: "gold" }, "hvac")) === null);

// ── Smart Proposal ──
const good = { title: "Hall bath remodel", scope: "Remove the tub surround, tile the walls and floor, set a new vanity and faucet.", assumptions: ["Plumbing stays where it is."], materials: [{ name: "Porcelain tile", quantity: 60, unit: "sq ft", unitPrice: 6.5 }], labor: [{ name: "Tile setter", quantity: 16, unit: "hr", unitPrice: 85 }], estimatedTimelineDays: 6, discount: { amount: 10, isPercent: true, label: "Fall special" } };
const s = smartSeedFromWebLead(withFacts({ estimate: good, brief: "Redo the hall bath, keep the tub", qualityTier: "standard", sqft: null, photos: 1 }, "smart"));
check("a smart record: the generated estimate re-validated, its discount, the brief", !!s && s.estimate.title === "Hall bath remodel" && s.estimate.materials.length === 1 && s.estimate.labor[0].unitPrice === 85 && s.estimate.discount?.amount === 10 && s.brief === "Redo the hall bath, keep the tub", JSON.stringify(s));
check("a record whose estimate does not parse, or no brief: nothing", smartSeedFromWebLead(withFacts({ estimate: { title: 1 }, brief: "x" }, "smart")) === null && smartSeedFromWebLead(withFacts({ estimate: good }, "smart")) === null && smartSeedFromWebLead(withFacts({ estimate: good, brief: "x" }, "deck")) === null);
// The house org's pricing method (its labor rate, markup, tax rule) never rides to the buyer: their own applies.
const priced = smartSeedFromWebLead(withFacts({ estimate: { ...good, pricing: { mode: "company", laborBasis: "crew", crewSize: 2, laborRate: 95, materialMarkupPct: 20, overheadPct: 10, profitPct: 10, taxMode: "none", taxRatePct: null, words: "the house's method" } }, brief: "Redo the hall bath" }, "smart"));
check("the generated estimate's pricing snapshot is stripped on the hand-off", !!priced && priced.estimate.pricing === undefined && priced.estimate.materials.length === 1, JSON.stringify(priced?.estimate.pricing));

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
