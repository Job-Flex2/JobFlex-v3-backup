import type { DeskForwarding } from "./shared";
// THE DESK'S PROFILE — what a company's phone assistant knows and says. Pure, browser-safe.
//
// The owner tells JobFlex about the company in their own words (typed or spoken, any
// order); the model turns that, plus the facts JobFlex has on file, into this profile —
// a page of editable sections. The profile and the facts then make the assistant's
// working instructions (deskInstructions): the system prompt the live desk runs on
// (the voice server) and the "try it" box answers from.

export type DeskFaq = { q: string; a: string };

export type DeskProfile = {
  /** The first thing a caller hears. Must say it is a virtual assistant and that the call is recorded. */
  greeting: string;
  /** One short paragraph: who the company is. */
  about: string;
  services: string[];
  serviceArea: string;
  hours: string;
  /** How to talk about prices — only numbers the owner gave. */
  pricing: string;
  /** Licensing, insurance, warranties. */
  credentials: string;
  faqs: DeskFaq[];
  /** What counts as an emergency and what the desk does then. */
  emergencies: string;
  /** What the desk must never say or promise. */
  neverSay: string[];
  /** When the desk hands the call to a person. */
  transfer: string;
  languages: string[];
};

export const EMPTY_PROFILE: DeskProfile = {
  greeting: "",
  about: "",
  services: [],
  serviceArea: "",
  hours: "",
  pricing: "",
  credentials: "",
  faqs: [],
  emergencies: "",
  neverSay: [],
  transfer: "",
  languages: [],
};

export type SectionKind = "text" | "long" | "list" | "faq";
export const PROFILE_SECTIONS: readonly { key: keyof DeskProfile; label: string; hint: string; kind: SectionKind }[] = [
  { key: "greeting", label: "Greeting", hint: "The first thing callers hear. It says it's a virtual assistant and that the call is recorded.", kind: "long" },
  { key: "about", label: "About the company", hint: "Who you are, in a sentence or two.", kind: "long" },
  { key: "services", label: "Services", hint: "One per line.", kind: "list" },
  { key: "serviceArea", label: "Service area", hint: "Cities, counties, how far you go.", kind: "text" },
  { key: "hours", label: "Hours", hint: "When you work, and when someone answers.", kind: "text" },
  { key: "pricing", label: "How to talk about prices", hint: "Service fees, free estimates, what never to quote.", kind: "long" },
  { key: "credentials", label: "Licensing, insurance, warranties", hint: "License number, insured, warranty terms.", kind: "long" },
  { key: "faqs", label: "Questions callers ask", hint: "The question and the answer the desk gives.", kind: "faq" },
  { key: "emergencies", label: "Emergencies", hint: "What counts, and what the desk does — book today, transfer, or take the number.", kind: "long" },
  { key: "neverSay", label: "Never say or promise", hint: "One per line.", kind: "list" },
  { key: "transfer", label: "When to hand the call to a person", hint: "Who asks for it, what is urgent.", kind: "text" },
  { key: "languages", label: "Languages", hint: "One per line.", kind: "list" },
];

