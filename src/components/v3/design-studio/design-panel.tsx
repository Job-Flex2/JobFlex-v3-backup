"use client";
// THE DESIGN PANEL (Home Design Studio, milestone 3 — 2026-10-17). Beside the room being designed: lay the kitchen
// out (from what the architect drew, or automatically), add any cabinet, appliance, light or piece of furniture from
// the library, choose the finishes — paint (with the contractor's own brand code), wall texture, floor, cabinet style
// and colour, counter, backsplash, hardware — and the selected item's own numbers. Brand-neutral by design.
import * as React from "react";
import s from "./design-studio.module.css";
import type { DesignDoc, DesignItem, Finishes } from "@/lib/design/model";
import { newId } from "@/lib/design/model";
import type { Room } from "@/lib/design/geometry";
import { autoKitchen, kitchenFromPlan, frameOf } from "@/lib/design/kitchen";
import { CABINET_COLORS, COUNTERS, FLOORS, HARDWARE_HEX, LIBRARY, PAINTS, SPLASHES, finishesFor, itemCode, lib, type LibCat } from "@/lib/design/library";
import type { Selection, Tool } from "./plan-editor";

type Props = {
  doc: DesignDoc;
  room: Room;
  focus: string;
  selected: Selection;
  onSelect: (s: Selection) => void;
  tool: Tool;
  onTool: (t: Tool) => void;
  /** One undoable change. */
  onPatch: (fn: (d: DesignDoc) => void) => void;
  /** A kitchen was just laid out: the 3D view turns to it. */
  onLaidOut?: () => void;
};

const CATS: Array<{ cat: LibCat; label: string }> = [
  { cat: "base", label: "Base cabinets" },
  { cat: "wall", label: "Wall cabinets" },
  { cat: "tall", label: "Tall" },
  { cat: "island", label: "Island" },
  { cat: "appliance", label: "Appliances" },
  { cat: "light", label: "Lights" },
  { cat: "furniture", label: "Furniture" },
];

