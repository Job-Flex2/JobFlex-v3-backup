// What the model would answer for each sheet of the real permit set (see plans-eagle.check.ts).
// Raw model answers — the check cleans them with cleanSheetRead; the browser walk's
// stand-in model serves them by page.
const glazing: Array<[string, number, string, string]> = [
  ["DINING slider", 2, "3.00", "6.00"], ["MBA2 slider", 2, "5.00", "5.00"], ["MBR2 S.G.D.", 1, "9.00", "8.00"], ["KITCHEN D.slider", 1, "8.00", "5.00"],
  ["NOOK S.G.D.", 1, "8.00", "8.00"], ["GREAT RM S.hung", 2, "3.00", "6.00"], ["GREAT RM picture", 1, "6.00", "6.00"], ["DEN picture", 1, "3.00", "2.00"],
  ["BA4 picture", 3, "2.00", "3.00"], ["BDRM3 casement", 2, "3.00", "5.00"], ["BDRM 2 slider", 1, "4.00", "4.00"], ["MEDIA picture", 1, "3.00", "5.00"],
  ["MEDIA casement", 2, "3.00", "5.00"], ["MEDIA picture", 2, "3.00", "2.00"], ["LNDY casement", 1, "2.00", "3.00"], ["MBR slider", 2, "6.00", "5.00"],
  ["MBA slider", 1, "6.00", "5.00"], ["WIC slider", 1, "6.00", "5.00"], ["UPPER GREAT picture", 6, "3.00", "5.00"], ["UPPER GREAT picture", 2, "6.00", "5.00"],
  ["STAIRS picture", 4, "3.00", "5.00"], ["BDRM4 picture", 2, "3.00", "5.00"], ["BDRM4 picture", 2, "3.00", "2.00"], ["MBA skylight", 1, "4.00", "4.00"],
];

