// THE AD-SHOOT ACCOUNT (owner, 2026-10-18): joe.f.stevenson@gmail.com made to
// look like a working roofing & exteriors shop for filming the estimators —
// with fictional data only, written into that one organization.
//
//   npx tsx --tsconfig tsconfig.json scripts/demo/seed-joe.ts [--prod] <mode…> [--apply] [--reviews] [--email <addr>]
//
//   --report   read only (the default): the account, its plan, switches, limits, what the seed holds
//   --prepare  step 3 of the brief: top plan by hand (MANUAL, no end — Stripe untouched), hidden from
//              the statistics (the statsHidden row), client texts / payment reminders / booking page /
//              lead offers / follow-up and text rules off, the setup-reminder mails spent, usage reset
//   --seed     the fictional book: clients, proposals from every estimator, jobs, crew, cash/check
//              payments, team chat (+ --reviews: completed 4–5★ reviews, hidden from the public page);
//              then projects, job expenses, change orders, AI desk calls, stock, blocked time, follow-up
//              and text rules (off), overhead, trade-board posts, client equipment. Every section is
//              skipped when its rows are in, so a second --seed only adds what is missing.
//   --remove   deletes every seeded row and gives the company profile back; --prepare is NOT undone
//              (the before-state it printed and kept in SyncState `demoSeed:<orgId>` says how)
//
// Writes run in ONE transaction and are rolled back unless --apply is given, so a run without it
// is a dry run that still proves every write. Nothing is sent and no outside service is called:
// no Stripe, no mail, no texts, no maps. --prod reads Downloads\prod-db-url.txt through
// scripts/billing/_prod (the file is deleted as it is read; the URL is never printed).
//
// WHAT IS NOT SEEDED, AND WHY (every model here is read only inside the company, or only by
// statistics that leave statsHidden organizations out):
//   · Lead, PlatformLead, LeadOffer, HomeownerRequest, Home* — the lead market (forbidden).
//   · Subscription money, Attribution, ReferralConversion, PaymentConnection — Stripe / our money.
//   · SmsMessage — read across organizations by phone number (reply routing, duplicate checks)
//     and counted on /admin/integrations/twilio.
//   · HvacEstimate — /admin/activity lists every organization's HVAC estimates, hidden or not;
//     the HVAC results are proposals with the estimator's own line.
//   · ServicePlan, Booking, FollowUp, TextRule — crons mail clients off them.
//   · ReviewRequest only with --reviews: the public /r/<slug> page and lead routing read them.
//   · InstantOrder — the paid EagleView ledger; a fake row would be served as a real answer.
//   · TradeJob / TradeNetworkProfile (Hire) — every organization sees them; ReferralConversion —
//     our referral money; Specialty — /admin/specialties lists every organization's.
//   · JobPhoto — needs real image files in storage (an upload is an outside service).
// Proposal.ownerId, RoofMeasurement.createdById and ActivityEvent.actorId stay null: with an
// author /admin/activity counts them across organizations.
//
// Every row the seed writes has an id starting with "demo_" — that is what --remove deletes.

/* eslint-disable @typescript-eslint/no-explicit-any -- the Prisma client is resolved at run time
   (the SQLite build locally, a Postgres build for --prod), so its rows come in untyped. */

import path from "node:path";
import Module from "node:module";
import crypto from "node:crypto";
import { ROOT, openEnvironment } from "../billing/_prod";

// lib modules open with `import "server-only"`; outside Next it is the package's no-op twin.
{
  const M = Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string };
  const orig = M._resolveFilename;
  const noop = path.join(ROOT, "node_modules/next/dist/compiled/server-only/empty.js");
  M._resolveFilename = function (req: string, ...rest: unknown[]) {
    if (req === "server-only") return noop;
    return orig.call(this, req, ...rest);
  };
}

const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const PROD = flag("--prod");
const APPLY = flag("--apply");
const REVIEWS = flag("--reviews");
const EMAIL = (() => {
  const i = argv.indexOf("--email");
  return i >= 0 ? argv[i + 1] : "joe.f.stevenson@gmail.com";
})();
const MODES = { prepare: flag("--prepare"), seed: flag("--seed"), remove: flag("--remove") };
const WRITES = MODES.prepare || MODES.seed || MODES.remove;
if (MODES.remove && (MODES.seed || MODES.prepare)) throw new Error("--remove runs on its own");

const DEMO = "demo_";
const SNAPSHOT_KEY = (orgId: string) => `demoSeed:${orgId}`;
const COMPANY = { name: "Stevenson Roofing & Exteriors", address: "1420 116th Ave NE, Bellevue, WA 98004", phone: "(425) 555-0100", timezone: "America/Los_Angeles" };
const TRADES = ["Roofing", "Siding", "Fencing", "Windows", "HVAC"];
const TAX = 0.101; // Bellevue, WA combined sales tax

class Rollback extends Error {}

// ── small helpers ──────────────────────────────────────────────────────────

const rid = () => DEMO + crypto.randomBytes(12).toString("hex");
const money = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
// A seeded PRNG: the same run makes the same book.
let seed = 20261018;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];

/** Wall-clock time in Los Angeles, `days` from today. */
function la(days: number, hour = 9, minute = 0): Date {
  const now = new Date();
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: COMPANY.timezone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  const guess = Date.UTC(+p.year, +p.month - 1, +p.day + days, hour, minute);
  // The zone's offset at that instant (PDT/PST), applied twice to settle across a DST edge.
  const offset = (t: number) => {
    const q = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: COMPANY.timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+q.year, +q.month - 1, +q.day, +q.hour, +q.minute) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t);
}
const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: COMPANY.timezone }).format(d);
const hoursAfter = (d: Date, h: number) => new Date(d.getTime() + h * 3600_000);

// ── the fictional book ─────────────────────────────────────────────────────

type ClientSpec = { first: string; last: string; street: string; city: string; zip: string; tags?: string[]; note?: string };
const CLIENTS: ClientSpec[] = [
  { first: "Marissa", last: "Delgado", street: "NE 8th St", city: "Bellevue", zip: "98004", tags: ["Repeat client"] },
  { first: "Grant", last: "Halvorsen", street: "108th Ave NE", city: "Bellevue", zip: "98004", tags: ["VIP"] },
  { first: "Priya", last: "Natarajan", street: "Northup Way", city: "Bellevue", zip: "98005" },
  { first: "Tom", last: "Vickery", street: "SE 26th St", city: "Bellevue", zip: "98007", tags: ["Insurance claim"], note: "Adjuster: Pacific Mutual, claim pending — send photos with every update." },
  { first: "Lena", last: "Okafor", street: "140th Ave NE", city: "Bellevue", zip: "98005" },
  { first: "Derek", last: "Lindqvist", street: "Lake Hills Blvd", city: "Bellevue", zip: "98008" },
  { first: "Sofia", last: "Marchetti", street: "Market St", city: "Kirkland", zip: "98033", tags: ["VIP"] },
  { first: "Ben", last: "Takahara", street: "NE 85th St", city: "Kirkland", zip: "98033" },
  { first: "Rachel", last: "Brandt", street: "Juanita Dr NE", city: "Kirkland", zip: "98034", tags: ["Repeat client"] },
  { first: "Owen", last: "Castellano", street: "6th St S", city: "Kirkland", zip: "98033" },
  { first: "Hailey", last: "Sorensen", street: "NE 116th St", city: "Kirkland", zip: "98034" },
  { first: "Victor", last: "Pham", street: "Avondale Rd NE", city: "Redmond", zip: "98052" },
  { first: "Natalie", last: "Ferreira", street: "NE 104th St", city: "Redmond", zip: "98052", tags: ["HOA"], note: "Education Hill HOA — colors need board approval." },
  { first: "Caleb", last: "Morrissey", street: "166th Ave NE", city: "Redmond", zip: "98052" },
  { first: "Jasmine", last: "Whitfield", street: "Redmond Way", city: "Redmond", zip: "98052" },
  { first: "Andrew", last: "Kowalczyk", street: "228th Ave SE", city: "Sammamish", zip: "98075" },
  { first: "Meghan", last: "Ellery", street: "Issaquah-Pine Lake Rd SE", city: "Sammamish", zip: "98075", tags: ["Repeat client"] },
  { first: "Luis", last: "Arredondo", street: "NE Inglewood Hill Rd", city: "Sammamish", zip: "98074" },
  { first: "Claire", last: "Beaumont", street: "Newport Way NW", city: "Issaquah", zip: "98027" },
  { first: "Ethan", last: "Rasmussen", street: "Front St N", city: "Issaquah", zip: "98027", tags: ["Insurance claim"] },
  { first: "Dana", last: "Iverson", street: "NW Sammamish Rd", city: "Issaquah", zip: "98027" },
  { first: "Kevin", last: "Ashby", street: "Beardslee Blvd", city: "Bothell", zip: "98011" },
  { first: "Monica", last: "Gallardo", street: "Bothell Way NE", city: "Bothell", zip: "98011" },
  { first: "Ryan", last: "Petrakis", street: "NE 175th St", city: "Woodinville", zip: "98072" },
  { first: "Allison", last: "Crane", street: "Woodinville-Duvall Rd", city: "Woodinville", zip: "98077", tags: ["VIP"] },
  { first: "Steven", last: "Holloway", street: "Island Crest Way", city: "Mercer Island", zip: "98040" },
  { first: "Elaine", last: "Fujimoto", street: "W Mercer Way", city: "Mercer Island", zip: "98040" },
  { first: "Marcus", last: "Odell", street: "Benson Rd S", city: "Renton", zip: "98055" },
  { first: "Tanya", last: "Reyes", street: "Duvall Ave NE", city: "Renton", zip: "98059" },
  { first: "Paul", last: "Whitaker", street: "Coal Creek Pkwy SE", city: "Newcastle", zip: "98059", note: "Gate code 4417. Dog in the back yard — friendly." },
];
const TAG_COLORS: Record<string, string> = { VIP: "#1f7a52", "Repeat client": "#2f5fb3", "Insurance claim": "#b4532a", HOA: "#7a4fb3" };

const CREW = [
  { key: "diego", name: "Diego Ramirez", role: "INSTALLER", specialties: ["Roofing", "Siding"], rate: 42 },
  { key: "tyler", name: "Tyler Brooks", role: "INSTALLER", specialties: ["Roofing", "Siding"], rate: 34 },
  { key: "andre", name: "Andre Wallace", role: "INSTALLER", specialties: ["Fencing", "Windows"], rate: 32 },
  { key: "kenji", name: "Kenji Watanabe", role: "ESTIMATOR", specialties: ["Roofing", "HVAC"], rate: 38 },
  { key: "hannah", name: "Hannah Olsen", role: "SALES", specialties: ["Roofing", "Windows"], rate: 30 },
] as const;
type CrewKey = (typeof CREW)[number]["key"];

type Line = { name: string; type: string; qty: number; unit: number; kind: "material" | "labor" };
type Tool = "roof" | "fence" | "hvac" | "smart" | "video" | "blueprint";
type ProposalSpec = {
  tool: Tool; client: number; title: string; status: string; age: number; lines: Line[];
  scope: string; projectType?: string; trade: string | null; roof?: { sq: number; pitch: string; facets: number };
  job?: { title: string; start: number; days: number; crew: CrewKey[]; status?: string };
};

const M = (name: string, type: string, qty: number, unit: number): Line => ({ name, type, qty, unit, kind: "material" });
const L = (name: string, type: string, qty: number, unit: number): Line => ({ name, type, qty, unit, kind: "labor" });

const roofLines = (sq: number, shingle: string, perSq: number, labor: number): Line[] => [
  L("Tear-off & haul-away, 1 layer", "SQUARE", sq, 85),
  M(shingle, "SQUARE", money(sq * 1.1), perSq),
  M("Synthetic underlayment", "SQUARE", sq, 28),
  M("Ice & water shield — eaves and valleys", "LINEAR_FT", Math.round(sq * 7.5), 3.4),
  M("Drip edge, prefinished", "LINEAR_FT", Math.round(sq * 8.6), 2.6),
  M("Ridge vent with shingle cap", "LINEAR_FT", Math.round(sq * 2), 9.5),
  M("Pipe boots & step flashing", "UNIT", 5, 48),
  L("Install labor", "SQUARE", sq, labor),
  L("Dumpster, permit & site protection", "LUMP_SUM", 1, 950),
];
const fenceLines = (lf: number, gates: number, perLf: number): Line[] => [
  L("Remove & haul old fence", "LINEAR_FT", lf, 4.5),
  M("Western red cedar pickets, rails & caps", "LINEAR_FT", lf, perLf),
  M("Pressure-treated 4×4 posts, set in concrete", "UNIT", Math.ceil(lf / 8) + 1, 38),
  M("Walk gate with hardware", "UNIT", gates, 420),
  L("Build & set, per foot", "LINEAR_FT", lf, 24),
];

