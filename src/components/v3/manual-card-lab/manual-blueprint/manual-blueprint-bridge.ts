// MANUAL PROPOSAL / BLUEPRINT — the data bridge.
//
// Route: /dashboard/manual-blueprint.
//
// The one place the builder's `Draft` and the database's `Proposal` are
// translated into each other. It is a separate module, and pure, for two
// reasons: the server loader (manual-blueprint-load.ts) and the client column
// (manual-blueprint-content.tsx) BOTH need the mapping, and a translation that
// lives inside a component is a translation that gets quietly duplicated the
// first time a second caller needs half of it.
//
// ── WHAT ROUND-TRIPS AND WHAT DOES NOT ──────────────────────────────
// Persisted through `saveProposal`: title, client, description (Overview),
// scope of work, internal notes, job address, tax rate, the four markup rates,
// the discount, every named line item and the payment schedule.
//
// The PROJECT pick is persisted since 2026-09-18 (Proposal.projectId).
//
// NOT persisted, because the Proposal table has no column for it and this pass
// adds no schema: the TERMS text, the four "what prints"
// toggles and the staged FILES. Those four controls stay live on the page and
// are re-read from the draft on every keystroke; they simply do not survive a
// reload. Flagged here rather than hidden, and each of the four cards says so.
//
// ── THE UNIT MAP IS LOSSY, ON PURPOSE ───────────────────────────────
// The builder's picker carries the original Job-FLEX list of ten units;
// `LineItem.measurementType` carries the six the schema has always had. Four of
// the ten have no column value, so they land on their nearest neighbour and the
// reverse map cannot tell them apart afterwards:
//     LF, YARDS        → LINEAR_FT   (reopens as "linear ft")
//     SQ_YARDS         → SQFT        (reopens as "sqft")
//     SQ_BOARDS        → UNIT        (reopens as "unit")
//     CU_YARDS         → CUBIC_FT    (reopens as "cu yards" — exact)
// The alternative was inventing a column, which is schema work this pass is not
// allowed to do. The PRICE is unaffected either way: quantity and the
// material/labor split are stored exactly, and the unit is a label on them.

import type {
  ClientRecord,
  Draft,
  Line,
  ProjectRecord,
  Unit,
} from "../manual-focus/manual-focus-types";
import { estimateFromAddress } from "../manual-focus/manual-focus-data";
import { computeTotals, newId, round2 } from "../manual-focus/manual-focus-math";
import type { ContractCo } from "@/lib/contractTotal";

/** The six values `LineItem.measurementType` is allowed to hold — the literal
 *  union `saveProposal`'s zod schema parses. */
export type MeasurementType =
  | "SQFT"
  | "LINEAR_FT"
  | "CUBIC_FT"
  | "UNIT"
  | "HOUR"
  | "LUMP_SUM"
  | "SQUARE";

const MEASUREMENT_OF: Record<Unit, MeasurementType> = {
  SQFT: "SQFT",
  LF: "LINEAR_FT",
  LINEAR_FT: "LINEAR_FT",
  SQ_BOARDS: "UNIT",
  CU_YARDS: "CUBIC_FT",
  YARDS: "LINEAR_FT",
  SQ_YARDS: "SQFT",
  UNIT: "UNIT",
  HOUR: "HOUR",
  FIXED: "LUMP_SUM",
};

const UNIT_OF: Record<MeasurementType, Unit> = {
  SQFT: "SQFT",
  LINEAR_FT: "LINEAR_FT",
  CUBIC_FT: "CU_YARDS",
  UNIT: "UNIT",
  HOUR: "HOUR",
  LUMP_SUM: "FIXED",
  SQUARE: "UNIT",
};

export function measurementOf(unit: Unit): MeasurementType {
  return MEASUREMENT_OF[unit] ?? "UNIT";
}

export function unitOf(measurement: string): Unit {
  return UNIT_OF[measurement as MeasurementType] ?? "UNIT";
}

