// WRITING TO ONE CONTRACTOR FROM THE ADMIN (owner, 2026-10-08: "an option in
// admin … write an email to them right off the card … it would extract his
// name, what trial he is on, if he's HVAC or a remodeler or a fence guy … the
// speech button … convert it into a professional email … sends right away …
// topics we would click, like offer 10% discount, already pre-built").
//
// THIS FILE IS PURE — no database, no network — so the composer can draft a
// topic in the browser the moment it is clicked, the server builds the very
// same email it previewed, and scripts/qa/admin-mail.check.ts proves every
// topic on made-up accounts. The I/O is in ./server.ts.
//
// IT READS LIKE A LETTER, NOT A CAMPAIGN (owner, 2026-10-08: "make it not
// go to spam"). A person writing to one customer: plain paragraphs, one
// link, a signature, a plain-text twin of every word, the sender's own name
// on the From line, subjects without prices, percentages or "free", and a
// one-click unsubscribe (./optout) that is honoured. No images, no tracking.
//
// EVERY SENTENCE IS TRUE OF THE ACCOUNT IT GOES TO. A topic is offered only
// where it applies (a trial reminder to a trial with no card, a thank-you to
// a paying shop, a win-back to an ended one), its words come from the
// account's own facts, and the 10% offer exists only where sending it also
// applies the discount (./server.ts): a mail never promises money the
// customer will not see.


// ── The account, as the composer sees it ───────────────────────────────────

export type AccountKind = "trialing" | "trial-ended" | "paying" | "past-due" | "canceled" | "free" | "none";
export type TradeKey = "roofing" | "fencing" | "hvac" | "general";

/** How the 10% would reach the customer, or why it cannot. */
export type OfferState =
  | { can: true; how: "winback"; pct: number; months: number; until: string; existing: boolean }
  | { can: true; how: "subscription"; pct: number; months: number; yearly: boolean }
  | { can: false; reason: string };

export interface ContractorProfile {
  orgId: string;
  business: string;
  owner: { name: string | null; firstName: string; email: string | null };
  /** The trade the mails speak to — the first the owner picked, else the ad's. */
  trade: { key: TradeKey; name: string };
  trades: string[];
  joinedAt: string;
  account: {
    kind: AccountKind;
    /** The Subscription row's status as stored ("TRIALING", "ACTIVE"…), "" without one. */
    status: string;
    plan: string;
    /** "$95/mo", "$950/yr", or "" when the plan has no price on record. */
    price: string;
    /** A trial: days left, when it ends, whether a card is on file. */
    daysLeft?: number;
    endsAt?: string | null;
    hasCard?: boolean;
    /** A card-less trial that ran out. */
    endedAt?: string | null;
  };
  built: { clients: number; proposals: number; jobs: number };
  lastSeenAt: string | null;
  offer: OfferState;
  history: SentMail[];
  internal: boolean;
  /** They pressed Unsubscribe on one of these emails (./optout): nothing more is sent. */
  optedOut: { at: string } | null;
}

export interface SentMail { at: string; subject: string; topic: string; by: string; offer: boolean }

// ── Small words ────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const LONG_DATE = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "America/Los_Angeles" });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Mike" from "Mike Carter"; "there" when there is no name. */
export function firstNameOf(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return first && !/@/.test(first) ? first[0].toUpperCase() + first.slice(1) : "there";
}

/** The trade as it reads inside a sentence: "roofing", "HVAC", "kitchen & bath". */
export function tradeWord(p: Pick<ContractorProfile, "trade">): string {
  const n = p.trade.name;
  if (!n) return "contracting";
  return n === "HVAC" ? "HVAC" : n.toLowerCase();
}

/** How long they have had JobFlex: "a day", "5 days", "3 weeks". */
export function ageWords(joinedAt: string, now: number): string {
  const days = Math.max(1, Math.round((now - Date.parse(joinedAt)) / DAY_MS));
  if (days === 1) return "a day";
  if (days < 14) return `${days} days`;
  const weeks = Math.round(days / 7);
  if (weeks < 9) return `${weeks} weeks`;
  return `${Math.round(days / 30)} months`;
}

