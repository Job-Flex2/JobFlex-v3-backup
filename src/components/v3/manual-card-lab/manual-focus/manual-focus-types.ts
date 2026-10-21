// FOCUS CARD — shapes only. No values, no React, no imports.
//
// Route: /dashboard/manual-focus (manual proposal builder, card-lab variant).
//
// THESIS (why these shapes and not the live builder's)
// Attention is the scarce resource, not screen space. Ten cards stack down one
// column; exactly ONE of them is LIVE (full ink, controls open) and every other
// stands down to a quiet SUMMARY face that still prints its real content. So the
// draft has to be readable in two registers at once — as editable fields for the
// live card, and as a one-glance summary for the nine that are not — which is
// why every value below is a plain, summarisable scalar and nothing is hidden
// behind a component's internal state.
//
// FIXTURE-ONLY. These types never touch Prisma, a server action or the network;
// the whole page is component-local `useState` over the fixtures in
// ./manual-focus-data.ts. Ids carry an `mc_` prefix for exactly that reason.

/**
 * The ten measurement units, matching the original Job-FLEX picker.
 *
 * Was six ("SQFT | LINEAR_FT | CUBIC_FT | UNIT | HOUR | LUMP_SUM"). CUBIC_FT
 * and LUMP_SUM are gone because nothing in any fixture used them; LUMP_SUM's
 * job is now FIXED, which is what the original calls it.
 *
 * LF and LINEAR_FT are BOTH here, and both mean linear feet. That is a
 * duplicate in the original picker, carried over deliberately so the list
 * matches what the owner is used to — it is a product decision to remove, not
 * a bug to fix silently. If it goes, LF is the one to drop.
 *
 * NOT the Prisma `measurementType` enum. That is still the original six
 * (see actions/proposals.ts), so whichever line-item design wins needs a
 * mapping on the way to the database — the four new units have no column
 * value yet. Flagged here rather than discovered later.
 */
export type Unit =
  | "SQFT"
  | "LF"
  | "LINEAR_FT"
  | "SQ_BOARDS"
  | "CU_YARDS"
  | "YARDS"
  | "SQ_YARDS"
  | "UNIT"
  | "HOUR"
  | "FIXED";

/**
 * One priced line.
 *
 * `materialCost` + `laborCost` ARE the unit price — there is no third stored
 * field. A separate `unitPrice` column would be a second source of truth that
 * drifts the moment either half is edited (the live builder keeps them in sync
 * by hand in three places). The row's "Unit price" control edits the pair by
 * rescaling them around their current ratio; see `applyUnitPrice` in the math
 * module.
 *
 * `id` is stable across insert / remove / reorder. Never an array index: a
 * re-keyed neighbour unmounts the input the caret is sitting in.
 */
export type Line = {
  id: string;
  name: string;
  /** Optional. Prints under the name on the client's copy. */
  description: string;
  unit: Unit;
  /** The measure the line was stored in when the picker has no option for it ("EACH", "BUNDLE"…) — kept on save
   *  while `unit` is left as it was loaded (manual-blueprint-bridge). */
  measure?: string;
  quantity: number;
  /** $/unit before markup — the internal split, behind the row's disclosure. */
  materialCost: number;
  laborCost: number;
};

/** A client on file. Field-for-field what the live builder's inline create and
 *  edit forms round-trip, so this picker exercises the same surface. */
export type ClientRecord = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  /** Free labels — "VIP", "Repeat", "Referral". Optional on create. */
  tags: string[];
};

/** A project on file. */
export type ProjectRecord = {
  id: string;
  name: string;
  description: string;
};

/**
 * The client field's three input modes as ONE value rather than three booleans.
 * The modes are mutually exclusive, and a union makes the impossible
 * combinations (a record AND a free-text name) unrepresentable.
 *   none     — nothing chosen
 *   record   — an existing client, editable in place
 *   freeText — a plain name typed onto the sheet for someone with no record
 */
