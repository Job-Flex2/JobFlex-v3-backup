// THE PLAN'S OWN LINES (Home Design Studio, 2026-10-17). An architect's PDF is drawn, not photographed: every
// wall, door swing and window is a path with exact coordinates, and a CAD export usually keeps its layers by name
// ("A-WALL", "EJN - DOORS - N"). This walks pdf.js's operator list for one page and hands back every stroked or
// filled line in SHEET points (1/72 in, y down, the page's own top-left origin), each with its line weight and the
// layer it was drawn on — the raw material lib/design/planRead turns into walls, openings and rooms.
// Pure: no pdf.js import here (the caller passes the OPS table), so it runs in the browser and in a node check.

export type Pt = { x: number; y: number };

/** One straight piece of a drawn path, in sheet points. Curves arrive flattened, marked `curve`. */
export type VSeg = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Drawn line weight in points (0 = hairline). */
  w: number;
  /** The CAD layer's name, "" when the PDF keeps none. */
  layer: string;
  /** Part of a curve (a door swing, a fixture's outline). */
  curve?: boolean;
  /** Painted as a fill (a wall poché), not a stroke. */
  fill?: boolean;
  /** Which path it came from — pieces of one path share it. */
  path: number;
};

/** A curve kept whole: door swings are found from these. */
export type VArc = { pts: Pt[]; layer: string; path: number };

export type VectorSheet = {
  /** Sheet size in points. */
  width: number;
  height: number;
  segs: VSeg[];
  arcs: VArc[];
  /** Layer names that drew at least one path, with how many. */
  layers: Record<string, number>;
};

/** The subset of pdf.js's OPS table this needs (pdfjs.OPS passes as is). */
export type OpsTable = Record<string, number>;

type M6 = [number, number, number, number, number, number];
const mul = (m1: M6, m2: M6): M6 => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];
const apply = (m: M6, x: number, y: number): Pt => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** Cubic Bézier → a few points (enough to see a quarter-circle door swing). */
function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 8): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

/**
 * Walk one page's operator list. `viewport` is the page's scale-1 viewport transform (pdf.js
 * `page.getViewport({scale:1}).transform`): it turns PDF user space into sheet points with y down.
 * `layerName` resolves an optional-content id to its name (pdf.js `optionalContentConfig.getGroup(id)?.name`).
 * Big sheets carry tens of thousands of paths; hatch fill can be skipped by layer to keep it quick.
 */
