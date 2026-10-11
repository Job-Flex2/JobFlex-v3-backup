"use client";
// THE PERMIT SHEET — the drawings and schedules a building office asks for,
// drawn from the same engine the studio prices with (lib/deck): the framing
// plan, the front elevation, the schedules with the table each number came
// from, the checks as design notes, the assumptions. Print to PDF from the
// browser; the sheet breaks a page a drawing.
import * as React from "react";
import { buildStructure } from "@/lib/deck/structure";
import { priceStructure, deckNotes } from "@/lib/deck/pricing";
import { deckChecks } from "@/lib/deck/checks";
import { deckScene } from "@/lib/deck/scene";
import { deckElevation } from "@/lib/deck/elevation";
import { structureWords, type DeckDesign } from "@/lib/deck/design";
import { ftIn, RULE } from "@/lib/deck/codeTables";
import { RULE_RAFTER } from "@/lib/deck/roofTables";
import { STAIR_RULES } from "@/lib/deck/stairs";
import { DeckPlan } from "@/components/v3/deck-estimator-blueprint/deck-plan";
import s from "./deck-permit.module.css";

const DECK_LAYERS = new Set(["post", "beam", "rim", "fascia", "decking", "ledger", "slab", "stair"]);
const RAIL_LAYERS = new Set(["rail", "glass", "screen", "wall", "light"]);

