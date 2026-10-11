// THE STANDARD STOCK ITEMS PER TRADE (2026-09-20) — read off the estimators.
//
// Owner: "look into the material package and estimator what we offer and
// how to build the fence, use all those materials as items already preset
// — fence boards, two by fours, pressure treated boards or cedar boards and
// posts … same for roofing and HVAC."
//
// Nothing here is typed by hand. Each trade's estimator is run over its own
// catalog — every fence type, every roof system, the HVAC jobs on a gas and
// an all-electric house — and every MATERIAL line it prices becomes an item,
// so the warehouse list is exactly what the proposals will draw on and the
// names match by construction (lib/inventory stockKey). Pure: no database.

import { FENCE_TYPES } from "@/lib/fence/catalog";
import { computeFenceTakeoff, type FenceLayoutInput } from "@/lib/fence/takeoff";
import { bomItemName } from "@/lib/inventoryBom";
import { BUILTIN_LISTS, ROOF_SYSTEMS } from "@/lib/roofPackage/catalog";
import { buildRoofPackage, defaultSpec, withSystem, type RoofFacts } from "@/lib/roofPackage/takeoff";
import { runEngine } from "@/lib/hvac/engine";
import { modelFromSite } from "@/lib/hvac/intake";
import { buildLedger, DEFAULT_RATE_CARD, STARTER_CATALOG } from "@/lib/hvac/ledger";
import { SERVICE_MENU } from "@/lib/hvac/serviceMenu";
import type { BuildingModel } from "@/lib/hvac/types";
import { stockKey, type TradeId } from "@/lib/inventory";
import { defaultDeckDesign, normalizeDeckDesign } from "@/lib/deck/design";
import { priceDeck } from "@/lib/deck/pricing";

export type PresetItem = { name: string; unit: string };

/** Lines that are money, not material: passed through or billed, never on a shelf. */
const NOT_STOCK = /\b(permit|fee|inspection|warranty|disposal|dumpster|haul|mobilization|rental|crane|hoist|delivery|labor|install)\b/i;

const UNIT: Record<string, string> = { "ln ft": "linear ft", ea: "each", each: "each", lot: "lot", sqft: "sqft", "sq ft": "sqft", square: "square", "linear ft": "linear ft", hour: "hour", bag: "bag", box: "box", gal: "gal", roll: "roll", bundle: "bundle" };

function collect(lines: Array<{ name: string; unit: string }>, into: Map<string, PresetItem>) {
  for (const l of lines) {
    const name = l.name.trim();
    const key = stockKey(name);
    if (!key || NOT_STOCK.test(name) || into.has(key)) continue;
    into.set(key, { name, unit: UNIT[l.unit] ?? l.unit ?? "each" });
  }
}

function fencePresets(): PresetItem[] {
  const out = new Map<string, PresetItem>();
  for (const t of FENCE_TYPES) {
    for (const heightFt of [4, 6, 8]) {
      const layout: FenceLayoutInput = {
        type: t.id,
        heightFt,
        runs: [{ lengthFt: 104, corners: 2 }],
        openings: [
          { widthFt: 4, kind: "gate", label: "Single gate", variant: "single" },
          { widthFt: 10, kind: "gate", label: "Double gate", variant: "double" },
        ],
        terrain: "flat",
        wastePct: 10,
      };
      try {
        // The takeoff's bill of materials: the posts, rails, pickets, concrete
        // and fasteners the package line was priced from — what a warehouse
        // actually holds — without the job-specific tail on each label.
        const bomUnit: Record<string, string> = { ea: "each", lf: "linear ft", bag: "bag", box: "box", gal: "gal" };
        collect(computeFenceTakeoff(layout).bom.map((b) => ({ name: bomItemName(b.label), unit: bomUnit[b.unit] ?? b.unit })), out);
      } catch {
        /* a type the engine cannot price at this height adds nothing */
      }
    }
  }
  return [...out.values()];
}

const roofFacts = (over: Partial<RoofFacts> = {}): RoofFacts => ({
  squares: 28,
  squaresBasis: "estimated",
  pitchFamilies: [{ pitch12: 6, share: 1 }],
  pitchBasis: "estimated",
  perimeterFt: 210,
  footprintSqft: 2400,
  chimney: true,
  rooftopAcCount: 0,
  shape: "Hip",
  facetCount: 6,
  existingMaterial: "Asphalt shingle",
  buildingUse: "residential",
  storeys: 1,
  ...over,
});

function roofPresets(): PresetItem[] {
  const out = new Map<string, PresetItem>();
  for (const sys of ROOF_SYSTEMS) {
    const flat = sys.family === "low-slope";
    const facts = roofFacts(flat ? { pitchFamilies: [{ pitch12: 0.5, share: 1 }], shape: "Flat", facetCount: 1, existingMaterial: "Flat", chimney: false } : {});
    try {
      const spec = withSystem(defaultSpec(facts, BUILTIN_LISTS), sys, facts, BUILTIN_LISTS);
      const pkg = buildRoofPackage(spec, facts);
      collect(pkg.materials.filter((l) => l.kind === "material").map((l) => ({ name: l.name, unit: l.unit })), out);
    } catch {
      /* a system the builder cannot open on this house adds nothing */
    }
  }
  return [...out.values()];
}