const PROPOSALS: ProposalSpec[] = [
  // ROOF
  { tool: "roof", client: 1, trade: "roof", status: "PAID", age: 46, roof: { sq: 26.4, pitch: "7/12", facets: 12 }, title: "Architectural shingle re-roof · 26 sq", scope: "Full tear-off to the deck, new synthetic underlayment, GAF Timberline HDZ in Charcoal, new ridge vent and flashings.", lines: roofLines(26.4, "GAF Timberline HDZ architectural shingles", 152, 205), job: { title: "Re-roof — Halvorsen", start: -38, days: 3, crew: ["diego", "tyler"] } },
  { tool: "roof", client: 6, trade: "roof", status: "ACCEPTED", age: 9, roof: { sq: 31.2, pitch: "8/12", facets: 16 }, title: "Standing-seam metal roof · 31 sq", scope: "Remove composition roof, install 24-ga standing-seam panels in Dark Bronze over high-temp underlayment.", lines: [L("Tear-off & haul-away, 1 layer", "SQUARE", 31.2, 85), M("24-ga standing-seam panels, Dark Bronze", "SQUARE", 34.3, 540), M("High-temp underlayment", "SQUARE", 31.2, 62), M("Trim, ridge & eave closures", "LINEAR_FT", 290, 11), L("Install labor", "SQUARE", 31.2, 430), L("Dumpster, permit & site protection", "LUMP_SUM", 1, 1100)], job: { title: "Metal roof — Marchetti", start: 3, days: 4, crew: ["diego", "tyler"] } },
  { tool: "roof", client: 3, trade: "roof", status: "VIEWED", age: 4, roof: { sq: 22.8, pitch: "6/12", facets: 9 }, title: "Class 4 impact shingle roof · 23 sq", scope: "Insurance-grade Class 4 shingles, full replacement, decking repairs as found at $95/sheet.", lines: roofLines(22.8, "Owens Corning Duration Storm (Class 4)", 178, 210) },
  { tool: "roof", client: 24, trade: "roof", status: "ACCEPTED", age: 12, roof: { sq: 28.1, pitch: "9/12", facets: 14 }, title: "Cedar shake to architectural shingle · 28 sq", scope: "Strip the old cedar shakes, sheath over the skip sheathing with 1/2\" CDX, then a full architectural shingle system.", lines: [...roofLines(28.1, "GAF Timberline HDZ architectural shingles", 152, 215), M("1/2\" CDX plywood over skip sheathing", "UNIT", 92, 48)], job: { title: "Re-roof — Crane", start: -1, days: 3, crew: ["diego", "tyler"] } },
  { tool: "roof", client: 18, trade: "roof", status: "DRAFT", age: 1, roof: { sq: 19.6, pitch: "5/12", facets: 8 }, title: "Re-roof + new gutters · 20 sq", scope: "Architectural shingle replacement with 5\" seamless aluminum gutters and downspouts.", lines: [...roofLines(19.6, "CertainTeed Landmark architectural shingles", 148, 200), M("5\" seamless aluminum gutter", "LINEAR_FT", 160, 11), M("Downspouts", "UNIT", 5, 85)] },
  // FENCE
  { tool: "fence", client: 8, trade: "fence", status: "PAID", age: 33, title: "6' cedar privacy fence · 148 LF", scope: "Remove the old fence, set new posts in concrete, 6' western red cedar privacy fence with one walk gate.", lines: fenceLines(148, 1, 31), job: { title: "Cedar fence — Brandt", start: -24, days: 2, crew: ["andre"] } },
  { tool: "fence", client: 21, trade: "fence", status: "SENT", age: 2, title: "Cedar fence with two gates · 212 LF", scope: "Back and side lot lines, 6' cedar privacy fence, two walk gates.", lines: fenceLines(212, 2, 31) },
  { tool: "fence", client: 11, trade: "fence", status: "DECLINED", age: 19, title: "Horizontal cedar fence · 96 LF", scope: "Modern horizontal 1×6 cedar boards on steel posts.", lines: [L("Remove & haul old fence", "LINEAR_FT", 96, 4.5), M("Horizontal 1×6 cedar boards", "LINEAR_FT", 96, 44), M("Steel posts, powder-coated", "UNIT", 14, 64), L("Build & set, per foot", "LINEAR_FT", 96, 31)] },
  { tool: "fence", client: 22, trade: "fence", status: "ACCEPTED", age: 6, title: "6' cedar fence + double drive gate · 174 LF", scope: "Full perimeter cedar privacy fence with a 10' double drive gate.", lines: [...fenceLines(174, 1, 31), M("10' double drive gate, steel frame", "UNIT", 1, 1650)], job: { title: "Cedar fence — Gallardo", start: 8, days: 2, crew: ["andre", "tyler"] } },
  { tool: "fence", client: 15, trade: "fence", status: "SENT", age: 1, title: "Picture-frame cedar fence · 126 LF", scope: "6' cedar privacy fence with a picture-frame cap and trim, one walk gate.", lines: [...fenceLines(126, 1, 31), M("Picture-frame cap & trim", "LINEAR_FT", 126, 7.5)] },
  // HVAC
  { tool: "hvac", client: 12, trade: "hvac", status: "COMPLETED", age: 21, title: "Heat pump replacement · 3 ton", scope: "Replace the failed heat pump with a 3-ton variable-speed system, new line set and pad, startup and commissioning.", lines: [M("Carrier Infinity 3-ton variable-speed heat pump", "UNIT", 1, 7850), M("Matching air handler", "UNIT", 1, 3200), M("Line set, pad & disconnect", "UNIT", 1, 690), L("Install & commissioning", "HOUR", 18, 135), L("Permit & electrical inspection", "LUMP_SUM", 1, 420)], job: { title: "Heat pump — Ferreira", start: -12, days: 1, crew: ["kenji"] } },
  { tool: "hvac", client: 26, trade: "hvac", status: "VIEWED", age: 3, title: "Ductless mini-split · 2 zones", scope: "Two-zone ductless system for the bonus room and primary suite.", lines: [M("Mitsubishi 2-zone outdoor unit, 24k BTU", "UNIT", 1, 4100), M("Wall heads, 9k + 12k", "UNIT", 2, 980), M("Line sets & covers", "UNIT", 2, 340), L("Install labor", "HOUR", 14, 135)] },
  { tool: "hvac", client: 19, trade: "hvac", status: "DRAFT", age: 0, title: "Furnace + AC change-out", scope: "96% two-stage gas furnace with a 2.5-ton AC, new thermostat.", lines: [M("96% two-stage gas furnace", "UNIT", 1, 3650), M("2.5-ton AC condenser & coil", "UNIT", 1, 4300), M("Smart thermostat", "UNIT", 1, 260), L("Install labor", "HOUR", 16, 135)] },
  // SMART PROPOSAL
  { tool: "smart", client: 0, trade: null, projectType: "Gutter replacement with leaf guards", status: "PAID", age: 28, title: "Seamless gutters + leaf guards", scope: "Replace all gutters with 6\" seamless aluminum, oversized downspouts and micro-mesh guards.", lines: [L("Remove old gutters", "LINEAR_FT", 190, 2), M("6\" seamless aluminum gutter", "LINEAR_FT", 190, 13), M("Micro-mesh leaf guards", "LINEAR_FT", 190, 9), M("3×4 downspouts", "UNIT", 6, 95), L("Install labor", "HOUR", 10, 85)], job: { title: "Gutters — Delgado", start: -20, days: 1, crew: ["tyler"] } },
  { tool: "smart", client: 13, trade: null, projectType: "Fiber-cement siding repair and paint", status: "VIEWED", age: 5, title: "Hardie siding repair & repaint", scope: "Replace damaged fiber-cement planks on two elevations, caulk and repaint the whole house.", lines: [M("James Hardie lap siding planks", "SQFT", 420, 4.2), M("Trim boards & flashing", "LINEAR_FT", 160, 6.5), L("Siding replacement labor", "SQFT", 420, 6), L("Prep, caulk & paint — whole house", "LUMP_SUM", 1, 9800)] },
  { tool: "smart", client: 29, trade: null, projectType: "Skylight replacement", status: "DRAFT", age: 2, title: "Skylight replacement (2)", scope: "Replace two leaking curb skylights with new Velux units and flashing kits.", lines: [M("Velux skylight 2×4 with flashed curb", "UNIT", 2, 980), M("Flashing kits", "UNIT", 2, 210), L("Install labor", "HOUR", 9, 95), L("Interior drywall touch-up", "LUMP_SUM", 1, 450)] },
  { tool: "smart", client: 27, trade: null, projectType: "Exterior repaint and trim repair", status: "EXPIRED", age: 44, title: "Exterior repaint + trim repair", scope: "Replace rotted fascia and window trim, prime and repaint the whole exterior in two coats.", lines: [M("Fascia & trim boards, primed", "LINEAR_FT", 220, 6.5), L("Trim replacement labor", "HOUR", 24, 85), L("Prep, prime & paint — whole house", "LUMP_SUM", 1, 8600)] },
  // VIDEO ESTIMATOR
  { tool: "video", client: 4, trade: null, projectType: "Storm damage roof repair", status: "PAID", age: 17, title: "Storm damage repair — west slope", scope: "Replace wind-lifted shingles on the west slope, reseal the ridge, replace two damaged vents.", lines: [M("Matching architectural shingles", "SQUARE", 3, 165), M("Roof vents", "UNIT", 2, 65), L("Repair labor", "HOUR", 12, 95), L("Ridge reseal", "LINEAR_FT", 40, 6)], job: { title: "Storm repair — Okafor", start: -9, days: 1, crew: ["diego"] } },
  { tool: "video", client: 16, trade: null, projectType: "Chimney flashing and cricket", status: "SENT", age: 3, title: "Chimney flashing & cricket", scope: "Build a cricket behind the chimney, new step and counter flashing.", lines: [M("Copper step & counter flashing", "UNIT", 1, 640), M("Cricket framing & membrane", "UNIT", 1, 380), L("Labor", "HOUR", 10, 95)] },
  { tool: "video", client: 9, trade: null, projectType: "Attic ventilation upgrade", status: "DECLINED", age: 25, title: "Attic ventilation upgrade", scope: "Add soffit intake vents and baffles, replace box vents with ridge vent.", lines: [M("Soffit vents & baffles", "UNIT", 18, 24), M("Ridge vent", "LINEAR_FT", 42, 9.5), L("Labor", "HOUR", 11, 95)] },
  // BLUEPRINT
  { tool: "blueprint", client: 23, trade: null, projectType: "ADU roof and exterior package", status: "ACCEPTED", age: 14, title: "ADU — roof, siding & windows", scope: "From the architect's plan set (A-201 to A-404): roof, Hardie siding, 9 vinyl windows and exterior trim for the backyard ADU.", lines: [M("Architectural shingles", "SQUARE", 9.5, 152), M("Hardie lap siding", "SQFT", 1150, 4.2), M("Vinyl windows, white", "UNIT", 9, 780), M("Exterior trim package", "LINEAR_FT", 340, 6.5), L("Roofing labor", "SQUARE", 9.5, 210), L("Siding & trim labor", "SQFT", 1150, 6.8), L("Window install", "UNIT", 9, 260)] },
  { tool: "blueprint", client: 2, trade: null, projectType: "Addition roof tie-in and exterior", status: "VIEWED", age: 6, title: "Addition — roof tie-in & exterior", scope: "Tie the new 18×22 addition into the main roof, match siding and trim per plan sheet A-3.", lines: [M("Architectural shingles", "SQUARE", 6, 152), M("Ice & water at the tie-in valleys", "LINEAR_FT", 70, 3.4), M("Hardie lap siding", "SQFT", 640, 4.2), L("Roof tie-in labor", "LUMP_SUM", 1, 4200), L("Siding & trim labor", "SQFT", 640, 6.8)] },
  { tool: "blueprint", client: 17, trade: null, projectType: "Garage conversion exterior", status: "DRAFT", age: 1, title: "Garage conversion — exterior", scope: "Infill the garage door opening, new window, siding and trim to match.", lines: [M("Framing & sheathing", "LUMP_SUM", 1, 1350), M("Vinyl window 5×4", "UNIT", 1, 860), M("Hardie lap siding", "SQFT", 180, 4.2), L("Labor", "HOUR", 38, 85)] },
];

// Small jobs with no proposal behind them — the calendar's everyday work.
const SMALL_JOBS = [
  { client: 26, title: "Roof inspection & minor repairs", start: -52, days: 1, crew: ["diego"] as CrewKey[], status: "COMPLETED" },
  { client: 9, title: "Cedar fence stain", start: -45, days: 1, crew: ["andre"] as CrewKey[], status: "COMPLETED" },
  { client: 17, title: "Gutter re-pitch & downspout reroute", start: -30, days: 1, crew: ["tyler"] as CrewKey[], status: "COMPLETED" },
  { client: 27, title: "Skylight reflash", start: -27, days: 1, crew: ["diego"] as CrewKey[], status: "COMPLETED" },
  { client: 5, title: "Gutter cleaning & roof tune-up", start: -15, days: 1, crew: ["tyler"] as CrewKey[], status: "COMPLETED" },
  { client: 10, title: "Leak repair — skylight curb", start: -6, days: 1, crew: ["diego"] as CrewKey[], status: "COMPLETED" },
  { client: 20, title: "Moss treatment & roof wash", start: -3, days: 1, crew: ["tyler"] as CrewKey[], status: "COMPLETED" },
  { client: 7, title: "Fence gate repair", start: 1, days: 1, crew: ["andre"] as CrewKey[], status: "SCHEDULED" },
  { client: 25, title: "Gutter cleaning & roof tune-up", start: 5, days: 1, crew: ["tyler"] as CrewKey[], status: "SCHEDULED" },
  { client: 28, title: "Flashing repair — dormer", start: 6, days: 1, crew: ["diego"] as CrewKey[], status: "SCHEDULED" },
  { client: 14, title: "Siding repair — south wall", start: 12, days: 2, crew: ["diego", "andre"] as CrewKey[], status: "SCHEDULED" },
];

