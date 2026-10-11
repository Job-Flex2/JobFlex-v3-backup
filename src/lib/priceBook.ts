// THE PRICE BOOK, ONE SHAPE FOR THREE TRADES (2026-09-29) — pure, no database.
//
// Each estimator keeps its own book: the fence studio its rates per type
// (FenceCatalogDoc), the roof builder its systems and underlayments
// (RoofCatalogDoc), the HVAC form its unit catalog (CatalogItem[]) and rate
// card (HvacRateCard). The unified Inventory page shows all three as one kind
// of row — a name, what it is (mono specs), a unit, a price, whether the
// company set it — and writes back to the SAME documents through the SAME
// actions the estimators read, so a change here is a change there and the
// takeoffs never see a new source. Nothing in the schema moves.

import { CATEGORY_LABEL, FENCE_TYPES, type FenceCategory, type FenceTypeId } from "@/lib/fence/catalog";
import { rateRows, standardRate, RATE_LIMITS, type RateBook } from "@/lib/fence/rates";
import type { FenceCatalogDoc } from "@/lib/fence/catalogSchema";
import type { CustomFenceType } from "@/lib/fence/pricing";
import { ROOF_FAMILIES, ROOF_SYSTEMS, UNDERLAYMENTS, familyLabel, type RoofFamily, type RoofSystem, type Underlayment } from "@/lib/roofPackage/catalog";
import type { RoofCatalogDoc } from "@/lib/roofPackage/catalogSchema";
import type { CatalogItem, EquipmentKind } from "@/lib/hvac/types";
import type { HvacRateCard } from "@/lib/hvac/ledger";
import type { TradeId } from "@/lib/inventory";
import { DECK_RATE_GROUP_LABEL, deckRateRows, type DeckRateBook } from "@/lib/deck/rates";

export type BookKind = "fence-type" | "roof-system" | "roof-underlayment" | "hvac-unit" | "hvac-rate" | "deck-rate";

/** One line of the book, whatever the trade. */
export type BookRow = {
  trade: TradeId;
  kind: BookKind;
  /** Stable id inside its kind (fence type id, roof system id, HVAC itemId, rate-card key). */
  id: string;
  /** Group label (fence category, roof family, HVAC kind, rate-card section). */
  group: string;
  name: string;
  /** Mono annotation: what it is, in a few words. */
  specs: string;
  /** Mono unit the price is per. */
  unit: string;
  /** The main price; null when the row has none (a unit without a shop cost). */
  price: number | null;
  /** A second money column, when the trade has one (fence labor $/lf, roof labor $/sq). */
  labor: number | null;
  /** The company set this (a saved override, a custom type, a shop row) rather than the built-in figure. */
  companyDefault: boolean;
  /** Built-in rows can be reset, not deleted; custom ones can be deleted. */
  custom: boolean;
  /** Everything the edit sheet needs to prefill, by field name. */
  fields: Record<string, string | number | boolean | undefined>;
  /** Swatch color, when the trade has one (fence types). */
  color?: string;
};

export type BookGroup = { label: string; rows: BookRow[] };

/* ── FENCE ─────────────────────────────────────────────────────────── */

export const FENCE_TYPE_IDS = FENCE_TYPES.map((t) => t.id) as FenceTypeId[];

export function fenceBookRows(doc: FenceCatalogDoc | null): BookRow[] {
  const book = (doc?.rates ?? {}) as RateBook;
  const rows: BookRow[] = rateRows(book).map((r) => {
    const t = FENCE_TYPES.find((x) => x.id === r.id)!;
    return {
      trade: "fence",
      kind: "fence-type",
      id: r.id,
      group: CATEGORY_LABEL[r.category as FenceCategory] ?? r.category,
      name: r.label,
      specs: `${r.defaultHeightFt}' default · gate $${r.effective.gateSingle}`,
      unit: "lf",
      price: r.effective.materialPerLf,
      labor: r.effective.laborPerLf,
      companyDefault: r.customized,
      custom: false,
      color: t.color,
      fields: { materialPerLf: r.effective.materialPerLf, laborPerLf: r.effective.laborPerLf, gateSingle: r.effective.gateSingle, standardMaterial: r.standard.materialPerLf, standardLabor: r.standard.laborPerLf, standardGate: r.standard.gateSingle },
    };
  });
  for (const c of doc?.custom ?? []) {
    const like = FENCE_TYPES.find((t) => t.id === c.like);
    rows.push({
      trade: "fence",
      kind: "fence-type",
      id: c.id,
      group: "Your own",
      name: c.label,
      specs: `built like ${like?.label ?? c.like}${c.gateSingle ? ` · gate $${c.gateSingle}` : ""}`,
      unit: "lf",
      price: c.materialPerLf,
      labor: c.laborPerLf,
      companyDefault: true,
      custom: true,
      color: c.color || like?.color,
      fields: { label: c.label, like: c.like, materialPerLf: c.materialPerLf, laborPerLf: c.laborPerLf, gateSingle: c.gateSingle, color: c.color },
    });
  }
  return rows;
}

