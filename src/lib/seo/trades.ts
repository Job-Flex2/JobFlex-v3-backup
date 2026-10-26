// The works the cost guides price (/cost/<work>/<city>, 2026-10-26). Phase 1:
// the four trades with an estimator of their own (roofing, fencing, HVAC,
// decks) and the two most-asked of the rest (siding, painting). Another work
// is one more entry here, on the same template.
//
// Every price is READ, never written here: each line names a step of the
// Smart Proposal price book (lib/estimate/step-prices) by the start of its
// text, and a material option says where its own numbers come from — the
// roof estimator's catalog, the HVAC estimator's rate card, or the range the
// price book's own note gives for that material. lib/seo/pricing resolves
// them and throws at build time when a step's text no longer matches, so a
// price-book edit can never leave a guide quietly on stale numbers.
// What lives here is the homeowner's words for each line and the shape of
// the job. Plain module, no I/O.

export type SeoTradeSlug = "roof-replacement" | "fence-installation" | "hvac-replacement" | "deck-building" | "siding-installation" | "house-painting";

/** A line of the job: a price-book step, the homeowner's name for it, and how its quantity follows the job's size. */
export type SeoLine = {
  /** The start of the step's text in the price book (and its procedure). */
  step: string;
  label: string;
  /**
   * "size": the step's typical quantity scaled by the job's size against the
   * price book's typical job; "fixed": the step's typical quantity as is.
   */
  scale: "size" | "fixed";
  /** The share of the job's size this line covers, when it is not all of it (a painting job's walls). */
  share?: number;
  /** Quantity per unit of the job's size, in place of the price book's typical quantity (a panel fence by the foot). */
  perUnit?: number;
};

/** How a material option changes the job. */
export type SeoSwap =
  /** The step's price, times a ratio read from an estimator's catalog. */
  | { step: string; ratio: SeoRatio }
  /** The step's price replaced by the range its own note gives for this material ("PT or cedar $6-$9/sqft"). */
  | { step: string; note: { after?: string; label: string } };

export type SeoRatio =
  | { kind: "roof"; system: string; part: "material" | "labor" | "cap" }
  | { kind: "hvac"; part: "outdoor" | "indoor"; equipment: "airConditioner" | "heatPump" | "coldClimateHeatPump" };

export type SeoVariant = {
  id: string;
  label: string;
  /** Under the label in the tables. */
  detail: string;
  swaps?: SeoSwap[];
  /** Lines this option leaves out, by step. */
  drop?: string[];
  /** Lines this option adds. */
  add?: SeoLine[];
  /** For a painting scope: the lines it is made of instead of the base job's. */
  only?: SeoLine[];
};

export type SeoExtra = {
  id: string;
  label: string;
  /** Lines the extra adds. */
  add?: SeoLine[];
  /** An extra price-book range read from a step's note, per unit of size ("add $0.40-$0.60/sqft per extra layer"). */
  noteLine?: { step: string; label: string; lineLabel: string; labor: number };
  /** A labor uplift read from the trade profile's own words ("steep or two-story work adds 15-30% labor"). */
  laborUplift?: { tradeId: string; text: string };
};

export type SeoTrade = {
  slug: SeoTradeSlug;
  /** "Roof Replacement" — headings. */
  name: string;
  /** "roof replacement" — running text. */
  lower: string;
  /** "a new roof" — "how much does a new roof cost". */
  job: string;
  /** Smart Proposal specialty id (step-prices, procedures). */
  specialty: string;
  /** Trade profile id (lib/estimate/trade-knowledge). */
  tradeId: string;
  /** The contractor landing (?industry=) and the homeowner page's project key. */
  landingKey: string;
  /** The JobFlex tool a contractor in this trade prices with. */
  tool: string;
  /** "roofing contractor" — the contractor line's words. */
  pro: string;
  size: {
    /** "sq ft of roof". */
    unit: string;
    /** "sq ft" — after a number. */
    short: string;
    /** "per sq ft" — the unit price. */
    per: string;
    /** The question the size field asks. */
    question: string;
    /** The three sizes the tables price. */
    sizes: [number, number, number];
    /** The size the answer card prices. */
    typical: number;
    min: number;
    max: number;
    step: number;
    /** The job's size in the price book benchmark's own unit (a roof's sq ft in squares). */
    toBenchmark: (size: number) => number;
    /** How a size reads in a sentence: "a 2,000 sq ft roof". */
    phrase: (size: string) => string;
  };
  lines: SeoLine[];
  variants: SeoVariant[];
  defaultVariant: string;
  extras: SeoExtra[];
  /** One sentence on what the price covers, after "The price covers". */
  covers: string;
  /** Second unit for the answer card ("$745 per square"), when the trade quotes by one. */
  altUnit?: { per: string; factor: number };
};