/** "Everything you set up — 3 clients, 2 proposals — is still there…" */
function madeLine(p: ContractorProfile): string {
  const b = p.built;
  const made = [b.clients > 0 ? plural(b.clients, "client", "clients") : "", b.proposals > 0 ? plural(b.proposals, "proposal", "proposals") : "", b.jobs > 0 ? plural(b.jobs, "job", "jobs") : ""].filter(Boolean);
  return made.length ? `Everything you set up for ${p.business} — ${made.join(", ")} — is still there, exactly as you left it.` : `${p.business}'s workspace is still there, exactly as you left it.`;
}

/** The made-line right after "Hi Mike —": its first word in lower case (a business name keeps its own). */
const afterDash = (line: string) => (line.startsWith("Everything") ? `everything${line.slice("Everything".length)}` : line);

/** The estimator a contractor of this trade starts with, and how it goes. */
export const START_HERE: Record<TradeKey, { name: string; short: string; how: string; path: string }> = {
  roofing: { name: "the roof estimator", short: "the roof estimator", path: "/dashboard/roof-estimator",
    how: "type the address and hit Measure — the roof is measured, then priced line by line at your rates" },
  fencing: { name: "the fence estimator", short: "the fence estimator", path: "/dashboard/fence-estimator",
    how: "type the address and the lot line comes up; click the fence in, drop the gates, and it is priced while you draw" },
  hvac: { name: "the HVAC estimator", short: "the HVAC estimator", path: "/dashboard/hvac-estimator",
    how: "pick the job and type the address — the house comes in from the records, the system is sized to its load and every line is priced" },
  general: { name: "Smart Proposal", short: "Smart Proposal", path: "/dashboard/advanced-ai",
    how: "describe the job the way you would tell your foreman, or add a few photos — it writes the line items with prices you can change" },
};

// ── The topics ─────────────────────────────────────────────────────────────

export type TopicKey = "welcome" | "first-estimate" | "check-in" | "setup-call" | "trial-ending" | "offer" | "thanks" | "come-back" | "why-left";

export const TOPICS: ReadonlyArray<{ key: TopicKey; label: string; hint: string }> = [
  { key: "welcome", label: "Welcome", hint: "A personal hello right after they sign up" },
  { key: "first-estimate", label: "First estimate", hint: "How to price their first job, for their trade" },
  { key: "setup-call", label: "Setup call", hint: "Offer 15 minutes to set it up together" },
  { key: "check-in", label: "How's it going?", hint: "Ask how JobFlex is working for them" },
  { key: "trial-ending", label: "Trial ending", hint: "Remind them to add a card before the trial ends" },
  { key: "offer", label: "10% off · 3 months", hint: "Sending applies the discount" },
  { key: "thanks", label: "Thank you", hint: "Thank a paying customer" },
  { key: "come-back", label: "Come back", hint: "Their work is still there" },
  { key: "why-left", label: "What held you back?", hint: "Ask why they did not continue" },
];

export type Availability = { ok: true } | { ok: false; reason: string };

const isEnded = (k: AccountKind) => k === "trial-ended" || k === "canceled";

/** Whether a topic fits this account — and, when it does not, why not. */
export function topicAvailability(key: TopicKey, p: ContractorProfile, now = Date.now()): Availability {
  const k = p.account.kind;
  switch (key) {
    case "welcome":
      if (isEnded(k)) return { ok: false, reason: "Their trial or plan has ended" };
      return now - Date.parse(p.joinedAt) <= 21 * DAY_MS ? { ok: true } : { ok: false, reason: "For accounts in their first three weeks" };
    case "first-estimate":
    case "setup-call":
      return isEnded(k) ? { ok: false, reason: "Their account is not active" } : { ok: true };
    case "check-in":
      return { ok: true };
    case "trial-ending":
      return k === "trialing" && !p.account.hasCard ? { ok: true } : { ok: false, reason: k === "trialing" ? "Their card is already on file" : "Only for a trial with no card yet" };
    case "offer":
      return p.offer.can ? { ok: true } : { ok: false, reason: p.offer.reason };
    case "thanks":
      return k === "paying" || (k === "trialing" && p.account.hasCard) ? { ok: true } : { ok: false, reason: "For paying customers" };
    case "come-back":
    case "why-left":
      return isEnded(k) ? { ok: true } : { ok: false, reason: "For a trial that ended or a canceled plan" };
  }
}

