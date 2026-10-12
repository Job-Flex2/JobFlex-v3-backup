// THE MATERIAL LIST (2026-10-11, owner: "make me a list of all materials for the
// contractor to send to the lumber yard to get a price, or give to the installer
// to purchase") — pure. The engine's own takeoff (lib/deck/takeoff), in the
// lengths and counts a yard sells, grouped in the order the job is built:
// footings and posts, ledger, framing, decking, stairs, railing, roof… A fixture
// the client buys is kept apart ("the client supplies — not to order").
//
// Two ways out besides the printed page: plain text (copied, texted, emailed,
// pasted into the yard's quote form) and a CSV for a spreadsheet. The yard's
// copy carries no prices — the yard quotes; the installer's may carry the
// studio's estimated prices (the shop's own price book, else example prices).
import type { DeckPackage } from "./pricing";
import { BOM_STEP_LABEL, BOM_STEP_ORDER, type BomStep } from "./takeoff";

export type ListFor = "yard" | "installer";

export interface MaterialListLine {
  label: string;
  qty: number;
  unit: string;
  note: string | null;
  /** The client buys it: listed so the crew knows, never ordered. */
  byClient: boolean;
  /** The studio's estimate, per unit and for the line (0 for a client's fixture). */
  unitPrice: number;
  cost: number;
  /** The price is an example, not the shop's own. */
  example: boolean;
}

export interface MaterialListGroup {
  step: BomStep;
  label: string;
  lines: MaterialListLine[];
  cost: number;
}

export interface MaterialList {
  groups: MaterialListGroup[];
  /** Lines to order (the client's fixtures left out). */
  count: number;
  /** The studio's estimate of what is ordered. */
  cost: number;
  /** The share of that estimate still on example prices, 0–1. */
  exampleShare: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The package's materials as a list, in build order. */
export function materialList(pkg: DeckPackage): MaterialList {
  const groups = new Map<BomStep, MaterialListGroup>();
  for (const l of pkg.bom) {
    if (!(l.qty > 0)) continue;
    const g = groups.get(l.step) ?? { step: l.step, label: BOM_STEP_LABEL[l.step] ?? l.step, lines: [], cost: 0 };
    const byClient = !!l.byClient;
    const cost = byClient ? 0 : round2(l.cost);
    g.lines.push({ label: l.label, qty: l.qty, unit: l.unit, note: l.note ?? null, byClient, unitPrice: byClient ? 0 : round2(l.unitPrice), cost, example: !byClient && l.source !== "book" });
    g.cost = round2(g.cost + cost);
    groups.set(l.step, g);
  }
  const order = (s: BomStep) => {
    const i = BOM_STEP_ORDER.indexOf(s);
    return i < 0 ? 99 : i;
  };
  const list = [...groups.values()].sort((a, b) => order(a.step) - order(b.step));
  const lines = list.flatMap((g) => g.lines).filter((l) => !l.byClient);
  const cost = round2(lines.reduce((a, l) => a + l.cost, 0));
  const exampleCost = lines.filter((l) => l.example).reduce((a, l) => a + l.cost, 0);
  return { groups: list, count: lines.length, cost, exampleShare: cost > 0 ? Math.round((exampleCost / cost) * 100) / 100 : 0 };
}

export interface ListHead {
  /** "16 ft × 12 ft deck" */
  what: string;
  title?: string | null;
  address?: string | null;
  shop: { name: string; phone?: string | null; address?: string | null };
  /** "October 11, 2026" */
  date: string;
  forWhom: ListFor;
  withPrices: boolean;
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** What the yard or the installer is asked to do, in a sentence. */
export function listAsk(head: Pick<ListHead, "forWhom" | "address">): string {
  if (head.forWhom === "yard") return head.address ? `Please quote these materials delivered to ${head.address}.` : "Please quote these materials, delivered.";
  return head.address ? `Buy these for the job at ${head.address}.` : "Buy these for the job.";
}

/** The list as plain text: to copy, text, email, or paste into a yard's quote form. */
export function materialListText(list: MaterialList, head: ListHead): string {
  const out: string[] = [];
  out.push(`MATERIAL LIST — ${head.what}${head.title && head.title !== head.what ? ` (${head.title})` : ""}`);
  out.push([head.shop.name, head.shop.phone, head.date].filter(Boolean).join(" · "));
  out.push(listAsk(head));
  const qtyWidth = Math.max(3, ...list.groups.flatMap((g) => g.lines.map((l) => `${qtyText(l.qty)} ${l.unit}`.length)));
  const supplied: string[] = [];
  for (const g of list.groups) {
    const lines = g.lines.filter((l) => !l.byClient);
    for (const l of g.lines.filter((x) => x.byClient)) supplied.push(`${qtyText(l.qty)} ${l.unit} ${l.label}`);
    if (!lines.length) continue;
    out.push("");
    out.push(g.label.toUpperCase());
    for (const l of lines) {
      const q = `${qtyText(l.qty)} ${l.unit}`.padEnd(qtyWidth);
      const price = head.withPrices ? `  ≈ ${money(l.cost)}` : "";
      out.push(`  ${q}  ${l.label}${l.note ? ` — ${l.note}` : ""}${price}`);
    }
  }
  if (supplied.length) {
    out.push("");
    out.push("THE CLIENT SUPPLIES (not to order)");
    for (const s of supplied) out.push(`  ${s}`);
  }
  out.push("");
  out.push(`${list.count} ${list.count === 1 ? "item" : "items"}${head.withPrices ? ` · estimated ${money(list.cost)} before tax${list.exampleShare > 0.05 ? " (partly example prices)" : ""}` : ""}`);
  return out.join("\n");
}

/** A CSV cell: quoted when it holds a comma, a quote or a line break (RFC 4180). */
export function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The list for a spreadsheet: one row a line, the client's fixtures marked. */
export function materialListCsv(list: MaterialList, withPrices: boolean): string {
  const head = ["Section", "Qty", "Unit", "Item", "Note", "Client supplies"].concat(withPrices ? ["Est. each", "Est. total"] : []);
  const rows = [head.join(",")];
  for (const g of list.groups) {
    for (const l of g.lines) {
      const cells: Array<string | number> = [g.label, qtyText(l.qty), l.unit, l.label, l.note ?? "", l.byClient ? "yes" : ""];
      if (withPrices) cells.push(l.byClient ? "" : l.unitPrice.toFixed(2), l.byClient ? "" : l.cost.toFixed(2));
      rows.push(cells.map(csvCell).join(","));
    }
  }
  return rows.join("\r\n") + "\r\n";
}
