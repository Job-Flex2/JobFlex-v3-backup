// HOMEOWNER LANDING — the donor's `/* ДАННЫЕ */` (DATA) block, verbatim.
//
// Static fixtures. Nothing here is fetched, persisted or sent anywhere: the
// wizard is a client-side demo of the intake flow, and the data layer is out
// of scope for this port (CLAUDE.md → Scope Boundaries).
//
// The donor writes these strings as `\uXXXX` escapes; they are the literal
// characters here (× — … –), which produces byte-identical rendered text.

export type Question = { q: string; hint: string; chips?: string[] };

export const CATEGORIES = [
  "Kitchen",
  "Bathroom",
  "Roofing",
  "Painting",
  "Flooring",
  "Deck & fence",
  "Epoxy floors",
  "Basement",
  "Other",
];

export const KEYWORDS: Array<[RegExp, string]> = [
  [/kitchen|cabinet|countertop|backsplash/i, "Kitchen"],
  [/bath|shower|tub|vanity/i, "Bathroom"],
  [/roof|shingle|leak|gutter/i, "Roofing"],
  [/paint|repaint|ceiling|wall color/i, "Painting"],
  [/floor(?!.*epoxy)|hardwood|lvp|carpet|tile floor/i, "Flooring"],
  [/deck|fence|pergola|patio/i, "Deck & fence"],
  [/epoxy|garage floor/i, "Epoxy floors"],
  [/basement|crawl\s?space/i, "Basement"],
];

/** The question set a description belongs to by its words — the fallback when the model is off or slow (2026-10-14). */
export function categoryOf(text: string): string {
  for (const [re, cat] of KEYWORDS) if (re.test(text)) return cat;
  return "default";
}

export const PLACEHOLDERS = [
  "I want to remodel my 12×14 kitchen with white shaker cabinets and quartz countertops…",
  "My roof is 15 years old and leaking around the chimney after storms…",
  "Paint the living room, hallway, and ceilings — about 600 sq ft…",
];

export const QUESTIONS: Record<string, Question[]> = {
  Kitchen: [
    { q: "How big is the kitchen?", hint: "e.g. 12 × 14 ft", chips: ["10 × 10", "12 × 14", "Not sure"] },
    { q: "Cabinets — reface or replace?", hint: "Style if you know it", chips: ["Replace, shaker", "Reface", "Keep them"] },
    { q: "Countertop material?", hint: "Quartz, granite, laminate…", chips: ["Quartz", "Granite", "Butcher block"] },
    { q: "Is the layout changing?", hint: "Moving sink, walls, island…", chips: ["Same layout", "Add island", "Move sink"] },
  ],
  Bathroom: [
    { q: "How big is the bathroom?", hint: "e.g. 5 × 8 ft", chips: ["Powder room", "5 × 8", "Primary bath"] },
    { q: "Tub, shower, or both?", hint: "", chips: ["Walk-in shower", "Tub + shower", "Keep as-is"] },
    { q: "Any plumbing moving?", hint: "Toilet, vanity, drains…", chips: ["Same spots", "Small moves", "Full re-layout"] },
  ],
  Roofing: [
    { q: "Roughly how big is the roof?", hint: "Sq ft or house size", chips: ["~1,600 sq ft", "Two-story", "Not sure"] },
    { q: "Material you want?", hint: "", chips: ["Architectural shingle", "Metal", "Match existing"] },
    { q: "Any active leaks?", hint: "Where, if so", chips: ["Yes — chimney", "Yes — valleys", "No leaks"] },
  ],
  default: [
    { q: "Which rooms or areas?", hint: "e.g. living room + hallway" },
    { q: "Rough size?", hint: "Sq ft or dimensions", chips: ["Small", "Medium", "Whole floor"] },
    { q: "Materials or finishes in mind?", hint: "Brands, colors, styles…" },
    { q: "When do you want it done?", hint: "", chips: ["ASAP", "1–3 months", "Flexible"] },
  ],
};

export const STEP_NAMES = ["Describe", "Clarify", "Scope", "Contact"];

// "Street address" (2026-09-21): needed when the job is priced off the roof
// or the lot — roof, fence, siding, gutters, driveway, deck — and the wizard
// says so; optional for everything else. The estimators read it.
export const CONTACT_FIELDS = ["Full name", "Email", "Phone (optional)", "ZIP code", "Street address"];

// The keyboard and the autofill for each CONTACT_FIELDS entry, by position —
// a phone gets the email keyboard for the email and digits for the ZIP. Taken
// over from the retired portal wizard (2026-10-02).
export const CONTACT_INPUTS = [
  { type: "text", autoComplete: "name" },
  { type: "email", autoComplete: "email", inputMode: "email" },
  { type: "tel", autoComplete: "tel", inputMode: "tel" },
  { type: "text", autoComplete: "postal-code", inputMode: "numeric" },
  { type: "text", autoComplete: "street-address" },
] as const;