const ROOF: SeoTrade = {
  slug: "roof-replacement",
  name: "Roof Replacement",
  lower: "roof replacement",
  job: "a new roof",
  specialty: "roofing",
  tradeId: "roofing",
  landingKey: "roofing",
  tool: "roof estimator",
  pro: "roofing contractor",
  size: {
    unit: "sq ft of roof",
    short: "sq ft",
    per: "per sq ft",
    question: "Roof area (sq ft)",
    sizes: [1500, 2000, 3000],
    typical: 2000,
    min: 800,
    max: 5000,
    step: 100,
    toBenchmark: (s) => s / 100,
    phrase: (s) => `a ${s} sq ft roof`,
  },
  altUnit: { per: "per square (100 sq ft)", factor: 100 },
  lines: [
    { step: "Roof measurement report and pre-job inspection", label: "Roof measurement and inspection", scale: "fixed" },
    { step: "Building permit, HOA approval", label: "Permit and final inspection", scale: "fixed" },
    { step: "Site protection: tarps over landscaping", label: "Site protection", scale: "fixed" },
    { step: "Tear-off of the existing roofing", label: "Tear-off to the bare deck (one layer)", scale: "size" },
    { step: "Disposal: roll-off dumpster", label: "Dumpster and landfill fees", scale: "size" },
    { step: "Ice and water shield", label: "Ice and water shield at eaves and valleys", scale: "size" },
    { step: "Synthetic underlayment", label: "Synthetic underlayment", scale: "size" },
    { step: "Drip edge at eaves and rakes", label: "Drip edge", scale: "size" },
    { step: "Starter strip at eaves and rakes", label: "Starter strip", scale: "size" },
    { step: "Shingles supplied", label: "Roofing material, delivered", scale: "size" },
    { step: "Shingle installation", label: "Installation labor", scale: "size" },
    { step: "Valleys:", label: "Valleys", scale: "size" },
    { step: "Ridge and hip cap", label: "Ridge and hip cap", scale: "size" },
    { step: "Pipe boots and vents", label: "Pipe boots and vent flashing", scale: "fixed" },
    { step: "Wall flashings", label: "Step and wall flashing", scale: "fixed" },
    { step: "Ridge vent", label: "Ridge vent", scale: "size" },
    { step: "Final cleanup: magnetic nail sweep", label: "Cleanup and magnetic nail sweep", scale: "fixed" },
    { step: "Manufacturer system warranty registration", label: "Warranty registration", scale: "fixed" },
  ],
  variants: [
    {
      id: "architectural",
      label: "Architectural asphalt shingles",
      detail: "30-year laminated shingle, the most common re-roof",
    },
    {
      id: "three-tab",
      label: "3-tab asphalt shingles",
      detail: "flat single-layer shingle, the budget option",
      swaps: [
        { step: "Shingles supplied", ratio: { kind: "roof", system: "three_tab", part: "material" } },
        { step: "Shingle installation", ratio: { kind: "roof", system: "three_tab", part: "labor" } },
        { step: "Ridge and hip cap", ratio: { kind: "roof", system: "three_tab", part: "cap" } },
      ],
    },
    {
      id: "impact",
      label: "Impact-resistant (Class 4) shingles",
      detail: "hail-rated shingle; some insurers discount it",
      swaps: [
        { step: "Shingles supplied", ratio: { kind: "roof", system: "impact_resistant", part: "material" } },
        { step: "Shingle installation", ratio: { kind: "roof", system: "impact_resistant", part: "labor" } },
        { step: "Ridge and hip cap", ratio: { kind: "roof", system: "impact_resistant", part: "cap" } },
      ],
    },
    {
      id: "standing-seam",
      label: "Standing-seam metal",
      detail: "concealed-fastener steel panels",
      swaps: [
        { step: "Shingles supplied", ratio: { kind: "roof", system: "standing_seam", part: "material" } },
        { step: "Shingle installation", ratio: { kind: "roof", system: "standing_seam", part: "labor" } },
        { step: "Ridge and hip cap", ratio: { kind: "roof", system: "standing_seam", part: "cap" } },
      ],
    },
  ],
  defaultVariant: "architectural",
  extras: [
    { id: "steep", label: "Steep pitch or two-story house", laborUplift: { tradeId: "roofing", text: "steep or two-story work adds" } },
    { id: "layer", label: "A second layer to tear off", noteLine: { step: "Tear-off of the existing roofing", label: "add", lineLabel: "Second layer tear-off", labor: 0.95 } },
  ],
  covers: "tearing off one layer to the deck, ice and water shield, synthetic underlayment, drip edge, the roofing itself, ridge vent, flashing, the permit, the dumpster and cleanup",
};

