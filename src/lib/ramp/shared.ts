// RAMP CARDS ON JOBFLEX — the pure part (owner, 2026-10-29: "build it for JobFlex, make it smart, same as
// ServiceTitan"). Every swipe on a contractor's Ramp card lands on the job it was for, with the receipt, the
// moment it happens: the tech is asked the job (Ramp's own prompt through our "JobFlex job" field, or a text from
// the company's line), the expense is written on the job's ledger, and the office sees margin while the job runs.
//
// No I/O here: what a Ramp transaction says, which JobFlex job it names, the category it maps to, the text that asks
// the tech, the reply that answers it. qa/tests/logic/ramp.check.ts proves every rule.

/** The custom accounting field JobFlex keeps in the contractor's Ramp: its own id, so the same field is found again. */
export const RAMP_FIELD_ID = "jobflex_job";
export const RAMP_FIELD_NAME = "JobFlex job";
/** Options for a job that is neither a job nor nothing: the warehouse. */
export const RAMP_STOCK_OPTION_ID = "jobflex_stock";
export const RAMP_STOCK_OPTION_VALUE = "Stock / warehouse (no job)";
/** How long a "which job?" text waits for its answer. */
export const ASK_TTL_MS = 48 * 60 * 60_000;
/** Jobs offered in a text: the newest open ones. */
export const ASK_MAX_OPTIONS = 6;

/** A Ramp transaction, the fields JobFlex reads (the API's names). */
export interface RampTransaction {
  id: string;
  state?: string | null;
  amount?: number | null;
  entity_amount?: { value: number; currency?: string } | null;
  currency_code?: string | null;
  merchant_name?: string | null;
  merchant_descriptor?: string | null;
  merchant_category_code_description?: string | null;
  sk_category_name?: string | null;
  sk_category_id?: string | null;
  user_transaction_time?: string | null;
  settlement_date?: string | null;
  memo?: string | null;
  receipts?: string[] | null;
  card_holder?: { user_id?: string; first_name?: string; last_name?: string } | null;
  card_id?: string | null;
  accounting_field_selections?: Array<{
    id?: string;
    external_id?: string;
    name?: string;
    display_name?: string | null;
    type?: string;
    category_info?: { id?: string; external_id?: string; name?: string; type?: string };
  }> | null;
  synced_at?: string | null;
}

export type RampTxState = "cleared" | "pending" | "declined" | "other";
export function rampTxState(tx: Pick<RampTransaction, "state">): RampTxState {
  const s = (tx.state ?? "").toUpperCase();
  if (s === "CLEARED") return "cleared";
  if (s === "PENDING") return "pending";
  if (s === "DECLINED") return "declined";
  return s ? "other" : "pending";
}

/** The dollars, signed (a refund is negative): the settlement amount, else the deprecated one. */
export function rampAmount(tx: Pick<RampTransaction, "amount" | "entity_amount">): number {
  const v = tx.entity_amount && typeof tx.entity_amount.value === "number" ? tx.entity_amount.value : typeof tx.amount === "number" ? tx.amount : 0;
  return Math.round(v * 100) / 100;
}

export function rampMerchant(tx: Pick<RampTransaction, "merchant_name" | "merchant_descriptor">): string {
  return (tx.merchant_name || tx.merchant_descriptor || "a merchant").trim().slice(0, 120);
}

export function rampCardholderName(tx: Pick<RampTransaction, "card_holder">): string {
  const h = tx.card_holder;
  return [h?.first_name, h?.last_name].filter(Boolean).join(" ").trim();
}

export function rampSpentAt(tx: Pick<RampTransaction, "user_transaction_time" | "settlement_date">): Date | null {
  const t = Date.parse(tx.user_transaction_time ?? tx.settlement_date ?? "");
  return Number.isFinite(t) ? new Date(t) : null;
}

/**
 * The JobFlex job a transaction is tagged with: the option of our field (its external id is the job's id), or
 * "stock" for the warehouse option, or null. A memo "JobFlex: <id>" written by us counts too.
 */
export function rampJobTag(tx: Pick<RampTransaction, "accounting_field_selections" | "memo">, fieldRampId: string | null): { kind: "job"; jobId: string } | { kind: "stock" } | null {
  for (const s of tx.accounting_field_selections ?? []) {
    const ours = (fieldRampId && s.category_info?.id === fieldRampId) || s.category_info?.external_id === RAMP_FIELD_ID || s.category_info?.name === RAMP_FIELD_NAME;
    if (!ours) continue;
    const ext = (s.external_id ?? "").trim();
    if (ext === RAMP_STOCK_OPTION_ID) return { kind: "stock" };
    if (ext) return { kind: "job", jobId: ext };
  }
  const m = /JobFlex:\s*(stock|[A-Za-z0-9_-]{8,40})\b/i.exec(tx.memo ?? "");
  if (m) return m[1].toLowerCase() === "stock" ? { kind: "stock" } : { kind: "job", jobId: m[1] };
  return null;
}