export type FenceTypeEdit = { id: string; label?: string; like?: string; materialPerLf: number; laborPerLf: number; gateSingle?: number; color?: string };

/** The fence document after one row is saved. A built-in type keeps only the
 *  fields that differ from the catalog; a custom type is replaced or added. */
export function fenceDocWith(doc: FenceCatalogDoc | null, edit: FenceTypeEdit): FenceCatalogDoc {
  const base: FenceCatalogDoc = doc ? { ...doc, rates: { ...doc.rates }, custom: [...doc.custom] } : { version: 1, rates: {}, custom: [] };
  if ((FENCE_TYPE_IDS as string[]).includes(edit.id)) {
    const std = standardRate(edit.id as FenceTypeId);
    const rate: Record<string, number> = {};
    if (edit.materialPerLf !== std.materialPerLf) rate.materialPerLf = edit.materialPerLf;
    if (edit.laborPerLf !== std.laborPerLf) rate.laborPerLf = edit.laborPerLf;
    if (edit.gateSingle !== undefined && edit.gateSingle !== std.gateSingle) rate.gateSingle = edit.gateSingle;
    if (Object.keys(rate).length) base.rates[edit.id] = rate;
    else delete base.rates[edit.id];
    return base;
  }
  const like = (FENCE_TYPE_IDS as string[]).includes(edit.like ?? "") ? (edit.like as FenceTypeId) : FENCE_TYPE_IDS[0];
  const next: CustomFenceType = { id: edit.id, label: (edit.label ?? "Custom type").trim() || "Custom type", like, materialPerLf: edit.materialPerLf, laborPerLf: edit.laborPerLf, ...(edit.gateSingle !== undefined ? { gateSingle: edit.gateSingle } : {}), ...(edit.color ? { color: edit.color } : {}) };
  const at = base.custom.findIndex((c) => c.id === edit.id);
  if (at >= 0) base.custom[at] = next;
  else base.custom.push(next);
  return base;
}

/** The document without a row: a built-in type back to the catalog, a custom type gone. */
export function fenceDocWithout(doc: FenceCatalogDoc | null, id: string): FenceCatalogDoc {
  const base: FenceCatalogDoc = doc ? { ...doc, rates: { ...doc.rates }, custom: doc.custom.filter((c) => c.id !== id) } : { version: 1, rates: {}, custom: [] };
  delete base.rates[id];
  return base;
}

/** A fresh custom-type id the fence studio's own rule recognises (custom-<n>). */
export function nextCustomFenceId(doc: FenceCatalogDoc | null): string {
  const used = new Set((doc?.custom ?? []).map((c) => c.id));
  let n = 1;
  while (used.has(`custom-${n}`)) n += 1;
  return `custom-${n}`;
}

export const FENCE_RATE_LIMITS = RATE_LIMITS;

/* ── ROOF ──────────────────────────────────────────────────────────── */

export function roofLists(doc: RoofCatalogDoc | null): { systems: RoofSystem[]; underlayments: Underlayment[] } {
  return {
    systems: (doc?.systems?.length ? doc.systems : ROOF_SYSTEMS) as RoofSystem[],
    underlayments: (doc?.underlayments?.length ? doc.underlayments : UNDERLAYMENTS) as Underlayment[],
  };
}

function sameSystem(a: RoofSystem, b: RoofSystem | undefined): boolean {
  return !!b && a.label === b.label && a.family === b.family && a.matPerSq === b.matPerSq && a.laborPerSq === b.laborPerSq && a.wastePct === b.wastePct && a.capPerFt === b.capPerFt;
}

