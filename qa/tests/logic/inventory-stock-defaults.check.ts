// What a company keeps in stock by default (2026-09-23): the suggestion the
// checklist starts from, one readable rule per trade, over the real standard
// items. Pure, no database.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/inventory-stock-defaults.check.ts
import { defaultStocked, STOCK_DEFAULT_NOTE } from "../../../src/lib/inventoryStockDefaults";
import { presetItems } from "../../../src/lib/inventoryPresets";
import type { TradeId } from "../../../src/lib/inventory";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const stocked = (trade: TradeId, names: string[]) => names.filter((n) => !defaultStocked(trade, n));
const perJob = (trade: TradeId, names: string[]) => names.filter((n) => defaultStocked(trade, n));

check("roof: the small stuff is stocked", stocked("roof", ["Synthetic underlayment", "Ice & water shield · eaves + valleys", "Drip edge · F-style (standard) · 2 in face", "Starter strip · eaves + rakes", "Pipe boot · 1½–3 in", "Ridge vent", "Roofing nails & fasteners", "Sealant, caulk & pipe collars", "Membrane fasteners & seam plates", "Bonding adhesive · membrane"]).length === 0);
check("roof: shingles, membranes and coatings are bought per job", perJob("roof", ["Architectural shingle · 30-yr", "Standing-seam metal", "Clay tile", "TPO 60 mil · mech attached", "EPDM 60 mil · fully adhered", "Cover board · HD polyiso · ½ in", "Ballast stone · #4 washed, 10 psf", "Silicone coating · 10-yr", "Spray foam 1 in · acrylic"]).length === 0);
check("fence: posts, rails, concrete, fasteners, caps and gate hardware are stocked", stocked("fence", ["Line posts · 4×4 pressure-treated pine post (cedar on request) · 8'", "Corner posts · 8'", "Gate posts · heavy-set · 8'", "2×4 cedar rails", "2×4 pressure-treated rails", "Concrete · 60 lb bags", "Gravel backfill · 50 lb bags", "Ring-shank nails · 5 lb boxes", "Screws · 5 lb boxes", "Aluminum ties · 100 ct bags", "Pyramid post caps", "Walk gate kit", "Gate hinge + latch sets"]).length === 0);
check("fence: pickets, panels, fabric and the non-wood systems are bought per job", perJob("fence", ["1×6 western red cedar pickets · 6'", "1×6 pressure-treated pine pickets · 6'", "Vinyl privacy panels · 8' × 6'", "Composite privacy panels · 8' × 6'", "11-ga galvanized steel fabric, 2″ diamond mesh · 6'", "Aluminum ornamental panels · 6' × 6'", "Line posts · 5×5 vinyl post, routed, aluminum-stiffened at gates · 6'", "Line posts · 1⅝″ OD galvanized steel pipe (2⅜″ terminals) · 8'", "Top rail · 1⅜″ OD", "Tension bands", "2×2 kiln-dried cedar mid-bay supports · 6'"]).length === 0);
check("hvac: the truck's parts are stocked", stocked("hvac", ["Condenser fan motor + blade", "Coil cleaner", "UV coil lamp", "Programmable thermostat", "Line set, insulated copper", "Outdoor disconnect + whip", "Condensate pump", "Flame sensor", "Ductless indoor fan motor", "A2L refrigerant-detection sensor + mitigation board for the existing furnace"]).length === 0);
check("hvac: the equipment is ordered per job", perJob("hvac", ["Starter AC18-036 — 3-ton condenser · 18 SEER2 · R-454B", "Starter G96V-040 — 40k BTU furnace · 97% AFUE", "Starter CL-036 — matched evaporator coil", "Starter AH-036 — matched air handler", "0.5-ton ductless system, wall head + outdoor unit (no catalog match — pick a unit)", "50 gal gas tank water heater", "5 kW backup heat kit", "Evaporator coil, cased", "Condenser coil"]).length === 0);

for (const trade of ["roof", "fence", "hvac"] as const) {
  const names = presetItems(trade).map((p) => p.name);
  const on = names.filter((n) => defaultStocked(trade, n)).length;
  check(`${trade}: the standard catalog splits both ways (${on} in stock, ${names.length - on} per job of ${names.length}) and has its one-sentence note`, on > 0 && on < names.length && STOCK_DEFAULT_NOTE[trade].length > 40);
}

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
