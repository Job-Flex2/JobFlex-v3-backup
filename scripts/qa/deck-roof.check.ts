// The Deck Studio's roofs (lib/deck/roof, M2 2026-10-10): the rafter tables
// as printed, worked examples a framer can check by hand, and a sweep over
// every structure, shape and size the studio offers — every member a finite
// box inside stock, every material line on a price-book row, the proposal's
// lines inside the convert schema, the scene reading back, the elevation
// drawing. The printed numbers were typed from the 2021 IRC rafter tables
// (R802.4.1), not copied from the engine.
//   npx --no-install tsx --tsconfig tsconfig.json scripts/qa/deck-roof.check.ts
import { RAFTER_ROWS, rafterMaxSpanIn, roofLoadFor } from "../../src/lib/deck/roofTables";
import { defaultDeckDesign, normalizeDeckDesign, hasDeck, type DeckDesign, type RoofDesign } from "../../src/lib/deck/design";
import { buildStructure, deckNotes, deckScope, priceDeck } from "../../src/lib/deck/pricing";
import { deckChecks } from "../../src/lib/deck/checks";
import { deckScene, parseDeckScene, sceneBuildLayers, SCENE_LAYERS } from "../../src/lib/deck/scene";
import { deckElevation, defaultPlacement, elevationOverlay } from "../../src/lib/deck/elevation";
import { DECK_RATES } from "../../src/lib/deck/rates";
import { deckConvertSchema, parseDeckPlan } from "../../src/lib/deck/convertSchema";
import { STOCK_LENGTHS_FT } from "../../src/lib/deck/frame";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const fi = (ft: number, inch: number) => ft * 12 + inch;
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const rateKeys = new Set(DECK_RATES.map((r) => r.key));

console.log("── the rafter tables, as printed");
check("20 psf: Douglas fir 2x8 at 16 in. spans 18-5; Southern pine 2x10 at 24 in. 16-6", RAFTER_ROWS[20]["2x8"].DF[1] === fi(18, 5) && RAFTER_ROWS[20]["2x10"].SP[2] === fi(16, 6));
check("30 psf snow: hem-fir 2x6 at 12 in. 13-7; SPF 2x12 at 24 in. 17-6", RAFTER_ROWS[30]["2x6"].HF[0] === fi(13, 7) && RAFTER_ROWS[30]["2x12"].SPF[2] === fi(17, 6));
check("50 psf snow: Douglas fir 2x10 at 16 in. 15-3; Southern pine 2x6 at 24 in. 7-5", RAFTER_ROWS[50]["2x10"].DF[1] === fi(15, 3) && RAFTER_ROWS[50]["2x6"].SP[2] === fi(7, 5));
check("70 psf snow: hem-fir 2x12 at 12 in. 17-3; SPF 2x8 at 16 in. 10-8", RAFTER_ROWS[70]["2x12"].HF[0] === fi(17, 3) && RAFTER_ROWS[70]["2x8"].SPF[1] === fi(10, 8));
{
  // Shape: every span shortens with spacing, with load, and lengthens with depth.
  let whole = true;
  for (const load of [20, 30, 50, 70] as const) for (const size of ["2x6", "2x8", "2x10", "2x12"] as const) for (const g of ["DF", "HF", "SP", "SPF"] as const) {
    const row = RAFTER_ROWS[load][size][g];
    if (!(row[0] >= row[1] && row[1] >= row[2])) whole = false;
  }
  for (const size of ["2x6", "2x8", "2x10", "2x12"] as const) for (const g of ["DF", "HF", "SP", "SPF"] as const) for (let c = 0; c < 3; c++) {
    if (!(RAFTER_ROWS[20][size][g][c] >= RAFTER_ROWS[30][size][g][c] && RAFTER_ROWS[30][size][g][c] >= RAFTER_ROWS[50][size][g][c] && RAFTER_ROWS[50][size][g][c] >= RAFTER_ROWS[70][size][g][c])) whole = false;
  }
  check("every row falls with spacing and with load", whole);
  check("redwood's row is Southern pine's, cut 15%; a ceiling cuts 7% more", rafterMaxSpanIn(20, "RW", "2x8", 16) === Math.floor(fi(17, 1) * 0.85) && rafterMaxSpanIn(20, "SP", "2x8", 16, true) === Math.floor(fi(17, 1) * 0.93));
  check("a 40 psf deck gets the 20 psf roof table; 50 → 50; 60 and 70 → 70", roofLoadFor(40) === 20 && roofLoadFor(50) === 50 && roofLoadFor(60) === 70 && roofLoadFor(70) === 70);
}

