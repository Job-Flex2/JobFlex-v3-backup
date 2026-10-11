"use client";
// THE SECTION AND THE DETAILS, DRAWN (2026-10-10): the permit set's upright
// drawings from lib/deck/permit — inches, Z up, flipped here into SVG. One
// renderer for the section, the details and anything else the set adds.
import * as React from "react";
import type { Drawing, DrawItem } from "@/lib/deck/permit";
import s from "./deck-permit.module.css";

const CLS: Record<string, string> = { ink: s.dwInk, wood: s.dwWood, concrete: s.dwConcrete, steel: s.dwSteel, hatch: s.dwHatch, dash: s.dwDash, thin: s.dwThin, dim: s.dwDim, grade: s.dwGrade, glass: s.dwGlass };

function Item({ it, i, font }: { it: DrawItem; i: number; font: number }) {
  const k = `i${i}`;
  switch (it.t) {
    case "rect":
      return <rect key={k} x={it.x} y={-(it.z + it.h)} width={it.w} height={it.h} className={CLS[it.cls]} />;
    case "line":
      return <line key={k} x1={it.x1} y1={-it.z1} x2={it.x2} y2={-it.z2} className={CLS[it.cls]} />;
    case "poly": {
      const pts: string[] = [];
      for (let j = 0; j + 1 < it.pts.length; j += 2) pts.push(`${it.pts[j]},${-it.pts[j + 1]}`);
      return it.closed ? <polygon key={k} points={pts.join(" ")} className={CLS[it.cls]} /> : <polyline key={k} points={pts.join(" ")} className={CLS[it.cls]} fill="none" />;
    }
    case "circle":
      return <circle key={k} cx={it.x} cy={-it.z} r={it.r} className={CLS[it.cls]} />;
    case "text": {
      const size = font * (it.size ?? (it.cls === "label" ? 1.05 : 0.9));
      const tf = it.rot ? `rotate(${it.rot} ${it.x} ${-it.z})` : undefined;
      return (
        <text key={k} x={it.x} y={-it.z} fontSize={size} textAnchor={it.anchor ?? "start"} transform={tf} className={it.cls === "label" ? s.dwLabel : it.cls === "dim" ? s.dwDimText : s.dwNote}>
          {it.s}
        </text>
      );
    }
    case "dim": {
      const vertical = Math.abs(it.x2 - it.x1) < Math.abs(it.z2 - it.z1);
      const tick = font * 0.6;
      const mx = (it.x1 + it.x2) / 2;
      const mz = (it.z1 + it.z2) / 2;
      return (
        <g key={k} className={s.dwDim}>
          <line x1={it.x1} y1={-it.z1} x2={it.x2} y2={-it.z2} />
          {vertical ? (
            <>
              <line x1={it.x1 - tick} y1={-it.z1} x2={it.x1 + tick} y2={-it.z1} />
              <line x1={it.x2 - tick} y1={-it.z2} x2={it.x2 + tick} y2={-it.z2} />
              <text x={it.x1 - tick * 1.4} y={-mz} fontSize={font * 0.9} textAnchor="middle" transform={`rotate(-90 ${it.x1 - tick * 1.4} ${-mz})`} className={s.dwDimText}>{it.label}</text>
            </>
          ) : (
            <>
              <line x1={it.x1} y1={-it.z1 - tick} x2={it.x1} y2={-it.z1 + tick} />
              <line x1={it.x2} y1={-it.z2 - tick} x2={it.x2} y2={-it.z2 + tick} />
              <text x={mx} y={-mz - tick * 1.1} fontSize={font * 0.9} textAnchor="middle" className={s.dwDimText}>{it.label}</text>
            </>
          )}
        </g>
      );
    }
    default:
      return null;
  }
}

/** A drawing in inches, Z up, as an SVG that fits its box. */
export function DrawingSvg({ drawing, label, className, fontScale = 1 }: { drawing: Drawing; label: string; className?: string; fontScale?: number }) {
  const { box } = drawing;
  const font = Math.max(1.6, Math.min(3.2, Math.max(box.w, box.h) / 36)) * fontScale;
  return (
    <svg className={className ?? s.dw} viewBox={`${box.x} ${-(box.z + box.h)} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}>
      <defs>
        <pattern id="permitHatch" width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={4} className={s.dwHatchLine} />
        </pattern>
        <pattern id="permitConcrete" width={3} height={3} patternUnits="userSpaceOnUse">
          <circle cx={1} cy={1} r={0.35} className={s.dwConcreteDot} />
          <circle cx={2.3} cy={2.2} r={0.3} className={s.dwConcreteDot} />
        </pattern>
      </defs>
      {drawing.items.map((it, i) => (
        <Item key={i} it={it} i={i} font={font} />
      ))}
    </svg>
  );
}