export type ClientChoice =
  | { mode: "none" }
  | { mode: "record"; id: string }
  | { mode: "freeText"; name: string };

/** One payment installment. `amount` is a percentage when `isPercent`, dollars
 *  otherwise — the same shape the live builder persists. */
export type Installment = {
  id: string;
  label: string;
  amount: number;
  isPercent: boolean;
  /** Server stage state (PAID / PENDING / WAIVED lock the row). */
  status?: string;
  paidAmount?: number | null;
};

export function isLockedInstallment(i: { status?: string }): boolean {
  return i.status === "PAID" || i.status === "WAIVED" || i.status === "PENDING";
}

/**
 * The four presentation toggles. Every one of them changes what the client's
 * copy PRINTS and none of them changes the price — see the note above
 * `laborOnly` in focus-proof.tsx for why labor-only drops columns rather than
 * re-pricing the sheet.
 */
export type ProposalOptions = {
  hideBreakdown: boolean;
  laborOnly: boolean;
  showSignature: boolean;
  showScope: boolean;
};

/** A file staged locally. Nothing is ever uploaded — there is no endpoint. */
export type StagedFile = {
  id: string;
  name: string;
  size: number;
  kind: string;
};

/**
 * Everything the sheet holds. One object rather than twenty `useState`s: the
 * summary faces, the running total and the save chip all read the WHOLE draft
 * at once, and nine of the ten cards are rendering a derived summary of it on
 * every keystroke.
 */
export type Draft = {
  title: string;
  description: string;
  projectId: string;
  client: ClientChoice;

  /** One line, optional. Auto-fills from the client and drives the tax
   *  estimate, but stays freely editable — see `addressAuto`. */
  address: string;
  /** False once the address has been hand-edited, so choosing a different
   *  client never silently overwrites what was typed. */
  addressAuto: boolean;

  lines: Line[];

  /** A percentage as typed — 8.25 means 8.25%. */
  taxPct: number;
  /** True while the rate is still the address estimate. Set false forever the
   *  moment the field is typed in, which is what stops a later address change
   *  from silently rewriting a hand-entered rate. */
  taxAuto: boolean;
  /** Two-letter code the current estimate came from, or "" when none did. */
  taxState: string;

  /** The four markup controls. Percentages, not fractions. */
  materialMarkupPct: number;
  laborMarkupPct: number;
  overheadPct: number;
  profitPct: number;
  /**
   * Where overhead and profit land on the client's copy when a line's labor
   * and material halves are shown (owner, 2026-09-17). They are ALWAYS inside
   * the line prices — never a row of their own — but the breakdown can carry
   * them across both halves (false, the default) or put them all in labor so
   * the material half reads at its cost (true). Optional so the sibling
   * card-lab routes are untouched.
   */
  marginOnLabor?: boolean;

  /**
   * A percentage off, applied to the pre-tax figure.
   *
   * It reduces the TAXABLE amount, so tax is charged on what the client
   * actually owes rather than on a number nobody pays. Placing it the other way
   * round — tax first, then discount — overstates the tax line and is the kind
   * of error a client notices on the printed sheet.
   */
  discountPct: number;

  /**
   * A FLAT DOLLAR discount, used instead of `discountPct` when
   * `discountIsPercent` is false.
   *
   * ── WHY TWO FIELDS AND NOT ONE ───────────────────────────────
   * The obvious shape is one `discountValue` plus a mode flag, and it is wrong
   * here for a reason that shows up the first time anyone uses the control:
   * with a single field, flipping Percent -> Dollar reinterprets "10" as $10,
   * and flipping back reinterprets "500" as 500%. The number the user typed
   * silently becomes a different fact. Two fields let each mode keep its own
   * value, so the toggle is genuinely a toggle — switch to dollars, type $500,
   * switch back, and the 10% you had is still 10%.
   *
   * The cost is that only one of the two is live at a time, which is exactly
   * what `discountIsPercent` says.
   */
  discountFlat?: number;

  /**
   * Which discount field is live. OPTIONAL and TREATED AS TRUE when absent, so
   * every existing draft and every consumer that predates the dollar mode
   * (notably /dashboard/manual-focus, which shares this type) keeps its
   * percentage behaviour with no change at all.
   */
  discountIsPercent?: boolean;

  scopeOfWork: string;
  notes: string;
  terms: string;

  options: ProposalOptions;
  installments: Installment[];
  files: StagedFile[];
};

