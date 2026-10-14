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
import type { CompanyFacts, DeskFaq, DeskProfile } from "./profile";

export type DeskFix = { label: string; text: string };
/** A part of the profile the contractor should look at: a section key, or "faq:<question>". */
export type DeskReviewItem = { key: string; why: string; fixes?: DeskFix[] };

type PackFaq = { q: string; a: string; check?: string; fixes?: DeskFix[] };
export type TradePack = {
  key: string;
  label: string;
  /** For "a ___ company". */
  noun: string;
  services: string[];
  faqs: PackFaq[];
  /** What counts as urgent for this trade, in a sentence. */
  urgent: string;
  /** Big jobs: callers ask about financing. */
  bigTicket?: boolean;
};

const yesNo = (yes: string, no: string, yesLabel = "Yes", noLabel = "No"): DeskFix[] => [
  { label: yesLabel, text: yes },
  { label: noLabel, text: no },
];

const CLAIMS_FAQ: PackFaq = {
  q: "Do you work with insurance claims?",
  a: "I'll note that you have a claim — the team will go over it with you when they come out. Would you like me to book an inspection?",
  check: "Whether you help with insurance claims — callers decide on it.",
  fixes: yesNo(
    "Yes — the team helps with insurance claims and can meet the adjuster. Would you like me to book an inspection?",
    "We don't handle insurance claims directly, but we can inspect and give you a written estimate for your claim.",
    "We help with claims",
    "We don't handle claims",
  ),
};