// Visits: estimates and inspections, the sales side of the calendar.
const APPOINTMENTS = [
  { client: 3, title: "Roof inspection", day: -5, hour: 10, who: "kenji" as CrewKey, status: "COMPLETED" },
  { client: 13, title: "Siding estimate", day: -6, hour: 14, who: "hannah" as CrewKey, status: "COMPLETED" },
  { client: 26, title: "Mini-split walkthrough", day: -4, hour: 11, who: "kenji" as CrewKey, status: "COMPLETED" },
  { client: 21, title: "Fence estimate", day: -3, hour: 15, who: "hannah" as CrewKey, status: "COMPLETED" },
  { client: 15, title: "Fence estimate", day: -2, hour: 9, who: "hannah" as CrewKey, status: "COMPLETED" },
  { client: 0, title: "Final walkthrough — gutters", day: 0, hour: 15, who: "hannah" as CrewKey, status: "SCHEDULED" },
  { client: 3, title: "Insurance adjuster meeting", day: 1, hour: 10, who: "kenji" as CrewKey, status: "SCHEDULED" },
  { client: 16, title: "Chimney flashing review", day: 2, hour: 13, who: "kenji" as CrewKey, status: "SCHEDULED" },
  { client: 18, title: "Re-roof estimate", day: 2, hour: 16, who: "hannah" as CrewKey, status: "SCHEDULED" },
  { client: 19, title: "Furnace + AC consult", day: 4, hour: 9, who: "kenji" as CrewKey, status: "SCHEDULED" },
  { client: 29, title: "Skylight measure", day: 7, hour: 11, who: "kenji" as CrewKey, status: "SCHEDULED" },
  { client: 2, title: "Addition plan review", day: 9, hour: 14, who: "hannah" as CrewKey, status: "SCHEDULED" },
  { client: 17, title: "Garage conversion site visit", day: 11, hour: 10, who: "hannah" as CrewKey, status: "SCHEDULED" },
  { client: 11, title: "Roof inspection", day: 13, hour: 9, who: "kenji" as CrewKey, status: "SCHEDULED" },
];

// One per finished job, in the order the seed finishes them (the proposal jobs, then the small ones).
const REVIEW_TEXT: [number, string][] = [
  [5, "Diego and Tyler had the whole roof off and back on in three days. They cleaned up every nail. Couldn't be happier."],
  [5, "The new fence looks fantastic and the crew left the yard cleaner than they found it."],
  [5, "Our heat pump died in a cold snap and Kenji had us warm again the next day. Professional from start to finish."],
  [4, "Great work on the gutters. Took a week longer to schedule than I hoped, but the install was quick and tidy."],
  [4, "Solid job on the storm repair, and they worked directly with my insurance adjuster."],
  [5, "Joe walked the roof with me, showed me photos of everything, and the price didn't change once. Highly recommend."],
  [5, "Andre stained the whole fence in a day and it looks new. Will book again next summer."],
  [5, "Clear proposal, no surprises, and they texted the morning before the crew arrived."],
  [5, "They found the leak two other companies missed. Fair price, honest advice."],
  [5, "Best contractor experience we've had in Bellevue. The proposal had photos and every line explained."],
  [4, "Good communication and good work on the skylight. Would hire again."],
  [5, "Moss treatment made the roof look new again. We'll have them back every year."],
];

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const { where } = openEnvironment({ prod: PROD, out: path.join(ROOT, ".cache/seed-joe"), allowLiveWrites: false, stripe: false });
  const modes = Object.entries(MODES).filter(([, v]) => v).map(([k]) => k);
  console.log(`seed-joe — ${where} — ${WRITES ? `${modes.join(" + ")}${APPLY ? " — APPLY" : " — dry run (rolled back)"}` : "report, read only"}\n`);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient, Prisma } = require("@prisma/client");
  const prisma = new PrismaClient();
  const { LIMIT_DEFS } = await import("../../src/lib/planLimits");
  const { getOrgLimitUsage, getOrgCycleStart, usageResetKey } = await import("../../src/lib/limitsEngine");
  const { defaultNotificationPrefs } = await import("../../src/lib/notificationPrefsShared");
  const { stockKey } = await import("../../src/lib/inventory");

  try {
    const user = await prisma.user.findUnique({ where: { email: EMAIL }, include: { memberships: true } });
    if (!user) throw new Error(`no user ${EMAIL}`);
    const owned = user.memberships.filter((m: { role: string }) => m.role === "OWNER");
    if (owned.length !== 1) throw new Error(`${EMAIL} owns ${owned.length} organizations — expected exactly one`);
    const ORG: string = owned[0].organizationId;
    if (user.activeOrgId && user.activeOrgId !== ORG) console.warn(`! activeOrgId ${user.activeOrgId} is not the owned org ${ORG}`);

    if (WRITES) {
      const before = await report(prisma, Prisma, ORG, user, { LIMIT_DEFS, getOrgLimitUsage, getOrgCycleStart }, false);
      try {
        await prisma.$transaction(
          async (tx: any) => {
            if (MODES.prepare) await prepare(tx, ORG, user.id, before, { LIMIT_DEFS, usageResetKey, getOrgCycleStart });
            if (MODES.seed) {
              await seedBook(tx, ORG, user, defaultNotificationPrefs);
              await seedExtras(tx, ORG, user, stockKey);
            }
            if (MODES.remove) await removeBook(tx, ORG);
            if (!APPLY) throw new Rollback("dry run");
          },
          { timeout: 180_000, maxWait: 20_000 },
        );
        console.log("\n✔ committed");
      } catch (e) {
        if (!(e instanceof Rollback)) throw e;
        console.log("\n↺ dry run — every write above was rolled back (add --apply to keep them)");
      }
    }
    await report(prisma, Prisma, ORG, user, { LIMIT_DEFS, getOrgLimitUsage, getOrgCycleStart }, true);
  } finally {
    await prisma.$disconnect();
  }
}

// ── report (step 1) ────────────────────────────────────────────────────────

async function report(prisma: any, Prisma: any, ORG: string, user: any, lib: any, print: boolean) {
  const org = await prisma.organization.findUnique({ where: { id: ORG }, include: { subscription: true } });
  const sync = await prisma.syncState.findMany({
    where: { OR: [{ key: { contains: ORG } }, { key: { contains: user.id } }] },
    select: { key: true, cursor: true, updatedAt: true },
  });
  const hiddenRow = await prisma.syncState.findUnique({ where: { key: "statsHidden" } });
  const hidden: { orgId: string }[] = hiddenRow ? JSON.parse(hiddenRow.cursor) : [];
  const members = await prisma.membership.findMany({ where: { organizationId: ORG }, include: { user: { select: { email: true, isPlatformAdmin: true } } } });
  const planSlug = String(org.subscription?.plan ?? "FREE").toLowerCase();
  const plans = await prisma.pricingPlan.findMany({ where: { slug: { in: [planSlug, "enterprise"] } } }).catch(() => []);
  const counts: Record<string, number> = {};
  const demo: Record<string, number> = {};
  for (const m of Prisma.dmmf.datamodel.models) {
    if (!m.fields.some((f: any) => f.name === "organizationId")) continue;
    const k = m.name[0].toLowerCase() + m.name.slice(1);
    const n = await prisma[k].count({ where: { organizationId: ORG } });
    if (n) counts[m.name] = n;
    const d = await prisma[k].count({ where: { organizationId: ORG, id: { startsWith: DEMO } } }).catch(() => 0);
    if (d) demo[m.name] = d;
  }
  demo.User = await prisma.user.count({ where: { id: { startsWith: DEMO }, memberships: { some: { organizationId: ORG } } } });
  const rules = {
    followUpRules: await prisma.followUpRule.findMany({ where: { organizationId: ORG }, select: { name: true, enabled: true } }),
    pendingFollowUps: await prisma.followUp.count({ where: { organizationId: ORG, completedAt: null } }),
    textRules: await prisma.textRule.findMany({ where: { organizationId: ORG }, select: { name: true, trigger: true, active: true } }),
  };
  let usage: { resource: string; used: number; limit: number | null }[] = [];
  let cycleStart: Date | null = null;
  try {
    usage = await lib.getOrgLimitUsage(ORG, { actorId: null });
    cycleStart = await lib.getOrgCycleStart(ORG);
  } catch (e) {
    usage = [];
    console.warn("limits engine:", (e as Error).message);
  }
  const json = (s: string | null | undefined) => { try { return s ? JSON.parse(s) : null; } catch { return "unreadable"; } };
  const out = {
    user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt, isPlatformAdmin: user.isPlatformAdmin, hasPassword: !!user.hashedPassword, smsPhone: !!user.smsPhone, notificationPrefs: user.notificationPrefsJson ? "custom" : "default" },
    members: members.map((m: any) => `${m.user.email} ${m.role}${m.user.isPlatformAdmin ? " (platform admin)" : ""}`),
    org: {
      id: org.id, name: org.name, slug: org.slug, createdAt: org.createdAt, timezone: org.timezone, trades: org.tradeTypesJson, address: org.address, phone: org.phone, latLng: org.lat != null,
      isInternal: org.isInternal, deletedAt: org.deletedAt, publicProfileEnabled: org.publicProfileEnabled, leadOffersEnabled: org.leadOffersEnabled,
      smsClientsOn: org.smsClientsOn, smsFromNumber: !!org.smsFromNumber,
      paymentReminderMode: json(org.paymentSettingsJson)?.reminderMode ?? "manual (default)",
      bookingPage: json(org.bookingSettingsJson)?.enabled === false ? "off" : "on (default when unset)",
      proposalSettings: json(org.proposalSettingsJson),
    },
    subscription: org.subscription && {
      plan: org.subscription.plan, status: org.subscription.status, provider: org.subscription.provider,
      stripeCustomer: !!org.subscription.externalCustomerId, stripeSub: !!org.subscription.externalSubId, price: !!org.subscription.stripePriceId,
      currentPeriodEnd: org.subscription.currentPeriodEnd, trialEndsAt: org.subscription.trialEndsAt, canceledAt: org.subscription.canceledAt,
      promo: !!org.subscription.appliedPromotionCodeId, coupon: !!org.subscription.appliedCouponId, updatedAt: org.subscription.updatedAt,
    },
    grant: (() => { const g = sync.find((r: any) => r.key === `planGrant:${ORG}`); return g ? json(g.cursor) : null; })(),
    hiddenFromStats: hidden.some((h) => h.orgId === ORG),
    plans: plans.map((p: any) => ({ slug: p.slug, name: p.name, limits: json(p.limitsJson) ?? "none set = unlimited" })),
    cycleStart,
    limits: usage.filter((u) => u.used || u.limit !== null).map((u) => `${u.resource}: ${u.used}${u.limit === null ? " (unlimited)" : ` of ${u.limit}`}`),
    sync: sync.map((r: any) => `${r.key} = ${r.cursor.length > 90 ? r.cursor.slice(0, 90) + "…" : r.cursor}`),
    rules,
    counts,
    demoRows: demo,
  };
  if (print) console.log(JSON.stringify(out, null, 2));
  return out;
}

// ── prepare (step 3) ───────────────────────────────────────────────────────