function hvacHouse(over: Partial<BuildingModel> = {}): BuildingModel {
  const m = modelFromSite({ address: "4518 Bluestem Hollow Dr, Frisco, TX 75034", state: "TX", county: "Collin", footprintSqft: 2000, storeys: 1, yearBuilt: 1998, sources: {} });
  m.existing = { kind: "split-ac-furnace", tons: 3.5, fuel: "gas", refrigerant: "R-22", yearMade: 2004 };
  m.electrical = { mainAmps: 200, freeSlots: 4, electricDryer: true };
  m.ducts = { location: "attic", condition: "fair", insulated: true, returnGrilleSqIn: 700 };
  m.gas = { available: true, pipeIn: 0.75, longestRunFt: 30 };
  return Object.assign(m, over);
}

function hvacPresets(): PresetItem[] {
  const out = new Map<string, PresetItem>();
  const houses: BuildingModel[] = [
    hvacHouse(),
    hvacHouse({ gas: { available: false }, preferences: { allElectric: true }, existing: { kind: "split-heat-pump", tons: 3, fuel: "electric" } }),
  ];
  type JobKind = NonNullable<Parameters<typeof runEngine>[1]["job"]>;
  const jobs: JobKind[] = ["replace-system", "replace-furnace", "replace-outdoor", "heat-pump-conversion", "add-ac", "ductless", "water-heater"];
  for (const house of houses) {
    for (const job of jobs) {
      try {
        const r = runEngine(house, { catalog: STARTER_CATALOG, job });
        const ledger = buildLedger(r, house, DEFAULT_RATE_CARD, STARTER_CATALOG);
        collect(ledger.materials.map((l) => ({ name: l.name, unit: l.unit })), out);
      } catch {
        /* a job the engine refuses on this house adds nothing */
      }
    }
  }
  // The service menu's parts (2026-09-22): capacitors, contactors, motors,
  // igniters — what a service truck and the shelf actually hold.
  collect(SERVICE_MENU.flatMap((t) => (t.part ? [{ name: t.part.name, unit: "each" }] : [])), out);
  return [...out.values()];
}

/** The deck estimator's material package (2026-10-10) over the structures a shop builds: a deck, a covered deck with gutters, a gazebo on a slab, a pergola, with stairs, a rail and lights. */
function deckPresets(): PresetItem[] {
  const out = new Map<string, PresetItem>();
  const unit: Record<string, string> = { pcs: "each", ea: "each", ft: "linear ft", bags: "bag", "sq ft": "sqft", sq: "square" };
  const base = defaultDeckDesign({ state: "TX", frostIn: 12 });
  const designs = [
    normalizeDeckDesign({ ...base, heightIn: 48, rail: { ...base.rail, type: "treated" }, stairs: [{ id: "s1", side: "front", atFt: 8, widthFt: 4, level: "upper", wrap: false, wrapSides: 1, landing: "pad", handrail: "auto" }], electrical: { ...base.electrical, fixtures: [{ id: "e1", kind: "post-cap", supply: "we", qty: 1, at: null }, { id: "e2", kind: "outlet", supply: "we", qty: 1, at: null }] } }),
    normalizeDeckDesign({ ...base, structure: "covered-deck", decking: { ...base.decking, product: "composite-better" }, rail: { ...base.rail, type: "composite" } }),
    normalizeDeckDesign({ ...base, structure: "gazebo", floor: "slab", roof: { ...base.roof, kind: "pyramid", plan: { ...base.roof.plan, shape: "octagon", acrossFt: 12 }, roofing: "metal-panel", walls: { fill: "screen", sides: 3 } } }),
    normalizeDeckDesign({ ...base, structure: "pergola", floor: "ground" }),
  ];
  for (const d of designs) {
    try {
      const pkg = priceDeck(d);
      // The package's lines less the job-specific tail ("2x8 × 12 ft — joists" → "2x8 × 12 ft joists") and nothing the client brings.
      collect(pkg.bom.filter((b) => !b.byClient).map((b) => ({ name: b.label.replace(/ — /g, " ").replace(/,\s*$/, ""), unit: unit[b.unit] ?? b.unit })), out);
    } catch {
      /* a structure the engine refuses adds nothing */
    }
  }
  return [...out.values()];
}

const cache = new Map<TradeId, PresetItem[]>();

/** Every material the trade's estimator prices, once, named as the estimator names it. */
export function presetItems(trade: TradeId): PresetItem[] {
  const hit = cache.get(trade);
  if (hit) return hit;
  const built = trade === "fence" ? fencePresets() : trade === "roof" ? roofPresets() : trade === "deck" ? deckPresets() : hvacPresets();
  cache.set(trade, built);
  return built;
}
