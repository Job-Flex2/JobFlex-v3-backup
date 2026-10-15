// Which contracts get the roofing change-order preset (tsx, no framework):
//   npx tsx qa/tests/logic/changeOrders.check.ts
// The plywood / sheathing type belongs to roofing jobs only. It used to be
// offered — and pre-selected — on a composite fence and a kitchen, because a
// roof FAMILY word ("composite", "cedar", "shaker") was read as roofing.
import { inferRoofFamily, isRoofingProposal } from "../../../src/lib/changeOrders/types";

let failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log("ok  ", name);
  else {
    failed += 1;
    console.log("FAIL", name, detail ?? "");
  }
}

const roof = { title: "Patel Residence — Roof Replacement", lineNames: ["Tear-off & disposal", "Architectural shingles (30-yr)", "Ridge vent system", "Ice & water shield"] };
const fence = { title: "Composite fence · 106 lf", lineNames: ["Line posts - 4 x 4 x 8 ft, 8 ft centres", "Concrete - 2 bags per post hole", "Rails - 3 per bay", "Composite pickets - 6 ft", "Install labor"] };
const cedarFence = { title: "Cedar privacy fence", lineNames: ["Cedar pickets 6 ft", "Pressure-treated posts", "Gate hardware"] };
const kitchen = { title: "Diaz — Kitchen Remodel Quote", lineNames: ["Shaker cabinetry — painted", "Quartz counters — 3cm", "Island — seating for 4"] };
const tileRoofNoTitle = { title: "Ortega residence", lineNames: ["Concrete tile roof — remove and replace", "Underlayment · synthetic"] };
const roofOnlyInTitle = { title: "Roofing — Maple St", lineNames: ["Materials", "Labor"] };

check("a roof replacement is roofing", isRoofingProposal(roof) === true);
check("and its family reads asphalt", inferRoofFamily(roof.lineNames) === "asphalt");
check("a composite fence is NOT roofing", isRoofingProposal(fence) === false);
check("a cedar fence is NOT roofing", isRoofingProposal(cedarFence) === false);
check("a kitchen with shaker doors is NOT roofing", isRoofingProposal(kitchen) === false);
check("a tile roof named only in the lines is roofing", isRoofingProposal(tileRoofNoTitle) === true);
check("and its family reads tile", inferRoofFamily(tileRoofNoTitle.lineNames) === "tile");
check("'Roofing' in the title alone is roofing", isRoofingProposal(roofOnlyInTitle) === true);
check("a 'roofline' fence detail is not roofing", isRoofingProposal({ title: "Fence", lineNames: ["Post caps · roofline profile"] }) === false);

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
