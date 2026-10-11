// THE ORDER OF "ALL SUBSCRIPTIONS" (owner, 2026-10-11) — client-side only.
//
// Sorting rearranges the rows the filters left; it never adds, drops or
// re-reads one, so the counts and the MRR strip above the table stay what the
// filters made them. No sort = the order the server handed over (Stripe's
// list order, newest subscription first, then the platform-record rows Stripe
// did not return).
//
// The state lives in the address (?sort=renews&dir=asc): it survives a reload
// and a link carries it. The column headers and the "Sort by" list read and
// write the same pair.

export type SortKey =
  | "subscriber"
  | "plan"
  | "monthly"
  | "status"
  | "card"
  | "promo"
  | "renews"
  | "created";
export type SortDir = "asc" | "desc";
export type SortState = { key: SortKey; dir: SortDir } | null;

/** The fields the comparators read — a SubscriberRowDTO satisfies it. */
export interface SortableRow {
  orgName: string;
  plan: string;
  planName: string;
  comped: boolean;
  amountCents: number;
  status: string;
  card: { kind: "card" | "other" | "none"; brand: string | null; last4: string | null } | null;
  promoCode: string | null;
  currentPeriodEnd: string | null;
  createdAt: string;
}

const KEYS: readonly SortKey[] = ["subscriber", "plan", "monthly", "status", "card", "promo", "renews", "created"];

/** The column headers that sort, in table order. `created` has no column. */
export const COLUMN_LABEL: Record<SortKey, string> = {
  subscriber: "Subscriber",
  plan: "Plan",
  monthly: "Monthly",
  status: "Status",
  card: "Card",
  promo: "Promo",
  renews: "Renews",
  created: "Signed up",
};

/** The "Sort by" list. "" is the server's own order. */
export const SORT_PRESETS: readonly { value: string; label: string; state: SortState }[] = [
  { value: "", label: "Sort by: Default", state: null },
  { value: "newest", label: "Newest signups", state: { key: "created", dir: "desc" } },
  { value: "oldest", label: "Oldest signups", state: { key: "created", dir: "asc" } },
  { value: "renews", label: "Renews soonest", state: { key: "renews", dir: "asc" } },
  { value: "monthly", label: "Monthly high to low", state: { key: "monthly", dir: "desc" } },
  { value: "name", label: "Name A–Z", state: { key: "subscriber", dir: "asc" } },
];

/** The preset a state is, or null when only a header click produced it. */
export function presetOf(state: SortState): string | null {
  const hit = SORT_PRESETS.find((p) =>
    p.state === null ? state === null : state !== null && p.state.key === state.key && p.state.dir === state.dir,
  );
  return hit ? hit.value : null;
}

export function readSort(params: { get(name: string): string | null }): SortState {
  const key = params.get("sort") as SortKey | null;
  if (!key || !KEYS.includes(key)) return null;
  return { key, dir: params.get("dir") === "desc" ? "desc" : "asc" };
}

/** Header click: ascending → descending → back to the default order. */
export function nextSort(state: SortState, key: SortKey): SortState {
  if (!state || state.key !== key) return { key, dir: "asc" };
  return state.dir === "asc" ? { key, dir: "desc" } : null;
}

const text = new Intl.Collator("en", { sensitivity: "base", numeric: true });

// Plan: the catalog's tiers in the order they are sold, an unknown slug after
// them, and every admin grant after all of those (each grant by its tier).
const TIER_RANK: Record<string, number> = { FREE: 0, STARTER: 1, PROFESSIONAL: 2, ENTERPRISE: 3, CUSTOM: 4 };
const planRank = (r: SortableRow) => (r.comped ? 10 : 0) + (TIER_RANK[r.plan.toUpperCase()] ?? 5);

// Status: by meaning, not by letter. Anything else follows, by name.
const STATUS_RANK: Record<string, number> = { ACTIVE: 0, TRIALING: 1, PAST_DUE: 2, UNPAID: 3, INCOMPLETE: 4 };
const statusRank = (s: string) => STATUS_RANK[s] ?? 5;

// Card: a card, then another way to pay, then "No card". Unknown (Stripe was
// not read) is missing data and stays last either way.
const CARD_RANK = { card: 0, other: 1, none: 2 } as const;

const time = (iso: string) => Date.parse(iso);

/** A row with nothing to sort by on this key goes last in BOTH directions. */
function missing(r: SortableRow, key: SortKey): boolean {
  if (key === "renews") return !r.currentPeriodEnd;
  if (key === "promo") return !r.promoCode;
  if (key === "card") return r.card === null;
  return false;
}

/** Ascending comparison of two rows that both have a value for `key`. */
function compare(a: SortableRow, b: SortableRow, key: SortKey): number {
  switch (key) {
    case "subscriber":
      return text.compare(a.orgName, b.orgName);
    case "plan":
      return planRank(a) - planRank(b) || text.compare(a.planName, b.planName);
    case "monthly":
      return a.amountCents - b.amountCents;
    case "status":
      return statusRank(a.status) - statusRank(b.status) || text.compare(a.status, b.status);
    case "card": {
      const ca = a.card!;
      const cb = b.card!;
      return (
        CARD_RANK[ca.kind] - CARD_RANK[cb.kind] ||
        text.compare(ca.brand ?? "", cb.brand ?? "") ||
        text.compare(ca.last4 ?? "", cb.last4 ?? "")
      );
    }
    case "promo":
      return text.compare(a.promoCode!, b.promoCode!);
    case "renews":
      return time(a.currentPeriodEnd!) - time(b.currentPeriodEnd!);
    case "created":
      return time(a.createdAt) - time(b.createdAt);
  }
}

/**
 * The rows in the chosen order — a new array; `rows` is never touched. A tie
 * falls to the organization's name (A–Z in both directions) so equal rows do
 * not jump around, and the sort is stable past that.
 */
export function sortRows<T extends SortableRow>(rows: readonly T[], state: SortState): T[] {
  if (!state) return rows as T[];
  const { key, dir } = state;
  const sign = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const ma = missing(a, key);
    const mb = missing(b, key);
    if (ma !== mb) return ma ? 1 : -1;
    const c = ma ? 0 : sign * compare(a, b, key);
    return c || text.compare(a.orgName, b.orgName);
  });
}