const room = (name: string, floor: string | null, ceiling: string | null = null) => ({ name, size: null, floor, ceiling });
export const EAGLE_READS: Array<[number, Record<string, unknown>]> = [
  [1, {
    kind: "site", title: "A0 SITE PLAN",
    // The client, the address and the architect are left out of this public repo.
    project: { name: "Sample Residence", address: "Anytown, WA" },
    stated: { porchSqFt: "438 SF", drivewaySqFt: "1,671 SF", walksSqFt: "68 SF", patioSqFt: "78 SF", lotSqFt: "27,007 SF" },
    roof: { planArea: "4,013 SF" },
    notes: ["Lot 27,007 SF; building footprint 2,908 SF", "Silt fence and temporary construction entrance", "All existing trees to remain"],
    confidence: "high",
  }],
  [2, { kind: "cover", title: "A1 COVERSHEET", notes: ["2018 IRC / 2018 WSEC", "Install NFPA 13D residential sprinkler system: no"], confidence: "high" }],
  [3, {
    kind: "schedule", title: "A2 SCHEDULE SHEET",
    stated: { livingSqFt: "5192" },
    windows: glazing.map(([type, count, width, height]) => (type === "MEDIA picture" ? { type, count, width: Number(width), height: Number(height) } : { type, count, size: `${width} x ${height}` })),
    doors: [
      { type: "Foyer exterior door", count: 2, size: "3.00 x 8.00", exterior: true },
      { type: "Garage exempt swing door", count: 1, width: "2.66", height: "8.00", exterior: true },
    ],
    mechanical: { system: "air-source centrally ducted heat pump (HSPF 11)", heatLoadBtu: "51,624", waterHeater: "50 gal hybrid heat pump, electric" },
    notes: ["Conditioned floor area 5,192 SF", "Crawlspace 2,254 SF: 15 foundation vents 14x7", "R-49 attic, R-38 vaulted, R-21 walls, R-30 floors, U-0.27 windows"],
    confidence: "high",
  }],
  [4, { kind: "detail", title: "A3 DETAIL SHEET", confidence: "medium" }],
  [5, {
    kind: "foundation", title: "A4 FOUNDATION PLAN",
    overall: { width: "64'-0\"", depth: "51'-0\"" },
    foundation: { type: "crawlspace", footingWidth: "1'-4\"", footingDepth: "8\"", slab: "4\"" },
    notes: ["FTG2 2'-0\" sq x 8\"; FTG4 3'-0\" x 10\" at shear walls", "6 mil black vapor barrier in the crawl space"],
    confidence: "medium",
  }],
  [6, { kind: "structural", title: "A5 MAIN FLOOR FRAMING PLAN", notes: ["11-7/8\" TJI 110 at 16\" o.c.", "4x10 DF#2 dropped beams"], confidence: "medium" }],
  [7, {
    kind: "floor", level: "Main", title: "A6 MAIN FLOOR PLAN",
    overall: { width: "64'-0\"", depth: "51'-0\"" },
    stated: { mainSqFt: "2,251 S.F.", upperSqFt: "2,941 S.F.", livingSqFt: "5,192 S.F.", garageSqFt: "674 S.F.", porchSqFt: "438" },
    plateHeights: [{ level: "Main", height: "10'-1 1/8\"" }],
    rooms: [
      room("GREAT ROOM", "hardwood"), room("NOOK", "hardwood", "10'-1 1/8\""), room("KITCHEN", "hardwood", "10'-1 1/8\""), room("WIC", "carpet"),
      room("MBR2", "carpet", "10'-1 1/8\""), room("PTY", "hardwood"), room("HALL", "hardwood"), room("MUD", "tile"), room("MBA2", "tile"),
      room("PDR", "hardwood"), room("BP", "hardwood"), room("DEN", "hardwood"), room("FOYER", "hardwood"), room("ENTRY", null),
      room("DINING", "hardwood"), room("3-CAR GARAGE", "concrete"), room("REAR COV'D PATIO", "concrete"), room("PATIO", "concrete"),
    ],
    windows: [{ tag: null, size: "3⁰6⁰", type: "S.H.", count: 2 }],
    doors: [
      { size: "8⁰8⁰", type: "O.H. garage door", count: 1 },
      { size: "16⁰8⁰", type: "O.H. garage door", count: 1 },
      { size: "2⁸0", type: "interior", count: 8, exterior: false },
      { size: "2⁴0", type: "interior", count: 2, exterior: false },
    ],
    fixtures: { kitchenSink: 1, dishwasher: 1, toilet: 2, lavatory: 3, tub: 1, shower: 1, gasRange: 1, gasFireplace: 1, waterHeater: 1, hoseBib: 2 },
    mechanical: { systems: 2 },
    notes: ["48\" direct-vent gas fireplace in the great room", "Garage: 5/8\" Type X at posts, ceilings and beams"],
    confidence: "medium",
  }],
  [8, { kind: "structural", title: "A7 UPPER FLOOR FRAMING PLAN", confidence: "medium" }],
  [9, {
    kind: "floor", level: "Upper", title: "A8 UPPER FLOOR PLAN",
    plateHeights: [{ level: "Upper", height: "9'-1 1/8\"" }],
    rooms: [
      room("OPEN TO BELOW", null, "20'-9\""), room("WIC", "carpet"), room("MSTR BATH", "tile"), room("MSTR BEDRM", "carpet"), room("BA 3", "tile"),
      room("LANDING", "carpet"), room("HALL", "carpet"), room("WIC", "carpet"), room("LINEN", "carpet"), room("LAUNDRY", "tile"),
      room("BEDRM 4", "carpet"), room("BA 4", "tile"), room("BEDRM 3", "carpet"), room("BEDRM 2", "carpet"), room("MEDIA", "carpet"),
    ],
    doors: [
      { size: "2⁸0", type: "interior", count: 11, exterior: false },
      { size: "2⁴0", type: "interior", count: 3, exterior: false },
      { size: "(2) 2⁸0", type: "interior pair", count: 2, exterior: false },
    ],
    fixtures: { toilet: 3, lavatory: 5, tub: 1, shower: 2, tubShower: 1, washer: 1, laundrySink: 1 },
    confidence: "medium",
  }],
  [10, {
    kind: "roof", title: "A9 ROOF FRAMING PLAN",
    roof: { pitch: "6:12", style: "mixed", material: "composition shingles (standing seam metal at the entry roof)", overhang: "2'-0\"" },
    notes: ["4:12 at the porch roofs", "Manufactured trusses at 24\" o.c.", "4x4 skylight with laminated glass at the master bath"],
    confidence: "medium",
  }],
  [11, {
    kind: "elevation", title: "A10 EXTERIOR ELEVATIONS",
    roof: { pitch: "6:12" },
    plateHeights: [{ level: "Main", height: "10'-1 1/8\"" }, { level: "Upper", height: "9'-1 1/8\"" }],
    exterior: { siding: "horizontal Hardie plank lap, 8\" exposure; Hardie panel with 1x3 battens at 24\" in the gables; stone veneer at the garage", gutters: "continuous metal gutter over 2x8 fascia" },
    confidence: "medium",
  }],
  [12, { kind: "elevation", title: "A11 EXTERIOR ELEVATIONS", roof: { pitch: "6:12" }, confidence: "medium" }],
  [13, { kind: "section", title: "A12 BUILDING SECTIONS", notes: ["R-49 at flat ceilings", "11-7/8\" TJI floor joists"], confidence: "medium" }],
  ...[14, 15, 16, 17, 18].map((p): [number, Record<string, unknown>] => [p, { kind: "structural", title: `S${p - 13}`, confidence: "medium" }]),
];