async function prepare(tx: any, ORG: string, userId: string, before: any, lib: any) {
  const org = await tx.organization.findUnique({ where: { id: ORG }, include: { subscription: true } });
  const now = new Date();
  // The before-state, kept once: a second run must not overwrite the original.
  const snapKey = SNAPSHOT_KEY(ORG);
  const snap = await tx.syncState.findUnique({ where: { key: snapKey } });
  const record = snap ? JSON.parse(snap.cursor) : {};
  if (!record.prepare) {
    record.prepare = {
      at: now.toISOString(),
      subscription: org.subscription,
      org: { isInternal: org.isInternal, smsClientsOn: org.smsClientsOn, leadOffersEnabled: org.leadOffersEnabled, paymentSettingsJson: org.paymentSettingsJson, bookingSettingsJson: org.bookingSettingsJson },
      hiddenFromStats: before.hiddenFromStats,
      sync: before.sync,
    };
    await tx.syncState.upsert({ where: { key: snapKey }, create: { key: snapKey, cursor: JSON.stringify(record) }, update: { cursor: JSON.stringify(record) } });
  }

  // 1. The top plan, by hand, with no end (lib/planGrant: a MANUAL row names no Stripe subscription).
  const sub = {
    plan: "ENTERPRISE", status: "ACTIVE", provider: "MANUAL",
    externalSubId: null, stripePriceId: null, currentPeriodEnd: null, trialEndsAt: null, canceledAt: null,
  };
  await tx.subscription.upsert({ where: { organizationId: ORG }, update: sub, create: { organizationId: ORG, ...sub } });
  // A grant the admin already gave keeps its record (author, reason, what it replaced) — only its end goes.
  const had = await tx.syncState.findUnique({ where: { key: `planGrant:${ORG}` } });
  const old = had ? (() => { try { return JSON.parse(had.cursor); } catch { return null; } })() : null;
  const grant = old && typeof old === "object"
    ? { ...old, plan: "ENTERPRISE", endsAt: null, noticeSentAt: null }
    : { plan: "ENTERPRISE", grantedAt: now.toISOString(), endsAt: null, fallback: "free", reason: "Ad shoot account — owner, 2026-10-18 (scripts/demo/seed-joe.ts)", actorId: null, actorEmail: null, replaced: null, noticeSentAt: null };
  console.log(`grant: ${old ? `admin grant ${old.plan}, ends ${old.endsAt ?? "never"} (by ${old.actorEmail ?? "?"}, ${old.grantedAt})` : "none"} → ENTERPRISE, no end`);
  await tx.syncState.upsert({ where: { key: `planGrant:${ORG}` }, create: { key: `planGrant:${ORG}`, cursor: JSON.stringify(grant) }, update: { cursor: JSON.stringify(grant) } });
  // Nothing created before now may write the mirror (lib/stripeSync mirrorAccepts).
  await tx.syncState.upsert({ where: { key: `mirrorSubAt:${ORG}` }, create: { key: `mirrorSubAt:${ORG}`, cursor: String(now.getTime()) }, update: { cursor: String(now.getTime()) } });
  await tx.syncState.deleteMany({ where: { key: `subSyncing:${ORG}` } });
  console.log(`plan: ${org.subscription?.plan}/${org.subscription?.status}/${org.subscription?.provider} → ENTERPRISE/ACTIVE/MANUAL, no end; Stripe subscription id dropped from the row (Stripe itself untouched)`);

  // 2. Out of the statistics — the statsHidden list (lib/statsHidden), read-modify-write.
  const row = await tx.syncState.findUnique({ where: { key: "statsHidden" } });
  const list = row ? (JSON.parse(row.cursor) as { orgId: string }[]) : [];
  if (!Array.isArray(list)) throw new Error("statsHidden is not a list — refusing to overwrite it");
  if (!list.some((e) => e.orgId === ORG)) {
    const next = [...list, { orgId: ORG, at: now.toISOString(), by: null }];
    await tx.syncState.upsert({ where: { key: "statsHidden" }, create: { key: "statsHidden", cursor: JSON.stringify(next) }, update: { cursor: JSON.stringify(next) } });
    console.log(`statsHidden: ${list.length} → ${next.length} organizations`);
  } else console.log("statsHidden: already hidden");

  // 3. Everything that could reach a client or the owner on its own.
  const merge = (s: string | null, patch: object) => JSON.stringify({ ...(s ? JSON.parse(s) : {}), ...patch });
  await tx.organization.update({
    where: { id: ORG },
    data: {
      isInternal: false, // "may receive TEST platform leads" (admin Lead Center) — never for this account
      smsClientsOn: false, // client texts: proposal link, the day-before visit reminder
      leadOffersEnabled: false, // never offered platform leads (routing reads reviews)
      paymentSettingsJson: merge(org.paymentSettingsJson, { reminderMode: "off" }), // payment reminder ladder + Remind button
      bookingSettingsJson: merge(org.bookingSettingsJson, { enabled: false }), // public /book page reads the calendar
    },
  });
  const fr = await tx.followUpRule.updateMany({ where: { organizationId: ORG, enabled: true }, data: { enabled: false } });
  const tr = await tx.textRule.updateMany({ where: { organizationId: ORG, active: true }, data: { active: false } });
  const fu = await tx.followUp.updateMany({ where: { organizationId: ORG, completedAt: null }, data: { completedAt: now } });
  const lsr = JSON.stringify({ count: 14, lastAt: now.toISOString() }); // lib/leadSetupReminders MAX_SENDS
  await tx.syncState.upsert({ where: { key: `leadSetupReminder:${ORG}` }, create: { key: `leadSetupReminder:${ORG}`, cursor: lsr }, update: { cursor: lsr } });
  const desk = await tx.syncState.findMany({ where: { key: { in: [`aidesk:${ORG}`, `deskpacks:${ORG}`] } }, select: { key: true } });
  console.log(`switches: isInternal off, client texts off, payment reminders off, booking page off, lead offers off, follow-up rules off ${fr.count}, text rules off ${tr.count}, open follow-ups closed ${fu.count}, setup-reminder mails spent; AI desk ${desk.length ? "HAS " + desk.map((d: any) => d.key).join(", ") + " — left as is, see the report" : "has no number (nothing to switch)"}`);

  // 4. Usage reset — the admin's own mechanism (lib/usageReset): a mark per monthly key, counting
  //    starts after it.
  // A plan with no period end counts from the 1st of the month (lib/limitsEngine monthlyCycleStart);
  // the engine itself still reads the old row here, outside this transaction.
  const cycleStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const keys = lib.LIMIT_DEFS.filter((d: any) => d.scope === "monthly").map((d: any) => d.key);
  const reason = "Ad shoot account — fresh meters before filming (owner, 2026-10-18)";
  for (const key of keys) {
    const before0 = before.limits.find((l: string) => l.startsWith(key + ":"));
    const mark = { at: now.toISOString(), cycleStart: cycleStart.toISOString(), actorId: null, actorEmail: "scripts/demo/seed-joe.ts", reason, before: { used: before0 ? Number(before0.split(": ")[1].split(" ")[0]) : 0, limit: null } };
    const k = lib.usageResetKey(ORG, key);
    await tx.syncState.upsert({ where: { key: k }, create: { key: k, cursor: JSON.stringify(mark) }, update: { cursor: JSON.stringify(mark) } });
  }
  // The admin's reset also logs a USAGE_RESET line — it would head the dashboard's Recent activity
  // on camera, so the marks themselves (with their reason) are the record here.
  // The hourly/daily ceilings (rate limits, PAID_CAPS) have no reset of their own: their rows go.
  const rl = await tx.syncState.deleteMany({ where: { key: { startsWith: "rl:" }, OR: [{ key: { endsWith: `:${ORG}` } }, { key: { endsWith: `:${userId}` } }] } });
  console.log(`usage: ${keys.length} monthly meters reset; ${rl.count} rate-limit rows cleared`);
}

// ── seed (step 2) ──────────────────────────────────────────────────────────

