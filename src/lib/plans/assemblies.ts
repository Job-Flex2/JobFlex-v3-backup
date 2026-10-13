// THE BUILD LIST — everything it takes to build the house, trade by trade. Pure.
//
// computeTakeoff measures the house: wall lengths, floor and roof areas, openings,
// rooms. This turns those measures into the list a builder buys and schedules from:
//
//   · every material in the unit it is bought in, waste included — drywall in 4×12
//     sheets, shingles in bundles, siding in 12' planks, paint in gallons, tile in boxes
//   · the plumbing to each fixture: the fixture, its faucet or valve and trim, the stops,
//     supplies, trap and wax ring, its water and drain stub-outs, the pipe by size, the
//     rough-in, the trim-out
//   · the electrical to each point: devices by kind (GFCI, 3-way, dimmer), light fixtures
//     by kind and room, boxes and plates, wire by gauge, breakers, panel, low voltage
//   · the HVAC: equipment, registers and returns, duct, every exhaust and vent run
//
// Each line says whether it is LABOR (the work, on a measured quantity — its materials
// are their own lines), MATERIAL (the supply, in purchase quantities) or BOTH (supply and
// install). What the plans do not show is filled by the rule a builder would use and
// marked "rule" — assumed, never hidden.
import { round } from "./dims";
import { isBath, isBedroom, isCloset, isDen, isDining, isGarage, isKitchen, isLaundry, isLiving, isMud, isOverheadDoor, isPantry, isPorch, isPowder, isStairOrHall, roomPerimeter } from "./rooms";
import type { PlanRoom, SheetRead } from "./sheet";
import type { AddItem, House, TakeoffCheck, TakeoffItem, TakeoffRole, TakeoffSource, TakeoffUnit } from "./takeoff";
import { mechOf } from "./takeoff";

export type AssemblyContext = {
  h: House;
  sheets: SheetRead[];
  /** The measured items computeTakeoff already wrote (their roles and labels are refined here). */
  items: TakeoffItem[];
  add: AddItem;
  checks: TakeoffCheck[];
  pages: { level: number[]; ground: number[]; all: number[] };
};

const C = Math.ceil;
/** Pieces of a stock length for a run, with waste. */
const pieces = (lf: number, stock: number, waste = 0.1) => C((lf * (1 + waste)) / stock);

