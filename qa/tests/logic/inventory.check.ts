// Warehouse stock against the work (2026-09-20): reserved by sold jobs,
// forecast by open proposals, short before they sell, low before the next
// truck, the crew's pick list and the purchase order. Pure, no database.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/inventory.check.ts
import { isStocked, jobBuyList, pickList, purchaseOrderText, stockKey, stockRows, untrackedLines, type StockItem } from "../../../src/lib/inventory";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

check("a line and an item match by meaning, not spelling",
  stockKey("Starter strip · eaves + rakes") === stockKey("starter strip (eaves & rakes)") && stockKey("4x4 PT post, 8 ft") === "4x4 pt post 8 ft" && stockKey("Concrete mix · 60 lb bags") === stockKey("concrete mix 60 lb bags"));

const item = (id: string, name: string, onHand: number, unit = "each", reorderPoint: number | null = null): StockItem => ({ id, name, key: stockKey(name), unit, onHand, reorderPoint, supplierId: id === "post" ? "sup1" : null, supplierName: id === "post" ? "Cedar Supply" : null, supplierSku: id === "post" ? "PT44-8" : null });
const items = [item("post", "4x4 PT post, 8 ft", 40), item("bag", "Concrete mix · 60 lb bags", 30, "bag", 50), item("board", "Cedar fence board 1x6x6", 500)];
const sold = [{ lines: [{ name: "4x4 PT post, 8 ft", quantity: 24 }, { name: "Concrete mix · 60 lb bags", quantity: 48 }] }];
const open = [
  { lines: [{ name: "4x4 PT post 8 ft", quantity: 30 }, { name: "concrete mix 60 lb bags", quantity: 60 }, { name: "Cedar fence board 1x6x6", quantity: 300 }] },
  { lines: [{ name: "4x4 PT post, 8 ft", quantity: 12 }] },
];
const rows = stockRows(items, sold, open);
const post = rows.find((r) => r.id === "post")!;
const bag = rows.find((r) => r.id === "bag")!;
const board = rows.find((r) => r.id === "board")!;
check("sold jobs reserve; open proposals forecast; available is on hand less reserved",
  post.reserved === 24 && post.forecast === 42 && post.available === 16, JSON.stringify({ r: post.reserved, f: post.forecast, a: post.available }));
check("short = what the open proposals would take beyond what is available", post.short === 26 && board.short === 0, `${post.short} ${board.short}`);
check("no reorder point set: the biggest single job is the threshold, and the posts are low", post.threshold === 30 && post.low, `${post.threshold} ${post.low}`);
check("a set reorder point rules; the bags are low against it", bag.threshold === 50 && bag.available === -18 && bag.low, `${bag.threshold} ${bag.available}`);
check("boards are fine: plenty on hand, not low", !board.low && board.available === 500 && board.suggestedOrder === 0);
check("the suggested order covers the reserved and forecast work plus the threshold", post.suggestedOrder === 56 && bag.suggestedOrder === 128, `${post.suggestedOrder} ${bag.suggestedOrder}`);

check("lines the warehouse does not know are listed once, to be added", untrackedLines(items, [{ name: "Gate hardware kit", quantity: 1 }, { name: "gate hardware kit", quantity: 2 }, { name: "4x4 PT post 8 ft", quantity: 3 }]).map((l) => l.name).join(",") === "Gate hardware kit");

const pick = pickList(items, [{ name: "4x4 PT post 8 ft", quantity: 12.4 }, { name: "Concrete mix · 60 lb bags", quantity: 24 }, { name: "Gate hardware kit", quantity: 1, unit: "kit" }, { name: "4x4 PT post, 8 ft", quantity: 2 }]);
check("the crew's list: whole units, merged lines, the shelf checked, untracked lines still listed",
  pick.length === 3 && pick[0].quantity === 15 && pick[0].enough && pick[1].quantity === 24 && pick[1].enough && pick[2].itemId === null && pick[2].unit === "kit" && !pick[2].enough, JSON.stringify(pick.map((p) => [p.name, p.quantity, p.enough])));

// What the company keeps in stock (2026-09-23): an item bought per job is
// never low or short and gets no restock; it goes on the job's shopping list.
const shingle: StockItem = { ...item("shingle", "Architectural shingle · 30-yr", 30, "square"), stocked: false, supplierId: "abc", supplierName: "ABC Supply" };
const withPerJob = [...items, shingle];
const soldTwo = [
  { id: "A", startsAt: "2026-10-05T12:00:00.000Z", lines: [{ name: "Architectural shingle · 30-yr", quantity: 24 }, { name: "4x4 PT post, 8 ft", quantity: 24 }] },
  { id: "B", startsAt: "2026-10-01T12:00:00.000Z", lines: [{ name: "architectural shingle 30-yr", quantity: 30 }] },
  { id: "C", startsAt: null, lines: [{ name: "4x4 PT post, 8 ft", quantity: 6 }] },
];
const perJobRow = stockRows(withPerJob, soldTwo, open).find((r) => r.id === "shingle")!;
check("absent counts as kept in stock; a per-job item still shows what the work needs but is never low, short or restocked",
  isStocked(items[0]) && !isStocked(shingle) && perJobRow.reserved === 54 && perJobRow.available === -24 && !perJobRow.low && perJobRow.short === 0 && perJobRow.suggestedOrder === 0 && perJobRow.threshold === 0,
  JSON.stringify({ reserved: perJobRow.reserved, available: perJobRow.available, low: perJobRow.low, short: perJobRow.short, order: perJobRow.suggestedOrder }));
const pickPerJob = pickList(withPerJob, [{ name: "Architectural shingle · 30-yr", quantity: 40 }, { name: "4x4 PT post 8 ft", quantity: 2 }, { name: "Gate hardware kit", quantity: 1 }]);
check("the crew's list marks a per-job line as such; a stocked line and an untracked line are not",
  pickPerJob[0].perJob && !pickPerJob[0].enough && pickPerJob[0].itemId === "shingle" && !pickPerJob[1].perJob && pickPerJob[1].enough && !pickPerJob[2].perJob && pickPerJob[2].itemId === null);
const buy = jobBuyList(withPerJob, soldTwo);
check("the shopping list: soonest job first, what is on hand goes to it, the rest is to buy; a job with no per-job material is left out",
  buy.length === 2 && buy[0].job.id === "B" && buy[0].lines[0].have === 30 && buy[0].lines[0].toBuy === 0 && buy[0].toBuy === 0 && buy[1].job.id === "A" && buy[1].lines.length === 1 && buy[1].lines[0].have === 0 && buy[1].lines[0].toBuy === 24 && buy[1].lines[0].supplierName === "ABC Supply" && buy[1].toBuy === 1,
  JSON.stringify(buy.map((b) => [b.job.id, b.lines.map((l) => [l.name, l.have, l.toBuy])])));
check("a company with nothing bought per job has no shopping list", jobBuyList(items, soldTwo).length === 0);

const po = purchaseOrderText({ company: "DA Homes LLC", supplier: "Cedar Supply", trade: "fence", lines: [{ name: "4x4 PT post, 8 ft", sku: "PT44-8", unit: "each", quantity: 56 }, { name: 'Board 1x6 "premium"', sku: null, unit: "each", quantity: 100 }] });
check("the purchase order names the supplier, the company, every line and its SKU, and escapes text", /Purchase order — DA Homes LLC — fence/.test(po.subject) && /Hello Cedar Supply/.test(po.html) && /PT44-8/.test(po.html) && /56 each/.test(po.html) && /&quot;premium&quot;/.test(po.html) && /confirm price and delivery/.test(po.html));

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
