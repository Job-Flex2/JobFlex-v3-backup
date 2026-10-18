"use client";
// THE PLAN, EDITABLE (Home Design Studio, 2026-10-17). What the reader made of the blueprint — or what the contractor
// draws — as a plan in real inches: walls as their thickness, doors with their swing, windows in the wall, each room
// tinted with its name and floor area, the plan's own cabinets and fixtures in thin line. Fix anything the read got
// wrong: drag a wall's end (it snaps to corners, to other walls, square to 90°), slide a whole wall (the walls joined
// to it follow), slide a door or window along its wall, draw walls, a room by its corners, add a door or window by
// clicking a wall, name a room. The page beside it holds the selected thing's numbers.
import * as React from "react";
import type { DesignDoc, Opening, OpeningKind, P, Wall } from "@/lib/design/model";
import { DEFAULT_CEILING, DEFAULT_INTERIOR, DOOR_HEIGHT, WINDOW_HEIGHT, WINDOW_SILL, ftIn, newId } from "@/lib/design/model";
import { add, along, centroid, dist, mulP, planBounds, pointInPoly, project, roomsOf, sub, unit, wallDir, wallLen, wallPieces, wallQuad, leftN, type Room } from "@/lib/design/geometry";
import type { DesignItem } from "@/lib/design/model";
import { cornersOf, snapToNeighbours, snapToWall } from "@/lib/design/kitchen";
import { itemCode, lib, newItemFrom } from "@/lib/design/library";

export type Selection = { kind: "wall"; id: string } | { kind: "opening"; id: string } | { kind: "label"; id: string } | { kind: "room"; key: string } | { kind: "item"; id: string } | null;
/** `place:<library id>` puts that thing where the plan is clicked. */
export type Tool = "select" | "wall" | "room" | "door" | "window" | "opening" | "label" | `place:${string}`;

export type Underlay = { url: string; x: number; y: number; w: number; h: number; opacity?: number };

type Props = {
  doc: DesignDoc;
  /** A change; `commit` false while a drag is still moving (one undo step per drag). */
  onChange: (doc: DesignDoc, commit?: boolean) => void;
  selected: Selection;
  onSelect: (s: Selection) => void;
  tool: Tool;
  onTool: (t: Tool) => void;
  /** The room being designed: drawn on top, the rest quieter. */
  focus?: string | null;
  underlay?: Underlay | null;
  /** Calibration: two clicks on the plan report their points. */
  calibrating?: boolean;
  onCalibratePoints?: (a: P, b: P) => void;
  /** A change refits the view (after the scale is set, the plan's size changes under it). */
  fitToken?: number;
  className?: string;
  /** Walls the house had that the design took out — drawn dashed where they stood (milestone 5). */
  ghosts?: Wall[];
  /** Items and walls a check is about — outlined in red. */
  flags?: Set<string>;
};

const ROOM_TINT = ["#fef3c7", "#dbeafe", "#dcfce7", "#fce7f3", "#ede9fe", "#ffedd5", "#cffafe", "#f1f5f9"];
const MARK_INK = { cabinet: "#b45309", appliance: "#0f766e", plumbing: "#15803d" } as const;

const clone = (d: DesignDoc): DesignDoc => JSON.parse(JSON.stringify(d)) as DesignDoc;

/** Move one wall end, and every other wall end sitting on that same point with it. */
function moveCorner(doc: DesignDoc, from: P, to: P, onlyWall?: string) {
  for (const w of doc.walls) {
    for (const end of ["a", "b"] as const) {
      if (dist(w[end], from) <= 0.75 && (!onlyWall || w.id === onlyWall)) {
        if (end === "a") {
          const before = wallLen(w);
          w.a = { ...to };
          const delta = wallLen(w) - before;
          for (const o of doc.openings) if (o.wallId === w.id) o.at += delta;
        } else w.b = { ...to };
      }
    }
  }
  // Openings stay on their walls.
  for (const o of doc.openings) {
    const w = doc.walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const L = wallLen(w);
    o.at = Math.max(o.width / 2, Math.min(L - o.width / 2, o.at));
  }
}

