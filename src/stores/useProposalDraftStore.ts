"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { nanoid } from "nanoid";
import { sellUnitPrice } from "@/lib/pricing/markup";
import { stateTaxRate, resolveStateCode, stateFromAddress } from "@/lib/pricing/salesTax";

import type { MeasurementType } from "@/lib/prismaEnums";
export type { MeasurementType };

export interface DraftLineItem {
  id: string;
  name: string;
  description?: string;
  measurementType: MeasurementType;
  quantity: number;
  unitPrice: number;
  materialCost: number;
  laborCost: number;
  // Live-pricing product metadata, carried through edits so it isn't wiped on save.
  store?: string | null;
  productUrl?: string | null;
  imageUrl?: string | null;
  dimensions?: string | null;
}

export interface DraftInstallment {
  id: string;
  label: string;
  amount: number;
  isPercent: boolean;
  // Server-side stage state, hydrated from Installment. A PAID / WAIVED stage
  // (or one the client is paying right now) is locked: its amount and its
  // existence cannot change from the builder — saveProposal refuses too.
  status?: string;
  paidAmount?: number | null;
}

export function isLockedInstallment(i: { status?: string }): boolean {
  return i.status === "PAID" || i.status === "WAIVED" || i.status === "PENDING";
}

interface ProposalDraft {
  id?: string;
  title: string;
  clientId?: string;
  description: string;
  scopeOfWork: string;
  notes: string;
  // Job address — optional, one line. Auto-filled from the chosen client (or
  // the AI estimator's location) but freely editable; its resolved state feeds
  // the tax-rate estimate. Optional so pre-address drafts hydrate cleanly.
  address?: string;
  lineItems: DraftLineItem[];
  installments: DraftInstallment[];
  taxRate: number;
  // Set true when taxRate was last set by the address-based estimate (below),
  // false once the contractor types a value by hand. A manual entry is never
  // silently overwritten by a later client/address change. Optional so callers
  // hydrating an existing proposal (which never had this concept) don't need to
  // supply it — hydrate() always normalizes it to false regardless of input.
  taxRateAuto?: boolean;
  // Resolved USPS state code the current estimate (if auto) was computed from,
  // for display ("Estimated from Texas ·"). Null/undefined when not address-derived.
  taxRateState?: string | null;
  // Estimating engine markups (percentages 0-100)
  materialMarkupPct: number;
  laborMarkupPct: number;
  overheadPct: number;
  profitPct: number;
}

interface MarkupPatch {
  materialMarkupPct?: number;
  laborMarkupPct?: number;
  overheadPct?: number;
  profitPct?: number;
}

interface DraftStore {
  draft: ProposalDraft;
  reset: () => void;
  set: (patch: Partial<ProposalDraft>) => void;
  addLine: () => void;
  updateLine: (id: string, patch: Partial<DraftLineItem>) => void;
  removeLine: (id: string) => void;
  addInstallment: () => void;
  updateInstallment: (id: string, patch: Partial<DraftInstallment>) => void;
  removeInstallment: (id: string) => void;
  hydrate: (d: ProposalDraft) => void;
  setMarkup: (patch: MarkupPatch) => void;
  /**
   * Seed/refresh taxRate from a client's state when it's resolvable, UNLESS the
   * contractor has already typed a manual rate (taxRateAuto === false) — in
   * that case this is a no-op so their entry is never clobbered. Call this
   * whenever the builder learns a client's address (select, inline create/edit).
   */
  applyAddressTax: (state: string | null | undefined) => void;
  /**
   * Set the job address AND refresh the tax estimate from it. `stateHint`
   * carries an authoritative state when the caller knows it (a Places pick,
   * a client record); otherwise the state is parsed from the text. Tax updates
   * flow through applyAddressTax, so a manually-typed rate is never clobbered.
   */
  setAddress: (text: string, stateHint?: string | null) => void;
  computed: () => {
    subtotal: number;
    tax: number;
    total: number;
    materialCost: number;
    laborCost: number;
    grandTotal: number;
    margin: number;
  };
}

const emptyDraft = (): ProposalDraft => ({
  title: "",
  description: "",
  scopeOfWork: "",
  notes: "",
  address: "",
  lineItems: [
    {
      id: nanoid(6),
      name: "",
      measurementType: "UNIT",
      quantity: 1,
      unitPrice: 0,
      materialCost: 0,
      laborCost: 0,
    },
  ],
  installments: [
    { id: nanoid(6), label: "Deposit", amount: 30, isPercent: true },
    { id: nanoid(6), label: "Start of work", amount: 30, isPercent: true },
    { id: nanoid(6), label: "Completion", amount: 40, isPercent: true },
  ],
  taxRate: 0,
  taxRateAuto: false,
  taxRateState: null,
  // Hidden profit markup. Default 0 so a brand-new draft prices at cost exactly
  // (current behaviour); the org-wide default is seeded on top at creation
  // (ResetDraft / estimator convert). overhead/profit stay display-only for now.
  materialMarkupPct: 0,
  laborMarkupPct: 0,
  overheadPct: 0,
  profitPct: 0,
});

