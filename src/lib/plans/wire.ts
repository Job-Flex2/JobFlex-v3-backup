// What the browser sends the blueprint actions, checked on arrival. Pure (zod).
import { z } from "zod";
import { PLAN_TRADES, type TakeoffItem } from "./takeoff";
import { SHEET_KINDS } from "./sheet";

export const takeoffItemSchema = z.object({
  id: z.string().min(1).max(120),
  trade: z.enum(PLAN_TRADES),
  label: z.string().min(1).max(240),
  qty: z.number().finite().positive().max(10_000_000),
  unit: z.enum(["sq ft", "linear ft", "each", "cu yards", "squares", "sheets", "tons", "boxes", "bundles", "rolls", "gallons", "bags", "pieces", "sq yd", "sets", "buckets", "tubes", "lot"]),
  source: z.enum(["plan", "derived", "rule", "entered"]),
  basis: z.string().max(600),
  pages: z.array(z.number().int().min(0).max(5000)).max(200),
  role: z.enum(["labor", "material", "both"]).optional(),
  phase: z.string().max(60).optional(),
  measured: z.boolean().optional(),
}) satisfies z.ZodType<TakeoffItem>;

const area = z.number().finite().min(0).max(200_000);

export const houseBriefSchema = z.object({
  name: z.string().max(200).nullable(),
  address: z.string().max(300).nullable(),
  levels: z.array(z.object({ name: z.string().min(1).max(40), areaSqFt: area, plateFt: z.number().finite().min(0).max(40) })).min(1).max(6),
  livingSqFt: area,
  garageSqFt: area,
  porchSqFt: area,
  footprintSqFt: area,
  roof: z.object({
    rise: z.number().finite().min(0).max(24),
    style: z.string().max(40).nullable(),
    material: z.string().max(120).nullable(),
    overhangIn: z.number().finite().min(0).max(60),
  }),
  foundation: z.enum(["slab", "crawlspace", "basement", "piers"]),
  siding: z.string().max(120).nullable(),
});

/** One sheet's picture(s): the whole sheet first, then its close-up tiles. */
const IMAGE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
/** Vercel takes ~4.5 MB a request; the browser keeps a sheet under this. */
export const MAX_SHEET_IMAGE_CHARS = 4_200_000;

export const sheetReadInput = z.object({
  token: z.string().min(1).max(1024),
  page: z.number().int().min(1).max(500),
  pages: z.number().int().min(1).max(500),
  fileName: z.string().max(200).nullish(),
  textLayer: z.string().max(16_000),
  // Each picture inside its own object: React's server-action decoder refuses an array
  // whose strings add up past a million characters ("Maximum array nesting exceeded"),
  // and one sheet's close-ups run to two or three million.
  images: z.array(z.object({ url: z.string().max(MAX_SHEET_IMAGE_CHARS).regex(IMAGE) })).min(1).max(17),
  /** The close-ups' grid [across, down] when every tile was sent. */
  grid: z.tuple([z.number().int().min(1).max(6), z.number().int().min(1).max(6)]).nullish(),
});

/** The job asked of the plans (lib/plans/ask), when a trade is priced for one job. */
const jobAsk = z.object({
  request: z.string().trim().min(1).max(600),
  title: z.string().trim().min(1).max(80),
  /** Part of the trade, not all of it — no whole-trade benchmark. */
  partial: z.boolean(),
  /** What the plans' notes and schedules specify for the job, with their sheets. */
  specs: z.array(z.string().max(220)).max(14).nullish(),
  /** An estimator specialty id (checked against the catalog on the server). */
  specialtyId: z.string().regex(/^[a-z0-9-]{2,60}$/).nullish(),
  /** What the group's lines are headed with ("Fencing"). */
  label: z.string().max(80).nullish(),
});

export const tradePriceInput = z.object({
  token: z.string().min(1).max(1024),
  trade: z.enum(PLAN_TRADES),
  location: z.string().max(300).nullish(),
  house: houseBriefSchema,
  items: z.array(takeoffItemSchema).min(1).max(160),
  alsoPriced: z.array(z.enum(PLAN_TRADES)).max(PLAN_TRADES.length),
  ask: jobAsk.nullish(),
});

/** A sheet as the job planner sees it: what it is and the rooms it names. */
const sheetLite = z.object({
  page: z.number().int().min(1).max(500),
  kind: z.enum(SHEET_KINDS),
  title: z.string().max(200).nullable(),
  level: z.string().max(40).nullable(),
  rooms: z.array(z.object({ name: z.string().max(80) })).max(80),
  /** What the first look found on the sheet (lib/plans/readOrder). */
  contents: z.array(z.string().max(120)).max(16).optional(),
});

