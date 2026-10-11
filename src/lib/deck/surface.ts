// THE BOARDS ON TOP (2026-10-04; patterns, borders and shaped fronts M3 2026-10-10) — pure.
//
// Rows of deck boards over the frame, and the fascia around it. The frame
// says where the deck is; this says how many boards of which length to buy
// and where each one lies, so the 3D can lay them down one by one.
//
// HOW BOARDS ARE BOUGHT. A row no longer than the longest stock is one
// board — or half of one, when two rows come out of a single board. A row
// longer than stock is spliced: full boards and one cut piece, the splice
// landing on a joist (12, 16 and 20 ft all fall on a 12-, 16- or 24-in.
// layout), every second row turned end for end so the joints stagger. Of
// the ways to buy a row the one with the least lumber bought wins; fewer
// joints breaks a tie. The waste allowance is added in the stock length the
// job uses most.
//
// PATTERNS. Boards on the diagonal are bought by the foot of board the deck
// swallows, in the longest stock, with 5 points more waste than the
// contractor set — a diagonal throws away a triangle at both ends of every
// board; a herringbone 5 more, and its centre seam wants a doubled joist.
// A picture-frame BORDER (one or two boards along the open edges) is bought
// by the edge's length with 5% for the mitres; the field runs inside it.
//
// A SHAPED FRONT (a bow or clipped corners) cuts the last rows to the line:
// those pieces come out as flat rings the 3D draws clipped, and are bought
// by the rectangle that holds them.

import type { DeckFrame } from "./frame";
import type { DeckingProduct } from "./catalog";
import { frontEdgeAt, shapeOutline } from "./design";

/** One board, or one piece of a spliced row, inches. */
export interface BoardPiece {
  /** Centre of the piece. */
  cx: number;
  cy: number;
  /** Its length along the house and its width out from it. */
  sx: number;
  sy: number;
  /** A border piece turned in plan: its axis's direction, radians from +x. */
  yaw?: number;
  /** A border piece. */
  border?: boolean;
}

export interface DeckSurface {
  product: DeckingProduct;
  diagonal: boolean;
  pattern: "straight" | "diagonal" | "herringbone";
  /** Border boards along the open edges (0, 1 or 2) and the feet of board they take. */
  border: number;
  borderLf: number;
  /** Rows of boards across the deepest part of the deck. */
  rows: number;
  /** Every square piece, for the 3D (square-laid boards only; a diagonal is drawn from the outline). */
  pieces: BoardPiece[];
  /** Pieces cut to the front's shape, as flat rings [x, y, x, y, …] inches, for the 3D. */
  shaped: number[][];
  /** What to buy: boards per stock length, waste included. */
  stock: Array<{ lengthFt: number; count: number }>;
  /** Feet of board the deck needs, and feet bought. */
  netLf: number;
  boughtLf: number;
  /** The waste the purchase was figured with, percent. */
  wastePct: number;
  /** Times a board crosses a joist — two screws or one clip each. */
  crossings: number;
  fastening: "screws" | "hidden";
  fascia: {
    on: boolean;
    kind: "wood" | "composite";
    /** Feet of open edge it covers, the board's height, and 12-ft boards to buy. */
    lf: number;
    heightIn: number;
    boards: number;
  };
}

interface RowPlan {
  /** One row's pieces, left to right, inches. */
  cuts: number[];
  /** Boards to buy for `rows` such rows, by stock length (ft). */
  buy: Map<number, number>;
  boughtIn: number;
  joints: number;
}