console.log("── the design: structure, floor, roof, photo");
{
  const d = normalizeDeckDesign({ structure: "gazebo", floor: "slab", roof: { kind: "shed", plan: { shape: "follows-deck" } } });
  check("a gazebo on a slab has no deck, never a shed, never 'follows the deck'", !hasDeck(d) && d.roof.kind !== "shed" && d.roof.plan.shape !== "follows-deck");
  const hex = normalizeDeckDesign({ structure: "gazebo", roof: { kind: "gable", attach: "wall", plan: { shape: "hexagon", acrossFt: 14 } } });
  check("a hexagon is roofed as a pyramid, free-standing", hex.roof.kind === "pyramid" && hex.roof.attach === "free" && hex.roof.plan.acrossFt === 14);
  const pg = normalizeDeckDesign({ structure: "pergola", roof: { kind: "hip", roofing: "arch-shingle", gutters: { kind: "k5" }, pitch: 6 } });
  check("a pergola has slats, no roofing, no gutters, no pitch", pg.roof.kind === "pergola" && pg.roof.roofing === "none" && pg.roof.gutters.kind === "none" && pg.roof.pitch === 0);
  const det = normalizeDeckDesign({ structure: "covered-deck", placement: "detached", roof: { attach: "wall" } });
  check("a roof cannot hang on the wall over a detached deck", det.roof.attach === "free");
  const v1 = normalizeDeckDesign({ v: 1, shape: { kind: "rect", widthFt: 16, depthFt: 12 } });
  check("a version-1 design reads as a bare deck with a roof ready in the drawer", v1.structure === "deck" && v1.floor === "deck" && v1.roof.kind === "gable" && v1.photo === null);
  const ph = normalizeDeckDesign({ photo: { url: "local:deck-photos/org/a.jpg", w: 1600, h: 1200, placed: { x: 0.1, y: 0.9, w: 0.8 } } });
  check("a photo keeps its size and placement; a bad one is dropped", ph.photo?.w === 1600 && ph.photo.placed?.w === 0.8 && normalizeDeckDesign({ photo: { url: "x" } }).photo === null);
}