const FENCE: SeoTrade = {
  slug: "fence-installation",
  name: "Fence Installation",
  lower: "fence installation",
  job: "a new fence",
  specialty: "fencing",
  tradeId: "fencing",
  landingKey: "fencing",
  tool: "fence estimator",
  pro: "fence contractor",
  size: {
    unit: "linear ft of fence",
    short: "ft",
    per: "per linear ft",
    question: "Fence length (ft)",
    sizes: [100, 150, 250],
    typical: 150,
    min: 40,
    max: 500,
    step: 10,
    toBenchmark: (s) => s,
    phrase: (s) => `${s} ft of fence`,
  },
  lines: [
    { step: "Layout: property pins located", label: "Layout, utility locate and staking", scale: "fixed" },
    { step: "Line posts:", label: "Line posts, augered and set", scale: "size" },
    { step: "Corner, end and gate posts", label: "Corner, end and gate posts", scale: "fixed" },
    { step: "Concrete: 3,000-psi concrete around every post", label: "Post concrete", scale: "size" },
    { step: "Rails and pickets:", label: "Rails and pickets", scale: "size" },
    { step: "Gates: 4 ft walk gates", label: "One 4 ft walk gate", scale: "fixed" },
    { step: "Gate hardware", label: "Gate hinges and latch", scale: "fixed" },
    { step: "Post caps", label: "Post caps", scale: "size" },
    { step: "Cleanup: hole spoils", label: "Cleanup and haul-off", scale: "fixed" },
  ],
  variants: [
    { id: "wood", label: "Wood privacy fence", detail: "6 ft cedar or treated pine pickets on treated posts" },
    {
      id: "vinyl",
      label: "Vinyl or aluminum panels",
      detail: "prefabricated panels between the posts",
      drop: ["Rails and pickets:"],
      add: [{ step: "Prefabricated panels:", label: "Prefabricated panels", scale: "size", perUnit: 1 }],
    },
    {
      id: "chain-link",
      label: "Chain link",
      detail: "galvanized or black vinyl-coated mesh",
      drop: ["Rails and pickets:", "Post caps"],
      add: [{ step: "Chain link:", label: "Chain-link fabric, top rail and tension wire", scale: "size", perUnit: 1 }],
    },
  ],
  defaultVariant: "wood",
  extras: [
    { id: "tearout", label: "Tear out the old fence", add: [{ step: "Tear-out of the existing fence", label: "Old fence tear-out and haul-away", scale: "size", perUnit: 1 }] },
    { id: "slope", label: "Sloped or rocky yard", laborUplift: { tradeId: "fencing", text: "Sloped / rocky yard:" } },
  ],
  covers: "layout and the utility locate, posts set in concrete, the fence itself, one walk gate with hardware, post caps and cleanup",
};

