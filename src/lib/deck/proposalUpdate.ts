// THE PROPOSAL AFTER ITS DECK CHANGED (2026-10-12) — what actions/deckEstimator updateDeckProposal hands to the
// builder's own save (actions/proposals saveProposal). Pure, so scripts/qa/deck-proposal-edit.check.ts can hold the
// whole update without a database: the row is read the way the builder reads it (draftFromProposal) and written the
// way the builder writes it (payloadFromDraft) — the markups, the discount, the "show to client" switches and the
// payment stages (ids kept, so a paid one is updated in place) come through exactly as a save from the builder —
// and only the deck's own part changes (the rules: ./proposalEdit).
import { draftFromProposal, payloadFromDraft, type SaveProposalPayload } from "@/components/v3/manual-card-lab/manual-blueprint/manual-blueprint-bridge";
import { stateFromAddress, stateTaxRate } from "@/lib/pricing/salesTax";
import { deckTextAfter, keptDeckLines, type DeckWritten } from "./proposalEdit";

/** The saved proposal, as the update reads it (the columns the builder's draft is made from). */
export interface DeckProposalRow {
  id: string;
  title: string;
  clientId: string | null;
  projectId: string | null;
  description: string | null;
  scopeOfWork: string | null;
  notes: string | null;
  address: string | null;
  taxRate: number;
  materialMarkupPct: number;
  laborMarkupPct: number;
  overheadPct: number;
  profitPct: number;
  showBreakdown: boolean | null;
  showScope: boolean | null;
  showSignature: boolean | null;
  marginOnLabor: boolean | null;
  discountTotal: number;
  subtotal: number;
  discounts: { label: string; amount: number; isPercent: boolean }[];
  lineItems: {
    name: string;
    description: string | null;
    measurementType: string;
    quantity: number;
    unitPrice: number;
    materialCost: number;
    laborCost: number;
    store?: string | null;
    productUrl?: string | null;
    imageUrl?: string | null;
    dimensions?: string | null;
  }[];
  installments: { id: string; label: string; amount: number; isPercent: boolean; status: string; paidAmount: number | null }[];
}

/** The studio's side: the deck's lines as the convert sends them (lib/deck/convertSchema). */
export interface DeckUpdateInput {
  title: string;
  scope?: string;
  address?: string | null;
  lines: { name: string; description?: string; quantity: number; unit?: string; materialCost: number; laborCost: number }[];
}

type PayloadLine = SaveProposalPayload["lineItems"][number] & { store?: string | null; productUrl?: string | null; imageUrl?: string | null; dimensions?: string | null };
export type DeckUpdatePayload = Omit<SaveProposalPayload, "lineItems"> & { id: string; lineItems: PayloadLine[] };

const round2 = (n: number) => Math.round(n * 100) / 100;
/** The convert's units → the proposal's measurement types (actions/deckEstimator unitToType). */
export const deckUnitType = (unit: string | undefined): PayloadLine["measurementType"] => (unit === "sqft" ? "SQFT" : unit === "ln ft" ? "LINEAR_FT" : unit === "lot" ? "LUMP_SUM" : "UNIT");

export function deckUpdatePayload(
  row: DeckProposalRow,
  before: { written: DeckWritten | null; oldWords: string | null },
  data: DeckUpdateInput,
  org: { defaultTaxRate: number | null; materialMarkupPct: number | null; laborMarkupPct: number | null } | null,
): { payload: DeckUpdatePayload; written: DeckWritten; kept: number; titleKept: boolean; scopeKept: boolean; subtotal: number } {
  const scope = (data.scope ?? "").trim();
  const text = deckTextAfter({ title: row.title, scope: row.scopeOfWork }, before.written, { title: data.title, scope }, before.oldWords);
  const kept = keptDeckLines(row.lineItems, before.written).filter((l) => l.name.trim());
  const address = data.address?.trim() || row.address || "";
  // A job that moved to another state is taxed there, as the convert taxes it; otherwise the proposal's own rate
  // stands (it may have been typed).
  const stateNow = stateFromAddress(address);
  const movedRate = stateNow && stateNow !== stateFromAddress(row.address) ? stateTaxRate(stateNow) : null;

  const draft = draftFromProposal(
    {
      projectId: row.projectId,
      title: text.title,
      description: row.description,
      scopeOfWork: text.scope,
      notes: row.notes,
      address,
      taxRate: movedRate ?? row.taxRate,
      materialMarkupPct: row.materialMarkupPct,
      laborMarkupPct: row.laborMarkupPct,
      overheadPct: row.overheadPct,
      profitPct: row.profitPct,
      showBreakdown: row.showBreakdown,
      showScope: row.showScope,
      showSignature: row.showSignature,
      marginOnLabor: row.marginOnLabor,
      discountTotal: row.discountTotal,
      subtotal: row.subtotal,
      discounts: row.discounts.map((d) => ({ amount: d.amount, isPercent: d.isPercent })),
      lineItems: kept.map((l) => ({ name: l.name, description: l.description, measurementType: l.measurementType, quantity: l.quantity, unitPrice: l.unitPrice, materialCost: l.materialCost, laborCost: l.laborCost })),
      installments: row.installments.map((i) => ({ id: i.id, label: i.label, amount: i.amount, isPercent: i.isPercent, status: i.status, paidAmount: i.paidAmount })),
    },
    { taxPct: Math.round((org?.defaultTaxRate ?? 0) * 10000) / 100, materialMarkupPct: org?.materialMarkupPct ?? 0, laborMarkupPct: org?.laborMarkupPct ?? 0 },
  );
  // The draft leaves the client to the page's picker; the record's own client stays on it.
  draft.client = row.clientId ? { mode: "record", id: row.clientId } : { mode: "none" };
  const payload = payloadFromDraft(draft, row.id);

  // The deck's lines first, as the convert writes them (selling prices, the halves adding up to the unit price) …
  const studio: PayloadLine[] = data.lines.map((l) => {
    const unitPrice = round2(l.materialCost + l.laborCost);
    return { name: l.name.trim(), description: l.description || undefined, measurementType: deckUnitType(l.unit), quantity: l.quantity, unitPrice, materialCost: l.materialCost, laborCost: round2(unitPrice - l.materialCost) };
  });
  // … then the builder's own, with the store links its draft does not carry.
  const own: PayloadLine[] = payload.lineItems.map((l, i) => ({ ...l, store: kept[i]?.store ?? null, productUrl: kept[i]?.productUrl ?? null, imageUrl: kept[i]?.imageUrl ?? null, dimensions: kept[i]?.dimensions ?? null }));
  // The builder writes every discount as "Discount"; a member's discount keeps its own name here.
  const label = row.discounts[0]?.label;
  const discount = payload.discount && label ? { ...payload.discount, label } : payload.discount;
  return {
    payload: { ...payload, id: row.id, lineItems: [...studio, ...own], discount },
    // What the studio wrote, for the next update: its own words, even where the proposal kept the contractor's.
    written: { title: data.title, scope, lines: studio.map((l) => l.name) },
    kept: own.length,
    titleKept: text.titleKept,
    scopeKept: text.scopeKept,
    subtotal: round2(studio.reduce((a, l) => a + l.quantity * l.unitPrice, 0)),
  };
}
