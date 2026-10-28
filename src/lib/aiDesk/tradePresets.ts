// THE DESK, PRESET FOR THE TRADE (owner, 2026-10-14: "when he types the nature of the business — remodeling, roofing,
// tile, whatever it is — preset all the questions that business needs, use the company's information, and the
// contractor just reviews it and corrects … then highlight the sensitive parts he has to look into").
//
// Pure, browser-safe. What the contractor types ("roofing, gutters", "bath remodels", "tile") is matched to the
// trades below; each brings the services callers ask about, the questions they ask that kind of company, and what
// counts as urgent. presetProfile puts them together with what JobFlex has on file (name, city, hours, the visits on
// the booking page) into the desk's profile — and a REVIEW list: every part that makes a claim or a promise to a
// caller (prices, licensing, warranties, the area, the hours, urgent calls, an answer that commits the company), each
// with why it matters and, where the choices are few, one-click fixes. A business with no preset here is written by
// the model in the same shape (packPrompt → cleanPack).
//
// Every preset answer is written so it is true for any company in the trade: where the honest answer depends on the
// company (financing, insurance claims, a trip fee), the preset says the team will go over it and is marked for review
// with the yes/no answers one click away.
import { BASIC_INTAKE, FINANCING_PRESET_ANSWERS, MAX_FAQS, MAX_INTAKE, type CompanyFacts, type DeskFaq, type DeskProfile } from "./profile";
import { faqKey, matchTrades, TRADES, yesNo, type DeskFix, type DeskReviewItem, type PackFaq, type TradePack } from "./tradeCore";
import { EXTERIOR_PACKS } from "./tradePacks/exterior";
import { INTERIOR_PACKS } from "./tradePacks/interior";
import { OUTDOOR_PACKS } from "./tradePacks/outdoor";
import { SYSTEMS_PACKS } from "./tradePacks/systems";

// The light half lives in tradeCore so the setup screen does not download every trade's text; the server imports it
// from here as it always has.
export { BUSINESS_SUGGESTIONS, CLAIMS_FAQ, cleanReview, faqKey, matchBusinessLabels, matchTrades, TRADES, yesNo } from "./tradeCore";
export type { DeskFix, DeskReviewItem, PackFaq, TradePack } from "./tradeCore";

/** Every trade with a preset (2026-10-16: 44 trades — services, intake and answers written per trade), in chip order. */
export const TRADE_PACKS: readonly TradePack[] = (() => {
  const all = new Map([...EXTERIOR_PACKS, ...OUTDOOR_PACKS, ...INTERIOR_PACKS, ...SYSTEMS_PACKS].map((p) => [p.key, p]));
  return TRADES.map((t) => all.get(t.key)).filter((p): p is TradePack => !!p);
})();

export const packByKey = (key: string) => TRADE_PACKS.find((p) => p.key === key) ?? null;

/** What the contractor typed → the trades with a preset (whole packs, for the preset), and the parts no preset knows. */
export function matchBusiness(text: string): { packs: TradePack[]; unknown: string[] } {
  const m = matchTrades(text);
  return { packs: m.keys.map((k) => packByKey(k)).filter((p): p is TradePack => !!p), unknown: m.unknown };
}

/** The field's starting value: the trades on file, in the contractor's own words. */
export function businessFromTrades(trades: readonly string[]): string {
  return trades.filter((t) => t && t !== "Other").join(", ");
}