/* ============================================================
   THE SHAPES THAT CROSS THE SERVER BOUNDARY
   Plain scalars only — these are props on a client component, so
   nothing here may be a Date, a Decimal or a Prisma model.
   ============================================================ */

// The client and project rows travel in the shapes the two pickers already
// take (`ClientRecord`, `ProjectRecord`), so the loader is the only thing that
// changed underneath them — the picker components are untouched by the move
// from fixtures to rows. Nullable columns are collapsed to "" on the server;
// the pickers were written against a fixture where every field was a string.
export type ManualClient = ClientRecord;
export type ManualProject = ProjectRecord;

/**
 * The four facts printed on the client's copy and on every page of the PDF —
 * who is sending it, under what reference, on what date, and how long the offer
 * stands. They used to be four hard-coded fixtures in manual-focus-data
 * ("Northgate Roofing & Exteriors", "MC-2041"); they are now the org's own row
 * and the proposal's own publicId.
 *
 * FORMATTED ON THE SERVER, and travelling as strings, for the reason the
 * fixture's own header gave: a `new Date()` read during render is formatted
 * once per environment and the first disagreement is a hydration mismatch.
 */
export type SheetIdentity = {
  orgName: string;
  /** The org's second line — address and phone, whichever exist. "" is a legal
   *  value and prints nothing, rather than a placeholder nobody set. */
  orgLine: string;
  /** "PRO-4C1B" once saved; "DRAFT" before the first write. */
  ref: string;
  /** ISO date the proposal carries — its createdAt, or today for a new one. */
  date: string;
  /** ISO date the offer stops standing. */
  validUntil: string;
};

/** The reference a client would ever be asked to quote — the same "PRO-XXXX"
 *  spelling the client record's proposal ledger prints. */
export function proposalRef(publicId: string): string {
  return `PRO-${publicId.slice(-4).toUpperCase()}`;
}

/** The masthead / sheet reference for a proposal that has not been saved yet.
 *  A word, not a fake number: "MC-2041" on an unsaved sheet is a filing code
 *  for a record that does not exist. */
export const UNSAVED_REF = "DRAFT";

/** The org's saved defaults, seeded into a brand-new draft. */
export type ManualDefaults = {
  /** A PERCENTAGE (8.25), not the fraction the column stores. */
  taxPct: number;
  materialMarkupPct: number;
  laborMarkupPct: number;
};

/** One proposal, already flattened for the builder. */
export type CrewMediaItem = {
  id: string;
  url: string;
  /** "Before" / "Progress" / "After". */
  kind: string;
  media: "photo" | "video";
  /** "Sep 27" */
  when: string;
  by: string | null;
  jobId: string;
};

export type ManualProposal = {
  /** The proposal carries a fence traced on the map (a FENCE_PLAN row): the
   *  drawing card shows it in 3D and on the lot (2026-09-27). */
  fenceDrawing?: boolean;
  /** A deck from the Deck Studio is kept with it (DECK_PLAN, 2026-10-04). */
  deckDrawing?: boolean;
  /** This member may open that deck in the studio and update the proposal from it (2026-10-12). */
  deckEditable?: boolean;
  /** `Proposal.trade` — "roof", "fence", "hvac", "deck"… or null for a builder proposal. */
  trade?: string | null;
  /** What kind of job and which tool made it (2026-10-17, lib/proposalKind) — the page's heading says it. */
  kind?: import("@/lib/proposalKind").ProposalKind;
  /** A roof proposal this member may open again in the roof estimator and update from there (2026-10-13). */
  roofEditable?: boolean;
  /** The client's design link on this proposal (2026-10-13): one line on where it stands, Open when it came back. */
  clientDesign?: { line: string; standing: string; draftId: string | null; unseen: boolean } | null;
  /** Made by an estimator (fence, roof, HVAC — `Proposal.trade`): its lines
   *  carry the estimator's INSTALLED prices, profit already inside, with no
   *  cost of the contractor's under them — so there is no margin to grade
   *  (2026-10-01). */
  priceOnly?: boolean;
  /** Photos and videos the crew shot on the proposal's job (2026-09-27):
   *  the Files card lists them under "From the crew". */
  media?: CrewMediaItem[];
  id: string;
  publicId: string;
  /** "PRO-4C1B" — the reference a client would ever be asked to quote. */
  ref: string;
  status: string;
  clientId: string | null;
  draft: Draft;
  /** The APPROVED change orders on this proposal, in the shape
   *  lib/contractTotal takes. They are NOT draft state — nothing here edits or
   *  saves them; they are what the schedule is measured against, because an
   *  approved change order raises the contract and brings its own stage.
   *  Empty for a new proposal and for one that has none. */
  changeOrders: ContractCo[];
};

