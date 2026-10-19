// THE SEASON, DATE BY DATE (2026-10-18). The services a client picked, laid out over a year from the plan's start the
// way the grass wants them where they live: mowing weekly in the growing months and every other week at the season's
// ends (cool-season lawns) or through the slow months (warm-season); the weed preventer as the soil warms, feeding
// spread through the season and the heaviest in fall for cool-season grass, after green-up for warm; core aeration and
// overseeding in early fall (cool, transition) or late spring (warm); cleanups at the season's two ends; the
// sprinklers blown out before the freeze. Fertilizer is kept out of the state's blackouts (a round in one moves to the
// nearest open date), and under a county's summer nitrogen ban becomes an iron-and-micronutrient round. Each visit
// carries the crew's checklist — the mowing height for the grass, the lawn signs the state requires. Pure.
import type { LawnQuote, PricedService, ServiceId } from "./pricing";
import { monthsOf, weeklyMonths, type StateClimate } from "./season";
import { inWindow, type RulesAt } from "./rules";

export type PlanVisit = {
  /** YYYY-MM-DD. */
  date: string;
  service: ServiceId;
  label: string;
  /** Crew minutes on site. */
  minutes: number;
  price: number;
  checklist: string[];
};

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

/** The mowing height the grass wants, inches (cool-season lawns a half inch higher in July and August). */
export function mowHeightIn(c: StateClimate, month: number): number {
  const g = c.grasses.toLowerCase();
  const base = g.startsWith("bermuda") ? 1.5 : g.startsWith("st. augustine") ? 3.5 : g.startsWith("perennial rye") ? 2.5 : g.startsWith("kentucky") ? 3 : g.startsWith("tall fescue") ? 3.5 : 3;
  return c.zone !== "warm" && (month === 7 || month === 8) ? base + 0.5 : base;
}

/** The first date on or after `from` that is a given month and day, inside [from, until). */
function next(from: Date, until: Date, month: number, day: number): Date | null {
  for (const y of [from.getUTCFullYear(), from.getUTCFullYear() + 1]) {
    const d = at(y, month, day);
    if (d >= from && d < until) return d;
  }
  return null;
}

/** Fertilizer dates: the first as the soil warms, the rest spread through the growing season. */
function fertDates(c: StateClimate, rounds: number): Array<[number, number]> {
  const months = monthsOf(c);
  if (!rounds || !months.length) return [];
  // Cool-season: pre-emergent two weeks into the season, the last (the heaviest) in the last full month — fall feeding.
  // Warm-season: from the month before fast growth (green-up) to the month after it, the last well before dormancy.
  const warm = c.zone === "warm" && c.peak.length > 0;
  const firstMonth = warm ? Math.max(months[0], c.peak[0] - 1) : months[0];
  const lastMonth = warm ? Math.min(months[months.length - 1], c.peak[c.peak.length - 1] + 1) : months[months.length - 1];
  const startDoy = firstMonth * 30.4 - 30.4 + (warm ? 10 : 14);
  const endDoy = lastMonth * 30.4 - 20;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < rounds; i++) {
    const doy = rounds === 1 ? startDoy : startDoy + ((endDoy - startDoy) * i) / (rounds - 1);
    const m = Math.min(12, Math.max(1, Math.floor(doy / 30.4) + 1));
    const d = Math.min(28, Math.max(1, Math.round(doy - (m - 1) * 30.4)));
    out.push([m, d]);
  }
  return out;
}