export function addAssemblies(ctx: AssemblyContext): void {
  const { h, items, add, pages, sheets } = ctx;
  const q = (id: string) => items.find((i) => i.id === id)?.qty ?? 0;
  const sumWhere = (pred: (i: TakeoffItem) => boolean) => items.filter(pred).reduce((a, i) => a + i.qty, 0);
  /** Refine a measured item: its role, phase, label. */
  const set = (id: string, patch: Partial<TakeoffItem>) => {
    const i = items.find((x) => x.id === id);
    if (i) Object.assign(i, patch);
  };
  /** A measured count bought with waste — unless the contractor entered the number themselves. */
  const withWaste = (id: string, f: number) => {
    const i = items.find((x) => x.id === id);
    if (i && i.source !== "entered" && !i.measured) i.qty = C(i.qty * f);
  };
  const line =
    (role: TakeoffRole) =>
    (trade: Parameters<AddItem>[0], key: string, label: string, qty: number, unit: TakeoffUnit, source: TakeoffSource, basis: string, phase: string, pg: number[] = pages.level) =>
      add(trade, key, label, qty, unit, source, basis, pg, { role, phase });
  const labor = line("labor");
  const mat = line("material");
  const both = line("both");

  // ── the house, as the trades need it ───────────────────────────────────────
  const levels = h.levels;
  const ground = levels.find((l) => l.name === "Main") ?? levels[0];
  if (!ground) return;
  const top = levels.filter((l) => l.name !== "Basement").at(-1) ?? ground;
  const conditioned = levels.filter((l) => l.name !== "Basement" || h.foundation.type === "basement");
  const rooms: PlanRoom[] = conditioned.flatMap((l) => l.rooms).filter((r) => !isGarage(r) && !isPorch(r));
  const kitchens = rooms.filter(isKitchen);
  const baths = rooms.filter(isBath);
  const fullBaths = baths.filter((r) => !isPowder(r));
  const bedrooms = rooms.filter(isBedroom);
  const laundries = rooms.filter(isLaundry);
  const closets = rooms.filter(isCloset);
  const area = (pred: (r: PlanRoom) => boolean) => rooms.filter(pred).reduce((a, r) => a + (r.areaSqFt ?? 0), 0);
  const roomsFrom: TakeoffSource = rooms.some((r) => r.estimated) ? "rule" : "plan";
  const garage = h.garage;
  const garageCars = garage ? Math.max(1, Math.min(4, Math.round(garage.areaSqFt / 230))) : 0;
  const winCount = h.windows.reduce((a, w) => a + w.count, 0) || C(h.livingSqFt / 130);
  const skylights = h.windows.filter((w) => /skylight/i.test(w.type ?? "")).reduce((a, w) => a + w.count, 0);
  const extDoors = h.doors.filter((d) => d.exterior && !isOverheadDoor(d));
  const extSwing = extDoors.reduce((a, d) => a + d.count, 0) || 2;
  const slidersInGlazing = h.windows.filter((w) => /s\.?g\.?d|sliding glass|patio door/i.test(w.type ?? "")).reduce((a, w) => a + w.count, 0);
  const overheadDoors = h.doors.filter(isOverheadDoor).reduce((a, d) => a + d.count, 0) || (garage ? 1 : 0);
  const intDoorCount = q("interior-trim.doors");
  const flights = q("framing.stairs");
  const stories = Math.max(1, levels.filter((l) => l.name !== "Basement").length);
  const mech = mechOf(sheets);
  /** The furnace or the water heater burns gas (a gas cooktop or fireplace alone does not make a gas house). */
  const gasHeat = /\bgas\b|furnace|propane/i.test(`${mech?.system ?? ""} ${mech?.waterHeater ?? ""}`);
  const electricWh = !gasHeat || /electric|heat pump|hybrid/i.test(mech?.waterHeater ?? "");
  // Heating & cooling size: the plans' tons, else the design heat load, else ~800 sq ft a ton.
  const heatLoad = sheets.map((s) => s.mechanical.heatLoadBtu).find((x): x is number => !!x) ?? null;
  const tons = mech?.tons ?? (heatLoad ? Math.max(1.5, Math.round((heatLoad / 12000) * 2) / 2) : Math.max(1.5, Math.round((h.livingSqFt / 800) * 2) / 2));
  const statedSystems = Math.max(0, ...sheets.map((s) => s.mechanical.systems ?? 0));
  const sysCount = Math.max(statedSystems, tons > 5 ? Math.ceil(tons / 5) : 1);
  const fx = { ...h.fixtures };
  const assumed: string[] = [];
  // What every house has whether or not the plans draw it.
  const assume = (key: string, qty: number, words: string) => {
    if (qty > 0 && !fx[key]) {
      fx[key] = qty;
      assumed.push(words);
    }
  };
  assume("kitchenSink", kitchens.length, "kitchen sink");
  assume("dishwasher", kitchens.length, "dishwasher");
  assume("iceMaker", kitchens.length, "refrigerator ice-maker box");
  assume("washer", laundries.length, "washer box");
  assume("waterHeater", 1, "water heater");
  assume("hoseBib", 2, "two hose bibs");
  const disposals = fx.kitchenSink ?? 0;
  const n = (k: string) => fx[k] ?? 0;
  const fxSrc: TakeoffSource = h.fixturesFrom === "plan" ? "plan" : "rule";

  // ════════════════════ GENERAL CONDITIONS ════════════════════
  both("general", "utility-fees", "Utility connection fees — water, sewer, power (allowance)", 1, "lot", "rule", "set by the water and sewer district and the power company — enter their quote", "Permits & fees");
  for (const id of ["general.permit", "general.survey", "general.laterals"]) set(id, { role: "both", phase: "Permits & fees" });
  for (const id of ["general.temp", "general.supervision", "general.clean"]) set(id, { role: "both", phase: "Site services" });

  // ════════════════════ SITE WORK ════════════════════
  const pad = q("sitework.pad");
  set("sitework.pad", { role: "both", phase: "Clearing & grading" });
  set("sitework.trench", { role: "both", phase: "Excavation" });
  const lot = h.site.lotSqFt;
  const disturbed = lot ? Math.min(lot, round(pad * 2.2)) : round(pad * 2.2);
  const siltFence = round(4 * Math.sqrt(disturbed) * 0.75);
  both("sitework", "silt-fence", "Silt fence at the downhill limits of work", siltFence, "linear ft", "rule", `about three sides of a ${disturbed.toLocaleString("en-US")} sq ft disturbed area`, "Erosion control", pages.all);
  both("sitework", "entrance", "Stabilized construction entrance (quarry spalls over fabric)", 1, "each", "rule", "every permitted site", "Erosion control", pages.all);
  both("sitework", "strip", "Strip and stockpile topsoil", round((pad * 0.5) / 27, 1), "cu yards", "derived", `${pad} sq ft pad × 6"`, "Clearing & grading", pages.ground);
  both("sitework", "backfill", "Backfill and compact around the foundation", round((q("foundation.footing") * 2 * 2) / 27, 1), "cu yards", "derived", `${q("foundation.footing")} LF × 2' × 2'`, "Excavation", pages.ground);
  both("sitework", "final-grade", "Final grading away from the house (6\" in 10')", disturbed - h.footprintSqFt, "sq ft", "rule", "the disturbed area less the house", "Finish grading", pages.all);
  both("sitework", "seed", "Topsoil respread, seed or sod (landscape allowance)", round((disturbed - h.footprintSqFt) * 0.6), "sq ft", "rule", "~60% of the graded area is lawn or beds", "Finish grading", pages.all);

  // ════════════════════ FOUNDATION ════════════════════
  const footing = q("foundation.footing");
  const crawl = h.foundation.type === "crawlspace" ? ground.areaSqFt : 0;
  set("foundation.footing", { role: "labor", phase: "Footings", label: `Form, set rebar and pour continuous footings ${h.foundation.footingWidthIn}" × ${h.foundation.footingDepthIn}"` });
  set("foundation.footing-cy", { role: "labor", phase: "Footings", label: "Place footing concrete" });
  set("foundation.wall", { role: "labor", phase: "Foundation walls" });
  set("foundation.wall-cy", { role: "labor", phase: "Foundation walls", label: "Place foundation wall concrete" });
  set("foundation.slab", { role: "labor", phase: "Slabs", label: `Place and finish slabs ${h.foundation.slabIn}" (garage, porches${h.foundation.type === "slab" ? ", house" : ""})` });
  set("foundation.slab-cy", { role: "labor", phase: "Slabs", label: "Place slab concrete" });
  set("foundation.flatwork", { role: "labor", phase: "Flatwork", label: "Form, place and finish driveway, walks and patios (4\" broom finish, joints)" });
  set("foundation.anchors", { role: "labor", phase: "Foundation walls", label: "Set anchor bolts (6' on centre + each corner)" });
  set("foundation.vapor", { role: "labor", phase: "Crawlspace", label: "Lay crawlspace vapor barrier" });
  set("foundation.waterproof", { role: "both", phase: "Foundation walls" });
  // Interior support: girders on posts on pier pads under a framed floor (FTG2 on most sets).
  const girderLf = crawl ? round(crawl / 9) : 0;
  const posts = girderLf ? C(girderLf / 7) : 0;
  if (posts) {
    labor("foundation", "piers", "Form and pour pier pad footings (2'-0\" sq × 8\") under the girder posts", posts, "each", "rule", `girders every ~9' across the ${crawl} sq ft crawlspace, posts every ~7'`, "Footings", pages.ground);
  }
  const cyFootWall = q("foundation.footing-cy") + q("foundation.wall-cy") + posts * 0.1;
  mat("foundation", "concrete-fw", "Concrete 3,000 psi — footings, walls and piers (incl. 8% waste)", round(cyFootWall * 1.08, 1), "cu yards", "derived", `${round(cyFootWall, 1)} cu yd placed`, "Concrete", pages.ground);
  mat("foundation", "concrete-slab", "Concrete 3,000 psi — slabs (incl. 5% waste)", round(q("foundation.slab-cy") * 1.05, 1), "cu yards", "derived", `${q("foundation.slab-cy")} cu yd placed`, "Concrete", pages.ground);
  mat("foundation", "concrete-flat", "Concrete 3,000 psi air-entrained — driveway and walks (incl. 5% waste)", round(((q("foundation.flatwork") * 4) / 12 / 27) * 1.05, 1), "cu yards", "derived", `${q("foundation.flatwork")} sq ft × 4"`, "Concrete", pages.all);
  const rebarLf = footing * 2 * 1.1 + q("foundation.wall") * (2 + (h.foundation.wallHeightFt + 1) / 2) + (q("foundation.slab") > 0 ? (q("foundation.slab") / 2) * 1.1 : 0);
  mat("foundation", "rebar", "Rebar #4 grade 60, 20' sticks (footings 2 continuous, walls, slab grid)", pieces(rebarLf, 20, 0.1), "pieces", "rule", `${round(rebarLf)} LF incl. laps`, "Concrete", pages.ground);
  mat("foundation", "anchor-hw", "Anchor bolts 5/8\" × 10\" with 3×3 plate washers and nuts", q("foundation.anchors"), "sets", "rule", "one per anchor", "Hardware", pages.ground);
  if (crawl) {
    mat("foundation", "poly", "Vapor barrier 6-mil black poly, 20' × 100' rolls (laps and walls up 12\")", C((crawl * 1.2) / 2000), "rolls", "derived", `${crawl} sq ft × 1.2`, "Crawlspace", pages.ground);
    // IRC R408.2: 1 sq ft net per 150 sq ft, or per 1,500 over a vapor retarder — and one
    // within 3' of every corner, so in practice a vent every ~24' of stem wall.
    const vents = Math.max(C((crawl * 144) / 1500 / 73.5), C(ground.perimeterLf / 24), 4);
    both("foundation", "vents", "Foundation vents 14\" × 7\" screened (IRC R408.2)", vents, "each", "derived", `one near every corner and every ~24' of the ${ground.perimeterLf} LF stem wall (over the vapor barrier the net-area rule is 1 sq ft per 1,500)`, "Crawlspace", pages.ground);
    both("foundation", "crawl-access", "Crawlspace access 18\" × 24\", insulated and weatherstripped", 1, "each", "rule", "IRC R408.4", "Crawlspace", pages.ground);
  }
  const slabUnder = q("foundation.slab");
  if (slabUnder) {
    mat("foundation", "base-rock", "Crushed rock 3/4\"-minus under slabs, 4\" (tons)", round(((slabUnder * 4) / 12 / 27) * 1.4 * 1.1, 1), "tons", "derived", `${slabUnder} sq ft × 4" × 1.4 t/cu yd`, "Slabs", pages.ground);
    mat("foundation", "slab-vb", "Under-slab vapor retarder 10-mil, 10' × 100' rolls", C((slabUnder * 1.1) / 1000), "rolls", "derived", `${slabUnder} sq ft`, "Slabs", pages.ground);
    labor("foundation", "joints", "Saw-cut control joints in slabs", round(slabUnder / 10), "linear ft", "rule", "joints at ~10' each way", "Slabs", pages.ground);
  }
  both("foundation", "drain", "Footing drain: 4\" perforated pipe and filter fabric, to daylight or storm", round(footing * 1.1), "linear ft", "rule", "around the footing (WA practice; per the wall detail)", "Drainage", pages.ground);
  mat("foundation", "drain-rock", "Drain rock 1-1/2\" washed for the footing drain", round((footing * 1.1) / 27, 1), "cu yards", "derived", "1 sq ft of rock per LF of drain", "Drainage", pages.ground);

  if (h.foundation.type === "basement") {
    both("foundation", "sump", "Sump pit, pump and discharge line", 1, "each", "rule", "every basement", "Drainage", pages.ground);
    both("foundation", "egress", "Basement egress window wells with ladders", Math.max(1, rooms.filter((r) => isBedroom(r) && r.level === "Basement").length), "each", "rule", "every basement bedroom (IRC R310)", "Foundation walls", pages.ground);
  }

  // ════════════════════ FRAMING ════════════════════
  const extLf = q("framing.ext-walls");
  const intLf = q("framing.int-walls");
  const openings = winCount + extSwing + overheadDoors;
  set("framing.ext-walls", { role: "labor", phase: "Walls", label: "Frame exterior walls (2x6 @ 16\" o.c.)" });
  set("framing.int-walls", { role: "labor", phase: "Walls", label: "Frame interior walls (2x4 @ 16\" o.c.)" });
  set("framing.floor", { role: "labor", phase: "Floors", label: "Frame floor systems and lay subfloor" });
  set("framing.roof", { role: "labor", phase: "Roof", label: "Set trusses and frame the roof (incl. overbuilds)" });
  set("framing.headers", { role: "labor", phase: "Walls", label: "Build and set headers over openings" });
  set("framing.stairs", { role: "labor", phase: "Stairs", label: "Build stairs: stringers, treads, risers, landings" });
  const wallSheathSheets = q("framing.wall-sheathing");
  const roofSheathSheets = q("framing.roof-sheathing");
  set("framing.wall-sheathing", { role: "material", phase: "Sheathing", label: "Wall sheathing 7/16\" OSB 4×8 (incl. 8% waste)" });
  set("framing.roof-sheathing", { role: "material", phase: "Sheathing", label: "Roof sheathing 1/2\" CDX/OSB 4×8 with H-clips (incl. 8% waste)" });
  withWaste("framing.wall-sheathing", 1.08);
  withWaste("framing.roof-sheathing", 1.08);
  labor("framing", "sheath-walls", "Install wall sheathing with shear-wall nailing", round(wallSheathSheets * 32), "sq ft", "derived", `${wallSheathSheets} sheets × 32 sq ft`, "Sheathing");
  labor("framing", "sheath-roof", "Install roof sheathing", round(roofSheathSheets * 32), "sq ft", "derived", `${roofSheathSheets} sheets × 32 sq ft`, "Sheathing", pages.ground);
  for (const l of levels) {
    const lvExt = round(l.perimeterLf + (l === ground && garage && !h.garageInOutline ? (garage.widthFt ?? Math.sqrt(garage.areaSqFt)) + 2 * (garage.depthFt ?? Math.sqrt(garage.areaSqFt)) : 0));
    const share = intLf * (l.areaSqFt / Math.max(1, levels.reduce((a, x) => a + x.areaSqFt, 0)));
    const stud = l.plateFt >= 9.75 ? "116-5/8\" (10' wall)" : l.plateFt >= 8.75 ? "104-5/8\" (9' wall)" : "92-5/8\" (8' wall)";
    const levelOpenings = openings * (l.areaSqFt / Math.max(1, h.livingSqFt));
    mat("framing", `studs-ext-${l.name.toLowerCase()}`, `Studs 2x6 precut ${stud} — ${l.name.toLowerCase()} exterior walls`, C((lvExt * 0.75 + levelOpenings * 3 + 12) * 1.1), "pieces", "derived", `${lvExt} LF at 16" o.c. + 3 per opening + corners, 10% waste`, "Walls");
    mat("framing", `studs-int-${l.name.toLowerCase()}`, `Studs 2x4 precut ${stud} — ${l.name.toLowerCase()} interior walls`, C((share * 0.75 + (intDoorCount * l.areaSqFt) / Math.max(1, h.livingSqFt) * 2) * 1.1), "pieces", "derived", `${round(share)} LF at 16" o.c. + 2 per door, 10% waste`, "Walls");
  }
  mat("framing", "sill", "Sill plate 2x6 pressure-treated with sill gasket, 16' pieces", pieces(ground.perimeterLf + (garage && !h.garageInOutline ? (garage.widthFt ?? Math.sqrt(garage.areaSqFt)) * 3 : 0), 16), "pieces", "derived", "on the foundation walls", "Walls", pages.ground);
  mat("framing", "plates-ext", "Plates 2x6 (bottom + double top), 16' pieces", pieces(extLf * 3, 16), "pieces", "derived", `${extLf} LF × 3 plates`, "Walls");
  mat("framing", "plates-int", "Plates 2x4 (bottom + double top), 16' pieces", pieces(intLf * 3, 16), "pieces", "derived", `${intLf} LF × 3 plates`, "Walls");
  const headerLf = h.windows.reduce((a, w) => a + ((w.widthIn ?? 36) / 12 + 0.5) * w.count, 0) + extDoors.reduce((a, d) => a + ((d.widthIn ?? 36) / 12 + 0.5) * d.count, 0) + overheadDoors * 17;
  mat("framing", "headers-mat", "Header stock 4x12 / 2x12 DF#2 (LVL over the garage doors)", round(headerLf * 1.1), "linear ft", "derived", "each opening's width + 6\" bearing", "Walls");
  const framedFloor = q("framing.floor");
  const joistSpacing = 16 / 12;
  if (framedFloor) {
    mat("framing", "joists", "Floor joists 11-7/8\" TJI (I-joists) @ 16\" o.c.", round((framedFloor / joistSpacing) * 1.05), "linear ft", "derived", `${framedFloor} sq ft ÷ 1.33' spacing, 5% waste`, "Floors");
    mat("framing", "rim", "Rim board 1-1/8\" × 11-7/8\" LSL, 12' pieces", pieces(levels.filter((l) => l.name !== "Basement").reduce((a, l) => a + l.perimeterLf, 0), 12), "pieces", "derived", "the outline of each framed floor", "Floors");
    mat("framing", "subfloor", "Subfloor 3/4\" T&G plywood 4×8, glued and nailed (incl. 8% waste)", C((framedFloor / 32) * 1.08), "sheets", "derived", `${framedFloor} sq ft ÷ 32`, "Floors");
    mat("framing", "subfloor-glue", "Subfloor adhesive, 28 oz tubes", C(framedFloor / 100), "tubes", "rule", "a tube per ~3 sheets", "Floors");
    mat("framing", "hangers", "Joist hangers (I-joist, face/top mount)", C(framedFloor / joistSpacing / 14), "each", "rule", "about one per joist end at beams", "Hardware");
  }
  if (girderLf) {
    mat("framing", "girders", "Girders 4x10 DF#2 (crawlspace beams)", round(girderLf * 1.05), "linear ft", "rule", `beam lines every ~9' across the ${crawl} sq ft crawlspace`, "Floors", pages.ground);
    mat("framing", "posts", "Posts 4x4 pressure-treated on pier blocks, with post bases", posts, "each", "rule", "every ~7' along the girders", "Floors", pages.ground);
    labor("framing", "girder-set", "Set girders and posts in the crawlspace", girderLf, "linear ft", "rule", "beam lines", "Floors", pages.ground);
  }
  const rp = q("framing.roof");
  const span = Math.min(40, Math.sqrt(rp / 1.5));
  const trusses = C(rp / (2 * span)) + 4;
  mat("framing", "trusses", "Roof trusses, engineered, @ 24\" o.c. (incl. girder and gable-end trusses)", trusses, "each", "rule", `${rp} sq ft of roof plan at 24" spacing over ~${round(span)}' spans`, "Roof", pages.ground);
  mat("framing", "ties", "Hurricane ties (Simpson H2.5A), two per truss", trusses * 2, "each", "derived", `${trusses} trusses`, "Hardware", pages.ground);
  mat("framing", "holdowns", "Hold-downs and straps per the shear-wall schedule (HDU, CS16, MSTC)", Math.max(8, C(extLf / 30)), "each", "rule", "the structural sheets call them; about one per 30 LF of exterior wall", "Hardware");
  mat("framing", "blocking", "Blocking and fire blocking 2x lumber, 16' pieces", pieces((extLf + intLf) * 0.6, 16, 0.05), "pieces", "rule", "mid-height, fire and backing blocking", "Walls");
  mat("framing", "nails", "Framing nails (16d, 8d, ring-shank) and sheathing nails, 50 lb boxes", C((h.livingSqFt + (garage?.areaSqFt ?? 0)) / 600), "boxes", "rule", "about a box per 600 sq ft built", "Hardware");
  if (flights) {
    mat("framing", "stringers", "Stair stringers 2x12 DF, 16' (3 per flight)", flights * 3, "pieces", "derived", `${flights} flight${flights === 1 ? "" : "s"}`, "Stairs");
  }
  labor("framing", "backing", "Backing for cabinets, grab bars, towel bars, TV mounts and handrails", 1, "lot", "rule", "every house", "Walls");
  if (h.deckSqFt) {
    both("framing", "deck", "Deck: footings, PT framing, ledger flashing, composite decking", h.deckSqFt, "sq ft", "plan", `${h.deckSqFt} sq ft of deck on the plans`, "Decks");
    both("framing", "deck-rail", "Deck railing (36\"–42\")", round(Math.sqrt(h.deckSqFt) * 3), "linear ft", "rule", "three open sides of the deck", "Decks");
  }
  labor("framing", "punch", "Framing punch list and the framing inspection", 1, "lot", "rule", "every house", "Walls");

  // ════════════════════ ROOFING ════════════════════
  const roofArea = q("roofing.area");
  const sq = roofArea / 100;
  const cutUp = /hip|mix|cross/i.test(h.roof.style ?? "") ? 0.15 : 0.1;
  const eave = q("roofing.eave");
  const rake = q("roofing.rake");
  const ridge = q("roofing.ridge");
  const hips = /hip|mix/i.test(h.roof.style ?? "") ? round(ridge * 0.8) : 0;
  const valleys = /mix|cross/i.test(h.roof.style ?? "") ? round(Math.sqrt(roofArea) * 1.5) : 0;
  set("roofing.area", { role: "labor", phase: "Shingles", label: `Install roofing — ${h.roof.material ?? "architectural shingles"}, ${h.roof.rise}:12` });
  set("roofing.underlayment", { role: "labor", phase: "Underlayment", label: "Install synthetic underlayment" });
  set("roofing.eave", { role: "labor", phase: "Edges", label: "Install drip edge, starter and ice & water at the eaves" });
  set("roofing.ridge", { role: "labor", phase: "Edges", label: "Install ridge vent and ridge cap" });
  set("roofing.rake", { role: "labor", phase: "Edges", label: "Install drip edge and starter at the rakes" });
  mat("roofing", "shingles", `Architectural shingles, 3 bundles a square (incl. ${Math.round(cutUp * 100)}% waste)`, C(sq * (1 + cutUp) * 3), "bundles", "derived", `${round(sq, 1)} squares`, "Shingles", pages.ground);
  mat("roofing", "underlay-rolls", "Synthetic underlayment, 10-square rolls", C((sq * 1.1) / 10), "rolls", "derived", `${round(sq, 1)} squares + 10% laps`, "Underlayment", pages.ground);
  mat("roofing", "ice-water", "Ice & water shield, 2-square rolls (eaves 3' + valleys 3')", C(((eave + valleys) * 3) / 200), "rolls", "derived", `${eave} LF of eave${valleys ? ` + ${valleys} LF of valley` : ""} × 3'`, "Underlayment", pages.ground);
  mat("roofing", "drip-edge", "Drip edge 10' pieces (eaves and rakes)", pieces(eave + rake, 10), "pieces", "derived", `${eave + rake} LF`, "Edges", pages.ground);
  mat("roofing", "starter", "Starter strip shingles, ~100 LF a bundle", C((eave + rake) / 100), "bundles", "derived", `${eave + rake} LF`, "Edges", pages.ground);
  mat("roofing", "cap", "Hip and ridge cap shingles, ~33 LF a bundle", C((ridge + hips) / 33), "bundles", "derived", `${ridge} LF ridge${hips ? ` + ${hips} LF hips` : ""}`, "Edges", pages.ground);
  const atticVentJacks = C(((q("insulation.attic") || top.areaSqFt) * 144) / 300 * 0.45 / 50);
  mat("roofing", "vents", "Roof vents (10\" × 7\" roof jacks, 50 sq in) — 40-50% of the attic ventilation", atticVentJacks, "each", "derived", "attic ÷ 300 × 144 sq in, upper 45%, 50 sq in each", "Vents", pages.ground);
  const plumbingVents = (fx.toilet ?? 0) + (kitchens.length ? 1 : 0) + (laundries.length ? 1 : 0);
  mat("roofing", "boots", "Pipe boots for plumbing vents (1-1/2\"–3\")", Math.max(2, plumbingVents), "each", "rule", "a vent per bathroom group, the kitchen and the laundry", "Vents", pages.ground);
  if (skylights) both("roofing", "skylight-flash", "Skylight flashing kit and installation", skylights, "each", "plan", "skylights on the plans", "Flashing", pages.ground);
  if (valleys) mat("roofing", "valley", "Valley metal / W-valley 10' pieces", pieces(valleys, 10), "pieces", "rule", `${valleys} LF of valley (estimated for a ${h.roof.style} roof)`, "Flashing", pages.ground);
  mat("roofing", "step-flash", "Step and apron flashing where roofs meet walls", round(Math.sqrt(Math.max(0, h.porchSqFt)) * 3 + (stories > 1 ? 20 : 0)), "linear ft", "rule", "porch and lower roofs against the walls", "Flashing", pages.ground);
  mat("roofing", "nails", "Coil roofing nails, 7,200-count boxes", C(sq / 15), "boxes", "derived", "a box per ~15 squares", "Shingles", pages.ground);
  labor("roofing", "load", "Load the roof and clean up (magnetic sweep)", 1, "lot", "rule", "every roof", "Shingles", pages.ground);

  // ════════════════════ GUTTERS ════════════════════
  const gutter = q("gutters.gutter");
  const downs = q("gutters.downspouts");
  set("gutters.gutter", { role: "both", phase: "Gutters", label: "Seamless aluminum gutters 5\" K-style, supplied and installed" });
  set("gutters.downspouts", { role: "labor", phase: "Downspouts", label: "Install downspouts" });
  mat("gutters", "downspout-lf", "Downspout 2×3 aluminum", round(downs * (stories > 1 ? 22 : 12)), "linear ft", "derived", `${downs} downspouts × ${stories > 1 ? 22 : 12}'`, "Downspouts", pages.ground);
  mat("gutters", "elbows", "Elbows (3 per downspout)", downs * 3, "each", "derived", `${downs} downspouts`, "Downspouts", pages.ground);
  mat("gutters", "hangers", "Hidden hangers @ 24\"", C(gutter / 2), "each", "derived", `${gutter} LF`, "Gutters", pages.ground);
  mat("gutters", "ends", "End caps, outlets and miters", downs * 2 + 8, "each", "rule", "an outlet per downspout, caps and corner miters", "Gutters", pages.ground);
  both("gutters", "splash", "Splash blocks or tightline connections at each downspout", downs, "each", "derived", `${downs} downspouts`, "Downspouts", pages.ground);

  // ════════════════════ WINDOWS & EXTERIOR DOORS ════════════════════
  for (const i of items.filter((x) => x.trade === "windows-doors")) {
    i.role = i.role ?? "material";
    i.phase = i.phase ?? (/\.(win|windows)/.test(i.id) ? "Windows" : /garage door|o\.h\./i.test(i.label) || i.id.endsWith("garage-door") ? "Garage doors" : "Exterior doors");
  }
  labor("windows-doors", "install-win", "Install windows: sill pan, flashing tape, foam and seal", winCount, "each", "derived", `${winCount} units`, "Installation");
  labor("windows-doors", "install-door", "Install exterior doors: pan, flash, threshold, adjust", extSwing + slidersInGlazing, "each", "derived", `${extSwing} swing${slidersInGlazing ? ` + ${slidersInGlazing} sliding glass` : ""} doors`, "Installation");
  if (overheadDoors) {
    labor("windows-doors", "install-oh", "Install garage overhead doors, tracks and springs", overheadDoors, "each", "derived", `${overheadDoors} door${overheadDoors === 1 ? "" : "s"}`, "Garage doors", garage?.pages ?? pages.ground);
    both("windows-doors", "openers", "Garage door openers, belt drive with keypad and remotes", overheadDoors, "each", "rule", "one per overhead door", "Garage doors", garage?.pages ?? pages.ground);
  }
  mat("windows-doors", "entry-hw", "Entry handlesets with deadbolts, keyed alike", extSwing, "each", "derived", "every exterior swing door", "Hardware");
  mat("windows-doors", "flash-tape", "Flashing tape 4\" and 9\", 75' rolls", C((openings * 16) / 75), "rolls", "rule", "~16 LF per opening", "Installation");
  mat("windows-doors", "foam", "Low-expansion window and door foam", C(openings / 4), "each", "rule", "a can per ~4 openings", "Installation");
  mat("windows-doors", "sealant", "Window and door sealant, tubes", C(openings / 2), "tubes", "rule", "a tube per 2 openings", "Installation");

  // ════════════════════ SIDING & EXTERIOR TRIM ════════════════════
  const net = q("siding.net");
  const wrap = q("siding.wrap");
  const sidingText = (h.siding ?? "").toLowerCase();
  const panelShare = /panel|batten|b&b|board and batten/.test(sidingText) ? 0.2 : 0;
  const stoneShare = /stone|masonry|brick/.test(sidingText) ? 0.03 : 0;
  const lapArea = net * (1 - panelShare - stoneShare);
  const exposureIn = Number((sidingText.match(/(\d+(?:\.\d+)?)\s*(?:"|in(?:ch)?)?\s*exposure/) ?? [])[1]) || 7;
  set("siding.net", { role: "labor", phase: "Siding", label: `Install siding${h.siding ? ` — ${h.siding}` : ""}` });
  set("siding.wrap", { role: "labor", phase: "Weather barrier", label: "Install house wrap, seams taped" });
  set("siding.corners", { role: "labor", phase: "Trim", label: "Install corner and opening trim" });
  set("siding.soffit", { role: "labor", phase: "Soffit & fascia", label: "Install soffit and fascia" });
  mat("siding", "planks", `Fiber cement lap planks 12' (${exposureIn}" exposure, incl. 12% waste)`, C((lapArea * 1.12) / ((exposureIn / 12) * 12)), "pieces", "derived", `${round(lapArea)} sq ft of lap ÷ ${round((exposureIn / 12) * 12, 1)} sq ft a plank`, "Siding");
  if (panelShare) {
    mat("siding", "panels", "Fiber cement panels 4×10 smooth (board & batten areas)", C((net * panelShare * 1.1) / 40), "sheets", "rule", `~${Math.round(panelShare * 100)}% of the walls are panel (gables)`, "Siding");
    mat("siding", "battens", "Battens 1x3 @ 24\" o.c., 12' pieces", pieces(((net * panelShare) / 2), 12), "pieces", "rule", "a batten every 2' over the panels", "Siding");
  }
  if (stoneShare) both("siding", "stone", "Adhered stone veneer with scratch coat and weep screed", round(net * stoneShare), "sq ft", "rule", "stone accents on the elevations — measure the drawn areas", "Masonry");
  mat("siding", "wrap-rolls", "House wrap 9' × 150' rolls", C((wrap * 1.1) / 1350), "rolls", "derived", `${wrap} sq ft`, "Weather barrier");
  mat("siding", "wrap-tape", "House wrap seam tape, rolls", C(wrap / 1000), "rolls", "rule", "a roll per 1,000 sq ft", "Weather barrier");
  mat("siding", "trim-boards", "Trim boards 5/4 × 4 fiber cement/PVC, 12' pieces", pieces(q("siding.corners"), 12), "pieces", "derived", `${q("siding.corners")} LF`, "Trim");
  mat("siding", "z-flash", "Z-flashing and head flashing over openings, 10' pieces", pieces(headerLf, 10), "pieces", "derived", "over every window and door head", "Trim");
  const soffitLf = q("siding.soffit");
  mat("siding", "soffit-sheets", `Vented soffit 4×8 sheets (${round(h.roof.overhangIn / 12, 1)}' overhang)`, C((soffitLf * (h.roof.overhangIn / 12) * 1.1) / 32), "sheets", "derived", `${soffitLf} LF × ${h.roof.overhangIn}"`, "Soffit & fascia");
  mat("siding", "fascia", "Fascia 5/4 × 8, 12' pieces", pieces(soffitLf, 12), "pieces", "derived", `${soffitLf} LF`, "Soffit & fascia");
  if (h.porchSqFt) both("siding", "porch-ceiling", "Porch ceilings: T&G or soffit panel with trim", h.porchSqFt, "sq ft", "derived", `${h.porchSqFt} sq ft of covered porch`, "Porches");
  if (h.porchSqFt) both("siding", "columns", "Porch column wraps (12×12 trim boxes)", Math.max(2, C(h.porchSqFt / 60)), "each", "rule", "posts at the porch beams", "Porches");
  mat("siding", "nails", "Siding nails (stainless/galvanized), 5 lb boxes", C(net / 300), "boxes", "rule", "a box per ~300 sq ft", "Siding");
  mat("siding", "caulk", "Paintable sealant for siding and trim joints, tubes", C(net / 120), "tubes", "rule", "a tube per ~120 sq ft", "Trim");

  // ════════════════════ INSULATION ════════════════════
  const walls = q("insulation.walls");
  const attic = q("insulation.attic");
  const floorIns = q("insulation.floor") + q("insulation.floor-garage");
  for (const id of ["insulation.walls", "insulation.attic", "insulation.floor", "insulation.floor-garage"]) set(id, { role: "labor", phase: "Thermal" });
  set("insulation.air-seal", { role: "both", phase: "Air sealing" });
  mat("insulation", "r21", "R-21 kraft batts 15\" × 93\" for 2x6 walls (~77.5 sq ft a bag)", C((walls * 1.05) / 77.5), "bags", "derived", `${walls} sq ft + 5%`, "Thermal");
  mat("insulation", "r49", "R-49 blown fiberglass, attic (~40 sq ft a bag at R-49)", C(attic / 40), "bags", "derived", `${attic} sq ft`, "Thermal", pages.ground);
  if (floorIns) mat("insulation", "r30", "R-30 batts 16\" × 48\" for floors over the crawlspace and garage (~50 sq ft a bag), with supports", C((floorIns * 1.05) / 50), "bags", "derived", `${floorIns} sq ft + 5%`, "Thermal", pages.ground);
  const rims = levels.reduce((a, l) => a + l.perimeterLf, 0);
  both("insulation", "rim", "Rim joist insulation R-21 (batts or spray foam)", round(rims), "linear ft", "derived", "every floor's band joist", "Thermal");
  mat("insulation", "baffles", "Attic baffles (one per truss bay at the eaves)", C(eave / 2), "each", "derived", `${eave} LF of eave at 24" o.c.`, "Thermal", pages.ground);
  both("insulation", "acoustic", "Sound batts R-13 in bathroom and laundry walls", Math.round(fullBaths.length + laundries.length) * 120, "sq ft", "rule", "~120 sq ft of wall per bath and laundry", "Sound");
  mat("insulation", "foam", "Air-sealing foam and fire-block sealant", C((h.livingSqFt + (garage?.areaSqFt ?? 0)) / 400), "each", "rule", "a can per ~400 sq ft", "Air sealing");
  both("insulation", "attic-hatch", "Attic access hatch, insulated and weatherstripped", 1, "each", "rule", "every attic", "Air sealing");

  // ════════════════════ DRYWALL ════════════════════
  const dwWalls = q("drywall.walls");
  const dwCeil = q("drywall.ceilings");
  const fireSep = q("drywall.garage");
  const garageW = garage?.widthFt ?? Math.sqrt(garage?.areaSqFt ?? 0);
  const garageD = garage?.depthFt ?? Math.sqrt(garage?.areaSqFt ?? 0);
  // The garage's other walls (and its ceiling, when no rooms sit over it) — hung and fire-taped.
  const garageRest = garage ? round(Math.max(0, (2 * garageW + garageD) * ground.plateFt + (h.overGarageSqFt ? 0 : garage.areaSqFt))) : 0;
  const garageBoard = fireSep + garageRest;
  if (garage) set("drywall.garage", { role: "labor", phase: "Garage" });
  if (garageRest) labor("drywall", "garage-rest", `Hang and fire-tape the other garage walls${h.overGarageSqFt ? "" : " and ceiling"} (1/2")`, garageRest, "sq ft", "derived", `three garage walls ${round(2 * garageW + garageD)} LF × ${ground.plateFt}'${h.overGarageSqFt ? "" : ` + ceiling ${garage!.areaSqFt} sq ft`}`, "Garage", garage!.pages);
  set("drywall.walls", { role: "labor", phase: "Hang & finish", label: "Hang, tape and finish walls (level 4)" });
  set("drywall.ceilings", { role: "labor", phase: "Hang & finish", label: "Hang, tape and finish ceilings" });
  const wetWalls = (fullBaths.length * 280 + laundries.length * 200) * 0.6;
  const board = dwWalls + dwCeil;
  mat("drywall", "regular", "Drywall 1/2\" regular 4×12 sheets (incl. 12% waste)", C(((board - wetWalls + garageRest) * 1.12) / 48), "sheets", "derived", `${round(board - wetWalls + garageRest)} sq ft${garageRest ? " (incl. the garage's other walls)" : ""}`, "Board");
  mat("drywall", "mr", "Drywall 1/2\" moisture-resistant 4×12 (baths, laundry)", C((wetWalls * 1.12) / 48), "sheets", "rule", "the walls of the baths and laundry outside the tile", "Board");
  if (fireSep) mat("drywall", "typex", "Drywall 5/8\" Type X 4×12 (the garage fire separation)", C((fireSep * 1.1) / 48), "sheets", "derived", `${fireSep} sq ft (IRC R302.6)`, "Board", garage?.pages);
  const allBoard = board + garageBoard;
  mat("drywall", "mud", "Joint compound, 4.5 gal buckets (all-purpose + topping)", C(allBoard / 450), "buckets", "rule", "a bucket per ~450 sq ft at level 4", "Finish");
  mat("drywall", "tape", "Paper joint tape, 500' rolls", C((allBoard * 0.37) / 500), "rolls", "rule", "~370 ft per 1,000 sq ft", "Finish");
  mat("drywall", "bead", "Corner bead (vinyl/paper-faced) 10' pieces", C((allBoard * 0.05) / 10), "pieces", "rule", "~0.05 LF of outside corner per sq ft of board", "Finish");
  mat("drywall", "screws", "Drywall screws 1-1/4\" coarse, 25 lb boxes", C(allBoard / 3000), "boxes", "rule", "a box per ~3,000 sq ft", "Board");
  labor("drywall", "texture", "Texture walls and ceilings (orange peel or knockdown)", round(board), "sq ft", "rule", "common finish — set to smooth if specified", "Finish");

  // ════════════════════ INTERIOR DOORS & TRIM ════════════════════
  set("interior-trim.doors", { role: "labor", phase: "Doors", label: "Hang interior prehung doors" });
  set("interior-trim.base", { role: "labor", phase: "Trim", label: "Install baseboard" });
  set("interior-trim.casing", { role: "labor", phase: "Trim", label: "Install door and window casing" });
  set("interior-trim.stair-rail", { role: "both", phase: "Stairs" });
  const privacy = Math.min(intDoorCount, bedrooms.length + baths.length);
  mat("interior-trim", "doors-mat", "Interior prehung doors, 2-panel shaker, 6'-8\" (sizes per the plans)", intDoorCount, "each", intDoorCount ? "plan" : "rule", "every interior door", "Doors");
  mat("interior-trim", "privacy", "Privacy door sets (bedrooms, baths)", privacy, "each", "rule", "a bedroom or bath door locks", "Hardware");
  mat("interior-trim", "passage", "Passage door sets (halls, closets)", intDoorCount - privacy, "each", "rule", "the other doors", "Hardware");
  mat("interior-trim", "stops", "Door stops (hinge pin or base)", intDoorCount + extSwing, "each", "derived", "every swing door", "Hardware");
  if (garage) both("interior-trim", "fire-door", "House-to-garage door: 1-3/8\" solid core, self-closing (IRC R302.5)", 1, "each", "rule", "the door between the garage and the house", "Doors", garage.pages);
  mat("interior-trim", "base-mat", "Baseboard MDF 3-1/4\" primed, 16' pieces", pieces(q("interior-trim.base"), 16), "pieces", "derived", `${q("interior-trim.base")} LF`, "Trim");
  mat("interior-trim", "casing-mat", "Casing MDF 2-1/4\" primed, 16' pieces", pieces(q("interior-trim.casing"), 16), "pieces", "derived", `${q("interior-trim.casing")} LF`, "Trim");
  const hardFloorPerim = rooms.filter((r) => /hard|tile|lvp|vinyl|laminate/i.test(r.floor ?? "")).reduce((a, r) => a + roomPerimeter(r), 0);
  if (hardFloorPerim) both("interior-trim", "shoe", "Shoe molding at hard floors", round(hardFloorPerim), "linear ft", roomsFrom, "the rooms with hardwood, tile or LVP", "Trim");
  both("interior-trim", "sills", "Window stools or sills (drywall returns elsewhere)", round(h.windows.reduce((a, w) => a + ((w.widthIn ?? 36) / 12 + 0.5) * w.count, 0) || winCount * 3.5), "linear ft", "derived", "every window's width + 6\"", "Trim");
  const shelving = closets.reduce((a, r) => a + (/\bw\.?i\.?c|walk/i.test(r.name) ? 20 : /linen/i.test(r.name) ? 10 : 6), 0) + rooms.filter(isPantry).length * 16 + laundries.length * 6;
  if (shelving) both("interior-trim", "shelving", "Closet, pantry and laundry shelving with rods (ventilated wire or melamine)", shelving, "linear ft", "rule", `walk-in closets ~20 LF, reach-ins 6, linen 10, pantry 16, laundry 6`, "Shelving");
  if (h.voids) both("interior-trim", "guard", "Guard rail at the open-to-below (36\")", h.voids * 24, "linear ft", "rule", "the edge of each two-story opening", "Stairs");
  if (flights) both("interior-trim", "handrail", "Wall handrail with brackets", flights * 14, "linear ft", "derived", "one side of each flight", "Stairs");
  if (fx.gasFireplace) both("interior-trim", "mantel", "Fireplace mantel and surround trim", fx.gasFireplace, "each", "plan", "the gas fireplace", "Finish carpentry");
  const vanities = q("cabinets.vanities") || fullBaths.length + baths.length - fullBaths.length;
  both("interior-trim", "bath-acc", "Bath accessories: towel bars, ring, paper holder, robe hook (set per bath)", baths.length, "sets", roomsFrom, "every bathroom", "Bath accessories");
  both("interior-trim", "mirrors", "Vanity mirrors", vanities, "each", "rule", "one per vanity", "Bath accessories");
  mat("interior-trim", "nails-caulk", "Trim nails, wood filler and paintable caulk", 1, "lot", "rule", "every house", "Trim");

  // ════════════════════ FLOORING ════════════════════
  for (const i of items.filter((x) => x.trade === "flooring" && x.id.startsWith("flooring.floor-"))) {
    const f = i.id.replace("flooring.floor-", "");
    i.role = "labor";
    i.phase = "Install";
    i.label = i.label.replace(/^Flooring — /, "Install flooring — ");
    if (/hardwood/.test(f)) {
      mat("flooring", "hardwood-boxes", "Engineered hardwood, prefinished (~20 sq ft a box, incl. 10% waste)", C((i.qty * 1.1) / 20), "boxes", i.source, `${i.qty} sq ft`, "Materials");
      mat("flooring", "hardwood-underlay", "Hardwood underlayment / vapor sheet, 100 sq ft rolls", C((i.qty * 1.05) / 100), "rolls", i.source, `${i.qty} sq ft`, "Materials");
    } else if (/carpet/.test(f)) {
      mat("flooring", "carpet", "Carpet (incl. 12% seams and waste)", C((i.qty * 1.12) / 9), "sq yd", i.source, `${i.qty} sq ft ÷ 9`, "Materials");
      mat("flooring", "pad", "Carpet pad 8 lb rebond", C((i.qty * 1.08) / 9), "sq yd", i.source, `${i.qty} sq ft ÷ 9`, "Materials");
      mat("flooring", "tack", "Tack strip", round(Math.sqrt(i.qty) * 4 * 1.5), "linear ft", "rule", "the carpeted rooms' perimeters", "Materials");
    } else if (/vinyl|lvp|laminate/.test(f)) {
      mat("flooring", "lvp", "Luxury vinyl plank (~23 sq ft a box, incl. 10% waste)", C((i.qty * 1.1) / 23), "boxes", i.source, `${i.qty} sq ft`, "Materials");
    }
  }
  set("flooring.stair-treads", { role: "both", phase: "Stairs" });
  const floorRooms = rooms.filter((r) => r.floor).length;
  both("flooring", "transitions", "Transitions, reducers and thresholds at finish changes", Math.max(4, C(floorRooms / 2)), "each", "rule", "doorways where the floor finish changes", "Install");

  // ════════════════════ TILE ════════════════════
  const tFloor = q("tile.floor");
  const tWalls = q("tile.walls");
  const tBack = q("tile.backsplash");
  for (const id of ["tile.floor", "tile.walls", "tile.backsplash"]) set(id, { role: "labor", phase: "Set & grout" });
  const showersOnly = fx.shower ?? 0;
  const tubShowers = fx.tubShower ?? 0;
  const surround = fx.gasFireplace ? 30 * fx.gasFireplace : 0;
  if (tFloor) mat("tile", "floor-tile", "Floor tile porcelain (~15 sq ft a box, incl. 12% waste)", C((tFloor * 1.12) / 15), "boxes", "derived", `${tFloor} sq ft`, "Materials");
  if (tWalls) mat("tile", "wall-tile", "Shower and tub wall tile (~10 sq ft a box, incl. 15% waste)", C((tWalls * 1.15) / 10), "boxes", "derived", `${tWalls} sq ft`, "Materials");
  if (tBack) mat("tile", "back-tile", "Backsplash tile (incl. 15% waste)", round(tBack * 1.15), "sq ft", "derived", `${tBack} sq ft`, "Materials");
  if (surround) both("tile", "fireplace", "Fireplace surround and hearth tile", surround, "sq ft", "rule", "~30 sq ft per fireplace", "Set & grout");
  const tileTotal = tFloor + tWalls + tBack + surround;
  if (tileTotal) {
    mat("tile", "thinset", "Modified thinset mortar, 50 lb bags", C(tileTotal / 60), "bags", "derived", "a bag per ~60 sq ft", "Materials");
    mat("tile", "grout", "Grout (sanded/urethane), 25 lb bags", C(tileTotal / 150), "bags", "derived", "a bag per ~150 sq ft", "Materials");
  }
  if (tWalls) mat("tile", "backer", "Cement backer board 3×5 (shower and tub walls)", C((tWalls * 1.1) / 15), "sheets", "derived", `${tWalls} sq ft`, "Prep");
  if (tWalls) mat("tile", "waterproof", "Liquid waterproofing membrane, gallons (two coats, walls and pans)", C((tWalls + showersOnly * 20) / 50), "gallons", "derived", "~50 sq ft a gallon", "Prep");
  if (tFloor) mat("tile", "uncoupling", "Uncoupling membrane under floor tile, 54 sq ft rolls", C((tFloor * 1.1) / 54), "rolls", "derived", `${tFloor} sq ft`, "Prep");
  if (showersOnly) {
    both("tile", "pans", "Shower pans: sloped mortar bed or pre-sloped tray with curb", showersOnly, "each", fxSrc, "every stand-alone shower", "Prep");
    both("tile", "niches", "Shower niches", showersOnly + tubShowers, "each", "rule", "one per shower", "Set & grout");
    both("tile", "glass", "Frameless shower glass door and panel (by glazier)", showersOnly, "each", fxSrc, "every stand-alone shower", "Shower glass");
  }
  if (tileTotal) mat("tile", "edge", "Tile edge trim (Schluter) 8' pieces", C((showersOnly + tubShowers) * 3 + tBack / 10), "pieces", "rule", "shower openings, niches and backsplash edges", "Materials");

  // ════════════════════ CABINETS & COUNTERTOPS ════════════════════
  const kitchenBig = kitchens.some((k) => (k.areaSqFt ?? 0) >= 150);
  for (const i of items.filter((x) => x.trade === "cabinets")) {
    if (i.id.startsWith("cabinets.base-")) Object.assign(i, { role: "material", phase: "Kitchen", label: i.label.replace("Kitchen base cabinets", "Kitchen base cabinets — supply (shaker, soft-close)") });
    else if (i.id.startsWith("cabinets.upper-")) Object.assign(i, { role: "material", phase: "Kitchen", label: "Kitchen wall cabinets — supply (42\")" });
    else if (i.id.startsWith("cabinets.tops-")) Object.assign(i, { role: "material", phase: "Countertops", label: "Countertops — quartz, fabricated (kitchen)" });
    else if (i.id === "cabinets.vanities") Object.assign(i, { role: "material", phase: "Baths", label: "Bathroom vanity cabinets — supply" });
  }
  const baseLf = sumWhere((i) => i.id.startsWith("cabinets.base-"));
  const upperLf = sumWhere((i) => i.id.startsWith("cabinets.upper-"));
  if (kitchenBig) {
    mat("cabinets", "island", "Kitchen island base cabinets — supply (8' with seating overhang)", 8 * kitchens.filter((k) => (k.areaSqFt ?? 0) >= 150).length, "linear ft", "rule", "a kitchen this size has an island", "Kitchen");
    mat("cabinets", "island-top", "Island countertop — quartz, fabricated", 34 * kitchens.filter((k) => (k.areaSqFt ?? 0) >= 150).length, "sq ft", "rule", "8' × 4'-3\" with overhang", "Countertops");
  }
  if (rooms.some(isPantry)) mat("cabinets", "pantry", "Pantry / tall cabinet — supply", 1, "each", "rule", "a pantry on the plans", "Kitchen");
  if (laundries.length) mat("cabinets", "laundry", "Laundry wall cabinets — supply", laundries.length * 6, "linear ft", "rule", "~6 LF over the washer and dryer", "Laundry");
  const boxes = C((baseLf + (kitchenBig ? 8 : 0)) / 2) + C(upperLf / 2.5) + vanities + (rooms.some(isPantry) ? 1 : 0) + C((laundries.length * 6) / 2.5);
  labor("cabinets", "install", "Install cabinets: set, level, fasten, fillers and panels", boxes, "each", "derived", "every cabinet box", "Installation");
  mat("cabinets", "hardware", "Cabinet pulls and knobs", C(boxes * 1.8), "each", "derived", "doors and drawers", "Installation");
  if (upperLf) mat("cabinets", "crown", "Cabinet crown and light rail", round(upperLf * 1.15), "linear ft", "derived", `${upperLf} LF of wall cabinets`, "Kitchen");
  const vanityTop = vanities * 2 * 3.5;
  if (vanities) mat("cabinets", "vanity-tops", "Vanity tops — quartz with backsplash", round(vanityTop), "sq ft", "rule", "~3.5' × 2' per vanity (double vanities longer)", "Countertops");
  // Every top as it stands now — a measured island or vanity top included.
  const topsSf = sumWhere((i) => /^cabinets\.(tops-|island-top$|vanity-tops$)/.test(i.id));
  labor("cabinets", "template", "Template and install countertops", round(topsSf), "sq ft", "derived", "kitchen, island and vanity tops", "Countertops");
  both("cabinets", "cutouts", "Sink and cooktop cutouts, polished", (fx.kitchenSink ?? 0) + (fx.barSink ?? 0) + (fx.lavatory ?? 0) + kitchens.length, "each", "derived", "every sink and the cooktop", "Countertops");
  if (kitchens.length) {
    // Each appliance its own line (allowances — the owner often picks them); their circuits,
    // gas, water and venting are in the electrical, plumbing and HVAC lists.
    const k = kitchens.length;
    const cook = n("gasRange") ? `Gas cooktop/range 36"` : "Induction / electric range or cooktop 30\"–36\"";
    mat("cabinets", "app-cook", `${cook} (allowance)`, k, "each", n("gasRange") ? "plan" : "rule", n("gasRange") ? "a gas cooktop on the plans" : "every kitchen", "Appliances");
    if (kitchenBig) mat("cabinets", "app-oven", "Wall oven / oven-microwave combination (allowance)", k, "each", "rule", "a kitchen this size has a separate oven", "Appliances");
    mat("cabinets", "app-hood", "Range hood, ducted (allowance)", k, "each", "rule", "every cooktop", "Appliances");
    mat("cabinets", "app-dw", "Dishwasher (allowance)", n("dishwasher") || k, "each", h.fixtures.dishwasher ? fxSrc : "rule", "every kitchen", "Appliances");
    mat("cabinets", "app-micro", kitchenBig ? "Microwave drawer / built-in microwave (allowance)" : "Over-the-range microwave (allowance)", k, "each", "rule", "every kitchen", "Appliances");
    mat("cabinets", "app-fridge", "Refrigerator 36\" (allowance)", k, "each", "rule", "every kitchen", "Appliances");
    labor("cabinets", "app-set", "Set, level and connect the kitchen appliances", k * (kitchenBig ? 6 : 5), "each", "derived", "every appliance above", "Appliances");
  }

  // ════════════════════ PAINTING ════════════════════
  const intPaint = q("painting.interior");
  const extPaint = q("painting.exterior");
  set("painting.interior", { role: "labor", phase: "Interior", label: "Prime and paint walls and ceilings (2 finish coats)" });
  set("painting.exterior", { role: "labor", phase: "Exterior", label: "Paint siding, trim, soffit and fascia (2 coats over factory primer)" });
  set("painting.doors", { role: "labor", phase: "Interior", label: "Paint interior doors, casing and base (enamel)" });
  mat("painting", "primer", "PVA drywall primer, gallons", C((intPaint + garageBoard) / 300), "gallons", "derived", `${intPaint + garageBoard} sq ft at ~300 sq ft a gallon`, "Interior");
  mat("painting", "wall-paint", "Interior wall paint, eggshell, gallons (2 coats)", C((dwWalls * 2) / 350), "gallons", "derived", `${dwWalls} sq ft × 2 coats ÷ 350`, "Interior");
  mat("painting", "ceiling-paint", "Ceiling paint, flat, gallons (2 coats)", C((dwCeil * 2) / 350), "gallons", "derived", `${dwCeil} sq ft × 2 coats ÷ 350`, "Interior");
  mat("painting", "trim-paint", "Trim and door enamel, gallons", C((intDoorCount * 40 + (q("interior-trim.base") + q("interior-trim.casing")) * 0.5) * 2 / 350), "gallons", "derived", "doors both sides + base and casing, 2 coats", "Interior");
  mat("painting", "ext-paint", "Exterior acrylic paint, gallons (2 coats)", C((extPaint * 2) / 300), "gallons", "derived", `${extPaint} sq ft × 2 coats ÷ 300`, "Exterior");
  if (garage) labor("painting", "garage", "Prime and paint the garage walls and ceiling", garageBoard, "sq ft", "derived", "the garage drywall", "Interior", garage.pages);
  mat("painting", "sundries", "Caulk, patch, tape, masking, rollers and sundries", 1, "lot", "rule", "every house", "Interior");

  // ════════════════════ PLUMBING ════════════════════
  const FIX: Record<string, { label: string; phase: string }> = {
    toilet: { label: "Toilets — elongated, comfort height, 2-piece, with seat", phase: "Fixtures" },
    lavatory: { label: "Lavatory sinks — undermount, vitreous china", phase: "Fixtures" },
    kitchenSink: { label: "Kitchen sink — 33\" double-bowl undermount stainless", phase: "Fixtures" },
    barSink: { label: "Prep / bar sink — undermount stainless", phase: "Fixtures" },
    laundrySink: { label: "Laundry sink — utility tub", phase: "Fixtures" },
    tub: { label: "Bathtubs — soaking (60\"–72\")", phase: "Fixtures" },
    shower: { label: "Showers — valve body (pressure-balance) for each stand-alone shower", phase: "Valves" },
    tubShower: { label: "Tub/shower — 60\" alcove tub", phase: "Fixtures" },
    dishwasher: { label: "Dishwasher connection kit (braided line, 90° elbow, high loop)", phase: "Connections" },
    washer: { label: "Washer box — recessed, hot/cold valves, 2\" drain", phase: "Boxes" },
    waterHeater: { label: `Water heater${mech?.waterHeater ? ` — ${mech.waterHeater}` : " — 50 gal"}`, phase: "Water heater" },
    hoseBib: { label: "Hose bibs — frost-free, anti-siphon", phase: "Rough-in" },
    iceMaker: { label: "Ice-maker box — recessed valve (refrigerator)", phase: "Boxes" },
    gasRange: { label: "Gas range/cooktop connection: shutoff, flex connector", phase: "Gas" },
    gasFireplace: { label: "Gas fireplace connection: shutoff, flex connector", phase: "Gas" },
  };
  // Every fixture (plumbing.fix-…): the ones drawn, then the ones assumed.
  const fixPages = sheets.some((s) => s.kind === "plumbing") ? sheets.filter((s) => s.kind === "plumbing").map((s) => s.page) : pages.level;
  for (const [k, v] of Object.entries(fx)) {
    if (!v || !FIX[k]) continue;
    const drawn = !!h.fixtures[k];
    mat("plumbing", `fix-${k}`, FIX[k].label, v, "each", drawn ? fxSrc : "rule", drawn ? (fxSrc === "plan" ? "drawn on the plans" : "from the room names (baths, kitchen, laundry)") : "assumed — every house has one", FIX[k].phase, fixPages);
  }
  // Faucets, valves and trim — one per fixture that takes one.
  if (n("lavatory")) mat("plumbing", "lav-faucet", "Lavatory faucets — 8\" widespread with pop-up drain", n("lavatory"), "each", fxSrc, "one per lavatory", "Faucets & trim");
  if (n("kitchenSink")) mat("plumbing", "kitchen-faucet", "Kitchen faucet — single-handle pull-down", n("kitchenSink"), "each", fxSrc, "one per kitchen sink", "Faucets & trim");
  if (disposals) mat("plumbing", "disposal", "Garbage disposal 3/4 HP with air switch or wall switch", disposals, "each", "rule", "assumed at the kitchen sink", "Fixtures");
  if (n("barSink")) mat("plumbing", "bar-faucet", "Prep / bar faucet", n("barSink"), "each", fxSrc, "one per bar sink", "Faucets & trim");
  if (n("laundrySink")) mat("plumbing", "laundry-faucet", "Laundry faucet", n("laundrySink"), "each", fxSrc, "one per laundry sink", "Faucets & trim");
  if (n("tub")) mat("plumbing", "tub-filler", "Tub filler with pressure-balance valve and trim (deck or wall mount)", n("tub"), "each", fxSrc, "one per soaking tub", "Valves");
  if (n("tubShower")) mat("plumbing", "tubshower-valve", "Tub/shower pressure-balance valve with spout, head and trim", n("tubShower"), "each", fxSrc, "one per tub/shower", "Valves");
  if (n("shower")) mat("plumbing", "shower-trim", "Shower trim kits: head, arm, handle, escutcheon", n("shower"), "each", fxSrc, "one per shower valve", "Faucets & trim");
  if (n("shower")) mat("plumbing", "shower-drain", "Shower drains 2\" (or linear drain)", n("shower"), "each", fxSrc, "one per shower", "Rough-in");
  if (n("tub") + n("tubShower")) mat("plumbing", "tub-drain", "Tub drain and overflow kits", n("tub") + n("tubShower"), "each", fxSrc, "one per tub", "Rough-in");
  // Stops, supplies, traps, wax rings — the small parts every fixture needs.
  const stops = n("toilet") + 2 * (n("lavatory") + n("kitchenSink") + n("barSink") + n("laundrySink")) + n("dishwasher");
  mat("plumbing", "stops", "Angle stops 1/4-turn (3/8\" compression)", stops, "each", "derived", "toilets 1, sinks 2, dishwasher 1", "Faucets & trim");
  mat("plumbing", "supplies", "Braided stainless supply lines", stops, "each", "derived", "one per stop", "Faucets & trim");
  const traps = n("lavatory") + n("kitchenSink") + n("barSink") + n("laundrySink");
  mat("plumbing", "traps", "P-trap kits 1-1/2\" and 2\" with trap arms", traps, "each", "derived", "every sink", "Faucets & trim");
  if (n("toilet")) mat("plumbing", "wax", "Toilet wax rings, closet bolts and 3\" closet flanges", n("toilet"), "sets", "derived", "every toilet", "Fixtures");
  if (n("waterHeater")) {
    mat("plumbing", "exp-tank", "Thermal expansion tank 2 gal", n("waterHeater"), "each", "rule", "required with a pressure-reducing valve", "Water heater");
    mat("plumbing", "wh-kit", "Water heater drain pan, T&P discharge line and seismic strap kit", n("waterHeater"), "sets", "rule", "code (seismic straps in the western states)", "Water heater");
    labor("plumbing", "wh-set", "Set and connect the water heater", n("waterHeater"), "each", "derived", "every water heater", "Water heater");
  }
  // Stub-outs: every water and drain stub at a fixture wall, capped and tested.
  const waterStubs = n("toilet") + 2 * (n("lavatory") + n("kitchenSink") + n("barSink") + n("laundrySink") + n("tub") + n("shower") + n("tubShower") + n("washer")) + n("dishwasher") + n("iceMaker");
  const drainStubs = n("toilet") + n("lavatory") + n("kitchenSink") + n("barSink") + n("laundrySink") + n("tub") + n("shower") + n("tubShower") + n("washer");
  labor("plumbing", "water-stubs", "Water stub-outs (hot and cold) at every fixture, capped and pressure-tested", waterStubs, "each", "derived", "toilet 1, sinks/tubs/showers/washer 2, dishwasher and ice maker 1", "Stub-outs");
  labor("plumbing", "drain-stubs", "Drain stub-outs at every fixture, capped", drainStubs, "each", "derived", "every fixture with a drain", "Stub-outs");
  mat("plumbing", "stub-ells", "Stub-out ells / copper stub-outs with brackets", waterStubs, "each", "derived", "one per water stub", "Stub-outs");
  // Pipe: PEX home-runs from a manifold, ABS/PVC drain-waste-vent by size.
  const longSide = Math.sqrt(ground.areaSqFt * 1.5);
  const pex12 = round(waterStubs * 30);
  const pex34 = round(longSide * 2 + 40 + (stories - 1) * 15);
  mat("plumbing", "pex-12", "PEX-A 1/2\" (fixture home-runs), 300' coils", C(pex12 / 300), "rolls", "rule", `${pex12} LF: ~30' per water stub`, "Rough-in");
  mat("plumbing", "pex-34", "PEX-A 3/4\" (mains), 100' coils", C(pex34 / 100), "rolls", "rule", `${pex34} LF: the main and the water heater runs`, "Rough-in");
  mat("plumbing", "manifold", "PEX manifold with valved ports + 1\" main shutoff ball valve", 1, "each", "rule", `${waterStubs}+ ports`, "Rough-in");
  both("plumbing", "prv", "Pressure-reducing valve at the main", 1, "each", "rule", "assumed — city pressure is often over 80 psi", "Rough-in");
  const dwv4 = round(longSide + 15);
  const dwv3 = round(n("toilet") * 12 + stories * 12);
  const dwv2 = round((n("shower") + n("tubShower") + n("kitchenSink") + n("washer") + n("laundrySink")) * 14);
  const dwv15 = round((n("lavatory") + n("tub") + n("barSink")) * 10 + plumbingVents * 18);
  mat("plumbing", "dwv-4", "DWV 4\" ABS/PVC — building drain to the foundation", pieces(dwv4, 10, 0.1), "pieces", "rule", `${dwv4} LF in 10' sticks`, "Underfloor");
  mat("plumbing", "dwv-3", "DWV 3\" ABS/PVC — toilet drains and stacks", pieces(dwv3, 10, 0.1), "pieces", "rule", `${dwv3} LF in 10' sticks`, "Rough-in");
  mat("plumbing", "dwv-2", "DWV 2\" ABS/PVC — showers, kitchen, laundry", pieces(dwv2, 10, 0.1), "pieces", "rule", `${dwv2} LF in 10' sticks`, "Rough-in");
  mat("plumbing", "dwv-15", "DWV 1-1/2\" ABS/PVC — lavatories, tubs and vents", pieces(dwv15, 10, 0.1), "pieces", "rule", `${dwv15} LF in 10' sticks`, "Rough-in");
  mat("plumbing", "fittings", "DWV and PEX fittings, hangers, strapping, cement, nail plates", 1, "lot", "rule", "every house", "Rough-in");
  both("plumbing", "cleanouts", "Cleanouts (base of stacks, building drain)", 2 + stories, "each", "rule", "each stack and the building drain", "Rough-in");
  both("plumbing", "pipe-ins", "Pipe insulation on runs in the crawlspace and unheated spaces", round((pex12 + pex34) * 0.25), "linear ft", "rule", "~25% of the water piping", "Rough-in");
  const roughCount = Object.entries(h.fixtures).filter(([k]) => !["hoseBib", "gasRange", "gasFireplace", "iceMaker"].includes(k)).reduce((a, [, v]) => a + v, 0) + assumed.filter((a) => /sink|dishwasher|washer|water heater/.test(a)).length;
  labor("plumbing", "rough", "Rough-in per fixture: supply, drain, waste and vent", roughCount, "each", fxSrc, `${roughCount} fixture connections (hose bibs, gas and the ice maker are their own lines)`, "Rough-in", fixPages);
  labor("plumbing", "underfloor", "Underfloor / underground drain: building drain and branches to the foundation", dwv4, "linear ft", "rule", "the house's long side + the run to the side sewer", "Underfloor");
  const toSet = n("toilet") + n("lavatory") + n("kitchenSink") + n("barSink") + n("laundrySink") + n("tub") + n("tubShower") + n("shower") + n("dishwasher") + disposals + n("iceMaker");
  labor("plumbing", "finish", "Trim-out (finish): set and connect every fixture, faucet, disposal, dishwasher and ice maker", toSet, "each", "derived", "every fixture and appliance connection", "Trim-out");
  labor("plumbing", "test", "Pressure tests (water and DWV), start-up and inspections", 1, "lot", "rule", "rough and final", "Inspections");
  const gasOutlets = (gasHeat ? 2 : 0) + n("gasRange") + n("gasFireplace");
  if (gasOutlets) {
    labor("plumbing", "gas", "Gas piping rough-in to each appliance, pressure tested", gasOutlets, "each", "plan", [gasHeat ? "furnace and water heater on gas" : "", n("gasRange") ? "gas cooktop/range" : "", n("gasFireplace") ? "gas fireplace" : ""].filter(Boolean).join(", ") + " per the plans", "Gas");
    mat("plumbing", "csst", "Gas pipe CSST 1/2\"–3/4\" with fittings and bonding", round(gasOutlets * 40 + 30), "linear ft", "rule", "~40' per outlet + the meter run", "Gas");
    mat("plumbing", "gas-valves", "Gas shutoff valves and sediment traps", gasOutlets, "each", "derived", "every appliance", "Gas");
  }

  // ════════════════════ ELECTRICAL ════════════════════
  const e = h.electrical;
  const elecSrc = (k: string): TakeoffSource => (e[k] ? "plan" : "rule");
  const gfci = baths.length + kitchens.length * 4 + laundries.length + (garage ? 2 : 0) + 1;
  const exteriorRecept = 4;
  const ruleRecept = Math.round(rooms.reduce((a, r) => a + Math.max(2, C(roomPerimeter(r) / 12)), 0) + kitchens.length * 6 + (garage ? 3 : 0) + exteriorRecept);
  const recept = (e.receptacle ?? 0) + (e.gfci ?? 0) || ruleRecept;
  const threeWay = flights * 2 + stories * 2 + 2 + (garage ? 2 : 0);
  const dimmers = Math.min(rooms.filter((r) => isLiving(r) || isDining(r) || isKitchen(r)).length + 1, 6);
  const ruleSwitch = Math.round(rooms.length * 1.4 + 4);
  const switches = e.switch || Math.max(ruleSwitch, threeWay + dimmers + 4);
  // Light fixtures by kind, room by room.
  const recessed = e.recessed || C(area(isKitchen) / 25 + area(isLiving) / 50 + area(isStairOrHall) / 45 + area(isDining) / 60 + (n("shower") + n("tubShower")) + h.porchSqFt / 45);
  const fans = bedrooms.length + Math.min(2, rooms.filter(isLiving).length);
  const flush = closets.length + laundries.length + rooms.filter(isPantry).length + rooms.filter(isMud).length + rooms.filter(isDen).length + 2;
  const vanityLights = vanities;
  const pendants = (kitchenBig ? 3 : 0) + (rooms.some(isDining) ? 1 : 0) + 1;
  const exterior = e.exteriorLight || 2 + Math.max(0, extSwing - 1) + slidersInGlazing + overheadDoors * 2 + 2;
  const garageLights = garageCars * 2;
  const underCab = C(upperLf / 3);
  const lights = e.light ? (e.light ?? 0) + (e.recessed ?? 0) + (e.exteriorLight ?? 0) : recessed + fans + flush + vanityLights + pendants + exterior + garageLights;
  const smoke = (e.smoke ?? 0) + (e.co ?? 0) || bedrooms.length + stories;
  const bathFans = e.exhaustFan || baths.length;
  const laundryFans = laundries.length;
  labor("electrical", "receptacles", "Receptacles: rough box, wire, set device and plate", recept, "each", elecSrc("receptacle"), e.receptacle ? "electrical plan" : "NEC 210.52 spacing + kitchen counters, garage, exterior", "Devices");
  labor("electrical", "switches", "Switches: rough box, wire, set device and plate", switches, "each", elecSrc("switch"), e.switch ? "electrical plan" : "every room, 3-ways at stairs, halls and two-door rooms", "Devices");
  mat("electrical", "recept-std", "Receptacles 15/20A tamper-resistant (decora)", Math.max(0, recept - gfci - exteriorRecept), "each", "derived", "receptacles less GFCI and exterior", "Devices");
  mat("electrical", "gfci", "GFCI receptacles, tamper-resistant (kitchen, baths, laundry, garage, crawlspace)", gfci, "each", "rule", "NEC 210.8", "Devices");
  mat("electrical", "ext-recept", "Weather-resistant GFCI receptacles with in-use covers (exterior)", exteriorRecept, "each", "rule", "front, back and sides (NEC 210.52(E))", "Devices");
  mat("electrical", "switch-sp", "Switches single-pole (decora)", Math.max(0, switches - threeWay - dimmers - bathFans), "each", "derived", "switches less 3-ways, dimmers and fan timers", "Devices");
  mat("electrical", "switch-3way", "Switches 3-way (stairs, halls, rooms with two entries)", threeWay, "each", "rule", "stairs, halls, great room, garage", "Devices");
  mat("electrical", "dimmers", "LED dimmers (great room, dining, kitchen, primary)", dimmers, "each", "rule", "living and dining spaces", "Devices");
  mat("electrical", "fan-timers", "Bath fan timer switches", bathFans, "each", "derived", "one per bath fan (whole-house ventilation)", "Devices");
  mat("electrical", "plates", "Cover plates (decora), 1–3 gang", recept + switches, "each", "derived", "every device", "Devices");
  mat("electrical", "boxes", "Device boxes, new-work 1- and 2-gang", recept + C(switches * 0.7), "each", "derived", "receptacles + switch locations", "Rough-in");
  mat("electrical", "ceiling-boxes", "Ceiling and wall fixture boxes (fan-rated where fans go)", Math.max(0, lights - recessed - exterior), "each", "derived", "surface, pendant, vanity and fan fixtures", "Rough-in");
  // Fixtures, by kind.
  mat("electrical", "lt-recessed", "Recessed LED wafer lights 4\"/6\" (kitchen, living, halls, showers, porches)", recessed, "each", elecSrc("recessed"), e.recessed ? "electrical plan" : `kitchen ~1 per 25 sq ft, living 1 per 50, halls, one per shower, porches`, "Light fixtures");
  mat("electrical", "lt-fans", "Ceiling fans with light kits (bedrooms, great room)", fans, "each", "rule", "every bedroom + living spaces", "Light fixtures");
  mat("electrical", "lt-flush", "Flush-mount ceiling lights (closets, laundry, pantry, mud, den, attic, crawlspace)", flush, "each", "rule", "every small room + attic and crawlspace", "Light fixtures");
  if (vanityLights) mat("electrical", "lt-vanity", "Vanity light bars (3–4 light)", vanityLights, "each", "rule", "one per vanity", "Light fixtures");
  mat("electrical", "lt-pendants", "Pendants and chandeliers (island, dining, entry)", pendants, "each", "rule", "kitchen island, dining, entry", "Light fixtures");
  mat("electrical", "lt-exterior", "Exterior lights: entry and door sconces, garage coach lights, floods", exterior, "each", elecSrc("exteriorLight"), "every exterior door, two per garage door, two floods", "Light fixtures");
  if (garageLights) mat("electrical", "lt-garage", "Garage LED wraps / shop lights", garageLights, "each", "rule", `two per car bay (${garageCars})`, "Light fixtures");
  if (underCab) mat("electrical", "lt-undercab", "Under-cabinet LED lights", underCab, "each", "derived", `${upperLf} LF of wall cabinets`, "Light fixtures");
  labor("electrical", "lights", "Light fixtures: rough box and wire, hang and connect", lights + underCab, "each", elecSrc("light"), "every fixture above", "Light fixtures");
  // Safety, ventilation, appliances.
  labor("electrical", "smoke", "Smoke / CO alarms, hardwired and interconnected (IRC R314/R315)", smoke, "each", elecSrc("smoke"), e.smoke ? "electrical plan" : "every bedroom, each floor, combination smoke/CO outside sleeping areas", "Safety");
  mat("electrical", "smoke-mat", "Smoke alarms hardwired with battery backup + combination smoke/CO", smoke, "each", elecSrc("smoke"), "as above", "Safety");
  if (garage) both("electrical", "heat-det", "Heat alarm in the attached garage (interconnected)", 1, "each", "rule", "required in some jurisdictions, good practice everywhere — remove if not called for", "Safety", garage.pages);
  if (garage) both("electrical", "ev", "EV-ready circuit in the garage (240V, 40A) with receptacle or charger rough-in", 1, "each", "rule", "standard on new-house specs and required by several state codes — remove if not wanted", "Circuits", garage.pages);
  both("electrical", "bath-fans", "Bath exhaust fans, quiet (80 CFM), wired", bathFans + laundryFans, "each", elecSrc("exhaustFan"), "every bathroom and the laundry (whole-house ventilation)", "Ventilation");
  const dedicated = kitchens.length * 5 + laundries.length * 2 + (electricWh ? 1 : 0) + overheadDoors;
  labor("electrical", "circuits", "Dedicated circuits: range/ovens, dishwasher, disposal, microwave, refrigerator, washer, dryer, water heater, garage doors", dedicated, "each", "rule", `NEC 210.11 / 210.52: kitchen ${kitchens.length * 5}, laundry ${laundries.length * 2}${electricWh ? ", electric water heater 1" : ""}${overheadDoors ? `, openers ${overheadDoors}` : ""}`, "Circuits");
  const systems = sysCount;
  labor("electrical", "hvac-power", "HVAC power: outdoor unit and air-handler circuits, disconnects and whips", systems, "each", "derived", `${systems} system${systems === 1 ? "" : "s"}`, "Circuits");
  mat("electrical", "disconnects", "A/C disconnects 60A with whips", systems, "each", "derived", "one per outdoor unit", "Circuits");
  // Wire, panel, breakers.
  const points = recept + switches + lights + smoke + bathFans + laundryFans;
  const w142 = round(points * 0.6 * 22);
  const w122 = round(points * 0.35 * 25);
  const w143 = round(threeWay * 25 + smoke * 20);
  mat("electrical", "nm-14-2", "NM-B 14-2 (lighting, 15A), 250' rolls", C(w142 / 250), "rolls", "rule", `${w142} LF`, "Wire");
  mat("electrical", "nm-12-2", "NM-B 12-2 (receptacles, kitchen, baths, 20A), 250' rolls", C(w122 / 250), "rolls", "rule", `${w122} LF`, "Wire");
  mat("electrical", "nm-14-3", "NM-B 14-3 (3-ways, smoke interconnect), 250' rolls", C(w143 / 250), "rolls", "rule", `${w143} LF`, "Wire");
  mat("electrical", "heavy-wire", "Appliance and HVAC wire: 10-3, 8-3, 6-3, 6-2 NM/SER", round(dedicated * 15 + systems * 100 + 50), "linear ft", "rule", "dryer, ovens, water heater, outdoor units and air handlers", "Wire");
  const amps = e.panelAmps ?? (!gasHeat && h.livingSqFt > 4000 ? 400 : 200);
  labor("electrical", "service", `Install the ${amps}A service and panel`, 1, "each", e.panelAmps ? "plan" : "rule", e.panelAmps ? "electrical plan" : `${amps}A for this size house${gasHeat ? "" : ", all-electric heat"}`, "Service");
  mat("electrical", "panel", `Main panel ${amps}A, ${amps > 200 ? 60 : 42}-space, with meter base`, 1, "each", e.panelAmps ? "plan" : "rule", "per the load calculation", "Service");
  const generalCircuits = C(h.livingSqFt / 500) + 2 * kitchens.length + baths.length + laundries.length + (garage ? 1 : 0) + 1;
  mat("electrical", "breakers", "Breakers: AFCI/dual-function 15/20A for living circuits, 2-pole for 240V loads", generalCircuits + dedicated + systems * 2, "each", "derived", `${generalCircuits} general + ${dedicated} dedicated + HVAC`, "Service");
  mat("electrical", "grounding", "Grounding electrode system: two ground rods, #4 GEC, water and gas bonding", 1, "sets", "rule", "NEC 250", "Service");
  labor("electrical", "wiring", "Rough wiring: home runs, circuits and panel make-up (whole house)", h.livingSqFt + (garage?.areaSqFt ?? 0), "sq ft", "derived", `living ${h.livingSqFt}${garage ? ` + garage ${garage.areaSqFt}` : ""} sq ft`, "Rough-in");
  // Low voltage.
  const dataPts = bedrooms.length + rooms.filter((r) => isLiving(r) || isDen(r)).length + kitchens.length;
  both("electrical", "data", "Data / TV points (Cat6 + RG6) to a structured media panel", dataPts, "each", "rule", "bedrooms, living spaces, den, kitchen", "Low voltage");
  both("electrical", "media-panel", "Structured media panel with modem/router outlet", 1, "each", "rule", "where the low voltage home-runs land", "Low voltage");
  both("electrical", "doorbell", "Doorbell (video-ready) with chime and transformer", 1, "each", "rule", "the entry", "Low voltage");
  if (overheadDoors) both("electrical", "opener-recept", "Ceiling receptacles for the garage door openers", overheadDoors, "each", "derived", "one per opener", "Devices", garage?.pages ?? pages.ground);
  labor("electrical", "finish", "Trim-out (finish): devices, plates, fixtures, appliances connected, panel labeled", recept + switches + lights + underCab + smoke + bathFans + laundryFans, "each", "derived", "every point above", "Trim-out");
  labor("electrical", "inspect", "Testing (GFCI/AFCI, polarity) and inspections", 1, "lot", "rule", "rough and final", "Inspections");

  // ════════════════════ HVAC ════════════════════
  // Equipment comes in half-ton steps: 4.5 tons on two systems is 2.5 + 2.
  const first = Math.ceil((tons / sysCount) * 2) / 2;
  const split = sysCount > 1 ? ` (${sysCount} systems: ${[first, ...Array(sysCount - 1).fill(Math.max(1.5, round((tons - first) / (sysCount - 1), 1)))].join(" + ")} ton)` : "";
  const heatPump = /heat pump/i.test(mech?.system ?? "") || !gasHeat;
  both("hvac", "system", `${heatPump ? "Heat pump" : "Furnace + A/C"} — ${mech?.system ?? (heatPump ? "ducted air-source heat pump" : "gas furnace with central A/C")}, ${tons} ton${split}: outdoor unit, air handler, coil`, sysCount, "each", mech?.tons || heatLoad ? "plan" : "rule", mech?.tons ? "mechanical plan" : heatLoad ? `design heat load ${heatLoad.toLocaleString("en-US")} Btu/h ÷ 12,000 Btu a ton` : `~800 sq ft a ton on ${h.livingSqFt} sq ft — a Manual J sets the real size`, "Equipment");
  if (sysCount > 1 && statedSystems < 2) ctx.checks.push({ level: "info", text: `${tons} tons is past the largest single residential system (5 tons) — priced as ${sysCount} systems.` });
  if (heatPump) mat("hvac", "heat-strips", "Electric backup heat strips (8–10 kW) in each air handler", sysCount, "each", "rule", "heat pump backup for design days", "Equipment");
  mat("hvac", "lineset", "Refrigerant line sets (insulated copper) with wall sleeves", sysCount * 35, "linear ft", "rule", "~35' per system", "Equipment");
  both("hvac", "pads", "Equipment pads / wall brackets and condensate drains", sysCount, "each", "derived", "every outdoor unit and air handler", "Equipment");
  const supplies = rooms.reduce((a, r) => a + (isCloset(r) && !/\bw\.?i\.?c/i.test(r.name) ? 0 : (r.areaSqFt ?? 0) > 300 ? 3 : (r.areaSqFt ?? 0) > 180 ? 2 : 1), 0);
  const returns = stories + bedrooms.length;
  both("hvac", "ducts", "Duct system: supply runs with boots and registers, returns, trunks, plenums, sealed with mastic", supplies + returns, "each", "derived", `${supplies} supplies + ${returns} returns`, "Distribution");
  mat("hvac", "registers", "Supply registers (floor/ceiling) with boots", supplies, "each", "derived", "1–3 per room by size", "Distribution");
  mat("hvac", "returns", "Return grilles (central + each bedroom) with filter grilles", returns, "each", "derived", "a central return per floor + every bedroom", "Distribution");
  mat("hvac", "flex", "Insulated flex duct R-8, 6\"–8\", 25' bags", C((supplies * 18) / 25), "bags", "derived", `${supplies} supplies × ~18'`, "Distribution");
  mat("hvac", "trunk", "Trunk duct and fittings (sheet metal), per system", round(Math.sqrt(ground.areaSqFt * 1.5) * sysCount), "linear ft", "rule", "the long side of the house per system", "Distribution");
  mat("hvac", "mastic", "Duct mastic and foil tape", C((supplies + returns) / 12), "gallons", "rule", "a gallon per ~12 runs", "Distribution");
  both("hvac", "thermostat", "Programmable / smart thermostat", sysCount, "each", statedSystems ? "plan" : "rule", sysCount > 1 ? "one per system (zone)" : "one zone unless the plans show more", "Controls");
  both("hvac", "fresh-air", "Whole-house ventilation: fresh-air intake (6\"–8\" duct, motorized damper, timer)", sysCount, "each", "rule", "IRC M1505.4 whole-house ventilation, run through the air handler", "Ventilation");
  both("hvac", "bath-ducts", "Bath and laundry fan ducting 4\" to wall/roof caps", bathFans + laundryFans, "each", "derived", "every exhaust fan", "Ventilation");
  if (kitchens.length) both("hvac", "hood-duct", "Range hood duct 6\"–8\" to the exterior with cap (make-up air if over 400 CFM)", kitchens.length, "each", "rule", "every kitchen", "Ventilation");
  if (laundries.length) both("hvac", "dryer-vent", "Dryer vent: 4\" rigid duct, dryer box, wall cap", laundries.length, "each", "rule", "every laundry", "Ventilation");
  if (n("gasFireplace")) both("hvac", "fireplace", "Gas fireplace 42\"–48\" direct-vent: unit, vent kit, blower", n("gasFireplace"), "each", "plan", "the fireplace on the plans", "Fireplace");
  both("hvac", "commission", "Load calculation (Manual J/S/D), start-up, duct leakage test and balancing", 1, "lot", "rule", "energy-code duct leakage test, start-up and balancing", "Start-up");
  both("hvac", "area", "Conditioned area served", h.livingSqFt, "sq ft", "plan", h.livingFrom, "Start-up");

  if (assumed.length) ctx.checks.push({ level: "info", text: `Not drawn on the plans, assumed because every house has them: ${assumed.join(", ")}.` });
}
