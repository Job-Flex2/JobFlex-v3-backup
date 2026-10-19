// THE PLANS' ENVELOPE FOR THE HEATING & COOLING LOAD (owner, 2026-10-18: "make sure the blueprint estimator can
// estimate HVAC Manual J based — make it smart, blueprints have the windows' sizes and the rest"). Pure and
// browser-safe: what a load calculation needs, taken out of the house the takeoff merged — the conditioned floors and
// their heights, every window and glass door with its size, the glass on each elevation and the way the front
// faces, the energy-code values (R-values, U-factor, SHGC, the air-leakage target, the ducts), the foundation, the
// roof, the siding, the bedrooms. The server (lib/plans/hvacLoad) turns it into the HVAC engine's building model,
// runs the load and sizes the equipment; the result comes back as a PlanHvacLoad and the build list is sized on it.
import { mechOf, type House } from "./takeoff";
import { isBedroom, isOverheadDoor } from "./rooms";
import type { Compass, PlanEnergy, PlanFacade, SheetRead } from "./sheet";

export type PlanEnvelope = {
  address: string | null;
  livingSqFt: number;
  levels: Array<{ name: string; areaSqFt: number; perimeterLf: number; plateFt: number; pages: number[] }>;
  foundation: "slab" | "crawlspace" | "basement" | "piers";
  windows: Array<{ widthIn: number | null; heightIn: number | null; count: number; type: string | null }>;
  /** Exterior doors, garage overhead doors left out (the garage is not conditioned). */
  doors: Array<{ widthIn: number | null; heightIn: number | null; count: number; type: string | null }>;
  facades: PlanFacade[];
  frontFaces: Compass | null;
  energy: PlanEnergy | null;
  roof: { material: string | null; overhangIn: number };
  siding: string | null;
  exteriorFraming: string | null;
  bedrooms: number;
  /** Notes that name insulation or air sealing, for what the energy table did not say. */
  notes: string[];
  /** A heat pump house: the plans say so, or nothing burns gas. */
  heatPump: boolean;
  /** What the plans' mechanical sheet states, if anything — the size the load is set beside. */
  stated: { tons: number | null; heatLoadBtu: number | null; system: string | null; systems: number | null };
  pages: { windows: number[]; energy: number[]; facades: number[]; site: number[] };
};

/** The furnace or the water heater burns gas: a gas house (a gas cooktop or fireplace alone does not make one). */
export function gasHeatHouse(sheets: SheetRead[]): boolean {
  const mech = mechOf(sheets);
  return /\bgas\b|furnace|propane/i.test(`${mech?.system ?? ""} ${mech?.waterHeater ?? ""}`);
}
export function heatPumpHouse(sheets: SheetRead[]): boolean {
  return /heat pump/i.test(mechOf(sheets)?.system ?? "") || !gasHeatHouse(sheets);
}

const uniq = (a: number[]) => Array.from(new Set(a)).sort((x, y) => x - y);

export function planEnvelopeOf(house: House, sheets: SheetRead[]): PlanEnvelope {
  const mech = mechOf(sheets);
  const rooms = house.levels.flatMap((l) => l.rooms);
  const notes = house.notes.filter((n) => /\bR-?\s?\d|insulat|U-?\s?0?\.\d|ACH|blower|air[- ]?seal|sealed crawl|unvented|duct/i.test(n)).slice(0, 12);
  return {
    address: house.address,
    livingSqFt: house.livingSqFt,
    levels: house.levels.map((l) => ({ name: l.name, areaSqFt: l.areaSqFt, perimeterLf: l.perimeterLf, plateFt: l.plateFt, pages: l.pages })),
    foundation: house.foundation.type,
    windows: house.windows.map((w) => ({ widthIn: w.widthIn, heightIn: w.heightIn, count: w.count, type: w.type })),
    doors: house.doors.filter((d) => d.exterior && !isOverheadDoor(d)).map((d) => ({ widthIn: d.widthIn, heightIn: d.heightIn, count: d.count, type: d.type })),
    facades: house.facades ?? [],
    frontFaces: house.frontFaces ?? null,
    energy: house.energy ?? null,
    roof: { material: house.roof.material, overhangIn: house.roof.overhangIn },
    siding: house.siding,
    exteriorFraming: sheets.map((s) => s.walls.exteriorFraming).find(Boolean) ?? null,
    bedrooms: rooms.filter(isBedroom).length,
    notes,
    heatPump: heatPumpHouse(sheets),
    stated: {
      tons: mech?.tons ?? null,
      heatLoadBtu: sheets.map((s) => s.mechanical.heatLoadBtu).find((x): x is number => !!x) ?? null,
      system: mech?.system ?? null,
      systems: Math.max(0, ...sheets.map((s) => s.mechanical.systems ?? 0)) || null,
    },
    pages: {
      windows: uniq(sheets.filter((s) => s.windows.length).map((s) => s.page)),
      energy: uniq(sheets.filter((s) => s.energy).map((s) => s.page)),
      facades: uniq(sheets.filter((s) => s.facades?.length).map((s) => s.page)),
      site: uniq(sheets.filter((s) => s.frontFaces).map((s) => s.page)),
    },
  };
}

/** One input of the load, as the page shows it: what it is, and whether the plans said it or it was assumed. */
export type PlanLoadInput = { label: string; value: string; from: "plans" | "assumed"; pages?: number[] };

/** THE LOAD, AS THE BUILD LIST AND THE PAGE USE IT — plain data, safe to send to the browser. */
export type PlanHvacLoad = {
  heatingBtuh: number;
  coolingTotalBtuh: number;
  coolingSensibleBtuh: number;
  coolingLatentBtuh: number;
  /** coolingTotal ÷ 12,000, two decimals. */
  loadTons: number;
  coolingCfm: number;
  /** The equipment the load calls for, sized the Manual S way on the engine's catalog. */
  system: {
    heatPump: boolean;
    /** Nominal tons of each system. */
    tons: number;
    systems: number;
    /** Heat pump: electric backup heat each air handler needs on the design day, kW (a strip size). */
    backupKw: number | null;
    /** Heat pump: what it still delivers at the heating design temperature, Btu/h. */
    heatAtDesignBtuh: number | null;
    /** Gas house: furnace input of each system, Btu/h. */
    furnaceInputBtu: number | null;
    /** One sentence: how the size was chosen. */
    note: string;
  };
  climate: { place: string; coolingF: number; heatingF: number; source: string; match: "county" | "fuzzy" | "state" | "none" };
  inputs: PlanLoadInput[];
  /** The biggest parts of the load, largest first. */
  components: Array<{ name: string; heatingBtuh: number; coolingBtuh: number }>;
  assumptions: string[];
  levers: string[];
  engine: string;
};

/** "2.5 tons · 31,500 Btu/h cooling · 41,000 Btu/h heating" — the load in one line. */
export function loadWords(l: PlanHvacLoad): string {
  const n = (v: number) => v.toLocaleString("en-US");
  return `${n(l.coolingTotalBtuh)} Btu/h cooling at ${l.climate.coolingF} °F · ${n(l.heatingBtuh)} Btu/h heating at ${l.climate.heatingF} °F (${l.climate.place})`;
}
