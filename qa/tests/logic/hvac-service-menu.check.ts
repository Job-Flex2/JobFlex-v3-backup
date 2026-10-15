// The HVAC service menu after the Housecall Pro comparison (2026-09-22): the
// rows a shop's book carries, every one priced; labor moved to the job's
// market; the repair-or-replace rule; the parts on the shelf list.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/hvac-service-menu.check.ts
import { SERVICE_GROUPS, SERVICE_MENU, indexedLabor, repairAdvice, serviceLaborIndex, serviceMenuFor, serviceTask } from "../../../src/lib/hvac/serviceMenu";
import { runEngine } from "../../../src/lib/hvac/engine";
import { buildLedger, DEFAULT_RATE_CARD, normalizeRateCard, STARTER_CATALOG } from "../../../src/lib/hvac/ledger";
import { modelFromSite } from "../../../src/lib/hvac/intake";
import { presetItems } from "../../../src/lib/inventoryPresets";
import type { BuildingModel } from "../../../src/lib/hvac/types";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
function house(over: Partial<BuildingModel> = {}, address = "4518 Bluestem Hollow Dr, Frisco, TX 75034", state = "TX"): BuildingModel {
  const m = modelFromSite({ address, state, county: "Collin", footprintSqft: 2000, storeys: 1, yearBuilt: 1998, sources: {} });
  m.existing = { kind: "split-ac-furnace", tons: 3, fuel: "gas", refrigerant: "R-410A", yearMade: 2018 };
  m.gas = { available: true, pipeIn: 0.75, longestRunFt: 30 };
  return Object.assign(m, over);
}
const ids = (m: ReturnType<typeof serviceMenuFor>) => m.groups.flatMap((g) => g.tasks.map((t) => t.id));
const groups = (m: ReturnType<typeof serviceMenuFor>) => m.groups.map((g) => g.group);

// ── the book
check(`the menu is a shop's book: ${SERVICE_MENU.length} tasks (≥ 90), ids unique`, SERVICE_MENU.length >= 90 && new Set(SERVICE_MENU.map((t) => t.id)).size === SERVICE_MENU.length);
check("every task is priced — labor > 0 (a by-the-pound task prices through the rate card), a part costs > 0 when there is one, and every row says what it includes", SERVICE_MENU.every((t) => (t.unit === "lb" || t.laborUsd > 0) && (!t.part || t.part.costUsd > 0) && t.includes.length > 20));
check("every task's group is a listed group", SERVICE_MENU.every((t) => SERVICE_GROUPS.some((g) => g.group === t.group)));
const need = ["evap-coil-replace", "cond-coil-replace", "blower-ecm-module", "hx-replace", "lineset-repair", "lineset-flush", "lineset-replace", "fan-belt", "blower-bearing", "media-cabinet", "uv-lamp", "humidifier", "dehumidifier", "erv", "zone-board", "damper", "duct-seal", "relocate-outdoor", "zone-valve", "circulator", "boiler-expansion", "heat-strip", "surge"];
check("the Housecall Pro rows that were missing are on it", need.every((id) => SERVICE_MENU.some((t) => t.id === id)), need.filter((id) => !SERVICE_MENU.some((t) => t.id === id)).join(","));

// ── the menu fits the house
const gas = serviceMenuFor(house());
check("AC + gas furnace: air quality, zoning and boiler groups appear; the old groups stay; no ductless", ["iaq", "zoning", "boiler", "tune-up", "refrigerant", "electrical", "furnace", "airflow"].every((g) => groups(gas).includes(g)) && !groups(gas).includes("ductless"), groups(gas).join(","));
const hp = serviceMenuFor(house({ gas: { available: false }, existing: { kind: "split-heat-pump", tons: 3, fuel: "electric", refrigerant: "R-410A", yearMade: 2018 } }));
check("all-electric heat pump: heat strips and sequencer offered, no boiler and no gas furnace group", ids(hp).includes("heat-strip") && ids(hp).includes("sequencer") && !groups(hp).includes("boiler") && !groups(hp).includes("furnace"));
const dl = serviceMenuFor(house({ gas: { available: false }, existing: { kind: "ductless", tons: 1, fuel: "electric", refrigerant: "R-410A" } }));
check("ductless: its blower motor and flare repair, no ducted work (coil replacement, zoning, duct sealing)", ids(dl).includes("ductless-blower") && ids(dl).includes("ductless-flare") && !ids(dl).includes("evap-coil-replace") && !ids(dl).includes("zone-board") && !ids(dl).includes("duct-seal"));

