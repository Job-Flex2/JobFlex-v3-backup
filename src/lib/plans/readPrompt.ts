// What the vision model is told when it reads ONE sheet of a plan set. Pure.
//
// It gets the sheet's picture (whole, plus close-up tiles when the sheet has no text
// layer — a scanned set) and the sheet's text layer (a CAD export carries every
// dimension string, room label and schedule cell as text with its position, which is
// far more reliable than reading pixels). It answers in one JSON object
// (lib/plans/sheet: SheetRead), reporting only what the sheet shows.

export const PLAN_READ_SYSTEM = [
  "You are a residential construction estimator doing a quantity takeoff from architectural plans.",
  "You read ONE sheet at a time and report what that sheet shows, as JSON. You never invent: a value the sheet does not show is null (or an empty list).",
  "The text layer, when given, is the sheet's own text as the drafter typed it, with positions — trust it over what you see in the picture for every number and label; use the picture to understand which text belongs to which room, wall or schedule row.",
].join("\n");

/** One page's text layer as compact lines: "y=812: 40'-0\"  …" top to bottom, left to right. */
export type TextItem = { str: string; x: number; y: number };
export function formatTextLayer(items: TextItem[], maxChars = 14000): string {
  const rows = new Map<number, TextItem[]>();
  for (const it of items) {
    const s = it.str.replace(/\s+/g, " ").trim();
    if (!s) continue;
    const key = Math.round(it.y / 4) * 4; // same baseline within ~4pt
    const row = rows.get(key) ?? [];
    row.push({ ...it, str: s });
    rows.set(key, row);
  }
  const lines = Array.from(rows.entries())
    .sort((a, b) => b[0] - a[0]) // PDF y grows upward: top of the sheet first
    .map(([y, row]) => `y=${y}: ` + row.sort((a, b) => a.x - b.x).map((r) => `${r.str}@x${Math.round(r.x)}`).join("  "));
  let out = "";
  for (const l of lines) {
    if (out.length + l.length + 1 > maxChars) {
      out += "\n…(text layer truncated)";
      break;
    }
    out += (out ? "\n" : "") + l;
  }
  return out;
}