/** A first look at a sheet: the sheet small and its title block (lib/plans/readOrder). */
export const skimSheetInput = z.object({
  token: z.string().min(1).max(1024),
  page: z.number().int().min(1).max(500),
  pages: z.number().int().min(1).max(500),
  images: z.array(z.object({ url: z.string().max(1_500_000).regex(IMAGE) })).min(1).max(5),
});

export const askPlanInput = z.object({
  token: z.string().min(1).max(1024),
  request: z.string().trim().min(2).max(600),
  house: houseBriefSchema,
  sheets: z.array(sheetLite).min(1).max(120),
  items: z.array(takeoffItemSchema).min(1).max(800),
});

export const measureSheetInput = z.object({
  token: z.string().min(1).max(1024),
  page: z.number().int().min(1).max(500),
  pages: z.number().int().min(1).max(500),
  request: z.string().trim().min(2).max(600),
  title: z.string().trim().min(1).max(80),
  sheetTitle: z.string().max(200).nullish(),
  // None on a sheet looked at only for what its notes specify.
  asks: z
    .array(z.object({ n: z.number().int().min(1).max(12), label: z.string().min(1).max(120), unit: z.string().min(1).max(20), how: z.string().max(300) }))
    .max(12),
  textLayer: z.string().max(16_000),
  images: z.array(z.object({ url: z.string().max(MAX_SHEET_IMAGE_CHARS).regex(IMAGE) })).min(1).max(17),
  grid: z.tuple([z.number().int().min(1).max(6), z.number().int().min(1).max(6)]).nullish(),
});

export const priceChecksInput = z.object({
  location: z.string().max(300).nullish(),
  house: houseBriefSchema,
  items: z.array(takeoffItemSchema).max(800),
});

// The heating & cooling load from the plans (2026-10-18, lib/plans/hvacLoad): the envelope the browser took out of
// the merged house (lib/plans/hvacEnvelope) and the job's place.
const rOrNull = z.number().finite().min(0).max(100).nullable();
const opening = z.object({ widthIn: z.number().finite().min(1).max(400).nullable(), heightIn: z.number().finite().min(1).max(400).nullable(), count: z.number().finite().min(0).max(200), type: z.string().max(160).nullable() });
const compass = z.enum(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
const pageList = z.array(z.number().int().min(1).max(500)).max(80);
export const planEnvelopeSchema = z.object({
  address: z.string().max(200).nullable(),
  livingSqFt: area,
  levels: z.array(z.object({ name: z.string().max(40), areaSqFt: area, perimeterLf: z.number().finite().min(0).max(5000), plateFt: z.number().finite().min(0).max(40), pages: pageList })).max(8),
  foundation: z.enum(["slab", "crawlspace", "basement", "piers"]),
  windows: z.array(opening).max(120),
  doors: z.array(opening).max(80),
  facades: z.array(z.object({ facing: z.enum(["N", "NE", "E", "SE", "S", "SW", "W", "NW", "front", "rear", "left", "right"]), glassSqFt: z.number().finite().min(0).max(3000).nullable(), windows: z.number().finite().min(0).max(80).nullable() })).max(16),
  frontFaces: compass.nullable(),
  energy: z
    .object({
      wallR: rOrNull,
      ceilingR: rOrNull,
      floorR: rOrNull,
      slabR: rOrNull,
      basementWallR: rOrNull,
      windowU: z.number().finite().min(0.05).max(1.5).nullable(),
      windowShgc: z.number().finite().min(0.05).max(1).nullable(),
      ach50: z.number().finite().min(0.3).max(30).nullable(),
      ductLocation: z.enum(["conditioned", "attic", "crawl", "basement"]).nullable(),
      ductLeakage: z.number().finite().min(0).max(30).nullable(),
    })
    .nullable(),
  roof: z.object({ material: z.string().max(160).nullable(), overhangIn: z.number().finite().min(0).max(96) }),
  siding: z.string().max(160).nullable(),
  exteriorFraming: z.string().max(160).nullable(),
  bedrooms: z.number().int().min(0).max(30),
  notes: z.array(z.string().max(240)).max(20),
  heatPump: z.boolean(),
  stated: z.object({ tons: z.number().finite().min(0).max(40).nullable(), heatLoadBtu: z.number().finite().min(0).max(1_000_000).nullable(), system: z.string().max(160).nullable(), systems: z.number().finite().min(0).max(10).nullable() }),
  pages: z.object({ windows: pageList, energy: pageList, facades: pageList, site: pageList }),
});
export const planHvacInput = z.object({
  token: z.string().min(1).max(1024),
  location: z.string().max(300).nullish(),
  envelope: planEnvelopeSchema,
});
