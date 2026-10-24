// JOBFLEX'S OWN OUTREACH CALLS (2026-10-23) — pure. Owner: "make the AI desk call contractors and present JobFlex —
// thank them for what they do, for helping people with their service — then offer the platform that makes their
// business better", "the AI will call contractors per the list given".
//
// THE LINE THIS HOLDS (the phone law, the TCPA, as the FCC read it in February 2024: an AI voice is an "artificial
// voice"): a sales call in an AI voice to a CELL phone, or to a home line, needs the person's prior written consent.
// So a contractor on an imported list is called by the AI only when their number is a LANDLINE (Twilio's line-type
// lookup says so); a cell, an internet or a toll-free number gets the email with the "Have the AI desk call me" link
// instead, and is called once they ask on that page — their consent, kept with its words, time and address. Anyone
// who says "don't call me" is never called again. Calls go out 9 am–8 pm on their clock, Monday to Saturday (where
// the state is unknown, only when that holds across the whole continental US). Not legal advice: the owner was told to
// have a TCPA lawyer look before the first run.

import { isUsCanadaNumber, toE164 } from "@/lib/phone";

/** The words beside the box a contractor ticks — kept, as shown, with each consent. */
export const OUTREACH_CONSENT_TEXT =
  "I agree that JobFlex may call and text me at this number — using an AI voice assistant and automated technology — to show me the AI desk and tell me about JobFlex, and may email me. Calls may be recorded. Agreeing isn't a condition of buying anything. Message and data rates may apply; reply STOP to any text, or say “stop calling” on a call, and you won't hear from us again.";

/** Whether a consent, as ticked, covers texts (the words before 2026-10-24 covered calls and email only). */
export const consentCoversTexts = (c: Pick<Consent, "text"> | null | undefined): boolean => !!c && /call and text me/i.test(c.text);

export type LineType = "landline" | "mobile" | "fixedVoip" | "nonFixedVoip" | "tollFree" | "personal" | "pager" | "voicemail" | "premium" | "sharedCost" | "uan" | "unknown";
const LINE_TYPES: readonly LineType[] = ["landline", "mobile", "fixedVoip", "nonFixedVoip", "tollFree", "personal", "pager", "voicemail", "premium", "sharedCost", "uan", "unknown"];
export const lineTypeOf = (v: unknown): LineType => (LINE_TYPES.includes(v as LineType) ? (v as LineType) : "unknown");
export const LINE_WORDS: Record<LineType, string> = {
  landline: "a landline",
  mobile: "a cell phone",
  fixedVoip: "an internet phone line",
  nonFixedVoip: "an internet phone number",
  tollFree: "a toll-free number",
  personal: "a personal number",
  pager: "a pager",
  voicemail: "a voicemail-only number",
  premium: "a premium-rate number",
  sharedCost: "a shared-cost number",
  uan: "a universal access number",
  unknown: "a number of unknown type",
};

export interface Consent {
  text: string;
  at: string;
  ip: string | null;
  ua: string | null;
  /** Where it was given: "call-me:<token>" (the email's page) or "call-me" (the open page). */
  page: string;
}

export type CallStatus = "calling" | "answered" | "voicemail" | "no-answer" | "busy" | "failed" | "done";
export type Outcome = "interested" | "link-sent" | "call-back" | "not-interested" | "do-not-call" | "gatekeeper" | "voicemail" | "no-answer" | "failed";
export const OUTCOME_WORDS: Record<Outcome, string> = {
  interested: "Interested",
  "link-sent": "Trial link sent",
  "call-back": "Call back",
  "not-interested": "Not interested",
  "do-not-call": "Don't call",
  gatekeeper: "Reached someone else",
  voicemail: "Voicemail",
  "no-answer": "No answer",
  failed: "Didn't connect",
};

export interface OutreachCall {
  sid: string | null;
  at: string;
  status: CallStatus;
  seconds: number;
  answeredBy: string | null;
  outcome: Outcome | null;
  summary: string | null;
  transcript: string | null;
  error: string | null;
}