const HVAC: SeoTrade = {
  slug: "hvac-replacement",
  name: "HVAC Replacement",
  lower: "HVAC replacement",
  job: "a new HVAC system",
  specialty: "residential-hvac",
  tradeId: "hvac",
  landingKey: "hvac",
  tool: "HVAC estimator",
  pro: "HVAC contractor",
  size: {
    unit: "tons of cooling",
    short: "ton",
    per: "per ton",
    question: "System size (tons)",
    sizes: [2, 3, 4],
    typical: 3,
    min: 1.5,
    max: 5,
    step: 0.5,
    toBenchmark: () => 1,
    phrase: (s) => `a ${s}-ton system`,
  },
  lines: [
    { step: "Manual J room-by-room load calculation", label: "Load calculation and equipment sizing", scale: "fixed" },
    { step: "Mechanical permit with the final inspection", label: "Mechanical permit and inspection", scale: "fixed" },
    { step: "Refrigerant recovered per EPA 608", label: "Old system removed, refrigerant recovered", scale: "fixed" },
    { step: "Gas furnace by input and efficiency", label: "Gas furnace (about 80,000 BTU)", scale: "fixed" },
    { step: "Air conditioner or heat pump condenser", label: "Outdoor unit, set on a new pad", scale: "fixed" },
    { step: "Matched cased evaporator coil", label: "Matched indoor coil", scale: "fixed" },
    { step: "Refrigerant line set:", label: "New refrigerant line set (25 ft)", scale: "fixed" },
    { step: "Electrical: weatherproof disconnect", label: "Disconnect, whip and thermostat wire", scale: "fixed" },
    { step: "Condensate: 3/4 in. PVC primary drain", label: "Condensate drain and safety switch", scale: "fixed" },
    { step: "Gas connection with flex", label: "Gas connection and furnace venting", scale: "fixed" },
    { step: "Sheet-metal supply and return plenums", label: "Plenums and transitions to the ducts", scale: "fixed" },
    { step: "Thermostat: programmable or smart", label: "Programmable or smart thermostat", scale: "fixed" },
    { step: "Evacuation to 500 microns", label: "Evacuation and refrigerant charge", scale: "fixed" },
    { step: "Commissioning: static pressure", label: "Start-up and commissioning", scale: "fixed" },
    { step: "Manufacturer warranty registered", label: "Warranty registration and walk-through", scale: "fixed" },
  ],
  variants: [
    {
      id: "ac-furnace",
      label: "Central AC + gas furnace",
      detail: "split AC, matched coil and an 80,000 BTU furnace",
      swaps: [
        { step: "Air conditioner or heat pump condenser", ratio: { kind: "hvac", part: "outdoor", equipment: "airConditioner" } },
        { step: "Matched cased evaporator coil", ratio: { kind: "hvac", part: "indoor", equipment: "airConditioner" } },
      ],
    },
    {
      id: "heat-pump",
      label: "Heat pump + air handler",
      detail: "all-electric split heat pump, no furnace",
      drop: ["Gas furnace by input and efficiency", "Gas connection with flex"],
      swaps: [
        { step: "Air conditioner or heat pump condenser", ratio: { kind: "hvac", part: "outdoor", equipment: "heatPump" } },
        { step: "Matched cased evaporator coil", ratio: { kind: "hvac", part: "indoor", equipment: "heatPump" } },
      ],
    },
    {
      id: "cold-climate",
      label: "Cold-climate heat pump + air handler",
      detail: "variable-speed heat pump rated for deep winter",
      drop: ["Gas furnace by input and efficiency", "Gas connection with flex"],
      swaps: [
        { step: "Air conditioner or heat pump condenser", ratio: { kind: "hvac", part: "outdoor", equipment: "coldClimateHeatPump" } },
        { step: "Matched cased evaporator coil", ratio: { kind: "hvac", part: "indoor", equipment: "coldClimateHeatPump" } },
      ],
    },
  ],
  defaultVariant: "ac-furnace",
  extras: [],
  covers: "removing the old system, the new outdoor and indoor equipment, a new line set, electrical and condensate connections, the thermostat, the permit, start-up and commissioning",
};

