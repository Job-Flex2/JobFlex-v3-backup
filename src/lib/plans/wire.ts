// What the browser sends the blueprint actions, checked on arrival. Pure (zod).
import { z } from "zod";
import { PLAN_TRADES, type TakeoffItem } from "./takeoff";

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

export const tradePriceInput = z.object({
  token: z.string().min(1).max(1024),
  trade: z.enum(PLAN_TRADES),
  location: z.string().max(300).nullish(),
  house: houseBriefSchema,
  items: z.array(takeoffItemSchema).min(1).max(160),
  alsoPriced: z.array(z.enum(PLAN_TRADES)).max(PLAN_TRADES.length),
});

export const priceChecksInput = z.object({
  location: z.string().max(300).nullish(),
  house: houseBriefSchema,
  items: z.array(takeoffItemSchema).max(800),
});
