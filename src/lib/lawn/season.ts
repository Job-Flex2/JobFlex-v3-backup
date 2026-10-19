// THE GROWING SEASON BY STATE (2026-10-18, first cut). When the grass grows where the client lives, what kind of grass
// it is, and so how many times a year it's mowed: weekly through the months it grows fast, every other week in the
// shoulders, nothing while it's dormant. From the LawnStarter 2025 season lengths (FL/TX/LA ≈ 11 months; MN/VT/NH/MT/WY
// ≈ 6; Northeast ≈ 24 weeks, Midwest ≈ 26, Southeast ≈ 45, Southwest ≈ 46, West ≈ 34) and the turfgrass zones of the
// extension services (cool-season north, warm-season south, the transition zone between). The contractor can change
// the grass and the months for a property. Pure.

export type GrassZone = "cool" | "warm" | "transition";
export type StateClimate = {
  zone: GrassZone;
  /** Months 1–12, first and last month mowed. */
  start: number;
  end: number;
  /** Warm-season grass: the months it grows fast (mowed weekly on a weekly plan; slower months every other week).
   *  Cool-season and transition lawns grow all season: weekly but for the first and last month. */
  peak: number[];
  /** Typical grasses there. */
  grasses: string;
};

const COOL = "Kentucky bluegrass, tall fescue, perennial rye";
const TALL = "tall fescue, with bermuda or zoysia in the sun";
const WARM = "bermuda, zoysia, St. Augustine, centipede";

export const STATE_CLIMATE: Record<string, StateClimate> = {
  AL: { zone: "warm", start: 3, end: 11, peak: [5, 6, 7, 8, 9], grasses: WARM },
  AK: { zone: "cool", start: 5, end: 9, peak: [6, 7, 8], grasses: COOL },
  AZ: { zone: "warm", start: 2, end: 11, peak: [4, 5, 6, 7, 8, 9, 10], grasses: "bermuda (often overseeded with rye in winter)" },
  AR: { zone: "transition", start: 3, end: 11, peak: [5, 6, 7, 8, 9], grasses: TALL },
  CA: { zone: "warm", start: 2, end: 11, peak: [4, 5, 6, 7, 8, 9], grasses: "tall fescue on the coast, bermuda and St. Augustine inland and south" },
  CO: { zone: "cool", start: 4, end: 10, peak: [5, 6, 9], grasses: COOL },
  CT: { zone: "cool", start: 4, end: 11, peak: [5, 6, 9], grasses: COOL },
  DE: { zone: "transition", start: 4, end: 11, peak: [5, 6, 9, 10], grasses: TALL },
  DC: { zone: "transition", start: 4, end: 11, peak: [5, 6, 9, 10], grasses: TALL },
  FL: { zone: "warm", start: 1, end: 12, peak: [4, 5, 6, 7, 8, 9, 10], grasses: "St. Augustine, bahia, zoysia" },
  GA: { zone: "warm", start: 3, end: 11, peak: [5, 6, 7, 8, 9], grasses: WARM },
  HI: { zone: "warm", start: 1, end: 12, peak: [4, 5, 6, 7, 8, 9, 10], grasses: "bermuda, zoysia, St. Augustine" },
  ID: { zone: "cool", start: 4, end: 10, peak: [5, 6, 9], grasses: COOL },
  IL: { zone: "cool", start: 4, end: 10, peak: [5, 6, 9], grasses: COOL },
  IN: { zone: "cool", start: 4, end: 10, peak: [5, 6, 9], grasses: COOL },
  IA: { zone: "cool", start: 4, end: 10, peak: [5, 6, 9], grasses: COOL },
  KS: { zone: "transition", start: 4, end: 10, peak: [5, 6, 9], grasses: TALL },
  KY: { zone: "transition", start: 4, end: 11, peak: [5, 6, 9, 10], grasses: TALL },
  LA: { zone: "warm", start: 3, end: 12, peak: [4, 5, 6, 7, 8, 9, 10], grasses: "St. Augustine, centipede, bermuda" },
  ME: { zone: "cool", start: 5, end: 10, peak: [6, 9], grasses: COOL },
  MD: { zone: "transition", start: 4, end: 11, peak: [5, 6, 9, 10], grasses: TALL },
  MA: { zone: "cool", start: 4, end: 11, peak: [5, 6, 9], grasses: COOL },
  MI: { zone: "cool", start: 4, end: 10, peak: [5, 6, 9], grasses: COOL },
  MN: { zone: "cool", start: 5, end: 10, peak: [5, 6, 9], grasses: COOL },
  MS: { zone: "warm", start: 3, end: 11, peak: [5, 6, 7, 8, 9], grasses: WARM },
  MO: { zone: "transition", start: 4, end: 11, peak: [5, 6, 9, 10], grasses: TALL },
  MT: { zone: "cool", start: 5, end: 10, peak: [6, 9], grasses: COOL },
  NE: { zone: "cool", start: 4, end: 10, peak: [5, 6, 9], grasses: COOL },
  NV: { zone: "warm", start: 3, end: 11, peak: [4, 5, 6, 9, 10], grasses: "bermuda and tall fescue (south); bluegrass (north)" },
  NH: { zone: "cool", start: 5, end: 10, peak: [6, 9], grasses: COOL },
  NJ: { zone: "cool", start: 4, end: 11, peak: [5, 6, 9, 10], grasses: COOL },
  NM: { zone: "transition", start: 4, end: 10, peak: [5, 6, 7, 8, 9], grasses: "bermuda and buffalograss low; bluegrass and fescue high" },
  NY: { zone: "cool", start: 4, end: 11, peak: [5, 6, 9], grasses: COOL },
  NC: { zone: "transition", start: 3, end: 11, peak: [5, 6, 9, 10], grasses: TALL },
  ND: { zone: "cool", start: 5, end: 9, peak: [6, 9], grasses: COOL },
  OH: { zone: "cool", start: 4, end: 10, peak: [5, 6, 9], grasses: COOL },
  OK: { zone: "transition", start: 3, end: 11, peak: [5, 6, 7, 8, 9], grasses: "bermuda, with tall fescue in the shade" },
  OR: { zone: "cool", start: 3, end: 11, peak: [4, 5, 6, 10], grasses: "perennial rye and fine fescue" },
  PA: { zone: "cool", start: 4, end: 11, peak: [5, 6, 9], grasses: COOL },
  RI: { zone: "cool", start: 4, end: 11, peak: [5, 6, 9], grasses: COOL },
  SC: { zone: "warm", start: 3, end: 11, peak: [5, 6, 7, 8, 9], grasses: WARM },
  SD: { zone: "cool", start: 5, end: 10, peak: [6, 9], grasses: COOL },
  TN: { zone: "transition", start: 3, end: 11, peak: [5, 6, 9, 10], grasses: TALL },
  TX: { zone: "warm", start: 3, end: 11, peak: [4, 5, 6, 7, 8, 9, 10], grasses: "St. Augustine, bermuda, zoysia" },
  UT: { zone: "cool", start: 4, end: 10, peak: [5, 6, 9], grasses: COOL },
  VT: { zone: "cool", start: 5, end: 10, peak: [6, 9], grasses: COOL },
  VA: { zone: "transition", start: 4, end: 11, peak: [5, 6, 9, 10], grasses: TALL },
  WA: { zone: "cool", start: 3, end: 10, peak: [4, 5, 6, 9], grasses: "perennial rye, fine fescue, bluegrass" },
  WV: { zone: "transition", start: 4, end: 10, peak: [5, 6, 9], grasses: TALL },
  WI: { zone: "cool", start: 5, end: 10, peak: [5, 6, 9], grasses: COOL },
  WY: { zone: "cool", start: 5, end: 9, peak: [6, 9], grasses: COOL },
};