export function readVectorSheet(input: {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
  OPS: OpsTable;
  viewport: M6;
  width: number;
  height: number;
  layerName?: (id: string) => string | null | undefined;
  /** Layers not worth reading (wall hatching: thousands of tiny strokes). */
  skipLayer?: (name: string) => boolean;
}): VectorSheet {
  const { fnArray, argsArray, OPS } = input;
  const segs: VSeg[] = [];
  const arcs: VArc[] = [];
  const layers: Record<string, number> = {};
  const nameCache = new Map<string, string>();
  const layerOf = (id: string) => {
    let n = nameCache.get(id);
    if (n === undefined) {
      n = (input.layerName?.(id) ?? "") || "";
      nameCache.set(id, n);
    }
    return n;
  };

  type G = { ctm: M6; lw: number };
  let g: G = { ctm: input.viewport, lw: 1 };
  const stack: G[] = [];
  const mc: string[] = []; // marked-content layer stack ("" for untagged sections)
  let pending: { pieces: Array<{ a: Pt; b: Pt; curve?: boolean }>; curves: Pt[][] } | null = null;
  let pathNo = 0;

  const scaleOf = (m: M6) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  const currentLayer = () => {
    for (let i = mc.length - 1; i >= 0; i--) if (mc[i]) return mc[i];
    return "";
  };

  const build = (ops: ArrayLike<number>, args: ArrayLike<number>) => {
    const pieces: Array<{ a: Pt; b: Pt; curve?: boolean }> = [];
    const curves: Pt[][] = [];
    let k = 0;
    let cur: Pt | null = null;
    let start: Pt | null = null;
    const m = g.ctm;
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op === OPS.moveTo) {
        cur = apply(m, args[k], args[k + 1]);
        start = cur;
        k += 2;
      } else if (op === OPS.lineTo) {
        const p = apply(m, args[k], args[k + 1]);
        if (cur) pieces.push({ a: cur, b: p });
        cur = p;
        k += 2;
      } else if (op === OPS.curveTo || op === OPS.curveTo2 || op === OPS.curveTo3) {
        // curveTo: x1 y1 x2 y2 x3 y3 · curveTo2 (v): x2 y2 x3 y3 (first control = current) · curveTo3 (y): x1 y1 x3 y3
        let c1: Pt, c2: Pt, end: Pt;
        if (op === OPS.curveTo) {
          c1 = apply(m, args[k], args[k + 1]);
          c2 = apply(m, args[k + 2], args[k + 3]);
          end = apply(m, args[k + 4], args[k + 5]);
          k += 6;
        } else if (op === OPS.curveTo2) {
          c1 = cur ?? apply(m, args[k], args[k + 1]);
          c2 = apply(m, args[k], args[k + 1]);
          end = apply(m, args[k + 2], args[k + 3]);
          k += 4;
        } else {
          c1 = apply(m, args[k], args[k + 1]);
          end = apply(m, args[k + 2], args[k + 3]);
          c2 = end;
          k += 4;
        }
        if (cur) {
          const pts = [cur, ...bezier(cur, c1, c2, end)];
          curves.push(pts);
          for (let j = 1; j < pts.length; j++) pieces.push({ a: pts[j - 1], b: pts[j], curve: true });
        }
        cur = end;
      } else if (op === OPS.closePath) {
        if (cur && start && (cur.x !== start.x || cur.y !== start.y)) pieces.push({ a: cur, b: start });
        cur = start;
      } else if (op === OPS.rectangle) {
        const [x, y, w, h] = [args[k], args[k + 1], args[k + 2], args[k + 3]];
        k += 4;
        const p = [apply(m, x, y), apply(m, x + w, y), apply(m, x + w, y + h), apply(m, x, y + h)];
        for (let j = 0; j < 4; j++) pieces.push({ a: p[j], b: p[(j + 1) % 4] });
        cur = start = p[0];
      }
    }
    return { pieces, curves };
  };

  const paint = (fill: boolean) => {
    if (!pending) return;
    const layer = currentLayer();
    if (input.skipLayer?.(layer)) {
      pending = null;
      return;
    }
    const w = g.lw * scaleOf(g.ctm);
    const path = pathNo++;
    layers[layer] = (layers[layer] ?? 0) + 1;
    for (const p of pending.pieces) {
      if (p.a.x === p.b.x && p.a.y === p.b.y) continue;
      segs.push({ x1: p.a.x, y1: p.a.y, x2: p.b.x, y2: p.b.y, w, layer, path, ...(p.curve ? { curve: true } : {}), ...(fill ? { fill: true } : {}) });
    }
    for (const c of pending.curves) arcs.push({ pts: c, layer, path });
    pending = null;
  };

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[];
    switch (fn) {
      case OPS.save:
        stack.push({ ...g });
        break;
      case OPS.restore:
        g = stack.pop() ?? g;
        break;
      case OPS.transform:
        g = { ...g, ctm: mul(g.ctm, args as unknown as M6) };
        break;
      case OPS.paintFormXObjectBegin: {
        stack.push({ ...g });
        const mtx = args?.[0] as M6 | null | undefined;
        if (Array.isArray(mtx) && mtx.length === 6) g = { ...g, ctm: mul(g.ctm, mtx as M6) };
        break;
      }
      case OPS.paintFormXObjectEnd:
        g = stack.pop() ?? g;
        break;
      case OPS.setLineWidth:
        g = { ...g, lw: Number(args?.[0]) || 0 };
        break;
      case OPS.beginMarkedContentProps: {
        const props = args?.[1] as { type?: string; id?: string } | null | undefined;
        mc.push(args?.[0] === "OC" && props?.id ? layerOf(String(props.id)) : "");
        break;
      }
      case OPS.beginMarkedContent:
        mc.push("");
        break;
      case OPS.endMarkedContent:
        mc.pop();
        break;
      case OPS.constructPath: {
        const [ops, a] = args as [ArrayLike<number>, ArrayLike<number>];
        const built = build(ops, a);
        // Several constructPath calls can precede one paint: they add up.
        if (pending) {
          pending.pieces.push(...built.pieces);
          pending.curves.push(...built.curves);
        } else pending = built;
        break;
      }
      case OPS.stroke:
      case OPS.closeStroke:
        paint(false);
        break;
      case OPS.fill:
      case OPS.eoFill:
        paint(true);
        break;
      case OPS.fillStroke:
      case OPS.eoFillStroke:
      case OPS.closeFillStroke:
      case OPS.closeEOFillStroke:
        paint(false);
        break;
      case OPS.endPath:
        pending = null;
        break;
      default:
        break;
    }
  }
  return { width: input.width, height: input.height, segs, arcs, layers };
}

/* ── What a layer holds, from its name ─────────────────────────────────────────────────────────────────────────── */

export type LayerRole = "wall" | "wallFill" | "door" | "window" | "cabinet" | "appliance" | "plumbing" | "roomName" | "dims" | "elevation" | "other";

/** A CAD layer's role from its name (AIA "A-WALL", "A-DOOR", "A-GLAZ", or a firm's own "WALLS - N"). */
export function layerRole(name: string): LayerRole {
  const n = name.toLowerCase();
  if (!n) return "other";
  // Elevations, sections and roofs draw walls and doors too — never read them as the plan.
  if (/elev|section|sect\b|roof|detail|\bdtl\b/.test(n)) return "elevation";
  if (/hatch|poch|patt|fill/.test(n) && /wall|wal\b/.test(n)) return "wallFill";
  if (/a-?wall|\bwalls?\b|\bwal\b|partition/.test(n)) return "wall";
  if (/door|a-?dr\b/.test(n)) return "door";
  if (/window|glaz|a-?wdw|\bwin\b/.test(n)) return "window";
  if (/cabinet|casework|millwork|\bcab\b|counter/.test(n)) return "cabinet";
  if (/appliance|equip|\bappl\b/.test(n)) return "appliance";
  if (/plumb|fixture|\bfixt\b|p-?fixt/.test(n)) return "plumbing";
  if (/room.?(name|tag|label|iden)|rm.?name|space.?name|area.?name/.test(n)) return "roomName";
  if (/\bdims?\b|dimension|anno/.test(n)) return "dims";
  return "other";
}