export interface Prospect {
  id: string;
  name: string;
  business: string;
  phone: string | null;
  email: string | null;
  trade: string | null;
  state: string | null;
  city: string | null;
  source: "list" | "call-me";
  line: { type: LineType; carrier: string | null; at: string } | null;
  consent: Consent | null;
  dnc: { at: string; via: "call" | "admin" | "email" | "sms" } | null;
  calls: OutreachCall[];
  emailedAt: string | null;
  interest: { level: "hot" | "warm" | "cold"; note: string; callBack: string | null; at: string } | null;
  linkSentAt: string | null;
  linkSentTo: string | null;
  /** The one text after a call they asked for (2026-10-24); absent on older records. */
  textedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Calls per contractor at most (an answered call that ended the talk counts too). */
export const MAX_CALLS = 2;
/** A contractor on a list is not called again the same day. */
export const LIST_RETRY_MS = 20 * 60 * 60 * 1000;
/** One who asked for the call is tried again ten minutes later if the first did not reach them. */
export const ASKED_RETRY_MS = 10 * 60 * 1000;
/** The outcomes after which nobody is called again. */
const FINAL: ReadonlySet<Outcome> = new Set(["link-sent", "not-interested", "do-not-call", "interested"]);

export type Route = { kind: "ai-call" | "email" | "check" | "none"; why: string };

/** What this contractor gets: the AI's call, the email with the call-me link, a line check first, or nothing. */
export function routeFor(p: Pick<Prospect, "phone" | "email" | "line" | "consent" | "dnc">): Route {
  if (p.dnc) return { kind: "none", why: "Asked not to be called" };
  const mail = (why: string): Route => (p.email ? { kind: "email", why: `${why} — gets the email with the call-me link` } : { kind: "none", why: `${why}, and no email to write to` });
  if (!p.phone) return mail("No phone number");
  if (!isUsCanadaNumber(p.phone)) return mail("Not a US or Canadian number");
  if (p.consent) return { kind: "ai-call", why: "Asked for the call" };
  if (!p.line) return { kind: "check", why: "Line type not checked yet" };
  if (p.line.type === "landline") return { kind: "ai-call", why: "A landline — a business line the AI may call" };
  return mail(`${LINE_WORDS[p.line.type].replace(/^./, (c) => c.toUpperCase())} — the AI calls it only if they ask`);
}

/** Twilio's refusal in words the admin can act on. */
export function twilioWords(message: string): string {
  if (/not authorized to call|geo-?permissions|\b21215\b/i.test(message)) return "Twilio isn't allowed to call this country from JobFlex's account yet. In the Twilio Console: Voice → Settings → Geo permissions → tick United States & Canada → Save. Then try again.";
  if (/unverified|trial account/i.test(message)) return "JobFlex's Twilio account is a trial account: it can only call numbers verified in the Twilio Console. Upgrade the account, or verify this number there.";
  return message;
}

/* ── Calling hours ─────────────────────────────────────────────────────── */

export const CALL_HOURS = { from: 9, to: 20 } as const;
const E = "America/New_York", C = "America/Chicago", M = "America/Denver", AZ = "America/Phoenix", P = "America/Los_Angeles";
/** The whole continental US: a number whose state is unknown is called only when the hours hold in all of it. */
export const ALL_ZONES: readonly string[] = [E, C, M, AZ, P];
/** Each state's clocks (both where a state is split). */
export const STATE_ZONES: Record<string, readonly string[]> = {
  AL: [C], AK: ["America/Anchorage"], AZ: [AZ], AR: [C], CA: [P], CO: [M], CT: [E], DE: [E], DC: [E], FL: [E, C], GA: [E], HI: ["Pacific/Honolulu"], ID: [M, P], IL: [C], IN: [E, C], IA: [C], KS: [C, M], KY: [E, C], LA: [C], ME: [E], MD: [E], MA: [E], MI: [E, C], MN: [C], MS: [C], MO: [C], MT: [M], NE: [C, M], NV: [P], NH: [E], NJ: [E], NM: [M], NY: [E], NC: [E], ND: [C, M], OH: [E], OK: [C], OR: [P, M], PA: [E], RI: [E], SC: [E], SD: [C, M], TN: [E, C], TX: [C, M], UT: [M], VT: [E], VA: [E], WA: [P], WV: [E], WI: [C], WY: [M], PR: ["America/Puerto_Rico"],
};
const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};
export function stateCode(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const up = v.toUpperCase();
  if (STATE_ZONES[up]) return up;
  return STATE_NAMES[v.toLowerCase().replace(/\./g, "")] ?? null;
}

function clock(now: Date, zone: string): { hour: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(now);
  return { hour: Number(parts.find((x) => x.type === "hour")?.value ?? 0), weekday: parts.find((x) => x.type === "weekday")?.value ?? "" };
}

/** 9 am–8 pm on their clock, Monday to Saturday — on every clock of their state, or of the whole country when it is unknown. */
export function withinCallingHours(state: string | null, now: Date): boolean {
  const zones = (state && STATE_ZONES[state]) || ALL_ZONES;
  return zones.every((z) => {
    const c = clock(now, z);
    return c.weekday !== "Sun" && c.hour >= CALL_HOURS.from && c.hour < CALL_HOURS.to;
  });
}