export const DEFAULT_CLIMATE: StateClimate = { zone: "transition", start: 4, end: 10, peak: [5, 6, 9], grasses: TALL };

export const climateFor = (state: string | null | undefined): StateClimate => (state && STATE_CLIMATE[state.toUpperCase()]) || DEFAULT_CLIMATE;

const WEEKS_IN = [4.43, 4.0, 4.43, 4.29, 4.43, 4.29, 4.43, 4.43, 4.29, 4.43, 4.29, 4.43];

export function monthsOf(c: Pick<StateClimate, "start" | "end">): number[] {
  const out: number[] = [];
  for (let m = c.start; ; m = (m % 12) + 1) {
    out.push(m);
    if (m === c.end || out.length >= 12) break;
  }
  return out;
}

/** The months a weekly plan mows every week (the rest of the season every other week). */
export function weeklyMonths(c: StateClimate): number[] {
  const all = monthsOf(c);
  if (c.zone === "warm") return all.filter((m) => c.peak.includes(m));
  return all.slice(1, -1);
}

/** Mowing visits a year: a weekly plan mows weekly through its weekly months and every other week in the shoulders;
 *  a biweekly plan every other week all season. */
export function mowVisits(c: StateClimate, frequency: "weekly" | "biweekly"): number {
  const weekly = new Set(weeklyMonths(c));
  let v = 0;
  for (const m of monthsOf(c)) v += WEEKS_IN[m - 1] * (frequency === "weekly" && weekly.has(m) ? 1 : 0.5);
  return Math.round(v);
}
