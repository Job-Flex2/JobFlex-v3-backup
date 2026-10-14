// The build list as a spreadsheet: one row per line, trade by trade. Pure, browser-safe.
import { PLAN_TRADES, TRADE_LABEL, type TakeoffItem, type TakeoffSource } from "./takeoff";

export const SOURCE_LABEL: Record<TakeoffSource, string> = {
  plan: "on the plans",
  derived: "computed",
  rule: "assumed",
  entered: "entered",
};

export const ROLE_LABEL: Record<NonNullable<TakeoffItem["role"]>, string> = {
  labor: "Work",
  material: "Material",
  both: "Supply + install",
};

export function buildListCsv(items: TakeoffItem[]): string {
  const cell = (v: string | number) => {
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const head = ["Trade", "Phase", "Line", "Work / material", "Quantity", "Unit", "Source", "How it was measured", "Plan pages"];
  const rows = PLAN_TRADES.flatMap((t) =>
    items
      .filter((i) => i.trade === t)
      .map((i) => [TRADE_LABEL[t], i.phase ?? "", i.label, ROLE_LABEL[i.role ?? "both"], i.qty, i.unit, i.measured ? "measured on the plans" : SOURCE_LABEL[i.source], i.basis, i.pages.join(" ")]),
  );
  // A byte-order mark so Excel opens the inch and foot marks as written.
  return "﻿" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

export function downloadText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
