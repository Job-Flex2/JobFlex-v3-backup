// A PLAN SET VIEW, DRAWN (2026-10-23): lib/deck/plans/draft's items as an SVG
// sized in real inches — a view at 1/4" = 1'-0" prints at 1/4" = 1'-0". Line
// weights, lettering, ticks and bubbles are converted from paper inches with
// the view's scale, so every sheet letters the same. Hatches are drawn as real
// lines clipped to their shape, at a paper density: an SVG <pattern> prints
// from Chrome as a 300-dpi picture of itself (seven of them made the
// foundation sheet 3.3 MB), lines print crisp and weigh almost nothing.
import * as React from "react";
import { BUBBLE_IN, DATUM, DIM, dimLine, LEADER, PEN_DASH, PEN_IN, TEXT_IN, type DItem, type Fill, type Pen, type Tone, type View } from "@/lib/deck/plans/draft";

const TONE: Record<Tone, string> = { ink: "#0a0a0a", blue: "#1854a0", muted: "#5b5b5b", white: "#ffffff", red: "#a83232" };
const TINT: Record<string, string> = { tint0: "#d9e8f6", tint1: "#e3f0d8", tint2: "#f8e9d2", tint3: "#f2dbe3", tint4: "#e6def3", tint5: "#d8efeb" };
const FONT = "var(--font-inter), Inter, 'Helvetica Neue', Arial, sans-serif";
const MONO = "var(--font-jbmono), 'JetBrains Mono', ui-monospace, monospace";