/** The topics worth a first look for this account, best first. */
export function suggestedTopics(p: ContractorProfile, now = Date.now()): TopicKey[] {
  const order: Record<AccountKind, TopicKey[]> = {
    trialing: ["welcome", "first-estimate", "setup-call", "trial-ending", "check-in", "offer", "thanks"],
    paying: ["thanks", "welcome", "check-in", "setup-call", "first-estimate", "offer"],
    "trial-ended": ["come-back", "why-left", "offer", "check-in"],
    canceled: ["why-left", "come-back", "offer", "check-in"],
    "past-due": ["check-in", "welcome"],
    free: ["welcome", "first-estimate", "setup-call", "check-in"],
    none: ["welcome", "check-in"],
  };
  return order[p.account.kind].filter((k) => topicAvailability(k, p, now).ok);
}

// ── A draft: what the composer edits ───────────────────────────────────────

export interface Draft {
  subject: string;
  /** Paragraphs, one blank line between them. */
  body: string;
  /** The button, as a path in the app; null for none. */
  cta: { label: string; path: string } | null;
}

/** The offer, in one sentence a mail can carry word for word. */
export function offerSentence(p: ContractorProfile): string | null {
  const o = p.offer;
  if (!o.can) return null;
  if (o.how === "winback") return `${o.pct}% off ${p.account.plan} for your first ${o.months} months — applied by itself when you add your card, until ${LONG_DATE.format(new Date(o.until))}.`;
  // A trial with no card yet keeps the discount only by adding one — the mail says so.
  if (p.account.kind === "trialing" && !p.account.hasCard) {
    return o.yearly
      ? `${o.pct}% off your first yearly charge for ${p.account.plan} — already on your account; it applies by itself once you add a card before your trial ends.`
      : `${o.pct}% off ${p.account.plan} for your first ${o.months} monthly charges — already on your account; it applies by itself once you add a card before your trial ends.`;
  }
  return o.yearly
    ? `${o.pct}% off your next yearly charge for ${p.account.plan} — already applied to your subscription, nothing to do on your side.`
    : `${o.pct}% off ${p.account.plan} for your next ${o.months} monthly charges — already applied to your subscription, nothing to do on your side.`;
}

/** The trade's first step, in one paragraph. */
function startHere(p: ContractorProfile): string {
  const s = START_HERE[p.trade.key];
  return `The fastest way to see what it does for a ${tradeWord(p)} business is ${s.name}: ${s.how}.`;
}