/** The cheapest way to buy `rows` rows `lengthIn` long from `stocksFt`. */
export function planRow(lengthIn: number, rows: number, stocksFt: readonly number[]): RowPlan {
  const stocks = [...stocksFt].sort((a, b) => a - b);
  const longest = stocks[stocks.length - 1] * 12;
  const plans: RowPlan[] = [];
  // A piece no longer than stock: the stock that wastes least, several rows from one board where they fit.
  const piece = (len: number): { stock: number; per: number; boards: number; bought: number } => {
    let best: { stock: number; per: number; boards: number; bought: number } | null = null;
    for (const s of stocks) {
      const per = Math.floor((s * 12) / len + 1e-9);
      if (per < 1) continue;
      const boards = Math.ceil(rows / per - 1e-9);
      const bought = boards * s * 12;
      if (!best || bought < best.bought) best = { stock: s, per, boards, bought };
    }
    return best ?? { stock: stocks[stocks.length - 1], per: 1, boards: rows, bought: rows * longest };
  };
  const add = (buy: Map<number, number>, stock: number, n: number) => buy.set(stock, (buy.get(stock) ?? 0) + n);
  if (lengthIn <= longest + 1e-6) {
    const p = piece(lengthIn);
    const buy = new Map<number, number>();
    add(buy, p.stock, p.boards);
    plans.push({ cuts: [lengthIn], buy, boughtIn: p.bought, joints: 0 });
  }
  // Spliced — only a row longer than any board: whole boards of one stock length, then the piece that is left.
  for (const s of lengthIn <= longest + 1e-6 ? [] : stocks) {
    const full = s * 12;
    for (let n = 1; n * full < lengthIn - 1e-6 && n <= 6; n++) {
      const rest = lengthIn - n * full;
      if (rest > longest + 1e-6 || rest < 12) continue;
      const p = piece(rest);
      const buy = new Map<number, number>();
      add(buy, s, n * rows);
      add(buy, p.stock, p.boards);
      plans.push({ cuts: [...new Array<number>(n).fill(full), rest], buy, boughtIn: n * rows * full + p.bought, joints: n });
    }
  }
  if (plans.length === 0) {
    // Longer than anything above reaches: all longest boards, the last one cut.
    const n = Math.ceil(lengthIn / longest - 1e-9);
    const buy = new Map<number, number>();
    add(buy, stocks[stocks.length - 1], n * rows);
    const cuts = new Array<number>(n - 1).fill(longest);
    cuts.push(lengthIn - (n - 1) * longest);
    return { cuts, buy, boughtIn: n * rows * longest, joints: n - 1 };
  }
  return plans.reduce((m, p) => (p.boughtIn < m.boughtIn - 1e-6 || (Math.abs(p.boughtIn - m.boughtIn) <= 1e-6 && p.joints < m.joints) ? p : m));
}

