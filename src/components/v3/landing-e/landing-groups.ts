/* TRADE GROUPS — what the page below the hero shows whom (CRO stage 3,
   2026-09-09). Every trade key belongs to one group, explicitly; the group
   picks the customer strip, the jobs ledger, the proposal and portal
   examples and whether the montage runs. The default
   page (no `?industry=`) and the interior group keep the sections' own
   built-in data, so a page with no parameter is byte-for-byte what it was.

   Numbers and places follow the fake-data rules: Bothell, Kirkland, Redmond,
   Kenmore, Everett, Woodinville, Bellevue; $1,600–$24,600. The photographs
   are the ones the sections already ship — only names and tags change. */

import type { LandingVariantKey } from "./landing-variants";

export type TradeGroup = "tools" | "exterior" | "interior" | "mep" | "general";

export const TRADE_GROUP: Record<LandingVariantKey, TradeGroup> = {
  roofing: "tools",
  fencing: "tools",
  decking: "exterior",
  siding: "exterior",
  landscaping: "exterior",
  concrete: "exterior",
  windows: "exterior",
  flooring: "interior",
  tile: "interior",
  countertops: "interior",
  painting: "interior",
  drywall: "interior",
  insulation: "interior",
  "kitchen-bath": "interior",
  plumbing: "mep",
  electrical: "mep",
  hvac: "mep",
  carpentry: "general",
  demolition: "general",
  "general-contractor": "general",
};

export function variantGroup(key: LandingVariantKey | undefined): TradeGroup | undefined {
  return key ? TRADE_GROUP[key] : undefined;
}

/* The estimators showcase is NOT per group any more (owner, 2026-09-10):
   every trade shows all four slides, its own estimator first — see
   estimators-showcase.tsx. */

/* ── the sections' data shapes ───────────────────────────── */

export type StatsCard = { src: string; name: string; tag: string; cls?: string };
export type StatsRow = { label: string; lede: string; sub: string; cards: StatsCard[] };

export type JobStatus = "DRAFT" | "SCHEDULED" | "IN PROGRESS" | "PAID";
export type BuiltJob = { t: string; by: string; inv: string; pct: number | null; status: JobStatus };
export type PhoneJob = { t: string; who: string; amt: string; status: string; cls: string };

export type ProposalContent = {
  number: string;
  title: string;
  blurb: string;
  /** Three lines on the phone card, four on the desk document. */
  linesMobile: [string, string][];
  linesDesktop: [string, string][];
  total: string;
  option: { name: string; note: string; price: string };
  /** "M. Nguyen" — the client the buttons and the signature name. */
  client: string;
};

export type PortalContent = {
  /** "Nguyen kitchen remodel · Proposal #P-1178" */
  title: string;
  baseOption: string;
  upgradeOption: string;
  upgradePrice: string;
  total: string;
  totalUpgraded: string;
};

/** The crew calendar (jobs-section): desk lanes and the phone's compact lanes. */
export type CrewTone = "bp" | "sky" | "ok" | "warn" | "bad" | "mute";
export type CrewEvent = { day: number; span: number; label: string; tone: CrewTone };
export type CrewLane = { name: string; role: string; events: CrewEvent[] };
export type PhoneLane = { who: string; jobs: { day: number; span: number; label: string; tone: string }[] };

export interface GroupContent {
  stats: StatsRow[];
  jobs: BuiltJob[];
  phoneJobs: PhoneJob[];
  crew: CrewLane[];
  phoneLanes: PhoneLane[];
  proposal: ProposalContent;
  portal: PortalContent;
  /** The Nguyen / Ortiz / Kowalski montage runs only for the interior trades and the default page. */
  montage: boolean;
}

const IMG = {
  p1: "/landing-d/project-1.jpg",
  p2: "/landing-d/project-2.jpg",
  p3: "/landing-d/project-3.jpg",
  p4: "/landing-d/project-4.jpg",
  p5: "/landing-d/project-5.jpg",
  p6: "/landing-d/project-6.jpg",
  remodel: "/landing-d/service-remodel.jpg",
  tile: "/landing-d/service-tile.jpg",
  design: "/landing-d/service-design.jpg",
  about: "/landing-d/about.jpg",
};

/* ── tools: roofing, fencing ─────────────────────────────── */