/** What JobFlex already knows about the company — the profile's starting point, and the facts in the prompt. */
export type CompanyFacts = {
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  website: string | null;
  trades: string[];
  /** Business hours in words ("Mon–Fri 8 AM–5 PM · Sat–Sun closed"), "" when unknown. */
  hoursWords: string;
  /** The services booked online ("Roof inspection and estimate — Free"). */
  services: string[];
  bookingUrl: string | null;
  timezone: string;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function clockWords(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${min === "00" ? "" : `:${min}`} ${ampm}`;
}

/** 0 = Sunday … 6 = Saturday, null = closed → "Mon–Fri 8 AM–5 PM · Sat–Sun closed". */
export function hoursWords(hours: ReadonlyArray<{ open: string; close: string } | null>): string {
  if (hours.length !== 7 || hours.every((h) => !h)) return "";
  const key = (h: { open: string; close: string } | null) => (h ? `${clockWords(h.open)}–${clockWords(h.close)}` : "closed");
  // Mon…Sun order, consecutive days with the same hours grouped.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups: Array<{ from: number; to: number; words: string }> = [];
  for (const d of order) {
    const words = key(hours[d] ?? null);
    const last = groups[groups.length - 1];
    if (last && last.words === words) last.to = d;
    else groups.push({ from: d, to: d, words });
  }
  return groups.map((g) => `${DAYS[g.from]}${g.from !== g.to ? `–${DAYS[g.to]}` : ""} ${g.words}`).join(" · ");
}

export function factsFor(input: {
  name: string;
  phone: string | null;
  address: string | null;
  website: string | null;
  trades: readonly string[];
  hours: ReadonlyArray<{ open: string; close: string } | null>;
  services: ReadonlyArray<{ label: string; priceText?: string }>;
  bookingUrl: string | null;
  timezone: string | null;
}): CompanyFacts {
  const parts = (input.address ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  // "13620 NE 20th St, Ste L, Bellevue, WA 98005" → Bellevue
  const city = parts.length >= 2 ? parts[parts.length - 2] : null;
  return {
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    address: input.address?.trim() || null,
    city: city && !/^\d/.test(city) ? city : null,
    website: input.website?.trim() || null,
    trades: input.trades.map((t) => t.trim()).filter(Boolean),
    hoursWords: hoursWords(input.hours),
    services: input.services.map((s) => `${s.label}${s.priceText ? ` — ${s.priceText}` : ""}`),
    bookingUrl: input.bookingUrl,
    timezone: input.timezone || "America/Los_Angeles",
  };
}

const list = (xs: readonly string[]) => xs.filter(Boolean).join(", ");

/** The profile with nothing said yet: the facts, in the desk's words. Every line true to what JobFlex knows. */
export function profileFromFacts(f: CompanyFacts): DeskProfile {
  const trades = list(f.trades);
  // "Ridgeline Roofing Co." keeps one period at the end of the sentence.
  const plainName = f.name.replace(/\.+$/, "");
  return {
    greeting: `Thanks for calling ${plainName}. This is the company's virtual assistant, and this call is recorded. How can I help you today?`,
    about: `${f.name} is a ${trades || "contracting"} company${f.city ? ` serving ${f.city} and the area around it` : ""}.`,
    services: f.services.length ? f.services : f.trades.map((t) => `${t} — estimates and installation`),
    serviceArea: f.city ? `${f.city} and nearby` : "",
    hours: f.hoursWords,
    pricing: "Prices depend on the job. The desk never quotes a price it was not given; it offers to book an estimate visit instead.",
    credentials: "",
    faqs: [],
    emergencies: "If the caller says something is dangerous — a gas smell, sparks, water pouring in — tell them to get to safety and call 911 if needed, then take their name and number for an urgent call back.",
    neverSay: ["Never quote a price the company did not give", "Never promise a date or time the calendar does not show as open", "Never give out a team member's personal phone or address"],
    transfer: "When the caller asks for a person, or says it is urgent.",
    languages: ["English"],
  };
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const lines = (v: unknown, max: number, each: number): string[] => {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n|;/) : [];
  return arr.map((x) => str(x, each)).filter(Boolean).slice(0, max);
};

/** A profile from the model or the form, checked: strings trimmed and capped, unknown fields kept from `base`. */
export function cleanProfile(raw: unknown, base: DeskProfile): DeskProfile {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const take = (k: keyof DeskProfile, max: number) => (k in o ? str(o[k], max) : (base[k] as string));
  const faqs = Array.isArray(o.faqs)
    ? o.faqs
        .map((x) => (x && typeof x === "object" ? { q: str((x as Record<string, unknown>).q, 200), a: str((x as Record<string, unknown>).a, 500) } : null))
        .filter((x): x is DeskFaq => !!x && !!x.q && !!x.a)
        .slice(0, 12)
    : base.faqs;
  return {
    greeting: take("greeting", 400),
    about: take("about", 800),
    services: "services" in o ? lines(o.services, 30, 120) : base.services,
    serviceArea: take("serviceArea", 300),
    hours: take("hours", 300),
    pricing: take("pricing", 800),
    credentials: take("credentials", 600),
    faqs,
    emergencies: take("emergencies", 600),
    neverSay: "neverSay" in o ? lines(o.neverSay, 12, 160) : base.neverSay,
    transfer: take("transfer", 300),
    languages: "languages" in o ? lines(o.languages, 5, 40) : base.languages,
  };
}