const DECK: SeoTrade = {
  slug: "deck-building",
  name: "Deck Building",
  lower: "deck building",
  job: "a new deck",
  specialty: "decking",
  tradeId: "decking",
  landingKey: "decking",
  tool: "Deck Studio",
  pro: "deck builder",
  size: {
    unit: "sq ft of deck",
    short: "sq ft",
    per: "per sq ft",
    question: "Deck area (sq ft)",
    sizes: [200, 300, 400],
    typical: 300,
    min: 100,
    max: 800,
    step: 10,
    toBenchmark: (s) => s,
    phrase: (s) => `a ${s} sq ft deck`,
  },
  lines: [
    { step: "Design, permit and layout", label: "Plans, permit and layout", scale: "fixed" },
    { step: "Ground prep under the deck", label: "Ground prep, fabric and gravel", scale: "size" },
    { step: "Footings: dug to frost depth", label: "Footings below the frost line", scale: "size" },
    { step: "Ledger: 2x10 pressure-treated ledger", label: "Flashed ledger on the house", scale: "size" },
    { step: "Posts: 6x6 pressure-treated posts", label: "6x6 posts", scale: "size" },
    { step: "Beams: doubled or tripled", label: "Beams", scale: "size" },
    { step: "Joist framing:", label: "Joist framing with hangers", scale: "size" },
    { step: "Decking laid:", label: "Deck boards", scale: "size" },
    { step: "Stairs: pressure-treated stringers", label: "One set of stairs (4 steps)", scale: "fixed" },
    { step: "Railing: aluminum or composite railing", label: "Railing", scale: "size" },
    { step: "Fascia and skirting", label: "Fascia and skirting", scale: "size" },
    { step: "Final inspection, cleanup", label: "Final inspection and cleanup", scale: "fixed" },
  ],
  variants: [
    {
      id: "treated",
      label: "Pressure-treated wood",
      detail: "treated pine or fir boards, stained and sealed",
      swaps: [{ step: "Decking laid:", note: { label: "PT or cedar" } }],
      add: [{ step: "Stain and seal: penetrating oil-based stain", label: "Stain and seal, two coats", scale: "size", perUnit: 1 }],
    },
    {
      id: "composite",
      label: "Capped composite",
      detail: "hidden fasteners and a picture-frame border",
      swaps: [{ step: "Decking laid:", note: { label: "capped composite with hidden fasteners" } }],
    },
  ],
  defaultVariant: "treated",
  extras: [{ id: "demo", label: "Remove the old deck", add: [{ step: "Demolition of the existing deck", label: "Old deck demolition and haul-away", scale: "size", perUnit: 1 }] }],
  covers: "plans and the permit, footings, a framed and flashed structure, the deck boards, railing, one set of stairs, fascia and cleanup",
};

const SIDING: SeoTrade = {
  slug: "siding-installation",
  name: "Siding Installation",
  lower: "siding installation",
  job: "new siding",
  specialty: "siding-installation",
  tradeId: "siding",
  landingKey: "siding",
  tool: "Smart Proposal estimator",
  pro: "siding contractor",
  size: {
    unit: "sq ft of wall",
    short: "sq ft",
    per: "per sq ft of wall",
    question: "Wall area to side (sq ft)",
    sizes: [1500, 2000, 2500],
    typical: 2000,
    min: 800,
    max: 4000,
    step: 50,
    toBenchmark: (s) => s,
    phrase: (s) => `${s} sq ft of wall`,
  },
  lines: [
    { step: "Site measure and material takeoff", label: "Measure and material takeoff", scale: "fixed" },
    { step: "Site protection: landscaping tarped", label: "Site protection", scale: "fixed" },
    { step: "Remove the existing siding", label: "Old siding removed to the sheathing", scale: "size" },
    { step: "Disposal: roll-off dumpster and landfill fees", label: "Dumpster and landfill fees", scale: "size" },
    { step: "Weather-resistive barrier", label: "House wrap, taped and sealed", scale: "size" },
    { step: "Opening flashing", label: "Window and door flashing", scale: "size" },
    { step: "Starter strip and corners", label: "Starter strip and corners", scale: "size" },
    { step: "Siding installed:", label: "Siding, supplied and installed", scale: "size" },
    { step: "Window and door trim", label: "Window and door trim", scale: "size" },
    { step: "Accessories: gable vents", label: "Vents, hoods and mounting blocks", scale: "size" },
    { step: "Sealant: paintable elastomeric caulk", label: "Caulk and sealant", scale: "size" },
    { step: "Detach and reset", label: "Lights, shutters and downspouts reset", scale: "size" },
    { step: "Final cleanup: magnetic nail sweep, debris hauled, walk-through of every elevation", label: "Cleanup and warranty registration", scale: "fixed" },
  ],
  variants: [
    { id: "vinyl", label: "Vinyl siding", detail: "double-4 lap, factory color", swaps: [{ step: "Siding installed:", note: { after: "siding-only share", label: "vinyl" } }] },
    { id: "fiber-cement", label: "Fiber-cement siding", detail: "lap board, blind-nailed into studs", swaps: [{ step: "Siding installed:", note: { after: "siding-only share", label: "fiber-cement" } }] },
  ],
  defaultVariant: "vinyl",
  extras: [{ id: "insulation", label: "Add exterior insulation board", add: [{ step: "Continuous exterior insulation", label: "1 in. exterior insulation board", scale: "size", perUnit: 1 }] }],
  covers: "removing the old siding, house wrap, flashing at every opening, the new siding with corners and trim, vents and blocks, caulk, the dumpster and cleanup",
};