const TOOLS_STATS: StatsRow[] = [
  {
    label: "Roofers",
    lede: "The roof is just the start",
    sub: "Measured from the address, priced, approved and on the calendar the same day",
    cards: [
      { src: IMG.p5, name: "Summit Roofing", tag: "Re-roofs" },
      { src: IMG.p3, name: "Cascade Roof & Gutter", tag: "Roofing" },
      { src: IMG.p4, name: "Northline Exteriors", tag: "Metal roofs", cls: "grayscale object-top" },
      { src: IMG.about, name: "Evergreen Roofing Co.", tag: "Repairs" },
    ],
  },
  {
    label: "Fence crews",
    lede: "Off the lot lines, not the tape",
    sub: "Cedar, vinyl and chain-link, quoted from the parcel before the truck rolls",
    cards: [
      { src: IMG.p1, name: "Feldman Fence", tag: "Cedar" },
      { src: IMG.p6, name: "Redmond Fence & Gate", tag: "Gates" },
      { src: IMG.tile, name: "Kenmore Fence Co.", tag: "Chain-link" },
      { src: IMG.p2, name: "Bellevue Post & Rail", tag: "Vinyl", cls: "grayscale object-bottom" },
    ],
  },
  {
    label: "Exterior contractors",
    lede: "From estimate to final draw",
    sub: "Roofs, fences and gutters that close the week they are quoted",
    cards: [
      { src: IMG.remodel, name: "Bothell Exteriors", tag: "Roof & fence" },
      { src: IMG.design, name: "Woodinville Roofworks", tag: "Storm repair" },
      { src: IMG.p3, name: "Everett Fence & Deck", tag: "Fencing" },
      { src: IMG.p4, name: "Kirkland Ridge Co.", tag: "Custom", cls: "grayscale object-bottom" },
    ],
  },
];

const TOOLS_JOBS: BuiltJob[] = [
  { t: "Reyes roof — Kirkland · 24 sq tear-off & re-roof", by: "Marco's crew · 2 days ago", inv: "$18,400", pct: null, status: "SCHEDULED" },
  { t: "Feldman fence — Bothell · 120 lf cedar privacy", by: "Sam's crew · 3 days ago", inv: "$7,950", pct: null, status: "SCHEDULED" },
  { t: "Whitfield roof — Redmond · inspection & bid", by: "Marco's crew · just now", inv: "", pct: null, status: "DRAFT" },
  { t: "Ortiz fence — Kenmore · 86 lf chain-link", by: "Sam's crew · a week ago", inv: "$4,300", pct: 72, status: "IN PROGRESS" },
  { t: "Baptiste roof — Everett · ridge vent & repair", by: "Rosa · 16 days ago", inv: "$3,200", pct: 84, status: "IN PROGRESS" },
  { t: "Harmon gate — Woodinville · double drive gate", by: "Marco's crew · 24 days ago", inv: "$2,650", pct: 83, status: "IN PROGRESS" },
  { t: "Delgado re-roof — Bellevue · final draw", by: "Sam's crew · 29 days ago", inv: "$24,100", pct: 100, status: "PAID" },
  { t: "Kowalski fence — Kirkland · 140 lf vinyl", by: "Rosa · a month ago", inv: "$9,900", pct: 100, status: "PAID" },
  { t: "Okafor roof — Bothell · skylight flashing", by: "Marco's crew · 2 months ago", inv: "$1,650", pct: 100, status: "PAID" },
];

const TOOLS_PHONE: PhoneJob[] = [
  { t: "Reyes roof · Kirkland", who: "Marco’s crew", amt: "$18,400", status: "SCHEDULED", cls: "is-blue" },
  { t: "Feldman fence · Bothell", who: "Sam’s crew", amt: "$7,950", status: "SCHEDULED", cls: "is-blue" },
  { t: "Ortiz fence · Kenmore", who: "Sam’s crew", amt: "$4,300", status: "RUNNING", cls: "" },
  { t: "Whitfield roof · Redmond", who: "Unassigned", amt: "—", status: "DRAFT", cls: "is-draft" },
  { t: "Delgado re-roof · Bellevue", who: "Sam’s crew", amt: "$24,100", status: "PAID", cls: "is-paid" },
];

const ROOF_PROPOSAL: ProposalContent = {
  number: "P-1191",
  title: "Reyes roof replacement — 24 sq, architectural shingle",
  blurb:
    "Full scope for the roof: one-layer tear-off, synthetic underlayment, ice and water at the eaves and valleys, architectural shingles and a ridge vent. The price is complete — anything outside it gets a written change order first.",
  linesMobile: [
    ["Tear-off & disposal — 24 sq", "$2,880"],
    ["Architectural shingles — 27 sq installed", "$9,180"],
    ["Underlayment, ice & water, ridge vent", "$2,140"],
  ],
  linesDesktop: [
    ["Tear-off & disposal — 24 sq, one layer", "$2,880"],
    ["Architectural shingles — 27 sq installed (12% waste)", "$9,180"],
    ["Underlayment, ice & water, ridge vent", "$2,140"],
    ["Drip edge, step flashing & pipe boots", "$1,120"],
  ],
  total: "$15,320",
  option: { name: "Option — gutter guards, 160 lf", note: "Client adds this in the portal", price: "+$960" },
  client: "R. Reyes",
};

const ROOF_PORTAL: PortalContent = {
  title: "Reyes roof replacement · Proposal #P-1191",
  baseOption: "Standard drip edge",
  upgradeOption: "Gutter guards, 160 lf",
  upgradePrice: "+$960",
  total: "$15,320",
  totalUpgraded: "$16,280",
};

