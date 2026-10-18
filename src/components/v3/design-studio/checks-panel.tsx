"use client";
// THE CHECKS TAB (Home Design Studio, milestone 5 — 2026-10-17): what the kitchen as designed misses — the code first,
// then the NKBA guidelines, then plain fit — each with its source, "Show" to point at what it's about, and a one-click
// fix where there is one; what passes, folded underneath.
import * as React from "react";
import s from "./design-studio.module.css";
import type { DesignDoc } from "@/lib/design/model";
import { applyFix, LEVEL_NAME, type Check } from "@/lib/design/checks";
import type { Selection } from "./plan-editor";

const ORDER = { code: 0, fit: 1, guide: 2 } as const;
const TONE = { code: "#b4232a", fit: "#9a5b00", guide: "#1b5f9e" } as const;

export function ChecksPanel({ checks, onSelect, onPatch }: { checks: Check[]; onSelect: (s: Selection) => void; onPatch: (fn: (d: DesignDoc) => void) => void }) {
  const [showPass, setShowPass] = React.useState(false);
  const open = checks.filter((c) => !c.ok).sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const pass = checks.filter((c) => c.ok);
  if (!checks.length) return <p className={s.note}>Place a kitchen in the room and it&apos;s checked here — the code, the NKBA guidelines, and what fits.</p>;
  const show = (c: Check) => {
    if (c.items?.length) onSelect({ kind: "item", id: c.items[0] });
    else if (c.walls?.length) onSelect({ kind: "wall", id: c.walls[0] });
  };
  return (
    <div style={{ display: "grid", gap: 10 }} data-design-checks>
      <p className={`${s.note} ${open.length ? s.noteWarn : s.noteGood}`} data-design-checks-summary>
        {open.length ? `${open.length} to look at · ${pass.length} pass` : `All ${pass.length} checks pass.`}
      </p>
      {open.map((c) => (
        <div key={c.id} style={{ borderLeft: `3px solid ${TONE[c.level]}`, paddingLeft: 10, display: "grid", gap: 4 }} data-design-check={c.id}>
          <div className={s.mono} style={{ color: TONE[c.level] }}>
            {c.level === "code" ? `${LEVEL_NAME.code} · ${c.source}` : c.source}
          </div>
          <div style={{ fontWeight: 800, fontSize: 13.5, lineHeight: 1.3 }}>{c.title}</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--muted)" }}>{c.detail}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
            {c.items?.length || c.walls?.length ? (
              <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => show(c)}>
                Show
              </button>
            ) : null}
            {c.fix ? (
              <button
                type="button"
                className={`${s.btn} ${s.btnSm} ${s.btnPrimary}`}
                onClick={() =>
                  onPatch((d) => {
                    const next = applyFix(d, c.fix!);
                    d.items = next.items;
                  })
                }
                data-design-fix={c.id}
              >
                {c.fix.label}
              </button>
            ) : null}
          </div>
        </div>
      ))}
      {pass.length ? (
        <button type="button" className={s.link} style={{ justifySelf: "start" }} onClick={() => setShowPass((v) => !v)}>
          {showPass ? "Hide" : "Show"} what passes ({pass.length})
        </button>
      ) : null}
      {showPass
        ? pass.map((c) => (
            <div key={c.id} style={{ fontSize: 12.5, lineHeight: 1.4 }} data-design-check-pass={c.id}>
              <b style={{ color: "#1f7a46" }}>✓</b> <b>{c.title}</b> <span className={s.mono}>· {c.source}</span>
              <div style={{ color: "var(--muted)" }}>{c.detail}</div>
            </div>
          ))
        : null}
    </div>
  );
}