async function seedBook(tx: any, ORG: string, owner: any, defaultPrefs: (role?: string | null) => any) {
  if ((await tx.client.count({ where: { organizationId: ORG, id: { startsWith: DEMO } } })) > 0) {
    console.log("book: already in — skipped (clients, proposals, jobs, crew, money, chat, reviews)");
    return;
  }
  const org = await tx.organization.findUnique({ where: { id: ORG } });
  const now = new Date();
  const created: Record<string, number> = {};
  const add = (k: string, n = 1) => (created[k] = (created[k] ?? 0) + n);

  // The company profile: kept where the owner set it, filled where the signup left it blank.
  const unnamed = !!(await tx.syncState.findUnique({ where: { key: `orgNameUnset:${ORG}` } })) || org.name.trim() === (owner.name ?? "").trim();
  const trades = (() => { try { return JSON.parse(org.tradeTypesJson ?? "[]"); } catch { return []; } })();
  const profile: Record<string, unknown> = {};
  if (unnamed) profile.name = COMPANY.name;
  if (!Array.isArray(trades) || trades.length === 0) profile.tradeTypesJson = JSON.stringify(TRADES);
  if (!org.address) profile.address = COMPANY.address;
  if (!org.phone) profile.phone = COMPANY.phone;
  if (org.timezone === "America/New_York") profile.timezone = COMPANY.timezone;
  if (!org.defaultTaxRate) profile.defaultTaxRate = TAX;
  const snapKey = SNAPSHOT_KEY(ORG);
  const snap = await tx.syncState.findUnique({ where: { key: snapKey } });
  const record = snap ? JSON.parse(snap.cursor) : {};
  record.seed = { at: now.toISOString(), profileBefore: Object.fromEntries(Object.keys(profile).map((k) => [k, org[k]])), orgNameUnset: unnamed && !!(await tx.syncState.findUnique({ where: { key: `orgNameUnset:${ORG}` } })) };
  await tx.syncState.upsert({ where: { key: snapKey }, create: { key: snapKey, cursor: JSON.stringify(record) }, update: { cursor: JSON.stringify(record) } });
  if (Object.keys(profile).length) await tx.organization.update({ where: { id: ORG }, data: profile });
  if (unnamed) await tx.syncState.deleteMany({ where: { key: `orgNameUnset:${ORG}` } });
  console.log(`company: ${Object.keys(profile).length ? Object.entries(profile).map(([k, v]) => `${k} → ${v}`).join("; ") : "kept as the owner set it"}`);

  // Tags + clients.
  const tagIds: Record<string, string> = {};
  for (const label of Object.keys(TAG_COLORS)) {
    const t = await tx.tag.findUnique({ where: { organizationId_label: { organizationId: ORG, label } } });
    tagIds[label] = t?.id ?? (await tx.tag.create({ data: { id: rid(), organizationId: ORG, label, color: TAG_COLORS[label] } })).id;
    if (!t) add("Tag");
  }
  const clients: { id: string; name: string; email: string; phone: string; address: string; city: string }[] = [];
  for (const [i, c] of CLIENTS.entries()) {
    const num = 1000 + Math.floor(rnd() * 23000);
    const since = 5 + Math.floor(rnd() * 120);
    const row = {
      id: rid(), organizationId: ORG, name: `${c.first} ${c.last}`,
      email: `${c.first}.${c.last}@example.com`.toLowerCase(), phone: `(425) 555-01${String(i + 1).padStart(2, "0")}`,
      address: `${num} ${c.street}`, city: c.city, state: "WA", zip: c.zip, notes: c.note ?? null,
      customFields: JSON.stringify({ demo: true }), createdAt: la(-since, 11), updatedAt: la(-Math.floor(since / 3), 15),
    };
    await tx.client.create({ data: row });
    for (const tag of c.tags ?? []) await tx.clientTag.create({ data: { clientId: row.id, tagId: tagIds[tag] } });
    clients.push({ id: row.id, name: row.name, email: row.email, phone: row.phone, address: row.address, city: row.city });
  }
  add("Client", clients.length);

  // Crew: a User (no password; @example.com cannot receive a sign-in code) + seat + worker profile.
  const mute = (() => {
    const p = defaultPrefs();
    for (const k of Object.keys(p.matrix)) p.matrix[k] = [p.matrix[k][0], false, false];
    return JSON.stringify({ ...p, smsPaused: true });
  })();
  const crew: Record<CrewKey, { userId: string; workerId: string; name: string; rate: number }> = {} as any;
  for (const w of CREW) {
    const userId = rid();
    const first = w.name.split(" ")[0].toLowerCase();
    await tx.user.create({ data: { id: userId, email: `${first}.${w.name.split(" ")[1].toLowerCase()}@example.com`, name: w.name, notificationPrefsJson: mute, activeOrgId: ORG, createdAt: la(-90, 10) } });
    await tx.membership.create({ data: { id: rid(), userId, organizationId: ORG, role: w.role, createdAt: la(-90, 10) } });
    const workerId = rid();
    await tx.workerProfile.create({ data: { id: workerId, userId, organizationId: ORG, displayName: w.name, phone: `(425) 555-018${CREW.indexOf(w) + 1}`, smsOptIn: false, specialties: JSON.stringify(w.specialties), hourlyRate: w.rate, token: rid(), inviteStatus: "ACCEPTED", respondedAt: la(-89, 9), createdAt: la(-90, 10), lastSeenAt: la(-1, 18) } });
    crew[w.key] = { userId, workerId, name: w.name, rate: w.rate };
  }
  add("User (crew)", CREW.length); add("Membership", CREW.length); add("WorkerProfile", CREW.length);

  // Proposals, each with the line its estimator writes, and what followed it.
  let invoiceNo = 1001 + (await tx.invoice.count({ where: { organizationId: ORG } }));
  const jobsForReviews: { jobId: string | null; proposalId: string | null; clientId: string; at: Date }[] = [];
  const ev = (data: Record<string, unknown>) => tx.activityEvent.create({ data: { id: rid(), organizationId: ORG, actorId: null, ...data } }).then(() => add("ActivityEvent"));

  for (const p of PROPOSALS) {
    const client = clients[p.client];
    const createdAt = la(-p.age, 10, 15);
    const lines = p.lines.map((l, i) => {
      const total = money(l.qty * l.unit);
      return { id: rid(), name: l.name, measurementType: l.type, quantity: l.qty, unitPrice: l.unit, materialCost: l.kind === "material" ? l.unit : 0, laborCost: l.kind === "labor" ? l.unit : 0, total, position: i };
    });
    const subtotal = money(lines.reduce((s, l) => s + l.total, 0));
    const taxTotal = money(subtotal * TAX);
    const total = money(subtotal + taxTotal);
    const sentAt = p.status === "DRAFT" ? null : hoursAfter(createdAt, 20);
    const viewedAt = ["VIEWED", "ACCEPTED", "COMPLETED", "PAID", "DECLINED", "EXPIRED"].includes(p.status) && sentAt ? hoursAfter(sentAt, 3 + Math.floor(rnd() * 20)) : null;
    const acceptedAt = ["ACCEPTED", "COMPLETED", "PAID"].includes(p.status) && viewedAt ? hoursAfter(viewedAt, 26) : null;
    const declinedAt = p.status === "DECLINED" && viewedAt ? hoursAfter(viewedAt, 50) : null;
    const validUntil = sentAt ? new Date(sentAt.getTime() + (p.status === "EXPIRED" ? 14 : 30) * 86400_000) : la(30);
    const proposalId = rid();
    const lastTouch = [createdAt, sentAt, viewedAt, acceptedAt, declinedAt].filter(Boolean).sort((a: any, b: any) => b - a)[0] as Date;
    await tx.proposal.create({
      data: {
        id: proposalId, publicId: crypto.randomUUID(), trade: p.trade, organizationId: ORG, ownerId: null, clientId: client.id,
        title: p.title, description: p.scope, scopeOfWork: p.scope, address: `${client.address}, ${client.city}, WA`,
        status: p.status, subtotal, discountTotal: 0, taxRate: TAX, taxTotal, total, validUntil, sentAt, viewedAt, viewCount: viewedAt ? 1 + Math.floor(rnd() * 4) : 0,
        acceptedAt, acceptedIp: acceptedAt ? "203.0.113.24" : null, declinedAt, remindersOn: false, createdAt, updatedAt: lastTouch,
        lineItems: { create: lines },
      },
    });
    add(`Proposal (${p.tool})`); add("LineItem", lines.length);

    // The estimator's own trail line (lib/proposalKind reads it), and the rest of the story.
    const creation =
      p.tool === "roof" ? { kind: "CREATED", summary: `Converted roof estimate to proposal "${p.title}"` }
      : p.tool === "hvac" ? { kind: "CREATED", summary: `Converted HVAC estimate to proposal "${p.title}"` }
      : p.tool === "fence" ? { kind: "ESTIMATE", summary: `Priced a fence estimate — ${p.title.split("·")[1]?.trim() ?? p.title}, ${usd(total)}`, meta: JSON.stringify({ trade: "fence", amount: total, demo: true }) }
      : { kind: "CREATED", summary: `Converted "${p.projectType}" AI estimate to proposal "${p.title}"`, meta: JSON.stringify({ source: p.tool, projectType: p.projectType, demo: true }) };
    await ev({ ...creation, proposalId, clientId: client.id, createdAt });
    if (p.tool === "fence") await ev({ kind: "CREATED", summary: `Converted fence estimate to proposal "${p.title}"`, proposalId, clientId: client.id, createdAt: new Date(createdAt.getTime() + 60_000) });
    if (sentAt) await ev({ kind: "SENT", summary: `Sent "${p.title}" to ${client.name}`, proposalId, clientId: client.id, createdAt: sentAt });
    if (viewedAt) await ev({ kind: "VIEWED", summary: `${client.name} opened the proposal`, proposalId, clientId: client.id, createdAt: viewedAt });
    if (acceptedAt) await ev({ kind: "ACCEPTED", summary: `${client.name} accepted the proposal`, proposalId, clientId: client.id, createdAt: acceptedAt, meta: JSON.stringify({ acceptedName: client.name, demo: true }) });
    if (declinedAt) await ev({ kind: "DECLINED", summary: `${client.name} declined the proposal`, proposalId, clientId: client.id, createdAt: declinedAt, meta: JSON.stringify({ reason: "Went with a lower bid.", demo: true }) });

    // Estimator results the app keeps: roof measurements, AI estimates (Smart / Video / Blueprint).
    if (p.roof) {
      await tx.roofMeasurement.create({ data: { id: rid(), organizationId: ORG, createdById: null, source: "instant+recon", address: client.address, city: client.city, state: "WA", zip: CLIENTS[p.client].zip, areaSqft: money(p.roof.sq * 100), squares: p.roof.sq, predominantPitch: p.roof.pitch, facetCount: p.roof.facets, modelJson: "{}", chimneyJson: "[]", provenanceJson: JSON.stringify({ calibration: null, provenance: {} }), createdAt: new Date(createdAt.getTime() - 40 * 60_000) } });
      add("RoofMeasurement");
    }
    if (p.projectType) {
      const asItems = (k: Line["kind"]) => JSON.stringify(p.lines.filter((l) => l.kind === k).map((l) => ({ name: l.name, quantity: l.qty, unitPrice: l.unit, unit: l.type })));
      await tx.aiEstimate.create({ data: { id: rid(), organizationId: ORG, projectType: p.projectType, location: `${client.city}, WA`, materials: asItems("material"), labor: asItems("labor"), categories: JSON.stringify({ title: p.title, assumptions: ["Access from the driveway", "Normal working hours"], estimatedTimelineDays: 2, discount: 0 }), assumptions: "Access from the driveway\nNormal working hours", total: subtotal, createdAt: new Date(createdAt.getTime() - 25 * 60_000) } });
      add(`AiEstimate (${p.tool})`);
    }

    // Money: a deposit and the rest, recorded by hand (cash / check) — no processor anywhere.
    if (acceptedAt) {
      const stages = [
        { id: rid(), label: "Deposit", amount: 30, isPercent: true, position: 0 },
        { id: rid(), label: "Completion", amount: 70, isPercent: true, position: 1 },
      ];
      const paidStages = p.status === "PAID" ? 2 : 1;
      for (const [i, s] of stages.entries()) {
        const due = money((total * s.amount) / 100);
        if (i < paidStages) {
          const paidAt = i === 0 ? hoursAfter(acceptedAt, 30) : la(-(p.job ? -p.job.start - p.job.days : 3), 16);
          const method = i === 0 ? "CHECK" : pick(["CHECK", "CASH", "CHECK"]);
          const invoiceId = rid();
          await tx.invoice.create({ data: { id: invoiceId, organizationId: ORG, proposalId, clientId: client.id, number: `INV-${invoiceNo++}`, amount: due, billedAmount: due, status: "PAID", provider: "MANUAL", externalId: `paid:stages:${s.id}`, paidAt, createdAt: paidAt } });
          const paymentId = rid();
          await tx.payment.create({ data: { id: paymentId, organizationId: ORG, proposalId, invoiceId, clientId: client.id, amount: due, provider: "MANUAL", status: "PAID", externalId: null, method, paidAt, feeAmount: 0, netAmount: due, livemode: true, meta: JSON.stringify({ note: method === "CHECK" ? `Check #${2100 + Math.floor(rnd() * 800)}` : "Cash on completion", demo: true }), createdAt: paidAt } });
          await tx.installment.create({ data: { ...s, proposalId, status: "PAID", paidAt, paidAmount: due, paymentId } });
          await ev({ kind: "PAYMENT_RECEIVED", summary: `${usd(due)} received (${s.label}) via ${method.toLowerCase()}`, proposalId, clientId: client.id, createdAt: paidAt, meta: JSON.stringify({ demo: true }) });
          add("Invoice (paid)"); add("Payment (manual)");
        } else {
          await tx.installment.create({ data: { ...s, proposalId, status: "UNPAID", dueDate: p.status === "COMPLETED" ? la(-2) : null } });
          if (p.status === "COMPLETED") {
            await tx.invoice.create({ data: { id: rid(), organizationId: ORG, proposalId, clientId: client.id, number: `INV-${invoiceNo++}`, amount: due, billedAmount: due, status: "PENDING", provider: "MANUAL", externalId: `stages:${s.id}`, dueDate: la(-2), createdAt: la(-9, 17) } });
            add("Invoice (open)");
          }
        }
      }
      if (p.status === "PAID") {
        const paidAt = la(-(p.job ? -p.job.start - p.job.days : 3), 16);
        await tx.proposal.update({ where: { id: proposalId }, data: { paidAt, updatedAt: paidAt } });
      }
      add("Installment", 2);
    }

    // The job it became.
    if (p.job) {
      const status = p.job.status ?? (p.job.start + p.job.days <= 0 ? "COMPLETED" : p.job.start <= 0 ? "IN_PROGRESS" : "SCHEDULED");
      const jobId = await makeJob(tx, ORG, owner.id, crew, { clientId: client.id, proposalId, title: p.job.title, start: p.job.start, days: p.job.days, crew: p.job.crew, status, scope: p.scope, pay: Math.round(total * 0.12 / p.job.crew.length / 10) * 10 }, add);
      if (status === "COMPLETED") jobsForReviews.push({ jobId, proposalId, clientId: client.id, at: la(p.job.start + p.job.days, 17) });
    } else if (p.status === "ACCEPTED") {
      // Accepted, not on the calendar yet: the calendar's unscheduled tray.
      await tx.job.create({ data: { id: rid(), organizationId: ORG, clientId: client.id, proposalId, title: `${p.title.split("—")[0].trim()} — ${client.name.split(" ")[1]}`, status: "SCHEDULED", scopeOfWork: p.scope, notes: "Waiting on the permit.", createdAt: acceptedAt! } });
      add("Job");
    }
  }

  for (const j of SMALL_JOBS) {
    const client = clients[j.client];
    const jobId = await makeJob(tx, ORG, owner.id, crew, { clientId: client.id, proposalId: null, title: `${j.title} — ${client.name.split(" ")[1]}`, start: j.start, days: j.days, crew: j.crew, status: j.status, scope: null, pay: 180 }, add);
    if (j.status === "COMPLETED") jobsForReviews.push({ jobId, proposalId: null, clientId: client.id, at: la(j.start + j.days, 17) });
  }

  for (const a of APPOINTMENTS) {
    const client = clients[a.client];
    const id = rid();
    const startsAt = la(a.day, a.hour);
    await tx.appointment.create({ data: { id, organizationId: ORG, clientId: client.id, createdById: owner.id, title: `${a.title} — ${client.name}`, status: a.status, startsAt, endsAt: hoursAfter(startsAt, 1), notes: `${client.address}, ${client.city}`, createdAt: la(Math.min(a.day, 0) - 3, 12) } });
    await tx.appointmentAssignment.create({ data: { id: rid(), appointmentId: id, workerId: crew[a.who].workerId } });
    add("Appointment");
  }

  // Team chat (the Messages page): the owner sits in every thread.
  const thread = async (kind: string, title: string | null, people: CrewKey[], msgs: [CrewKey | "joe", string, number][], jobId?: string) => {
    const id = rid();
    const first = msgs[0][2];
    await tx.conversation.create({ data: { id, organizationId: ORG, kind, title, jobId: jobId ?? null, createdAt: new Date(now.getTime() - first * 60_000 - 3600_000) } });
    for (const uid of [owner.id, ...people.map((k) => crew[k].userId)]) await tx.conversationParticipant.create({ data: { id: rid(), conversationId: id, userId: uid, lastReadAt: now } });
    for (const [who, body, minsAgo] of msgs) await tx.message.create({ data: { id: rid(), conversationId: id, authorId: who === "joe" ? owner.id : crew[who].userId, body, createdAt: new Date(now.getTime() - minsAgo * 60_000) } });
    add("Conversation"); add("Message", msgs.length);
  };
  await thread("GROUP", "Eastside crew", ["diego", "tyler", "andre", "kenji", "hannah"], [
    ["joe", "Morning all — the Marchetti metal roof starts in three days. Panels deliver the afternoon before.", 2900],
    ["diego", "Got it. I'll swing by to check the drop spot, the driveway is steep.", 2880],
    ["tyler", "I'll grab the extra pipe boots from the shop.", 2870],
    ["andre", "Gallardo fence posts are marked. Utility locate came back clear.", 1500],
    ["kenji", "Ferreira heat pump is running great, she sent a thank-you.", 1440],
    ["hannah", "Two new estimate requests in Sammamish this week, both re-roofs.", 600],
    ["joe", "Nice. Kenji, can you take the adjuster meeting at the Vickery house tomorrow?", 590],
    ["kenji", "Yep, on my calendar.", 585],
  ]);
  await thread("DIRECT", null, ["diego"], [
    ["diego", "Halvorsen asked about adding gutter guards. Want me to measure while we're up there?", 4300],
    ["joe", "Yes please, send me the footage and I'll put a proposal together.", 4290],
    ["diego", "190 LF, 6 downspouts. Photos in the job.", 4200],
    ["joe", "Perfect, thanks.", 4190],
  ]);
  await thread("DIRECT", null, ["hannah"], [
    ["hannah", "The Morrissey siding proposal was opened twice last night.", 900],
    ["joe", "Good sign. Follow up with a call tomorrow, not a text — she prefers calls.", 880],
    ["hannah", "Will do. Also the Ashby fence went out this morning.", 300],
  ]);

  // Reviews — only on request (--reviews): the public /r/<slug> page and lead routing read them,
  // so they are written hidden from the public page.
  if (REVIEWS) {
    for (const [i, [rating, comment]] of REVIEW_TEXT.entries()) {
      const src = jobsForReviews[i];
      if (!src) break;
      const completedAt = new Date(src.at.getTime() + (1 + (i % 3)) * 86400_000);
      await tx.reviewRequest.create({ data: { id: rid(), organizationId: ORG, jobId: src.jobId, proposalId: src.proposalId, clientId: src.clientId, publicToken: rid(), status: "COMPLETED", rating, comment, photosJson: "[]", hiddenAt: now, sentAt: src.at, remindedAt: src.at, completedAt: completedAt > now ? now : completedAt, createdAt: src.at } });
      add("ReviewRequest (hidden from the public page)");
    }
  }

  console.log("\nseeded:");
  for (const [k, n] of Object.entries(created)) console.log(`  ${k.padEnd(44)} ${n}`);
}