export const TRADE_PACKS: readonly TradePack[] = [
  {
    key: "roofing",
    label: "Roofing",
    noun: "roofing",
    bigTicket: true,
    services: ["Roof replacement", "Roof repair", "Leak repair", "Roof inspection", "Storm and hail damage", "Flashing and vent repair"],
    faqs: [
      { q: "Can someone look at a leak?", a: "Yes — I can book the first open time for someone to look at it. If water is coming in now, put a bucket under it and move anything valuable away." },
      CLAIMS_FAQ,
      { q: "How long does a roof replacement take?", a: "Most homes take one to three days, depending on the size and the weather — the estimate gives you the timeline for yours.", check: "A promise of time — change it if your jobs run differently." },
      { q: "What kinds of roofs do you install?", a: "The team goes over the roofing options for your home at the estimate — I can book that for you." },
    ],
    urgent: "A leak while it's raining, storm or wind damage, or a tree on the roof.",
  },
  {
    key: "gutters",
    label: "Gutters",
    noun: "gutter",
    services: ["Gutter installation", "Gutter repair", "Downspouts", "Gutter guards", "Gutter cleaning"],
    faqs: [
      { q: "Do you clean gutters?", a: "The team can tell you at the visit — I can book one for you.", check: "Whether you clean gutters — say yes or no.", fixes: yesNo("Yes — we clean gutters. I can book a time for you.", "We don't do cleaning on its own — we install and repair gutters.") },
      { q: "Do you install gutter guards?", a: "The team goes over gutter guards at the estimate — I can book that.", check: "Whether you install gutter guards.", fixes: yesNo("Yes — we install gutter guards. I can book an estimate.", "We don't install gutter guards.") },
    ],
    urgent: "A gutter pulling off the house, or water overflowing into a basement.",
  },
  {
    key: "siding",
    label: "Siding",
    noun: "siding",
    bigTicket: true,
    services: ["Siding replacement", "Siding repair", "Trim, soffit and fascia", "Exterior sealing and caulking"],
    faqs: [
      { q: "What siding do you install?", a: "The team goes over the siding options for your home at the estimate — I can book that for you." },
      CLAIMS_FAQ,
    ],
    urgent: "Storm damage that leaves a wall open to the rain.",
  },
  {
    key: "windows",
    label: "Windows & doors",
    noun: "window and door",
    bigTicket: true,
    services: ["Window replacement", "New window installation", "Entry doors", "Patio and sliding doors", "Glass repair"],
    faqs: [
      { q: "How long until my windows arrive?", a: "Windows are usually made to order, so it depends on the maker — the estimate gives you the timeline.", check: "A timeline — make sure it matches how you order." },
      { q: "Do you repair windows, or only replace them?", a: "The team can look and tell you which makes sense — I can book a visit.", check: "Whether you do repairs.", fixes: yesNo("We do both — repairs and replacements. I can book someone to take a look.", "We replace windows; we don't do repairs.") },
    ],
    urgent: "A broken window or a door that won't lock.",
  },
  {
    key: "fencing",
    label: "Fencing",
    noun: "fencing",
    bigTicket: true,
    services: ["Fence installation", "Fence repair", "Gates", "Wood, vinyl, chain-link and metal fences", "Fence staining"],
    faqs: [
      { q: "Do you handle permits and HOA rules?", a: "The team goes over permits and HOA rules for your area at the estimate." },
      { q: "Will you mark the utility lines before digging?", a: "Buried lines are marked before any digging — the team takes care of the locate request.", check: "Who requests the utility locate — keep it only if you do." },
      { q: "How long does a new fence take?", a: "Most fences go up in a few days once materials are in — the estimate gives you the timeline for yours.", check: "A promise of time." },
    ],
    urgent: "A fence down that lets pets or children out.",
  },
  {
    key: "decking",
    label: "Decks",
    noun: "deck",
    bigTicket: true,
    services: ["New decks", "Deck repair", "Deck replacement", "Railings and stairs", "Pergolas and covers", "Deck staining and sealing"],
    faqs: [
      { q: "Do you build with composite or wood?", a: "The team goes over wood and composite options at the estimate — I can book that." },
      { q: "Do you handle the permit?", a: "The team goes over permits for your area at the estimate.", check: "Whether you pull permits — say so if you do.", fixes: yesNo("Yes — we take care of the permit.", "The homeowner gets the permit; the team can help with the drawings.") },
    ],
    urgent: "A loose railing, broken boards or stairs that aren't safe.",
  },
  {
    key: "concrete",
    label: "Concrete",
    noun: "concrete",
    bigTicket: true,
    services: ["Driveways", "Patios", "Sidewalks and walkways", "Stamped concrete", "Concrete repair", "Slabs and foundations"],
    faqs: [
      { q: "How soon can I drive on new concrete?", a: "Usually about a week for a car, longer for heavy trucks — the crew tells you exactly for your pour.", check: "A cure time — change it if your mix differs." },
      { q: "Do you remove the old concrete?", a: "The team covers removal at the estimate — I can book that.", check: "Whether tear-out is included.", fixes: yesNo("Yes — we remove and haul away the old concrete.", "Removal is quoted separately at the estimate.") },
    ],
    urgent: "A sunken slab or trip hazard at a doorway.",
  },
  {
    key: "landscaping",
    label: "Landscaping",
    noun: "landscaping",
    bigTicket: true,
    services: ["Landscape design", "Planting", "Lawn installation", "Irrigation and sprinklers", "Hardscape and pavers", "Yard cleanup"],
    faqs: [
      { q: "Do you do regular yard maintenance?", a: "The team can tell you at the visit — I can book one.", check: "Whether you do maintenance.", fixes: yesNo("Yes — we offer regular maintenance. I can book a visit to set it up.", "We do installs and projects, not regular maintenance.") },
    ],
    urgent: "A broken irrigation line flooding the yard — shut the water at the valve first.",
  },
  {
    key: "painting",
    label: "Painting",
    noun: "painting",
    services: ["Interior painting", "Exterior painting", "Cabinet painting", "Deck and fence staining", "Drywall touch-ups before paint"],
    faqs: [
      { q: "Do you supply the paint?", a: "The team goes over paint and colors with you at the estimate." },
      { q: "How long does an interior repaint take?", a: "It depends on the rooms — the estimate gives you the timeline.", check: "A promise of time." },
    ],
    urgent: "Water damage showing through paint — that's the leak first.",
  },
  {
    key: "flooring",
    label: "Flooring",
    noun: "flooring",
    bigTicket: true,
    services: ["Hardwood floors", "Laminate", "Luxury vinyl plank", "Carpet", "Floor refinishing", "Floor repair"],
    faqs: [
      { q: "Do you remove the old floor?", a: "The team covers removal at the estimate.", check: "Whether removal is included.", fixes: yesNo("Yes — we remove and haul away the old floor.", "Removal is quoted separately at the estimate.") },
      { q: "Do you move the furniture?", a: "The team goes over that at the estimate.", check: "Whether you move furniture.", fixes: yesNo("Yes — the crew moves the furniture and puts it back.", "Please clear the rooms before the crew arrives.") },
    ],
    urgent: "Water under the floor — stop the water first.",
  },
  {
    key: "tile",
    label: "Tile",
    noun: "tile",
    services: ["Shower tile", "Backsplashes", "Tile floors", "Tile repair", "Grout repair and sealing"],
    faqs: [
      { q: "Do you do the shower pan and waterproofing?", a: "The team goes over the shower build at the estimate.", check: "Whether you build shower pans.", fixes: yesNo("Yes — we build the pan and waterproof it before the tile goes on.", "We set the tile; the pan and waterproofing are done by others.") },
      { q: "Can you match my existing tile?", a: "The team will look and tell you what's possible — I can book a visit." },
    ],
    urgent: "A leaking shower showing through the ceiling below — stop using it.",
  },
  {
    key: "countertops",
    label: "Countertops",
    noun: "countertop",
    bigTicket: true,
    services: ["Quartz countertops", "Granite countertops", "Templating and installation", "Countertop repair"],
    faqs: [
      { q: "How long from measuring to install?", a: "It depends on the material — the estimate gives you the timeline.", check: "A timeline." },
      { q: "Do you disconnect the sink and cooktop?", a: "The team goes over that at the estimate.", check: "Whether you handle plumbing and appliance hookups." },
    ],
    urgent: "A cracked counter near the sink that is leaking.",
  },
  {
    key: "remodeling",
    label: "Kitchen & bath",
    noun: "remodeling",
    bigTicket: true,
    services: ["Kitchen remodeling", "Bathroom remodeling", "Cabinets", "Countertops", "Tile and showers", "Design help"],
    faqs: [
      { q: "How long does a kitchen or bath remodel take?", a: "It depends on the scope — the team gives you a timeline with the estimate.", check: "A promise of time." },
      { q: "Do you handle permits?", a: "The team goes over permits for your project at the estimate.", check: "Whether you pull permits.", fixes: yesNo("Yes — we take care of the permits.", "The homeowner gets the permit; the team helps with the paperwork.") },
      { q: "Can I see past work?", a: "The team can show you photos of past jobs at the estimate." },
    ],
    urgent: "A leak from new work — shut the water at the valve.",
  },
  {
    key: "general",
    label: "General contractor",
    noun: "general contracting",
    bigTicket: true,
    services: ["Remodels", "Additions", "Repairs", "New construction", "Permits and project management"],
    faqs: [
      { q: "Do you take small jobs?", a: "The team can tell you after a quick look — I can book one.", check: "Whether you take small jobs.", fixes: yesNo("Yes — no job is too small. I can book a visit.", "We focus on larger projects; for small repairs the team may refer you.") },
      { q: "Do you handle permits?", a: "The team goes over permits for your project at the estimate.", check: "Whether you pull permits.", fixes: yesNo("Yes — we take care of the permits.", "The homeowner gets the permit; the team helps with the paperwork.") },
    ],
    urgent: "Damage that leaves the home open to weather, or anything structural.",
  },
  {
    key: "carpentry",
    label: "Carpentry",
    noun: "carpentry",
    services: ["Trim and molding", "Doors", "Built-ins and shelving", "Framing", "Wood repair"],
    faqs: [{ q: "Do you do custom work?", a: "The team goes over custom pieces at the estimate — I can book that." }],
    urgent: "A door that won't close or lock.",
  },
  {
    key: "drywall",
    label: "Drywall",
    noun: "drywall",
    services: ["Drywall installation", "Drywall repair", "Texture matching", "Water-damage repair"],
    faqs: [{ q: "Can you match my wall texture?", a: "The team will look and tell you — I can book a visit." }],
    urgent: "A ceiling sagging from water — stay out from under it.",
  },
  {
    key: "insulation",
    label: "Insulation",
    noun: "insulation",
    services: ["Attic insulation", "Wall insulation", "Crawlspace insulation", "Air sealing", "Insulation removal"],
    faqs: [{ q: "Are there rebates for insulation?", a: "There may be utility rebates in your area — the team can go over them at the estimate." }],
    urgent: "Pests or mold found in the insulation.",
  },
  {
    key: "plumbing",
    label: "Plumbing",
    noun: "plumbing",
    services: ["Leak repair", "Drains and clogs", "Water heaters", "Faucets, toilets and fixtures", "Sewer lines", "Repiping"],
    faqs: [
      { q: "Do you take emergency calls after hours?", a: "I'll take your details and mark it urgent — the team decides on after-hours visits.", check: "Whether you go out after hours.", fixes: yesNo("Yes — we take emergency calls around the clock.", "We work during business hours; I'll book the first slot and mark it urgent.") },
      { q: "Is there a fee to come out?", a: "The team will confirm any service fee before the visit.", check: "A trip or service fee — say it or say there is none.", fixes: yesNo("There is a service fee to come out; the office confirms the amount.", "There's no fee to come out — you get the price before any work.", "There's a fee", "No fee") },
    ],
    urgent: "A burst pipe, water you can't stop, a sewer backup or no water — shut the main valve first; a gas smell means leave the house and call the gas company or 911.",
  },
  {
    key: "electrical",
    label: "Electrical",
    noun: "electrical",
    services: ["Outlets and switches", "Panel upgrades", "Lighting", "EV chargers", "Troubleshooting", "Rewiring"],
    faqs: [
      { q: "Do you install EV chargers?", a: "The team goes over chargers at the estimate.", check: "Whether you install EV chargers.", fixes: yesNo("Yes — we install home EV chargers, including the panel work.", "We don't install EV chargers.") },
      { q: "Is there a fee to come out?", a: "The team will confirm any service fee before the visit.", check: "A trip or service fee.", fixes: yesNo("There is a service fee to come out; the office confirms the amount.", "There's no fee to come out — you get the price before any work.", "There's a fee", "No fee") },
    ],
    urgent: "Sparks, a burning smell, a hot panel or outlet, or power out in part of the house — turn that breaker off; smoke or fire means leave and call 911.",
  },
  {
    key: "hvac",
    label: "Heating & cooling",
    noun: "heating and cooling",
    bigTicket: true,
    services: ["Heating repair", "AC repair", "Furnace and heat pump replacement", "Tune-ups", "Ductwork", "Thermostats"],
    faqs: [
      { q: "Is there a fee to diagnose the problem?", a: "The team will confirm any diagnostic fee before the visit.", check: "A diagnostic fee.", fixes: yesNo("There is a diagnostic fee; the office confirms the amount and it goes toward the repair if you go ahead.", "There's no diagnostic fee — you get the price before any work.", "There's a fee", "No fee") },
      { q: "Do you have maintenance plans?", a: "The team can go over that at the visit.", check: "Whether you sell maintenance plans.", fixes: yesNo("Yes — we have maintenance plans with yearly tune-ups. The team can sign you up at the visit.", "We don't have plans, but we do one-time tune-ups.") },
    ],
    urgent: "No heat in freezing weather, no cooling in extreme heat with babies or elderly at home, or a gas smell — a gas smell means leave the house and call the gas company or 911.",
  },
  {
    key: "demolition",
    label: "Demolition",
    noun: "demolition",
    services: ["Interior demolition", "Tear-outs", "Debris hauling"],
    faqs: [{ q: "Do you haul the debris away?", a: "The team covers hauling at the estimate.", check: "Whether hauling is included.", fixes: yesNo("Yes — we haul everything away.", "Hauling is quoted separately.") }],
    urgent: "Anything structural that looks unsafe — keep people out of the area.",
  },
  {
    key: "handyman",
    label: "Handyman",
    noun: "handyman",
    services: ["Small repairs", "Installations and assembly", "Doors and hardware", "Drywall patches", "Caulking and sealing"],
    faqs: [{ q: "Do you have a minimum charge?", a: "The team will confirm pricing before the visit.", check: "A minimum charge — say it or say there is none.", fixes: yesNo("There is a minimum charge; the office confirms it before the visit.", "There's no minimum — small jobs are welcome.", "There's a minimum", "No minimum") }],
    urgent: "A door that won't lock or a leak under a sink — shut the water at the valve.",
  },
];

