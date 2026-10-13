// Plan-sheet numbers as the drafter writes them, read into feet and inches. Pure.
//
//   feetOf("12'-6\"") → 12.5     feetOf("40'") → 40     feetOf("9'-0\" CLG") → 9
//   feetOf("12' 6 1/2\"") → 12.54  feetOf("30") → 30 (a bare number is feet)
//   inchesOf("3'-0\"") → 36       inchesOf("36") → 36 (a bare number is inches)
//   sizeOf("3'-0\" x 5'-0\"") → { w: 36, h: 60 } (inches)   sizeOf("3050") → { w: 36, h: 60 }
//   areaOf("12'-0\" x 14'-0\"") → 168 (sq ft)
//   pitchOf("6:12") → { rise: 6, run: 12, factor: 1.118 }   pitchOf("8/12") … pitchOf("26.57°")
//
// A plan carries feet-inch strings, fractional inches, "SF"/"SQ FT" areas, window
// call-outs written as four digits ("3050" = 3'-0" × 5'-0", the trade's shorthand)
// and roof pitches as rise:12. Anything this cannot read returns null — the caller
// decides, nothing is guessed here.

const FRACTION = /(\d+)\s*\/\s*(\d+)/;

/** "6 1/2" → 6.5, "1/2" → 0.5, "6.5" → 6.5 */
function mixedNumber(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const parts = t.split(/\s+/);
  let total = 0;
  for (const p of parts) {
    const f = FRACTION.exec(p);
    if (f) {
      const d = Number(f[2]);
      if (!d) return null;
      total += Number(f[1]) / d;
    } else if (/^\d+(\.\d+)?$/.test(p)) total += Number(p);
    else return null;
  }
  return total;
}