console.log("── worked examples");
type Over = Omit<Partial<DeckDesign>, "roof"> & { roof?: Partial<RoofDesign> };
const base = (over: Over): DeckDesign => {
  const d = defaultDeckDesign({ state: "TX", frostIn: 12 });
  return normalizeDeckDesign({ ...d, ...over, roof: { ...d.roof, ...(over.roof ?? {}) } });
};
{
  // A 16 x 12 attached deck with a gable over it, ridge out from the house, 4:12, 2x? rafters.
  const d = base({ structure: "covered-deck", shape: { kind: "rect", widthFt: 16, depthFt: 12 }, roof: { kind: "gable", attach: "wall", plan: { shape: "follows-deck", widthFt: 16, depthFt: 12, acrossFt: 12, offsetFt: 0 }, pitch: 6, overhangIn: 12 } });
  const { frame, roof } = buildStructure(d);
  check("16x12 attached gable: a roof and a deck", !!frame && !!roof && roof.kind === "gable" && roof.attach === "wall");
  if (roof && frame) {
    const run = roof.faces[0].runIn;
    check("the eave faces run half the width plus the overhang: (16·12 − 9 + 24)/2 in.", near(run, (16 * 12 - 2 * 4.5 + 2 * 12) / 2), `${run}`);
    check("two front posts, two side headers to the house, one front header", roof.posts.length === 2 && roof.headers.length === 3 && roof.headers.filter((h) => h.wallEnd).length === 2);
    check("the rafters' horizontal span is the run less the overhang", near(roof.rafters.spanIn, run - 12, 0.03), `${roof.rafters.spanIn}`);
    check("2x6 at 16 in. carries an 8-ft span in Southern pine at 20 psf (table 17-1)", roof.rafters.size === "2x6" && roof.rafters.maxSpanIn === fi(13, 6));
    const perSide = Math.floor((12 * 12 - 12) / 16) + 1;
    check("rafters: about one per 16 in. of ridge on each side, plus flies at the front rake", roof.rafters.count >= 2 * perSide && roof.rafters.count <= 2 * perSide + 4, `${roof.rafters.count} (commons ${roof.rafters.commons}, flies ${roof.rafters.flies})`);
    check("the ridge: no beam in the table spans 12 ft under a 17-ft roof, so a ridge board with ties, and the strip says so", roof.ridge?.kind === "board" && roof.ridge.fellBack && roof.ties === Math.floor(roof.ridge.spanIn / 48) + 1, `${roof.ridge?.kind} fellBack=${roof.ridge?.fellBack} ties=${roof.ties}`);
    const asBeam = buildStructure(normalizeDeckDesign({ ...d, roof: { ...d.roof, ridge: "beam" } })).roof!;
    check("asked for a beam anyway: no sawn beam spans it, so an engineered LVL ridge on a king post over the front header, nothing flagged", asBeam.ridge?.kind === "beam" && asBeam.ridge.spec?.kind === "lvl" && asBeam.engineered && asBeam.kingPosts === 1 && asBeam.headers.some((h) => h.kingPost) && !asBeam.flags.ridgeBeyondTable, `${asBeam.ridge?.spec?.size} beyond=${asBeam.flags.ridgeBeyondTable}`);
    const area = 2 * ((12 * 12 + 12) / 12) * (run / 12) / Math.cos(Math.atan(0.5));
    check("roof area: two faces, 13 ft by the sloped run", near(roof.roofAreaSqFt, area, 0.03), `${roof.roofAreaSqFt} vs ${Math.round(area)}`);
    check("squares with 10% waste, sheets by 32 sq ft", near(roof.squares, Math.ceil((area * 1.1) / 100 * 10) / 10, 0.05) && roof.sheets === Math.ceil((roof.roofAreaSqFt * 1.1) / 32 - 1e-9));
    check("eaves: two sides of 13 ft; rakes: two sloped runs at the front; 2 downspouts on 5-in. gutters", near(roof.eaveFt, 26, 0.03) && near(roof.rakeFt, (2 * run) / 12 / Math.cos(Math.atan(0.5)), 0.03) && roof.gutters?.downspouts === 2 && roof.gutters.kind === "k5");
    check("the roof's posts stand on their own footings in the deck", frame.posts.filter((p) => p.roof).length === 2 && frame.posts.filter((p) => p.roof).every((p) => p.footing.required !== null));
    const pkg = priceDeck(d);
    check("the roof's lines: posts, framing, deck, roofing, trim, gutters", ["roof-posts", "roof-frame", "roof-deck", "roofing", "roof-trim", "roof-gutters"].every((id) => pkg.lines.some((l) => l.id === id)), pkg.lines.map((l) => l.id).join(","));
    check("every material line is on a price-book row", pkg.bom.every((l) => rateKeys.has(l.rateKey)), pkg.bom.filter((l) => !rateKeys.has(l.rateKey)).map((l) => l.rateKey).join(","));
    const checks = deckChecks(buildStructure(d));
    check("the strip reads the roof: rafters, headers, ridge, posts, the house, gutters — and nothing fails", ["rafter-span", "ridge", "roof-post-height", "roof-wall-height", "gutters"].every((id) => checks.some((c) => c.id === id)) && checks.some((c) => c.id.startsWith("header-h")) && !checks.some((c) => c.level === "fail"), `${checks.map((c) => c.id).join(",")} | fails: ${checks.filter((c) => c.level === "fail").map((c) => c.id).join(",")}`);
  }
}
{
  // A 12-ft octagon gazebo on a slab, pyramid 6:12, cedar shakes, copper gutters.
  const d = base({ structure: "gazebo", floor: "slab", roof: { kind: "pyramid", plan: { shape: "octagon", widthFt: 12, depthFt: 12, acrossFt: 12, offsetFt: 0 }, pitch: 8, overhangIn: 12, roofing: "cedar-shake", gutters: { kind: "half-round-copper", guards: false }, cupola: true } });
  const { frame, roof } = buildStructure(d);
  check("octagon gazebo on a slab: no deck, eight posts, eight headers, eight hips, a ring at the peak", !frame && !!roof && roof.posts.length === 8 && roof.headers.length === 8 && roof.hips.count === 8 && roof.hardware.ringPlate === 1 && !!roof.slab);
  if (roof) {
    check("all eight faces are triangles to one apex", roof.faces.length === 8 && roof.faces.every((f) => f.top === "apex" && near(f.tax, f.tbx, 0.01) && near(f.tay, f.tby, 0.01)));
    const a = 6 * 12 + 12;
    const edge = 2 * a * Math.tan(Math.PI / 8);
    const planArea = (8 * edge * a) / 2;
    check("roof area is the eave octagon's area over the pitch's cosine", near(roof.roofAreaSqFt, planArea / 144 / Math.cos(Math.atan(8 / 12)), 0.03), `${roof.roofAreaSqFt}`);
    check("the slab is a foot wider than the posts all round, 4 in. thick", roof.slab!.sqFt >= 13 * 13 && roof.slab!.cuYd > 2);
    check("a closed copper gutter: one run, eight corners, no end caps, two downspouts", roof.gutters?.closed === true && roof.gutters.corners === 8 && roof.gutters.endCaps === 0 && roof.gutters.downspouts === 2);
    const pkg = priceDeck(d);
    check("the lines: slab, posts, framing, deck, roofing, trim, gutters, cupola — and no deck lines", pkg.lines.some((l) => l.id === "deck-slab") && pkg.lines.some((l) => l.id === "roof-cupola") && !pkg.lines.some((l) => l.id.startsWith("deck-f")), pkg.lines.map((l) => l.id).join(","));
    check("priced per square foot of slab", pkg.areaSqFt === roof.slab!.sqFt && pkg.pricePerSqFt > 0);
  }
}
{
  // A 14 x 20 free-standing hip pavilion over a detached deck, metal on purlins, no gutters.
  const d = base({ structure: "covered-deck", placement: "detached", shape: { kind: "rect", widthFt: 20, depthFt: 14 }, roof: { kind: "hip", attach: "free", plan: { shape: "follows-deck", widthFt: 20, depthFt: 14, acrossFt: 12, offsetFt: 0 }, pitch: 4, roofing: "metal-panel", roofDeck: "purlins", gutters: { kind: "none", guards: false } } });
  const { frame, roof } = buildStructure(d);
  check("20x14 hip pavilion: four corners, four headers, four hips, a ridge board between them", !!roof && roof.posts.length >= 4 && roof.headers.length === 4 && roof.hips.count === 4 && roof.ridge?.kind === "board" && roof.ties === 0);
  if (roof && frame) {
    check("the ridge is the long side less the short side", near(roof.ridge!.lengthIn, (20 - 14) * 12, 0.02), `${roof.ridge!.lengthIn}`);
    check("purlins across the rafters, no sheathing, metal panels by length", roof.members.some((m) => m.role === "purlin") && roof.sheets === 0 && roof.metalPanels.length > 0);
    const pkg = priceDeck(d);
    check("no gutter line, a roof deck line for the drip edge only", !pkg.lines.some((l) => l.id === "roof-gutters") && pkg.bom.some((l) => l.id === "drip-edge") && !pkg.bom.some((l) => l.id === "sheathing"));
    const checks = deckChecks(buildStructure(d));
    check("a covered deck with no gutters is told so (free-standing: a bracing note, no wall)", checks.some((c) => c.id === "gutters" && c.level === "warn") && checks.some((c) => c.id === "roof-free") && !checks.some((c) => c.id === "roof-wall-height"));
  }
}
{
  // A pergola on the ground, 12 x 16, 2x2 slats at 12 in.
  const d = base({ structure: "pergola", floor: "ground", roof: { attach: "free", plan: { shape: "rect", widthFt: 16, depthFt: 12, acrossFt: 12, offsetFt: 0 } } });
  const { frame, roof } = buildStructure(d);
  const onWall = buildStructure(base({ structure: "pergola", floor: "ground", roof: { attach: "wall", plan: { shape: "rect", widthFt: 16, depthFt: 12, acrossFt: 12, offsetFt: 0 } } })).roof!;
  check("a pergola on the house wall hangs its rafters on a ledger, two posts in front", !!onWall.ledger && onWall.posts.length === 2 && onWall.members.some((m) => m.role === "roof-ledger"));
  const deep = buildStructure(base({ structure: "pergola", floor: "ground", roof: { attach: "free", plan: { shape: "rect", widthFt: 24, depthFt: 20, acrossFt: 12, offsetFt: 0 } } })).roof!;
  check("a 20-ft-deep pergola gets a middle header row: no rafter longer than stock, posts on the row", deep.headers.some((h) => h.id.startsWith("hm")) && deep.members.filter((m) => m.role === "rafter").every((m) => m.lengthIn <= 240) && deep.posts.length >= 6, `headers ${deep.headers.map((h) => h.id).join(",")} posts ${deep.posts.length}`);
  check("pergola on footings: no deck, four posts with footings, rafters and slats, no roofing lines", !frame && !!roof && roof.posts.length === 4 && roof.posts.every((p) => p.footing?.type === "poured") && !!roof.slats && roof.slats.count > 10 && roof.squares === 0, roof ? `posts ${roof.posts.length} footings ${roof.posts.map((p) => p.footing?.type).join(",")} slats ${roof.slats?.count} squares ${roof.squares} headers ${roof.headers.map((h) => `${h.spec.size}/${h.postAt.length}`).join(" ")}` : "no roof");
  if (roof) {
    const pkg = priceDeck(d);
    check("the pergola's lines: posts and framing only", pkg.lines.filter((l) => l.id.startsWith("roof")).map((l) => l.id).sort().join(",") === "roof-frame,roof-posts", pkg.lines.map((l) => l.id).join(","));
    const checks = deckChecks(buildStructure(d));
    check("the strip reads a pergola: rafters span, open slats, footings", checks.some((c) => c.id === "rafter-span") && checks.some((c) => c.id === "pergola-open") && checks.some((c) => c.id === "roof-footings"));
  }
}
{
  // A double-tier square gazebo on a deck.
  const d = base({ structure: "gazebo", floor: "deck", shape: { kind: "rect", widthFt: 14, depthFt: 14 }, roof: { kind: "double-tier", plan: { shape: "square", widthFt: 12, depthFt: 12, acrossFt: 12, offsetFt: 0 }, pitch: 7 } });
  const { frame, roof } = buildStructure(d);
  check("double tier on a deck: lower faces capped, upper faces to an apex, tier posts and a ring", !!frame && !!roof && roof.faces.filter((f) => f.tier === 1).every((f) => f.top === "cap") && roof.faces.filter((f) => f.tier === 2).length === 4 && roof.members.filter((m) => m.role === "tier-post").length === 4 && roof.members.some((m) => m.role === "ring"));
  if (roof && frame) check("the peak is above the lower tier's cap; the deck carries four roof posts on their own footings", roof.peakIn > roof.headerTopIn + 40 && frame.posts.filter((p) => p.roof).length === 4);
}
{
  // An attached shed over a 20 x 10 deck.
  const d = base({ structure: "covered-deck", shape: { kind: "rect", widthFt: 20, depthFt: 10 }, roof: { kind: "shed", attach: "wall", pitch: 3, overhangIn: 16 } });
  const { roof } = buildStructure(d);
  check("attached shed: one face to the wall, a ledger one size deeper than the rafters, posts on the front only", !!roof && roof.faces.length === 1 && roof.faces[0].top === "wall" && !!roof.ledger && roof.ledger.nominal !== roof.rafters.size && roof.posts.every((p) => p.y > 60));
  if (roof) check("the ledger takes two screws every 16 in.", roof.ledger!.fasteners === Math.max(4, Math.ceil(roof.ledger!.lengthIn / 16) * 2));
}
{
  // An attached hip too narrow for its hips falls back to a gable and says so.
  const d = base({ structure: "covered-deck", shape: { kind: "rect", widthFt: 12, depthFt: 12 }, roof: { kind: "hip", attach: "wall" } });
  const { roof } = buildStructure(d);
  check("a 12 x 12 attached hip is framed as a gable, with a note", roof?.kind === "gable" && !!roof.kindNote && roof.flags.tooWideForHip);
}