export function roofBookRows(doc: RoofCatalogDoc | null): BookRow[] {
  const { systems, underlayments } = roofLists(doc);
  const rows: BookRow[] = systems.map((s) => {
    const builtIn = ROOF_SYSTEMS.find((x) => x.id === s.id);
    return {
      trade: "roof",
      kind: "roof-system",
      id: s.id,
      group: familyLabel(s.family),
      name: s.label,
      specs: `waste ${s.wastePct}% · cap $${s.capPerFt}/ft`,
      unit: "sq",
      price: s.matPerSq,
      labor: s.laborPerSq,
      companyDefault: !sameSystem(s, builtIn),
      custom: !builtIn,
      fields: { label: s.label, family: s.family, matPerSq: s.matPerSq, laborPerSq: s.laborPerSq, wastePct: s.wastePct, capPerFt: s.capPerFt },
    };
  });
  for (const u of underlayments) {
    const builtIn = UNDERLAYMENTS.find((x) => x.id === u.id);
    rows.push({
      trade: "roof",
      kind: "roof-underlayment",
      id: u.id,
      group: "Underlayment",
      name: u.label,
      specs: "per square, under the covering",
      unit: "sq",
      price: u.perSq,
      labor: null,
      companyDefault: !builtIn || builtIn.perSq !== u.perSq || builtIn.label !== u.label,
      custom: !builtIn,
      fields: { label: u.label, perSq: u.perSq },
    });
  }
  return rows;
}

export type RoofSystemEdit = { id: string; label: string; family: RoofFamily; matPerSq: number; laborPerSq: number; wastePct: number; capPerFt: number };
export type RoofUnderlaymentEdit = { id: string; label: string; perSq: number };

export function roofDocWith(doc: RoofCatalogDoc | null, edit: { system?: RoofSystemEdit; underlayment?: RoofUnderlaymentEdit }): RoofCatalogDoc {
  const { systems, underlayments } = roofLists(doc);
  const nextSystems = systems.map((s) => ({ ...s }));
  const nextUnder = underlayments.map((u) => ({ ...u }));
  if (edit.system) {
    const at = nextSystems.findIndex((s) => s.id === edit.system!.id);
    const row: RoofSystem = { ...edit.system };
    if (at >= 0) nextSystems[at] = row;
    else nextSystems.push(row);
  }
  if (edit.underlayment) {
    const at = nextUnder.findIndex((u) => u.id === edit.underlayment!.id);
    const row: Underlayment = { ...edit.underlayment };
    if (at >= 0) nextUnder[at] = row;
    else nextUnder.push(row);
  }
  return { version: 1, systems: nextSystems, underlayments: nextUnder, prefs: doc?.prefs ?? {} };
}

/** A built-in row goes back to the catalog figure; a custom row is removed. Never below one row per list. */
export function roofDocWithout(doc: RoofCatalogDoc | null, kind: "roof-system" | "roof-underlayment", id: string): RoofCatalogDoc {
  const { systems, underlayments } = roofLists(doc);
  let nextSystems = systems.map((s) => ({ ...s }));
  let nextUnder = underlayments.map((u) => ({ ...u }));
  if (kind === "roof-system") {
    const builtIn = ROOF_SYSTEMS.find((s) => s.id === id);
    nextSystems = builtIn ? nextSystems.map((s) => (s.id === id ? { ...builtIn } : s)) : nextSystems.filter((s) => s.id !== id);
    if (!nextSystems.length) nextSystems = [{ ...ROOF_SYSTEMS[0] }];
  } else {
    const builtIn = UNDERLAYMENTS.find((u) => u.id === id);
    nextUnder = builtIn ? nextUnder.map((u) => (u.id === id ? { ...builtIn } : u)) : nextUnder.filter((u) => u.id !== id);
    if (!nextUnder.length) nextUnder = [{ ...UNDERLAYMENTS[0] }];
  }
  return { version: 1, systems: nextSystems, underlayments: nextUnder, prefs: doc?.prefs ?? {} };
}

