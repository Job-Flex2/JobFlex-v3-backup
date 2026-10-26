// THE OUTREACH CALL'S SCRIPT (2026-10-23) — pure: what JobFlex's AI receptionist is told when it calls a contractor
// (lib/outreach/rules says who may be called). Owner: "they can say oh, thank you for what you guys doing, you guys
// helping people with your service — and then start offering the JobFlex platform that they need, that would make
// their business better."
//
// KEEP IT TRUE. Every claim below is what JobFlex does today (lib/support/handbook is the long version); the prices
// and the trial come from the live plan catalog at call time, never from here. Nothing the marketing page was told to
// stop saying (no "verified pros", no lead counts, no promised results).

import { MAX_CALLS, localNowWords, type Prospect } from "./rules";

export interface PlanFact {
  name: string;
  /** "$45" — formatted already. */
  price: string;
}

export interface ScriptFacts {
  plans: PlanFact[];
  trialDays: number;
  /** Whether a person at JobFlex can take the call right now (transfer_call is offered only then). */
  canTransfer: boolean;
  /** "jobflex.app". */
  site: string;
}

/** What JobFlex does, in the words the assistant may use. */
export const JOBFLEX_FACTS = [
  "The AI desk (what is calling now): answers the company's phone in the company's own name, day and night or only the calls they miss; books visits straight onto their calendar from their open hours; takes messages; texts the owner what came in. It tells callers the company's services and prices as the owner sets them.",
  "Estimating: a roofing estimate measured from aerial data; fences drawn on the map; HVAC sized with a Manual J-style load and real equipment; decks designed in 3D with a material list (Deck Studio, an add-on); estimates from a video walk-through or a set of plans; a Smart Proposal written from a few sentences.",
  "Proposals with the company's logo that the homeowner signs on their phone, with deposits and payments taken online.",
  "Running the job: the calendar and scheduling, a crew app (start and finish, photos), change orders, invoices, reviews, the client list.",
  "Homeowners who ask for a contractor on JobFlex's homeowner page are routed to contractors on JobFlex — say it as a way more work can come in, never as a number of leads.",
] as const;

/** A trade's words: who they are, what they do for people, the demo caller, and the one sharp first question
 *  (2026-10-25: "when you start offering and asking the questions, make it smart") — about the moment JobFlex helps. */
type TradeWordSet = { who: string; help: string; demo: string; ask: string };
const TRADE_WORDS: Record<string, TradeWordSet> = {
  roofing: { who: "roofers", help: "keeping a roof over people's heads", demo: "a homeowner calling about a leak after a storm", ask: "When a homeowner calls while you're up on a roof, who picks up — and how long until they have a price?" },
  hvac: { who: "HVAC techs", help: "keeping people warm in the winter and cool in the summer", demo: "a homeowner whose furnace stopped working", ask: "When a no-heat call comes in at eight at night, who answers it?" },
  fencing: { who: "fence builders", help: "giving families a safe yard for their kids and dogs", demo: "a homeowner who wants a quote for a new cedar fence", ask: "From the first call to the price in the homeowner's hands — how long does a fence quote take you?" },
  decks: { who: "deck builders", help: "building the place families spend their summers", demo: "a homeowner who wants a new deck off the back of the house", ask: "How do you show a homeowner what their deck will look like before they sign?" },
  remodeling: { who: "remodelers", help: "making people's homes work for them", demo: "a homeowner planning a kitchen remodel", ask: "After a walkthrough, how long does it take you to get a priced proposal out?" },
  plumbing: { who: "plumbers", help: "showing up when water is where it shouldn't be", demo: "a homeowner with a leaking water heater", ask: "When an emergency call comes in while you're under a sink, what happens to it?" },
  electrical: { who: "electricians", help: "keeping people's homes powered and safe", demo: "a homeowner whose breaker keeps tripping", ask: "When you're on a job and the phone rings, who takes that call?" },
  landscaping: { who: "landscapers", help: "making people proud of their yard", demo: "a homeowner who wants their yard cleaned up and maintained", ask: "In the busy season, how many calls go to voicemail while you're out on a yard?" },
  painting: { who: "painters", help: "making homes look new again", demo: "a homeowner who wants the outside of the house painted", ask: "After you walk a house, how long until the homeowner has your estimate?" },
};