export function seasonCalendar(input: { start: Date; quote: LawnQuote; picked: Iterable<ServiceId>; fertRounds: number; frequency: "weekly" | "biweekly"; rules: RulesAt; crewSize: number }): PlanVisit[] {
  const { quote, rules } = input;
  const c = quote.climate;
  const picked = new Set(input.picked);
  const start = new Date(Date.UTC(input.start.getUTCFullYear(), input.start.getUTCMonth(), input.start.getUTCDate()));
  const until = new Date(start.getTime() + 365 * DAY);
  const svc = (id: ServiceId): PricedService | undefined => (picked.has(id) ? quote.services.find((x) => x.id === id) : undefined);
  const mins = (s: PricedService) => Math.max(10, Math.round((s.hours * 60) / Math.max(1, input.crewSize)));
  const signs = rules.rules.find((r) => r.kind === "pesticide" && /signs/i.test(r.title));
  const out: PlanVisit[] = [];
  const add = (d: Date | null, s: PricedService | undefined, label: string, checklist: string[]) => {
    if (!d || !s) return;
    // Mulch is priced by the yard: the visit carries the whole job.
    out.push({ date: iso(d), service: s.id, label, minutes: mins(s), price: s.unit === "cu yd" ? Math.round(s.unitPrice * s.qty) : s.unitPrice, checklist });
  };

  // Mowing: from the start, week by week; weekly months every week, the rest every other week.
  const mow = svc("mow");
  if (mow) {
    const season = new Set(monthsOf(c));
    const weekly = new Set(input.frequency === "weekly" ? weeklyMonths(c) : []);
    let skip = false;
    for (let t = start.getTime() + 2 * DAY; t < until.getTime(); t += 7 * DAY) {
      const d = new Date(t);
      const m = d.getUTCMonth() + 1;
      if (!season.has(m)) {
        skip = false;
        continue;
      }
      if (!weekly.has(m)) {
        skip = !skip;
        if (skip) continue;
      } else skip = false;
      const h = mowHeightIn(c, m);
      add(d, mow, "Mow, trim, edge, blow", [`Mow at ${h} in — never more than a third of the blade`, "String-trim the house, trees and fence lines", "Edge the walks and drive", "Blow the hard surfaces clean"]);
    }
  }
  // Fertilizer and weed control, out of the blackouts.
  const fert = svc("fert");
  if (fert) {
    const blocking = rules.blackouts.filter((w) => w.what === "all");
    const npBan = rules.blackouts.filter((w) => w.what === "nitrogen-phosphorus");
    fertDates(c, input.fertRounds).forEach(([m, day], i) => {
      const planned = next(start, until, m, day);
      if (!planned) return;
      let d: Date = planned;
      // Out of a blackout: the nearest open day, earlier first (a fall round goes before the winter ban begins).
      const blocked = (x: Date) => blocking.some((w) => inWindow(x, w));
      for (let k = 1; k <= 60 && blocked(d); k++) {
        const back: Date = new Date(planned.getTime() - k * DAY);
        const fwd: Date = new Date(planned.getTime() + k * DAY);
        if (back >= start && !blocked(back)) d = back;
        else if (fwd < until && !blocked(fwd)) d = fwd;
      }
      if (blocked(d)) return;
      const banned = npBan.some((w) => inWindow(d, w));
      const what = banned ? "Iron and micronutrients (the county bans nitrogen and phosphorus now)" : i === 0 ? (c.zone === "warm" ? "Feeding after green-up, with pre-emergent" : "Crabgrass pre-emergent and the first feeding") : `Feeding ${i + 1}${rules.phosphorusLimited ? " (phosphorus-free)" : ""}`;
      add(d, fert, `Fertilizer & weed control — round ${i + 1}`, [what, "Broadleaf weeds spot-treated", ...(signs ? [signs.title] : []), ...(rules.herbicideBan ? ["Allowed (organic) products only — the county bans cosmetic pesticides"] : [])]);
    });
  }
  const cool = c.zone !== "warm";
  add(svc("dethatch") ? next(start, until, cool ? 9 : 5, cool ? 1 : 1) : null, svc("dethatch"), "Dethatching", ["Power-rake, haul the thatch"]);
  add(svc("aerate") ? next(start, until, cool ? 9 : 5, cool ? 10 : 20) : null, svc("aerate"), "Core aeration", ["Flag sprinkler heads first", "Two passes where compacted"]);
  // Warm-season: bermuda takes winter rye in October; St. Augustine and centipede are patched, not seeded.
  const bermuda = c.grasses.toLowerCase().startsWith("bermuda");
  if (cool) add(svc("overseed") ? next(start, until, 9, 11) : null, svc("overseed"), "Overseeding", [`Seed: ${c.grasses}`, "Keep the seedbed moist two weeks — tell the client"]);
  else if (bermuda) add(svc("overseed") ? next(start, until, 10, 15) : null, svc("overseed"), "Winter rye overseed", ["Scalp the bermuda low first", "Perennial rye seed; keep it moist ten days"]);
  else add(svc("overseed") ? next(start, until, 5, 21) : null, svc("overseed"), "Bare spots patched", ["Plugs or sod for St. Augustine and centipede; seed only where the grass takes it"]);
  const months = monthsOf(c);
  // A lawn that never stops (Florida, Hawaii) still has a spring: the month before it grows fast.
  const first = cool || !c.peak.length ? months[0] : Math.max(months[0], c.peak[0] - 1);
  const last = months[months.length - 1];
  add(svc("springCleanup") ? next(start, until, first, 5) : null, svc("springCleanup"), "Spring cleanup", ["Rake winter debris from the lawn and beds", "Tidy the beds", "Set the first cut's height"]);
  // Sprinklers are started up only where they were winterized.
  if (cool) add(svc("irrigationStart") ? next(start, until, first, 8) : null, svc("irrigationStart"), "Sprinkler start-up", ["Turn on, check and aim the heads", "Set the controller to the watering rules"]);
  add(svc("mulch") ? next(start, until, Math.min(12, first + 1), 1) : null, svc("mulch"), "Mulch the beds", ["Pull weeds, re-edge the beds", "Mulch to depth, keep it off the trunks"]);
  add(svc("shrubs") ? next(start, until, cool ? 6 : 5, 15) : null, svc("shrubs"), "Shrub trimming", ["Shape the shrubs, haul the clippings"]);
  add(svc("hedges") ? next(start, until, cool ? 6 : 5, 20) : null, svc("hedges"), "Hedge trimming", ["Shear the faces and tops, haul the clippings"]);
  const bed = svc("bedWeeding");
  if (bed) for (const m of months.slice(1, -1)) add(next(start, until, m, 18), bed, "Bed weeding & detail", ["Pull weeds, tidy the beds"]);
  add(svc("fallCleanup") ? next(start, until, cool ? last : 12, cool ? 25 : 5) : null, svc("fallCleanup"), "Fall leaf cleanup", ["Leaves blown and mulched or hauled from the lawn and beds"]);
  if (cool) add(svc("irrigationBlowout") ? next(start, until, last, 15) : null, svc("irrigationBlowout"), "Sprinkler blowout", ["Blow every zone out before the freeze", "Drain the backflow"]);
  add(svc("gutters") ? next(start, until, cool ? Math.min(12, last + 1) : 12, cool ? 10 : 12) : null, svc("gutters"), "Gutter cleaning", ["After the leaves are down", "Flush the downspouts"]);
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.service.localeCompare(b.service));
}