/* ============================================================
   EMPTY → DRAFT
   ============================================================ */

/** One blank priced row, so card 03 opens as a table with a row in it rather
 *  than as a bare "Add line" button. It has no name, so it is excluded from
 *  every figure on the page and is never persisted. */
export function blankLine(): Line {
  return {
    id: newId("ln"),
    name: "",
    description: "",
    unit: "UNIT",
    quantity: 1,
    materialCost: 0,
    laborCost: 0,
  };
}

/**
 * A brand-new proposal.
 *
 * EMPTY, except for the two things that are org policy rather than content: the
 * markup rates and the tax rate. `taxAuto` is true only when the org has NOT
 * set a default rate — an org-configured rate is a deliberate decision and a
 * later address must not silently rewrite it.
 */
export function emptyDraft(defaults: ManualDefaults): Draft {
  return {
    title: "",
    description: "",
    projectId: "",
    client: { mode: "none" },

    address: "",
    addressAuto: true,

    lines: [blankLine()],

    taxPct: defaults.taxPct,
    taxAuto: defaults.taxPct === 0,
    taxState: "",

    // The two cost adjustments open at NEUTRAL (owner, 2026-09-05): they are a
    // tool applied to this sheet, not a standing rate, and are baked into the
    // lines on save. The org's default markup no longer seeds them.
    materialMarkupPct: 0,
    laborMarkupPct: 0,
    overheadPct: 0,
    profitPct: 0,
    marginOnLabor: false,

    discountPct: 0,
    discountFlat: 0,
    discountIsPercent: true,

    scopeOfWork: "",
    notes: "",
    terms: "",

    options: {
      hideBreakdown: false,
      laborOnly: false,
      showSignature: true,
      showScope: true,
    },
    installments: [],
    files: [],
  };
}

/* ============================================================
   DRAFT → THE saveProposal PAYLOAD
   ============================================================ */

export type SaveProposalPayload = {
  id?: string;
  title: string;
  projectId?: string | null;
  clientId: string | null;
  description: string;
  scopeOfWork: string;
  notes: string;
  address: string;
  taxRate: number;
  lineItems: {
    name: string;
    description?: string;
    measurementType: MeasurementType;
    quantity: number;
    unitPrice: number;
    materialCost: number;
    laborCost: number;
  }[];
  installments: { id?: string; label: string; amount: number; isPercent: boolean }[];
  materialMarkupPct: number;
  laborMarkupPct: number;
  overheadPct: number;
  profitPct: number;
  discount: { label: string; amount: number; isPercent: boolean } | null;
  /** "Show to client" — saved with the row so the portal and the PDF print what card 06 says. */
  showBreakdown: boolean;
  showScope: boolean;
  showSignature: boolean;
  marginOnLabor: boolean;
};

/** The client id to file the proposal against, or null.
 *
 *  A free-text name has NO record, so it files against nobody — which is what
 *  `Proposal.clientId` being nullable is for. The typed name still reaches the
 *  document through the title and the printed sheet; inventing a Client row for
 *  it would put a person in the CRM the contractor never asked to add. */