const FENCE_PROPOSAL: ProposalContent = {
  number: "P-1186",
  title: "Feldman cedar fence — 120 lf, 6 ft privacy",
  blurb:
    "Full scope for the fence: 4×4 cedar posts set in concrete on 8 ft centers, three rails, 1×6 cedar pickets and one self-closing walk gate. The price is complete — anything outside it gets a written change order first.",
  linesMobile: [
    ["Posts & concrete — 16 ea, 4×4 cedar", "$1,920"],
    ["Cedar pickets & rails — 120 lf", "$4,080"],
    ["Labor — set, string, hang", "$1,960"],
  ],
  linesDesktop: [
    ["Posts & concrete — 16 ea, 4×4 cedar, 8 ft centers", "$1,920"],
    ["Cedar pickets & rails — 120 lf, 6 ft privacy", "$4,080"],
    ["Gate — 4 ft walk, self-closing hinges", "$640"],
    ["Labor — set, string, hang (28 hrs)", "$1,960"],
  ],
  total: "$8,600",
  option: { name: "Option — post caps, 16 ea", note: "Client adds this in the portal", price: "+$240" },
  client: "D. Feldman",
};

const FENCE_PORTAL: PortalContent = {
  title: "Feldman cedar fence · Proposal #P-1186",
  baseOption: "Flat-cut posts",
  upgradeOption: "Post caps, 16 ea",
  upgradePrice: "+$240",
  total: "$8,600",
  totalUpgraded: "$8,840",
};

/* ── exterior: decking, siding, landscaping, concrete, windows ── */

const EXTERIOR_STATS: StatsRow[] = [
  {
    label: "Deck builders",
    lede: "The yard is just the start",
    sub: "Frame, boards and rail priced from the size, approved before the lumber order",
    cards: [
      { src: IMG.p3, name: "Whitfield Outdoor Living", tag: "Decks" },
      { src: IMG.p5, name: "Kenmore Deck & Rail", tag: "Composite" },
      { src: IMG.about, name: "Cedar Line Builders", tag: "Cedar decks" },
      { src: IMG.p4, name: "Redmond Porch Co.", tag: "Porches", cls: "grayscale object-top" },
    ],
  },
  {
    label: "Siding & windows",
    lede: "Quoted from the wall, not the walk-through",
    sub: "Tear-off, wrap, siding and replacement units, priced per square foot and per opening",
    cards: [
      { src: IMG.p1, name: "Delgado Siding & Trim", tag: "Siding" },
      { src: IMG.p6, name: "Bothell Window Works", tag: "Windows" },
      { src: IMG.tile, name: "Everett Exteriors", tag: "Fiber cement" },
      { src: IMG.p2, name: "Bellevue Glass & Door", tag: "Patio doors", cls: "grayscale object-bottom" },
    ],
  },
  {
    label: "Landscape & concrete",
    lede: "From the first walk-through to the last pour",
    sub: "Grading, pavers, walls, slabs and lawns — jobs that run for weeks",
    cards: [
      { src: IMG.remodel, name: "Woodinville Hardscapes", tag: "Pavers" },
      { src: IMG.design, name: "Kirkland Concrete Co.", tag: "Flatwork" },
      { src: IMG.p3, name: "North Fork Landscaping", tag: "Landscaping" },
      { src: IMG.p4, name: "Evergreen Yard & Wall", tag: "Retaining walls", cls: "grayscale object-bottom" },
    ],
  },
];

const EXTERIOR_JOBS: BuiltJob[] = [
  { t: "Whitfield deck — Redmond · 16×20 composite, cedar rail", by: "Marco's crew · 2 days ago", inv: "$16,680", pct: null, status: "SCHEDULED" },
  { t: "Delgado siding — Bellevue · 1,900 sf fiber cement", by: "Sam's crew · 3 days ago", inv: "$21,300", pct: null, status: "SCHEDULED" },
  { t: "Harmon patio — Kenmore · pavers & seat wall", by: "Marco's crew · just now", inv: "", pct: null, status: "DRAFT" },
  { t: "Ortiz windows — Kirkland · 9 openings, 1 patio door", by: "Sam's crew · a week ago", inv: "$12,400", pct: 72, status: "IN PROGRESS" },
  { t: "Baptiste driveway — Everett · 640 sf broom finish", by: "Rosa · 16 days ago", inv: "$6,100", pct: 84, status: "IN PROGRESS" },
  { t: "Kowalski yard — Woodinville · grading & sod", by: "Marco's crew · 24 days ago", inv: "$4,850", pct: 83, status: "IN PROGRESS" },
  { t: "Reyes deck — Bothell · final draw", by: "Sam's crew · 29 days ago", inv: "$14,200", pct: 100, status: "PAID" },
  { t: "Feldman retaining wall — Kirkland · 48 lf block", by: "Rosa · a month ago", inv: "$9,700", pct: 100, status: "PAID" },
  { t: "Okafor steps — Redmond · 4 risers, stamped", by: "Marco's crew · 2 months ago", inv: "$1,900", pct: 100, status: "PAID" },
];

