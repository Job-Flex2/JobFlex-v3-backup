// "Typical in <city>": the cost guide's own range for the same work in the same city (lib/seo), printed under the
// homeowner's range so the number has company. Only where the guide cites a source for that material — today the
// architectural shingle — and only for a city the guides know; the architectural figure never stands under a metal
// range. Server-side (it pulls the whole price book); the range screen gets the result, not this module.
import { seoCityByPlace } from "@/lib/seo/cities";
import { calibration, quote } from "@/lib/seo/pricing";
import { seoTrade } from "@/lib/seo/trades";
import type { MaterialId } from "./roof";

const round100 = (n: number) => Math.round(n / 100) * 100;

export function roofGuideRange(place: string | null, material: MaterialId): { low: number; high: number; cityWords: string } | null {
  const trade = seoTrade("roof-replacement");
  const city = seoCityByPlace(place);
  if (!trade || !city) return null;
  const variant = trade.variants.find((v) => v.id === material);
  if (!variant?.cited || !calibration(trade, material)) return null;
  const q = quote(trade, city, trade.size.typical, material);
  if (!(q.lo > 0) || !(q.hi > q.lo)) return null;
  return { low: round100(q.lo), high: round100(q.hi), cityWords: city.place };
}