/** Their clock, in words, for the call's brief: "Tuesday 10:42 AM". */
export function localNowWords(state: string | null, now: Date): string {
  const zone = (state && STATE_ZONES[state]?.[0]) || E;
  return now.toLocaleString("en-US", { timeZone: zone, weekday: "long", hour: "numeric", minute: "2-digit" });
}

/** May the AI call this contractor now? Back comes why not, in words, when it may not. */
export function callableNow(p: Prospect, now: Date): { ok: true } | { ok: false; why: string } {
  const r = routeFor(p);
  if (r.kind !== "ai-call") return { ok: false, why: r.why };
  if (p.calls.some((c) => c.status === "calling")) return { ok: false, why: "A call is going now" };
  // Who asked for a call is counted from their ask: the calls before it were a list's. A call Twilio refused to place
  // (no call id: the account's settings, a bad number) never rang anyone — it is not counted, and nothing waits on it.
  const calls = (p.consent ? p.calls.filter((c) => c.at >= p.consent!.at) : p.calls).filter((c) => !(c.status === "failed" && !c.sid));
  const final = calls.find((c) => c.outcome && FINAL.has(c.outcome));
  if (final) return { ok: false, why: `Already called — ${OUTCOME_WORDS[final.outcome!].toLowerCase()}` };
  if (calls.length >= MAX_CALLS) return { ok: false, why: `Called ${MAX_CALLS} times already` };
  const last = calls[calls.length - 1];
  const wait = p.consent ? ASKED_RETRY_MS : LIST_RETRY_MS;
  if (last && now.getTime() - Date.parse(last.at) < wait) return { ok: false, why: p.consent ? "Tried a few minutes ago" : "Tried today already" };
  // Who just asked for the call is called at once (they are there, phone in hand); everyone else in calling hours.
  const justAsked = !!p.consent && !last && now.getTime() - Date.parse(p.consent.at) < 15 * 60 * 1000;
  if (!justAsked && !withinCallingHours(p.state, now)) return { ok: false, why: "Outside calling hours on their clock (9 am–8 pm, Mon–Sat)" };
  return { ok: true };
}

/* ── The order: the email first ───────────────────────────────────────── */

/** A landline that has an email gets the email first, and the AI's call this long after it. */
export const EMAIL_LEAD_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * May the list's run call this contractor yet (owner, 2026-10-24: "send the email if there is one, and the text and
 * the call after that")? Who asked for the call: at once. A landline with an email: once the email went out two days
 * ago — while emails can't go out on this server at all, the call needn't wait for one. "Call now" on the row
 * doesn't wait for this.
 */
export function emailFirst(p: Pick<Prospect, "email" | "emailedAt" | "consent">, now: Date, emailsOn: boolean): { ok: true } | { ok: false; why: string } {
  if (p.consent || !p.email || !emailsOn) return { ok: true };
  if (!p.emailedAt) return { ok: false, why: "The email goes first" };
  if (now.getTime() - Date.parse(p.emailedAt) < EMAIL_LEAD_MS) return { ok: false, why: "Called two days after the email" };
  return { ok: true };
}

/** Who gets the email in the next batch: everyone not yet written to whom we may write — a landline too, before its call. */
export function emailDue(p: Prospect): boolean {
  if (!p.email || p.emailedAt || p.dnc || p.consent) return false;
  const k = routeFor(p).kind;
  return k === "email" || k === "ai-call" || k === "check";
}

/**
 * The one text after a call they asked for: their consent covers texts, the number isn't a landline (it can't take
 * one), they haven't said stop, and nothing was texted since they asked.
 */
export function textDue(p: Prospect): boolean {
  if (!p.phone || p.dnc || !consentCoversTexts(p.consent)) return false;
  if (p.line?.type === "landline") return false;
  return !(p.textedAt && p.consent && p.textedAt >= p.consent.at);
}

/* ── The list ──────────────────────────────────────────────────────────── */

export interface ListRow {
  name: string;
  business: string;
  phone: string | null;
  email: string | null;
  trade: string | null;
  state: string | null;
  city: string | null;
}

export const LIST_MAX_ROWS = 2000;
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i;

