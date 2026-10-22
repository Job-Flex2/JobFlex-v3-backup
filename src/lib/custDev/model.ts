// CUSTOMER DEVELOPMENT (owner, 2026-10-22) — pure; the admin page, its report and the QA check share it.
//
// Owner: "build customer development in admin … start tracking customer development statistics … make it smart,
// based on what we have in JobFlex and the emails (support reflects the emails) … we're going to show it to investors
// as well — but don't add anything to the investors link." Steve Blank's method, read off what the database already
// keeps (lib/custDev/read gathers it):
//   · the four steps — discovery, validation, creation, company building — each with its pass criteria, computed;
//   · hypotheses with a test and the live evidence (supported / not supported / too early), the owner's verdict on top;
//   · segments (trade, channel), the funnel and weekly cohorts — every rate counts only accounts old enough to have
//     had the chance (a sign-up from yesterday is not "not activated");
//   · the voice of the customer — support tickets and their email thread, cancellation reasons, trial-extension
//     notes — sorted into themes with the customer's own words, and the tools they name;
//   · discovery interviews the team logs, and who to talk to next, with the questions to ask.
// Nothing here invents a number: a rate with no one behind it is null and shows as "—".

export const DAY = 86_400_000;
const WEEK = 7 * DAY;

/* ── what the reader hands over ───────────────────────────────────────────────────────────────────────────────── */

export interface OrgFact {
  id: string;
  name: string;
  createdAt: number;
  /** "Roofing", "HVAC", … or "Not given". */
  trade: string;
  /** The state off the address ("UT"), for the report's "Roofing contractor · UT". */
  region: string | null;
  /** "Facebook", "Google", "Untagged"… (lib/traffic-live signupSource). */
  channel: string;
  fromAd: boolean;
  contact: { name: string | null; email: string | null; phone: string | null };
  sub: { status: string; plan: string; trialEndsAt: number | null; canceledAt: number | null; startedAt: number } | null;
  /** The first estimate, proposal, Smart Proposal brief or plan drawn. */
  firstValueAt: number | null;
  proposals: number;
  sent: number;
  accepted: number;
  /** Roof measurements, HVAC estimates, Smart Proposal briefs, deck and fence plans. */
  estimates: number;
  activeDays: number;
  lastSeenAt: number | null;
}

export type VoiceSource = "support" | "email" | "cancel" | "trial";
export interface VoiceItem {
  id: string;
  at: number;
  orgId: string | null;
  company: string;
  trade: string;
  region: string | null;
  source: VoiceSource;
  text: string;
  /** Cancellation reason keys (lib/cancelFeedback). */
  reasons?: string[];
  /** A support ticket's subject — read for its theme, never quoted (a subject is a label, not the customer's words). */
  subject?: string;
  /** The ticket's category (billing | technical | account | feature | general). */
  category?: string;
}

export interface CancelFact {
  id: string;
  orgId: string;
  at: number;
  reasons: string[];
  otherText: string | null;
}

export type InterviewKind = "problem" | "solution" | "validation" | "exit";
export type WouldPay = "yes" | "maybe" | "no";
export interface Interview {
  id: string;
  at: number;
  orgId: string | null;
  company: string;
  person: string;
  trade: string;
  kind: InterviewKind;
  channel: "call" | "video" | "in-person" | "email" | "text";
  /** How much the problem hurts, 1–5, as the interviewer judged it; null = not asked. */
  pain: number | null;
  /** What they use today ("pen and paper", "Jobber", "a spreadsheet"). */
  currentTool: string;
  wouldPay: WouldPay | null;
  /** A price they named a month, in dollars. */
  priceSaid: number | null;
  quote: string;
  notes: string;
  hypotheses: { id: string; effect: "supports" | "refutes" }[];
  by: string | null;
  createdAt: number;
}

export const INTERVIEW_KINDS: ReadonlyArray<{ key: InterviewKind; label: string; hint: string }> = [
  { key: "problem", label: "Problem", hint: "Do they have the problem, how bad, what they do today" },
  { key: "solution", label: "Solution", hint: "Does JobFlex solve it — shown the product" },
  { key: "validation", label: "Validation", hint: "A paying customer: why they bought, what they would miss" },
  { key: "exit", label: "Exit", hint: "Someone who left: why, and what they use now" },
];
export const CHANNELS: ReadonlyArray<{ key: Interview["channel"]; label: string }> = [
  { key: "call", label: "Phone call" },
  { key: "video", label: "Video call" },
  { key: "in-person", label: "In person" },
  { key: "email", label: "Email" },
  { key: "text", label: "Text" },
];

/* ── an account's standing ────────────────────────────────────────────────────────────────────────────────────── */

export interface OrgState {
  payingNow: boolean;
  trialing: boolean;
  /** Paid at least once: paying now, or cancelled more than a day after the trial ended. */
  everPaid: boolean;
  /** Paying since (the trial's end, or the plan's start). */
  paidSince: number | null;
  /** A trial that has been decided — over, or turned into a plan. */
  trialDecided: boolean;
  left: boolean;
  /** Old enough to judge its first week. */
  weekOld: boolean;
  activatedWeek1: boolean;
}

export function orgState(o: OrgFact, now: number): OrgState {
  const status = (o.sub?.status ?? "").toUpperCase();
  const payingNow = status === "ACTIVE";
  const trialing = status === "TRIALING" && (o.sub?.trialEndsAt ?? now + 1) > now;
  const trialEnd = o.sub?.trialEndsAt ?? null;
  const canceled = o.sub?.canceledAt ?? null;
  const paidThenLeft = canceled !== null && trialEnd !== null && canceled > trialEnd + DAY;
  const everPaid = payingNow || paidThenLeft;
  const paidSince = everPaid ? (trialEnd ?? o.sub?.startedAt ?? null) : null;
  const trialDecided = !!o.sub && status !== "FREE" && !trialing;
  const left = !payingNow && !trialing && (canceled !== null || ["CANCELED", "EXPIRED", "TRIAL_ENDED", "UNPAID", "PAST_DUE"].includes(status));
  const weekOld = now - o.createdAt >= WEEK;
  const activatedWeek1 = o.firstValueAt !== null && o.firstValueAt - o.createdAt <= WEEK;
  return { payingNow, trialing, everPaid, paidSince, trialDecided, left, weekOld, activatedWeek1 };
}