// ── labor in this market
const frisco = serviceLaborIndex(house());
const seattle = serviceLaborIndex(house({}, "4567 Rainier Ave S, Seattle, WA 98118", "WA"));
const cap = SERVICE_MENU.find((t) => t.id === "capacitor")!;
check("labor is indexed to the job's market: Seattle above the Texas suburb, both to the nearest $5", seattle.factor > frisco.factor && indexedLabor(cap, seattle.factor) % 5 === 0 && indexedLabor(cap, seattle.factor) > indexedLabor(cap, frisco.factor), `Frisco ×${frisco.factor} → $${indexedLabor(cap, frisco.factor)} · Seattle ×${seattle.factor} → $${indexedLabor(cap, seattle.factor)}`);
check("a shop's own saved task keeps the number the shop typed", indexedLabor({ id: "x", group: "custom", title: "Mine", includes: "", laborUsd: 123, custom: true }, 1.3) === 123);
const sea = house({}, "4567 Rainier Ave S, Seattle, WA 98118", "WA");
const pick = { service: { tasks: ["capacitor"] } };
const led = buildLedger(runEngine(sea, { catalog: STARTER_CATALOG, job: "service", input: pick }), sea, DEFAULT_RATE_CARD, STARTER_CATALOG, { job: "service", input: pick });
check("the ledger's labor line carries the indexed price and the assumption says the market", led.labor.find((l) => l.id === "l-svc-capacitor")?.unitPrice === indexedLabor(cap, seattle.factor) && led.assumptions.some((a) => /×1\.\d\d for/.test(a)), led.assumptions[0]);
check("the part line is not indexed", led.materials.find((l) => l.id === "m-svc-capacitor")?.unitPrice === Math.round(cap.part!.costUsd * (1 + DEFAULT_RATE_CARD.materialsMarkupPct / 100)));

// ── repair or replace
const young = repairAdvice({ model: house(), taskIds: ["capacitor"], repairSubtotal: 250 });
check("a capacitor on a 2018 system: repair, no note", young.verdict === "repair" && young.line === "");
const oldComp = repairAdvice({ model: house({ existing: { kind: "split-ac-furnace", tons: 3, fuel: "gas", refrigerant: "R-410A", yearMade: 2008 } }), taskIds: ["compressor"], repairSubtotal: 2600 });
check("a compressor on an 18-year-old system: replace — the age, the $5,000 rule and the major part are named", oldComp.verdict === "replace" && /18 years old/.test(oldComp.line) && /\$5,000 rule/.test(oldComp.line) && /compressor/.test(oldComp.line), oldComp.line);
const r22 = repairAdvice({ model: house({ existing: { kind: "split-ac-furnace", tons: 3, fuel: "gas", refrigerant: "R-22", yearMade: 2006 } }), taskIds: ["leak-repair"], repairSubtotal: 1200 });
check("R-22 leak repair on a 2006 system: replace, R-22 named", r22.verdict === "replace" && /R-22/.test(r22.line), r22.line);
const mid = repairAdvice({ model: house({ existing: { kind: "split-ac-furnace", tons: 3, fuel: "gas", refrigerant: "R-410A", yearMade: 2014 } }), taskIds: ["blower-ecm"], repairSubtotal: 700 });
check("a $700 blower on a 12-year-old system: worth weighing, not a replace verdict", mid.verdict === "consider", `${mid.verdict}: ${mid.line}`);
const share = repairAdvice({ model: house(), taskIds: ["evap-coil-replace"], repairSubtotal: 2400, replaceSubtotal: 5000 });
check("a $2,400 coil against a $5,000 replacement on a young system: weigh it, the share named", share.verdict === "consider" && /48% of a replacement/.test(share.line), share.line);
const cheap = repairAdvice({ model: house(), taskIds: ["evap-coil-replace"], repairSubtotal: 2400, replaceSubtotal: 11000 });
check("the same coil against an $11,000 replacement: still worth weighing (a major part), the share not named under 40%", cheap.verdict === "consider" && !/% of a replacement/.test(cheap.line), cheap.line);
const ledOld = buildLedger(runEngine(house({ existing: { kind: "split-ac-furnace", tons: 3, fuel: "gas", refrigerant: "R-410A", yearMade: 2008 } }), { catalog: STARTER_CATALOG, job: "service", input: { service: { tasks: ["compressor"] } } }), house({ existing: { kind: "split-ac-furnace", tons: 3, fuel: "gas", refrigerant: "R-410A", yearMade: 2008 } }), DEFAULT_RATE_CARD, STARTER_CATALOG, { job: "service", input: { service: { tasks: ["compressor"] } } });
check("the estimate itself carries the repair-or-replace line", ledOld.assumptions.some((a) => /^Repair or replace:/.test(a)));

