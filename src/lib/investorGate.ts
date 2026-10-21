// WHO IS READING THE INVESTOR LINK (owner, 2026-10-13: "when you send the link to somebody, make it open to submit to
// us his name or company and the nature of business, and then it sends to us and he has the link … and on their
// link a button on top: we accept VC offers — make it smart").
//
// The pure half, shared by the public page's forms (client) and the actions (server): the choices offered, and the
// checks an introduction and an offer must pass. Storage, the visitor's pass and the emails are lib/investorVisitors.

/** What kind of reader this is — tiles on the intro form. */
export const INVESTOR_KINDS = [
  "VC fund",
  "Angel investor",
  "Family office",
  "Private equity",
  "Corporate / strategic",
  "Accelerator or incubator",
  "Lender / debt",
  "Contractor or trade business",
  "Other",
] as const;
export type InvestorKind = (typeof INVESTOR_KINDS)[number];

/** Kinds that invest: the offer button leads for them; for the others it is still there, one step quieter. */
export const INVESTING_KINDS: ReadonlySet<string> = new Set(["VC fund", "Angel investor", "Family office", "Private equity", "Corporate / strategic", "Accelerator or incubator", "Lender / debt"]);

export const OFFER_TYPES = ["Term sheet", "Investment interest", "Intro call first"] as const;
export const OFFER_AMOUNTS = ["Under $100K", "$100K–$250K", "$250K–$500K", "$500K–$1M", "$1M–$3M", "$3M+", "Open"] as const;
export const OFFER_INSTRUMENTS = ["SAFE", "Priced equity", "Convertible note", "Revenue-based", "Debt", "Not sure yet"] as const;
export const OFFER_TIMELINES = ["This month", "This quarter", "Exploring"] as const;

export interface InvestorIntroInput {
  name: string;
  company: string;
  kind: string;
  email: string;
  phone?: string;
}