/** A topic, written for this account. The composer shows it at once; any word can be changed before it goes. */
export function topicDraft(key: TopicKey, p: ContractorProfile, now = Date.now()): Draft {
  const first = p.owner.firstName;
  const s = START_HERE[p.trade.key];
  const price = p.account.price ? ` at ${p.account.price}` : "";
  const join = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join("\n\n");
  switch (key) {
    case "welcome":
      return {
        subject: `Welcome to JobFlex, ${first === "there" ? p.business : first}`,
        body: join(
          `Hi ${first} — thanks for signing ${p.business} up for JobFlex. I wanted to say hello myself and make sure your first days go smoothly.`,
          startHere(p),
          `If you tell me what kind of jobs you price most, I'll point you to the quickest way to do them in JobFlex — just reply to this email.`,
        ),
        cta: { label: `Open ${s.short}`, path: s.path },
      };
    case "first-estimate":
      return {
        subject: `Your first ${tradeWord(p)} estimate in JobFlex`,
        body: join(
          `Hi ${first} — here is the quickest way to get a real estimate out of JobFlex for ${p.business}.`,
          `Open ${s.name}: ${s.how}.`,
          `Then convert it to a proposal with one click — your client reads it and accepts it right from their phone.`,
          `Stuck anywhere? Reply and tell me where, and I'll walk you through it.`,
        ),
        cta: { label: `Open ${s.short}`, path: s.path },
      };
    case "setup-call":
      return {
        subject: "A 15-minute setup call, if it helps",
        body: join(
          `Hi ${first} — if you'd rather not figure JobFlex out alone, we can get on a 15-minute call and set ${p.business} up together: your prices, your first ${tradeWord(p)} estimate and the proposal your clients will see.`,
          `Reply with a day and time that works for you, and the best number to reach you.`,
        ),
        cta: null,
      };
    case "check-in":
      return {
        subject: `How is JobFlex working for ${p.business}?`,
        body: join(
          `Hi ${first} — you've had JobFlex for ${ageWords(p.joinedAt, now)} now, and I'd like to know how it's working for your ${tradeWord(p)} jobs.`,
          `What's one thing that would make it more useful for you? Even a one-line reply helps — we read every one.`,
        ),
        cta: null,
      };
    case "trial-ending": {
      const d = p.account.daysLeft ?? 0;
      const ends = p.account.endsAt ? LONG_DATE.format(new Date(p.account.endsAt)) : "";
      return {
        subject: d > 1 ? `Your JobFlex trial ends in ${d} days` : d === 1 ? "Your JobFlex trial ends tomorrow" : "Your JobFlex trial ends today",
        body: join(
          `Hi ${first} — your free trial of ${p.account.plan} ${ends ? `ends on ${ends}` : "is almost over"}. ${p.built.clients + p.built.proposals + p.built.jobs > 0 ? madeLine(p).replace("is still there, exactly as you left it", "stays right where it is") : ""}`.trim(),
          `Add a card before then to keep ${p.business} running${price}. Without one, the workspace turns read-only and nothing is charged.`,
        ),
        cta: { label: "Add a card", path: "/dashboard/trial" },
      };
    }
    case "offer": {
      const line = offerSentence(p) ?? "";
      const winback = p.offer.can && p.offer.how === "winback";
      return winback
        ? {
          subject: "Something to make coming back easier",
          body: join(`Hi ${first} — ${afterDash(madeLine(p))}`, `To make coming back easier: ${line}`),
          cta: { label: "Come back with the discount", path: "/dashboard/trial" },
        }
        : {
          subject: `A thank-you for ${p.business}`,
          body: join(`Hi ${first} — thank you for running ${p.business} on JobFlex.`, `As a thank-you: ${line}`, `If there's anything we can do better for your ${tradeWord(p)} work, just reply.`),
          cta: p.account.kind === "trialing" && !p.account.hasCard ? { label: "Add a card", path: "/dashboard/trial" } : null,
        };
    }
    case "thanks":
      return {
        subject: `Thank you, ${first === "there" ? p.business : first}`,
        body: join(
          `Hi ${first} — I saw ${p.business} is ${p.account.kind === "paying" ? `now on ${p.account.plan}${price}` : "all set with a card on file"}. Thank you — it means a lot to a small team like ours.`,
          `If anything in JobFlex slows you down on a ${tradeWord(p)} job, reply and tell me. A person reads every reply.`,
        ),
        cta: null,
      };
    case "come-back":
      return {
        subject: `${p.business} is still here`,
        body: p.account.kind === "canceled"
          // On the Free plan since the subscription ended (lib/freePlan): coming back is from Free.
          ? join(`Hi ${first} — ${p.business} is on the Free plan now, and ${afterDash(madeLine(p))}`, `If you'd like ${p.account.plan} back, it picks up right where you stopped${price} — straight from Free, nothing to set up again.`)
          : join(`Hi ${first} — ${afterDash(madeLine(p))}`, `If you'd like to pick it back up, you can carry on right where you stopped${price}.`),
        cta: p.account.kind === "trial-ended" ? { label: "Open my workspace", path: "/dashboard/trial" } : { label: "Choose a plan", path: "/dashboard/subscription" },
      };
    case "why-left":
      return {
        subject: "Can I ask what held you back?",
        body: join(
          `Hi ${first} — I noticed ${p.business} didn't continue with JobFlex, and I'd really like to know why.`,
          `Was it the price, something missing for ${tradeWord(p)} work, or just not the right time? A one-line reply is plenty — it comes straight to me.`,
        ),
        cta: null,
      };
  }
}

// ── The AI's part: dictation → a professional email ─────────────────────────

export const WRITE_LIMITS = { notes: 4000, subject: 90, body: 2200, paragraphs: 6 } as const;

/** The instructions and the facts for the model. The facts are the account's;
 *  the words to say are the admin's. Nothing else may enter the mail. */