export function clientIdOf(draft: Draft): string | null {
  return draft.client.mode === "record" ? draft.client.id : null;
}

/** Named lines only. An untitled row is not work yet — it counts for nothing on
 *  the page, and `saveProposal` rejects a nameless line outright. */
export function payloadFromDraft(draft: Draft, id?: string): SaveProposalPayload {
  const named = draft.lines.filter((l) => l.name.trim().length > 0);
  const usingPercent = draft.discountIsPercent !== false;
  const discountAmount = usingPercent ? draft.discountPct : (draft.discountFlat ?? 0);

  return {
    id,
    title: draft.title.trim(),
    clientId: clientIdOf(draft),
    projectId: draft.projectId || null,
    description: draft.description,
    scopeOfWork: draft.scopeOfWork,
    notes: draft.notes,
    address: draft.address,
    // The column is a FRACTION (0.0825); the builder's field is a percentage.
    // Clamped because the column's schema caps at 1 and a fat-fingered "825"
    // should fail as a rate, not as a server error.
    taxRate: Math.min(Math.max(draft.taxPct / 100, 0), 1),
    lineItems: named.map((l) => ({
      name: l.name.trim(),
      description: l.description || undefined,
      measurementType: measurementOf(l.unit),
      quantity: l.quantity,
      // The RAW per-unit cost. saveProposal applies the markup itself
      // (sellUnitPrice) and stores the sell price on top of these two, so
      // sending a marked-up figure here would apply the markup twice.
      unitPrice: round2(l.materialCost + l.laborCost),
      materialCost: l.materialCost,
      laborCost: l.laborCost,
    })),
    installments: draft.installments.map((i) => ({
      id: i.id,
      label: i.label.trim() || "Payment",
      amount: i.amount,
      isPercent: i.isPercent,
    })),
    materialMarkupPct: draft.materialMarkupPct,
    laborMarkupPct: draft.laborMarkupPct,
    overheadPct: draft.overheadPct,
    profitPct: draft.profitPct,
    discount:
      discountAmount > 0
        ? { label: "Discount", amount: discountAmount, isPercent: usingPercent }
        : null,
    showBreakdown: !draft.options.hideBreakdown,
    showScope: draft.options.showScope,
    showSignature: draft.options.showSignature,
    marginOnLabor: draft.marginOnLabor === true,
  };
}

/** What the page refuses to send, and why — one message, shown in the masthead
 *  chip rather than in a dialog. Mirrors `saveProposal`'s own zod schema so the
 *  user is stopped by the page, not by a server error. */
export function whyNotSavable(draft: Draft): string | null {
  if (!draft.title.trim()) return "Add a title before saving";
  const totals = computeTotals(draft);
  if (totals.printed.length === 0) return "Add at least one named line item";
  return null;
}

/* ============================================================
   PROPOSAL → DRAFT
   ============================================================ */

export type ProposalRowForDraft = {
  projectId?: string | null;
  title: string;
  description: string | null;
  scopeOfWork: string | null;
  notes: string | null;
  address: string | null;
  taxRate: number;
  materialMarkupPct: number;
  laborMarkupPct: number;
  overheadPct: number;
  profitPct: number;
  /** Absent on a row read by an older loader: the editor's defaults apply. */
  showBreakdown?: boolean | null;
  showScope?: boolean | null;
  showSignature?: boolean | null;
  marginOnLabor?: boolean | null;
  discountTotal: number;
  subtotal: number;
  discounts: { amount: number; isPercent: boolean }[];
  lineItems: {
    name: string;
    description: string | null;
    measurementType: string;
    quantity: number;
    unitPrice: number;
    materialCost: number;
    laborCost: number;
  }[];
  installments: {
    id?: string;
    label: string;
    amount: number;
    isPercent: boolean;
    status?: string;
    paidAmount?: number | null;
  }[];
};