export const useProposalDraftStore = create<DraftStore>()(
  persist(
    immer((set, get) => ({
    draft: emptyDraft(),
    reset: () => set((s) => { s.draft = emptyDraft(); }),
    set: (patch) => set((s) => { Object.assign(s.draft, patch); }),
    addLine: () =>
      set((s) => {
        s.draft.lineItems.push({
          id: nanoid(6),
          name: "",
          measurementType: "UNIT",
          quantity: 1,
          unitPrice: 0,
          materialCost: 0,
          laborCost: 0,
        });
      }),
    updateLine: (id, patch) =>
      set((s) => {
        const l = s.draft.lineItems.find((x) => x.id === id);
        if (l) Object.assign(l, patch);
      }),
    removeLine: (id) =>
      set((s) => {
        s.draft.lineItems = s.draft.lineItems.filter((x) => x.id !== id);
      }),
    addInstallment: () =>
      set((s) => {
        s.draft.installments.push({ id: nanoid(6), label: "", amount: 0, isPercent: true });
      }),
    updateInstallment: (id, patch) =>
      set((s) => {
        const i = s.draft.installments.find((x) => x.id === id);
        if (!i) return;
        if (isLockedInstallment(i)) {
          // Only the label may change on a locked stage.
          if (patch.label !== undefined) i.label = patch.label;
          return;
        }
        Object.assign(i, patch);
      }),
    removeInstallment: (id) =>
      set((s) => {
        s.draft.installments = s.draft.installments.filter(
          (x) => x.id !== id || isLockedInstallment(x),
        );
      }),
    hydrate: (d) =>
      set((s) => {
        // Backwards-compat: hydrate from older proposals without markup fields.
        // taxRateAuto always starts false on hydrate — an existing proposal's
        // saved taxRate is never known to be address-derived, so a client
        // change on an already-saved proposal won't silently rewrite it either
        // (the contractor gets the "estimate for X" snap-back button instead).
        s.draft = {
          ...d,
          address: d.address ?? "",
          materialMarkupPct: d.materialMarkupPct ?? 0,
          laborMarkupPct: d.laborMarkupPct ?? 0,
          overheadPct: d.overheadPct ?? 0,
          profitPct: d.profitPct ?? 0,
          taxRateAuto: false,
          taxRateState: null,
        };
      }),
    setMarkup: (patch) =>
      set((s) => {
        Object.assign(s.draft, patch);
      }),
    applyAddressTax: (state) =>
      set((s) => {
        if (s.draft.taxRateAuto === false) return; // manual entry — never clobber
        const rate = stateTaxRate(state);
        if (rate === null) return; // unresolvable state — leave as-is
        s.draft.taxRate = rate;
        s.draft.taxRateAuto = true;
        s.draft.taxRateState = resolveStateCode(state);
      }),
    setAddress: (text, stateHint) => {
      set((s) => {
        s.draft.address = text;
      });
      // Authoritative state from the caller when available (Places pick,
      // client record); best-effort parse from the text otherwise.
      get().applyAddressTax(stateHint ?? stateFromAddress(text));
    },
    computed: () => {
      const d = get().draft;
      // Subtotal is the client-facing SELL price: each line's cost marked up by
      // the draft's material/labor markup %s (0 by default → equals cost).
      const rates = { materialMarkupPct: d.materialMarkupPct ?? 0, laborMarkupPct: d.laborMarkupPct ?? 0 };
      const subtotal = d.lineItems.reduce((acc, l) => acc + l.quantity * sellUnitPrice(l, rates), 0);
      const tax = subtotal * (d.taxRate ?? 0);
      const materialCost = d.lineItems.reduce((acc, l) => acc + l.quantity * l.materialCost, 0);
      const laborCost = d.lineItems.reduce((acc, l) => acc + l.quantity * l.laborCost, 0);
      const matAfter = materialCost * (1 + (d.materialMarkupPct ?? 0) / 100);
      const labAfter = laborCost * (1 + (d.laborMarkupPct ?? 0) / 100);
      const sub = matAfter + labAfter;
      const overhead = sub * ((d.overheadPct ?? 0) / 100);
      const subWithOverhead = sub + overhead;
      const profit = subWithOverhead * ((d.profitPct ?? 0) / 100);
      const grandTotal = subWithOverhead + profit;
      const baseTotal = materialCost + laborCost;
      const margin = grandTotal > 0 ? ((grandTotal - baseTotal) / grandTotal) * 100 : 0;
      return {
        subtotal,
        tax,
        total: subtotal + tax,
        materialCost,
        laborCost,
        grandTotal,
        margin,
      };
    },
    })),
    {
      // Mirror the in-progress draft to localStorage so it survives a reload
      // even before the first server autosave. Only the draft itself is persisted.
      name: "jobflex-proposal-draft",
      partialize: (s) => ({ draft: s.draft }),
      // Never auto-restore at module init: the client's first render would show
      // the PREVIOUS draft's text (totals, tax line, title) while the server
      // rendered an empty draft — a guaranteed hydration text mismatch (React
      // #418) on every builder page with a draft in localStorage. The builder
      // pages fully own initial state anyway (ResetDraft seeds /new,
      // HydrateDraft loads /proposals/[id] from the DB), so eager restore only
      // ever flashed stale data before being clobbered. Writes still mirror to
      // localStorage; an explicit restore remains available via
      // useProposalDraftStore.persist.rehydrate().
      skipHydration: true,
    },
  ),
);