export function PlanSvg({ view, className, label }: { view: View; className?: string; label?: string }) {
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (name: string) => `${view.id}-${uid}-${name}`;
  const k = view.scale;
  const P = (paper: number) => paper / k;
  const { box } = view;
  const fillOf = (f: Fill | undefined): string => {
    switch (f) {
      case undefined:
      case "none":
        return "none";
      case "paper":
        return "#ffffff";
      case "wood":
        return "#f4efe4";
      case "woodCut":
        return "#ffffff";
      case "concrete":
        return "#f3f3f1";
      case "earth":
      case "gravel":
      case "poche":
        return "#ffffff";
      case "house":
        return "#efede8";
      case "steel":
        return "#4a4a4a";
      case "glass":
        return "#dceaf5";
      case "ink":
        return "#0a0a0a";
      default:
        return TINT[f] ?? "none";
    }
  };
  const stroke = (pen: Pen | null | undefined, tone: Tone = "ink"): React.SVGProps<SVGElement> => {
    if (!pen) return { stroke: "none" };
    const dash = PEN_DASH[pen];
    return { stroke: TONE[tone], strokeWidth: P(PEN_IN[pen]), strokeDasharray: dash ? dash.map(P).join(" ") : undefined, strokeLinecap: dash ? "butt" : "round", strokeLinejoin: "round" };
  };
  const text = (key: string, x: number, y: number, s: string, size: keyof typeof TEXT_IN, o: { anchor?: "start" | "middle" | "end"; rot?: number; bold?: boolean; mono?: boolean; tone?: Tone; halo?: boolean; base?: "middle" | "alphabetic" | "hanging" } = {}) => (
    <text
      key={key}
      x={x}
      y={y}
      fontSize={P(TEXT_IN[size])}
      fontFamily={o.mono ? MONO : FONT}
      fontWeight={o.bold ? 700 : 500}
      textAnchor={o.anchor ?? "start"}
      dominantBaseline={o.base === "middle" ? "central" : o.base === "hanging" ? "hanging" : undefined}
      letterSpacing={o.mono ? undefined : P(TEXT_IN[size] * 0.02)}
      fill={TONE[o.tone ?? "ink"]}
      transform={o.rot ? `rotate(${o.rot} ${x} ${y})` : undefined}
      stroke={o.halo ? "#ffffff" : undefined}
      strokeWidth={o.halo ? P(0.025) : undefined}
      paintOrder={o.halo ? "stroke" : undefined}
    >
      {s}
    </text>
  );
  const ptsStr = (pts: number[]) => {
    const out: string[] = [];
    for (let i = 0; i + 1 < pts.length; i += 2) out.push(`${r3(pts[i])},${r3(pts[i + 1])}`);
    return out.join(" ");
  };

  /** A material's hatch over a box (model units), as lines and dots at a fixed paper density; clipped by the caller. */
  const hatch = (fill: Fill, b: { x0: number; y0: number; x1: number; y1: number }, seed: number): React.ReactNode => {
    const fine = { stroke: TONE.ink, strokeWidth: P(PEN_IN.fine), fill: "none" } as const;
    const out: React.ReactNode[] = [];
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    // 45° lines x = y + c, every `step` model units measured square to them.
    const diag = (gap: number, offsets: number[]) => {
      const step = P(gap) * Math.SQRT2;
      let n = 0;
      for (let c = b.x0 - b.y1 - step; c <= b.x1 - b.y0 + step && n < 1600; c += step, n++) {
        for (const o of offsets) {
          const cc = c + P(o) * Math.SQRT2;
          out.push(<line key={`h${n}-${o}`} x1={r3(b.y0 + cc)} y1={r3(b.y0)} x2={r3(b.y1 + cc)} y2={r3(b.y1)} {...fine} />);
        }
      }
    };
    if (fill === "poche") diag(0.045, [0]);
    else if (fill === "earth") diag(0.12, [0, 0.028, 0.056]);
    else if (fill === "concrete" || fill === "gravel") {
      // A stipple that is the same on every print: dots, and for concrete a few aggregate triangles.
      const rand = mulberry(seed * 7919 + 17);
      const areaIn2 = (w * k) * (h * k);
      const dots = Math.min(1400, Math.round(areaIn2 * (fill === "concrete" ? 210 : 120)));
      for (let d = 0; d < dots; d++) {
        const x = b.x0 + rand() * w;
        const y = b.y0 + rand() * h;
        if (fill === "gravel") out.push(<circle key={`g${d}`} cx={r3(x)} cy={r3(y)} r={P(0.011)} {...fine} />);
        else out.push(<circle key={`d${d}`} cx={r3(x)} cy={r3(y)} r={P(0.0055)} fill={TONE.ink} />);
      }
      if (fill === "concrete") {
        const tris = Math.min(500, Math.round(areaIn2 * 70));
        for (let t = 0; t < tris; t++) {
          const x = b.x0 + rand() * w;
          const y = b.y0 + rand() * h;
          const a = rand() * Math.PI * 2;
          const r = P(0.018 + rand() * 0.012);
          const pts = [0, 2.1, 4.2].map((q) => `${r3(x + Math.cos(a + q) * r)},${r3(y + Math.sin(a + q) * r)}`).join(" ");
          out.push(<polygon key={`t${t}`} points={pts} {...fine} />);
        }
      }
    }
    return out;
  };

  const draw = (it: DItem, i: number): React.ReactNode => {
    const key = `i${i}`;
    switch (it.k) {
      case "line":
        return <line key={key} x1={it.x1} y1={it.y1} x2={it.x2} y2={it.y2} {...(stroke(it.pen, it.tone) as React.SVGProps<SVGLineElement>)} />;
      case "poly": {
        const fill = fillOf(it.fill);
        const sp = stroke(it.pen, it.tone) as React.SVGProps<SVGPolygonElement>;
        const shape = it.closed === false ? <polyline key={key} points={ptsStr(it.pts)} fill="none" {...(sp as React.SVGProps<SVGPolylineElement>)} /> : <polygon key={key} points={ptsStr(it.pts)} fill={fill} {...sp} />;
        if (it.closed !== false && it.fill && HATCHED.has(it.fill)) {
          const cid = `${id("c")}${i}`;
          return (
            <g key={key}>
              <defs>
                <clipPath id={cid}>
                  <polygon points={ptsStr(it.pts)} />
                </clipPath>
              </defs>
              <polygon points={ptsStr(it.pts)} fill={fill} stroke="none" />
              <g clipPath={`url(#${cid})`}>{hatch(it.fill, bboxOf(it.pts), i)}</g>
              <polygon points={ptsStr(it.pts)} fill="none" {...sp} />
            </g>
          );
        }
        // Wood cut across its grain: the X a framer reads as "this member is cut here".
        if (it.fill === "woodCut" && it.pts.length === 8) {
          const [ax, ay, bx, by, cx, cy, dx, dy] = it.pts;
          return (
            <g key={key}>
              {shape}
              <line x1={ax} y1={ay} x2={cx} y2={cy} {...(stroke("fine") as React.SVGProps<SVGLineElement>)} />
              <line x1={bx} y1={by} x2={dx} y2={dy} {...(stroke("fine") as React.SVGProps<SVGLineElement>)} />
            </g>
          );
        }
        return shape;
      }
      case "circle": {
        if (it.fill && HATCHED.has(it.fill)) {
          const cid = `${id("c")}${i}`;
          return (
            <g key={key}>
              <defs>
                <clipPath id={cid}>
                  <circle cx={it.x} cy={it.y} r={it.r} />
                </clipPath>
              </defs>
              <circle cx={it.x} cy={it.y} r={it.r} fill={fillOf(it.fill)} stroke="none" />
              <g clipPath={`url(#${cid})`}>{hatch(it.fill, { x0: it.x - it.r, y0: it.y - it.r, x1: it.x + it.r, y1: it.y + it.r }, i)}</g>
              <circle cx={it.x} cy={it.y} r={it.r} fill="none" {...(stroke(it.pen) as React.SVGProps<SVGCircleElement>)} />
            </g>
          );
        }
        return <circle key={key} cx={it.x} cy={it.y} r={it.r} fill={fillOf(it.fill)} {...(stroke(it.pen) as React.SVGProps<SVGCircleElement>)} />;
      }
      case "text":
        return text(key, it.x, it.y, it.s, it.size, it);
      case "dim": {
        const d = dimLine(it, k);
        const past = P(DIM.extPast);
        const gap = P(DIM.extGap);
        const t = P(DIM.tick);
        const ext = (x: number, y: number, lx: number, ly: number) => {
          // From a little off the point to a little past the dimension line.
          const len = Math.hypot(lx - x, ly - y);
          if (len < gap) return null;
          return <line x1={x + d.nx * gap * Math.sign(it.off || 1)} y1={y + d.ny * gap * Math.sign(it.off || 1)} x2={lx + d.nx * past * Math.sign(it.off || 1)} y2={ly + d.ny * past * Math.sign(it.off || 1)} {...(stroke("dim") as React.SVGProps<SVGLineElement>)} />;
        };
        // The label reads along the line, never upside down.
        let ang = (Math.atan2(d.uy, d.ux) * 180) / Math.PI;
        if (ang > 90.5) ang -= 180;
        if (ang <= -89.5) ang += 180;
        const side = Math.sign(it.off || 1);
        const lx = (d.ax + d.bx) / 2 + d.nx * side * P(DIM.textGap);
        const ly = (d.ay + d.by) / 2 + d.ny * side * P(DIM.textGap);
        // Upright text sits above the line when the normal points up the sheet, below it otherwise.
        const above = d.ny * side < 0 || (Math.abs(d.ny) < 1e-6 && d.nx * side < 0);
        return (
          <g key={key}>
            {ext(it.x1, it.y1, d.ax, d.ay)}
            {ext(it.x2, it.y2, d.bx, d.by)}
            <line x1={d.ax - d.ux * past * 0.6} y1={d.ay - d.uy * past * 0.6} x2={d.bx + d.ux * past * 0.6} y2={d.by + d.uy * past * 0.6} {...(stroke("dim") as React.SVGProps<SVGLineElement>)} />
            {[0, 1].map((e) => {
              const x = e ? d.bx : d.ax;
              const y = e ? d.by : d.ay;
              // A 45° architect's tick across the line.
              const tx = (d.ux + d.nx) * t * 0.5;
              const ty = (d.uy + d.ny) * t * 0.5;
              return <line key={e} x1={x - tx} y1={y - ty} x2={x + tx} y2={y + ty} {...(stroke("medium") as React.SVGProps<SVGLineElement>)} />;
            })}
            <text
              x={lx}
              y={ly}
              fontSize={P(TEXT_IN.sm)}
              fontFamily={FONT}
              fontWeight={600}
              textAnchor="middle"
              dominantBaseline={above ? undefined : "hanging"}
              fill={TONE.ink}
              transform={`rotate(${ang} ${lx} ${ly})`}
              stroke="#ffffff"
              strokeWidth={P(0.02)}
              paintOrder="stroke"
            >
              {it.label}
            </text>
          </g>
        );
      }
      case "leader": {
        const size = it.size ?? "md";
        const right = it.tx >= it.x;
        const sh = P(LEADER.shoulder) * (right ? 1 : -1);
        const lh = P(TEXT_IN[size] * LEADER.lineGap);
        const ang = Math.atan2(it.ty - it.y, it.tx - it.x);
        const h = P(LEADER.head);
        const head =
          it.head === "dot" ? (
            <circle cx={it.x} cy={it.y} r={P(LEADER.dot)} fill={TONE.ink} />
          ) : (
            <polygon
              points={ptsStr([it.x, it.y, it.x + Math.cos(ang + 0.32) * h, it.y + Math.sin(ang + 0.32) * h, it.x + Math.cos(ang - 0.32) * h, it.y + Math.sin(ang - 0.32) * h])}
              fill={TONE.ink}
            />
          );
        return (
          <g key={key}>
            <polyline points={ptsStr([it.x, it.y, it.tx, it.ty, it.tx + sh, it.ty])} fill="none" {...(stroke("dim") as React.SVGProps<SVGPolylineElement>)} />
            {head}
            {it.lines.map((s, j) => text(`${key}t${j}`, it.tx + sh + (right ? P(0.03) : -P(0.03)), it.ty + (j - (it.lines.length - 1) / 2) * lh, s, size, { anchor: right ? "start" : "end", base: "middle", halo: true }))}
          </g>
        );
      }
      case "bubble": {
        const r = P(BUBBLE_IN[it.kind]);
        const sw = stroke("medium") as React.SVGProps<SVGElement>;
        if (it.kind === "tag" || it.kind === "foot") {
          const pts: number[] = [];
          const n = it.kind === "tag" ? 6 : 4;
          const w = Math.max(r, P(TEXT_IN.xs * 0.36 * it.a.length + 0.03));
          for (let j = 0; j < n; j++) {
            const a = (Math.PI * 2 * j) / n + (it.kind === "tag" ? 0 : Math.PI / 4);
            pts.push(it.x + Math.cos(a) * (it.kind === "tag" ? w * 1.15 : r * 1.3), it.y + Math.sin(a) * (it.kind === "tag" ? r : r * 1.3));
          }
          return (
            <g key={key}>
              <polygon points={ptsStr(pts)} fill="#ffffff" {...(sw as React.SVGProps<SVGPolygonElement>)} />
              {text(`${key}a`, it.x, it.y, it.a, "xs", { anchor: "middle", base: "middle", bold: true, mono: true })}
            </g>
          );
        }
        if (it.kind === "grid") {
          return (
            <g key={key}>
              <circle cx={it.x} cy={it.y} r={r} fill="#ffffff" {...(sw as React.SVGProps<SVGCircleElement>)} />
              {text(`${key}a`, it.x, it.y, it.a, "lg", { anchor: "middle", base: "middle", bold: true })}
            </g>
          );
        }
        // Detail and section bubbles: the number over the sheet it is drawn on.
        const pointer =
          it.kind === "section" && it.dir != null
            ? (() => {
                const a = (it.dir * Math.PI) / 180;
                const tip = r * 1.75;
                const wing = 0.7;
                return <polygon points={ptsStr([it.x + Math.cos(a) * tip, it.y + Math.sin(a) * tip, it.x + Math.cos(a + wing) * r, it.y + Math.sin(a + wing) * r, it.x + Math.cos(a - wing) * r, it.y + Math.sin(a - wing) * r])} fill={TONE.ink} />;
              })()
            : null;
        return (
          <g key={key}>
            {pointer}
            <circle cx={it.x} cy={it.y} r={r} fill="#ffffff" {...(sw as React.SVGProps<SVGCircleElement>)} />
            <line x1={it.x - r} y1={it.y} x2={it.x + r} y2={it.y} {...(stroke("light") as React.SVGProps<SVGLineElement>)} />
            {text(`${key}a`, it.x, it.y - r * 0.42, it.a, "sm", { anchor: "middle", base: "middle", bold: true })}
            {it.b ? text(`${key}b`, it.x, it.y + r * 0.45, it.b, "xs", { anchor: "middle", base: "middle", mono: true }) : null}
          </g>
        );
      }
      case "datum": {
        const r = P(DATUM.r);
        const run = P(DATUM.run);
        const dir = it.side === "left" ? -1 : 1;
        const x2 = it.x + dir * run;
        return (
          <g key={key}>
            <circle cx={it.x} cy={it.y} r={r} fill="#ffffff" {...(stroke("light") as React.SVGProps<SVGCircleElement>)} />
            <path d={`M${it.x} ${it.y} L${it.x + r} ${it.y} A${r} ${r} 0 0 0 ${it.x} ${it.y - r} Z M${it.x} ${it.y} L${it.x - r} ${it.y} A${r} ${r} 0 0 0 ${it.x} ${it.y + r} Z`} fill={TONE.ink} />
            <line x1={it.x + dir * r} y1={it.y} x2={x2} y2={it.y} {...(stroke("light") as React.SVGProps<SVGLineElement>)} />
            {text(`${key}n`, it.x + dir * r * 1.6, it.y - P(0.035), it.name, "sm", { anchor: it.side === "left" ? "end" : "start", bold: true })}
            {text(`${key}v`, it.x + dir * r * 1.6, it.y + P(0.03), it.value, "sm", { anchor: it.side === "left" ? "end" : "start", base: "hanging", mono: true })}
          </g>
        );
      }
      case "north": {
        const r = P(0.22);
        const a = (it.deg * Math.PI) / 180;
        const rot = (x: number, y: number): [number, number] => [it.x + x * Math.cos(a) - y * Math.sin(a), it.y + x * Math.sin(a) + y * Math.cos(a)];
        const tip = rot(0, -r * 0.95);
        const l = rot(-r * 0.42, r * 0.55);
        const c = rot(0, r * 0.25);
        const rr = rot(r * 0.42, r * 0.55);
        const nPos = rot(0, -r * 1.32);
        return (
          <g key={key}>
            <circle cx={it.x} cy={it.y} r={r} fill="#ffffff" {...(stroke("light") as React.SVGProps<SVGCircleElement>)} />
            <polygon points={ptsStr([...tip, ...l, ...c])} fill={TONE.ink} />
            <polygon points={ptsStr([...tip, ...c, ...rr])} fill="#ffffff" {...(stroke("light") as React.SVGProps<SVGPolygonElement>)} />
            {text(`${key}n`, nPos[0], nPos[1], "N", "lg", { anchor: "middle", base: "middle", bold: true })}
          </g>
        );
      }
    }
  };

  return (
    <svg
      className={className}
      width={`${r3(box.w * k)}in`}
      height={`${r3(box.h * k)}in`}
      viewBox={`${r3(box.x)} ${r3(box.y)} ${r3(box.w)} ${r3(box.h)}`}
      role="img"
      aria-label={label ?? `${view.title}, scale ${view.scaleLabel}`}
      data-plan-view={view.id}
      data-plan-scale={view.scaleLabel}
    >
      {view.items.map((it, i) => draw(it, i))}
    </svg>
  );
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const HATCHED = new Set<Fill>(["poche", "earth", "concrete", "gravel"]);
function bboxOf(pts: number[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  return { x0, y0, x1, y1 };
}
/** A small seeded random, so a stipple prints the same every time. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