const EXTERIOR_PHONE: PhoneJob[] = [
  { t: "Whitfield deck · Redmond", who: "Marco’s crew", amt: "$16,680", status: "SCHEDULED", cls: "is-blue" },
  { t: "Delgado siding · Bellevue", who: "Sam’s crew", amt: "$21,300", status: "SCHEDULED", cls: "is-blue" },
  { t: "Ortiz windows · Kirkland", who: "Sam’s crew", amt: "$12,400", status: "RUNNING", cls: "" },
  { t: "Harmon patio · Kenmore", who: "Unassigned", amt: "—", status: "DRAFT", cls: "is-draft" },
  { t: "Reyes deck · Bothell", who: "Sam’s crew", amt: "$14,200", status: "PAID", cls: "is-paid" },
];

const EXTERIOR_PROPOSAL: ProposalContent = {
  number: "P-1204",
  title: "Whitfield deck — 16×20 composite, cedar rail",
  blurb:
    "Full scope for the deck: concrete footings, pressure-treated frame at 16 in centers, composite decking, cedar rail and a four-step stair. The price is complete — anything outside it gets a written change order first.",
  linesMobile: [
    ["Framing — PT joists & beams, 16×20", "$3,840"],
    ["Decking — composite, 320 sf", "$5,760"],
    ["Railing — cedar, 52 lf", "$2,600"],
  ],
  linesDesktop: [
    ["Footings & framing — PT, 16×20 at 16 in centers", "$3,840"],
    ["Decking — composite, 320 sf, hidden fasteners", "$5,760"],
    ["Railing — cedar 2×4 top rail, 52 lf", "$2,600"],
    ["Labor — footings, frame, deck, rail (64 hrs)", "$4,480"],
  ],
  total: "$16,680",
  option: { name: "Option — under-rail lighting, 12 ea", note: "Client adds this in the portal", price: "+$720" },
  client: "A. Whitfield",
};

const EXTERIOR_PORTAL: PortalContent = {
  title: "Whitfield deck · Proposal #P-1204",
  baseOption: "No lighting",
  upgradeOption: "Under-rail lighting, 12 ea",
  upgradePrice: "+$720",
  total: "$16,680",
  totalUpgraded: "$17,400",
};

/* ── mep: plumbing, electrical, hvac ─────────────────────── */

const MEP_STATS: StatsRow[] = [
  {
    label: "Plumbers",
    lede: "The service call is just the start",
    sub: "Water heaters, fixtures and drain runs, priced per unit from the phone",
    cards: [
      { src: IMG.p6, name: "Bluewater Plumbing", tag: "Plumbing" },
      { src: IMG.p1, name: "Kirkland Drain & Sewer", tag: "Drains" },
      { src: IMG.about, name: "Bothell Water Heater Co.", tag: "Water heaters" },
      { src: IMG.p4, name: "Northline Plumbing", tag: "Remodel rough-in", cls: "grayscale object-top" },
    ],
  },
  {
    label: "Electricians",
    lede: "Point by point, not a guess",
    sub: "Panels, circuits, cans and EV chargers, each on its own line",
    cards: [
      { src: IMG.p4, name: "Volt & Vine Electric", tag: "Electrical" },
      { src: IMG.p5, name: "Redmond Panel & Power", tag: "Panels" },
      { src: IMG.tile, name: "Evergreen EV & Solar", tag: "EV chargers" },
      { src: IMG.p2, name: "Bellevue Lighting Co.", tag: "Lighting", cls: "grayscale object-bottom" },
    ],
  },
  {
    label: "HVAC",
    lede: "Priced before the first site visit",
    sub: "Heat pumps, furnaces, duct runs and thermostats, by the ton and the run",
    cards: [
      { src: IMG.remodel, name: "Cascade Heating & Air", tag: "HVAC" },
      { src: IMG.design, name: "Kenmore Comfort Systems", tag: "Heat pumps" },
      { src: IMG.p3, name: "Everett Duct & Vent", tag: "Ductwork" },
      { src: IMG.p4, name: "Woodinville Air Co.", tag: "Service", cls: "grayscale object-bottom" },
    ],
  },
];

const MEP_JOBS: BuiltJob[] = [
  { t: "Ortiz water heater — Kirkland · 50 gal gas & 2 baths", by: "Marco's crew · 2 days ago", inv: "$6,870", pct: null, status: "SCHEDULED" },
  { t: "Reyes panel — Bothell · 200 A upgrade, 6 circuits", by: "Sam's crew · 3 days ago", inv: "$5,400", pct: null, status: "SCHEDULED" },
  { t: "Whitfield heat pump — Redmond · 3 ton, ducted", by: "Marco's crew · just now", inv: "", pct: null, status: "DRAFT" },
  { t: "Kowalski rough-in — Kenmore · basement bath", by: "Sam's crew · a week ago", inv: "$4,300", pct: 72, status: "IN PROGRESS" },
  { t: "Baptiste EV charger — Everett · 48 A, 40 ft run", by: "Rosa · 16 days ago", inv: "$1,950", pct: 84, status: "IN PROGRESS" },
  { t: "Harmon furnace — Woodinville · 80k BTU swap", by: "Marco's crew · 24 days ago", inv: "$7,600", pct: 83, status: "IN PROGRESS" },
  { t: "Delgado repipe — Bellevue · final draw", by: "Sam's crew · 29 days ago", inv: "$18,900", pct: 100, status: "PAID" },
  { t: "Feldman cans — Kirkland · 14 recessed, 2 dimmers", by: "Rosa · a month ago", inv: "$3,100", pct: 100, status: "PAID" },
  { t: "Okafor thermostat — Bothell · smart stat & tune-up", by: "Marco's crew · 2 months ago", inv: "$1,600", pct: 100, status: "PAID" },
];

