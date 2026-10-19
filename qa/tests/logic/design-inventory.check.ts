// Home Design Studio, the shop's own products (2026-10-18 — "inventory should be real"): what a product must have,
// a piece becoming one (its size, its finish, which product), the shelf's words, and the estimate supplying it at the
// shop's price — instead of an allowance, and furniture priced only when it's the shop's.
//   npx tsx qa/tests/logic/design-inventory.check.ts
import { applyProduct, PRODUCT_PIECES, productName, productOf, sanitizeProduct, sanitizeProducts, stockWords, type DesignProduct } from "../../../src/lib/design/inventory";
import { autoFurnish } from "../../../src/lib/design/rooms";
import { autoKitchen } from "../../../src/lib/design/kitchen";
import { roomsOf } from "../../../src/lib/design/geometry";
import { DEFAULT_FINISHES, newItemFrom } from "../../../src/lib/design/library";
import { normalizeDesign } from "../../../src/lib/design/normalize";
import { DEFAULT_OPTIONS, priceDesign, scopeText, takeoff } from "../../../src/lib/design/estimate";
import type { DesignDoc, DesignItem, Wall } from "../../../src/lib/design/model";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const W = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thick: 4.5, height: 96 });
const roomDoc = (name: string, w: number, h: number): DesignDoc => ({
  v: 1,
  title: name,
  walls: [W("top", 0, 0, w, 0), W("right", w, 0, w, h), W("bottom", w, h, 0, h), W("left", 0, h, 0, 0)],
  openings: [{ id: "door", wallId: "bottom", kind: "door", at: 26, width: 32, height: 80, sill: 0 }, { id: "win", wallId: "top", kind: "window", at: w / 2, width: 36, height: 48, sill: 40 }],
  labels: [{ id: "r", name, at: { x: w / 2, y: h / 2 } }],
  marks: [],
});

console.log("── what a product must be");
check("cabinets are built to size, never stocked as products", !PRODUCT_PIECES.some((e) => ["B", "W", "P", "ISL", "SB"].includes(e.id)) && PRODUCT_PIECES.some((e) => e.id === "WC") && PRODUCT_PIECES.some((e) => e.id === "REF"));
check("a piece that isn't one is refused", sanitizeProduct({ id: "pa1b2", lib: "SPACESHIP", brand: "X", model: "1" }) === null && sanitizeProduct({ id: "pa1b2", lib: "B", brand: "X", model: "1" }) === null);
check("it needs a brand or a model", sanitizeProduct({ id: "pa1b2", lib: "WC" }) === null && !!sanitizeProduct({ id: "pa1b2", lib: "WC", model: "K-3999" }));
const toilet = sanitizeProduct({ id: "pwc0001", lib: "WC", brand: " Kohler ", model: "K-3999", name: "Highline", w: "19.5", d: 30.25, h: 30, price: "389.999", onHand: 2.6, url: "javascript:alert(1)", color: "#FFFFFF" })!;
check("numbers read and rounded, the brand trimmed", toilet.w === 19.5 && toilet.d === 30.25 && toilet.price === 390 && toilet.onHand === 3 && toilet.brand === "Kohler", JSON.stringify(toilet));
check("only a web address is kept as the supplier's page", toilet.url === undefined && sanitizeProduct({ id: "pwc0002", lib: "WC", model: "x", url: "https://example.com/k-3999" })!.url === "https://example.com/k-3999");
check("a size is held to sense", sanitizeProduct({ id: "pwc0003", lib: "WC", model: "x", w: 99999, d: -4 })!.w === 240 && sanitizeProduct({ id: "pwc0003", lib: "WC", model: "x", d: -4 })!.d === 0.25);
check("no price is no price, not $0", sanitizeProduct({ id: "pwc0004", lib: "WC", model: "x", price: "" })!.price === null);
check("a list drops the bad and the doubled", sanitizeProducts([toilet, toilet, { lib: "WC" }, null]).length === 1);
check("said the way a person says it", productName(toilet) === "Kohler Highline · K-3999");

console.log("── the shelf");
check("in stock", stockWords(toilet, 1) === "in stock (3 on the shelf)" && stockWords({ ...toilet, onHand: 1 }, 1) === "in stock");
check("part in stock", stockWords(toilet, 5) === "3 in stock, order 2");
check("to order", stockWords({ ...toilet, onHand: 0 }, 1) === "to order" && stockWords({ ...toilet, onHand: 0 }, 2) === "order 2");

