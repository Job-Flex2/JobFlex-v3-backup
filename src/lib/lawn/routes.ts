// ROUTE DAYS (2026-10-18). A mowing company lives on its routes: the same yards on the same weekday, in an order that
// doesn't zig-zag across town. Here: the order of a day's stops (nearest first from the shop, then untangled with
// 2-opt), the drive between them (straight-line distance × 1.35 for the roads, at 25 mph in town), and the weekly
// mowing days — yards grouped by where they are into as many routes as the crew works days, each route about the same
// crew time, the routes handed out west to east. Pure.
import type { LatLng } from "./geo";

export type Stop = { id: string; at: LatLng; minutes: number };

const R_MI = 3958.8;
export function milesBetween(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(s)));
}
/** Minutes of driving: roads run about a third longer than the crow flies, 25 mph in town, 2 minutes to park. */
export const driveMinutes = (a: LatLng, b: LatLng) => Math.round((milesBetween(a, b) * 1.35 * 60) / 25 + 2);

function routeMinutes(start: LatLng | null, order: Stop[]): number {
  let m = 0;
  let at = start;
  for (const s of order) {
    if (at) m += driveMinutes(at, s.at);
    at = s.at;
  }
  return m;
}

/** A day's stops in driving order from the shop (or from the westmost stop with no shop). */
export function orderStops<T extends Stop>(start: LatLng | null, stops: T[]): { order: T[]; driveMinutes: number } {
  if (stops.length <= 1) return { order: [...stops], driveMinutes: start && stops[0] ? driveMinutes(start, stops[0].at) : 0 };
  const left = [...stops];
  const order: T[] = [];
  let at: LatLng = start ?? left.reduce((w, s) => (s.at.lng < w.lng ? s.at : w), left[0].at);
  while (left.length) {
    let k = 0;
    for (let i = 1; i < left.length; i++) if (milesBetween(at, left[i].at) < milesBetween(at, left[k].at)) k = i;
    const [s] = left.splice(k, 1);
    order.push(s);
    at = s.at;
  }
  // 2-opt: undo any crossing.
  for (let improved = true, guard = 0; improved && guard < 50; guard++) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++)
      for (let j = i + 1; j < order.length; j++) {
        const next = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        if (routeMinutes(start, next) + 0.01 < routeMinutes(start, order)) {
          order.splice(0, order.length, ...next);
          improved = true;
        }
      }
  }
  return { order, driveMinutes: routeMinutes(start, order) };
}

/** Yards into `days` routes by where they are, each about the same crew time: k-means on the map, then yards moved
 *  from the heaviest route to its nearest lighter one until the days are within a fifth of each other. Day 0 is the
 *  westmost route. */
export function balanceDays<T extends Stop>(stops: T[], days: number): Map<string, number> {
  const out = new Map<string, number>();
  const k = Math.max(1, Math.min(days, stops.length));
  if (!stops.length) return out;
  const sorted = [...stops].sort((a, b) => a.at.lng - b.at.lng);
  // Seeds spread west to east.
  let centres = Array.from({ length: k }, (_, i) => ({ ...sorted[Math.floor(((i + 0.5) / k) * sorted.length)].at }));
  let assign = new Map<string, number>();
  for (let it = 0; it < 25; it++) {
    const next = new Map<string, number>();
    for (const s of stops) {
      let best = 0;
      for (let c = 1; c < k; c++) if (milesBetween(s.at, centres[c]) < milesBetween(s.at, centres[best])) best = c;
      next.set(s.id, best);
    }
    const moved = stops.some((s) => next.get(s.id) !== assign.get(s.id));
    assign = next;
    centres = centres.map((c, i) => {
      const mine = stops.filter((s) => assign.get(s.id) === i);
      return mine.length ? { lat: mine.reduce((a, s) => a + s.at.lat, 0) / mine.length, lng: mine.reduce((a, s) => a + s.at.lng, 0) / mine.length } : c;
    });
    if (!moved) break;
  }
  // Even the load: the heaviest route gives its yard nearest another, lighter route.
  const load = () => Array.from({ length: k }, (_, i) => stops.filter((s) => assign.get(s.id) === i).reduce((a, s) => a + s.minutes, 0));
  for (let guard = 0; guard < stops.length * 4; guard++) {
    const l = load();
    const hi = l.indexOf(Math.max(...l));
    const lo = Math.min(...l);
    if (l[hi] <= lo * 1.2 + 30) break;
    let best: { id: string; to: number; d: number } | null = null;
    for (const s of stops) {
      if (assign.get(s.id) !== hi) continue;
      for (let c = 0; c < k; c++) {
        if (c === hi || l[c] + s.minutes >= l[hi]) continue;
        const d = milesBetween(s.at, centres[c]);
        if (!best || d < best.d) best = { id: s.id, to: c, d };
      }
    }
    if (!best) break;
    assign.set(best.id, best.to);
  }
  // Day numbers west to east.
  const order = centres.map((c, i) => ({ i, lng: c.lng })).sort((a, b) => a.lng - b.lng).map((x) => x.i);
  for (const s of stops) out.set(s.id, order.indexOf(assign.get(s.id)!));
  return out;
}

/** The same week's `weekday` (1 = Monday … 6 = Saturday) for a date. */
export function onWeekday(d: Date, weekday: number): Date {
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return new Date(d.getTime() + (weekday - dow) * 86400000);
}

/** The next working day (Monday–Saturday) after a date. */
export function nextWorkday(d: Date): Date {
  const n = new Date(d.getTime() + 86400000);
  return n.getUTCDay() === 0 ? new Date(n.getTime() + 86400000) : n;
}