/** One line of a CSV (or tab/semicolon) file, quotes honoured. */
function cells(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

type Col = keyof ListRow;
const HEADER: Array<[Col, RegExp]> = [
  ["email", /^e-?mail/i],
  ["phone", /phone|^tel|mobile|cell|^number$/i],
  ["business", /business|company|^org|firm|^name of business/i],
  ["name", /^(owner|contact|first|full)?\s*name$|^owner|^contact/i],
  ["trade", /trade|industry|category|service|specialt/i],
  ["state", /^state$|^st$|province|region/i],
  ["city", /^city$|town|locality/i],
];

const TRADE_WORDS: Array<[string, RegExp]> = [
  ["roofing", /roof/i],
  ["hvac", /hvac|heating|cooling|air cond|furnace|a\/c\b/i],
  ["fencing", /fenc/i],
  ["decks", /deck|patio/i],
  ["remodeling", /remodel|kitchen|bath|renovat|general contract/i],
  ["plumbing", /plumb/i],
  ["electrical", /electric/i],
  ["landscaping", /landscap|lawn|yard|tree/i],
  ["painting", /paint/i],
  ["concrete", /concrete|paving|asphalt|driveway/i],
  ["siding", /siding/i],
  ["gutters", /gutter/i],
  ["windows", /window|door/i],
  ["flooring", /floor|tile|carpet/i],
];
/** The trade in the words the brief uses: "roofing", "hvac" …, or what the list said, or null. */
export function tradeKey(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  return TRADE_WORDS.find(([, re]) => re.test(v))?.[0] ?? v.toLowerCase().slice(0, 40);
}

/**
 * A pasted list or a CSV export, into rows: with a header row (name, business, phone, email, trade, state, city — in
 * any order and the usual spellings) or without one (each cell recognised by what it looks like). Rows without a phone
 * or an email are left out; the same phone or email twice is one contractor.
 */
export function parseProspectList(text: string): { rows: ListRow[]; skipped: number } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], skipped: 0 };
  const sep = ["\t", ",", ";", "|"].map((s) => [s, lines[0].split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const first = cells(lines[0], sep);
  const mapped = first.map((h) => HEADER.find(([, re]) => re.test(h))?.[0] ?? null);
  const hasHeader = mapped.filter(Boolean).length >= 2 && !first.some((c) => EMAIL_RE.test(c) || (toE164(c) && /\d{3}/.test(c)));
  const body = hasHeader ? lines.slice(1) : lines;
  const rows: ListRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const line of body.slice(0, LIST_MAX_ROWS)) {
    const cs = cells(line, sep);
    const r: ListRow = { name: "", business: "", phone: null, email: null, trade: null, state: null, city: null };
    if (hasHeader) {
      cs.forEach((v, i) => {
        const col = mapped[i];
        if (!col || !v) return;
        if (col === "phone") r.phone = toE164(v);
        else if (col === "email") r.email = EMAIL_RE.test(v) ? v.toLowerCase() : null;
        else if (col === "state") r.state = stateCode(v);
        else if (col === "trade") r.trade = tradeKey(v);
        else r[col] = v.slice(0, 120);
      });
    } else {
      const texts: string[] = [];
      for (const v of cs) {
        if (!v) continue;
        if (!r.email && EMAIL_RE.test(v)) r.email = v.toLowerCase();
        else if (!r.phone && toE164(v) && /\d{3}.*\d{4}/.test(v)) r.phone = toE164(v);
        else if (!r.state && stateCode(v) && v.length <= 14) r.state = stateCode(v);
        else texts.push(v);
      }
      r.business = (texts[0] ?? "").slice(0, 120);
      r.name = (texts[1] ?? "").slice(0, 120);
      r.trade = tradeKey(texts[2] ?? r.business);
    }
    if (!r.trade) r.trade = tradeKey(r.business);
    if (!r.phone && !r.email) {
      skipped++;
      continue;
    }
    const key = r.phone ?? r.email!;
    if (seen.has(key) || (r.email && seen.has(r.email))) {
      skipped++;
      continue;
    }
    seen.add(key);
    if (r.email) seen.add(r.email);
    rows.push(r);
  }
  return { rows, skipped: skipped + Math.max(0, body.length - LIST_MAX_ROWS) };
}

/* ── The page's figures ────────────────────────────────────────────────── */

export function funnel(ps: readonly Prospect[]): { total: number; landlines: number; emailOnly: number; unchecked: number; called: number; reached: number; linkSent: number; interested: number; asked: number; dnc: number } {
  const routes = ps.map((p) => routeFor(p).kind);
  const reachedP = (p: Prospect) => p.calls.some((c) => c.status === "answered" || c.status === "done");
  return {
    total: ps.length,
    landlines: ps.filter((p) => p.line?.type === "landline").length,
    emailOnly: routes.filter((k) => k === "email").length,
    unchecked: routes.filter((k) => k === "check").length,
    called: ps.filter((p) => p.calls.length > 0).length,
    reached: ps.filter(reachedP).length,
    linkSent: ps.filter((p) => !!p.linkSentAt).length,
    interested: ps.filter((p) => p.interest && p.interest.level !== "cold").length,
    asked: ps.filter((p) => !!p.consent).length,
    dnc: ps.filter((p) => !!p.dnc).length,
  };
}
