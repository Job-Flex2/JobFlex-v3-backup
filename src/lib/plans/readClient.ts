// The small pieces every screen that reads a plan set shares (2026-10-18: the blueprint estimator and, since then,
// the HVAC estimator's "from the plans"): a few at once, the images that fit one request, and what a sheet's own
// text says it is. Browser-safe, no React.
import type { PlanPage } from "./pdfClient";
import { pageWorthReading } from "./readPrompt";
import { SHEET_KINDS, type SheetRead } from "./sheet";
import { MAX_SHEET_IMAGE_CHARS } from "./wire";

/** Run `fn` over `items`, `n` at a time. */
export async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, lane));
}

/** The whole sheet always; close-ups while the request stays under Vercel's size. */
export function fitImages(overview: string, tiles: string[]): string[] {
  const out = [overview];
  let total = overview.length;
  for (const t of tiles) {
    if (total + t.length > MAX_SHEET_IMAGE_CHARS - 40_000) break;
    out.push(t);
    total += t.length;
  }
  return out;
}

/** A sheet not read (a details sheet): what its title block calls it. */
export function guessKind(p: PlanPage): SheetRead["kind"] {
  const g = pageWorthReading(p.text, p.titleText).guess;
  return (SHEET_KINDS as readonly string[]).includes(g) ? (g as SheetRead["kind"]) : "other";
}

/** What a sheet's own text says it is — null for a scan or CAD lettering drawn as lines. */
export function textKind(p: PlanPage): SheetRead["kind"] | null {
  if (!p.text.trim()) return null;
  const g = guessKind(p);
  return g === "other" ? null : g;
}