export function slugId(label: string, taken: Iterable<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "item";
  const used = new Set(taken);
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}_${n++}`;
  return id;
}

export const ROOF_FAMILY_OPTIONS = ROOF_FAMILIES;

/* ── HVAC ──────────────────────────────────────────────────────────── */

export const HVAC_KINDS: Array<{ id: EquipmentKind; label: string }> = [
  { id: "heat-pump", label: "Heat pumps" },
  { id: "air-conditioner", label: "Air conditioners" },
  { id: "furnace", label: "Furnaces" },
  { id: "air-handler", label: "Air handlers" },
  { id: "coil", label: "Coils" },
  { id: "ductless", label: "Ductless" },
  { id: "package", label: "Package units" },
  { id: "water-heater", label: "Water heaters" },
];

export function hvacKindLabel(kind: string): string {
  return HVAC_KINDS.find((k) => k.id === kind)?.label ?? kind;
}

function hvacSpecs(c: CatalogItem): string {
  const bits: string[] = [];
  if (c.tons) bits.push(`${c.tons} t`);
  if (c.seer2) bits.push(`SEER2 ${c.seer2}`);
  if (c.hspf2) bits.push(`HSPF2 ${c.hspf2}`);
  if (c.afue) bits.push(`AFUE ${Math.round(c.afue * 1000) / 10}`);
  if (c.btuInput) bits.push(`${Math.round(c.btuInput / 1000)}k BTU`);
  if (c.refrigerant) bits.push(c.refrigerant);
  if (c.staging) bits.push(c.staging);
  if (c.coldClimate) bits.push("cold climate");
  return bits.join(" · ") || "—";
}

export function hvacBookRows(items: CatalogItem[], own: boolean): BookRow[] {
  return items.map((c) => ({
    trade: "hvac",
    kind: "hvac-unit",
    id: c.id,
    group: hvacKindLabel(c.kind),
    name: `${c.brand} ${c.model}`,
    specs: hvacSpecs(c),
    unit: "each",
    price: typeof c.cost === "number" ? c.cost : null,
    labor: null,
    companyDefault: own && (c.source === "shop" || typeof c.cost === "number"),
    custom: own,
    fields: { kind: c.kind, brand: c.brand, model: c.model, tons: c.tons, seer2: c.seer2, hspf2: c.hspf2, afue: c.afue, btuInput: c.btuInput, refrigerant: c.refrigerant, staging: c.staging, cost: c.cost },
  }));
}

/** The rate card as rows: fees and markups, then labor and materials by key. */
const RATE_LABELS: Record<string, string> = {
  equipmentMarkupPct: "Equipment markup", materialsMarkupPct: "Materials markup", permitFee: "Permit", disposalFee: "Disposal", craneFee: "Crane",
  removeSplit: "Remove split system", removePackage: "Remove package unit", removeOutdoor: "Remove outdoor unit", removeFurnace: "Remove furnace", removeWaterHeater: "Remove water heater",
  setOutdoor: "Set outdoor unit", setAirHandler: "Set air handler", setFurnace: "Set furnace", setCoil: "Set coil", setPackage: "Set package unit", setHead: "Set ductless head", setWaterHeater: "Set water heater",
  linesetPerFt: "Line set", linesetFlush: "Line set flush", electricalCircuit: "Electrical circuit", electricalConnect: "Electrical connect", gasPipePerFt: "Gas pipe", gasConnect: "Gas connect", ventingPerFt: "Venting",
  returnUpsize: "Return upsize", ductSealPerRegister: "Duct seal", ductRunReplace: "Duct run replace", ductTrunkLot: "Duct trunk", ductInsulatePerRun: "Duct insulate", thermostat: "Thermostat", startup: "Start-up & commissioning", diagnostic: "Diagnostic visit", refrigerantPerLb: "Refrigerant", repairEach: "Repair, each",
  pad: "Pad", lineCoverPerHead: "Line cover", disconnect: "Disconnect", whipKit: "Whip kit", drainKit: "Drain kit", condensatePump: "Condensate pump", surgeProtector: "Surge protector", gasFlexKit: "Gas flex kit", ventKit: "Vent kit",
};

function rateUnit(key: string): string {
  if (/Pct$/.test(key)) return "%";
  if (/PerFt$/.test(key)) return "ft";
  if (/PerLb$/.test(key)) return "lb";
  if (/PerRegister$/.test(key)) return "register";
  if (/PerRun$/.test(key)) return "run";
  if (/PerHead$/.test(key)) return "head";
  if (/Lot$/.test(key)) return "lot";
  return "each";
}

function humanize(key: string): string {
  return RATE_LABELS[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

export function hvacRateRows(card: HvacRateCard, defaults: HvacRateCard): BookRow[] {
  const rows: BookRow[] = [];
  const top: Array<keyof HvacRateCard> = ["equipmentMarkupPct", "materialsMarkupPct", "permitFee", "disposalFee", "craneFee"];
  for (const k of top) {
    const v = card[k] as number;
    rows.push({ trade: "hvac", kind: "hvac-rate", id: String(k), group: "Rate card · fees & markups", name: humanize(String(k)), specs: `typical ${defaults[k] as number}`, unit: rateUnit(String(k)), price: v, labor: null, companyDefault: v !== (defaults[k] as number), custom: false, fields: { value: v, section: "top" } });
  }
  for (const section of ["labor", "materials"] as const) {
    const group = card[section] as Record<string, number>;
    const def = defaults[section] as Record<string, number>;
    for (const k of Object.keys(group)) {
      rows.push({ trade: "hvac", kind: "hvac-rate", id: `${section}.${k}`, group: section === "labor" ? "Rate card · labor" : "Rate card · materials", name: humanize(k), specs: `typical $${def[k] ?? "—"}`, unit: rateUnit(k), price: group[k], labor: null, companyDefault: group[k] !== def[k], custom: false, fields: { value: group[k], section } });
    }
  }
  return rows;
}

/** The card with one key changed. `id` is "equipmentMarkupPct" or "labor.setCoil". */
export function hvacCardWith(card: HvacRateCard, id: string, value: number): HvacRateCard {
  const next: HvacRateCard = { ...card, labor: { ...card.labor }, materials: { ...card.materials } };
  const [section, key] = id.includes(".") ? id.split(".") : [null, id];
  if (section === "labor" || section === "materials") (next[section] as Record<string, number>)[key] = value;
  else (next as unknown as Record<string, number>)[key] = value;
  return next;
}

/* ── shared ─────────────────────────────────────────────────────────── */

/* ── DECK (2026-10-10) ─────────────────────────────────────────────── */

/** Every row of the deck estimator's price book: the example figure, or the shop's own where it typed one. */
export function deckBookRows(book: DeckRateBook): BookRow[] {
  return deckRateRows(book).map((r) => ({
    trade: "deck",
    kind: "deck-rate",
    id: r.key,
    group: DECK_RATE_GROUP_LABEL[r.group],
    name: r.label,
    specs: `example $${r.price} per ${r.unit}`,
    unit: r.unit,
    price: r.own ?? r.price,
    labor: null,
    companyDefault: r.own !== null,
    custom: false,
    fields: { value: r.own ?? r.price, example: r.price, min: r.min, max: r.max },
  }));
}

/** The deck book after one row is typed (or blanked back to the example). */
export function deckBookWith(book: DeckRateBook, key: string, value: number | null): DeckRateBook {
  const next = { ...book };
  if (value === null) delete next[key];
  else next[key] = value;
  return next;
}

export function groupRows(rows: BookRow[], order?: string[]): BookGroup[] {
  const map = new Map<string, BookRow[]>();
  for (const r of rows) map.set(r.group, [...(map.get(r.group) ?? []), r]);
  const groups = [...map.entries()].map(([label, rows]) => ({ label, rows }));
  if (order) {
    const at = (l: string) => { const i = order.indexOf(l); return i < 0 ? order.length : i; };
    groups.sort((a, b) => at(a.label) - at(b.label));
  }
  return groups;
}

export function filterRows(rows: BookRow[], q: string): BookRow[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter((r) => `${r.name} ${r.specs} ${r.group} ${r.id}`.toLowerCase().includes(s));
}

export const rowKey = (r: BookRow) => `${r.kind}:${r.id}`;

/** The schedule's running number of every row, over the whole book in the groups' order — a row keeps it under a search or a group filter. */
export function bookNumbers(rows: BookRow[], order?: string[]): Map<string, number> {
  const at = new Map<string, number>();
  let n = 0;
  for (const g of groupRows(rows, order)) for (const r of g.rows) at.set(rowKey(r), ++n);
  return at;
}

/** The groups on the sheet: the search and the group filter together (their intersection); "" is every group. */
export function shownGroups(rows: BookRow[], order: string[] | undefined, q: string, group: string): BookGroup[] {
  return groupRows(filterRows(rows, q), order).filter((g) => !group || g.label === group);
}

export const usd2 = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Who may edit the book: the estimator's own rule (actions/fenceCatalog, roofCatalog, hvacEstimator: requireEstimatorOrManager). */
export function canEditBook(role: string | null | undefined): boolean {
  return role !== "INSTALLER" && role !== "SALES";
}