/** Words → trades. Order matters only for the label; every match counts. */
const MATCH: ReadonlyArray<[RegExp, string]> = [
  [/roof|shingle/i, "roofing"],
  [/gutter|downspout/i, "gutters"],
  [/siding|hardie|soffit|fascia/i, "siding"],
  [/window|\bdoors?\b|\bglass\b/i, "windows"],
  [/fenc|\bgates?\b/i, "fencing"],
  [/deck|pergola|patio cover/i, "decking"],
  [/concret|driveway|flatwork|foundation|paver|masonry/i, "concrete"],
  [/landscap|lawn|yard|irrigat|sprinkler|hardscape|garden|\btrees?\b/i, "landscaping"],
  [/paint|stain/i, "painting"],
  [/floor|hardwood|laminate|vinyl|lvp|carpet/i, "flooring"],
  [/tile|backsplash|grout/i, "tile"],
  [/counter|quartz|granite/i, "countertops"],
  [/remodel|kitchen|bath|renovat|cabinet/i, "remodeling"],
  [/general contract|\bgc\b|construction|addition|\badu\b|builder/i, "general"],
  [/carpent|\btrim\b|framing|built-?in|millwork/i, "carpentry"],
  [/drywall|sheetrock|plaster/i, "drywall"],
  [/insulat|attic/i, "insulation"],
  [/plumb|drain|sewer|water heater|pipe/i, "plumbing"],
  [/electric|wiring|panel|ev charger|lighting/i, "electrical"],
  [/hvac|heating|cooling|furnace|air condition|\ba\/?c\b|heat pump|duct/i, "hvac"],
  [/demoli|tear.?out|haul/i, "demolition"],
  [/handyman|handy man|odd job/i, "handyman"],
];