export function planReadPrompt(input: { page: number; pages: number; textLayer: string; tiles: number; grid?: [number, number] | null; fileName?: string | null }): string {
  const grid = input.grid && input.grid[0] * input.grid[1] === input.tiles ? input.grid : null;
  return [
    `This is sheet ${input.page} of ${input.pages}${input.fileName ? ` from "${input.fileName}"` : ""}.`,
    input.tiles
      ? `The first image is the whole sheet; the next ${input.tiles} are overlapping close-ups of it${grid ? `, ${grid[0]} across and ${grid[1]} down, in reading order (left to right, top row first)` : ""}, for reading small text. A dimension or label cut at a close-up's edge is whole in its neighbour.`
      : "The image is the whole sheet.",
    input.textLayer ? `\nTEXT LAYER (the sheet's own text, "text@x" grouped by line y; PDF points, y grows upward):\n${input.textLayer}` : "\nThis sheet has no text layer (a scan or a photo): read the text from the images.",
    "",
    "Answer with ONE JSON object with exactly these keys:",
    `{
  "kind": "cover|site|foundation|floor|roof|elevation|section|structural|electrical|plumbing|mechanical|schedule|detail|other",
  "title": "the title block's sheet number and name, e.g. A2.1 MAIN FLOOR PLAN",
  "level": "for a floor/electrical/plumbing/mechanical plan: Basement|Main|Upper|Third (the floor it shows), else null",
  "scale": "as written, e.g. 1/4\\" = 1'-0\\"",
  "project": { "name": "...", "address": "..." },
  "stated": { "livingSqFt": n, "mainSqFt": n, "upperSqFt": n, "basementSqFt": n, "garageSqFt": n, "porchSqFt": n, "deckSqFt": n, "drivewaySqFt": n, "walksSqFt": n, "patioSqFt": n, "lotSqFt": n },
  "overall": { "width": "overall outside dimension as written, e.g. 40'-0\\"", "depth": "..." },
  "stories": n,
  "plateHeights": [ { "level": "Main", "height": "9'-1 1/8\\"" } ],
  "rooms": [ { "name": "KITCHEN", "size": "12'-0\\" x 14'-0\\"", "area": "written area if any", "ceiling": "9'-0\\"", "floor": "finish if called out (tile, LVP, carpet, hardwood…)" } ],
  "windows": [ { "tag": "W1", "size": "3'-0\\" x 5'-0\\"", "type": "vinyl single hung", "count": n } ],
  "doors": [ { "tag": "D1", "size": "3'-0\\" x 6'-8\\"", "type": "exterior fiberglass entry", "count": n, "exterior": true } ],
  "roof": { "pitch": "6:12", "style": "gable|hip|shed|mixed", "material": "...", "overhang": "18\\"", "area": "the roof's SURFACE area, only if written", "planArea": "a table's horizontal roof area, e.g. a site plan's ROOF & GUTTERS AREA" },
  "foundation": { "type": "slab|crawlspace|basement|piers", "footingWidth": "16\\"", "footingDepth": "8\\"", "wallHeight": "2'-6\\"", "slab": "4\\"" },
  "walls": { "exteriorFraming": "2x6 @ 16\\" o.c.", "interiorFraming": "2x4 @ 16\\" o.c.", "exteriorLf": "only if written" },
  "exterior": { "siding": "...", "trim": "...", "gutters": "..." },
  "fixtures": { "toilet": n, "lavatory": n, "kitchenSink": n, "barSink": n, "laundrySink": n, "tub": n, "shower": n, "tubShower": n, "dishwasher": n, "washer": n, "waterHeater": n, "hoseBib": n, "iceMaker": n, "gasRange": n, "gasFireplace": n },
  "electrical": { "receptacle": n, "gfci": n, "switch": n, "light": n, "recessed": n, "fan": n, "exhaustFan": n, "smoke": n, "co": n, "exteriorLight": n, "dataTv": n, "evCharger": n, "panelAmps": n },
  "mechanical": { "system": "e.g. gas furnace + AC, heat pump", "tons": n, "furnaceBtu": n, "waterHeater": "e.g. 50 gal gas", "heatLoadBtu": "the energy sheet's BUILDING DESIGN HEAT LOAD in Btu/h, if written", "systems": "how many outdoor units / separate systems are drawn (a pad with (2) compressors = 2)" },
  "notes": [ "short notes that change the price: insulation R-values, structural calls (LVL, steel beam), special finishes, sprinklers…" ],
  "energy": { "wallR": "exterior wall insulation as written, e.g. R-21 or R-13+5ci", "ceilingR": "attic / ceiling, e.g. R-49", "floorR": "floor over a crawl or garage", "slabR": "slab edge / under slab", "basementWallR": "...", "windowU": "window U-factor, e.g. 0.28", "windowShgc": "window SHGC, e.g. 0.25", "ach50": "the air-leakage (blower-door) target in ACH50", "ductLocation": "where the ducts run: conditioned space, attic, crawlspace or basement", "ductLeakage": "duct leakage target, CFM25 per 100 sq ft" },
  "facades": [ { "facing": "the elevation's name as titled: FRONT|REAR|LEFT|RIGHT|NORTH|SOUTH|EAST|WEST", "glass": "sq ft of glass on that face — windows and glass doors together", "windows": n } ],
  "frontFaces": "a site plan only: the compass direction the FRONT of the house (the street side) faces, read from the north arrow: N|NE|E|SE|S|SW|W|NW",
  "confidence": "high|medium|low"
}`,
    "",
    "RULES:",
    "1. Copy dimensions exactly as written (feet-inches like 12'-6\"); do not convert or round. Room sizes are the size call-out under the room name (width x length). Many construction sets write no room sizes at all (the walls are dimensioned instead): then give the room with size null — never add up dimension strings or measure the picture to make one.",
    "2. Rooms: every labelled space on a floor plan, once, with its floor finish when one is written under the name (HARDWOOD, CARPET, TILE, LVP…) — include closets, the garage and porches (they are kept out of living area later). A two-story void is a room named \"OPEN TO BELOW\". Do not list rooms on a sheet that is not a floor plan.",
    "3. Windows and doors: on a SCHEDULE sheet list every row with its quantity (an energy-code glazing table is a schedule: one row per room and type, its WIDTH and HEIGHT in decimal feet — copy them as written, e.g. \"3.00 x 6.00\"). On a plan, list each door and window call-out you can see with how many times it appears, interior doors included (\"exterior\": false). Count garage overhead doors and sliding patio doors as exterior doors.",
    "3a. Drafters write sizes as superscripts: 3⁰6⁰ is 3'-0\" x 6'-0\", 2⁸0 a 2'-8\" door, 16⁰8⁰ O.H. a 16'-0\" x 8'-0\" overhead door — copy them as written.",
    "4. Fixtures and devices: count only symbols actually drawn on this sheet (toilets, sinks, tubs on a floor or plumbing plan; outlets, switches, lights on an electrical plan). If the sheet does not draw them, leave them out — do not estimate.",
    "5. Stated areas: copy the area summary as written (\"2,280 S.F.\" → 2280). Living area excludes garage, porch and deck. porchSqFt is every covered porch, entry and patio added together. A site plan's impervious-area table gives drivewaySqFt (driveway and approach), walksSqFt and patioSqFt (open patios), and its roof area goes in roof.planArea.",
    "6. Roof pitch: as written on the elevations or roof plan (\"6:12\", \"6/12\"). Overhang as written on a section or note.",
    "7. kind: a floor plan that also shows electrical symbols is still \"floor\" unless its title says electrical. A cover sheet with an area summary is \"cover\".",
    "8. confidence: high when the text layer carries the numbers, medium when read from a clear image, low when the image is blurry or partly cut off.",
    "9. energy: the energy-code table, the insulation schedule, the wall and roof sections and the general notes say what the house is built to (R-values, window U-factor and SHGC, the ACH50 air-leakage target, duct location and leakage). Copy them as written; null for anything the sheet does not say. Any sheet may carry them.",
    "10. facades: on an ELEVATION sheet, one row for each elevation drawn, named as its title names it (FRONT ELEVATION → FRONT, NORTH ELEVATION → NORTH). glass = the windows and glass doors on that face added up from their sizes (3'-0\" x 5'-0\" is 15 sq ft) or from the schedule by their tags; windows = how many. Other sheets: an empty list.",
    "11. frontFaces: on a SITE plan, the way the front of the house faces — the street side — read off the north arrow (a front wall toward the bottom of the sheet with north pointing up faces S). Other sheets: null.",
    "Return only the JSON object.",
  ].join("\n");
}

