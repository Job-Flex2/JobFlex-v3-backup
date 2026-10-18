// THE PLAN WITH ITS CHANGES NUMBERED (Home Design Studio, milestone 5 — 2026-10-17): the engineering request's
// drawing. The walls as designed in dark, the walls taken out (or moved from) dashed in red where they stood, doors as
// gaps and windows as glass lines, the rooms named, and each change's number in a circle where it is. No hooks: it
// draws the same on the server (the engineer's page) and in the studio.
import type { Opening, RoomLabel, Wall } from "@/lib/design/model";
import { along, wallDir, wallLen, wallQuad, wallPieces } from "@/lib/design/geometry";

type Marked = { n: number; wallId: string; openingId?: string; kind: string; needs: string };

export function ChangePlan({ plan, changes, className, title = "The plan with the changes numbered" }: { plan: { walls: Wall[]; removed: Wall[]; openings: Opening[]; labels: RoomLabel[]; was: Record<string, Wall> }; changes: Marked[]; className?: string; title?: string }) {
  const all = [...plan.walls, ...plan.removed, ...Object.values(plan.was)];
  if (!all.length) return null;
  const xs = all.flatMap((w) => [w.a.x, w.b.x]);
  const ys = all.flatMap((w) => [w.a.y, w.b.y]);
  const pad = 30;
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  const W = Math.max(...xs) - Math.min(...xs) + pad * 2;
  const H = Math.max(...ys) - Math.min(...ys) + pad * 2;
  const k = Math.max(W, H) / 600; // line weights in plan inches for a ~600 px drawing
  const byId = new Map(plan.walls.map((w) => [w.id, w]));
  const gone = new Map([...plan.removed, ...Object.values(plan.was)].map((w) => [w.id, w]));
  const spot = (c: Marked) => {
    if (c.openingId) {
      const o = plan.openings.find((x) => x.id === c.openingId);
      const w = o ? byId.get(o.wallId) : undefined;
      if (o && w) return along(w, o.at);
    }
    const w = gone.get(c.wallId) ?? byId.get(c.wallId);
    return w ? along(w, wallLen(w) / 2) : null;
  };
  return (
    <svg viewBox={`${x0} ${y0} ${W} ${H}`} className={className} role="img" aria-label={title} style={{ width: "100%", height: "auto", display: "block", background: "#fff" }}>
      <title>{title}</title>
      {/* Where walls stood, dashed. */}
      {[...gone.values()].map((w) => (
        <polygon key={`g${w.id}`} points={wallQuad(w).map((p) => `${p.x},${p.y}`).join(" ")} fill="#fde2e2" stroke="#c0262d" strokeWidth={1.2 * k} strokeDasharray={`${5 * k} ${3 * k}`} />
      ))}
      {plan.walls.map((w) => (
        <g key={w.id}>
          {wallPieces(w, plan.openings)
            .filter((pc) => pc.z0 === 0 && pc.z1 >= w.height - 0.5)
            .map((pc, i) => (
              <polygon key={i} points={wallQuad(w, pc.t0, pc.t1).map((p) => `${p.x},${p.y}`).join(" ")} fill={w.exterior ? "#111" : "#3a3f47"} />
            ))}
        </g>
      ))}
      {plan.openings
        .filter((o) => o.kind === "window")
        .map((o) => {
          const w = byId.get(o.wallId);
          if (!w) return null;
          const a = along(w, o.at - o.width / 2);
          const b = along(w, o.at + o.width / 2);
          return <line key={o.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#1d6fb8" strokeWidth={2 * k} />;
        })}
      {plan.labels.map((l) => (
        <text key={l.id} x={l.at.x} y={l.at.y} textAnchor="middle" fontSize={11 * k} fontWeight={700} fill="#555" style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {l.name}
        </text>
      ))}
      {changes.map((c) => {
        const p = spot(c);
        if (!p) return null;
        const ink = c.needs === "engineer" ? "#c0262d" : c.needs === "check" ? "#b26b00" : "#1d6fb8";
        // Off the wall a little, so the number doesn't hide what it marks.
        const w = byId.get(c.wallId) ?? gone.get(c.wallId);
        const d = w ? wallDir(w) : { x: 1, y: 0 };
        const q = { x: p.x + d.y * 16 * k, y: p.y - d.x * 16 * k };
        return (
          <g key={c.n}>
            <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={ink} strokeWidth={1.2 * k} />
            <circle cx={q.x} cy={q.y} r={10 * k} fill={ink} />
            <text x={q.x} y={q.y + 4 * k} textAnchor="middle" fontSize={12 * k} fontWeight={800} fill="#fff">
              {c.n}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