const MEP_PHONE: PhoneJob[] = [
  { t: "Ortiz water heater · Kirkland", who: "Marco’s crew", amt: "$6,870", status: "SCHEDULED", cls: "is-blue" },
  { t: "Reyes panel · Bothell", who: "Sam’s crew", amt: "$5,400", status: "SCHEDULED", cls: "is-blue" },
  { t: "Kowalski rough-in · Kenmore", who: "Sam’s crew", amt: "$4,300", status: "RUNNING", cls: "" },
  { t: "Whitfield heat pump · Redmond", who: "Unassigned", amt: "—", status: "DRAFT", cls: "is-draft" },
  { t: "Delgado repipe · Bellevue", who: "Sam’s crew", amt: "$18,900", status: "PAID", cls: "is-paid" },
];

const MEP_PROPOSAL: ProposalContent = {
  number: "P-1213",
  title: "Ortiz water heater & fixtures — 50 gal, two baths",
  blurb:
    "Full scope for the plumbing: a 50-gallon gas water heater with expansion tank, two lavatory sets and a kitchen faucet, and new supply and drain for the hall bath. The price is complete — anything outside it gets a written change order first.",
  linesMobile: [
    ["Water heater — 50 gal gas, installed", "$2,150"],
    ["Fixtures — 2 lavs, 1 kitchen faucet", "$1,240"],
    ["Drain & supply — hall bath rough-in", "$1,860"],
  ],
  linesDesktop: [
    ["Water heater — 50 gal gas, vented, installed", "$2,150"],
    ["Fixtures — 2 lavatory sets, 1 kitchen faucet", "$1,240"],
    ["Drain & supply — hall bath rough-in, PEX", "$1,860"],
    ["Labor — permit, set, pressure test (18 hrs)", "$1,620"],
  ],
  total: "$6,870",
  option: { name: "Option — expansion tank & drain pan", note: "Client adds this in the portal", price: "+$310" },
  client: "L. Ortiz",
};

const MEP_PORTAL: PortalContent = {
  title: "Ortiz water heater & fixtures · Proposal #P-1213",
  baseOption: "Standard install",
  upgradeOption: "Expansion tank & drain pan",
  upgradePrice: "+$310",
  total: "$6,870",
  totalUpgraded: "$7,180",
};

/* The HVAC page's proposal and portal (2026-10-01): the hero estimator's
   Kirkland job — the real engine and ledger on the starter catalog, at the
   Better tier (AC + 96% furnace, $12,417.03; the heat pump at Better is
   $13,484.58 — the option) — so the page tells one story. The figures are
   the ledger's own, grouped into the four lines a proposal shows. */
const HVAC_PROPOSAL: ProposalContent = {
  number: "P-1217",
  title: "Whitfield AC + furnace — 2.5 ton, 16 SEER2, 96% AFUE",
  blurb:
    "Full scope for the system: the 3-ton AC and the 80% furnace out, a 2.5-ton two-stage condenser at 16 SEER2 with a matched coil and a 45k BTU 96% furnace in, new line set, pad, disconnect and thermostat, the return cut larger, PVC venting, start-up and commissioning, permit and disposal. The price is complete — anything outside it gets a written change order first.",
  linesMobile: [
    ["Condenser, coil & 96% furnace", "$6,516"],
    ["Line set, pad, stat, drain, vent, return", "$1,581"],
    ["Labor, permit & disposal", "$4,320"],
  ],
  linesDesktop: [
    ["2.5-ton condenser, 16 SEER2 · matched coil · 45k BTU 96% furnace", "$6,516"],
    ["Line set, pad, disconnect, surge, drain, thermostat, venting, return", "$1,581"],
    ["Labor — remove, set, braze & evacuate, electrical, gas, vent, start-up", "$3,920"],
    ["Mechanical permit, inspection and disposal", "$400"],
  ],
  total: "$12,417",
  option: { name: "Option — heat pump instead of the AC", note: "Client adds this in the portal", price: "+$1,068" },
  client: "J. Whitfield",
};

const HVAC_PORTAL: PortalContent = {
  title: "Whitfield AC + furnace · Proposal #P-1217",
  baseOption: "AC + 96% furnace",
  upgradeOption: "Heat pump instead of the AC",
  upgradePrice: "+$1,068",
  total: "$12,417",
  totalUpgraded: "$13,485",
};

/* ── general: carpentry, demolition, general-contractor ───── */