// ── the shop's own numbers on the book (2026-09-23)
const mine = { capacitor: { laborUsd: 120, partCostUsd: 40 }, "hard-start": { hidden: true } };
const own = serviceTask("capacitor", [], mine)!;
check("a price the shop typed is the shop's price: not indexed, not adjusted, flagged as its own", own.ownLabor === true && own.ownPart === true && indexedLabor(own, 1.25, 15) === 120 && own.part?.costUsd === 40);
check("the typical still indexes and takes the shop's adjustment, to the nearest $5", indexedLabor(cap, 1, 10) === 105 && indexedLabor(cap, 1, 0) === 95);
const menuMine = serviceMenuFor(house(), [], mine);
check("a hidden task is off the visit's menu, but still resolves by id so an old estimate keeps pricing", !ids(menuMine).includes("hard-start") && ids(menuMine).includes("capacitor") && serviceTask("hard-start", [], mine)?.title === "Hard-start kit");
const cardMine = normalizeRateCard({ ...DEFAULT_RATE_CARD, serviceOverrides: { ...mine, junk: { laborUsd: "x" }, capacitorX: { laborUsd: 9e9 } }, serviceLaborAdjustPct: 250 });
check("the rate card keeps the shop's numbers, drops junk, bounds the rest", cardMine.serviceOverrides?.capacitor?.laborUsd === 120 && cardMine.serviceOverrides?.["hard-start"]?.hidden === true && !cardMine.serviceOverrides?.junk && cardMine.serviceOverrides?.capacitorX?.laborUsd === 50_000 && cardMine.serviceLaborAdjustPct === 100, JSON.stringify(cardMine.serviceOverrides));
const ledMine = buildLedger(runEngine(sea, { catalog: STARTER_CATALOG, job: "service", input: pick }), sea, { ...DEFAULT_RATE_CARD, serviceOverrides: mine }, STARTER_CATALOG, { job: "service", input: pick });
check("the estimate prices the shop's numbers: $120 labor as entered, the part at the shop's cost plus markup, the note says so", ledMine.labor.find((l) => l.id === "l-svc-capacitor")?.unitPrice === 120 && ledMine.labor.find((l) => l.id === "l-svc-capacitor")?.basis === "entered" && ledMine.materials.find((l) => l.id === "m-svc-capacitor")?.unitPrice === Math.round(40 * (1 + DEFAULT_RATE_CARD.materialsMarkupPct / 100)) && /your menu price/.test(ledMine.labor.find((l) => l.id === "l-svc-capacitor")?.note ?? ""), ledMine.labor.find((l) => l.id === "l-svc-capacitor")?.note);
const ledAdj = buildLedger(runEngine(sea, { catalog: STARTER_CATALOG, job: "service", input: pick }), sea, { ...DEFAULT_RATE_CARD, serviceLaborAdjustPct: 10 }, STARTER_CATALOG, { job: "service", input: pick });
check("the shop's adjustment moves a typical price on the estimate and is named in the assumption", ledAdj.labor.find((l) => l.id === "l-svc-capacitor")?.unitPrice === indexedLabor(cap, seattle.factor, 10) && /\+10% your adjustment/.test(ledAdj.assumptions[0]), ledAdj.assumptions[0]);

// ── the shelf
const shelf = presetItems("hvac").map((i) => i.name);
check(`the HVAC shelf list has the service parts (${shelf.length} items): capacitor, contactor, igniter, flame sensor, UV lamp, zone valve`, [/capacitor/i, /contactor/i, /igniter/i, /flame sensor/i, /uv coil lamp/i, /zone valve/i].every((re) => shelf.some((n) => re.test(n))), shelf.slice(0, 6).join(" | "));

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