/** The season's price on a plan: every visit plus the on-call snow, a twelfth a month. */
export function planTotals(visits: PlanVisit[], quote: LawnQuote, picked: Iterable<ServiceId>): { season: number; monthly: number; visits: number } {
  const p = new Set(picked);
  const snow = p.has("snow") ? quote.services.find((x) => x.id === "snow") : undefined;
  const season = visits.reduce((s, v) => s + v.price, 0) + (snow ? snow.unitPrice * snow.qty : 0);
  return { season, monthly: Math.round((season / 12) * 100) / 100, visits: visits.length };
}

/** A lawn plan's visits as kept with the plan: month-day, so each new term books the same season again. */
export type StoredVisit = { md: string; service: ServiceId; label: string; minutes: number; checklist: string[] };
export type StoredSchedule = { v: 1; visits: StoredVisit[]; /** The property, for the route days. */ place?: { lat: number; lng: number; address: string | null } | null };

export const toSchedule = (visits: PlanVisit[], place?: StoredSchedule["place"]): StoredSchedule => ({ v: 1, visits: visits.map((x) => ({ md: x.date.slice(5), service: x.service, label: x.label, minutes: x.minutes, checklist: x.checklist })), ...(place ? { place } : {}) });

/** The schedule's visits dated inside a term [startsAt + 1 day, startsAt + termMonths): each month-day at its next
 *  occurrence, in the order they fall. */
export function lawnSlots(schedule: StoredSchedule, startsAt: Date, termMonths: number): Array<{ seq: number; label: string; dueAt: Date; minutes: number; checklist: string[] }> {
  const from = new Date(startsAt.getTime() + DAY);
  const until = new Date(Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth() + termMonths, startsAt.getUTCDate()));
  const out: Array<{ label: string; dueAt: Date; minutes: number; checklist: string[] }> = [];
  for (const v of schedule.visits) {
    const [m, d] = v.md.split("-").map(Number);
    if (!m || !d) continue;
    for (let y = from.getUTCFullYear(); y <= until.getUTCFullYear(); y++) {
      const at0 = at(y, m, Math.min(d, 28 + (m === 2 ? 0 : 3)));
      if (at0 >= from && at0 < until) out.push({ label: v.label, dueAt: at0, minutes: v.minutes, checklist: v.checklist });
    }
  }
  return out.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime()).map((x, i) => ({ seq: i + 1, ...x }));
}