const GENERAL_STATS: StatsRow[] = [
  {
    label: "General contractors",
    lede: "The first job is just the start",
    sub: "Whole-home projects priced phase by phase, each phase at its sub's number",
    cards: [
      { src: IMG.p1, name: "Reyes & Sons", tag: "Remodeling" },
      { src: IMG.remodel, name: "Hartwell Renovations", tag: "Whole-home" },
      { src: IMG.about, name: "Casa Verde Builds", tag: "Design-build" },
      { src: IMG.p5, name: "North Fork Additions", tag: "Additions" },
    ],
  },
  {
    label: "Carpentry crews",
    lede: "Cut by cut, on the calendar",
    sub: "Trim by the foot, doors and built-ins by the unit, crews booked from the estimate",
    cards: [
      { src: IMG.design, name: "Okafor Millwork", tag: "Built-ins" },
      { src: IMG.p2, name: "Kirkland Finish Carpentry", tag: "Trim" },
      { src: IMG.tile, name: "Bothell Door & Trim", tag: "Doors" },
      { src: IMG.p4, name: "Redmond Framing Co.", tag: "Framing", cls: "grayscale object-top" },
    ],
  },
  {
    label: "Demo & site",
    lede: "Dumpster to dumpster, priced up front",
    sub: "Containment, tear-out by the square foot, loads out and cleanup on one sheet",
    cards: [
      { src: IMG.p3, name: "Everett Demolition", tag: "Demolition" },
      { src: IMG.p6, name: "Kenmore Haul & Clean", tag: "Haul-away" },
      { src: IMG.p4, name: "Woodinville Site Works", tag: "Site prep", cls: "grayscale object-bottom" },
      { src: IMG.p2, name: "Bellevue Interior Demo", tag: "Interior demo", cls: "grayscale object-bottom" },
    ],
  },
];

const GENERAL_JOBS: BuiltJob[] = [
  { t: "Kowalski whole-home — Kenmore · phase 1, demo to rough-in", by: "Marco's crew · 2 days ago", inv: "$24,600", pct: null, status: "SCHEDULED" },
  { t: "Okafor mudroom — Bothell · built-ins & bench", by: "Sam's crew · 3 days ago", inv: "$5,920", pct: null, status: "SCHEDULED" },
  { t: "Whitfield addition — Redmond · walk-through & bid", by: "Marco's crew · just now", inv: "", pct: null, status: "DRAFT" },
  { t: "Ortiz kitchen demo — Kirkland · 240 sf, two loads", by: "Sam's crew · a week ago", inv: "$3,400", pct: 72, status: "IN PROGRESS" },
  { t: "Baptiste garage — Everett · frame & sheathe", by: "Rosa · 16 days ago", inv: "$8,410", pct: 84, status: "IN PROGRESS" },
  { t: "Harmon trim — Woodinville · 320 lf base & casing", by: "Marco's crew · 24 days ago", inv: "$4,700", pct: 83, status: "IN PROGRESS" },
  { t: "Delgado basement — Bellevue · final draw", by: "Sam's crew · 29 days ago", inv: "$21,300", pct: 100, status: "PAID" },
  { t: "Feldman doors — Kirkland · 6 prehung, hardware", by: "Rosa · a month ago", inv: "$3,850", pct: 100, status: "PAID" },
  { t: "Reyes deck tear-out — Bothell · haul & cleanup", by: "Marco's crew · 2 months ago", inv: "$1,650", pct: 100, status: "PAID" },
];

const GENERAL_PHONE: PhoneJob[] = [
  { t: "Kowalski whole-home · Kenmore", who: "Marco’s crew", amt: "$24,600", status: "SCHEDULED", cls: "is-blue" },
  { t: "Okafor mudroom · Bothell", who: "Sam’s crew", amt: "$5,920", status: "SCHEDULED", cls: "is-blue" },
  { t: "Ortiz kitchen demo · Kirkland", who: "Sam’s crew", amt: "$3,400", status: "RUNNING", cls: "" },
  { t: "Whitfield addition · Redmond", who: "Unassigned", amt: "—", status: "DRAFT", cls: "is-draft" },
  { t: "Delgado basement · Bellevue", who: "Sam’s crew", amt: "$21,300", status: "PAID", cls: "is-paid" },
];

const GENERAL_PROPOSAL: ProposalContent = {
  number: "P-1198",
  title: "Kowalski whole-home — phase 1 of 4, demo to rough-in",
  blurb:
    "Phase one of the whole-home remodel: demolition of the kitchen and both baths, the new beam and two framed walls, and rough-in for plumbing, electrical and HVAC at each sub's price. The price is complete — anything outside it gets a written change order first.",
  linesMobile: [
    ["Demolition — kitchen & two baths", "$4,200"],
    ["Framing & structural — beam, 2 walls", "$6,900"],
    ["Rough-in — plumbing, electrical, HVAC", "$8,400"],
  ],
  linesDesktop: [
    ["Demolition — kitchen & two baths, 3 loads out", "$4,200"],
    ["Framing & structural — LVL beam, 2 walls", "$6,900"],
    ["Rough-in — plumbing, electrical, HVAC (subs)", "$8,400"],
    ["Labor & supervision — phase 1 (140 hrs)", "$5,100"],
  ],
  total: "$24,600",
  option: { name: "Option — dumpster swaps, 2 extra", note: "Client adds this in the portal", price: "+$820" },
  client: "P. Kowalski",
};