console.log("── a piece becomes the product");
const generic = newItemFrom("WC", { x: 10, y: 10, rot: 0 }, "iwc")!;
const as = applyProduct(generic, toilet);
check("it takes the product's size and remembers which", as.w === 19.5 && as.d === 30.25 && as.opts?.product === "pwc0001" && as.opts?.color === "#ffffff");
check("productOf finds it back", productOf(as, [toilet])?.id === "pwc0001" && productOf(generic, [toilet]) === null);
check("a generic one again: no product, the size kept", applyProduct(as, null).opts?.product === undefined && applyProduct(as, null).w === 19.5);
const saved = normalizeDesign({ ...roomDoc("Bath", 96, 120), items: [{ ...as, room: "r" }] });
check("a saved design keeps which product a piece is", saved.items?.[0].opts?.product === "pwc0001");

console.log("── a bath, its toilet the shop's own");
{
  const doc = roomDoc("Master bath", 96, 120);
  const room = roomsOf(doc)[0];
  const items = autoFurnish(doc, room, "r").items.map((i): DesignItem => (i.lib === "WC" ? applyProduct(i, toilet) : i));
  const d: DesignDoc = { ...doc, items };
  const t = takeoff(d, "r")!;
  const opts = { ...DEFAULT_OPTIONS, appliances: "allowance" as const };
  const lines = priceDesign(t, DEFAULT_FINISHES, opts, 1.2, {}, [toilet]);
  const prod = lines.find((l) => l.key === "prod-pwc0001");
  check("the toilet supplied at the shop's price, not the city's", !!prod && prod.unitPrice === 390 && prod.qty === 1 && prod.basis === "yours", JSON.stringify(prod));
  check("it says the shelf has it", !!prod && /in stock/.test(prod.desc), prod?.desc);
  check("no toilet allowance beside it; the tub keeps its own", !lines.some((l) => l.key === "allow-toilet") && lines.some((l) => l.key === "allow-tub"), lines.map((l) => l.key).join(" "));
  check("setting it is still the bath's own line", lines.some((l) => l.key === "bath-fixtures"));
  check("the scope names it", /Supplied from our inventory: Kohler Highline · K-3999/.test(scopeText(t, DEFAULT_FINISHES, opts, [toilet])));
  const gone = priceDesign(t, DEFAULT_FINISHES, opts, 1.2, {}, []);
  check("a product no longer in the inventory: the allowance comes back, no line for it", !gone.some((l) => l.key.startsWith("prod-")) && gone.some((l) => l.key === "allow-toilet"));
  const own = priceDesign(t, DEFAULT_FINISHES, opts, 1.2, { "prod-pwc0001": 350 }, [toilet]);
  check("a price typed on the sheet wins over the inventory's", own.find((l) => l.key === "prod-pwc0001")?.unitPrice === 350);
}

console.log("── a kitchen's fridge, a living room's sofa");
{
  const doc = roomDoc("Kitchen", 168, 144);
  const fridge: DesignProduct = sanitizeProduct({ id: "pref001", lib: "REF", brand: "Bosch", model: "B36CD50SNS", w: 36, d: 29, h: 70, price: 2899, onHand: 0 })!;
  const k = autoKitchen(doc, roomsOf(doc)[0], "r").items.map((i) => (i.lib === "REF" ? applyProduct(i, fridge) : i));
  const t = takeoff({ ...doc, items: k }, "r")!;
  const lines = priceDesign(t, DEFAULT_FINISHES, { ...DEFAULT_OPTIONS, appliances: "allowance" }, 1, {}, [fridge]);
  check("the fridge is the shop's Bosch, to order — no fridge allowance", lines.some((l) => l.key === "prod-pref001" && /to order/.test(l.desc)) && !lines.some((l) => l.key === "appl-REF") && lines.some((l) => l.key === "appl-RNG"), lines.filter((l) => /appl|prod/.test(l.key)).map((l) => l.key).join(" "));

  const liv = roomDoc("Living room", 192, 168);
  const sofa = sanitizeProduct({ id: "psof001", lib: "SOFA", brand: "Article", model: "Sven 88", w: 88, d: 38, h: 34, price: 1999, onHand: 1, color: "#2f3e55" })!;
  const items = autoFurnish(liv, roomsOf(liv)[0], "r").items.map((i) => (i.lib === "SOFA" ? applyProduct(i, sofa) : i));
  const tl = takeoff({ ...liv, items }, "r")!;
  const ll = priceDesign(tl, DEFAULT_FINISHES, DEFAULT_OPTIONS, 1, {}, [sofa]);
  const line = ll.find((l) => l.key === "prod-psof001");
  check("the shop's sofa is priced under Furnishings; the generic chairs are not", !!line && line.group === "Furnishings" && line.unitPrice === 1999 && !ll.some((l) => /ARM|CTB/.test(l.name)), JSON.stringify(line));
  check("the furniture count leaves the shop's sofa out", tl.furnishings === items.filter((i) => ["ARM", "CTB", "RUG", "TVC", "PLT"].includes(i.lib)).length, String(tl.furnishings));
  check("its finish colours the piece", items.find((i) => i.lib === "SOFA")?.opts?.color === "#2f3e55" && items.find((i) => i.lib === "SOFA")?.w === 88);
}

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