/** A convex ring clipped to a half-plane: keep the side where ax + by ≤ c. */
function clipHalf(ring: Array<[number, number]>, a: number, b: number, c: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const fp = a * p[0] + b * p[1] - c;
    const fq = a * q[0] + b * q[1] - c;
    if (fp <= 0) out.push(p);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
      const t = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/** A rectangle clipped to the deck's outline (convex for a rectangle with a shaped front). */
export function clipToOutline(x0: number, y0: number, x1: number, y1: number, outline: Array<{ x: number; y: number }>): Array<[number, number]> {
  let ring: Array<[number, number]> = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  // The outline runs clockwise in plan (x right, y down the page): keep the right-hand side of each edge.
  for (let i = 0; i < outline.length && ring.length; i++) {
    const A = outline[i];
    const B = outline[(i + 1) % outline.length];
    const ex = B.x - A.x;
    const ey = B.y - A.y;
    // Inside is where e × (p − A) ≥ 0, i.e. ex·(py − Ay) − ey·(px − Ax) ≥ 0 → keep ey·px − ex·py ≤ ey·Ax − ex·Ay.
    ring = clipHalf(ring, ey, -ex, ey * A.x - ex * A.y);
  }
  return ring;
}

const ringArea = (ring: Array<[number, number]>) => Math.abs(ring.reduce((a, p, i) => a + p[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * p[1], 0)) / 2;

/** The boards and the fascia for a frame. */
export function deckSurface(frame: DeckFrame): DeckSurface {
  const { design, decking: product } = frame;
  const pattern = design.decking.pattern;
  const diagonal = pattern !== "straight";
  const zones = frame.zones.map((z) => z.zone);
  const W = Math.max(...zones.map((z) => z.x1));
  const depth = Math.max(...zones.map((z) => z.y1));
  const pitch = product.widthIn + product.gapIn;
  const againstHouse = design.placement !== "detached";
  const front = design.shape.kind === "rect" ? design.shape.front : undefined;
  const shaped = !!front && front.kind !== "straight";
  const bulgeIn = front?.kind === "curve" ? front.bulgeFt * 12 : 0;
  const outline = shapeOutline(design.shape);
  const frontAt = (x: number) => (shaped ? frontEdgeAt(design.shape, x) : depth);
  const farthest = depth + bulgeIn;
  // A quarter inch off the wall, so water and the siding have room.
  const first = againstHouse ? 0.25 : 0;
  const borderBoards = design.shape.kind === "rect" ? design.decking.border : 0;
  const borderIn = borderBoards * pitch;
  const rows = Math.max(1, Math.ceil((farthest - first + product.gapIn) / pitch - 1e-9));
  const wastePct = design.decking.wastePct + (diagonal ? 5 : 0) + (pattern === "herringbone" ? 5 : 0) + (borderBoards ? 3 : 0);
  const joistXs = frame.joists.filter((j) => !j.sister).map((j) => j.x);
  const open = (side: "left" | "right" | "front") => frame.edges.some((e) => e.side === side && !e.house);

  const pieces: BoardPiece[] = [];
  const shapedPieces: number[][] = [];
  const buy = new Map<number, number>();
  let netIn = 0;
  let crossings = 0;
  let borderLf = 0;

  // The field: inside the border on the open sides, up to the front's line.
  const fieldX0 = open("left") ? borderIn : 0;
  const fieldX1 = W - (open("right") ? borderIn : 0);
  const fieldFront = (x: number) => frontAt(x) - borderIn;

  /** Where the field's row at depth y0 (its near edge) runs, on a shaped front: the x range where the front is still past it. */
  const rowRange = (y0: number): [number, number] | null => {
    if (!shaped) return [fieldX0, fieldX1];
    if (fieldFront(W / 2) < y0 + 0.5) return null;
    // Symmetric about the middle: find the left end where the front first reaches y0.
    let lo = 0;
    let hi = W / 2;
    if (fieldFront(lo) >= y0 + 0.5) return [fieldX0, fieldX1];
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fieldFront(mid) >= y0 + 0.5) hi = mid;
      else lo = mid;
    }
    return [Math.max(fieldX0, hi), Math.min(fieldX1, W - hi)];
  };

  if (!diagonal) {
    // Rows by the length of deck under them; an L has two lengths, a shaped front its own at every row.
    const groups = new Map<string, { x0: number; x1: number; ys: Array<{ y: number; w: number; cut: boolean }> }>();
    for (let r = 0; r < rows; r++) {
      const y0 = first + r * pitch;
      const far = shaped ? farthest - borderIn : depth - (open("front") ? borderIn : 0);
      const w = Math.min(product.widthIn, far - y0);
      if (!(w > 0.25)) continue;
      const yc = y0 + w / 2;
      let x0: number;
      let x1: number;
      let cut = false;
      if (shaped) {
        const range = rowRange(y0);
        if (!range) continue;
        [x0, x1] = range;
        // The row is cut to the line when its far edge is past the front anywhere along it.
        cut = fieldFront(x0 + 0.01) < y0 + w + 0.5 || fieldFront(x1 - 0.01) < y0 + w + 0.5;
      } else {
        const under = zones.filter((z) => yc >= z.y0 && yc <= z.y1);
        if (under.length === 0) continue;
        x0 = Math.max(fieldX0, Math.min(...under.map((z) => z.x0)));
        x1 = Math.min(fieldX1, Math.max(...under.map((z) => z.x1)));
      }
      if (!(x1 - x0 > 2)) continue;
      const key = `${Math.round(x0)}:${Math.round(x1)}`;
      const g = groups.get(key) ?? { x0, x1, ys: [] };
      g.ys.push({ y: yc, w, cut });
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const length = g.x1 - g.x0;
      const plan = planRow(length, g.ys.length, product.lengthsFt);
      for (const [stock, n] of plan.buy) buy.set(stock, (buy.get(stock) ?? 0) + n);
      netIn += length * g.ys.length;
      crossings += g.ys.length * joistXs.filter((x) => x > g.x0 && x < g.x1).length;
      g.ys.forEach((row, i) => {
        // Every second row runs the other way, so the joints stagger.
        const cuts = i % 2 === 0 ? plan.cuts : [...plan.cuts].reverse();
        let at = g.x0;
        for (const c of cuts) {
          if (row.cut) {
            const ring = clipToOutline(at, row.y - row.w / 2, at + c, row.y + row.w / 2, outline);
            if (ring.length >= 3 && ringArea(ring) > 4) shapedPieces.push(ring.flatMap((p) => [p[0], p[1]]));
          } else pieces.push({ cx: at + c / 2, cy: row.y, sx: c, sy: row.w });
          at += c;
        }
      });
    }
  } else {
    const areaIn = zones.reduce((a, z) => a + (z.x1 - z.x0) * (z.y1 - z.y0), 0) - (borderBoards ? borderIn * (open("left") ? depth : 0) + borderIn * (open("right") ? depth : 0) + borderIn * W : 0);
    netIn = Math.max(0, areaIn) / pitch;
    // On the diagonal a board meets the joists farther apart by the square root of two.
    crossings = Math.round(netIn / (frame.spacingIn * Math.SQRT2));
    const longest = Math.max(...product.lengthsFt);
    buy.set(longest, Math.ceil(netIn / (longest * 12) - 1e-9));
  }

  // The border: boards along every open edge, each piece the edge's length, one or two deep.
  if (borderBoards > 0) {
    for (let i = 0; i < outline.length; i++) {
      const A = outline[i];
      const B = outline[(i + 1) % outline.length];
      const house = (A.y < 0.5 && B.y < 0.5 && againstHouse) || frame.edges.some((e) => e.house && Math.abs((A.x + B.x) / 2 - (e.x0 + e.x1) / 2) < 0.6 && Math.abs((A.y + B.y) / 2 - (e.y0 + e.y1) / 2) < 0.6);
      if (house) continue;
      const L = Math.hypot(B.x - A.x, B.y - A.y);
      if (L < 2) continue;
      const yaw = Math.atan2(B.y - A.y, B.x - A.x);
      const nx = Math.sin(yaw);
      const ny = -Math.cos(yaw);
      for (let k = 0; k < borderBoards; k++) {
        const off = (k + 0.5) * pitch;
        const square = Math.abs(Math.sin(yaw)) < 1e-6 || Math.abs(Math.cos(yaw)) < 1e-6;
        pieces.push({ cx: (A.x + B.x) / 2 + nx * off, cy: (A.y + B.y) / 2 + ny * off, sx: L, sy: product.widthIn, yaw: square ? undefined : yaw, border: true });
        borderLf += L / 12;
        crossings += Math.round(L / frame.spacingIn);
      }
    }
    const longest = Math.max(...product.lengthsFt);
    netIn += borderLf * 12;
    buy.set(longest, (buy.get(longest) ?? 0) + Math.ceil((borderLf * 12 * 1.05) / (longest * 12) - 1e-9));
  }

  // The waste allowance, in the length the job uses most.
  const boughtBefore = [...buy].reduce((a, [s, n]) => a + s * n, 0);
  if (wastePct > 0 && buy.size > 0) {
    const [main] = [...buy].sort((a, b) => b[0] * b[1] - a[0] * a[1])[0];
    buy.set(main, (buy.get(main) ?? 0) + Math.ceil((boughtBefore * wastePct) / 100 / main - 1e-9));
  }
  const stock = [...buy].filter(([, n]) => n > 0).map(([lengthFt, count]) => ({ lengthFt, count })).sort((a, b) => a.lengthFt - b.lengthFt);

  const fasteningAsked = design.decking.fastening;
  const fastening: DeckSurface["fastening"] = fasteningAsked === "hidden" && product.hiddenFasteners ? "hidden" : fasteningAsked === "screws" ? "screws" : product.hiddenFasteners && product.family !== "hardwood" && product.family !== "modified" ? "hidden" : "screws";

  // Fascia: on by default where the boards are not wood, covering the rim on every open edge.
  const synthetic = product.family === "composite" || product.family === "pvc" || product.family === "mineral" || product.family === "aluminum";
  const fasciaOn = design.decking.fascia === "match" || (design.decking.fascia === "auto" && synthetic);
  const fasciaLf = frame.openEdgeFt;
  return {
    product,
    diagonal,
    pattern,
    border: borderBoards,
    borderLf: Math.round(borderLf * 10) / 10,
    rows,
    pieces,
    shaped: shapedPieces,
    stock,
    netLf: Math.round((netIn / 12) * 10) / 10,
    boughtLf: stock.reduce((a, s) => a + s.lengthFt * s.count, 0),
    wastePct,
    crossings,
    fastening,
    fascia: {
      on: fasciaOn,
      kind: synthetic ? "composite" : "wood",
      lf: fasciaOn ? Math.round(fasciaLf * 10) / 10 : 0,
      heightIn: frame.joistTopIn - frame.joistBottomIn,
      // Ten percent for the mitres and the joints, in 12-ft boards.
      boards: fasciaOn ? Math.ceil((fasciaLf * 1.1) / 12 - 1e-9) : 0,
    },
  };
}