async function makeJob(
  tx: any, ORG: string, ownerId: string, crew: Record<CrewKey, { userId: string; workerId: string; name: string; rate: number }>,
  j: { clientId: string; proposalId: string | null; title: string; start: number; days: number; crew: CrewKey[]; status: string; scope: string | null; pay: number },
  add: (k: string, n?: number) => void,
): Promise<string> {
  const jobId = rid();
  const startsAt = la(j.start, 8);
  const endsAt = la(j.start + j.days - 1, 16);
  const createdAt = la(Math.min(j.start, 0) - 6, 12);
  await tx.job.create({ data: { id: jobId, organizationId: ORG, clientId: j.clientId, proposalId: j.proposalId, title: j.title, status: j.status, scopeOfWork: j.scope, startsAt, endsAt, createdAt, updatedAt: j.status === "COMPLETED" ? endsAt : createdAt } });
  await tx.jobEvent.create({ data: { id: rid(), organizationId: ORG, jobId, createdById: ownerId, title: j.title, startsAt, endsAt } });
  for (const k of j.crew) {
    await tx.jobAssignment.create({ data: { id: rid(), jobId, workerId: crew[k].workerId, status: j.status === "COMPLETED" ? "COMPLETED" : "ACCEPTED", assignedAt: la(Math.min(j.start, 0) - 5, 13), pay: j.pay, paidAt: j.status === "COMPLETED" ? la(j.start + j.days + 2, 17) : null } });
  }
  // Days on site, for the work that has begun.
  for (let d = 0; d < j.days && j.start + d <= 0; d++) {
    const day = la(j.start + d, 12);
    const open = j.status === "IN_PROGRESS" && j.start + d === 0;
    await tx.workDay.create({ data: { id: rid(), jobId, organizationId: ORG, date: ymd(day), dayNumber: d + 1, status: open ? "OPEN" : "CLOSED", source: "worker", note: open ? null : pick(["Tear-off done, dried in for the night.", "All panels on, cleanup done.", "Finished, magnet sweep of the yard.", "Wrapped up, photos uploaded."]), closedAt: open ? null : la(j.start + d, 17), createdAt: la(j.start + d, 8) } });
  }
  if (j.status === "IN_PROGRESS" || j.status === "SCHEDULED") {
    // The job's own crew thread, as createJob opens it.
    const id = rid();
    await tx.conversation.create({ data: { id, organizationId: ORG, jobId, kind: "JOB", title: `Job · ${j.title}`, createdAt: la(Math.min(j.start, 0) - 5, 13) } });
    for (const uid of [ownerId, ...j.crew.map((k) => crew[k].userId)]) await tx.conversationParticipant.create({ data: { id: rid(), conversationId: id, userId: uid, lastReadAt: new Date() } });
    add("Conversation (job)");
  }
  add("Job"); add("JobEvent"); add("JobAssignment", j.crew.length);
  return jobId;
}

// ── seed, part two: what the book's pages show besides it ─────────────────
// Each section stands on its own and is skipped when its rows are already in, so --seed can run
// again on an organization that has the book: it adds only what is missing, never a second copy.
// Everything hangs off the book's own rows, found again by the names the book gave them.

type ProjectSpec = {
  name: string; client: number; status: "ACTIVE" | "ON_HOLD" | "COMPLETED"; description: string;
  from: number | null; to: number | null; proposals: string[];
  budget: [string, number][]; spent: [string, number, number, string, string][]; // category, amount, days ago, vendor, note
  // (crew labor is not a line here: the jobs' crew pay already counts it, in the project and in Financials)
  newJobs?: { title: string; start: number; days: number; crew: CrewKey[]; status: string }[];
};
const PROJECTS: ProjectSpec[] = [
  { name: "Halvorsen re-roof", client: 1, status: "COMPLETED", description: "Full re-roof, 26 squares, GAF Timberline HDZ.", from: -40, to: -34, proposals: ["Architectural shingle re-roof · 26 sq"],
    budget: [["MATERIALS", 7400], ["LABOR", 5600], ["PERMITS", 450], ["EQUIPMENT", 650]], spent: [["MATERIALS", 7128, 39, "Eastside Roofing Supply", "Shingles, underlayment, flashings"], ["PERMITS", 450, 41, "City of Bellevue", "Re-roof permit"], ["EQUIPMENT", 575, 38, "Waste Haul NW", "20-yd dumpster"]] },
  { name: "Brandt backyard fence", client: 8, status: "COMPLETED", description: "148 LF cedar privacy fence with a walk gate.", from: -26, to: -22, proposals: ["6' cedar privacy fence · 148 LF"],
    budget: [["MATERIALS", 5200], ["LABOR", 3900]], spent: [["MATERIALS", 4985, 25, "Cascade Lumber & Cedar", "Pickets, rails, posts, concrete"]] },
  { name: "Delgado gutters & leaf guards", client: 0, status: "COMPLETED", description: "6\" seamless gutters with micro-mesh guards.", from: -21, to: -19, proposals: ["Seamless gutters + leaf guards"],
    budget: [["MATERIALS", 4400], ["LABOR", 900]], spent: [["MATERIALS", 4210, 21, "Eastside Roofing Supply", "Gutter coil, guards, downspouts"]] },
  { name: "Okafor storm repair — insurance", client: 4, status: "COMPLETED", description: "West-slope wind damage; the adjuster approved the scope.", from: -11, to: -8, proposals: ["Storm damage repair — west slope"],
    budget: [["MATERIALS", 700], ["LABOR", 1400]], spent: [["MATERIALS", 655, 10, "Eastside Roofing Supply", "Matching shingles, vents"]] },
  { name: "Marchetti standing-seam roof", client: 6, status: "ACTIVE", description: "Metal roof in Dark Bronze, gutters and trim to follow.", from: 2, to: 12, proposals: ["Standing-seam metal roof · 31 sq"],
    budget: [["MATERIALS", 21500], ["LABOR", 13800], ["PERMITS", 600], ["EQUIPMENT", 1100]], spent: [["MATERIALS", 4925, 2, "Eastside Roofing Supply", "Panel deposit — 25%"], ["PERMITS", 600, 5, "City of Kirkland", "Re-roof permit"]],
    newJobs: [{ title: "Gutters & trim — Marchetti", start: 9, days: 1, crew: ["tyler"], status: "SCHEDULED" }] },
  { name: "Crane re-roof", client: 24, status: "ACTIVE", description: "Cedar shake off, new sheathing, architectural shingles.", from: -3, to: 7, proposals: ["Cedar shake to architectural shingle · 28 sq"],
    budget: [["MATERIALS", 11200], ["LABOR", 7800], ["EQUIPMENT", 900], ["PERMITS", 450]], spent: [["MATERIALS", 7180, 3, "Eastside Roofing Supply", "Shingles, CDX, underlayment"], ["EQUIPMENT", 640, 2, "Waste Haul NW", "30-yd dumpster for the shakes"], ["PERMITS", 450, 6, "City of Woodinville", "Re-roof permit"]],
    newJobs: [{ title: "Dumpster drop & prep — Crane", start: -2, days: 1, crew: ["andre"], status: "COMPLETED" }, { title: "Gutters & downspouts — Crane", start: 6, days: 1, crew: ["tyler"], status: "SCHEDULED" }] },
  { name: "Gallardo perimeter fence", client: 22, status: "ACTIVE", description: "174 LF cedar with a 10' double drive gate.", from: 7, to: 10, proposals: ["6' cedar fence + double drive gate · 174 LF"],
    budget: [["MATERIALS", 7600], ["LABOR", 4500]], spent: [] },
  { name: "Petrakis backyard ADU — exterior", client: 23, status: "ON_HOLD", description: "Roof, siding and windows from the architect's set — waiting on the city's permit.", from: 14, to: 40, proposals: ["ADU — roof, siding & windows"],
    budget: [["MATERIALS", 21500], ["LABOR", 16800], ["SUBCONTRACTORS", 2400], ["PERMITS", 1850]], spent: [["PERMITS", 1850, 36, "City of Woodinville", "ADU building permit — plan review"]] },
  { name: "Ferreira heat pump", client: 12, status: "ACTIVE", description: "3-ton variable-speed heat pump — installed, closing out the final payment.", from: -13, to: -11, proposals: ["Heat pump replacement · 3 ton"],
    budget: [["MATERIALS", 7600], ["LABOR", 1800], ["PERMITS", 420]], spent: [["MATERIALS", 7740, 13, "Northwest HVAC Distributors", "Heat pump, air handler, line set"], ["PERMITS", 420, 14, "City of Redmond", "Mechanical permit"]] },
  { name: "Morrissey siding & repaint", client: 13, status: "ON_HOLD", description: "Hardie repairs on two elevations and a full repaint — on hold for the HOA's color approval.", from: 20, to: 32, proposals: ["Hardie siding repair & repaint"],
    budget: [["MATERIALS", 4200], ["LABOR", 12600]], spent: [] },
  { name: "Natarajan addition — roof tie-in", client: 2, status: "ACTIVE", description: "Tie the new addition into the main roof, match siding per sheet A-3.", from: null, to: null, proposals: ["Addition — roof tie-in & exterior"],
    budget: [], spent: [["OTHER", 350, 4, "Puget Sound Surveying", "Ridge-height survey for the tie-in"]] },
];
const BUDGET_ORDER = ["MATERIALS", "LABOR", "SUBCONTRACTORS", "PERMITS", "EQUIPMENT", "OTHER"];

const CALLS: { from: number; ago: number; secs: number; status: "COMPLETED" | "FAILED"; outcome: "done" | "transfer" | "voicemail" | "failed"; summary: string; lines: string[] }[] = [
  { from: 41, ago: 3, secs: 212, status: "COMPLETED", outcome: "done", summary: "Homeowner in Sammamish wants a re-roof estimate; 2-story, about 20 years old. Booked an estimate visit.", lines: ["Desk: Stevenson Roofing & Exteriors, this is the office assistant — how can I help?", "Caller: Hi, I'd like someone to look at my roof. It's about twenty years old and we're seeing granules in the gutters.", "Desk: Happy to set that up. What's the address?", "Caller: It's on 228th Avenue in Sammamish.", "Desk: Thanks. Is Thursday afternoon good for an estimate visit?", "Caller: Thursday works.", "Desk: You're booked for Thursday at 2 PM. Kenji will text when he's on the way."] },
  { from: 42, ago: 20, secs: 96, status: "COMPLETED", outcome: "transfer", summary: "Existing client asking about the metal roof start date — transferred to Joe.", lines: ["Desk: Stevenson Roofing & Exteriors, how can I help?", "Caller: Hi, this is about our metal roof — I wanted to check the start date.", "Desk: Let me get Joe for you, one moment."] },
  { from: 43, ago: 26, secs: 148, status: "COMPLETED", outcome: "done", summary: "Fence quote request in Bothell, about 200 feet; message taken for Hannah.", lines: ["Desk: Stevenson Roofing & Exteriors, how can I help?", "Caller: We need a new cedar fence, maybe two hundred feet, in Bothell.", "Desk: Got it. I'll have Hannah call you back today to set up a time. What's the best number?", "Caller: This one is fine.", "Desk: Perfect, she'll call this afternoon."] },
  { from: 44, ago: 49, secs: 61, status: "COMPLETED", outcome: "voicemail", summary: "After-hours call about a leak around a skylight; left a message asking for a callback.", lines: ["Desk: Stevenson Roofing & Exteriors — the office is closed, but I can take a message.", "Caller: Hi, we've got a drip around our skylight. Please call me back tomorrow."] },
  { from: 45, ago: 74, secs: 187, status: "COMPLETED", outcome: "done", summary: "Insurance claim question — adjuster visit scheduled with Kenji.", lines: ["Desk: Stevenson Roofing & Exteriors, how can I help?", "Caller: My adjuster wants to meet the roofer at the house. Can you do Monday?", "Desk: Monday at 10 works for Kenji. I've put it on the calendar.", "Caller: Great, thank you."] },
  { from: 46, ago: 98, secs: 0, status: "FAILED", outcome: "failed", summary: "Missed call — the caller hung up before the desk answered.", lines: [] },
  { from: 47, ago: 122, secs: 134, status: "COMPLETED", outcome: "done", summary: "Ductless mini-split question; booked a walkthrough for the bonus room.", lines: ["Desk: Stevenson Roofing & Exteriors, how can I help?", "Caller: We're thinking about a ductless unit for the bonus room.", "Desk: We can do a walkthrough. Is Tuesday at 11 good?", "Caller: Yes.", "Desk: Booked. You'll get a reminder the day before."] },
  { from: 48, ago: 150, secs: 77, status: "COMPLETED", outcome: "done", summary: "Gutter cleaning request for next week; added to the schedule.", lines: ["Desk: Stevenson Roofing & Exteriors, how can I help?", "Caller: Can you clean our gutters next week?", "Desk: Yes — I've put you down for Friday morning."] },
];