/**
 * Which pages are worth a full read, from their text layer alone (no model call):
 * floor / foundation / roof / elevation / schedule / site / MEP plans and cover sheets
 * yes; details, general notes, specifications and structural calcs no. A page with no
 * text (a scan) is read — the model classifies it.
 *
 * The sheet's TITLE BLOCK decides first when it names the sheet ("A3 EXTERIOR
 * ELEVATIONS"): a cover's area summary says "MAIN FLOOR 1,200 SF" and a floor plan's
 * notes say "see elevations", so the whole page's words alone mislabel both.
 */
export function pageWorthReading(text: string, title = ""): { read: boolean; guess: string } {
  if (title.trim()) {
    const t = classifySheet(title);
    if (t && t.guess !== "other") return t;
  }
  return classifySheet(text) ?? { read: true, guess: "scan" };
}

function classifySheet(text: string): { read: boolean; guess: string } | null {
  const t = text.toUpperCase();
  if (!t.trim()) return null;
  if (/\b(COVER SHEET|TITLE SHEET|SHEET INDEX|DRAWING INDEX)\b/.test(t)) return { read: true, guess: "cover" };
  if (/\b(WINDOW|DOOR|FINISH|FIXTURE|ROOM FINISH) SCHEDULES?\b/.test(t)) return { read: true, guess: "schedule" };
  if (/\bELEVATIONS?\b/.test(t) && !/\bFLOOR PLANS?\b/.test(t)) return { read: true, guess: "elevation" };
  if (/\b(FLOOR PLANS?|MAIN FLOOR|UPPER FLOOR|SECOND FLOOR|FIRST FLOOR|BASEMENT PLANS?|LOWER LEVEL)\b/.test(t)) return { read: true, guess: "floor" };
  if (/\b(FOUNDATION|FOOTING) PLANS?\b/.test(t)) return { read: true, guess: "foundation" };
  if (/\bROOF (FRAMING )?PLANS?\b/.test(t)) return { read: true, guess: "roof" };
  if (/\bELEVATIONS?\b/.test(t)) return { read: true, guess: "elevation" };
  if (/\b(ELECTRICAL|LIGHTING|POWER) PLANS?\b/.test(t)) return { read: true, guess: "electrical" };
  if (/\bPLUMBING PLANS?\b/.test(t)) return { read: true, guess: "plumbing" };
  if (/\b(MECHANICAL|HVAC) PLANS?\b/.test(t)) return { read: true, guess: "mechanical" };
  if (/\b(SITE PLAN|PLOT PLAN)S?\b/.test(t)) return { read: true, guess: "site" };
  if (/\b(AREA SUMMARY|SQUARE FOOTAGE|PROJECT DATA)\b/.test(t)) return { read: true, guess: "cover" };
  if (/\b(BUILDING SECTION|WALL SECTION|CROSS SECTION|SECTIONS?)\b/.test(t)) return { read: true, guess: "section" };
  // An energy-code sheet carries what the heating & cooling load rests on — R-values, window U-factors, the
  // air-leakage target (2026-10-18): read like a schedule, never skipped as a detail.
  if (/\b(ENERGY CODE|ENERGY COMPLIANCE|ENERGY CALCS?|REScheck|INSULATION SCHEDULE|GLAZING SCHEDULE)\b/i.test(t)) return { read: true, guess: "schedule" };
  if (/\b(DETAILS?|GENERAL NOTES|SPECIFICATIONS|STRUCTURAL NOTES|CALCULATIONS|SHEAR WALL)\b/.test(t)) return { read: false, guess: "detail" };
  return { read: true, guess: "other" };
}