const FOOT = /['’′]|ft\b|feet\b|foot\b/i;
const INCH = /["”″]|in\b|inch(es)?\b/i;

/**
 * Feet from a length string. Feet-inch ("12'-6\"", "12' 6\"", "12ft 6in"), feet only
 * ("40'", "40 ft"), inches only ("18\"" → 1.5) and a bare number (taken as feet).
 */
export function feetOf(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  const s = raw.replace(/,/g, "").replace(/[–—]/g, "-").trim();
  // feet and inches: 12'-6", 12' 6 1/2", 12ft 6in
  const fi = /(\d+(?:\.\d+)?)\s*(?:'|’|′|ft|feet|foot)\s*-?\s*(\d+(?:\s+\d+\s*\/\s*\d+)?(?:\.\d+)?|\d+\s*\/\s*\d+)?\s*(?:"|”|″|in|inch|inches)?/i.exec(s);
  if (fi && FOOT.test(fi[0])) {
    const ft = Number(fi[1]);
    const inch = fi[2] ? mixedNumber(fi[2]) : 0;
    if (inch == null) return null;
    const v = ft + inch / 12;
    return v > 0 ? round(v, 3) : null;
  }
  // inches only: 18"
  const io = /(\d+(?:\s+\d+\s*\/\s*\d+)?(?:\.\d+)?|\d+\s*\/\s*\d+)\s*(?:"|”|″|in\b|inch|inches)/i.exec(s);
  if (io) {
    const inch = mixedNumber(io[1]);
    return inch && inch > 0 ? round(inch / 12, 3) : null;
  }
  const bare = /^(\d+(?:\.\d+)?)$/.exec(s);
  if (bare) {
    const v = Number(bare[1]);
    return v > 0 ? v : null;
  }
  return null;
}

/** Inches from a length string; a bare number is taken as inches. */
export function inchesOf(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  const s = raw.trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const v = Number(s);
    return v > 0 ? v : null;
  }
  if (FOOT.test(s)) {
    const f = feetOf(s);
    return f == null ? null : round(f * 12, 2);
  }
  if (INCH.test(s)) {
    const f = feetOf(s);
    return f == null ? null : round(f * 12, 2);
  }
  return null;
}

/**
 * A width × height call-out, in inches. "3'-0\" x 5'-0\"", "36 x 60", "36\"x60\"",
 * and the four-digit shorthand "3050" / "3068" (feet+inches pairs: 3'0" × 5'0", 3'0" × 6'8").
 */
export function sizeOf(raw: string | null | undefined): { w: number; h: number } | null {
  if (!raw) return null;
  const s = raw.replace(/[×]/g, "x").trim();
  // The drafter's superscript shorthand, feet then inches as a superscript:
  // "3⁰6⁰" = 3'0" × 6'0", "16⁰8⁰ O.H." = 16'0" × 8'0", "2⁸0" = 2'8" × 6'8" is not
  // a pair (one door width) and is left to the width reader.
  const sup = /^(\d{1,2})([⁰¹²³⁴⁵⁶⁷⁸⁹]{1,2})\s*[x-]?\s*(\d{1,2})([⁰¹²³⁴⁵⁶⁷⁸⁹]{1,2})/.exec(s);
  if (sup) {
    const w = Number(sup[1]) * 12 + supNum(sup[2]);
    const h = Number(sup[3]) * 12 + supNum(sup[4]);
    return w > 0 && h > 0 ? { w, h } : null;
  }
  const four = /^(\d)(\d)(\d)(\d)$/.exec(s.replace(/\s+/g, ""));
  if (four) {
    const w = Number(four[1]) * 12 + Number(four[2]);
    const h = Number(four[3]) * 12 + Number(four[4]);
    return w > 0 && h > 0 ? { w, h } : null;
  }
  const parts = s.split(/\s*x\s*/i);
  if (parts.length !== 2) return null;
  const bothBare = parts.every((p) => /^\d+(\.\d+)?$/.test(p.trim()));
  // Bare numbers are inches ("36 x 60") — unless both are small enough to be feet:
  // an energy-code glazing table writes "3.00 x 6.00", and no window is 3" × 6".
  const feet = bothBare && parts.every((p) => Number(p) <= 16);
  const w = bothBare ? Number(parts[0]) * (feet ? 12 : 1) : inchesOf(parts[0]);
  const h = bothBare ? Number(parts[1]) * (feet ? 12 : 1) : inchesOf(parts[1]);
  return w && h ? { w, h } : null;
}

const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
function supNum(t: string): number {
  return Number(Array.from(t).map((c) => SUP.indexOf(c)).join("")) || 0;
}

/**
 * An opening's width or height in inches: a length string, or a bare number — which
 * is FEET when it is small (a schedule's "3.00" wide, "8.00" tall) and inches otherwise.
 */
export function openingInches(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const bare = typeof raw === "number" ? raw : /^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : null;
  if (bare != null) return Number.isFinite(bare) && bare > 0 ? round(bare <= 16 ? bare * 12 : bare, 2) : null;
  return inchesOf(raw);
}

/** Square feet from a room call-out ("12'-0\" x 14'-0\"") or a stated area ("1,200 SF"). */
export function areaOf(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.replace(/,/g, "").trim();
  // "1,200 SF", "2,251 S.F.", "674 sq. ft.", "1200 square feet"
  const stated = /(\d+(?:\.\d+)?)\s*(?:s\.?\s?f\.?(?![a-z])|sq\.?\s*f(?:ee)?t\.?|square\s*f(?:ee|oo)t|ft2|ft²)/i.exec(s);
  if (stated) return Number(stated[1]) || null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) || null;
  const parts = s.replace(/[×]/g, "x").split(/\s*x\s*/i);
  if (parts.length === 2) {
    const a = feetOf(parts[0]);
    const b = feetOf(parts[1]);
    return a && b ? round(a * b, 1) : null;
  }
  return null;
}

/** A roof pitch: "6:12", "6/12", "6 in 12", "6-12", or degrees ("26.57°"). factor = slope ÷ plan. */
export function pitchOf(raw: string | number | null | undefined): { rise: number; run: number; factor: number } | null {
  if (raw == null) return null;
  let rise: number | null = null;
  const run = 12;
  if (typeof raw === "number") rise = raw > 0 && raw <= 24 ? raw : null;
  else {
    const s = raw.trim();
    const deg = /(\d+(?:\.\d+)?)\s*(?:°|deg)/i.exec(s);
    const ratio = /(\d+(?:\.\d+)?)\s*(?::|\/|-|\s+in\s+)\s*12\b/i.exec(s);
    if (ratio) rise = Number(ratio[1]);
    else if (deg) {
      const d = Number(deg[1]);
      if (d > 0 && d < 70) rise = Math.tan((d * Math.PI) / 180) * 12;
    } else if (/^\d+(\.\d+)?$/.test(s)) rise = Number(s);
  }
  if (rise == null || !(rise > 0) || rise > 24) return null;
  return { rise: round(rise, 2), run, factor: round(Math.sqrt(rise * rise + run * run) / run, 4) };
}

export function round(n: number, d = 0): number {
  const k = 10 ** d;
  return Math.round(n * k) / k;
}