const SUPPLIERS = [
  { key: "roof", name: "Eastside Roofing Supply", email: "orders.eastside-roofing@example.com", phone: "(425) 555-0161" },
  { key: "fence", name: "Cascade Lumber & Cedar", email: "yard.cascade-lumber@example.com", phone: "(425) 555-0162" },
  { key: "hvac", name: "Northwest HVAC Distributors", email: "counter.nw-hvac@example.com", phone: "(425) 555-0163" },
];
const STOCK: { trade: string; name: string; unit: string; onHand: number; reorder: number; cost: number; used: number }[] = [
  { trade: "roof", name: "Architectural shingles (bundle)", unit: "bundle", onHand: 42, reorder: 30, cost: 38.5, used: 81 },
  { trade: "roof", name: "Synthetic underlayment roll", unit: "roll", onHand: 6, reorder: 8, cost: 92, used: 9 },
  { trade: "roof", name: "Ice & water shield roll", unit: "roll", onHand: 5, reorder: 6, cost: 118, used: 7 },
  { trade: "roof", name: "Ridge cap shingles (bundle)", unit: "bundle", onHand: 14, reorder: 6, cost: 52, used: 8 },
  { trade: "roof", name: "Drip edge 10'", unit: "piece", onHand: 40, reorder: 20, cost: 9.8, used: 55 },
  { trade: "roof", name: "Pipe boot 3\"", unit: "each", onHand: 9, reorder: 6, cost: 14, used: 11 },
  { trade: "fence", name: "Cedar picket 1×6×6'", unit: "each", onHand: 220, reorder: 150, cost: 3.9, used: 410 },
  { trade: "fence", name: "Pressure-treated post 4×4×8'", unit: "each", onHand: 18, reorder: 24, cost: 16.5, used: 21 },
  { trade: "fence", name: "Concrete mix 50 lb", unit: "bag", onHand: 26, reorder: 20, cost: 6.4, used: 38 },
  { trade: "fence", name: "Gate hardware kit", unit: "kit", onHand: 3, reorder: 2, cost: 64, used: 2 },
  { trade: "hvac", name: "Line set 3/8×3/4 25'", unit: "each", onHand: 4, reorder: 3, cost: 168, used: 2 },
  { trade: "hvac", name: "Condenser pad 24×36", unit: "each", onHand: 3, reorder: 2, cost: 46, used: 1 },
  { trade: "hvac", name: "Pleated filter 16×25×1", unit: "each", onHand: 24, reorder: 12, cost: 7.5, used: 12 },
];

async function seedExtras(tx: any, ORG: string, owner: any, stockKey: (name: string) => string) {
  const now = new Date();
  const created: Record<string, number> = {};
  const add = (k: string, n = 1) => (created[k] = (created[k] ?? 0) + n);
  const skipped: string[] = [];
  const has = async (model: string) => (await tx[model].count({ where: { organizationId: ORG, id: { startsWith: DEMO } } })) > 0;
  const utcDay = (days: number) => { const d = la(days, 12); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };

  // The book, found again.
  const clientRows = await tx.client.findMany({ where: { organizationId: ORG, id: { startsWith: DEMO } }, select: { id: true, name: true } });
  if (!clientRows.length) { console.log("extras: no book in this organization — nothing to hang them on"); return; }
  const clientId = (i: number): string | null => clientRows.find((c: any) => c.name === `${CLIENTS[i].first} ${CLIENTS[i].last}`)?.id ?? null;
  const proposals = await tx.proposal.findMany({ where: { organizationId: ORG, id: { startsWith: DEMO } }, select: { id: true, title: true, taxRate: true, clientId: true } });
  const proposalBy = (title: string) => proposals.find((p: any) => p.title === title) ?? null;
  const users = await tx.user.findMany({ where: { id: { startsWith: DEMO }, memberships: { some: { organizationId: ORG } } }, select: { id: true, name: true, workerProfile: { select: { id: true } } } });
  const crew = Object.fromEntries(CREW.map((w) => {
    const u = users.find((x: any) => x.name === w.name);
    return [w.key, { userId: u?.id, workerId: u?.workerProfile?.id, name: w.name, rate: w.rate }];
  })) as Record<CrewKey, { userId: string; workerId: string; name: string; rate: number }>;
  const jobBy = (title: string) => tx.job.findFirst({ where: { organizationId: ORG, id: { startsWith: DEMO }, title }, select: { id: true } });

  // Projects — the book's proposals and their jobs filed under them (as setProposalProject does).
  if (await has("project")) skipped.push("projects");
  else {
    for (const p of PROJECTS) {
      const cid = clientId(p.client);
      const id = rid();
      const total = p.budget.reduce((s, [, a]) => s + a, 0);
      const createdAt = la(Math.min(p.from ?? -4, 0) - 6, 11);
      const touched = p.status === "COMPLETED" && p.to !== null ? la(p.to, 17) : la(-1 - (PROJECTS.indexOf(p) % 3), 16);
      await tx.project.create({ data: { id, organizationId: ORG, name: p.name, description: p.description, status: p.status, clientId: cid, startsAt: p.from === null ? null : utcDay(p.from), endsAt: p.to === null ? null : utcDay(p.to), budget: total, createdAt, updatedAt: touched } });
      for (const [category, amount] of p.budget) await tx.projectBudgetLine.create({ data: { id: rid(), projectId: id, category, amount, position: BUDGET_ORDER.indexOf(category), createdAt, updatedAt: createdAt } });
      for (const [category, amount, ago, vendor, note] of p.spent) {
        await tx.projectExpense.create({ data: { id: rid(), projectId: id, category, amount, vendor, note, spentAt: new Date(utcDay(-ago).getTime() + 12 * 3600_000), createdById: owner.id, createdAt: la(-ago, 17) } });
        add("ProjectExpense");
      }
      for (const title of p.proposals) {
        const pr = proposalBy(title);
        if (!pr) continue;
        const was = await tx.proposal.findUnique({ where: { id: pr.id }, select: { updatedAt: true } });
        await tx.proposal.update({ where: { id: pr.id }, data: { projectId: id, updatedAt: was.updatedAt } });
        const jobs = await tx.job.findMany({ where: { proposalId: pr.id }, select: { id: true, updatedAt: true } });
        for (const j of jobs) await tx.job.update({ where: { id: j.id }, data: { projectId: id, updatedAt: j.updatedAt } });
      }
      for (const nj of p.newJobs ?? []) {
        const jobId = await makeJob(tx, ORG, owner.id, crew, { clientId: cid!, proposalId: null, title: nj.title, start: nj.start, days: nj.days, crew: nj.crew, status: nj.status, scope: null, pay: 200 }, add);
        await tx.job.update({ where: { id: jobId }, data: { projectId: id } });
      }
      add(`Project (${p.status})`); add("ProjectBudgetLine", p.budget.length);
    }
  }

  // Jobs: what was spent on them (no receipts on file), change orders, the job threads' chatter.
  if (await has("jobExpense")) skipped.push("job expenses");
  else {
    const rows: [string, string, number, number, string, string, CrewKey | null][] = [
      ["Gutter cleaning & roof tune-up — Lindqvist", "Disposal", 45, 15, "APPROVED", "Transfer station", null],
      ["Leak repair — skylight curb — Sorensen", "Materials", 86.4, 6, "REIMBURSED", "Eastside Roofing Supply", "diego"],
      ["Moss treatment & roof wash — Iverson", "Materials", 64.2, 3, "APPROVED", "Eastside Roofing Supply", null],
      ["Moss treatment & roof wash — Iverson", "Fuel", 38.9, 3, "APPROVED", "Gas station — Issaquah", "tyler"],
      ["Skylight reflash — Odell", "Materials", 112, 27, "APPROVED", "Eastside Roofing Supply", null],
      ["Cedar fence stain — Castellano", "Materials", 214, 45, "APPROVED", "Cascade Lumber & Cedar", null],
      ["Re-roof — Crane", "Fuel", 52.3, 0, "SUBMITTED", "Gas station — Woodinville", "diego"],
      ["Re-roof — Crane", "Materials", 128.75, 0, "SUBMITTED", "Eastside Roofing Supply", "tyler"],
    ];
    for (const [title, category, amount, ago, status, vendor, by] of rows) {
      const job = await jobBy(title);
      if (!job) continue;
      const worker = by ? crew[by] : null;
      await tx.jobExpense.create({ data: { id: rid(), jobId: job.id, organizationId: ORG, category, amount, vendor, receiptUrl: null, spentAt: la(-ago, 13), createdAt: la(-ago, 16), submittedById: worker?.userId ?? owner.id, paidBy: worker ? "WORKER" : "COMPANY", status, reviewedById: status === "SUBMITTED" ? null : owner.id, reviewedAt: status === "SUBMITTED" ? null : la(-ago, 18), reimbursedAt: status === "REIMBURSED" ? la(-ago + 2, 10) : null, purpose: "JOB" } });
      add("JobExpense");
    }
  }
  if (await has("changeOrder")) skipped.push("change orders");
  else {
    const cos: { proposal: string; job: string | null; title: string; status: string; lines: [string, number, string, number, "material" | "labor"][]; reason: string; ago: number }[] = [
      { proposal: "Standing-seam metal roof · 31 sq", job: "Metal roof — Marchetti", title: "Replace rotted sheathing", status: "APPROVED", lines: [["1/2\" CDX sheathing", 6, "sheet", 95, "material"]], reason: "Found soft decking at the north eave during the pre-start walk.", ago: 2 },
      { proposal: "Cedar shake to architectural shingle · 28 sq", job: "Re-roof — Crane", title: "Reflash two skylights", status: "SENT", lines: [["Skylight flashing kit", 2, "each", 210, "material"], ["Reflash labor", 4, "hour", 95, "labor"]], reason: "Both skylight flashings are rusted through under the old shakes.", ago: 0 },
      { proposal: "6' cedar fence + double drive gate · 174 LF", job: null, title: "Extra 12 LF along the driveway", status: "DRAFT", lines: [["Cedar fence, per foot", 12, "LF", 62, "material"]], reason: "The client asked to run the fence to the corner of the driveway.", ago: 1 },
      { proposal: "Architectural shingle re-roof · 26 sq", job: "Re-roof — Halvorsen", title: "Gutter guards", status: "DECLINED", lines: [["Micro-mesh leaf guards", 190, "LF", 9, "material"]], reason: "Offered while the crew was on the roof.", ago: 37 },
    ];
    for (const c of cos) {
      const pr = proposalBy(c.proposal);
      if (!pr) continue;
      const job = c.job ? await jobBy(c.job) : null;
      const amount = money(c.lines.reduce((s, l) => s + l[1] * l[3], 0));
      const rate = pr.taxRate ?? TAX;
      const taxTotal = money(amount * rate);
      const total = money(amount + taxTotal);
      const at = la(-c.ago, 11);
      const id = rid();
      await tx.changeOrder.create({ data: {
        id, organizationId: ORG, jobId: job?.id ?? null, proposalId: pr.id, title: c.title, description: c.reason, reason: c.reason, amount, status: c.status, publicToken: rid(), number: 1, kind: "custom",
        linesJson: JSON.stringify(c.lines.map(([name, quantity, unit, unitPrice, kind], i) => ({ key: `line-${i + 1}`, name, quantity, unit, unitPrice, kind }))), taxable: true, taxRate: rate, taxTotal, total, photosJson: "[]",
        sentAt: c.status === "DRAFT" ? null : at, approvedAt: c.status === "APPROVED" ? hoursAfter(at, 5) : null,
        approvedName: c.status === "APPROVED" ? clientRows.find((x: any) => x.id === pr.clientId)?.name ?? null : null, approvedVia: c.status === "APPROVED" ? "client" : null,
        declinedAt: c.status === "DECLINED" ? hoursAfter(at, 26) : null, declineReason: c.status === "DECLINED" ? "Maybe next year." : null, createdByUserId: owner.id, createdAt: at, updatedAt: at,
      } });
      // An approval adds its own payment stage, as the app's approval does.
      if (c.status === "APPROVED") await tx.installment.create({ data: { id: rid(), proposalId: pr.id, label: `Change order #1 — ${c.title}`, amount: total, isPercent: false, position: 2, status: "UNPAID", changeOrderId: id } });
      add(`ChangeOrder (${c.status})`);
    }
  }
  const jobThreads = await tx.conversation.findMany({ where: { organizationId: ORG, id: { startsWith: DEMO }, kind: "JOB" }, select: { id: true, title: true, _count: { select: { messages: true } } } });
  if (jobThreads.some((t: any) => t._count.messages > 0)) skipped.push("job threads");
  else {
    const say: Record<string, [CrewKey | "joe", string, number][]> = {
      "Re-roof — Crane": [["diego", "Shakes are off the south side. Sheathing looks good except two sheets by the chimney.", 300], ["joe", "Swap them, I'll add it to the change order.", 290], ["tyler", "Dumpster is about 70% full, might need a swap tomorrow.", 120]],
      "Metal roof — Marchetti": [["joe", "Panels deliver the afternoon before. Client asked us to keep the side gate closed — dog.", 1500], ["diego", "Noted. We'll stage on the driveway.", 1450]],
      "Cedar fence — Gallardo": [["andre", "Utility locate is marked, posts go in first thing.", 2000], ["joe", "Great. Gate posts get the 6x6s.", 1980]],
      "Gutters & downspouts — Crane": [["tyler", "Color is Musket Brown, coil is on the truck.", 600]],
    };
    for (const t of jobThreads) {
      const lines = say[(t.title ?? "").replace(/^Job · /, "")];
      if (!lines) continue;
      for (const [who, body, mins] of lines) await tx.message.create({ data: { id: rid(), conversationId: t.id, authorId: who === "joe" ? owner.id : crew[who].userId, body, createdAt: new Date(now.getTime() - mins * 60_000) } });
      add("Message (job threads)", lines.length);
    }
  }

  // AI desk: calls as the desk logs them — no recording, made-up call ids, no lead behind any.
  if (await has("aiPhoneCall")) skipped.push("AI desk calls");
  else {
    for (const c of CALLS) {
      const callSid = `${DEMO}CA${crypto.randomBytes(14).toString("hex")}`;
      const startedAt = new Date(now.getTime() - c.ago * 3600_000);
      await tx.aiPhoneCall.create({ data: { id: rid(), organizationId: ORG, direction: "INBOUND", fromNumber: `+142555501${c.from}`, toNumber: "+14255550100", status: c.status, durationSeconds: c.secs || null, recordingUrl: null, transcript: c.lines.length ? c.lines.join("\n") : null, summary: c.summary, leadId: null, callSid, startedAt, endedAt: new Date(startedAt.getTime() + c.secs * 1000) } });
      await tx.syncState.create({ data: { key: `callout:${callSid}`, cursor: JSON.stringify({ outcome: c.outcome, appointmentId: null, seconds: c.secs, messageTaken: c.outcome === "voicemail", at: startedAt.toISOString(), error: null }) } });
      add("AiPhoneCall");
    }
  }

  // Stock: suppliers, what is on the shelf, what came in and went out to the book's jobs.
  if (await has("supplier")) skipped.push("inventory");
  else {
    const supplierId: Record<string, string> = {};
    for (const sp of SUPPLIERS) {
      supplierId[sp.key] = rid();
      await tx.supplier.create({ data: { id: supplierId[sp.key], organizationId: ORG, name: sp.name, email: sp.email, phone: sp.phone, createdAt: la(-80, 10) } });
      add("Supplier");
    }
    const pastJobs = await tx.job.findMany({ where: { organizationId: ORG, id: { startsWith: DEMO }, status: "COMPLETED" }, select: { id: true, title: true, proposal: { select: { trade: true } } } });
    for (const it of STOCK) {
      const key = stockKey(it.name);
      if (await tx.inventoryItem.findUnique({ where: { organizationId_trade_key: { organizationId: ORG, trade: it.trade, key } } })) continue; // the owner's own item wins
      const id = rid();
      await tx.inventoryItem.create({ data: { id, organizationId: ORG, trade: it.trade, name: it.name, key, unit: it.unit, onHand: it.onHand, reorderPoint: it.reorder, supplierId: supplierId[it.trade], lastCost: it.cost, createdAt: la(-75, 10), updatedAt: la(-2, 15) } });
      await tx.inventoryMovement.create({ data: { id: rid(), itemId: id, kind: "RECEIVED", quantity: it.onHand + it.used, note: "Opening stock", actorId: owner.id, unitCost: it.cost, createdAt: la(-60, 9) } });
      const jobs = pastJobs.filter((j: any) => (j.proposal?.trade ?? (/fence/i.test(j.title) ? "fence" : "roof")) === it.trade).slice(0, 3);
      for (const [i, j] of jobs.entries()) {
        await tx.inventoryMovement.create({ data: { id: rid(), itemId: id, kind: "USED", quantity: -Math.max(1, Math.round(it.used / jobs.length)), jobId: j.id, actorId: owner.id, unitCost: it.cost, createdAt: la(-40 + i * 12, 15) } });
      }
      add(`InventoryItem (${it.trade})`);
    }
  }

  // The office: blocked time, follow-up and text rules (both off), overhead, trade-board posts, equipment.
  if (await has("blockedTime")) skipped.push("blocked time");
  else {
    await tx.blockedTime.create({ data: { id: rid(), organizationId: ORG, ownerId: owner.id, reason: "Supplier meeting — Eastside Roofing Supply", startsAt: la(3, 13), endsAt: la(3, 14, 30) } });
    await tx.blockedTime.create({ data: { id: rid(), organizationId: ORG, ownerId: null, reason: "Crew training — fall protection", startsAt: la(9, 7), endsAt: la(9, 10) } });
    add("BlockedTime", 2);
  }
  if (await has("followUpRule")) skipped.push("follow-up rules");
  else {
    const rules: [string, string, number, string][] = [["Nudge after 3 days without an answer", "SENT", 4320, "EMAIL"], ["Check in after the client opens it", "VIEWED", 2880, "TEXT"], ["Thank-you after the final payment", "PAID", 1440, "EMAIL"]];
    for (const [name, triggerStatus, delayMinutes, template] of rules) await tx.followUpRule.create({ data: { id: rid(), organizationId: ORG, name, triggerStatus, delayMinutes, template, enabled: false } });
    add("FollowUpRule (off)", rules.length);
  }
  if (await has("textRule")) skipped.push("text rules");
  else {
    const rules: [string, string, number | null, string][] = [["Day-before visit reminder", "appointment.before", 24, "Hi {first}, a reminder from {company}: we'll see you tomorrow at {time}."], ["Crew on site", "job.started", null, "Hi {first}, the {company} crew is on site and getting started."], ["Thanks after the job", "job.after", 2, "Thanks for choosing {company}, {first}! How did we do?"]];
    for (const [name, trigger, offset, body] of rules) await tx.textRule.create({ data: { id: rid(), organizationId: ORG, name, trigger, offset, toClient: true, body, active: false, createdById: owner.id } });
    add("TextRule (off)", rules.length);
  }
  if (await has("monthlyOverhead")) skipped.push("overhead");
  else {
    for (let back = 3; back >= 0; back--) {
      const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
      if (await tx.monthlyOverhead.findUnique({ where: { organizationId_year_month: { organizationId: ORG, year: d.getFullYear(), month: d.getMonth() + 1 } } })) continue; // the owner's own sheet wins
      await tx.monthlyOverhead.create({ data: { id: rid(), organizationId: ORG, year: d.getFullYear(), month: d.getMonth() + 1, rent: 1850, office: 220, insurance: 960, vehicles: 1380, software: 390, warehouse: 0, utilities: 185 + back * 10, other: 120, marketing: 3, marketingPct: true } });
      add("MonthlyOverhead");
    }
  }
  if (await has("tradePost")) skipped.push("trade board");
  else {
    const posts: [string, string, string, string, number][] = [
      ["Selling: 28' extension ladder + 2 sets of roof jacks", "Upgraded the truck racks — the ladder is a year old, the jacks barely used. Pick up in Bellevue.", "equipment", "OPEN", 2],
      ["Need a licensed electrician sub for heat-pump disconnects", "Two installs a month on the Eastside. Looking for someone who can pull the electrical permit.", "subcontractor", "OPEN", 5],
      ["Synthetic underlayment in Western WA winters — what holds up?", "Thinking of switching brands. What has held up best through long rainy stretches?", "question", "CLOSED", 19],
    ];
    for (const [title, body, category, status, ago] of posts) await tx.tradePost.create({ data: { id: rid(), organizationId: ORG, authorId: owner.id, title, body, category, status, createdAt: la(-ago, 9), updatedAt: la(-ago, 9) } });
    add("TradePost", posts.length);
  }
  if (await has("clientEquipment")) skipped.push("client equipment");
  else {
    const eq: [number, string, string, string, string, number | null, number, string][] = [
      [12, "split-heat-pump", "Heat pump", "Carrier", "Infinity 24VNA6", 3, 2026, "estimator"],
      [26, "furnace-only", "Gas furnace", "Lennox", "ML180UH", null, 2009, "typed"],
      [19, "split-ac-furnace", "Furnace + AC", "Goodman", "GMVC96 / GSX14", 2.5, 2011, "typed"],
    ];
    for (const [ci, kind, label, brand, model, tons, year, source] of eq) {
      const cid = clientId(ci);
      if (!cid) continue;
      const ours = year === now.getFullYear();
      await tx.clientEquipment.create({ data: { id: rid(), organizationId: ORG, clientId: cid, kind, label, brand, model, tons, fuel: kind === "split-heat-pump" ? "electric" : "gas", yearMade: year, installedAt: ours ? la(-12, 15) : null, warrantyPartsUntil: ours ? la(3650) : null, warrantyLaborUntil: ours ? la(365) : null, filterSize: "16x25x1", location: "Garage", source } });
      add("ClientEquipment");
    }
  }

  // The skylight proposal's first wording ("deck-mount") made the proposal list file it under Deck.
  const sky = await tx.proposal.findFirst({ where: { organizationId: ORG, id: { startsWith: DEMO }, scopeOfWork: { contains: "deck-mount" } }, select: { id: true, updatedAt: true } });
  if (sky) {
    const scope = "Replace two leaking curb skylights with new Velux units and flashing kits.";
    await tx.proposal.update({ where: { id: sky.id }, data: { scopeOfWork: scope, description: scope, updatedAt: sky.updatedAt } });
    await tx.lineItem.updateMany({ where: { proposalId: sky.id, name: "Velux deck-mount skylight 2×4" }, data: { name: "Velux skylight 2×4 with flashed curb" } });
    console.log("  skylight proposal reworded (no longer read as a deck)");
  }

  // Jobs read as touched on their own dates, not the seed's: a finished one on its finish date
  // (Reports counts completed jobs by updatedAt), the rest when they were booked.
  const all = await tx.job.findMany({ where: { organizationId: ORG, id: { startsWith: DEMO } }, select: { id: true, status: true, endsAt: true, createdAt: true, updatedAt: true } });
  let fixed = 0;
  for (const j of all) {
    const want: Date = j.status === "COMPLETED" && j.endsAt ? j.endsAt : j.createdAt;
    if (Math.abs(j.updatedAt.getTime() - want.getTime()) <= 60_000) continue;
    await tx.job.update({ where: { id: j.id }, data: { updatedAt: want } });
    fixed++;
  }

  console.log(`\nextras${skipped.length ? ` (already in, skipped: ${skipped.join(", ")})` : ""}:`);
  for (const [k, n] of Object.entries(created)) console.log(`  ${k.padEnd(44)} ${n}`);
  if (fixed) console.log(`  ${"Job.updatedAt set to its own date".padEnd(44)} ${fixed}`);
}