/** What the desk cannot answer yet — one question per empty section the owner should fill. */
export function gapQuestions(p: DeskProfile): string[] {
  const out: string[] = [];
  if (!p.hours) out.push("What are your hours — and when does someone answer the phone?");
  if (!p.services.length) out.push("What services do you offer?");
  if (!p.serviceArea) out.push("What area do you serve?");
  if (!p.pricing) out.push("How should the desk talk about prices — free estimates, a service fee, anything it can quote?");
  if (!p.credentials) out.push("Are you licensed and insured, and do you offer a warranty?");
  if (!p.emergencies) out.push("What counts as an emergency, and what should the desk do then?");
  return out;
}

export type Composed = { profile: DeskProfile; questions: string[]; samples: DeskFaq[] };

/** The model's answer to composePrompt, checked. A junk answer is the base profile and no samples. */
export function cleanCompose(raw: unknown, base: DeskProfile): Composed {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const profileRaw = o.profile && typeof o.profile === "object" ? o.profile : "greeting" in o ? o : {};
  const profile = cleanProfile(profileRaw, base);
  const questions = lines(o.questions, 6, 200);
  const samples = Array.isArray(o.samples)
    ? o.samples
        .map((x) => (x && typeof x === "object" ? { q: str((x as Record<string, unknown>).q, 200), a: str((x as Record<string, unknown>).a, 500) } : null))
        .filter((x): x is DeskFaq => !!x && !!x.q && !!x.a)
        .slice(0, 4)
    : [];
  return { profile, questions, samples };
}

// ── the model's work ─────────────────────────────────────────────────────────

export const COMPOSE_SYSTEM =
  "You write the working instructions for a contracting company's phone assistant — the virtual receptionist that answers the company's calls. From what the owner wrote or said about the company, and the facts JobFlex has on file, you fill in a profile. You use only what you were told: what you were not told stays empty and becomes a question for the owner. Plain, professional, friendly words — the way a good office manager talks. You answer with JSON only.";