const GENERAL_PORTAL: PortalContent = {
  title: "Kowalski whole-home, phase 1 · Proposal #P-1198",
  baseOption: "Two dumpster loads",
  upgradeOption: "Dumpster swaps, 2 extra",
  upgradePrice: "+$820",
  total: "$24,600",
  totalUpgraded: "$25,420",
};

/* ── the crew calendar, per group ────────────────────────── */

const TOOLS_CREW: CrewLane[] = [
  {
    name: "Marco",
    role: "Roofing lead",
    events: [
      { day: 1, span: 2, label: "Reyes roof — tear-off & dry-in", tone: "bp" },
      { day: 4, span: 1, label: "Reyes roof — shingles", tone: "bp" },
      { day: 5, span: 1, label: "Reyes — ridge vent & walk", tone: "sky" },
    ],
  },
  {
    name: "Sam",
    role: "Fence crew",
    events: [
      { day: 1, span: 1, label: "Feldman fence — set posts", tone: "sky" },
      { day: 2, span: 2, label: "Feldman fence — rails & pickets", tone: "sky" },
    ],
  },
  {
    name: "Rosa",
    role: "Gutters & flashing",
    events: [{ day: 3, span: 1, label: "Baptiste — ridge vent & repair", tone: "ok" }],
  },
  {
    name: "Dmitri",
    role: "Apprentice",
    events: [
      { day: 2, span: 1, label: "Whitfield — roof inspection", tone: "warn" },
      { day: 3, span: 1, label: "City inspection @ 10:30", tone: "bad" },
      { day: 4, span: 1, label: "Supply run — Feldman", tone: "mute" },
    ],
  },
];
const TOOLS_PHONE_LANES: PhoneLane[] = [
  { who: "Marco", jobs: [{ day: 1, span: 2, label: "Reyes roof", tone: "tone-blue" }] },
  { who: "Sam", jobs: [{ day: 2, span: 2, label: "Feldman fence", tone: "tone-sky" }] },
  { who: "Rosa", jobs: [{ day: 4, span: 2, label: "Baptiste vent", tone: "" }] },
  { who: "Dmitri", jobs: [{ day: 3, span: 1, label: "Insp.", tone: "tone-sky" }] },
];

const EXTERIOR_CREW: CrewLane[] = [
  {
    name: "Marco",
    role: "Deck lead",
    events: [
      { day: 1, span: 2, label: "Whitfield deck — footings & frame", tone: "bp" },
      { day: 4, span: 1, label: "Whitfield deck — boards", tone: "bp" },
      { day: 5, span: 1, label: "Whitfield — rail & walk", tone: "sky" },
    ],
  },
  {
    name: "Sam",
    role: "Siding & windows",
    events: [
      { day: 1, span: 1, label: "Delgado siding — tear-off", tone: "sky" },
      { day: 2, span: 2, label: "Delgado siding — wrap & lap", tone: "sky" },
    ],
  },
  {
    name: "Rosa",
    role: "Concrete & yard",
    events: [{ day: 3, span: 1, label: "Baptiste — driveway pour", tone: "ok" }],
  },
  {
    name: "Dmitri",
    role: "Apprentice",
    events: [
      { day: 2, span: 1, label: "Harmon — patio walk-through", tone: "warn" },
      { day: 3, span: 1, label: "City inspection @ 10:30", tone: "bad" },
      { day: 4, span: 1, label: "Supply run — Whitfield", tone: "mute" },
    ],
  },
];
const EXTERIOR_PHONE_LANES: PhoneLane[] = [
  { who: "Marco", jobs: [{ day: 1, span: 2, label: "Whitfield deck", tone: "tone-blue" }] },
  { who: "Sam", jobs: [{ day: 2, span: 2, label: "Delgado siding", tone: "tone-sky" }] },
  { who: "Rosa", jobs: [{ day: 4, span: 2, label: "Baptiste pour", tone: "" }] },
  { who: "Dmitri", jobs: [{ day: 3, span: 1, label: "Insp.", tone: "tone-sky" }] },
];

