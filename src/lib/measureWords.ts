// A proposal line's measurement as the client reads it (2026-10-16): the stored LineItem.measurementType ("HOUR",
// "LUMP_SUM", "SQFT" …) in plain words, counted — "16 hours", "1 hour", "2 units", "24 squares", "600 sqft". The
// client page on a desk and on a phone read it from here, so the two never word a line differently.
// Pure, no imports.

const COUNTED: Record<string, [one: string, many: string]> = {
  HOUR: ["hour", "hours"],
  UNIT: ["unit", "units"],
  SQUARE: ["square", "squares"],
  // The real measures (2026-10-21): what a line is counted or bought in.
  EACH: ["each", "each"],
  SHEET: ["sheet", "sheets"],
  BUNDLE: ["bundle", "bundles"],
  ROLL: ["roll", "rolls"],
  BOX: ["box", "boxes"],
  BAG: ["bag", "bags"],
  PIECE: ["piece", "pieces"],
  GALLON: ["gallon", "gallons"],
  TON: ["ton", "tons"],
  SET: ["set", "sets"],
  BUCKET: ["bucket", "buckets"],
  TUBE: ["tube", "tubes"],
  CU_YARD: ["cubic yard", "cubic yards"],
  SQ_YARD: ["sq yard", "sq yards"],
};

/** The measurement word for a quantity — plural where English wants it; null when the line has none. */
export function measureWords(type: string | null | undefined, quantity?: number | null): string | null {
  if (!type) return null;
  const key = type.trim().toUpperCase();
  const counted = COUNTED[key];
  if (counted) return quantity === 1 ? counted[0] : counted[1];
  const cleaned = type.replace(/_/g, " ").trim().toLowerCase();
  return cleaned.length ? cleaned : null;
}