export function PlanEditor({ doc, onChange, selected, onSelect, tool, onTool, focus = null, underlay = null, calibrating = false, onCalibratePoints, fitToken = 0, className, ghosts = [], flags }: Props) {
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const rooms = React.useMemo(() => roomsOf(doc), [doc]);
  const [view, setView] = React.useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [hover, setHover] = React.useState<P | null>(null);
  const [draft, setDraft] = React.useState<P[]>([]);
  const [rect, setRect] = React.useState<{ a: P; b: P } | null>(null);
  const [calib, setCalib] = React.useState<P[]>([]);
  const drag = React.useRef<
    | { kind: "pan"; start: P; view: { x: number; y: number; w: number; h: number }; px: { x: number; y: number } }
    | { kind: "end"; wall: string; end: "a" | "b"; from: P; base: DesignDoc }
    | { kind: "wall"; wall: string; start: P; base: DesignDoc }
    | { kind: "opening"; id: string; base: DesignDoc }
    | { kind: "label"; id: string; offset: P; base: DesignDoc }
    | { kind: "rect"; a: P }
    | { kind: "item"; id: string; offset: P; base: DesignDoc }
    | null
  >(null);
  const pointers = React.useRef(new Map<number, { x: number; y: number }>());
  // The drawing's size on screen, kept in state (read in render for line weights and snap reach).
  const [box, setBox] = React.useState({ w: 800, h: 600 });
  React.useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(() => {
      const r = svg.getBoundingClientRect();
      setBox({ w: Math.max(1, r.width), h: Math.max(1, r.height) });
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);
  const pinch = React.useRef<{ d: number; view: { x: number; y: number; w: number; h: number }; mid: P } | null>(null);

  // Fit the plan (or its focus room) when the plan first arrives or the focus changes.
  const fitKey = `${doc.walls.length > 0}|${focus ?? ""}|${fitToken}`;
  const [fitted, setFitted] = React.useState("");
  if (fitted !== fitKey) {
    setFitted(fitKey);
    const focusRoom = focus ? rooms.find((r) => r.labelId === focus) : null;
    let b = planBounds(doc);
    if (focusRoom) {
      const xs = focusRoom.poly.map((p) => p.x);
      const ys = focusRoom.poly.map((p) => p.y);
      b = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    if (!doc.walls.length && underlay) b = { x: underlay.x, y: underlay.y, w: underlay.w, h: underlay.h };
    const pad = Math.max(36, Math.max(b.w, b.h) * 0.12);
    setView({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad });
  }
  const vb = view ?? { x: -24, y: -24, w: 480, h: 360 };

  /** Screen → plan inches. */
  const toPlan = (e: { clientX: number; clientY: number }): P => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  /** Inches per screen pixel. */
  const perPx = () => Math.max(vb.w / box.w, vb.h / box.h);

  /** Snap a point: to a wall end, onto a wall's line, square to the last point, then to the inch. */
  const snap = (p: P, opts: { from?: P | null; skipWall?: string | null } = {}): P => {
    const tol = 10 * perPx();
    let best: P | null = null;
    let bestD = tol;
    for (const w of doc.walls) {
      if (w.id === opts.skipWall) continue;
      for (const q of [w.a, w.b]) {
        const d = dist(p, q);
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }
    }
    if (best) return { ...best };
    for (const w of doc.walls) {
      if (w.id === opts.skipWall) continue;
      const pr = project(w.a, w.b, p);
      if (pr.off < tol * 0.7 && pr.tRaw > 0 && pr.tRaw < wallLen(w)) return pr.at;
    }
    let q = { ...p };
    if (opts.from) {
      const d = sub(q, opts.from);
      const ang = Math.atan2(d.y, d.x);
      const step = Math.PI / 4;
      const snapped = Math.round(ang / step) * step;
      if (Math.abs(ang - snapped) < (5 * Math.PI) / 180) {
        const L = Math.hypot(d.x, d.y);
        q = { x: opts.from.x + Math.cos(snapped) * L, y: opts.from.y + Math.sin(snapped) * L };
      }
    }
    return { x: Math.round(q.x * 2) / 2, y: Math.round(q.y * 2) / 2 };
  };

  const wallAt = (p: P): { wall: Wall; t: number } | null => {
    let best: { wall: Wall; t: number; off: number } | null = null;
    for (const w of doc.walls) {
      const pr = project(w.a, w.b, p);
      const reach = w.thick / 2 + 8 * perPx();
      if (pr.off <= reach && (!best || pr.off < best.off)) best = { wall: w, t: pr.t, off: pr.off };
    }
    return best ? { wall: best.wall, t: best.t } : null;
  };

  const addOpeningAt = (p: P, kind: OpeningKind) => {
    const hit = wallAt(p);
    if (!hit) return;
    const next = clone(doc);
    const w = next.walls.find((x) => x.id === hit.wall.id)!;
    const L = wallLen(w);
    const width = Math.min(kind === "window" ? 36 : kind === "opening" ? 36 : 32, L - 2);
    const at = Math.max(width / 2, Math.min(L - width / 2, hit.t));
    const o: Opening = {
      id: newId("o"),
      wallId: w.id,
      kind,
      at,
      width,
      height: kind === "window" ? WINDOW_HEIGHT : DOOR_HEIGHT,
      sill: kind === "window" ? WINDOW_SILL : 0,
      ...(kind === "door" ? { hinge: "a" as const, swing: "left" as const } : {}),
    };
    next.openings.push(o);
    onChange(next, true);
    onSelect({ kind: "opening", id: o.id });
    onTool("select");
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), view: vb, mid: toPlan({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }) };
      drag.current = null;
      return;
    }
    const p = toPlan(e);
    if (calibrating) {
      const pts = [...calib, p];
      if (pts.length >= 2) {
        onCalibratePoints?.(pts[0], pts[1]);
        setCalib([]);
      } else setCalib(pts);
      return;
    }
    if (tool === "wall") {
      const q = snap(p, { from: draft[draft.length - 1] ?? null });
      if (draft.length && dist(q, draft[draft.length - 1]) > 1) {
        const prev = draft[draft.length - 1];
        const next = clone(doc);
        next.walls.push({ id: newId("w"), a: prev, b: q, thick: DEFAULT_INTERIOR, height: DEFAULT_CEILING, from: "drawn" });
        onChange(next, true);
      }
      // Clicking where the line started closes it.
      if (draft.length > 1 && dist(q, draft[0]) < 1) setDraft([]);
      else setDraft([...draft, q]);
      return;
    }
    if (tool === "room") {
      const q = snap(p);
      drag.current = { kind: "rect", a: q };
      setRect({ a: q, b: q });
      return;
    }
    if (tool === "door" || tool === "window" || tool === "opening") {
      addOpeningAt(p, tool);
      return;
    }
    if (tool.startsWith("place:")) {
      const libId = tool.slice(6);
      const e = lib(libId);
      const room = rooms.find((r) => pointInPoly(p, r.poly)) ?? (focus ? rooms.find((r) => r.labelId === focus) ?? null : null);
      const it = e ? newItemFrom(libId, { x: p.x, y: p.y, rot: 90, room: focus ?? room?.labelId ?? null }, newId("i")) : null;
      if (!it) return;
      const snapped = { ...it, ...snapToWall(doc, room, it, p) };
      const next = clone(doc);
      next.items = [...(next.items ?? []), snapToNeighbours(next.items ?? [], snapped)];
      onChange(next, true);
      onSelect({ kind: "item", id: it.id });
      onTool("select");
      return;
    }
    if (tool === "label") {
      const next = clone(doc);
      const id = newId("r");
      next.labels.push({ id, name: "Room", at: p, ceiling: DEFAULT_CEILING });
      onChange(next, true);
      onSelect({ kind: "label", id });
      onTool("select");
      return;
    }
    // Select: what's under the pointer, in front-to-back order.
    const target = (e.target as Element).closest("[data-hit]") as HTMLElement | SVGElement | null;
    const hit = target?.getAttribute("data-hit") ?? "";
    const [kind, id, end] = hit.split(":");
    if (kind === "end" && id && (end === "a" || end === "b")) {
      const w = doc.walls.find((x) => x.id === id);
      if (w) drag.current = { kind: "end", wall: id, end, from: { ...w[end] }, base: clone(doc) };
      return;
    }
    if (kind === "item" && id) {
      const it = (doc.items ?? []).find((x) => x.id === id);
      onSelect({ kind: "item", id });
      if (it) drag.current = { kind: "item", id, offset: sub({ x: it.x, y: it.y }, p), base: clone(doc) };
      return;
    }
    if (kind === "opening" && id) {
      onSelect({ kind: "opening", id });
      drag.current = { kind: "opening", id, base: clone(doc) };
      return;
    }
    if (kind === "label" && id) {
      const l = doc.labels.find((x) => x.id === id);
      onSelect({ kind: "label", id });
      if (l) drag.current = { kind: "label", id, offset: sub(l.at, p), base: clone(doc) };
      return;
    }
    if (kind === "wall" && id) {
      onSelect({ kind: "wall", id });
      drag.current = { kind: "wall", wall: id, start: p, base: clone(doc) };
      return;
    }
    if (kind === "room" && id) onSelect({ kind: "room", key: id });
    else onSelect(null);
    drag.current = { kind: "pan", start: p, view: vb, px: { x: e.clientX, y: e.clientY } };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const k = pinch.current.d / Math.max(1, d);
      const v = pinch.current.view;
      const m = pinch.current.mid;
      setView({ x: m.x - (m.x - v.x) * k, y: m.y - (m.y - v.y) * k, w: v.w * k, h: v.h * k });
      return;
    }
    const p = toPlan(e);
    setHover(p);
    const dr = drag.current;
    if (!dr) {
      if (rect) setRect(null);
      return;
    }
    if (dr.kind === "pan") {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r) return;
      const k = Math.max(dr.view.w / r.width, dr.view.h / r.height);
      setView({ ...dr.view, x: dr.view.x - (e.clientX - dr.px.x) * k, y: dr.view.y - (e.clientY - dr.px.y) * k });
      return;
    }
    if (dr.kind === "rect") {
      setRect({ a: dr.a, b: snap(p) });
      return;
    }
    if (dr.kind === "end") {
      const base = dr.base;
      const w = base.walls.find((x) => x.id === dr.wall)!;
      const other = dr.end === "a" ? w.b : w.a;
      const to = snap(p, { from: other, skipWall: dr.wall });
      const next = clone(base);
      moveCorner(next, dr.from, to);
      onChange(next, false);
      return;
    }
    if (dr.kind === "wall") {
      // Slide the wall square to itself; the walls joined at its ends follow.
      const base = dr.base;
      const w = base.walls.find((x) => x.id === dr.wall)!;
      const n = leftN(wallDir(w));
      const off = Math.round((sub(p, dr.start).x * n.x + sub(p, dr.start).y * n.y) * 2) / 2;
      const next = clone(base);
      const a2 = add(w.a, mulP(n, off));
      const b2 = add(w.b, mulP(n, off));
      moveCorner(next, w.a, a2);
      moveCorner(next, w.b, b2);
      const nw = next.walls.find((x) => x.id === dr.wall)!;
      nw.a = a2;
      nw.b = b2;
      onChange(next, false);
      return;
    }
    if (dr.kind === "opening") {
      const next = clone(dr.base);
      const o = next.openings.find((x) => x.id === dr.id);
      const w = o ? next.walls.find((x) => x.id === o.wallId) : null;
      if (!o || !w) return;
      const L = wallLen(w);
      o.at = Math.max(o.width / 2, Math.min(L - o.width / 2, Math.round(project(w.a, w.b, p).t * 2) / 2));
      onChange(next, false);
      return;
    }
    if (dr.kind === "item") {
      const next = clone(dr.base);
      const items = next.items ?? [];
      const i = items.findIndex((x) => x.id === dr.id);
      if (i < 0) return;
      const it = items[i];
      const to = add(p, dr.offset);
      const room = rooms.find((r) => pointInPoly(to, r.poly)) ?? (focus ? rooms.find((r) => r.labelId === focus) ?? null : null);
      const moved: DesignItem = { ...it, ...snapToWall(next, room, it, to) };
      items[i] = snapToNeighbours(items, moved);
      next.items = items;
      onChange(next, false);
      return;
    }
    if (dr.kind === "label") {
      const next = clone(dr.base);
      const l = next.labels.find((x) => x.id === dr.id);
      if (l) l.at = add(p, dr.offset);
      onChange(next, false);
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const dr = drag.current;
    drag.current = null;
    if (!dr) return;
    if (dr.kind === "rect") {
      const r = rect;
      setRect(null);
      if (!r) return;
      const x0 = Math.min(r.a.x, r.b.x);
      const x1 = Math.max(r.a.x, r.b.x);
      const y0 = Math.min(r.a.y, r.b.y);
      const y1 = Math.max(r.a.y, r.b.y);
      if (x1 - x0 < 24 || y1 - y0 < 24) return;
      const next = clone(doc);
      const c = [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ];
      for (let i = 0; i < 4; i++) next.walls.push({ id: newId("w"), a: c[i], b: c[(i + 1) % 4], thick: DEFAULT_INTERIOR, height: DEFAULT_CEILING, from: "drawn" });
      const id = newId("r");
      next.labels.push({ id, name: "Room", at: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, ceiling: DEFAULT_CEILING });
      onChange(next, true);
      onSelect({ kind: "label", id });
      onTool("select");
      return;
    }
    if (dr.kind !== "pan") onChange(doc, true);
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const p = toPlan(e);
    const k = Math.exp(e.deltaY * 0.0015);
    setView({ x: p.x - (p.x - vb.x) * k, y: p.y - (p.y - vb.y) * k, w: vb.w * k, h: vb.h * k });
  };

  // Escape ends a line being drawn or a tool; Delete removes the selection.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if ((e.key === "r" || e.key === "R") && selected?.kind === "item") {
        const next = clone(doc);
        const it = (next.items ?? []).find((x) => x.id === selected.id);
        if (it) {
          it.rot = (((it.rot + 90) % 360) + 360) % 360;
          it.wallId = null;
          onChange(next, true);
        }
        return;
      }
      if (e.key === "Escape") {
        setDraft([]);
        setRect(null);
        setCalib([]);
        if (tool !== "select") onTool("select");
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        const next = clone(doc);
        if (selected.kind === "wall") {
          next.walls = next.walls.filter((w) => w.id !== selected.id);
          next.openings = next.openings.filter((o) => o.wallId !== selected.id);
        } else if (selected.kind === "opening") next.openings = next.openings.filter((o) => o.id !== selected.id);
        else if (selected.kind === "label") next.labels = next.labels.filter((l) => l.id !== selected.id);
        else if (selected.kind === "item") next.items = (next.items ?? []).filter((x) => x.id !== selected.id);
        else return;
        onChange(next, true);
        onSelect(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, selected, tool, onChange, onSelect, onTool]);

  const px = perPx();
  const focusRoom = focus ? rooms.find((r) => r.labelId === focus) ?? null : null;
  const roomKeyOf = (r: Room) => r.labelId ?? r.key;
  const selWall = selected?.kind === "wall" ? doc.walls.find((w) => w.id === selected.id) ?? null : null;

  return (
    <svg
      ref={svgRef}
      className={className}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onWheel={onWheel}
      onDoubleClick={() => setDraft([])}
      style={{ touchAction: "none", cursor: tool === "select" ? "default" : "crosshair", userSelect: "none" }}
      role="application"
      aria-label="Floor plan editor"
      data-plan-editor
    >
      {underlay ? <image href={underlay.url} x={underlay.x} y={underlay.y} width={underlay.w} height={underlay.h} opacity={underlay.opacity ?? 0.45} preserveAspectRatio="none" /> : null}

      {/* Rooms: tinted, named, with their floor area. */}
      {rooms.map((r, i) => {
        const key = roomKeyOf(r);
        const on = selected?.kind === "room" && selected.key === key;
        const quiet = focusRoom && r !== focusRoom;
        return (
          <polygon
            key={r.key}
            points={r.poly.map((p) => `${p.x},${p.y}`).join(" ")}
            fill={ROOM_TINT[i % ROOM_TINT.length]}
            opacity={quiet ? 0.35 : on ? 1 : 0.8}
            stroke={on ? "#1d4ed8" : "none"}
            strokeWidth={2 * px}
            data-hit={`room:${key}`}
            data-room={r.name}
          />
        );
      })}

      {/* The plan's own cabinets, appliances and fixtures. */}
      {doc.marks.map((m) => (
        <g key={m.id} stroke={MARK_INK[m.role]} strokeWidth={Math.max(0.35, 0.9 * px)} fill="none" pointerEvents="none" opacity={0.85}>
          {m.lines.map(([a, b], i) => (
            <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          ))}
        </g>
      ))}

      {/* Where walls stood before the design took them out. */}
      {ghosts.map((w) => (
        <polygon key={`ghost${w.id}`} points={wallQuad(w).map((p) => `${p.x},${p.y}`).join(" ")} fill="#fde2e2" stroke="#c0262d" strokeWidth={1.2 * px} strokeDasharray={`${5 * px} ${3 * px}`} pointerEvents="none" data-design-ghost={w.id} />
      ))}

      {/* Walls, cut where their openings are. */}
      {doc.walls.map((w) => {
        const on = selWall?.id === w.id;
        const flagged = flags?.has(w.id);
        const pieces = wallPieces(w, doc.openings).filter((pc) => pc.z0 === 0 && pc.z1 >= w.height - 0.5);
        return (
          <g key={w.id} data-hit={`wall:${w.id}`} style={{ cursor: tool === "select" ? "move" : undefined }}>
            {pieces.map((pc, i) => (
              <polygon key={i} points={wallQuad(w, pc.t0, pc.t1).map((p) => `${p.x},${p.y}`).join(" ")} fill={on ? "#1d4ed8" : flagged ? "#c0262d" : w.exterior ? "#0f172a" : "#334155"} />
            ))}
            {/* A wider invisible band makes a thin wall easy to grab. */}
            <line x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="transparent" strokeWidth={Math.max(w.thick, 14 * px)} />
          </g>
        );
      })}

      {/* Doors (swing), windows (glass), openings (gap). */}
      {doc.openings.map((o) => {
        const w = doc.walls.find((x) => x.id === o.wallId);
        if (!w) return null;
        const on = selected?.kind === "opening" && selected.id === o.id;
        const d = wallDir(w);
        const n = leftN(d);
        const t0 = o.at - o.width / 2;
        const t1 = o.at + o.width / 2;
        const q = wallQuad(w, t0, t1);
        const ink = on ? "#1d4ed8" : o.kind === "window" ? "#0369a1" : "#b91c1c";
        const side = o.swing === "right" ? -1 : 1;
        const swing = (hingeT: number, width: number, toward: 1 | -1) => {
          const h = add(along(w, hingeT), mulP(n, side * (w.thick / 2)));
          const tipOpen = add(h, mulP(n, side * width));
          const tipShut = add(h, mulP(d, toward * width));
          const sweep = (side > 0) === (toward > 0) ? 0 : 1;
          return (
            <>
              <line x1={h.x} y1={h.y} x2={tipOpen.x} y2={tipOpen.y} stroke={ink} strokeWidth={1.4 * px} />
              <path d={`M ${tipOpen.x} ${tipOpen.y} A ${width} ${width} 0 0 ${sweep} ${tipShut.x} ${tipShut.y}`} fill="none" stroke={ink} strokeWidth={0.9 * px} strokeDasharray={`${3 * px} ${2 * px}`} />
            </>
          );
        };
        return (
          <g key={o.id} data-hit={`opening:${o.id}`} style={{ cursor: tool === "select" ? "ew-resize" : undefined }}>
            <polygon points={q.map((p) => `${p.x},${p.y}`).join(" ")} fill={o.kind === "window" ? "#e0f2fe" : "#fff"} stroke={ink} strokeWidth={1 * px} />
            {o.kind === "window" ? <line x1={along(w, t0).x} y1={along(w, t0).y} x2={along(w, t1).x} y2={along(w, t1).y} stroke={ink} strokeWidth={1.2 * px} /> : null}
            {o.kind === "door" ? (o.hinge === "b" ? swing(t1, o.width, -1) : swing(t0, o.width, 1)) : null}
            {o.kind === "double" ? (
              <>
                {swing(t0, o.width / 2, 1)}
                {swing(t1, o.width / 2, -1)}
              </>
            ) : null}
            {o.kind === "slider" ? (
              <>
                <line x1={along(w, t0).x + n.x * 1.2} y1={along(w, t0).y + n.y * 1.2} x2={along(w, o.at + 2).x + n.x * 1.2} y2={along(w, o.at + 2).y + n.y * 1.2} stroke={ink} strokeWidth={1.4 * px} />
                <line x1={along(w, o.at - 2).x - n.x * 1.2} y1={along(w, o.at - 2).y - n.y * 1.2} x2={along(w, t1).x - n.x * 1.2} y2={along(w, t1).y - n.y * 1.2} stroke={ink} strokeWidth={1.4 * px} />
              </>
            ) : null}
            <line x1={along(w, o.at).x} y1={along(w, o.at).y} x2={along(w, o.at).x} y2={along(w, o.at).y} stroke="transparent" strokeWidth={Math.max(o.width, 16 * px)} strokeLinecap="round" />
          </g>
        );
      })}

      {/* What's placed: floor things solid, wall cabinets dashed (the plan convention), lights as symbols. */}
      {[...(doc.items ?? [])]
        .sort((a, b) => (a.z >= 40 ? 1 : 0) - (b.z >= 40 ? 1 : 0))
        .map((it) => {
          const e = lib(it.lib);
          const on = selected?.kind === "item" && selected.id === it.id;
          const quiet = focusRoom && it.room && it.room !== focus;
          const c = cornersOf(it);
          const pts = c.map((q) => `${q.x},${q.y}`).join(" ");
          const ink = on ? "#1d4ed8" : "#334155";
          if (e?.cat === "light") {
            const r = Math.max(it.w / 2, 3);
            return (
              <g key={it.id} data-hit={`item:${it.id}`} data-item-code={itemCode(it)} opacity={quiet ? 0.4 : 1} style={{ cursor: tool === "select" ? "move" : undefined }}>
                <circle cx={it.x} cy={it.y} r={r} fill={it.lib === "PEN" ? "#fef3c7" : "#fff"} stroke={on ? "#1d4ed8" : "#b45309"} strokeWidth={1.2 * px} />
                <line x1={it.x - r} y1={it.y - r} x2={it.x + r} y2={it.y + r} stroke="#b45309" strokeWidth={0.8 * px} />
                <line x1={it.x - r} y1={it.y + r} x2={it.x + r} y2={it.y - r} stroke="#b45309" strokeWidth={0.8 * px} />
              </g>
            );
          }
          const wallHung = it.z >= 40;
          const fill = wallHung ? "none" : e?.cat === "appliance" ? "#e2e8f0" : e?.cat === "furniture" ? "#f8fafc" : e?.cat === "island" ? "#ead9bf" : "#f1e6d2";
          const front = [c[2], c[3]];
          const code = itemCode(it);
          const fs = Math.max(4, Math.min(it.w / Math.max(3, code.length) * 1.5, it.d * 0.5, 10));
          return (
            <g key={it.id} data-hit={`item:${it.id}`} data-item-code={code} data-flagged={flags?.has(it.id) ? "" : undefined} opacity={quiet ? 0.45 : 1} style={{ cursor: tool === "select" ? "move" : undefined }}>
              {flags?.has(it.id) ? <polygon points={pts} fill="none" stroke="#c0262d" strokeWidth={4 * px} strokeOpacity={0.55} pointerEvents="none" /> : null}
              <polygon points={pts} fill={fill} stroke={ink} strokeWidth={(on ? 2 : 1) * px} strokeDasharray={wallHung ? `${4 * px} ${3 * px}` : undefined} />
              {!wallHung ? <line x1={front[0].x} y1={front[0].y} x2={front[1].x} y2={front[1].y} stroke={ink} strokeWidth={(on ? 2.4 : 1.6) * px} /> : null}
              {it.opts?.sink ? <ellipse cx={(c[0].x + c[2].x) / 2} cy={(c[0].y + c[2].y) / 2} rx={Math.min(it.w, it.d) * 0.3} ry={Math.min(it.w, it.d) * 0.22} fill="#fff" stroke={ink} strokeWidth={0.8 * px} /> : null}
              {(on || (!wallHung && e?.cat !== "furniture" && it.lib !== "CT")) && it.w >= 6 ? (
                <text x={it.x} y={it.y + fs * 0.35} textAnchor="middle" fontSize={fs} fontWeight={800} fill={ink} pointerEvents="none">
                  {code}
                </text>
              ) : null}
            </g>
          );
        })}

      {/* Room names and areas. */}
      {rooms.map((r) => {
        const label = r.labelId ? doc.labels.find((l) => l.id === r.labelId) : null;
        const at = label?.at ?? centroid(r.poly);
        const quiet = focusRoom && r !== focusRoom;
        const fs = Math.max(8, Math.min(16, 13 * px * 1.1)) ;
        return (
          <g key={`t${r.key}`} data-hit={label ? `label:${label.id}` : `room:${roomKeyOf(r)}`} opacity={quiet ? 0.5 : 1} style={{ cursor: label && tool === "select" ? "move" : undefined }}>
            <text x={at.x} y={at.y} textAnchor="middle" fontSize={fs} fontWeight={800} fill="#0f172a" style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {r.names.length > 1 ? r.names.join(" · ") : r.name}
            </text>
            <text x={at.x} y={at.y + fs * 1.15} textAnchor="middle" fontSize={fs * 0.8} fill="#475569">
              {Math.round(r.sqft)} sq ft
            </text>
          </g>
        );
      })}
      {/* Labels not inside any room (a wall missing) still show, so they can be dragged in. */}
      {doc.labels
        .filter((l) => !rooms.some((r) => r.labelId === l.id || r.names.includes(l.name)))
        .map((l) => (
          <text key={l.id} x={l.at.x} y={l.at.y} textAnchor="middle" fontSize={12 * px * 1.1} fontWeight={800} fill="#b45309" data-hit={`label:${l.id}`}>
            {l.name} (open)
          </text>
        ))}

      {/* The selected wall: its length and its two ends to drag. */}
      {selWall ? (
        <g>
          {(() => {
            const mid = along(selWall, wallLen(selWall) / 2);
            const n = leftN(wallDir(selWall));
            const tp = add(mid, mulP(n, selWall.thick / 2 + 14 * px));
            return (
              <text x={tp.x} y={tp.y} textAnchor="middle" fontSize={12 * px} fontWeight={800} fill="#1d4ed8" pointerEvents="none">
                {ftIn(wallLen(selWall))}
              </text>
            );
          })()}
          {(["a", "b"] as const).map((end) => (
            <circle key={end} cx={selWall[end].x} cy={selWall[end].y} r={7 * px} fill="#fff" stroke="#1d4ed8" strokeWidth={2 * px} data-hit={`end:${selWall.id}:${end}`} style={{ cursor: "grab" }} />
          ))}
        </g>
      ) : null}

      {/* A line being drawn, a room being dragged out, calibration clicks. */}
      {draft.length ? (
        <polyline points={[...draft, ...(hover ? [snap(hover, { from: draft[draft.length - 1] })] : [])].map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#1d4ed8" strokeWidth={DEFAULT_INTERIOR} strokeOpacity={0.5} pointerEvents="none" />
      ) : null}
      {draft.length && hover ? (
        (() => {
          const a = draft[draft.length - 1];
          const b = snap(hover, { from: a });
          return (
            <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 8 * px} textAnchor="middle" fontSize={12 * px} fontWeight={800} fill="#1d4ed8" pointerEvents="none">
              {ftIn(dist(a, b))}
            </text>
          );
        })()
      ) : null}
      {rect ? (
        <g pointerEvents="none">
          <rect x={Math.min(rect.a.x, rect.b.x)} y={Math.min(rect.a.y, rect.b.y)} width={Math.abs(rect.b.x - rect.a.x)} height={Math.abs(rect.b.y - rect.a.y)} fill="#1d4ed8" fillOpacity={0.08} stroke="#1d4ed8" strokeWidth={DEFAULT_INTERIOR} strokeOpacity={0.6} />
          <text x={(rect.a.x + rect.b.x) / 2} y={Math.min(rect.a.y, rect.b.y) - 8 * px} textAnchor="middle" fontSize={12 * px} fontWeight={800} fill="#1d4ed8">
            {ftIn(Math.abs(rect.b.x - rect.a.x))} × {ftIn(Math.abs(rect.b.y - rect.a.y))}
          </text>
        </g>
      ) : null}
      {calib.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={5 * px} fill="#dc2626" pointerEvents="none" />
      ))}
      {calibrating && calib.length === 1 && hover ? <line x1={calib[0].x} y1={calib[0].y} x2={hover.x} y2={hover.y} stroke="#dc2626" strokeWidth={2 * px} pointerEvents="none" /> : null}
    </svg>
  );
}

/** The wall's length changed in the panel: move its b end along it. */
export function setWallLength(doc: DesignDoc, id: string, length: number): DesignDoc {
  const next = clone(doc);
  const w = next.walls.find((x) => x.id === id);
  if (!w || length < 6) return doc;
  const to = add(w.a, mulP(unit(sub(w.b, w.a)), length));
  moveCorner(next, w.b, to);
  return next;
}