export function DesignPanel({ doc, room, focus, selected, onSelect, tool, onTool, onPatch, onLaidOut }: Props) {
  const [tab, setTab] = React.useState<"layout" | "add" | "finishes">("layout");
  const [notes, setNotes] = React.useState<string[]>([]);
  const fin = finishesFor(doc.finishes, focus);
  const roomItems = (doc.items ?? []).filter((i) => i.room === focus);
  const hasMarks = doc.marks.some((m) => {
    const c = { x: m.box.x + m.box.w / 2, y: m.box.y + m.box.h / 2 };
    return pointIn(c, room.poly);
  });
  const selItem = selected?.kind === "item" ? (doc.items ?? []).find((i) => i.id === selected.id) ?? null : null;
  const selWallId = selected?.kind === "wall" ? selected.id : null;

  const setFin = (fn: (f: Finishes) => Finishes) =>
    onPatch((d) => {
      d.finishes = { ...(d.finishes ?? {}), [focus]: fn(finishesFor(d.finishes, focus)) };
    });
  const replaceRoomItems = (items: DesignItem[], why: string[]) => {
    if (roomItems.length && !window.confirm("Replace what's already in this room?")) return;
    onPatch((d) => {
      d.items = [...(d.items ?? []).filter((i) => i.room !== focus), ...items];
    });
    setNotes(why);
    onSelect(null);
    onLaidOut?.();
  };

  return (
    <>
      {selItem ? <ItemCard it={selItem} onPatch={onPatch} onSelect={onSelect} /> : null}
      <section className={s.card} data-design-panel>
        <div className={s.head}>
          <div className={s.seg} role="tablist" aria-label="Design">
            {(["layout", "add", "finishes"] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={`${s.segB} ${tab === t ? s.on : ""}`} onClick={() => setTab(t)} data-design-tab={t}>
                {t === "layout" ? "Kitchen" : t === "add" ? "Add" : "Finishes"}
              </button>
            ))}
          </div>
        </div>
        <div className={s.body}>
          {tab === "layout" ? (
            <>
              <p className={s.note}>
                {roomItems.length ? `${roomItems.filter((i) => ["base", "wall", "tall", "island"].includes(lib(i.lib)?.cat ?? "")).length} cabinets · ${roomItems.filter((i) => lib(i.lib)?.cat === "appliance").length} appliances in this room.` : "Nothing placed yet."}
              </p>
              <div style={{ display: "grid", gap: 8 }}>
                <button
                  type="button"
                  className={`${s.btn} ${s.btnPrimary}`}
                  disabled={!hasMarks}
                  onClick={() => {
                    const r = kitchenFromPlan(doc, room, focus);
                    replaceRoomItems(r.items, r.notes);
                  }}
                  title={hasMarks ? "Turn the cabinets and appliances the architect drew into real ones" : "The plan draws nothing in this room"}
                  data-design-kitchen-plan
                >
                  Kitchen from the plan
                </button>
                <button
                  type="button"
                  className={`${s.btn} ${hasMarks ? "" : s.btnPrimary}`}
                  onClick={() => {
                    const r = autoKitchen(doc, room, focus);
                    replaceRoomItems(r.items, [r.items.length ? "Laid out: the sink under the window, the dishwasher beside it, the range with counter both sides, the fridge at an open end." : "", ...r.notes].filter(Boolean));
                  }}
                  data-design-kitchen-auto
                >
                  Auto layout
                </button>
                {roomItems.length ? (
                  <button
                    type="button"
                    className={`${s.btn} ${s.btnSm} ${s.btnDanger}`}
                    onClick={() => {
                      if (!window.confirm("Take everything out of this room?")) return;
                      onPatch((d) => {
                        d.items = (d.items ?? []).filter((i) => i.room !== focus);
                      });
                      setNotes([]);
                    }}
                  >
                    Clear the room
                  </button>
                ) : null}
              </div>
              {notes.map((n) => (
                <p key={n} className={s.note} data-design-kitchen-note>
                  {n}
                </p>
              ))}
              <p className={s.note}>Drag anything on the plan; it backs onto the nearest wall and lines up with its neighbours. R turns it, Delete removes it.</p>
            </>
          ) : null}

          {tab === "add" ? (
            <>
              {tool.startsWith("place:") ? (
                <p className={`${s.note} ${s.noteGood}`}>
                  Click the plan where the {lib(tool.slice(6))?.name.toLowerCase()} goes.{" "}
                  <button type="button" className={s.link} onClick={() => onTool("select")}>
                    Cancel
                  </button>
                </p>
              ) : null}
              {CATS.map((c) => (
                <div key={c.cat} style={{ display: "grid", gap: 6 }}>
                  <span className={s.lbl}>{c.label}</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {LIBRARY.filter((e) => e.cat === c.cat).map((e) => (
                      <button key={e.id} type="button" className={`${s.btn} ${s.btnSm} ${tool === `place:${e.id}` ? s.btnOn : ""}`} onClick={() => onTool(`place:${e.id}`)} title={e.note ?? e.name} data-design-add={e.id}>
                        {e.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </>
          ) : null}

          {tab === "finishes" ? (
            <>
              <Group label="Walls">
                <Swatches list={PAINTS} value={fin.wall.color} onPick={(sw) => setFin((f) => ({ ...f, wall: { ...f.wall, color: sw.hex, name: sw.name } }))} />
                <div className={s.fields}>
                  <label className={s.field}>
                    <span className={s.lbl}>Any colour</span>
                    <input type="color" className={s.in} value={fin.wall.color} onChange={(e) => setFin((f) => ({ ...f, wall: { ...f.wall, color: e.target.value, name: "Custom" } }))} />
                  </label>
                  <TextIn label="Paint code" value={fin.wall.code ?? ""} placeholder="SW 7008 Alabaster" onCommit={(v) => setFin((f) => ({ ...f, wall: { ...f.wall, code: v || undefined } }))} />
                </div>
                <Seg value={fin.wall.sheen} options={[["flat", "Flat"], ["eggshell", "Eggshell"], ["satin", "Satin"], ["semi", "Semi-gloss"]]} onPick={(v) => setFin((f) => ({ ...f, wall: { ...f.wall, sheen: v } }))} />
                <Seg value={fin.wall.texture} options={[["smooth", "Smooth"], ["orange", "Orange peel"], ["knockdown", "Knockdown"], ["skim", "Skim"]]} onPick={(v) => setFin((f) => ({ ...f, wall: { ...f.wall, texture: v } }))} />
                {selWallId ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    <span className={s.lbl}>The selected wall · accent</span>
                    <Swatches
                      list={PAINTS}
                      value={fin.accents?.find((a) => a.wallId === selWallId)?.color ?? ""}
                      onPick={(sw) => setFin((f) => ({ ...f, accents: [...(f.accents ?? []).filter((a) => a.wallId !== selWallId), { wallId: selWallId, color: sw.hex, name: sw.name }] }))}
                    />
                    {fin.accents?.some((a) => a.wallId === selWallId) ? (
                      <button type="button" className={s.link} onClick={() => setFin((f) => ({ ...f, accents: (f.accents ?? []).filter((a) => a.wallId !== selWallId) }))}>
                        Same as the other walls
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className={s.note}>Click a wall (in 3D or on the plan) to paint it an accent colour.</p>
                )}
              </Group>
              <Group label="Floor">
                <select className={s.in} value={fin.floor.id} onChange={(e) => setFin((f) => ({ ...f, floor: { ...f.floor, id: e.target.value } }))} data-design-floor>
                  {FLOORS.map((fl) => (
                    <option key={fl.id} value={fl.id}>
                      {fl.name}
                    </option>
                  ))}
                </select>
                <Seg value={fin.floor.pattern} options={FLOORS.find((x) => x.id === fin.floor.id)?.kind === "tile" ? [["grid", "Grid"], ["offset", "Offset"], ["diagonal", "Diagonal"]] : [["straight", "Straight"], ["diagonal", "Diagonal"], ["herringbone", "Herringbone"]]} onPick={(v) => setFin((f) => ({ ...f, floor: { ...f.floor, pattern: v } }))} />
              </Group>
              <Group label="Cabinets">
                <Seg value={fin.cabinets.style} options={[["shaker", "Shaker"], ["slab", "Slab"], ["raised", "Raised panel"]]} onPick={(v) => setFin((f) => ({ ...f, cabinets: { ...f.cabinets, style: v } }))} />
                <Swatches list={CABINET_COLORS} value={fin.cabinets.color} onPick={(sw) => setFin((f) => ({ ...f, cabinets: { ...f.cabinets, color: sw.hex, name: sw.name } }))} />
                <span className={s.lbl}>Island in another colour</span>
                <Swatches list={CABINET_COLORS} value={fin.cabinets.island ?? ""} onPick={(sw) => setFin((f) => ({ ...f, cabinets: { ...f.cabinets, island: sw.hex, islandName: sw.name } }))} />
                <span className={s.lbl}>Wall cabinets in another colour</span>
                <Swatches list={CABINET_COLORS} value={fin.cabinets.uppers ?? ""} onPick={(sw) => setFin((f) => ({ ...f, cabinets: { ...f.cabinets, uppers: sw.hex, uppersName: sw.name } }))} />
                {fin.cabinets.island || fin.cabinets.uppers ? (
                  <button type="button" className={s.link} onClick={() => setFin((f) => ({ ...f, cabinets: { style: f.cabinets.style, color: f.cabinets.color, name: f.cabinets.name } }))}>
                    All one colour
                  </button>
                ) : null}
              </Group>
              <Group label="Countertop">
                <select className={s.in} value={fin.counter.id} onChange={(e) => setFin((f) => ({ ...f, counter: { ...f.counter, id: e.target.value } }))} data-design-counter>
                  {COUNTERS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Seg value={fin.counter.edge} options={[["eased", "Eased"], ["bevel", "Bevel"], ["bullnose", "Bullnose"], ["ogee", "Ogee"]]} onPick={(v) => setFin((f) => ({ ...f, counter: { ...f.counter, edge: v } }))} />
              </Group>
              <Group label="Backsplash">
                <select className={s.in} value={fin.backsplash.id} onChange={(e) => setFin((f) => ({ ...f, backsplash: { ...f.backsplash, id: e.target.value } }))} data-design-splash>
                  {SPLASHES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Seg value={fin.backsplash.height} options={[["4in", "4 in"], ["18in", "To the uppers"], ["full", "Full height"]]} onPick={(v) => setFin((f) => ({ ...f, backsplash: { ...f.backsplash, height: v } }))} />
              </Group>
              <Group label="Hardware">
                <Seg value={fin.hardware.kind} options={[["bar", "Bar pulls"], ["knob", "Knobs"], ["cup", "Cup pulls"]]} onPick={(v) => setFin((f) => ({ ...f, hardware: { ...f.hardware, kind: v } }))} />
                <Swatches
                  list={(Object.keys(HARDWARE_HEX) as Array<keyof typeof HARDWARE_HEX>).map((k) => ({ name: k[0].toUpperCase() + k.slice(1), hex: HARDWARE_HEX[k] }))}
                  value={HARDWARE_HEX[fin.hardware.finish]}
                  onPick={(sw) => setFin((f) => ({ ...f, hardware: { ...f.hardware, finish: sw.name.toLowerCase() as Finishes["hardware"]["finish"] } }))}
                />
              </Group>
            </>
          ) : null}
        </div>
      </section>
    </>
  );
}

function ItemCard({ it, onPatch, onSelect }: { it: DesignItem; onPatch: Props["onPatch"]; onSelect: Props["onSelect"] }) {
  const e = lib(it.lib);
  if (!e) return null;
  const set = (fn: (x: DesignItem) => void) =>
    onPatch((d) => {
      const x = (d.items ?? []).find((y) => y.id === it.id);
      if (x) fn(x);
    });
  // Resizing keeps the item's back edge and its left end where they are.
  const resizeW = (w: number) =>
    set((x) => {
      const { u } = frameOf(x);
      const dw = w - x.w;
      x.x += (u.x * dw) / 2;
      x.y += (u.y * dw) / 2;
      x.w = w;
    });
  const resizeD = (dd: number) =>
    set((x) => {
      const { f } = frameOf(x);
      const delta = dd - x.d;
      x.x += (f.x * delta) / 2;
      x.y += (f.y * delta) / 2;
      x.d = dd;
    });
  return (
    <section className={s.card} data-design-inspector="item">
      <div className={s.head}>
        <div>
          <div className={s.cardTitle}>{e.name}</div>
          <p className={s.cardSub}>
            {itemCode(it)} · {Math.round(it.w)} × {Math.round(it.d)} × {Math.round(it.h)} in{it.z > 0 ? ` · ${Math.round(it.z)} in up` : ""}
          </p>
        </div>
        <button
          type="button"
          className={`${s.btn} ${s.btnSm} ${s.btnDanger}`}
          onClick={() => {
            onPatch((d) => {
              d.items = (d.items ?? []).filter((x) => x.id !== it.id);
            });
            onSelect(null);
          }}
        >
          Delete
        </button>
      </div>
      <div className={s.body}>
        <div className={s.fields}>
          <label className={s.field}>
            <span className={s.lbl}>Width</span>
            <select className={s.in} value={String(it.w)} onChange={(ev) => resizeW(Number(ev.target.value))} data-design-item-width>
              {[...new Set([...e.widths, it.w])].sort((a, b) => a - b).map((w) => (
                <option key={w} value={String(w)}>
                  {w} in
                </option>
              ))}
            </select>
          </label>
          {e.heights ? (
            <label className={s.field}>
              <span className={s.lbl}>Height</span>
              <select className={s.in} value={String(it.h)} onChange={(ev) => set((x) => (x.h = Number(ev.target.value)))}>
                {[...new Set([...e.heights, it.h])].sort((a, b) => a - b).map((h) => (
                  <option key={h} value={String(h)}>
                    {h} in
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {e.depths ? (
            <label className={s.field}>
              <span className={s.lbl}>Depth</span>
              <select className={s.in} value={String(it.d)} onChange={(ev) => resizeD(Number(ev.target.value))}>
                {[...new Set([...e.depths, it.d])].sort((a, b) => a - b).map((dd) => (
                  <option key={dd} value={String(dd)}>
                    {dd} in
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {e.cat === "wall" || e.cat === "light" ? (
            <label className={s.field}>
              <span className={s.lbl}>Height off the floor</span>
              <input className={s.in} inputMode="decimal" defaultValue={String(it.z)} key={`z${it.id}${it.z}`} onBlur={(ev) => { const v = Number(ev.target.value); if (Number.isFinite(v) && v >= 0 && v <= 140) set((x) => (x.z = v)); }} />
            </label>
          ) : null}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {it.lib === "ISL" ? (
            <button type="button" className={`${s.btn} ${s.btnSm} ${it.opts?.seats ? s.btnOn : ""}`} onClick={() => set((x) => (x.opts = { ...(x.opts ?? {}), seats: !x.opts?.seats }))}>
              Seats
            </button>
          ) : null}
          {it.lib === "SB" || it.lib === "ISL" ? (
            <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => set((x) => (x.opts = { ...(x.opts ?? {}), sink: x.opts?.sink === "double" ? "single" : x.opts?.sink === "single" && x.lib === "ISL" ? "" : "double" }))}>
              Sink: {it.opts?.sink ? String(it.opts.sink) : "none"}
            </button>
          ) : null}
          {(it.lib === "B" && it.w < 24) || (it.lib === "W" && it.w <= 21) ? (
            <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => set((x) => (x.opts = { ...(x.opts ?? {}), hinge: x.opts?.hinge === "left" ? "right" : "left" }))}>
              Hinge {it.opts?.hinge === "left" ? "left" : "right"}
            </button>
          ) : null}
          <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => set((x) => { x.rot = (((x.rot + 90) % 360) + 360) % 360; x.wallId = null; })}>
            Turn 90°
          </button>
          <button
            type="button"
            className={`${s.btn} ${s.btnSm}`}
            onClick={() => {
              const id = newId("i");
              onPatch((d) => {
                const { u } = frameOf(it);
                d.items = [...(d.items ?? []), { ...it, id, x: it.x + u.x * it.w, y: it.y + u.y * it.w, opts: it.opts ? { ...it.opts } : undefined }];
              });
              onSelect({ kind: "item", id });
            }}
          >
            Duplicate
          </button>
        </div>
      </div>
    </section>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 8, paddingBottom: 12, borderBottom: "1.5px solid var(--hair-soft)" }}>
      <span className={s.cardTitle} style={{ fontSize: 12 }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function Swatches({ list, value, onPick }: { list: Array<{ name: string; hex: string }>; value: string; onPick: (sw: { name: string; hex: string }) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} role="radiogroup">
      {list.map((sw) => {
        const on = sw.hex.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={sw.hex + sw.name}
            type="button"
            role="radio"
            aria-checked={on}
            title={sw.name}
            aria-label={sw.name}
            onClick={() => onPick(sw)}
            style={{ width: 30, height: 30, borderRadius: 4, border: on ? "3px solid var(--blueprint)" : "1.5px solid var(--ink)", background: sw.hex, cursor: "pointer", boxShadow: on ? "0 0 0 2px #fff inset" : undefined }}
            data-design-swatch={sw.name}
          />
        );
      })}
    </div>
  );
}

function Seg<T extends string>({ value, options, onPick }: { value: T; options: Array<[T, string]>; onPick: (v: T) => void }) {
  return (
    <div className={s.seg} role="group" style={{ flexWrap: "wrap", justifySelf: "start" }}>
      {options.map(([v, label]) => (
        <button key={v} type="button" className={`${s.segB} ${value === v ? s.on : ""}`} aria-pressed={value === v} onClick={() => onPick(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function TextIn({ label, value, placeholder, onCommit }: { label: string; value: string; placeholder?: string; onCommit: (v: string) => void }) {
  const [txt, setTxt] = React.useState(value);
  const [seen, setSeen] = React.useState(value);
  if (seen !== value) {
    setSeen(value);
    setTxt(value);
  }
  return (
    <label className={s.field}>
      <span className={s.lbl}>{label}</span>
      <input className={s.in} value={txt} placeholder={placeholder} onChange={(e) => setTxt(e.target.value)} onBlur={() => txt.trim() !== value && onCommit(txt.trim().slice(0, 40))} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
    </label>
  );
}

function pointIn(p: { x: number; y: number }, poly: Array<{ x: number; y: number }>) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