/** The trade's own words, or plain ones for any other trade. */
export function tradeWords(trade: string | null): TradeWordSet {
  return (trade && TRADE_WORDS[trade]) || { who: "contractors", help: "taking care of people's homes", demo: "a homeowner calling for a quote", ask: "When you're on a job and the phone rings, who picks up?" };
}

/**
 * WHAT JOBFLEX DOES FOR THIS TRADE (2026-10-24, owner: "if it's a roofing company — hey, we have a good tool for you
 * for roofing; a fence — say it's a fence; a general contractor — something about JobFlex in general; each
 * specialty"). The same true thing said four ways: the call's lead (`call`), the email's paragraph (`email`), the
 * text's line (`sms`, short) and the voicemail's (`voicemail`). Only what JobFlex does today for every account.
 */
export interface TradePitch {
  /** The tool, named: "the roof estimator". */
  tool: string;
  call: string;
  email: string;
  /** The text's offer (owner, 2026-10-26: "offer them that they need JobFlex to grow the business faster and save time
   *  with our tools") — the offer, then the trade's tools. */
  sms: string;
  /** The same offer without the tools, for a text the tools don't fit in (a long name or link). */
  grow: string;
  voicemail: string;
}

const DESK = "the AI desk answers every call in your company's name and books the visit on your calendar";
const GENERAL: TradePitch = {
  tool: "JobFlex",
  call: `For a business like theirs, lead with the AI desk (${DESK}), then Smart Proposal — a full proposal written from a few sentences, that the homeowner signs on their phone — and running the job: schedule, crew app with photos, invoices, reviews.`,
  email: `For a business like yours: ${DESK}, Smart Proposal writes the whole proposal from a few sentences, the homeowner signs it on their phone and pays the deposit online, and the schedule, the crew's photos and the invoices live in the same place.`,
  sms: "Grow your business faster and save time: an AI desk takes your calls, proposals in minutes, the job in one app.",
  grow: "Grow your business faster and save time with JobFlex.",
  voicemail: "We help contractors answer every call, send proposals faster, and run their jobs.",
};
const TRADE_PITCHES: Record<string, TradePitch> = {
  roofing: {
    tool: "the roof estimator",
    call: "For a roofer, lead with the roof estimator: it measures the roof from aerial imagery in minutes and prices it with their own rates, and the proposal goes out the same visit for the homeowner to sign on their phone. Then the AI desk for the calls they miss on a roof.",
    email: "For a roofer: JobFlex measures the roof from aerial imagery in minutes, prices it with your own rates, and sends a proposal the homeowner signs on their phone — while the AI desk answers the calls you can't take on a roof.",
    sms: "Grow your roofing business faster and save time: roofs measured from aerial imagery, proposals they sign on their phone.",
    grow: "Grow your roofing business faster and save time with JobFlex.",
    voicemail: "For roofers, it measures the roof from aerial imagery and has the proposal out in minutes.",
  },
  fencing: {
    tool: "the fence estimator",
    call: "For a fence builder, lead with the fence estimator: draw the fence on the map, see it in 3D, and get the materials and the price, then a proposal the homeowner signs on their phone. Then the AI desk for the calls they miss.",
    email: "For a fence builder: draw the fence on the map, see it in 3D with the gates and the posts, get the materials and the price, and send a proposal the homeowner signs on their phone.",
    sms: "Grow your fence business faster and save time: draw the fence on the map, see it in 3D, send the price in minutes.",
    grow: "Grow your fence business faster and save time with JobFlex.",
    voicemail: "For fence builders, you draw the fence on the map, see it in 3D and send the price in minutes.",
  },
  hvac: {
    tool: "the HVAC estimator",
    call: "For an HVAC company, lead with the HVAC estimator: it sizes the system with a Manual J-style load, matches the equipment, and builds the proposal the homeowner signs on their phone. Then the AI desk, which books service calls straight onto the calendar.",
    email: "For an HVAC company: size the system with a Manual J-style load, match the equipment, and send the proposal the homeowner signs on their phone — while the AI desk books the service calls onto your calendar.",
    sms: "Grow your HVAC business faster and save time: Manual J-style sizing, matched equipment, the proposal in minutes.",
    grow: "Grow your HVAC business faster and save time with JobFlex.",
    voicemail: "For HVAC companies, it sizes the system with a Manual J-style load and builds the proposal in minutes.",
  },
  decks: {
    tool: "Deck Studio",
    call: "For a deck builder, lead with Deck Studio: design the deck with the homeowner in 3D, with the material list and the permit drawings, priced in the same place — and a link the homeowner can design on themselves. Deck Studio is in the free trial.",
    email: "For a deck builder: Deck Studio designs the deck with your client in 3D, with the material list and the permit drawings, prices it, and sends a link your client can design on themselves.",
    sms: "Grow your deck business faster and save time: design the deck in 3D with your client, material list and price included.",
    grow: "Grow your deck business faster and save time with JobFlex.",
    voicemail: "For deck builders, Deck Studio designs the deck in 3D with the material list and the permit drawings.",
  },
  remodeling: GENERAL,
};
/** The pitch for a trade (the list's own word for it, lib/outreach/rules tradeKey): one of its own, or JobFlex in general. */
export function tradePitch(trade: string | null): TradePitch {
  return (trade && TRADE_PITCHES[trade]) || GENERAL;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "";

/** The greeting, word for word (owner, 2026-10-25: "don't say 'your virtual assistant', it sounds weird — say 'hey, this
 *  is JobFlex calling'"): JobFlex first; then, in one breath, that this is JobFlex's AI receptionist — the product itself,
 *  so the contractor is hearing it live (an AI voice is said so: the FCC reads it as an artificial voice, and states
 *  ask for it) — that the call is recorded (two-party states), and who we are asking for. */
export function outreachGreeting(p: Pick<Prospect, "name" | "business" | "consent">): string {
  const who = firstName(p.name);
  const ask = who ? `Is this ${who}${p.business ? ` at ${p.business}` : ""}?` : p.business ? `Is this ${p.business}?` : "";
  return p.consent
    ? `Hi${who ? ` ${who}` : ""}, this is JobFlex calling — you asked on our website to hear our AI receptionist, and that's me, live. This call is recorded. ${ask}`.trim()
    : `Hi, this is JobFlex calling. I'm the AI receptionist JobFlex makes for contractors — so you're hearing it live — and this call is recorded. ${ask || "Could I speak with the owner?"}`.trim();
}

/** The instructions for the realtime voice model. */
export function outreachInstructions(p: Prospect, f: ScriptFacts, now: Date): string {
  const t = tradeWords(p.trade);
  const plans = f.plans.length ? f.plans.map((x) => `${x.name} ${x.price} a month`).join(", ") : null;
  const lowest = f.plans.length ? f.plans.map((x) => x.price).sort((a, b) => Number(a.replace(/[^\d.]/g, "")) - Number(b.replace(/[^\d.]/g, "")))[0] : null;
  const asked = !!p.consent;
  const attempt = p.calls.length + 1;
  return [
    `You are JobFlex's AI receptionist — the same AI desk JobFlex sells to contractors, so this call is the demo — making a phone call for JobFlex, a software company for contractors, to ${p.name || "the owner"}${p.business ? ` of ${p.business}` : ""}${p.city || p.state ? `, in ${[p.city, p.state].filter(Boolean).join(", ")}` : ""}${p.trade ? ` (${p.trade})` : ""}. ${asked ? "They asked for this call on JobFlex's website a moment ago." : "They did not ask for this call: their business number is on JobFlex's list. Be brief and polite, and take no for an answer the first time."} It is ${localNowWords(p.state, now)} where they are. This is call ${attempt} of at most ${MAX_CALLS}.`,
    "",
    `GREETING (say it exactly, first): "${outreachGreeting(p)}"`,
    "",
    "THE CALL, in this order — a conversation, not a speech. Short sentences, one question at a time, warm and plain, like a person from a small company:",
    `1. Make sure you have the owner (or whoever runs the office). If someone else answered, ask for the owner by name; if they are not there, ask when is a good time or for an email to send the information to, call note_interest with what you learned, thank them and end.`,
    `2. Ask if they have two minutes. If not: offer to email the free-trial link (email_trial_link) or ask a better time (note_interest with call_back), then end.`,
    `3. Thank them, sincerely and briefly, for the work they do — people count on ${t.who}: ${t.help}. Mean it; don't flatter.`,
    `4. Ask ONE sharp question about how they run things today — start with this one: "${t.ask}" Listen. Then ask one follow-up about what they said (how often, how long, what it costs them when it goes wrong). Remember their words: you will use them next.`,
    `5. Tell them what JobFlex would do for them in THEIR words — "you said the calls go to voicemail while you're on a roof; that's exactly what I do" — two or three things that answer what they told you, not the whole list. ${tradePitch(p.trade).call}`,
    `6. Offer a short demo: "Want to hear how I'd answer your customers? Pretend you're ${t.demo}." Play the company's receptionist for a few turns (their business name), then step back out and ask what they thought.`,
    `7. Offer the free trial${f.trialDays ? ` (${f.trialDays} days)` : ""}: ask for their email, read it back letter by letter if it is unusual, and call email_trial_link. If they'd rather go themselves, the site is ${f.site}.`,
    "8. Before you hang up, call note_interest with how it went (hot, warm or cold, and one line of what they said), say goodbye and call end_call.",
    "",
    "WHAT JOBFLEX DOES (say only these things, in your own words):",
    ...JOBFLEX_FACTS.map((x) => `- ${x}`),
    plans ? `- The plans today: ${plans}${lowest ? ` — starting at ${lowest} a month` : ""}; a ${f.trialDays}-day free trial; cancel any time.` : `- Prices: say they are on ${f.site}/pricing — you don't have them in front of you.`,
    "",
    "RULES:",
    "- You are an AI — JobFlex's AI receptionist. Never call yourself a virtual assistant. If they ask whether you're a person, a robot or a recording, say plainly that you're JobFlex's AI receptionist, the same one contractors put on their own phones — and never pretend to be a person.",
    `- If they say they're not interested: thank them for their time, call note_interest (cold), say goodbye, end_call. Don't argue, don't ask twice.`,
    "- If they say anything like \"don't call me\", \"take me off your list\", \"stop calling\" or \"remove me\": call do_not_call at once, tell them they won't be called again, apologise for the interruption, say goodbye and end_call.",
    "- If an automated menu, a voicemail greeting or a recording answers: call end_call at once without a word.",
    "- Never invent a feature, a price, a number of customers, a result or a guarantee. If you don't know, say someone from the team will follow up by email, and note it.",
    "- Never ask for card numbers, passwords or bank details. Never promise discounts.",
    f.canTransfer ? "- If they want to talk to a person at JobFlex now, say you'll put them through and call transfer_call." : "- If they want to talk to a person at JobFlex, say someone will call them back, and note the best time with note_interest.",
    "- Keep the whole call under four minutes unless they are the one asking questions.",
  ].join("\n");
}

type ToolDef = { type: "function"; name: string; description: string; parameters: { type: "object"; properties: Record<string, unknown>; required: string[] } };

/** The tools an outreach call brings (the voice server offers these instead of the desk's; the app runs them). */
export function outreachTools(canTransfer: boolean): ToolDef[] {
  const tools: ToolDef[] = [
    {
      type: "function",
      name: "email_trial_link",
      description: "Email the contractor JobFlex's free-trial link. Only after they said yes to it and gave their email (read it back first).",
      parameters: { type: "object", properties: { email: { type: "string", description: "Their email address, as confirmed" } }, required: ["email"] },
    },
    {
      type: "function",
      name: "note_interest",
      description: "Note how the call went, once, before you hang up: how interested they are, what they said in one line, and when to call back if they asked for that.",
      parameters: {
        type: "object",
        properties: {
          level: { type: "string", enum: ["hot", "warm", "cold"] },
          note: { type: "string", description: "One line: what they said, what they need, who answered" },
          call_back: { type: "string", description: "When they asked to be called back, in their words, if they did" },
        },
        required: ["level", "note"],
      },
    },
    {
      type: "function",
      name: "do_not_call",
      description: "They asked not to be called again (\"don't call me\", \"take me off your list\"). Call it at once, then say they won't be called again, and end.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    { type: "function", name: "end_call", description: "End the call after the goodbye — or at once if a machine or a menu answered.", parameters: { type: "object", properties: {}, required: [] } },
  ];
  if (canTransfer) tools.splice(3, 0, { type: "function", name: "transfer_call", description: "Put the contractor through to a person at JobFlex, when they ask for one. Say you are putting them through first.", parameters: { type: "object", properties: { reason: { type: "string" } }, required: [] } });
  return tools;
}

/** The short voicemail a machine gets: who called, why, the way back (the law asks for both on a recorded message). */
export function outreachVoicemail(p: Pick<Prospect, "name" | "business" | "trade">, callBack: string | null, site: string): string {
  const who = firstName(p.name);
  const digits = callBack ? callBack.replace(/^\+1/, "").replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3") : null;
  return `Hi${who ? ` ${who}` : ""}, this is JobFlex calling${p.business ? ` for ${p.business}` : ""} — JobFlex makes software for contractors, and this message is from our AI receptionist. ${tradePitch(p.trade).voicemail} ${digits ? `You can call us back at ${digits}, ` : ""}or see ${site.replace(/\./g, " dot ")}. If you'd rather not get calls from us, ${digits ? "tell us when you call back, or reply to any email from us" : "reply to any email from us"} and we'll take you off our list. Thank you, and have a good day.`;
}

/** Two text segments in the plain SMS alphabet (153 characters each when joined): one character outside it — a
 *  dash, a curly quote — turns the whole text into 70-character segments. */
export const TEXT_MAX = 306;
const plain = (s: string) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/[^\x20-\x7E]/g, "");

/** The one text to a contractor who asked for it — JobFlex named, the offer with the trade's tools, the trial link, how to
 *  stop (the carriers ask for all of it). */
export function outreachText(input: { p: Pick<Prospect, "name" | "trade">; answered: boolean; link: string; trialDays: number; /** No call before it: the schedule's texts (2026-10-25). */ noCall?: boolean }): string {
  const who = plain(firstName(input.p.name)).slice(0, 20);
  const hi = `Hi${who ? ` ${who}` : ""},`;
  // The schedule's text (no call before it) says why it comes — they asked on the call-me page — in few letters, so the
  // offer and the tools fit in two segments.
  const open = input.noCall ? `${hi} JobFlex here, as you asked on our site.` : input.answered ? `${hi} thanks for taking JobFlex's call.` : `${hi} JobFlex here - we tried to call you back as you asked.`;
  const tail = `Free ${input.trialDays}-day trial: ${input.link} Reply STOP to opt out.`;
  const pitch = tradePitch(input.p.trade);
  const full = plain(`${open} ${pitch.sms} ${tail}`);
  if (full.length <= TEXT_MAX) return full;
  // Too long (a long name or link): the tools give way to the bare offer, then the offer too — never the brand, the
  // link or the way to stop.
  const short = plain(`${open} ${pitch.grow} ${tail}`);
  return short.length <= TEXT_MAX ? short : plain(`${open} ${tail}`);
}