// ── the profile ────────────────────────────────────────────────────────────

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");
const joinWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const uniqBy = <T,>(xs: T[], key: (x: T) => string) => {
  const seen = new Set<string>();
  return xs.filter((x) => { const k = key(x).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
};

const SAFETY = "If anyone is in danger — fire, sparks, smoke or a gas smell — tell them to get to safety and call 911 first.";
export const URGENT_ACTIONS = {
  book: { label: "Book the first open slot", text: "Offer the first open time — today if there is one — and mark the visit urgent." },
  transfer: { label: "Hand the call to me", text: "Hand the call to a person right away; if nobody answers, take the name, number and address for an urgent call back." },
  message: { label: "Take a message", text: "Take the name, number and address for an urgent call back, and tell them someone will call soon." },
} as const;

export function pricingFixes(): DeskFix[] {
  return [
    { label: "Free estimates", text: "Estimates are free. Prices depend on the job — the desk never quotes a price; it books a free estimate visit instead." },
    { label: "Estimate visit has a fee", text: "There is a fee for the estimate visit; the office confirms the amount. The desk never quotes job prices; it books the visit instead." },
    { label: "No prices on the phone", text: "The desk does not discuss prices or fees on the phone; it books a visit, and the team covers pricing there." },
  ];
}
export function credentialFixes(): DeskFix[] {
  return [
    { label: "Licensed and insured", text: "Licensed and insured." },
    { label: "…with a warranty", text: "Licensed and insured. The work comes with a workmanship warranty — the team explains the terms with the estimate." },
    { label: "Don't mention", text: "Don't discuss licensing, insurance or warranties on the phone — the team covers them at the estimate." },
  ];
}

export type Preset = { profile: DeskProfile; review: DeskReviewItem[]; trades: string[] };

/** The questions every trade's callers ask, before the trade's own. */
const FAQS_FIRST: PackFaq[] = [{ q: "How soon can someone come out?", a: "I can check the calendar right now and offer you the next open times." }];

/** …and after them. Payment terms, deposits and financing are the company's to say — marked, with the answers one click away. */
/** The preset financing answers live in ./profile (withFinancingAnswer reads them); re-exported for the presets' readers. */
export { FINANCING_PRESET_ANSWERS };

function faqsLast(bigTicket: boolean): PackFaq[] {
  return [
    { q: "Can you give me a price over the phone?", a: "Prices depend on the job, so the team gives you a price once they've seen it. I can book that visit now." },
    { q: "Do I need to be home for the visit?", a: "It's best if someone eighteen or older is home to let the team in and walk through the job with them." },
    { q: "Can I reschedule or cancel?", a: "Yes — just call this number and we'll find a new time." },
    {
      q: "What forms of payment do you take?",
      a: "The team goes over payment with the estimate.",
      check: "How you take payment.",
      fixes: [
        { label: "Cards, checks, online", text: "We take cards, checks and bank transfers, and you can pay online from the invoice." },
        { label: "Check or cash", text: "We take checks and cash — the team goes over it with the estimate." },
      ],
    },
    ...(bigTicket
      ? [
          {
            q: "Do you need a deposit?",
            a: "The team goes over the payment schedule with the estimate.",
            check: "Whether you take a deposit.",
            fixes: yesNo("For larger jobs there's a deposit when you sign, and the rest as the work is done — the estimate spells it out.", "There's no deposit — you pay when the work is done.", "Deposit on signing", "No deposit"),
          },
          {
            q: "Do you offer financing?",
            a: FINANCING_PRESET_ANSWERS[0],
            check: "Whether you offer financing.",
            fixes: yesNo(FINANCING_PRESET_ANSWERS[1], FINANCING_PRESET_ANSWERS[2]),
          },
        ]
      : []),
    {
      q: "Do you do commercial work?",
      a: "The team can tell you — I can take the details.",
      check: "Whether you take commercial jobs.",
      fixes: yesNo("Yes — we take commercial jobs as well as homes. I can book a visit.", "We work on homes only."),
    },
  ];
}

/** The intake every trade asks: the job first, then the facts every lead needs. */
const INTAKE_FIRST = "What would you like done — or what's going on — in your own words?";
function intakeLast(bigTicket: boolean): string[] {
  return [
    "What's the address of the job — and is it a house, condo, townhome or business?",
    "Do you own the property, or rent it?",
    "How soon do you need it — right away, in the next few weeks, or are you planning ahead?",
    ...(bigTicket ? ["Do you have a budget range in mind for the project? A rough range is fine.", "Is anyone else part of the decision — can they be there for the estimate?"] : []),
    "What's the best number and email to reach you, and when's a good time to call?",
    "How did you hear about us?",
    "Is there anything the team should know to get in — a gate code, pets, parking?",
  ];
}

/** Up to `cap` items from several lists, each list getting its fair share first (most-asked first), then the rest. */
function share<T>(lists: T[][], cap: number, key: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  const add = (x: T) => {
    const k = key(x).trim().toLowerCase();
    if (!k || seen.has(k) || out.length >= cap) return;
    seen.add(k);
    out.push(x);
  };
  const each = lists.length ? Math.max(1, Math.floor(cap / lists.length)) : 0;
  const taken = lists.map(() => 0);
  lists.forEach((l, i) => { for (const x of l) { if (taken[i] >= each) break; const before = out.length; add(x); if (out.length > before) taken[i]++; } });
  for (const l of lists) for (const x of l) add(x);
  // Back in list order, so a trade's lines stay together.
  const order = new Map<T, number>();
  let n = 0;
  for (const l of lists) for (const x of l) if (!order.has(x)) order.set(x, n++);
  return out.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/**
 * The trades + what JobFlex has on file → the desk's profile, and what the contractor should check. `typed` is the
 * contractor's own words for a business no preset matched (used in the about line and the services when nothing else).
 */
export function presetProfile(packs: readonly TradePack[], f: CompanyFacts, typed: string[] = []): Preset {
  const plainName = f.name.replace(/\.+$/, "") || "the company";
  const nouns = uniqBy([...packs.map((p) => p.noun), ...typed.map((t) => t.toLowerCase())], (x) => x).slice(0, 3);
  const kind = nouns.length ? joinWords(nouns) : "contracting";
  const big = packs.some((p) => p.bigTicket);
  const typedServices = packs.length ? [] : typed.map((t) => t.replace(/^\w/, (c) => c.toUpperCase()));
  const services = share([...packs.map((p) => p.services), typedServices], 30, (x) => x);
  const onBooking = f.services.filter((s) => /—/.test(s));
  const pricing = onBooking.length
    ? `Prices depend on the job. The visits on the booking page: ${onBooking.join("; ")}. The desk never quotes any other price; it offers to book an estimate visit instead.`
    : "Prices depend on the job. The desk never quotes a price it was not given; it offers to book an estimate visit instead.";
  const urgentWhat = packs.length ? packs.map((p) => p.urgent).join(" ") : "Something that can't wait — water coming in, no heat, a door that won't lock.";
  const emergency = (action: string) => `Urgent calls: ${urgentWhat} ${action} ${SAFETY}`;

  // What the company does, from each trade: "It fixes leaks, clears drains …; and installs and refinishes floors."
  const does = packs.map((p) => p.does).filter(Boolean);
  const doesLine = !does.length ? "" : does.length === 1 ? ` It ${does[0]}.` : ` It ${does.slice(0, -1).join("; ")}; and ${does[does.length - 1]}.`;

  const last = faqsLast(big);
  const tradeFaqs = share(packs.map((p) => p.faqs), MAX_FAQS - FAQS_FIRST.length - last.length, (x) => x.q);
  const finalFaqs = uniqBy([...FAQS_FIRST, ...tradeFaqs, ...last], (x) => x.q).slice(0, MAX_FAQS);

  // The trade's own questions; with more than one trade each says which kind of job it is for.
  const tail = intakeLast(big);
  const tradeIntake = share(packs.map((p) => (packs.length > 1 ? p.intake.map((q) => `${p.label}: ${q}`) : p.intake)), MAX_INTAKE - 1 - tail.length, (x) => x);
  const intake = packs.length || typed.length ? [INTAKE_FIRST, ...tradeIntake, ...tail] : [...BASIC_INTAKE];

  const profile: DeskProfile = {
    greeting: `Thanks for calling ${plainName}. This is the company's virtual assistant, and this call is recorded. How can I help you today?`,
    about: `${f.name || "The company"} is ${article(kind)} ${kind} company${f.city ? ` serving ${f.city} and the area around it` : ""}.${doesLine}`,
    knowledge: "",
    services: services.length ? services : f.services,
    serviceArea: f.city ? `${f.city} and nearby` : "",
    hours: f.hoursWords,
    pricing,
    credentials: "",
    faqs: finalFaqs.map((x): DeskFaq => ({ q: x.q, a: x.a })),
    intake,
    emergencies: emergency(URGENT_ACTIONS.book.text),
    neverSay: ["Never quote a price the company did not give", "Never promise a date or time the calendar does not show as open", "Never give out a team member's personal phone or address"],
    transfer: "When the caller asks for a person, or says it is urgent.",
    languages: ["English"],
  };

  const review: DeskReviewItem[] = [
    ...(does.length ? [{ key: "about", why: "Written from your trade — make sure it says what you do, and add what makes you different." }] : []),
    { key: "pricing", why: "Prices — the desk repeats this to every caller who asks.", fixes: pricingFixes() },
    { key: "credentials", why: "Licensing, insurance and warranty are claims — keep only what's true.", fixes: credentialFixes() },
    { key: "services", why: "Callers hear “yes, we do that” for every line — remove what you don't do, add what's missing." },
    { key: "serviceArea", why: f.city ? "Is this how far you go? The desk tells callers yes or no by it." : "Not on file — add the cities or area you serve." },
    ...(f.hoursWords ? [] : [{ key: "hours", why: "Not on file — the desk tells callers when you're open." }]),
    { key: "intake", why: "What the desk asks callers so every lead comes in complete — cut what you don't need, add what you always ask." },
    {
      key: "emergencies",
      why: "What the desk does when a call is urgent.",
      fixes: (Object.keys(URGENT_ACTIONS) as Array<keyof typeof URGENT_ACTIONS>).map((k) => ({ label: URGENT_ACTIONS[k].label, text: emergency(URGENT_ACTIONS[k].text) })),
    },
    ...finalFaqs.filter((x) => x.check).map((x) => ({ key: faqKey(x.q), why: x.check!, ...(x.fixes ? { fixes: x.fixes } : {}) })),
  ];
  return { profile, review, trades: [...packs.map((p) => p.label), ...typed] };
}

/** The review list kept to what still exists in the profile (a removed question takes its mark with it). */
export function pruneReview(review: readonly DeskReviewItem[], p: DeskProfile): DeskReviewItem[] {
  const faqs = new Set(p.faqs.map((x) => faqKey(x.q)));
  const sections = new Set(Object.keys(p));
  return review.filter((r) => (r.key.startsWith("faq:") ? faqs.has(r.key) : sections.has(r.key)));
}

// ── a business with no preset: the model writes one ─────────────────────────

export const PACK_SYSTEM =
  "You preset a home-service company's phone assistant for its kind of business. You know what callers ask that kind of company. You never state a fact about this particular company: where the honest answer depends on the company (a fee, financing, whether it offers something), the answer says the team will go over it and the question is marked for the owner to check. You answer with JSON only.";

export function packPrompt(business: string, f: CompanyFacts): string {
  return [
    `THE BUSINESS: «${business.trim().slice(0, 120)}»`,
    `Company: ${f.name}${f.city ? ` (${f.city})` : ""}`,
    "",
    "Answer with JSON:",
    '{"noun": "", "does": "", "services": [""], "intake": [""], "faqs": [{"q": "", "a": "", "check": "", "yes": "", "no": ""}], "urgent": "", "bigTicket": false}',
    "",
    "RULES:",
    '1. noun: the business in two or three words for "a ___ company" (e.g. "pool service"). does: what such a company does, third person, starting with a verb, 8 to 22 words, no claims of quality or years.',
    "2. services: 8 to 16 short noun phrases callers ask about — every specialty of this kind of business, most asked first.",
    "2b. intake: 4 to 7 questions the desk asks a caller about THIS kind of job so the team can estimate it (the problem or project, where, how big, what material or type, how old, what was tried). Not the address, timeline, budget, contact or how they heard — those are asked anyway. No prices.",
    "3. faqs: 6 to 10 questions callers really ask this kind of company. a: what the desk says — two sentences at most, true for ANY such company (never a price, a fee, a time, or a yes/no about this company). When the true answer depends on the company: a says the team will go over it; check says in a few words what the owner should confirm; yes and no are the two answers the owner can pick, each a sentence the desk would say. Otherwise check, yes and no are empty.",
    "4. urgent: one sentence — what counts as urgent for this business (with a safety step if there is one).",
    "5. bigTicket: true when jobs commonly cost thousands of dollars.",
  ].join("\n");
}

/** The model's pack, checked; null when it gave nothing usable. */
export function cleanPack(raw: unknown, business: string): TradePack | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const services = Array.isArray(o.services) ? o.services.map((x) => str(x, 80)).filter(Boolean).slice(0, 16) : [];
  const intake = Array.isArray(o.intake) ? o.intake.map((x) => str(x, 200)).filter(Boolean).slice(0, 7) : [];
  const faqs: PackFaq[] = Array.isArray(o.faqs)
    ? o.faqs
        .map((x): PackFaq | null => {
          if (!x || typeof x !== "object") return null;
          const r = x as Record<string, unknown>;
          const q = str(r.q, 200);
          const a = str(r.a, 400);
          if (!q || !a) return null;
          const check = str(r.check, 120);
          const yes = str(r.yes, 400);
          const no = str(r.no, 400);
          // Anything the model did not mark is still a claim it wrote — the owner checks every one.
          return { q, a, check: check || "Written by AI for your kind of business — check it.", ...(yes && no ? { fixes: yesNo(yes, no) } : {}) };
        })
        .filter((x): x is PackFaq => !!x)
        .slice(0, 10)
    : [];
  if (!services.length && !faqs.length) return null;
  const label = business.trim().replace(/^\w/, (c) => c.toUpperCase()).slice(0, 60);
  return {
    key: `ai:${label.toLowerCase()}`,
    label,
    noun: str(o.noun, 40).toLowerCase() || label.toLowerCase(),
    does: str(o.does, 200).replace(/\.$/, ""),
    services,
    intake,
    faqs,
    urgent: str(o.urgent, 300) || "Something that can't wait.",
    bigTicket: o.bigTicket === true,
  };
}

// ── after the model rewrites from the owner's words ────────────────────────

/** The sections where a changed line is a claim the owner should see. */
const SENSITIVE_SECTIONS = ["knowledge", "pricing", "credentials", "services", "serviceArea", "hours", "emergencies"] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The marks after the model rewrote the profile from what the owner said: a mark whose part did not change stays;
 * a sensitive section or a question the model changed or added is marked "written by AI from your words".
 */
export function reviewAfterCompose(before: DeskProfile, after: DeskProfile, review: readonly DeskReviewItem[]): DeskReviewItem[] {
  const byKey = new Map(review.map((r) => [r.key, r]));
  const out: DeskReviewItem[] = [];
  const why = "Written by AI from your words — check it.";
  for (const k of SENSITIVE_SECTIONS) {
    const old = byKey.get(k);
    if (same(before[k], after[k])) { if (old) out.push(old); }
    else if (k === "knowledge" && !after.knowledge) continue;
    else out.push({ key: k, why: k === "knowledge" ? "Written by AI from your words — read it through once: the desk answers every caller's question from it." : why, ...(old?.fixes ? { fixes: old.fixes } : {}) });
  }
  const beforeFaq = new Map(before.faqs.map((x) => [faqKey(x.q), x.a]));
  for (const x of after.faqs) {
    const k = faqKey(x.q);
    const old = byKey.get(k);
    if (beforeFaq.get(k) === x.a) { if (old) out.push(old); }
    else out.push({ key: k, why, ...(old?.fixes ? { fixes: old.fixes } : {}) });
  }
  return out;
}