/** One printed line on the client's copy, already priced and already rounded. */
export type PrintedLine = {
  id: string;
  name: string;
  description: string;
  unit: Unit;
  quantity: number;
  /** Sell price per unit — cost plus its two markups, overhead and profit. */
  unitPrice: number;
  /** quantity x unitPrice, adjusted so the column sums to the subtotal exactly. */
  amount: number;
  /** The client-facing split of `amount` — material and labor each carrying
   *  their markup, overhead and profit, labor as the remainder so the two add
   *  up to the amount to the cent. What "Labor + material breakdown" prints. */
  materialAmount: number;
  laborAmount: number;
  /** Raw internal split, for the "cost breakdown" annotation. */
  materialCost: number;
  laborCost: number;
};

/**
 * Every figure the page prints. Computed, never stored — the sticky strip, the
 * ledger, the coverage meter and the client's copy all read from here, so there
 * is exactly one number and no two of them can ever disagree.
 */
export type Totals = {
  /** Raw cost before any markup. */
  baseMaterials: number;
  baseLabor: number;
  baseTotal: number;

  /** What each line-level markup ADDS. The marked-up halves themselves are not
   *  carried: the ledger prints the two added figures, never the two totals. */
  materialsMarkup: number;
  laborMarkup: number;

  /** Sum of the marked-up line prices — the ledger's "Subtotal" row. */
  subtotalCosts: number;
  overheadAmount: number;
  subtotalWithOverhead: number;
  profitAmount: number;

  /** The ledger's "Grand total" AND the client's copy's "Subtotal" — one figure
   *  printed in two places, and it is the SUM OF THE PRINTED LINES. */
  preTax: number;
  /** What `discountPct` is worth against `preTax`. 0 when there is no discount. */
  discountAmount: number;
  /** `preTax - discountAmount` — the figure tax is actually charged on. */
  taxable: number;
  tax: number;
  /** Grand total with tax — the number in the sticky strip. */
  total: number;

  /** (preTax - baseTotal) / preTax, as a percentage. */
  margin: number;

  /** Named lines only, priced. Their amounts ARE `preTax`. */
  printed: PrintedLine[];
  /** How many lines are still unnamed, and therefore not counted or printed. */
  unnamedCount: number;
};

/** How a card's summary face is drawn: a mono label, a dashed leader, a value.
 *  `tone` marks the values that are a genuine STATUS rather than data — and it
 *  carries the SAME three steps the live cards use (amber / green / red), so a
 *  card's two faces can never grade the same fact differently. */
export type SummaryRow = {
  label: string;
  value: string;
  /** Money and percentages set tabular numerals; prose does not. */
  numeric?: boolean;
  tone?: "warn" | "ok" | "err";
};

/** One card in the column. `head` is identical in both states by design — only
 *  the face BELOW it swaps — which is what keeps the head from moving when a
 *  card is promoted. */
export type CardSpec = {
  /** "01" ... "10" — the drawing-annotation numeral, the column's order device. */
  num: string;
  /** Anchor id, used by scroll-margin and the promote hook's measurement. */
  id: string;
  title: string;
  /** The one quiet line that teaches the card, shown only while it is live. */
  teach: string;
  /** The card's headline figure, printed in the head in BOTH states. */
  chip: string;
  /** The stood-down face: real content, never just the card's own name. */
  summary: SummaryRow[];
};