/* ── rates ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

export interface Rate {
  n: number;
  of: number;
  /** null when no one is behind it. */
  value: number | null;
}
export const rate = (n: number, of: number): Rate => ({ n, of, value: of > 0 ? n / of : null });
export const pct = (r: Rate | number | null, digits = 0): string => {
  const v = typeof r === "number" || r === null ? r : r.value;
  return v === null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`;
};
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* ── segments ──────────────────────────────────────────────────────────────────────────────────────────────────── */

export interface SegmentRow {
  key: string;
  signups: number;
  /** Used an estimator or made a proposal in their first week (of the accounts a week old). */
  activation: Rate;
  sentProposal: Rate;
  /** Finished trials that became paying. */
  trialToPaid: Rate;
  payingNow: number;
  left: number;
  /** Hours from sign-up to the first estimate or proposal, the median. */
  hoursToFirstValue: number | null;
}

function segmentRow(key: string, orgs: OrgFact[], now: number): SegmentRow {
  const st = orgs.map((o) => [o, orgState(o, now)] as const);
  const old = st.filter(([, s]) => s.weekOld);
  const decided = st.filter(([, s]) => s.trialDecided);
  return {
    key,
    signups: orgs.length,
    activation: rate(old.filter(([, s]) => s.activatedWeek1).length, old.length),
    sentProposal: rate(old.filter(([o]) => o.sent > 0).length, old.length),
    trialToPaid: rate(decided.filter(([, s]) => s.everPaid).length, decided.length),
    payingNow: st.filter(([, s]) => s.payingNow).length,
    left: st.filter(([, s]) => s.left).length,
    hoursToFirstValue: median(orgs.filter((o) => o.firstValueAt !== null).map((o) => ((o.firstValueAt as number) - o.createdAt) / 3_600_000)),
  };
}

/** Every account as one segment — the average the others are measured against. */
export function overallRow(orgs: OrgFact[], now: number): SegmentRow {
  return segmentRow("All", orgs, now);
}

export function segmentsBy(orgs: OrgFact[], now: number, keyOf: (o: OrgFact) => string): SegmentRow[] {
  const groups = new Map<string, OrgFact[]>();
  for (const o of orgs) groups.set(keyOf(o), [...(groups.get(keyOf(o)) ?? []), o]);
  return [...groups.entries()].map(([k, list]) => segmentRow(k, list, now)).sort((a, b) => b.signups - a.signups || a.key.localeCompare(b.key));
}

/** The segment that converts clearly better than the average — the early adopters — once enough trials are decided. */
export const EARLY_ADOPTER_MIN_TRIALS = 5;
export function earlyAdopters(rows: SegmentRow[], overall: SegmentRow): { row: SegmentRow; lift: number } | null {
  const avg = overall.trialToPaid.value;
  if (avg === null || avg === 0) return null;
  const best = rows
    .filter((r) => r.trialToPaid.of >= EARLY_ADOPTER_MIN_TRIALS && r.key !== "Not given" && r.trialToPaid.value !== null)
    .sort((a, b) => (b.trialToPaid.value as number) - (a.trialToPaid.value as number))[0];
  return best ? { row: best, lift: (best.trialToPaid.value as number) / avg } : null;
}

/* ── the funnel and the weekly cohorts ─────────────────────────────────────────────────────────────────────────── */

export interface FunnelStep {
  key: string;
  label: string;
  n: number;
  /** Of all sign-ups (the steps are not each a subset of the one before: a customer can pay without a client's
   *  acceptance in the app). */
  ofAll: number | null;
}

export function funnel(orgs: OrgFact[], now: number): FunnelStep[] {
  const st = orgs.map((o) => [o, orgState(o, now)] as const);
  const steps: Array<[string, string, number]> = [
    ["signup", "Signed up", orgs.length],
    ["tool", "Used an estimator", orgs.filter((o) => o.firstValueAt !== null).length],
    ["sent", "Sent a proposal", orgs.filter((o) => o.sent > 0).length],
    ["accepted", "A client accepted", orgs.filter((o) => o.accepted > 0).length],
    ["paid", "Paid", st.filter(([, s]) => s.everPaid).length],
    ["paying", "Still paying", st.filter(([, s]) => s.payingNow).length],
  ];
  const all = orgs.length;
  return steps.map(([key, label, n], i) => ({ key, label, n, ofAll: i === 0 || all === 0 ? null : n / all }));
}

/** Monday 00:00 UTC of the week holding `t`. */
export function weekStart(t: number): number {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}
/** ISO week label, "2026-W43". */
export function isoWeek(t: number): string {
  const d = new Date(weekStart(t) + 3 * DAY);
  const year = d.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 4));
  const n = 1 + Math.round((d.getTime() - weekStart(first.getTime()) - 3 * DAY) / WEEK);
  return `${year}-W${String(n).padStart(2, "0")}`;
}

export interface CohortRow {
  week: number;
  label: string;
  signups: number;
  activation: Rate;
  sentProposal: Rate;
  paid: Rate;
  payingNow: number;
}

export function cohorts(orgs: OrgFact[], now: number, weeks = 12): CohortRow[] {
  const thisWeek = weekStart(now);
  const out: CohortRow[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = thisWeek - i * WEEK;
    const list = orgs.filter((o) => o.createdAt >= start && o.createdAt < start + WEEK);
    const st = list.map((o) => [o, orgState(o, now)] as const);
    const old = st.filter(([, s]) => s.weekOld);
    out.push({
      week: start,
      label: new Date(start).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      signups: list.length,
      activation: rate(old.filter(([, s]) => s.activatedWeek1).length, old.length),
      sentProposal: rate(old.filter(([o]) => o.sent > 0).length, old.length),
      paid: rate(st.filter(([, s]) => s.everPaid).length, list.length),
      payingNow: st.filter(([, s]) => s.payingNow).length,
    });
  }
  return out;
}

/* ── the voice of the customer ─────────────────────────────────────────────────────────────────────────────────── */

export type ThemeKey = "price" | "feature" | "ease" | "bug" | "demand" | "competitor" | "billing" | "testing" | "praise";
export const THEMES: ReadonlyArray<{ key: ThemeKey; label: string; tone: "bad" | "wait" | "bp" | "ok" | "mute"; words: RegExp; reasons?: string[]; categories?: string[] }> = [
  { key: "feature", label: "Missing feature", tone: "bp", words: /\b(?:add(?:ed)?|feature|wish|would (?:be|love)|could you|can you (?:add|make)|need(?:s|ed)? (?:a|to|it to)|missing|doesn'?t have|integrat\w*|sync with|option to|ability to|support for)\b/i, reasons: ["missing_feature"], categories: ["feature"] },
  // Our price — not the material prices contractors talk about all day ("my own shingle prices").
  { key: "price", label: "Price", tone: "wait", words: /\b(?:(?:too|so|very|pretty) (?:expensive|pricey|much)|expensive|pricey|(?:can'?t|cannot|couldn'?t) afford|cheaper (?:plan|option|tool|app)|costs? (?:too much|more than)|more expensive than|(?:your|the|jobflex'?s?|subscription|monthly|plan) (?:price|pricing|cost|fee)|price (?:is|was) (?:too )?high|discount)\b|\$\d+(?:\.\d\d)? ?(?:a|per|\/) ?(?:month|mo)\b/i, reasons: ["too_expensive"] },
  { key: "ease", label: "Hard to use", tone: "wait", words: /\b(?:hard|confus\w*|complicated|learn(?:ing)?|how do i|can'?t find|where (?:is|do)|figure out|tutorial|walk ?through|set ?up|setup|overwhelm\w*|too many steps)\b/i, reasons: ["hard_to_use"] },
  { key: "bug", label: "Bug or error", tone: "bad", words: /\b(?:bug|error|broken|(?:does|did|is|was)n'?t work\w*|not working|crash\w*|stuck|won'?t (?:load|open|save|send)|failed|glitch\w*|freez\w*|blank (?:page|screen))\b/i, categories: ["technical"] },
  { key: "demand", label: "Slow season / no jobs", tone: "mute", words: /\b(?:no (?:jobs|work)|not enough (?:jobs|work)|slow (?:season|right now)|winter|off ?season|seasonal|work (?:is )?slow)\b/i, reasons: ["not_enough_jobs"] },
  { key: "competitor", label: "Another tool", tone: "mute", words: /\b(?:switch(?:ed|ing)? to|went (?:back )?to|another (?:tool|app|software|program)|already use|using \w+ instead)\b/i, reasons: ["switched_tool"] },
  // Our billing and their account — not the invoices they send their own clients.
  { key: "billing", label: "Billing / account", tone: "mute", words: /\b(?:(?:was|got|been|i was) charged|charged (?:me|twice|after)|refund|billing|my card|credit card|cancel(?:l?ed)? my (?:plan|subscription|account)|can'?t (?:log ?in|sign ?in)|password|locked out)\b/i, categories: ["billing", "account"] },
  { key: "testing", label: "Just looking", tone: "mute", words: /\bjust (?:testing|looking|checking|trying)\b|\bnot ready\b/i, reasons: ["just_testing"] },
  { key: "praise", label: "Praise", tone: "ok", words: /\b(?:love (?:it|this|the)|great (?:app|tool|job|product|software)|awesome|amazing|thank you|thanks so much|helpful|easy to use|saves? (?:me )?(?:time|hours)|game changer)\b/i },
];
const THEME_LABEL = new Map(THEMES.map((t) => [t.key, t.label]));
export const themeLabel = (k: ThemeKey) => THEME_LABEL.get(k) ?? k;

/** The tools contractors name — what they use instead of JobFlex, or alongside it. */
const TOOLS: ReadonlyArray<[RegExp, string]> = [
  [/\bjobber\b/i, "Jobber"],
  [/\bhouse ?call ?pro\b|\bhcp\b/i, "Housecall Pro"],
  [/\bservice ?titan\b/i, "ServiceTitan"],
  [/\broofr\b/i, "Roofr"],
  [/\beagle ?view\b/i, "EagleView"],
  [/\bhover\b/i, "Hover"],
  [/\bcompany ?cam\b/i, "CompanyCam"],
  [/\bacculynx\b/i, "AccuLynx"],
  [/\bjob ?nimbus\b/i, "JobNimbus"],
  [/\bbuilder ?trend\b/i, "Buildertrend"],
  [/\bquick ?books\b|\bqbo\b/i, "QuickBooks"],
  [/\bjoist\b/i, "Joist"],
  [/\bmarket ?sharp\b/i, "Marketsharp"],
  [/\bexcel\b|\bspread ?sheets?\b|\bgoogle sheets\b/i, "Spreadsheets"],
  [/\bpen and paper\b|\bpaper\b|\bnotebook\b|\bby hand\b/i, "Pen and paper"],
];
export function toolsNamed(text: string): string[] {
  return TOOLS.filter(([re]) => re.test(text)).map(([, name]) => name);
}

export function themesOf(item: Pick<VoiceItem, "text" | "reasons" | "category" | "subject">): ThemeKey[] {
  const words = `${item.subject ?? ""}\n${item.text}`;
  const out: ThemeKey[] = [];
  for (const t of THEMES) {
    const byReason = !!t.reasons && !!item.reasons?.some((r) => t.reasons!.includes(r));
    const byCategory = !!t.categories && !!item.category && t.categories.includes(item.category);
    if (byReason || byCategory || t.words.test(words)) out.push(t.key);
  }
  if (!out.includes("competitor") && toolsNamed(words).some((n) => n !== "Pen and paper" && n !== "Spreadsheets" && n !== "QuickBooks")) out.push("competitor");
  return out;
}

/** The sentence that carries the theme — the customer's own words, at most ~220 characters. */
export function quoteFor(text: string, theme: ThemeKey | null): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  const t = theme ? THEMES.find((x) => x.key === theme) : null;
  const at = Math.max(0, t ? sentences.findIndex((s) => t.words.test(s)) : 0);
  let hit = sentences[at] ?? clean;
  // "Would love that." alone says nothing: a short sentence is quoted with the one it answers.
  if (hit.split(/\s+/).length < 6 && sentences.length > 1) hit = at > 0 ? `${sentences[at - 1]} ${hit}` : `${hit} ${sentences[at + 1] ?? ""}`.trim();
  return hit.length > 220 ? `${hit.slice(0, 217).replace(/\s+\S*$/, "")}…` : hit;
}

export interface ThemeSummary {
  key: ThemeKey;
  label: string;
  tone: (typeof THEMES)[number]["tone"];
  items: number;
  companies: number;
  /** The last 90 days. */
  recent: number;
  quotes: Array<{ id: string; at: number; text: string; company: string; trade: string; region: string | null; source: VoiceSource }>;
}

export function voiceSummary(items: VoiceItem[], now: number): { themes: ThemeSummary[]; tools: Array<{ name: string; companies: number }>; total: number; companies: number } {
  const themes: ThemeSummary[] = THEMES.map((t) => {
    const hits = items.filter((i) => themesOf(i).includes(t.key)).sort((a, b) => b.at - a.at);
    return {
      key: t.key,
      label: t.label,
      tone: t.tone,
      items: hits.length,
      companies: new Set(hits.map((h) => h.orgId ?? h.company)).size,
      recent: hits.filter((h) => now - h.at <= 90 * DAY).length,
      // Words a person wrote; a bare ticked reason with no text is counted, not quoted.
      quotes: hits.filter((h) => h.text.trim().length >= 12).slice(0, 4).map((h) => ({ id: h.id, at: h.at, text: quoteFor(h.text, t.key), company: h.company, trade: h.trade, region: h.region, source: h.source })),
    };
  }).sort((a, b) => b.companies - a.companies || b.items - a.items);
  const toolOrgs = new Map<string, Set<string>>();
  for (const i of items) for (const n of toolsNamed(`${i.subject ?? ""}\n${i.text}`)) toolOrgs.set(n, (toolOrgs.get(n) ?? new Set()).add(i.orgId ?? i.company));
  const tools = [...toolOrgs.entries()].map(([name, s]) => ({ name, companies: s.size })).sort((a, b) => b.companies - a.companies);
  return { themes, tools, total: items.length, companies: new Set(items.map((i) => i.orgId ?? i.company)).size };
}

/* ── interviews ────────────────────────────────────────────────────────────────────────────────────────────────── */

export interface InterviewStats {
  total: number;
  byKind: Record<InterviewKind, number>;
  /** Rated the pain 4 or 5, of those asked. */
  painHigh: Rate;
  painAvg: number | null;
  wouldPay: Rate;
  maybe: number;
  priceMedian: number | null;
  tools: Array<{ name: string; n: number }>;
  last30: number;
}

export function interviewStats(list: Interview[], now: number): InterviewStats {
  const byKind = { problem: 0, solution: 0, validation: 0, exit: 0 } as Record<InterviewKind, number>;
  for (const i of list) byKind[i.kind] += 1;
  const rated = list.filter((i) => i.pain !== null);
  const asked = list.filter((i) => i.wouldPay !== null);
  const toolCount = new Map<string, number>();
  for (const i of list) {
    const named = toolsNamed(i.currentTool);
    const names = named.length ? named : i.currentTool.trim() ? [i.currentTool.trim().replace(/^./, (c) => c.toUpperCase())] : [];
    for (const n of names) toolCount.set(n, (toolCount.get(n) ?? 0) + 1);
  }
  return {
    total: list.length,
    byKind,
    painHigh: rate(rated.filter((i) => (i.pain as number) >= 4).length, rated.length),
    painAvg: rated.length ? rated.reduce((s, i) => s + (i.pain as number), 0) / rated.length : null,
    wouldPay: rate(asked.filter((i) => i.wouldPay === "yes").length, asked.length),
    maybe: asked.filter((i) => i.wouldPay === "maybe").length,
    priceMedian: median(list.map((i) => i.priceSaid).filter((p): p is number => typeof p === "number" && p > 0)),
    tools: [...toolCount.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 8),
    last30: list.filter((i) => now - i.at <= 30 * DAY).length,
  };
}

/** What a logged interview may hold — trimmed, bounded, the closed lists checked. */
export function checkInterview(raw: unknown): { ok: true; value: Omit<Interview, "id" | "by" | "createdAt"> } | { ok: false; error: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const company = str(r.company, 120);
  if (!company) return { ok: false, error: "Type the company." };
  const at = typeof r.at === "string" || typeof r.at === "number" ? new Date(r.at).getTime() : NaN;
  if (!Number.isFinite(at)) return { ok: false, error: "Pick the date of the conversation." };
  const kind = INTERVIEW_KINDS.some((k) => k.key === r.kind) ? (r.kind as InterviewKind) : null;
  if (!kind) return { ok: false, error: "Pick what kind of interview it was." };
  const channel = CHANNELS.some((c) => c.key === r.channel) ? (r.channel as Interview["channel"]) : "call";
  const painN = Number(r.pain);
  const pain = r.pain === null || r.pain === "" || r.pain === undefined ? null : Number.isInteger(painN) && painN >= 1 && painN <= 5 ? painN : NaN;
  if (Number.isNaN(pain)) return { ok: false, error: "Pain is a number from 1 to 5." };
  const wouldPay = r.wouldPay === "yes" || r.wouldPay === "maybe" || r.wouldPay === "no" ? r.wouldPay : null;
  const priceN = Number(String(r.priceSaid ?? "").replace(/[$,\s]/g, ""));
  const priceSaid = r.priceSaid === null || r.priceSaid === "" || r.priceSaid === undefined ? null : Number.isFinite(priceN) && priceN > 0 && priceN < 100_000 ? Math.round(priceN) : NaN;
  if (Number.isNaN(priceSaid)) return { ok: false, error: "The price they named is a dollar amount a month." };
  const hyps = Array.isArray(r.hypotheses)
    ? (r.hypotheses as unknown[])
        .map((h) => (h && typeof h === "object" ? (h as Record<string, unknown>) : {}))
        .filter((h) => typeof h.id === "string" && /^[\w-]{1,60}$/.test(h.id) && (h.effect === "supports" || h.effect === "refutes"))
        .map((h) => ({ id: h.id as string, effect: h.effect as "supports" | "refutes" }))
        .slice(0, 20)
    : [];
  return {
    ok: true,
    value: {
      at: Math.min(at, Date.now() + DAY),
      orgId: typeof r.orgId === "string" && /^[\w-]{1,64}$/.test(r.orgId) ? r.orgId : null,
      company,
      person: str(r.person, 120),
      trade: str(r.trade, 60) || "Not given",
      kind,
      channel,
      pain: pain as number | null,
      currentTool: str(r.currentTool, 120),
      wouldPay,
      priceSaid: priceSaid as number | null,
      quote: str(r.quote, 1000),
      notes: str(r.notes, 4000),
      hypotheses: hyps,
    },
  };
}

/* ── hypotheses ────────────────────────────────────────────────────────────────────────────────────────────────── */

export type HypArea = "customer" | "problem" | "solution" | "channel" | "revenue" | "retention";
export const AREAS: ReadonlyArray<{ key: HypArea; label: string }> = [
  { key: "customer", label: "Customer" },
  { key: "problem", label: "Problem" },
  { key: "solution", label: "Solution" },
  { key: "channel", label: "Channel" },
  { key: "revenue", label: "Revenue" },
  { key: "retention", label: "Retention" },
];

export type MetricKey = "activation" | "proposalLift" | "trialToPaid" | "priceShare" | "easeShare" | "retention30" | "beachhead" | "adActivation" | "painHigh" | "wouldPay";
export type Verdict = "supported" | "refuted" | "early";
export type Status = "auto" | "testing" | "validated" | "invalidated";

export interface Hypothesis {
  id: string;
  area: HypArea;
  statement: string;
  /** How it is tested, in words. */
  test: string;
  metric: MetricKey | null;
  /** The bar: a share (0–1) or a ratio. */
  target: number | null;
  op: ">=" | "<=";
  /** The smallest sample the verdict is read from. */
  minN: number;
  custom: boolean;
}

/** The starting set, read from what JobFlex is and what it keeps. Their wording and bars can be changed by the owner. */
export const DEFAULT_HYPOTHESES: Hypothesis[] = [
  { id: "h-beachhead", area: "customer", statement: "One trade converts clearly better than the rest — those contractors are our early adopters.", test: "The best trade's trial → paid rate is at least 1.5× the average", metric: "beachhead", target: 1.5, op: ">=", minN: EARLY_ADOPTER_MIN_TRIALS, custom: false },
  { id: "h-pain", area: "problem", statement: "Estimates and proposals eat hours every week, and contractors feel it.", test: "At least 60% of interviewed contractors rate the pain 4 or 5", metric: "painHigh", target: 0.6, op: ">=", minN: 10, custom: false },
  { id: "h-activation", area: "solution", statement: "A contractor who signs up tries an estimator in the first week.", test: "At least 40% of sign-ups use an estimator or make a proposal within 7 days", metric: "activation", target: 0.4, op: ">=", minN: 20, custom: false },
  { id: "h-ease", area: "solution", statement: "Contractors can start without help.", test: "At most 20% of what customers write is about it being hard to use", metric: "easeShare", target: 0.2, op: "<=", minN: 10, custom: false },
  { id: "h-proposal", area: "solution", statement: "Sending a real proposal during the trial is what turns a trial into a customer.", test: "Trials that sent a proposal pay at least 2× as often as trials that did not", metric: "proposalLift", target: 2, op: ">=", minN: 10, custom: false },
  { id: "h-ads", area: "channel", statement: "Paid ads bring contractors who actually use the product.", test: "Sign-ups from ads activate at least 80% as often as the rest", metric: "adActivation", target: 0.8, op: ">=", minN: 10, custom: false },
  { id: "h-trial-paid", area: "revenue", statement: "At least 15% of finished trials become paying customers.", test: "Trial → paid rate of decided trials", metric: "trialToPaid", target: 0.15, op: ">=", minN: 10, custom: false },
  { id: "h-wtp", area: "revenue", statement: "Contractors who have the problem would pay for JobFlex at our price.", test: "At least half of the interviewed say yes when asked if they would pay", metric: "wouldPay", target: 0.5, op: ">=", minN: 8, custom: false },
  { id: "h-price", area: "revenue", statement: "Price is not what makes people leave.", test: "At most 30% of cancellations give price as a reason", metric: "priceShare", target: 0.3, op: "<=", minN: 5, custom: false },
  { id: "h-retention", area: "retention", statement: "Customers who pay stay past their first month.", test: "At least 80% of customers paying for 30+ days are still paying", metric: "retention30", target: 0.8, op: ">=", minN: 5, custom: false },
];

/** The owner's edits and verdicts on a hypothesis, and the ones they added. */
export interface HypothesisEdit {
  id: string;
  status: Status;
  notes: string;
  statement?: string;
  test?: string;
  area?: HypArea;
  target?: number | null;
  archived?: boolean;
  /** A hypothesis the owner wrote (no metric — judged by its status and the interviews). */
  custom?: boolean;
  history: Array<{ at: number; status: Status; by: string | null }>;
}

export interface Measures {
  activation: Rate;
  proposalLift: { value: number | null; n: number; withRate: Rate; withoutRate: Rate };
  trialToPaid: Rate;
  priceShare: Rate;
  easeShare: Rate;
  retention30: Rate;
  beachhead: { value: number | null; n: number; trade: string | null };
  adActivation: { value: number | null; n: number; ads: Rate; rest: Rate };
  painHigh: Rate;
  wouldPay: Rate;
}

export function measures(orgs: OrgFact[], cancels: CancelFact[], voice: VoiceItem[], interviews: Interview[], now: number): Measures {
  const st = orgs.map((o) => [o, orgState(o, now)] as const);
  const old = st.filter(([, s]) => s.weekOld);
  const decided = st.filter(([, s]) => s.trialDecided);
  const sentD = decided.filter(([o]) => o.sent > 0);
  const notSentD = decided.filter(([o]) => o.sent === 0);
  const withRate = rate(sentD.filter(([, s]) => s.everPaid).length, sentD.length);
  const withoutRate = rate(notSentD.filter(([, s]) => s.everPaid).length, notSentD.length);
  const lift = withRate.value === null ? null : withoutRate.value === null ? null : withoutRate.value === 0 ? (withRate.value > 0 ? Infinity : null) : withRate.value / withoutRate.value;
  const tenured = st.filter(([, s]) => s.everPaid && s.paidSince !== null && now - s.paidSince >= 30 * DAY);
  const overall = segmentRow("All", orgs, now);
  const ea = earlyAdopters(segmentsBy(orgs, now, (o) => o.trade), overall);
  const ads = old.filter(([o]) => o.fromAd);
  const rest = old.filter(([o]) => !o.fromAd);
  const adsRate = rate(ads.filter(([, s]) => s.activatedWeek1).length, ads.length);
  const restRate = rate(rest.filter(([, s]) => s.activatedWeek1).length, rest.length);
  const rated = interviews.filter((i) => i.pain !== null);
  const asked = interviews.filter((i) => i.wouldPay !== null);
  return {
    activation: rate(old.filter(([, s]) => s.activatedWeek1).length, old.length),
    proposalLift: { value: lift, n: decided.length, withRate, withoutRate },
    trialToPaid: rate(decided.filter(([, s]) => s.everPaid).length, decided.length),
    priceShare: rate(cancels.filter((c) => c.reasons.includes("too_expensive")).length, cancels.length),
    easeShare: rate(voice.filter((v) => themesOf(v).includes("ease")).length, voice.length),
    retention30: rate(tenured.filter(([, s]) => s.payingNow).length, tenured.length),
    beachhead: { value: ea?.lift ?? null, n: overall.trialToPaid.of, trade: ea?.row.key ?? null },
    adActivation: { value: adsRate.value !== null && restRate.value ? adsRate.value / restRate.value : null, n: ads.length, ads: adsRate, rest: restRate },
    painHigh: rate(rated.filter((i) => (i.pain as number) >= 4).length, rated.length),
    wouldPay: rate(asked.filter((i) => i.wouldPay === "yes").length, asked.length),
  };
}

export interface Evidence {
  value: number | null;
  /** "38% · 12 of 31", "2.4× · 18 trials". */
  shown: string;
  n: number;
}

export function evidenceFor(metric: MetricKey | null, m: Measures): Evidence | null {
  if (!metric) return null;
  const share = (r: Rate): Evidence => ({ value: r.value, shown: r.value === null ? "No data yet" : `${pct(r)} · ${r.n} of ${r.of}`, n: r.of });
  switch (metric) {
    case "activation": return share(m.activation);
    case "trialToPaid": return share(m.trialToPaid);
    case "priceShare": return share(m.priceShare);
    case "easeShare": return share(m.easeShare);
    case "retention30": return share(m.retention30);
    case "painHigh": return share(m.painHigh);
    case "wouldPay": return share(m.wouldPay);
    case "proposalLift": {
      const v = m.proposalLift.value;
      const shown = v === null ? "No data yet" : v === Infinity ? `Only those who sent one paid · ${m.proposalLift.n} trials` : `${v.toFixed(1)}× · ${pct(m.proposalLift.withRate)} vs ${pct(m.proposalLift.withoutRate)}`;
      return { value: v, shown, n: m.proposalLift.n };
    }
    case "beachhead": {
      const v = m.beachhead.value;
      return { value: v, shown: v === null ? `Not enough decided trials per trade yet · ${m.beachhead.n}` : `${m.beachhead.trade}: ${v.toFixed(1)}× the average`, n: m.beachhead.n };
    }
    case "adActivation": {
      const v = m.adActivation.value;
      return { value: v, shown: v === null ? "No data yet" : `${v.toFixed(2)}× · ads ${pct(m.adActivation.ads)} vs others ${pct(m.adActivation.rest)}`, n: m.adActivation.n };
    }
  }
}

export function verdictOf(h: Pick<Hypothesis, "metric" | "target" | "op" | "minN">, e: Evidence | null): Verdict {
  if (!e || h.target === null || e.value === null || e.n < h.minN) return "early";
  const pass = h.op === ">=" ? e.value >= h.target : e.value <= h.target;
  return pass ? "supported" : "refuted";
}

export interface HypothesisView extends Hypothesis {
  status: Status;
  notes: string;
  archived: boolean;
  evidence: Evidence | null;
  auto: Verdict;
  /** What it reads as: the owner's verdict, else the data's. */
  shown: "validated" | "invalidated" | "testing" | "supported" | "refuted" | "early";
  interviews: { supports: number; refutes: number };
  history: HypothesisEdit["history"];
}

export function hypothesisViews(edits: HypothesisEdit[], m: Measures, interviews: Interview[]): HypothesisView[] {
  const byId = new Map(edits.map((e) => [e.id, e]));
  const customs: Hypothesis[] = edits
    .filter((e) => e.custom && !DEFAULT_HYPOTHESES.some((d) => d.id === e.id))
    .map((e) => ({ id: e.id, area: e.area ?? "problem", statement: e.statement ?? "", test: e.test ?? "", metric: null, target: null, op: ">=", minN: 0, custom: true }));
  return [...DEFAULT_HYPOTHESES, ...customs].map((h) => {
    const e = byId.get(h.id);
    const merged: Hypothesis = { ...h, statement: e?.statement || h.statement, test: e?.test || h.test, area: e?.area ?? h.area, target: e?.target !== undefined && e.target !== null && h.metric ? e.target : h.target };
    const evidence = evidenceFor(merged.metric, m);
    const auto = verdictOf(merged, evidence);
    const status = e?.status ?? "auto";
    const sup = interviews.filter((i) => i.hypotheses.some((x) => x.id === h.id && x.effect === "supports")).length;
    const ref = interviews.filter((i) => i.hypotheses.some((x) => x.id === h.id && x.effect === "refutes")).length;
    return {
      ...merged,
      status,
      notes: e?.notes ?? "",
      archived: !!e?.archived,
      evidence,
      auto,
      shown: status === "auto" ? auto : status,
      interviews: { supports: sup, refutes: ref },
      history: e?.history ?? [],
    };
  });
}

/** The bar as words: "≥ 40%", "≤ 30%", "≥ 1.5×". */
export function targetWords(h: Pick<Hypothesis, "metric" | "target" | "op">): string {
  if (h.target === null || !h.metric) return "Judged by interviews";
  const ratio = h.metric === "proposalLift" || h.metric === "beachhead" || h.metric === "adActivation";
  return `${h.op === ">=" ? "≥" : "≤"} ${ratio ? `${h.target}×` : `${Math.round(h.target * 100)}%`}`;
}

/** Paying customers at the end of each of the last `months` months, oldest first (this month: today). */
export function payingByMonth(orgs: OrgFact[], now: number, months = 6): number[] {
  const d = new Date(now);
  const out: number[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const end = i === 0 ? now : Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i + 1, 1) - 1;
    out.push(
      orgs.filter((o) => {
        const s = orgState(o, now);
        if (!s.everPaid || s.paidSince === null || s.paidSince > end) return false;
        return s.payingNow || (o.sub?.canceledAt ?? Infinity) > end;
      }).length,
    );
  }
  return out;
}

/* ── the four steps ────────────────────────────────────────────────────────────────────────────────────────────── */

export interface Criterion {
  label: string;
  met: boolean;
  /** Where it stands now. */
  now: string;
}
export interface StageView {
  key: "discovery" | "validation" | "creation" | "building";
  label: string;
  question: string;
  criteria: Criterion[];
  done: boolean;
}

export function stages(input: { orgs: OrgFact[]; interviews: Interview[]; m: Measures; payingByMonth: number[]; now: number }): { list: StageView[]; current: StageView["key"] } {
  const { orgs, interviews, m, payingByMonth, now } = input;
  const st = orgs.map((o) => orgState(o, now));
  const paying = st.filter((s) => s.payingNow).length;
  const problemTalks = interviews.filter((i) => i.kind === "problem" || i.kind === "solution").length;
  const segRows = segmentsBy(orgs, now, (o) => o.channel);
  const everPaid = st.filter((s) => s.everPaid).length;
  const topChannel = segRows.map((r) => ({ key: r.key, paid: r.trialToPaid.n })).sort((a, b) => b.paid - a.paid)[0];
  const channelShare = everPaid && topChannel ? topChannel.paid / everPaid : null;
  // Month over month growth of paying customers, the last three months (payingByMonth: oldest → newest).
  const growth = payingByMonth.slice(-4).map((v, i, a) => (i === 0 || !a[i - 1] ? null : v / a[i - 1] - 1)).slice(1);
  const grewEveryMonth = growth.length === 3 && growth.every((g) => g !== null && g >= 0.15);
  const list: StageView[] = [
    {
      key: "discovery",
      label: "Customer discovery",
      question: "Do contractors have the problem we think, badly enough to want it solved?",
      criteria: [
        { label: "15 problem or solution interviews logged", met: problemTalks >= 15, now: `${problemTalks} logged` },
        { label: "60% rate the pain 4 or 5", met: m.painHigh.value !== null && m.painHigh.of >= 10 && m.painHigh.value >= 0.6, now: m.painHigh.of ? `${pct(m.painHigh)} of ${m.painHigh.of}` : "Not asked yet" },
        { label: "An early-adopter trade stands out (1.5× the average)", met: (m.beachhead.value ?? 0) >= 1.5, now: m.beachhead.trade ? `${m.beachhead.trade} · ${m.beachhead.value?.toFixed(1)}×` : "Not enough trials per trade" },
      ],
      done: false,
    },
    {
      key: "validation",
      label: "Customer validation",
      question: "Will they pay, and can we sell it again and again?",
      criteria: [
        { label: "10 paying customers", met: paying >= 10, now: `${paying} paying` },
        { label: "15% of finished trials pay", met: m.trialToPaid.value !== null && m.trialToPaid.of >= 10 && m.trialToPaid.value >= 0.15, now: m.trialToPaid.of ? `${pct(m.trialToPaid)} of ${m.trialToPaid.of}` : "No finished trials" },
        { label: "80% still paying after their first month", met: m.retention30.value !== null && m.retention30.of >= 5 && m.retention30.value >= 0.8, now: m.retention30.of ? `${pct(m.retention30)} of ${m.retention30.of}` : "Too early" },
        { label: "One channel brings 40% of paying customers", met: channelShare !== null && everPaid >= 5 && channelShare >= 0.4, now: channelShare !== null && topChannel ? `${topChannel.key} · ${pct(channelShare)}` : "Too early" },
      ],
      done: false,
    },
    {
      key: "creation",
      label: "Customer creation",
      question: "Can we grow demand on purpose, with the channel that works?",
      criteria: [
        { label: "50 paying customers", met: paying >= 50, now: `${paying} paying` },
        { label: "Paying customers grow 15% a month, three months running", met: grewEveryMonth, now: growth.length ? growth.map((g) => (g === null ? "—" : `${g >= 0 ? "+" : ""}${Math.round(g * 100)}%`)).join(" · ") : "Too early" },
      ],
      done: false,
    },
    {
      key: "building",
      label: "Company building",
      question: "Turn the learning into departments and process.",
      criteria: [{ label: "250 paying customers", met: paying >= 250, now: `${paying} paying` }],
      done: false,
    },
  ];
  for (const s of list) s.done = s.criteria.every((c) => c.met);
  const current = list.find((s) => !s.done)?.key ?? "building";
  return { list, current };
}

/* ── who to talk to next ───────────────────────────────────────────────────────────────────────────────────────── */

export type CallGroup = "paying" | "trial-ending" | "quiet" | "left" | "wrote";
export const CALL_GROUPS: ReadonlyArray<{ key: CallGroup; label: string; kind: InterviewKind; why: string; questions: string[] }> = [
  {
    key: "trial-ending",
    label: "Trial ends in 3 days",
    kind: "solution",
    why: "They used it — learn what decides the purchase.",
    questions: ["Which job did you try it on? Walk me through it.", "What would still have to be true for you to keep paying for it?", "How do you do estimates when you're not using JobFlex?"],
  },
  {
    key: "left",
    label: "Cancelled lately",
    kind: "exit",
    why: "The fastest way to learn what is missing.",
    questions: ["Walk me through the moment you decided to cancel.", "What are you using now instead?", "What would have had to be different for you to stay?"],
  },
  {
    key: "wrote",
    label: "Wrote to support",
    kind: "problem",
    why: "They told us something — go one level deeper.",
    questions: ["Tell me about the last job where you needed that.", "How do you handle it today?", "How often does it come up in a month?"],
  },
  {
    key: "quiet",
    label: "Signed up, then nothing",
    kind: "problem",
    why: "They came for something and did not find it.",
    questions: ["What were you hoping JobFlex would do for you?", "What got in the way the day you signed up?", "Tell me about the last estimate you sent — how long did it take?"],
  },
  {
    key: "paying",
    label: "Paying customers",
    kind: "validation",
    why: "They chose to pay — learn why, and what they would miss.",
    questions: ["What were you using before JobFlex, and what made you switch?", "If JobFlex went away tomorrow, what would you miss the most?", "Who else do you know who has the same problem?"],
  },
];

export interface CallCard {
  group: CallGroup;
  orgId: string;
  company: string;
  trade: string;
  contact: OrgFact["contact"];
  /** One line on why this account, now. */
  reason: string;
  at: number;
}

export function callList(orgs: OrgFact[], cancels: CancelFact[], voice: VoiceItem[], interviews: Interview[], now: number, perGroup = 8): CallCard[] {
  const talkedTo = new Set(interviews.filter((i) => now - i.at <= 30 * DAY && i.orgId).map((i) => i.orgId as string));
  const byId = new Map(orgs.map((o) => [o.id, o]));
  const out: CallCard[] = [];
  const add = (group: CallGroup, o: OrgFact, reason: string, at: number) => {
    if (talkedTo.has(o.id) || out.some((c) => c.orgId === o.id)) return;
    if (!o.contact.email && !o.contact.phone) return;
    out.push({ group, orgId: o.id, company: o.name, trade: o.trade, contact: o.contact, reason, at });
  };
  const st = orgs.map((o) => [o, orgState(o, now)] as const);
  // Cancelled lately first: their reasons are fresh.
  for (const c of [...cancels].filter((c) => now - c.at <= 45 * DAY).sort((a, b) => b.at - a.at).slice(0, perGroup)) {
    const o = byId.get(c.orgId);
    if (o) add("left", o, `Cancelled ${daysAgo(c.at, now)}${c.reasons.length ? ` — ${c.reasons.map(reasonWords).join(", ")}` : ""}`, c.at);
  }
  for (const [o] of st.filter(([o, s]) => s.trialing && o.sub?.trialEndsAt && o.sub.trialEndsAt - now <= 3 * DAY && o.firstValueAt !== null).sort((a, b) => (a[0].sub?.trialEndsAt ?? 0) - (b[0].sub?.trialEndsAt ?? 0)).slice(0, perGroup)) {
    add("trial-ending", o, `Trial ends ${inDays(o.sub?.trialEndsAt ?? now, now)} · ${o.estimates + o.proposals} estimates and proposals`, o.sub?.trialEndsAt ?? now);
  }
  for (const v of [...voice].filter((v) => (v.source === "support" || v.source === "email") && v.orgId && now - v.at <= 30 * DAY).sort((a, b) => b.at - a.at)) {
    const o = byId.get(v.orgId as string);
    if (o && out.filter((c) => c.group === "wrote").length < perGroup) add("wrote", o, `Wrote ${daysAgo(v.at, now)}: “${quoteFor(v.text, null).slice(0, 90)}”`, v.at);
  }
  for (const [o] of st.filter(([o, s]) => s.payingNow && o.contact.email).sort((a, b) => (b[0].lastSeenAt ?? 0) - (a[0].lastSeenAt ?? 0)).slice(0, perGroup)) {
    add("paying", o, `Paying · ${o.sent} proposals sent`, o.lastSeenAt ?? o.createdAt);
  }
  for (const [o] of st.filter(([o]) => o.firstValueAt === null && now - o.createdAt >= 3 * DAY && now - o.createdAt <= 30 * DAY).sort((a, b) => b[0].createdAt - a[0].createdAt).slice(0, perGroup)) {
    add("quiet", o, `Signed up ${daysAgo(o.createdAt, now)} · no estimate or proposal yet`, o.createdAt);
  }
  // One from each group in turn (the groups in CALL_GROUPS order, the freshest first inside a group), so the first
  // few cards are a mix — not six paying customers.
  const groups = CALL_GROUPS.map((g) => out.filter((c) => c.group === g.key).sort((a, b) => (g.key === "trial-ending" ? a.at - b.at : b.at - a.at)));
  const mixed: CallCard[] = [];
  for (let i = 0; groups.some((g) => i < g.length); i++) for (const g of groups) if (i < g.length) mixed.push(g[i]);
  return mixed;
}

const REASON_WORDS: Record<string, string> = { too_expensive: "price", not_enough_jobs: "not enough jobs", missing_feature: "missing a feature", hard_to_use: "hard to use", switched_tool: "switched tools", just_testing: "just testing", other: "other" };
const reasonWords = (k: string) => REASON_WORDS[k] ?? k;
export function daysAgo(t: number, now: number): string {
  const d = Math.floor((now - t) / DAY);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}
function inDays(t: number, now: number): string {
  const d = Math.ceil((t - now) / DAY);
  return d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
}

/* ── the weekly scorecard (kept from the day the page was first opened) ────────────────────────────────────────── */

export interface WeekScore {
  week: string;
  at: number;
  signups: number;
  payingNow: number;
  activation: number | null;
  trialToPaid: number | null;
  retention30: number | null;
  interviews: number;
  validated: number;
  invalidated: number;
  voice: number;
}

/** The list with this week's score in its place (one per ISO week, the latest of it), at most two years. */
export function withWeek(list: WeekScore[], score: WeekScore): WeekScore[] {
  return [...list.filter((w) => w.week !== score.week), score].sort((a, b) => a.week.localeCompare(b.week)).slice(-104);
}

/** For the report: a customer by trade and state, never by name. */
export const anonymous = (trade: string, region: string | null) => `${trade === "Not given" ? "Contractor" : `${trade} contractor`}${region ? ` · ${region}` : ""}`;

/** The state off a US address ("… Lehi, UT 84043" → "UT"). */
export function regionOf(address: string | null | undefined): string | null {
  const m = /\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/.exec(address ?? "") ?? /,\s*([A-Z]{2})\s*$/.exec((address ?? "").trim());
  return m ? m[1] : null;
}