export function DeckPermitSheet({ design, address, title, shop }: { design: DeckDesign | null; address: string | null; title: string; shop: { name: string; address: string | null; phone: string | null; email: string | null } }) {
  const built = React.useMemo(() => {
    if (!design) return null;
    const structure = buildStructure(design);
    const pkg = priceStructure(structure);
    const checks = deckChecks(structure);
    const scene = deckScene(structure);
    const elevation = deckElevation(scene);
    return { structure, pkg, checks, scene, elevation };
  }, [design]);
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  if (!design || !built) {
    return (
      <div className={s.sheet}>
        <div className={s.empty}>
          <div className={s.title}>Permit sheet</div>
          <p>No deck design was handed to this page. Open it from the Deck estimator&apos;s Permit sheet button, or from a saved draft or proposal.</p>
        </div>
      </div>
    );
  }
  const { structure, pkg, checks, elevation } = built;
  const { frame, roof } = structure;
  const what = structureWords(design);
  const pages: Array<{ no: string; name: string }> = [{ no: "A1", name: "Framing plan" }, { no: "A2", name: "Front elevation" }, { no: "S1", name: "Schedules" }, { no: "S2", name: "Notes and checks" }];
  const head = (no: string, name: string) => (
    <div className={s.head}>
      <div>
        <div className={s.sheetNo}>{no} · {name} · {pages.length} sheets</div>
        <div className={s.title}>{what}</div>
        <div className={s.sub}>{address ? `${address} · ` : ""}{title !== "Deck" ? `${title} · ` : ""}{today}</div>
      </div>
      <div className={s.shop}>
        <b>{shop.name || "Contractor"}</b>
        {shop.address ? <span>{shop.address}<br /></span> : null}
        {[shop.phone, shop.email].filter(Boolean).join(" · ")}
      </div>
    </div>
  );
  const foot = (text: string) => (
    <div className={s.foot}>
      <span>{text}</span>
      <span>Estimating grade — the building department has the final word</span>
    </div>
  );
  // The elevation: the scene flattened, feet → an SVG box with a ground line and height marks.
  const E = elevation;
  const pad = 2.5;
  const vb = `${-pad} ${-(E.heightFt + pad)} ${E.widthFt + 2 * pad} ${E.heightFt + 2 * pad}`;
  const poly = (pts: number[]) => {
    const out: string[] = [];
    for (let i = 0; i < pts.length; i += 2) out.push(`${pts[i]},${-pts[i + 1]}`);
    return out.join(" ");
  };
  const fmt = (ft: number) => ftIn(ft * 12);
  const posts = structure.frame ? [...structure.frame.posts, ...(structure.lower?.frame.posts ?? [])] : [];
  const beams = structure.frame ? [...structure.frame.beams, ...(structure.lower?.frame.beams ?? [])] : [];
  return (
    <div className={`${s.sheet} jf-blueprint`}>
      <div className="content" style={{ display: "contents" }}>
        <div className={s.bar}>
          <p>Permit set for the {what}. Print it to paper or PDF; each drawing and schedule is its own page.</p>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => window.print()}>Print / save as PDF</button>
        </div>

        {/* A1 — the framing plan */}
        <section className={s.page} data-permit-page="A1">
          {head("A1", "Framing plan")}
          <div className={s.drawing}>
            <DeckPlan structure={structure} />
          </div>
          {foot(`Scale as drawn · ${frame ? `${frame.joistSize} joists @ ${frame.spacingIn} in. · ${[...new Set(frame.beams.map((b) => b.spec.size))].join(", ")} beams · ${posts.length} posts` : roof ? `${roof.posts.length} posts · ${roof.rafters.size} rafters @ ${roof.rafters.spacingIn} in.` : ""}`)}
        </section>

        {/* A2 — the front elevation */}
        <section className={s.page} data-permit-page="A2">
          {head("A2", "Front elevation, from the yard")}
          <div className={s.drawing}>
            <svg className={s.elev} viewBox={vb} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Front elevation, ${fmt(E.widthFt)} wide, ${fmt(E.heightFt)} high`}>
              <g className={s.deck}>
                {E.polys.filter((p) => DECK_LAYERS.has(p.layer)).map((p, i) => (
                  <polygon key={`d${i}`} points={poly(p.pts)} />
                ))}
              </g>
              <g className={s.roof}>
                {E.polys.filter((p) => !DECK_LAYERS.has(p.layer) && !RAIL_LAYERS.has(p.layer)).map((p, i) => (
                  <polygon key={`r${i}`} points={poly(p.pts)} />
                ))}
              </g>
              <g className={s.rail}>
                {E.polys.filter((p) => RAIL_LAYERS.has(p.layer)).map((p, i) => (
                  <polygon key={`l${i}`} points={poly(p.pts)} />
                ))}
              </g>
              <line className={s.ground} x1={-pad} y1={0} x2={E.widthFt + pad} y2={0} />
              <g className={s.dim}>
                <line x1={0} y1={1.2} x2={E.widthFt} y2={1.2} strokeWidth={0.05} />
                <text x={E.widthFt / 2} y={2} fontSize={0.6} textAnchor="middle">{fmt(E.widthFt)}</text>
                <line x1={E.widthFt + 1} y1={0} x2={E.widthFt + 1} y2={-E.heightFt} strokeWidth={0.05} />
                <text x={E.widthFt + 1.4} y={-E.heightFt / 2} fontSize={0.6} transform={`rotate(90 ${E.widthFt + 1.4} ${-E.heightFt / 2})`} textAnchor="middle">{fmt(E.heightFt)}</text>
                {frame ? <text x={0} y={-design.heightIn / 12 - 0.3} fontSize={0.5}>{`deck ${ftIn(design.heightIn)}`}</text> : null}
              </g>
            </svg>
          </div>
          {foot(`${fmt(E.widthFt)} wide, ${fmt(E.heightFt)} to the top${structure.gradePct ? ` · the ground falls ${structure.gradePct}% under the deck` : ""}`)}
        </section>

        {/* S1 — schedules */}
        <section className={s.page} data-permit-page="S1">
          {head("S1", "Schedules")}
          <div>
            {frame ? (
              <>
                <div className={s.h2}>Framing</div>
                <table className={s.table}>
                  <thead><tr><th>Member</th><th>Size</th><th className={s.r}>Spacing / span</th><th>Read on</th></tr></thead>
                  <tbody>
                    <tr><td>Joists</td><td>{frame.joistSize} {frame.species.short.toLowerCase()}</td><td className={s.r}>{frame.spacingIn} in. o.c. · span {ftIn(Math.max(...frame.zones.flatMap((z) => z.spansIn)))}</td><td className={s.rule}>{RULE.joist}</td></tr>
                    {beams.map((b, i) => (
                      <tr key={i}><td>Beam {b.id}{i >= frame.beams.length ? " (lower level)" : ""}</td><td>{b.spec.size}{b.style === "flush" ? ", flush" : ""}</td><td className={s.r}>posts {ftIn(b.spanIn)} o.c. · allows {ftIn(b.maxSpanIn)}</td><td className={s.rule}>{b.table === "DCA6" ? RULE.solidBeam : RULE.beam}</td></tr>
                    ))}
                    <tr><td>Posts</td><td>{design.framing.post}</td><td className={s.r}>{posts.length} · tallest {ftIn(Math.max(...posts.map((p) => p.heightIn)))}</td><td className={s.rule}>{RULE.post}</td></tr>
                    {frame.ledgers.map((l, i) => (
                      <tr key={`l${i}`}><td>Ledger</td><td>{frame.sticks.find((st) => st.role === "ledger")?.nominal ?? "2x"}</td><td className={s.r}>{l.fasteners} fasteners @ {l.spacingIn} in., two rows</td><td className={s.rule}>{l.rule}</td></tr>
                    ))}
                    <tr><td>Rim</td><td>{frame.joistSize}{design.framing.doubleRim ? ", doubled" : ""}</td><td className={s.r}>3 screws per joist</td><td className={s.rule}>{RULE.hangers}</td></tr>
                  </tbody>
                </table>
                <div className={s.h2}>Footings</div>
                <table className={s.table}>
                  <thead><tr><th>Post</th><th className={s.r}>Carries</th><th className={s.r}>Footing</th><th className={s.r}>Depth</th><th>Read on</th></tr></thead>
                  <tbody>
                    {posts.map((p) => (
                      <tr key={p.id}><td>{p.id}{p.roof ? " (roof)" : ""}</td><td className={s.r}>{Math.round(p.tributarySqFt)} sq ft</td><td className={s.r}>{p.footing.type === "poured" ? `${p.footing.padIn} in. × ${p.footing.padThickIn} in., ${p.footing.pierIn}-in. pier` : "pier block"}</td><td className={s.r}>{p.footing.depthIn} in.</td><td className={s.rule}>{RULE.footing} · {design.soilPsf.toLocaleString("en-US")} psf</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
            {roof ? (
              <>
                <div className={s.h2}>Roof</div>
                <table className={s.table}>
                  <thead><tr><th>Member</th><th>Size</th><th className={s.r}>Spacing / span</th><th>Read on</th></tr></thead>
                  <tbody>
                    <tr><td>Rafters</td><td>{roof.rafters.size}</td><td className={s.r}>{roof.rafters.spacingIn} in. o.c. · span {ftIn(roof.rafters.spanIn)} (allows {ftIn(roof.rafters.maxSpanIn)})</td><td className={s.rule}>{RULE_RAFTER[roof.roofLoad]}</td></tr>
                    {roof.headers.map((h) => (
                      <tr key={h.id}><td>Header {h.id.replace("h", "")}</td><td>{h.spec.size}</td><td className={s.r}>{ftIn(h.lengthIn)} · supports {ftIn(h.spanIn)} apart</td><td className={s.rule}>{h.spec.kind === "lvl" ? "LVL maker's tables" : `${RULE.beam} at the roof's load`}</td></tr>
                    ))}
                    {roof.ridge ? <tr><td>Ridge</td><td>{roof.ridge.kind === "beam" ? `${roof.ridge.spec?.size ?? roof.ridge.nominal} beam` : `${roof.ridge.nominal} board`}</td><td className={s.r}>{ftIn(roof.ridge.lengthIn)}{roof.ties ? ` · ${roof.ties} ties @ 4 ft` : ""}</td><td className={s.rule}>IRC R802.3</td></tr> : null}
                    {roof.hips.count ? <tr><td>Hips</td><td>{roof.hips.nominal}</td><td className={s.r}>{roof.hips.count}</td><td className={s.rule}>IRC R802.3</td></tr> : null}
                    <tr><td>Posts</td><td>{roof.roof.post}</td><td className={s.r}>{roof.posts.length} · {ftIn(roof.roof.eaveHeightIn)} to the headers</td><td className={s.rule}>{RULE.post}</td></tr>
                    {roof.ledger ? <tr><td>Roof ledger</td><td>{roof.ledger.nominal}</td><td className={s.r}>{roof.ledger.fasteners} structural screws, 2 @ 16 in.</td><td className={s.rule}>{RULE.ledgerBoard}</td></tr> : null}
                  </tbody>
                </table>
              </>
            ) : null}
            {structure.stairs.length || structure.rails.on ? (
              <>
                <div className={s.h2}>Stairs and guards</div>
                <table className={s.table}>
                  <thead><tr><th>Item</th><th>Build</th><th className={s.r}>Figures</th><th>Read on</th></tr></thead>
                  <tbody>
                    {structure.stairs.map((st, i) => (
                      <tr key={st.design.id}><td>{st.kind === "box" ? "Box steps" : `Stair ${i + 1} (${st.design.side})`}</td><td>{st.kind === "box" ? "2x6 box frames on blocks" : `${st.stringers.count} 2x12 stringers @ ${st.stringers.spacingIn} in.`}</td><td className={s.r}>{st.risers} risers × {st.riserIn.toFixed(2)} in. · treads {st.runIn + 1} in. · {st.widthIn} in. wide</td><td className={s.rule}>{STAIR_RULES.riser.split(" — ")[0]} · {STAIR_RULES.tread.split(" — ")[0]}</td></tr>
                    ))}
                    {structure.rails.on ? <tr><td>Guard</td><td>{structure.rails.label}, {structure.rails.infill}</td><td className={s.r}>{structure.rails.heightIn} in. high · {Math.round(structure.rails.totalLf)} ft · {structure.rails.posts + structure.rails.stairPosts} posts</td><td className={s.rule}>{RULE.guard} · R312.1.3</td></tr> : null}
                  </tbody>
                </table>
              </>
            ) : null}
            {structure.electrical.on ? (
              <>
                <div className={s.h2}>Electrical</div>
                <table className={s.table}>
                  <thead><tr><th>Circuit</th><th>Devices</th><th className={s.r}>Wire</th><th>Read on</th></tr></thead>
                  <tbody>
                    {structure.electrical.circuits.map((c) => (
                      <tr key={c.id}><td>{c.amps} A{c.poles === 2 ? " two-pole" : ""} {c.kind === "lights-outlets" ? "GFCI" : "heater"}</td><td>{c.devices} · {c.va} VA</td><td className={s.r}>{c.wireFt} ft {c.wire}</td><td className={s.rule}>NEC 210.8 · 210.23</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </div>
          {foot(`Design load ${design.loadPsf} psf · soil ${design.soilPsf.toLocaleString("en-US")} psf · frost ${design.frostIn} in.${design.site.groundSnowPsf ? ` · ground snow ${design.site.groundSnowPsf} psf` : ""}`)}
        </section>

        {/* S2 — notes and checks */}
        <section className={s.page} data-permit-page="S2">
          {head("S2", "Notes and code checks")}
          <div className={s.two}>
            <div>
              <div className={s.h2}>General notes</div>
              <ol className={s.notes}>
                {deckNotes(pkg).map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ol>
            </div>
            <div>
              <div className={s.h2}>Code checks</div>
              <ol className={s.notes}>
                {checks.filter((c) => c.level !== "info").map((c) => (
                  <li key={c.id}><b>{c.part}:</b> {c.text}{c.rule ? <> <span className={s.rule}>({c.rule})</span></> : null}</li>
                ))}
              </ol>
            </div>
          </div>
          {foot(`${pkg.lines.length} lines in the estimate · ${pkg.bom.length} material lines`)}
        </section>
      </div>
    </div>
  );
}