/** The expense category JobFlex books, from Ramp's category and the merchant. */
export function rampCategory(tx: Pick<RampTransaction, "sk_category_name" | "merchant_category_code_description" | "merchant_name">): string {
  const words = `${tx.sk_category_name ?? ""} ${tx.merchant_category_code_description ?? ""} ${tx.merchant_name ?? ""}`.toLowerCase();
  if (/gas|fuel|petrol|chevron|shell|exxon|arco|76\b|mobil/.test(words)) return "Fuel";
  if (/rental|rent-a|sunbelt|united rentals|herc/.test(words)) return "Equipment rental";
  if (/permit|government|county|city of|municipal|inspection/.test(words)) return "Permits";
  if (/restaurant|food|meal|coffee|cafe|dining|fast food/.test(words)) return "Meals";
  if (/dump|disposal|waste|landfill|transfer station/.test(words)) return "Disposal";
  if (/tool|harbor freight|milwaukee|dewalt|makita/.test(words)) return "Tools";
  if (/hardware|home improvement|lumber|building|supply|depot|lowe|menards|ferguson|abc supply|srs|beacon|electrical|plumbing|roofing|concrete|paint/.test(words)) return "Materials";
  if (/parking|toll/.test(words)) return "Travel";
  return "Materials";
}

/** One line for the expense: where, who, and that it came off the card. */
export function rampExpenseNote(tx: Pick<RampTransaction, "merchant_name" | "merchant_descriptor" | "card_holder" | "sk_category_name">): string {
  const who = rampCardholderName(tx);
  return `Ramp card · ${rampMerchant(tx)}${who ? ` · ${who}` : ""}${tx.sk_category_name ? ` · ${tx.sk_category_name}` : ""}`.slice(0, 2000);
}

export interface JobOption {
  jobId: string;
  title: string;
  /** "Smith roof · 12 Oak St", what Ramp's field and the text show. */
  value: string;
}

/** The option's words: the job's title, the client's name or the street — within Ramp's field limits. */
export function jobOptionValue(job: { title: string; clientName?: string | null; address?: string | null }): string {
  const parts = [job.title.trim()];
  const extra = (job.clientName ?? job.address ?? "").trim();
  if (extra && !job.title.toLowerCase().includes(extra.toLowerCase())) parts.push(extra);
  return parts.join(" · ").slice(0, 80);
}

export const money = (n: number): string => `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The text that asks the tech which job a swipe was for. */
export function askText(company: string, tx: Pick<RampTransaction, "amount" | "entity_amount" | "merchant_name" | "merchant_descriptor">, options: readonly JobOption[]): string {
  const lines = options.slice(0, ASK_MAX_OPTIONS).map((o, i) => `${i + 1} ${o.title.slice(0, 40)}`);
  return `${company}: ${money(rampAmount(tx))} at ${rampMerchant(tx)} on the Ramp card — which job? Reply ${lines.join(" · ")} · S stock. Or the job's name.`.slice(0, 480);
}

export type JobReply = { kind: "job"; jobId: string } | { kind: "stock" } | { kind: "none" } | null;
const REPLY_STOP_WORDS = new Set(["the", "job", "for", "one", "that", "this", "was", "its", "it's", "and", "our", "yes", "please", "thanks"]);

/** The tech's answer: a number from the list, S/stock for the warehouse, "none" to leave it, or enough of a job's name. */
export function parseJobReply(body: string, options: readonly JobOption[]): JobReply {
  const t = body.trim().toLowerCase().replace(/[.!]+$/, "");
  if (!t) return null;
  if (/^(s|stock|warehouse|shop|inventory)$/.test(t)) return { kind: "stock" };
  if (/^(none|no|skip|n\/a|later)$/.test(t)) return { kind: "none" };
  const n = /^#?(\d{1,2})$/.exec(t);
  if (n) {
    const o = options[Number(n[1]) - 1];
    return o ? { kind: "job", jobId: o.jobId } : null;
  }
  const hits = options.filter((o) => o.value.toLowerCase().includes(t) || o.title.toLowerCase().includes(t) || t.includes(o.title.toLowerCase()));
  if (hits.length === 1) return { kind: "job", jobId: hits[0].jobId };
  // Every telling word of the reply inside one option's words, and only one.
  const words = t.split(/\s+/).filter((w) => w.length > 2 && !REPLY_STOP_WORDS.has(w));
  if (words.length) {
    const byWords = options.filter((o) => words.every((w) => o.value.toLowerCase().includes(w)));
    if (byWords.length === 1) return { kind: "job", jobId: byWords[0].jobId };
  }
  return null;
}

/** What the tech reads back. */
export function confirmText(tx: Pick<RampTransaction, "amount" | "entity_amount" | "merchant_name" | "merchant_descriptor">, where: string): string {
  return `Got it — ${money(rampAmount(tx))} at ${rampMerchant(tx)} is on ${where}. Snap the receipt to Ramp if you haven't.`;
}

/** The webhook's signature: HMAC-SHA256 of the raw body with the subscription's secret, hex or base64. */
export function rampSignatureMatches(raw: string, secret: string, header: string | null, hmacHex: (secret: string, raw: string) => string, hmacB64: (secret: string, raw: string) => string): boolean {
  if (!header || !secret) return false;
  const given = header.trim().replace(/^(sha256=|v1=)/i, "");
  const hex = hmacHex(secret, raw);
  const b64 = hmacB64(secret, raw);
  return timingSafeEqualStr(given, hex) || timingSafeEqualStr(given, b64) || timingSafeEqualStr(given.toLowerCase(), hex);
}
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** The event's transaction id, wherever the payload keeps it. */
export function rampEventTransactionId(payload: unknown): string | null {
  const p = payload as { object?: { id?: string; transaction_id?: string; resource_id?: string } | null; data?: { id?: string } } | null;
  const o = p?.object;
  return o?.transaction_id ?? o?.id ?? o?.resource_id ?? p?.data?.id ?? null;
}