const PAINT_EXTERIOR: SeoLine[] = [
  { step: "Pressure wash siding and trim", label: "Pressure wash", scale: "size", perUnit: 1 },
  { step: "Surface prep: scrape and sand", label: "Scrape, sand and caulk", scale: "size", perUnit: 1 },
  { step: "Primer: stain-blocking or bonding primer", label: "Spot primer", scale: "size" },
  { step: "Exterior siding and body", label: "Siding and body, two coats", scale: "size", perUnit: 1 },
  { step: "Ladders, scaffolding or a lift", label: "Ladders, scaffolding or a lift", scale: "fixed" },
  { step: "Walk-through with the client", label: "Walk-through and touch-ups", scale: "fixed" },
];

const PAINT: SeoTrade = {
  slug: "house-painting",
  name: "House Painting",
  lower: "house painting",
  job: "a paint job",
  specialty: "painting",
  tradeId: "painting",
  landingKey: "painting",
  tool: "Smart Proposal estimator",
  pro: "painting contractor",
  size: {
    unit: "sq ft of surface",
    short: "sq ft",
    per: "per sq ft painted",
    question: "Surface to paint (sq ft)",
    sizes: [1000, 2500, 4000],
    typical: 2500,
    min: 300,
    max: 6000,
    step: 50,
    toBenchmark: (s) => s,
    phrase: (s) => `${s} sq ft of paintable surface`,
  },
  lines: [
    { step: "Protection and masking", label: "Floor and furniture protection", scale: "size" },
    { step: "Surface prep: scrape and sand", label: "Patch, sand and caulk", scale: "size" },
    { step: "Primer: stain-blocking or bonding primer", label: "Spot primer", scale: "size" },
    { step: "Walls: two finish coats", label: "Walls, two coats", scale: "size" },
    { step: "Ceilings: two coats", label: "Ceilings, two coats", scale: "size" },
    { step: "Trim, baseboard, casing and crown", label: "Trim and baseboard", scale: "size" },
    { step: "Doors: both faces and edges", label: "Doors, both sides", scale: "size" },
    { step: "Walk-through with the client", label: "Walk-through and touch-ups", scale: "fixed" },
  ],
  variants: [
    { id: "interior-full", label: "Interior: walls, ceilings, trim & doors", detail: "two coats throughout, the full repaint" },
    { id: "interior-walls", label: "Interior: walls & ceilings", detail: "two coats, trim and doors left as they are", drop: ["Trim, baseboard, casing and crown", "Doors: both faces and edges"] },
    { id: "exterior", label: "Exterior: siding & body", detail: "washed, prepped and two coats; trim priced apart", only: PAINT_EXTERIOR },
  ],
  defaultVariant: "interior-full",
  extras: [{ id: "lead", label: "Home built before 1978", add: [{ step: "Lead-safe work practices", label: "Lead-safe work practices (EPA RRP)", scale: "fixed" }] }],
  covers: "protection and masking, prep and spot priming, two finish coats, trim and doors on a full interior, and the final walk-through",
};

export const SEO_TRADES: SeoTrade[] = [ROOF, FENCE, HVAC, DECK, SIDING, PAINT];

const bySlug = new Map(SEO_TRADES.map((t) => [t.slug, t]));
export function seoTrade(slug: string): SeoTrade | null {
  return bySlug.get(slug as SeoTradeSlug) ?? null;
}