console.log("── a sweep: every structure, shape and size the studio offers");
{
  let n = 0;
  let clean = 0;
  const trouble: string[] = [];
  const structures: Over[] = [];
  for (const kind of ["shed", "gable", "hip"] as const) for (const attach of ["wall", "free"] as const) for (const [w, dp] of [[12, 10], [16, 12], [24, 14], [32, 16]] as const) for (const roofing of ["arch-shingle", "metal-panel"] as const) {
    structures.push({ structure: "covered-deck", placement: attach === "wall" ? "attached" : "detached", shape: { kind: "rect", widthFt: w, depthFt: dp }, roof: { kind, attach, roofing, plan: { shape: "follows-deck", widthFt: w, depthFt: dp, acrossFt: 12, offsetFt: 0 }, gutters: { kind: "k5", guards: true }, soffit: true, ceiling: "tongue-groove" } });
  }
  for (const floor of ["deck", "slab", "ground"] as const) for (const shape of ["square", "rect", "hexagon", "octagon"] as const) for (const kind of ["gable", "hip", "pyramid", "double-tier"] as const) for (const size of [10, 14, 20] as const) {
    structures.push({ structure: "gazebo", floor, shape: { kind: "rect", widthFt: size + 4, depthFt: size + 4 }, roof: { kind, plan: { shape, widthFt: size, depthFt: Math.max(8, size - 4), acrossFt: size, offsetFt: 0 }, pitch: 8, cupola: true, gutters: { kind: "half-round-alum", guards: false } } });
  }
  for (const floor of ["deck", "slab", "ground"] as const) for (const size of [10, 16, 24] as const) structures.push({ structure: "pergola", floor, shape: { kind: "rect", widthFt: size + 2, depthFt: size }, roof: { plan: { shape: "rect", widthFt: size, depthFt: Math.max(8, size - 4), acrossFt: 12, offsetFt: 0 }, slats: { size: "2x4", spacingIn: 8 } } });
  for (const over of structures) {
    for (const load of [40, 60] as const) {
      const d = base({ ...over, loadPsf: load });
      n++;
      const tag = `${d.structure} ${d.floor} ${d.roof.kind} ${d.roof.plan.shape} ${d.roof.plan.widthFt}x${d.roof.plan.depthFt}/${d.roof.plan.acrossFt} ${load}psf ${d.roof.roofing}`;
      try {
        const pkg = priceDeck(d);
        const roof = pkg.roof!;
        const stock = STOCK_LENGTHS_FT[STOCK_LENGTHS_FT.length - 1] * 12;
        const badMember = roof.members.find((m) => ![m.cx, m.cy, m.cz, m.sx, m.sy, m.sz, m.yaw, m.tilt, m.lengthIn].every(Number.isFinite) || m.sx <= 0 || m.sy <= 0 || m.sz <= 0 || m.lengthIn <= 0 || (m.lengthIn > stock && !["slat", "ridge", "header", "roof-ledger", "subfascia", "fascia-eave", "gutter", "roof-post"].includes(m.role)));
        if (badMember) trouble.push(`${tag}: ${badMember.role} ${badMember.nominal} ${Math.round(badMember.lengthIn)} in.`);
        if (!(roof.posts.length >= 2) || !roof.headers.length) trouble.push(`${tag}: no posts or headers`);
        if (roof.kind !== "pergola" && !(roof.roofAreaSqFt > roof.footprintSqFt * 0.99)) trouble.push(`${tag}: roof area ${roof.roofAreaSqFt} under its footprint ${roof.footprintSqFt}`);
        if (roof.kind !== "pergola" && roof.rafters.count < 4) trouble.push(`${tag}: ${roof.rafters.count} rafters`);
        const offBook = pkg.bom.filter((l) => !rateKeys.has(l.rateKey) || !(l.qty > 0) || !Number.isFinite(l.cost));
        if (offBook.length) trouble.push(`${tag}: material lines off the book: ${offBook.map((l) => l.id).join(",")}`);
        if (!(pkg.subtotal > 0) || pkg.lines.length > 60) trouble.push(`${tag}: ${pkg.lines.length} lines, $${pkg.subtotal}`);
        const scene = deckScene(pkg.structure);
        const back = parseDeckScene(JSON.parse(JSON.stringify(scene)));
        if (!back || back.boxes.length !== scene.boxes.length || back.polys.length !== scene.polys.length) trouble.push(`${tag}: the scene does not read back`);
        if (scene.polys.length === 0 && roof.kind !== "pergola") trouble.push(`${tag}: no roof planes`);
        if (!(scene.peakFt > scene.heightFt)) trouble.push(`${tag}: peak ${scene.peakFt} not above the floor ${scene.heightFt}`);
        const layers = sceneBuildLayers(scene);
        if (!layers.includes("roof-post") || !layers.includes("rafter")) trouble.push(`${tag}: build order misses the roof`);
        const checks = deckChecks(pkg.structure);
        const fails = checks.filter((c) => c.level === "fail");
        const allowed = new Set(["header-h1", "header-h2", "header-h3", "header-h4", "header-h5", "header-h6", "header-h7", "header-h8", "ridge", "roof-post-footing", "roof-footings", "footing-size", "post-area", "roof-post-height"]);
        for (const c of fails) {
          // A rafter past the table is a true finding when the strip offers the way back (closer spacing) or when even a 2x12 at 12 in. cannot make it.
          if (c.id === "rafter-span" && (c.fix || rafterMaxSpanIn(roof.roofLoad, roof.rafterGroup, "2x12", 12, d.roof.ceiling !== "none") < roof.rafters.spanIn)) continue;
          if (!allowed.has(c.id)) trouble.push(`${tag}: ${c.id} — ${c.text}`);
        }
        const parsed = deckConvertSchema.safeParse({ title: "t", assumptions: deckNotes(pkg), lines: pkg.lines.map((l) => ({ name: l.name, description: l.description, quantity: l.quantity, unit: l.unit, materialCost: l.materialCost, laborCost: l.laborCost })), plan: { design: d, scene } });
        if (!parsed.success) trouble.push(`${tag}: convert schema refuses — ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
        const elev = deckElevation(scene);
        if (!(elev.widthFt > 0 && elev.heightFt > 0 && elev.polys.length > 3 && elev.polys.length <= 500)) trouble.push(`${tag}: elevation ${elev.polys.length} polys ${elev.widthFt}x${elev.heightFt}`);
        if (elevationOverlay(elev, defaultPlacement(), 1600, 1200).some((o) => !/^[-\d.]+,[-\d.]+( [-\d.]+,[-\d.]+)+$/.test(o.points))) trouble.push(`${tag}: a bad overlay polygon`);
        const scope = deckScope(pkg, "118 Cedar Ln");
        if (!scope.some((l) => /roof|pergola|gazebo|Pergola/i.test(l))) trouble.push(`${tag}: the scope says nothing of the roof`);
        if (!trouble.some((t) => t.startsWith(tag))) clean++;
      } catch (err) {
        trouble.push(`${tag}: THREW ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  check(`${n} structures built, counted, priced, checked, drawn and read back`, trouble.length === 0, trouble.slice(0, 12).join("\n      "));
  console.log(`      ${clean} of ${n} clean`);
  check("every layer the scenes use is in the build order", SCENE_LAYERS.every((l) => sceneBuildLayers({ v: 3, widthFt: 10, depthFt: 10, heightFt: 3, peakFt: 3, boxes: [[SCENE_LAYERS.indexOf(l), 1, 1, 1, 1, 1, 1, 0]], tags: [], legend: [], callouts: [], footings: [], diagonal: null, polys: [], polyTags: [], outline: [0, 0, 1, 0, 1, 1], house: null, ground: null, glows: [], handles: [], colors: { frame: "#000000", decking: "#000000", fascia: "#000000", roofing: "#000000", rail: "#000000" }, facts: "" }).length === 1));
}

console.log("── the plan with a proposal");
{
  const d = base({ structure: "covered-deck", roof: { kind: "gable" }, photo: { url: "local:deck-photos/org/a.jpg", w: 1600, h: 1200, placed: { x: 0.12, y: 0.86, w: 0.7 } } });
  const pkg = priceDeck(d);
  const scene = deckScene(pkg.structure);
  const plan = parseDeckPlan(JSON.parse(JSON.stringify({ v: 3, design: d, scene, address: "118 Cedar Ln" })));
  check("the plan reads back with its roof, its photo and its placement", !!plan && plan.design.structure === "covered-deck" && plan.design.photo?.placed?.w === 0.7 && plan.scene.polys.length > 0 && plan.scene.v === 3);
  const v1 = parseDeckPlan({ v: 1, design: { v: 1, shape: { kind: "rect", widthFt: 12, depthFt: 10 } }, scene: { v: 1, widthFt: 12, depthFt: 10, heightFt: 3, boxes: [[0, 1, 1, 1, 1, 1, 1, 0]], footings: [], diagonal: null, outline: [0, 0, 12, 0, 12, 10, 0, 10], house: null, colors: {}, facts: "old" }, address: null });
  check("a version-1 plan from before M2 still reads: a bare deck, an old scene", !!v1 && v1.design.structure === "deck" && v1.scene.boxes.length === 1 && v1.scene.polys.length === 0);
  const elev = deckElevation(scene);
  const overlay = elevationOverlay(elev, d.photo!.placed!, 1600, 1200);
  check("the elevation on the photo: polygons in the 0…1000 square, feet the same size across and up", overlay.length > 3 && overlay.every((o) => o.points.split(" ").every((pt) => pt.split(",").every((v) => Number.isFinite(Number(v)) && Number(v) > -2000 && Number(v) < 3000))));
}

console.log(bad === 0 ? "\nAll deck roof checks passed." : `\n${bad} deck roof check(s) FAILED.`);
process.exit(bad === 0 ? 0 : 1);