// ── remove ─────────────────────────────────────────────────────────────────

async function removeBook(tx: any, ORG: string) {
  const mine = { organizationId: ORG, id: { startsWith: DEMO } };
  const del: Record<string, number> = {};
  const go = async (k: string, p: Promise<{ count: number }>) => { const r = await p; if (r.count) del[k] = r.count; };
  await go("ActivityEvent", tx.activityEvent.deleteMany({ where: mine }));
  await go("TradePost", tx.tradePost.deleteMany({ where: mine })); // replies cascade
  await go("AiPhoneCall", tx.aiPhoneCall.deleteMany({ where: mine }));
  await go("SyncState callout:demo_*", tx.syncState.deleteMany({ where: { key: { startsWith: `callout:${DEMO}` } } }));
  await go("InventoryItem", tx.inventoryItem.deleteMany({ where: mine })); // movements cascade
  await go("Supplier", tx.supplier.deleteMany({ where: mine }));
  await go("BlockedTime", tx.blockedTime.deleteMany({ where: mine }));
  await go("FollowUpRule", tx.followUpRule.deleteMany({ where: mine }));
  await go("TextRule", tx.textRule.deleteMany({ where: mine }));
  await go("MonthlyOverhead", tx.monthlyOverhead.deleteMany({ where: mine }));
  await go("ClientEquipment", tx.clientEquipment.deleteMany({ where: mine }));
  await go("JobExpense", tx.jobExpense.deleteMany({ where: mine }));
  await go("ChangeOrder", tx.changeOrder.deleteMany({ where: mine }));
  await go("Project", tx.project.deleteMany({ where: mine })); // budget lines, expenses cascade
  await go("ReviewRequest", tx.reviewRequest.deleteMany({ where: mine }));
  await go("Conversation", tx.conversation.deleteMany({ where: mine })); // messages + participants cascade
  await go("Payment", tx.payment.deleteMany({ where: mine }));
  await go("Invoice", tx.invoice.deleteMany({ where: mine }));
  await go("Appointment", tx.appointment.deleteMany({ where: mine })); // assignments cascade
  await go("JobEvent", tx.jobEvent.deleteMany({ where: mine })); // SetNull on the job: delete first
  await go("Job", tx.job.deleteMany({ where: mine })); // assignments, work days cascade
  await go("Proposal", tx.proposal.deleteMany({ where: mine })); // lines, installments, snapshots cascade
  await go("AiEstimate", tx.aiEstimate.deleteMany({ where: mine }));
  await go("RoofMeasurement", tx.roofMeasurement.deleteMany({ where: mine }));
  await go("Client", tx.client.deleteMany({ where: mine })); // client tags cascade
  await go("Tag", tx.tag.deleteMany({ where: mine }));
  await go("WorkerProfile", tx.workerProfile.deleteMany({ where: mine }));
  await go("Membership", tx.membership.deleteMany({ where: mine }));
  await go("User", tx.user.deleteMany({ where: { id: { startsWith: DEMO }, email: { endsWith: "@example.com" }, memberships: { none: {} } } }));
  // The company profile as it was before the seed.
  const snap = await tx.syncState.findUnique({ where: { key: SNAPSHOT_KEY(ORG) } });
  const record = snap ? JSON.parse(snap.cursor) : {};
  if (record.seed?.profileBefore && Object.keys(record.seed.profileBefore).length) {
    await tx.organization.update({ where: { id: ORG }, data: record.seed.profileBefore });
    console.log("company profile restored:", record.seed.profileBefore);
  }
  if (record.seed?.orgNameUnset) await tx.syncState.upsert({ where: { key: `orgNameUnset:${ORG}` }, create: { key: `orgNameUnset:${ORG}`, cursor: "1" }, update: {} });
  if (record.seed) {
    delete record.seed;
    await tx.syncState.update({ where: { key: SNAPSHOT_KEY(ORG) }, data: { cursor: JSON.stringify(record) } });
  }
  console.log("removed:", del);
  if (record.prepare) console.log("NOT undone: --prepare (plan, statsHidden, switches). Its before-state is in SyncState", SNAPSHOT_KEY(ORG));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