const MEP_CREW: CrewLane[] = [
  {
    name: "Marco",
    role: "Plumbing lead",
    events: [
      { day: 1, span: 1, label: "Ortiz — water heater swap", tone: "bp" },
      { day: 2, span: 1, label: "Kowalski — bath rough-in", tone: "bp" },
      { day: 4, span: 1, label: "Delgado — repipe, day 3", tone: "bp" },
      { day: 5, span: 1, label: "Ortiz — fixtures & test", tone: "sky" },
    ],
  },
  {
    name: "Sam",
    role: "Electrician",
    events: [
      { day: 1, span: 1, label: "Reyes — 200 A panel", tone: "sky" },
      { day: 3, span: 1, label: "Feldman — 14 cans", tone: "sky" },
      { day: 5, span: 1, label: "Baptiste — EV charger", tone: "sky" },
    ],
  },
  {
    name: "Rosa",
    role: "HVAC tech",
    events: [
      { day: 2, span: 1, label: "Harmon — furnace swap", tone: "ok" },
      { day: 4, span: 1, label: "Okafor — tune-up & stat", tone: "ok" },
    ],
  },
  {
    name: "Dmitri",
    role: "Apprentice",
    events: [
      { day: 2, span: 1, label: "Whitfield — heat pump quote", tone: "warn" },
      { day: 3, span: 1, label: "City inspection @ 10:30", tone: "bad" },
      { day: 4, span: 1, label: "Supply run — Delgado", tone: "mute" },
    ],
  },
];
const MEP_PHONE_LANES: PhoneLane[] = [
  { who: "Marco", jobs: [{ day: 1, span: 2, label: "Ortiz heater", tone: "tone-blue" }] },
  { who: "Sam", jobs: [{ day: 2, span: 2, label: "Reyes panel", tone: "tone-sky" }] },
  { who: "Rosa", jobs: [{ day: 4, span: 2, label: "Harmon furnace", tone: "" }] },
  { who: "Dmitri", jobs: [{ day: 3, span: 1, label: "Insp.", tone: "tone-sky" }] },
];

const GENERAL_CREW: CrewLane[] = [
  {
    name: "Marco",
    role: "Site lead",
    events: [
      { day: 1, span: 2, label: "Kowalski — demo, kitchen & baths", tone: "bp" },
      { day: 4, span: 1, label: "Kowalski — beam & walls", tone: "bp" },
      { day: 5, span: 1, label: "Kowalski — sub walk", tone: "sky" },
    ],
  },
  {
    name: "Sam",
    role: "Finish carpentry",
    events: [
      { day: 1, span: 1, label: "Okafor — mudroom built-ins", tone: "sky" },
      { day: 2, span: 2, label: "Harmon — base & casing", tone: "sky" },
    ],
  },
  {
    name: "Rosa",
    role: "Demo & haul",
    events: [{ day: 3, span: 1, label: "Ortiz — kitchen tear-out", tone: "ok" }],
  },
  {
    name: "Dmitri",
    role: "Apprentice",
    events: [
      { day: 2, span: 1, label: "Whitfield — addition walk-through", tone: "warn" },
      { day: 3, span: 1, label: "City inspection @ 10:30", tone: "bad" },
      { day: 4, span: 1, label: "Dumpster swap — Kowalski", tone: "mute" },
    ],
  },
];
const GENERAL_PHONE_LANES: PhoneLane[] = [
  { who: "Marco", jobs: [{ day: 1, span: 2, label: "Kowalski demo", tone: "tone-blue" }] },
  { who: "Sam", jobs: [{ day: 2, span: 2, label: "Harmon trim", tone: "tone-sky" }] },
  { who: "Rosa", jobs: [{ day: 4, span: 2, label: "Ortiz tear-out", tone: "" }] },
  { who: "Dmitri", jobs: [{ day: 3, span: 1, label: "Insp.", tone: "tone-sky" }] },
];

/* ── the lookup ──────────────────────────────────────────── */

/** What the sections show for a trade; undefined = each section's own
 *  built-in data (the default page and the interior trades). */
export function groupContentFor(key: LandingVariantKey | undefined): GroupContent | undefined {
  const group = variantGroup(key);
  switch (group) {
    case "tools":
      return {
        stats: TOOLS_STATS,
        jobs: TOOLS_JOBS,
        phoneJobs: TOOLS_PHONE, crew: TOOLS_CREW, phoneLanes: TOOLS_PHONE_LANES,
        proposal: key === "fencing" ? FENCE_PROPOSAL : ROOF_PROPOSAL,
        portal: key === "fencing" ? FENCE_PORTAL : ROOF_PORTAL,
        montage: false,
      };
    case "exterior":
      return { stats: EXTERIOR_STATS, jobs: EXTERIOR_JOBS, phoneJobs: EXTERIOR_PHONE, crew: EXTERIOR_CREW, phoneLanes: EXTERIOR_PHONE_LANES, proposal: EXTERIOR_PROPOSAL, portal: EXTERIOR_PORTAL, montage: false };
    case "mep":
      return {
        stats: MEP_STATS,
        jobs: MEP_JOBS,
        phoneJobs: MEP_PHONE, crew: MEP_CREW, phoneLanes: MEP_PHONE_LANES,
        proposal: key === "hvac" ? HVAC_PROPOSAL : MEP_PROPOSAL,
        portal: key === "hvac" ? HVAC_PORTAL : MEP_PORTAL,
        montage: false,
      };
    case "general":
      return { stats: GENERAL_STATS, jobs: GENERAL_JOBS, phoneJobs: GENERAL_PHONE, crew: GENERAL_CREW, phoneLanes: GENERAL_PHONE_LANES, proposal: GENERAL_PROPOSAL, portal: GENERAL_PORTAL, montage: false };
    default:
      return undefined;
  }
}