/**
 * Rebuild the builder's draft from a saved row.
 *
 * The material/labor split is stored RAW, so most lines reconstruct exactly.
 * The one line that cannot is a row written by another surface with no split at
 * all (the estimator's unsplit lines, and anything imported before the split
 * existed): its `unitPrice` is already a SELL price, so the markup is divided
 * back out before the figure lands in `materialCost`. That is what makes
 * reopening such a proposal print the same prices it was saved with instead of
 * marking it up a second time.
 */
export function draftFromProposal(row: ProposalRowForDraft, defaults: ManualDefaults): Draft {
  const materialMarkupPct = row.materialMarkupPct ?? 0;
  // A stored unitPrice carries the markup AND the overhead/profit load
  // (actions/proposals prices every line the way the sheet prints it), so an
  // unsplit line reads its raw cost back through both.
  const load = (1 + (row.overheadPct ?? 0) / 100) * (1 + (row.profitPct ?? 0) / 100);
  const address = row.address ?? "";
  const stored = row.discounts[0] ?? null;
  const discount =
    stored ??
    // No Discount row but a non-zero total — the figure is a flat dollar amount.
    (row.discountTotal > 0 ? { amount: row.discountTotal, isPercent: false } : null);

  return {
    title: row.title,
    description: row.description ?? "",
    projectId: row.projectId ?? "",
    client: { mode: "none" },

    address,
    // A saved address is the record's own, never "auto from the client" — a
    // later client change must not rewrite what was already filed.
    addressAuto: false,

    lines:
      row.lineItems.length > 0
        ? row.lineItems.map((l) => {
            const raw = (l.materialCost ?? 0) + (l.laborCost ?? 0);
            const unsplit =
              raw <= 0 && l.unitPrice > 0
                ? round2(l.unitPrice / (1 + materialMarkupPct / 100) / load)
                : 0;
            return {
              id: newId("ln"),
              name: l.name,
              description: l.description ?? "",
              unit: unitOf(l.measurementType),
              quantity: l.quantity,
              materialCost: raw > 0 ? l.materialCost : unsplit,
              laborCost: raw > 0 ? l.laborCost : 0,
            };
          })
        : [blankLine()],

    // A row with no rate of its own falls back to the org's default.
    taxPct: row.taxRate == null ? defaults.taxPct : round2(row.taxRate * 100),
    taxAuto: false,
    taxState: estimateFromAddress(address)?.code ?? "",

    materialMarkupPct,
    laborMarkupPct: row.laborMarkupPct ?? 0,
    overheadPct: row.overheadPct ?? 0,
    profitPct: row.profitPct ?? 0,
    marginOnLabor: row.marginOnLabor === true,

    discountPct: discount?.isPercent ? discount.amount : 0,
    discountFlat: discount && !discount.isPercent ? discount.amount : 0,
    discountIsPercent: discount ? discount.isPercent : true,

    scopeOfWork: row.scopeOfWork ?? "",
    notes: row.notes ?? "",
    terms: "",

    options: {
      hideBreakdown: row.showBreakdown === false,
      laborOnly: false,
      showSignature: row.showSignature ?? true,
      showScope: row.showScope ?? true,
    },
    installments: row.installments.map((i) => ({
      // Keep the DB id: a paid stage must be updated in place, never recreated.
      id: i.id ?? newId("in"),
      label: i.label,
      amount: i.amount,
      isPercent: i.isPercent,
      status: i.status,
      paidAmount: i.paidAmount,
    })),
    files: [],
  };
}

/** The record's address as the one line the sheet and the tax estimator both
 *  read. Kept as a single string on purpose — see the note in bp-pickers. */
export function addressOf(rec: {
  address: string;
  city: string;
  state: string;
  zip: string;
}): string {
  const tail = [rec.city, [rec.state, rec.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [rec.address, tail].filter(Boolean).join(", ");
}