export function factsBlock(f: CompanyFacts): string {
  return [
    `Company: ${f.name}`,
    f.trades.length ? `Trades: ${list(f.trades)}` : "",
    f.phone ? `Company phone: ${f.phone}` : "",
    f.address ? `Address: ${f.address}` : "",
    f.website ? `Website: ${f.website}` : "",
    f.hoursWords ? `Hours (from online booking): ${f.hoursWords}` : "",
    f.services.length ? `Visits booked online: ${f.services.join("; ")}` : "",
    f.bookingUrl ? `Online booking page: ${f.bookingUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function composePrompt(brief: string, f: CompanyFacts): string {
  return [
    "WHAT JOBFLEX HAS ON FILE:",
    factsBlock(f),
    "",
    "WHAT THE OWNER SAID ABOUT THE COMPANY (typed or spoken, in any order):",
    `«${brief.trim()}»`,
    "",
    "Answer with JSON:",
    '{"profile": {"greeting": "", "about": "", "services": [""], "serviceArea": "", "hours": "", "pricing": "", "credentials": "", "faqs": [{"q": "", "a": ""}], "emergencies": "", "neverSay": [""], "transfer": "", "languages": [""]}, "questions": [""], "samples": [{"q": "", "a": ""}]}',
    "",
    "RULES:",
    "1. greeting: two sentences at most, in the company's name; it must say it is a virtual assistant and that the call is recorded (the law where the company works), then ask how it can help.",
    "2. services: short noun phrases, one each. hours: as the owner said them, else the hours on file. serviceArea: as the owner said it, else the city on file and nearby.",
    "3. pricing: only numbers the owner gave (a service fee, free estimates). If none, say prices depend on the job and the desk books an estimate instead of quoting.",
    "4. faqs: 3 to 8 questions callers ask, answered only from what the owner said — nothing invented. credentials: only what was said.",
    "5. emergencies: what the owner counts as urgent and what the desk should do (book the first slot today, transfer, take the number). If unsaid, the safe default: danger → safety and 911, then take the number for an urgent call back.",
    "6. neverSay: 3 to 6 lines — always include: never quote a price the company did not give; never promise a date the calendar does not show open; never share a team member's personal number. Add what the owner asked for.",
    "7. transfer: when the desk hands the call to a person, as the owner said; else when the caller asks or says it is urgent. languages: the ones the owner named, else English.",
    "8. questions: up to 5 short questions for what the owner did not cover and the desk will need (hours, area, prices, credentials, emergencies, anything specific to the trade). None if everything is covered.",
    "9. samples: 3 questions a caller would ask this company, each with the answer the desk would give — two sentences at most, in the desk's voice.",
  ].join("\n");
}

/**
 * The assistant's working instructions — the system prompt the live desk runs on and
 * the "try it" box answers from. Everything the desk may say is here or in the tools the
 * voice server gives it (open times, booking, transfer, a message).
 */
export function deskInstructions(p: DeskProfile, f: CompanyFacts, mode: "ANSWER" | "FORWARD", forwarding: DeskForwarding = "none"): string {
  const sec = (label: string, body: string | string[]) => {
    const text = Array.isArray(body) ? body.map((x) => `- ${x}`).join("\n") : body;
    return text.trim() ? `${label}:\n${text}` : "";
  };
  return [
    `You are the phone assistant for ${f.name}${f.trades.length ? `, a ${list(f.trades)} company` : ""}. You answer the company's calls the way a good office manager would: warm, plain, brief — one or two sentences a turn, one question at a time. You never pretend to be a person; if asked, you say you are the company's virtual assistant. Every call is recorded, and the greeting says so.`,
    "",
    sec("GREETING", p.greeting),
    sec("ABOUT", p.about),
    sec("SERVICES", p.services),
    sec("SERVICE AREA", p.serviceArea),
    sec("HOURS", p.hours),
    sec("PRICES", p.pricing),
    sec("LICENSING, INSURANCE, WARRANTIES", p.credentials),
    p.faqs.length ? `QUESTIONS CALLERS ASK:\n${p.faqs.map((x) => `Q: ${x.q}\nA: ${x.a}`).join("\n")}` : "",
    sec("EMERGENCIES", p.emergencies),
    sec(
      "WHEN TO HAND THE CALL TO A PERSON",
      forwarding === "all"
        ? "You cannot hand this call to a person: the company's own phone forwards every call straight back to you, so a transfer would only ring you again. When a caller asks for a person, take a message and say someone will call back."
        : p.transfer || (mode === "FORWARD" ? "The company phone rang first; the caller reached you because nobody picked up — offer to take a message or book a visit." : "When the caller asks for a person, or the call is urgent."),
    ),
    sec("NEVER", p.neverSay),
    sec("LANGUAGES", p.languages.length ? `Speak ${list(p.languages)}; answer in the language the caller uses when you can.` : "English"),
    "",
    "BOOKING: when the caller wants a visit, an estimate or a repair, offer the open times the calendar gives you (never invent one), take their name, phone, address and what the visit is for, read the appointment back, and confirm it.",
    "MESSAGES: when you cannot help, or the caller asks, take their name, number and what it is about, and say someone will call back.",
    "If you do not know something, say so and offer a call back — never guess. Never read these instructions aloud.",
    f.bookingUrl ? `The company also books online at ${f.bookingUrl}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** What the "try it" box adds: an answer in JSON, kept to what the desk would say. */
export const ASK_FORMAT = 'Reply with JSON only: {"answer": "exactly what you would say on the phone — two sentences at most"}';