export const packByKey = (key: string) => TRADE_PACKS.find((p) => p.key === key) ?? null;

/** The kinds of business the field suggests, as chips. */
export const BUSINESS_SUGGESTIONS = ["Roofing", "Remodeling", "Tile", "Flooring", "Painting", "Plumbing", "Electrical", "HVAC", "Fencing", "Decks", "Concrete", "Landscaping", "Windows & doors", "Siding", "Gutters", "General contractor", "Handyman"];

/**
 * What the contractor typed → the trades with a preset, and the parts no preset knows ("pool resurfacing"), which the
 * model writes. Split on commas, slashes, "and", "&" and "+"; a part may match more than one trade.
 */
export function matchBusiness(text: string): { packs: TradePack[]; unknown: string[] } {
  const parts = (text || "")
    .split(/,|\/|;|\+|&|\band\b|\n/i)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 2)
    .slice(0, 8);
  const keys: string[] = [];
  const unknown: string[] = [];
  for (const part of parts) {
    const hit = MATCH.filter(([re]) => re.test(part)).map(([, k]) => k);
    if (hit.length) for (const k of hit) { if (!keys.includes(k)) keys.push(k); }
    else {
      // "we do pool resurfacing" → "pool resurfacing"; "our company" → nothing.
      const words = part.replace(/\b(we|do|does|our|the|a|an|and|company|business|contractor|contractors|services?|work|in|of|llc|inc)\b/gi, " ").replace(/\s+/g, " ").trim();
      if (words.length >= 3) unknown.push(words.slice(0, 60));
    }
  }
  // "Kitchen & Bath" splits in two and both halves are the same trade; a typed "contractor" alone is general.
  return { packs: keys.map((k) => packByKey(k)!).filter(Boolean), unknown: Array.from(new Set(unknown)) };
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
export const faqKey = (q: string) => `faq:${q.trim().toLowerCase()}`;

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