export interface InvestorOfferInput {
  type: string;
  amount: string;
  instrument: string;
  valuation?: string;
  timeline: string;
  message: string;
  /** Prefilled from the intro; editable. */
  name: string;
  company: string;
  email: string;
  phone?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const oneOf = <T extends readonly string[]>(list: T, v: string): v is T[number] => (list as readonly string[]).includes(v);

/** The introduction, tidied, with what is missing said field by field (empty = fine). */
export function checkIntro(raw: Partial<InvestorIntroInput>): { value: InvestorIntroInput; problems: Partial<Record<keyof InvestorIntroInput, string>> } {
  const value: InvestorIntroInput = {
    name: clean(raw.name, 80),
    company: clean(raw.company, 120),
    kind: clean(raw.kind, 40),
    email: clean(raw.email, 160).toLowerCase(),
    phone: clean(raw.phone, 40) || undefined,
  };
  const problems: Partial<Record<keyof InvestorIntroInput, string>> = {};
  if (value.name.length < 2) problems.name = "Your name, please.";
  if (value.company.length < 2) problems.company = "The company or fund — or 'Independent'.";
  if (!oneOf(INVESTOR_KINDS, value.kind)) problems.kind = "Pick the one closest to what you do.";
  if (!EMAIL.test(value.email)) problems.email = "An email we can answer.";
  if (value.phone && value.phone.replace(/\D/g, "").length < 7) problems.phone = "That phone number looks short.";
  return { value, problems };
}

/** The offer, tidied, with what is missing said field by field. */
export function checkOffer(raw: Partial<InvestorOfferInput>): { value: InvestorOfferInput; problems: Partial<Record<keyof InvestorOfferInput, string>> } {
  const value: InvestorOfferInput = {
    type: clean(raw.type, 40),
    amount: clean(raw.amount, 40),
    instrument: clean(raw.instrument, 40),
    valuation: clean(raw.valuation, 60) || undefined,
    timeline: clean(raw.timeline, 40),
    message: typeof raw.message === "string" ? raw.message.trim().slice(0, 3000) : "",
    name: clean(raw.name, 80),
    company: clean(raw.company, 120),
    email: clean(raw.email, 160).toLowerCase(),
    phone: clean(raw.phone, 40) || undefined,
  };
  const problems: Partial<Record<keyof InvestorOfferInput, string>> = {};
  if (!oneOf(OFFER_TYPES, value.type)) problems.type = "Pick what you are sending.";
  if (!oneOf(OFFER_AMOUNTS, value.amount)) problems.amount = "Pick a range — 'Open' is fine.";
  if (!oneOf(OFFER_INSTRUMENTS, value.instrument)) problems.instrument = "Pick one — 'Not sure yet' is fine.";
  if (!oneOf(OFFER_TIMELINES, value.timeline)) problems.timeline = "Pick a timeline.";
  if (value.name.length < 2) problems.name = "Your name, please.";
  if (value.company.length < 2) problems.company = "The company or fund.";
  if (!EMAIL.test(value.email)) problems.email = "An email we can answer.";
  if (value.type === "Term sheet" && value.message.length < 10 && !value.valuation) problems.message = "A line on the terms — or the valuation — helps us answer fast.";
  return { value, problems };
}

/** Where a reader's request stands (owner, 2026-10-20: "don't open the link till we approve it"). An entry from before
 *  approvals has no status: those readers were let in already, so it reads as approved. */
export type ReaderStatus = "pending" | "approved" | "declined";

/** The visitor the public page knows, as it may be shown back to them. */
export interface InvestorVisitorView {
  name: string;
  company: string;
  kind: string;
  email: string;
  phone: string | null;
  /** A signed-in platform admin who went through the door to see the page as a reader (2026-10-14): a test, not a reader. */
  admin?: boolean;
  status?: ReaderStatus;
}

export const statusOf = (v: { status?: ReaderStatus; admin?: boolean }): ReaderStatus => (v.admin ? "approved" : (v.status ?? "approved"));
/** May this reader see the figures? Approved; or waiting while approvals are switched off (the door opens for them too). */
export const mayRead = (v: { status?: ReaderStatus; admin?: boolean }, approveReaders: boolean): boolean => {
  const st = statusOf(v);
  return st === "approved" || (st === "pending" && !approveReaders);
};
/** The requests waiting on us, oldest first — the order they asked in. */
export function pendingOf<T extends { status?: ReaderStatus; admin?: boolean; at: string }>(list: readonly T[]): T[] {
  return list.filter((v) => !v.admin && v.status === "pending").sort((a, b) => a.at.localeCompare(b.at));
}

/** Mailboxes anyone can open — an address there says nothing about where the person works. */
const PERSONAL_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.net", "mail.com", "zoho.com", "yandex.com", "yandex.ru", "fastmail.com", "hey.com", "pm.me", "comcast.net", "att.net", "verizon.net", "sbcglobal.net"]);
const WORDS_TO_SKIP = new Set(["capital", "ventures", "venture", "partners", "fund", "funds", "group", "holdings", "investments", "investment", "family", "office", "the", "and", "llc", "inc", "ltd", "co", "company", "management", "advisors", "global", "labs"]);

export type ReviewHint = { tone: "good" | "warn" | "info"; text: string };

/**
 * What a reviewer can tell at a glance from the request itself — nothing looked up: the email's domain against the
 * company they named, a free mailbox, whether they invest, a phone left or not, and how often this email asked before.
 */
export function reviewHints(v: { name: string; company: string; kind: string; email: string; phone: string | null }, history: { earlierApproved?: number; earlierDeclined?: number } = {}): ReviewHint[] {
  const out: ReviewHint[] = [];
  const domain = (v.email.split("@")[1] ?? "").toLowerCase();
  if (PERSONAL_MAIL.has(domain)) out.push({ tone: "warn", text: `A personal mailbox (${domain}) — nothing ties it to ${v.company}` });
  else if (domain) {
    const root = domain.split(".").slice(0, -1).join("").replace(/[^a-z0-9]/g, "");
    const words = v.company.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !WORDS_TO_SKIP.has(w));
    const squashed = v.company.toLowerCase().replace(/[^a-z0-9]/g, "");
    const match = !!root && (words.some((w) => root.includes(w)) || (root.length >= 4 && squashed.includes(root)));
    out.push(match ? { tone: "good", text: `Email at ${domain} — matches ${v.company}` } : { tone: "warn", text: `Email at ${domain} — not the name ${v.company}` });
  }
  out.push(INVESTING_KINDS.has(v.kind) ? { tone: "good", text: `Invests — ${v.kind.toLowerCase()}` } : { tone: "info", text: `Not an investor — ${v.kind.toLowerCase()}` });
  if (!v.phone) out.push({ tone: "info", text: "No phone left" });
  if (history.earlierApproved) out.push({ tone: "good", text: `You let this email in on an earlier link` });
  if (history.earlierDeclined) out.push({ tone: "warn", text: `You declined this email before` });
  return out;
}

/** One click to look them up — the reviewer's own search, nothing fetched for them. */
export function lookupLinks(v: { name: string; company: string; email: string }): Array<{ label: string; href: string }> {
  const q = (s: string) => encodeURIComponent(s);
  const domain = (v.email.split("@")[1] ?? "").toLowerCase();
  return [
    { label: "LinkedIn", href: `https://www.linkedin.com/search/results/all/?keywords=${q(`${v.name} ${v.company}`)}` },
    { label: "Google", href: `https://www.google.com/search?q=${q(`"${v.name}" ${v.company}`)}` },
    ...(domain && !PERSONAL_MAIL.has(domain) ? [{ label: domain, href: `https://${domain}` }] : []),
  ];
}

/** The readers, without the admins' own walk-throughs. */
export function readersOf<T extends { admin?: boolean }>(list: readonly T[]): T[] {
  return list.filter((v) => !v.admin);
}
/** The offers, without the admins' own test offers. */
export function offersOf<T extends { admin?: boolean }>(list: readonly T[]): T[] {
  return list.filter((o) => !o.admin);
}