export function writePrompt(input: { p: ContractorProfile; notes: string; sender: string; topic: Draft | null; offer: boolean; now?: number }): { system: string; user: string } {
  const { p } = input;
  const offer = input.offer ? offerSentence(p) : null;
  const facts = [
    `Business: ${p.business}`,
    `Owner's first name: ${p.owner.firstName === "there" ? "(unknown — open with \"Hi there\")" : p.owner.firstName}`,
    `Trade: ${p.trade.name || "not given"}`,
    `Account: ${accountWords(p)}`,
    `Joined JobFlex: ${ageWords(p.joinedAt, input.now ?? Date.now())} ago`,
    `What they have made in JobFlex: ${p.built.clients} clients, ${p.built.proposals} proposals, ${p.built.jobs} jobs`,
    `The estimator for their trade: ${START_HERE[p.trade.key].name} (${START_HERE[p.trade.key].how})`,
    `Sender: ${input.sender}, JobFlex`,
  ];
  const system = [
    "You write one short email from the JobFlex team to one contractor who has a JobFlex account. JobFlex is software for small US contractors: estimators, proposals clients accept on their phone, jobs, crews and invoices.",
    "Return JSON only: {\"subject\": string, \"paragraphs\": string[]}.",
    "Rules:",
    "1. Say what the sender asked to say — every point in the sender's words, nothing they did not ask for. If the words are rough or spoken, turn them into clear, warm, professional US English. Whatever language they are in, write the email in English.",
    "2. Use only the facts given. Never invent a price, a discount, a free month, a feature, a date, a call, a person or a result. Never mention money off unless an offer sentence is given — then include that sentence word for word, once.",
    "3. Open with \"Hi <first name> —\" (\"Hi there —\" when the name is unknown). Write as the sender, in the first person (\"I\", \"we\" for the team). No sign-off and no signature: the email adds them.",
    "4. 2 to 4 short paragraphs, under 130 words in all. Plain words, no emojis, no exclamation marks in a row, no \"I hope this email finds you well\", no placeholders in brackets.",
    "5. Subject: under 60 characters, specific and plain, like a person writing to a customer — no prices, no percentages, no \"free\", no \"discount\" or \"offer\", no exclamation marks, no words in capitals. Those read as ads to spam filters.",
  ].join("\n");
  const user = [
    "Facts about the contractor:",
    ...facts.map((f) => `- ${f}`),
    offer ? `\nOffer sentence (include word for word): ${offer}` : "\nNo offer is attached: do not mention any discount.",
    input.topic ? `\nThe email starts from this draft — keep its purpose, rewrite it with the sender's points:\nSubject: ${input.topic.subject}\n${input.topic.body}` : "",
    `\nWhat the sender wants to say (dictated, may be rough):\n"""${input.notes.slice(0, WRITE_LIMITS.notes)}"""`,
  ].join("\n");
  return { system, user };
}

/** The account in a few words, for the model. */
export function accountWords(p: ContractorProfile): string {
  const a = p.account;
  switch (a.kind) {
    case "trialing": return `on a free trial of ${a.plan}${a.price ? ` (${a.price} after)` : ""}, ${plural(a.daysLeft ?? 0, "day", "days")} left, ${a.hasCard ? "card on file" : "no card yet"}`;
    case "trial-ended": return `free trial of ${a.plan} ended with no card — the workspace is read-only`;
    case "paying": return `paying customer on ${a.plan}${a.price ? ` (${a.price})` : ""}`;
    case "past-due": return `subscription to ${a.plan} is past due — a payment failed`;
    case "canceled": return `on the Free plan since canceling ${a.plan} — nothing is billed`;
    case "free": return "on the free plan";
    default: return "no plan yet";
  }
}