/**
 * The trades + what JobFlex has on file → the desk's profile, and what the contractor should check. `typed` is the
 * contractor's own words for a business no preset matched (used in the about line and the services when nothing else).
 */
export function presetProfile(packs: readonly TradePack[], f: CompanyFacts, typed: string[] = []): Preset {
  const plainName = f.name.replace(/\.+$/, "") || "the company";
  const nouns = uniqBy([...packs.map((p) => p.noun), ...typed.map((t) => t.toLowerCase())], (x) => x).slice(0, 3);
  const kind = nouns.length ? joinWords(nouns) : "contracting";
  const services = uniqBy([...packs.flatMap((p) => p.services), ...(packs.length ? [] : typed.map((t) => t.replace(/^\w/, (c) => c.toUpperCase())))], (x) => x).slice(0, 14);
  const onBooking = f.services.filter((s) => /—/.test(s));
  const pricing = onBooking.length
    ? `Prices depend on the job. The visits on the booking page: ${onBooking.join("; ")}. The desk never quotes any other price; it offers to book an estimate visit instead.`
    : "Prices depend on the job. The desk never quotes a price it was not given; it offers to book an estimate visit instead.";
  const urgentWhat = packs.length ? packs.map((p) => p.urgent).join(" ") : "Something that can't wait — water coming in, no heat, a door that won't lock.";
  const emergency = (action: string) => `Urgent calls: ${urgentWhat} ${action} ${SAFETY}`;

  const faqs: Array<PackFaq> = [
    { q: "How soon can someone come out?", a: "I can check the calendar right now and offer you the next open times." },
    ...packs.flatMap((p) => p.faqs),
  ];
  if (packs.some((p) => p.bigTicket)) {
    faqs.push({
      q: "Do you offer financing?",
      a: "The team can go over payment options with you at the estimate.",
      check: "Whether you offer financing.",
      fixes: yesNo("Yes — financing is available; the team goes over the options with the estimate.", "We don't offer financing; the team goes over payment terms with the estimate."),
    });
  }
  const finalFaqs = uniqBy(faqs, (x) => x.q).slice(0, 12);

  const profile: DeskProfile = {
    greeting: `Thanks for calling ${plainName}. This is the company's virtual assistant, and this call is recorded. How can I help you today?`,
    about: `${f.name || "The company"} is ${article(kind)} ${kind} company${f.city ? ` serving ${f.city} and the area around it` : ""}.`,
    services: services.length ? services : f.services,
    serviceArea: f.city ? `${f.city} and nearby` : "",
    hours: f.hoursWords,
    pricing,
    credentials: "",
    faqs: finalFaqs.map((x): DeskFaq => ({ q: x.q, a: x.a })),
    emergencies: emergency(URGENT_ACTIONS.book.text),
    neverSay: ["Never quote a price the company did not give", "Never promise a date or time the calendar does not show as open", "Never give out a team member's personal phone or address"],
    transfer: "When the caller asks for a person, or says it is urgent.",
    languages: ["English"],
  };

  const review: DeskReviewItem[] = [
    { key: "pricing", why: "Prices — the desk repeats this to every caller who asks.", fixes: pricingFixes() },
    { key: "credentials", why: "Licensing, insurance and warranty are claims — keep only what's true.", fixes: credentialFixes() },
    { key: "services", why: "Callers hear “yes, we do that” for every line — remove what you don't do, add what's missing." },
    { key: "serviceArea", why: f.city ? "Is this how far you go? The desk tells callers yes or no by it." : "Not on file — add the cities or area you serve." },
    ...(f.hoursWords ? [] : [{ key: "hours", why: "Not on file — the desk tells callers when you're open." }]),
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

/** A review list from storage or the browser, checked. */
export function cleanReview(raw: unknown): DeskReviewItem[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  return raw
    .map((x): DeskReviewItem | null => {
      if (!x || typeof x !== "object") return null;
      const o = x as Record<string, unknown>;
      const key = str(o.key, 240);
      const why = str(o.why, 200);
      if (!key || !why) return null;
      const fixes = Array.isArray(o.fixes)
        ? o.fixes.map((f) => (f && typeof f === "object" ? { label: str((f as Record<string, unknown>).label, 60), text: str((f as Record<string, unknown>).text, 800) } : null)).filter((f): f is DeskFix => !!f && !!f.label && !!f.text).slice(0, 4)
        : [];
      return { key, why, ...(fixes.length ? { fixes } : {}) };
    })
    .filter((x): x is DeskReviewItem => !!x)
    .slice(0, 30);
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
    '{"noun": "", "services": [""], "faqs": [{"q": "", "a": "", "check": "", "yes": "", "no": ""}], "urgent": "", "bigTicket": false}',
    "",
    "RULES:",
    '1. noun: the business in two or three words for "a ___ company" (e.g. "pool service").',
    "2. services: 4 to 8 short noun phrases callers ask about.",
    "3. faqs: 3 to 5 questions callers really ask this kind of company. a: what the desk says — two sentences at most, true for ANY such company (never a price, a fee, a time, or a yes/no about this company). When the true answer depends on the company: a says the team will go over it; check says in a few words what the owner should confirm; yes and no are the two answers the owner can pick, each a sentence the desk would say. Otherwise check, yes and no are empty.",
    "4. urgent: one sentence — what counts as urgent for this business (with a safety step if there is one).",
    "5. bigTicket: true when jobs commonly cost thousands of dollars.",
  ].join("\n");
}

/** The model's pack, checked; null when it gave nothing usable. */
export function cleanPack(raw: unknown, business: string): TradePack | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const services = Array.isArray(o.services) ? o.services.map((x) => str(x, 80)).filter(Boolean).slice(0, 8) : [];
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
        .slice(0, 5)
    : [];
  if (!services.length && !faqs.length) return null;
  const label = business.trim().replace(/^\w/, (c) => c.toUpperCase()).slice(0, 60);
  return {
    key: `ai:${label.toLowerCase()}`,
    label,
    noun: str(o.noun, 40).toLowerCase() || label.toLowerCase(),
    services,
    faqs,
    urgent: str(o.urgent, 300) || "Something that can't wait.",
    bigTicket: o.bigTicket === true,
  };
}

// ── after the model rewrites from the owner's words ────────────────────────

/** The sections where a changed line is a claim the owner should see. */
const SENSITIVE_SECTIONS = ["pricing", "credentials", "services", "serviceArea", "hours", "emergencies"] as const;
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
    else out.push({ key: k, why, ...(old?.fixes ? { fixes: old.fixes } : {}) });
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