/** The model's answer → a draft, or why it could not be used. */
export function parseWritten(raw: string): { ok: true; draft: Omit<Draft, "cta"> } | { ok: false; error: string } {
  let j: unknown;
  try { j = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return { ok: false, error: "The AI answered in a shape we could not read. Try again." }; }
  const o = (j ?? {}) as { subject?: unknown; paragraphs?: unknown };
  const subject = typeof o.subject === "string" ? o.subject.trim() : "";
  const paragraphs = Array.isArray(o.paragraphs) ? o.paragraphs.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : [];
  if (!subject || paragraphs.length === 0) return { ok: false, error: "The AI left the email empty. Try again with a few more words." };
  const body = paragraphs.slice(0, WRITE_LIMITS.paragraphs).join("\n\n");
  if (/\[[^\]]{1,40}\]|\{\{|<[A-Z][a-z]+>/.test(`${subject} ${body}`)) return { ok: false, error: "The AI left a placeholder in the email. Try again." };
  return { ok: true, draft: { subject: subject.slice(0, WRITE_LIMITS.subject), body: body.slice(0, WRITE_LIMITS.body) } };
}

/** Words in a subject line that read as an ad to a spam filter. The topics
 *  never use them; the composer warns when a typed or written subject does. */
export function spammySubject(subject: string): string | null {
  if (/[%$€£]|\d+\s*%/.test(subject)) return "a price or a percentage";
  if (/\b(free|discount|offer|deal|sale|save|limited|act now|guarantee|winner|urgent)\b/i.test(subject)) return `the word “${(subject.match(/\b(free|discount|offer|deal|sale|save|limited|act now|guarantee|winner|urgent)\b/i) as RegExpMatchArray)[0]}”`;
  if (/!/.test(subject)) return "an exclamation mark";
  if (/\b[A-Z]{4,}\b/.test(subject.replace(/\b(HVAC|JOBFLEX)\b/g, ""))) return "a word in capitals";
  return null;
}

// ── The email itself: a letter ─────────────────────────────────────────────

/** The paragraphs of a body: blank lines split them; single line breaks stay inside one. */
export function paragraphsOf(body: string): string[] {
  return body.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((x) => x.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface Letter { subject: string; html: string; text: string }

/** The email the contractor gets — the composer's preview and the send build
 *  it the same way. A letter: the paragraphs, the offer as one plain line,
 *  one link, the sender's name, then a small grey line with why they got it,
 *  the unsubscribe link and the postal address when one is set. */
export function contractorLetter(input: {
  draft: Draft; p: ContractorProfile; offer: boolean; base: string; sender: string;
  unsubscribeUrl: string; postal?: string | null;
}): Letter {
  const { draft, p } = input;
  const base = input.base.replace(/\/$/, "");
  const paras = paragraphsOf(draft.body);
  const o = p.offer;
  const offerLine = input.offer && o.can
    ? `${o.pct}% off ${o.how === "subscription" && o.yearly ? "your next yearly charge" : `for ${o.months} months`} — ${o.how === "winback" ? `until ${LONG_DATE.format(new Date(o.until))}` : p.account.kind === "trialing" && !p.account.hasCard ? "on your account" : "applied"}`
    : null;
  const link = draft.cta ? { label: draft.cta.label, href: `${base}${draft.cta.path}` } : null;
  const team = /jobflex/i.test(input.sender);
  const signName = input.sender;
  const signLine = team ? "jobflex.app" : "JobFlex · jobflex.app";
  const why = `You're getting this because ${p.business} has a JobFlex account.`;
  const P = 'style="margin:0 0 16px;font:15px/1.6 -apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;"';
  const html = [
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(draft.subject) + "</title></head>",
    '<body style="margin:0;padding:0;background:#ffffff;">',
    '<div style="max-width:560px;margin:0 auto;padding:28px 20px;">',
    ...paras.map((x) => `<p ${P}>${esc(x)}</p>`),
    offerLine ? `<p ${P}><strong>${esc(offerLine)}</strong></p>` : "",
    link ? `<p ${P}><a href="${esc(link.href)}" style="color:#1854a0;text-decoration:underline;">${esc(link.label)}</a></p>` : "",
    `<p style="margin:24px 0 0;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">${esc(signName)}<br><span style="color:#6a6a6a;">${esc(signLine)}</span></p>`,
    `<p style="margin:32px 0 0;padding-top:12px;border-top:1px solid #e5e5e5;font:12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#8a8a8a;">${esc(why)} <a href="${esc(input.unsubscribeUrl)}" style="color:#8a8a8a;text-decoration:underline;">Unsubscribe</a>${input.postal ? `<br>${esc(input.postal)}` : ""}</p>`,
    "</div></body></html>",
  ].filter(Boolean).join("\n");
  const text = [
    ...paras,
    offerLine,
    link ? `${link.label}: ${link.href}` : null,
    `${signName}\n${signLine}`,
    `--\n${why}\nUnsubscribe: ${input.unsubscribeUrl}${input.postal ? `\n${input.postal}` : ""}`,
  ].filter(Boolean).join("\n\n");
  return { subject: draft.subject.trim(), html, text };
}
