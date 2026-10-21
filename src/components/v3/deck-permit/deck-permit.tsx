"use client";
// THE PERMIT SET (2026-10-10; the submittal set 2026-10-20) — what a building
// office asks for with a deck permit, drawn from the same engine the studio
// prices with (lib/deck), on 11 × 17 sheets with a title block:
//   A1  the site plan (to a real scale, from the county's parcel record or
//       typed) and the project's data: the scope, the code and the county's
//       design criteria, the general notes, the front elevation;
//   S1  the floor: framing plan, section, the details (the ledger, the
//       lateral load connection, the post and footing, the guard, the
//       bracing), the framing / footing / connector schedules;
//   S2  the roof, when there is one: its framing plan, the uplift path, the
//       bracing, its schedule.
// Above the sheets, on screen only: the site plan's figures to confirm (kept
// by the property — actions/deckSitePlan), the county read from the address,
// and anything a reviewer would send back. Print to PDF from the browser.
import * as React from "react";
import { buildStructure, type DeckStructure } from "@/lib/deck/structure";
import { priceStructure } from "@/lib/deck/pricing";
import { deckChecks } from "@/lib/deck/checks";
import { deckScene } from "@/lib/deck/scene";
import { deckElevation } from "@/lib/deck/elevation";
import { PLACEMENT_LABEL, structureWords, type DeckDesign } from "@/lib/deck/design";
import { ftIn, LEDGER_FASTENER_LABEL, RULE } from "@/lib/deck/codeTables";
import { RULE_RAFTER } from "@/lib/deck/roofTables";
import { STAIR_RULES } from "@/lib/deck/stairs";
import { DeckPlan } from "@/components/v3/deck-estimator-blueprint/deck-plan";
import { detailDrawings, lateralDevices, permitNotes, permitSheets, roofDetails, sectionDrawing, type DetailDrawing, type PermitSheet } from "@/lib/deck/permit";
import { DECK_SIDE_LABEL, DECK_SIDES, defaultSitePlan, normalizeSitePlan, siteLayout, siteScale, turnLot, type SitePlan } from "@/lib/deck/sitePlan";
import { countyCodeFor, designCriteria, RESEARCHED_ON } from "@/lib/deck/countyCodes";
import { readDeckCounty, readDeckLot, saveDeckSitePlan } from "@/actions/deckSitePlan";
import { DrawingSvg } from "./deck-sections";
import { SitePlanSvg } from "./deck-site-plan";
import s from "./deck-permit.module.css";

const DECK_LAYERS = new Set(["post", "beam", "rim", "fascia", "decking", "ledger", "slab", "stair"]);
const RAIL_LAYERS = new Set(["rail", "glass", "screen", "wall", "light"]);
const SHEET_W_PX = 17 * 96;

type Shop = { name: string; address: string | null; phone: string | null; email: string | null };
type Built = { structure: DeckStructure; pkg: ReturnType<typeof priceStructure>; checks: ReturnType<typeof deckChecks>; elevation: ReturnType<typeof deckElevation> };

export function DeckPermitSheet({ design, address, title, shop, initialPlan = null, editable = true }: { design: DeckDesign | null; address: string | null; title: string; shop: Shop; initialPlan?: SitePlan | null; editable?: boolean }) {
  const built = React.useMemo<Built | null>(() => {
    if (!design) return null;
    const structure = buildStructure(design);
    return { structure, pkg: priceStructure(structure), checks: deckChecks(structure), elevation: deckElevation(deckScene(structure)) };
  }, [design]);
  if (!design || !built) {
    return (
      <div className={s.sheet}>
        <div className={s.empty}>
          <div className={s.title}>Permit set</div>
          <p>No deck design was handed to this page. Open it from the Deck estimator&apos;s Permit sheet button, or from a saved draft or proposal.</p>
        </div>
      </div>
    );
  }
  return <PermitSet design={design} address={address} title={title} shop={shop} initialPlan={initialPlan} editable={editable} built={built} />;
}

/* ── The screen's width, for fitting an 11 × 17 sheet on it ─────────────────── */
const subscribeWidth = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
const widthNow = () => window.innerWidth;
const widthServer = () => SHEET_W_PX + 32;

function PermitSet({ design, address, title, shop, initialPlan, editable, built }: { design: DeckDesign; address: string | null; title: string; shop: Shop; initialPlan: SitePlan | null; editable: boolean; built: Built }) {
  const { structure, checks, elevation } = built;
  const { frame, roof } = structure;
  const fallback = React.useMemo(() => defaultSitePlan(structure, address), [structure, address]);
  const [plan, setPlan] = React.useState<SitePlan>(() => (initialPlan ? normalizeSitePlan(initialPlan, fallback) : fallback));
  const [status, setStatus] = React.useState("");
  const [said, setSaid] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const dirty = React.useRef(false);
  const screenW = React.useSyncExternalStore(subscribeWidth, widthNow, widthServer);
  const zoom = Math.min(1, (screenW - 32) / SHEET_W_PX);

  // A change from the panel: drawn at once, kept a moment later.
  const update = React.useCallback(
    (next: SitePlan) => {
      dirty.current = true;
      setPlan(next);
      if (editable && address) setStatus("Saving…");
    },
    [editable, address],
  );
  React.useEffect(() => {
    if (!dirty.current || !editable || !address) return;
    const t = window.setTimeout(() => {
      saveDeckSitePlan({ address, plan, fallback })
        .then((r) => setStatus(r.ok ? "Site plan saved for this address" : r.error))
        .catch(() => setStatus("The site plan could not be saved."));
    }, 900);
    return () => window.clearTimeout(t);
  }, [plan, editable, address, fallback]);
  // The county, once, from the address (the Census Bureau's geocoder).
  const askedCounty = React.useRef(false);
  React.useEffect(() => {
    if (askedCounty.current || plan.county || !address || !editable) return;
    askedCounty.current = true;
    readDeckCounty(address)
      .then((r) => {
        if (!r.ok || !r.county) return;
        const county = { name: r.county.name, state: r.county.state, source: "census" as const };
        dirty.current = true;
        setPlan((p) => (p.county ? p : { ...p, county, street: p.street || r.street || p.street }));
      })
      .catch(() => undefined);
  }, [address, editable, plan.county]);

  const readLot = async () => {
    if (!address) return;
    setBusy(true);
    setSaid([]);
    try {
      const r = await readDeckLot({ address, plan, fallback });
      if (r.ok) {
        update(r.plan);
        setSaid(r.said);
      } else setSaid([r.error]);
    } catch {
      setSaid(["The lot could not be read. Type the lot's width and depth."]);
    }
    setBusy(false);
  };

  const county = countyCodeFor(plan.county?.state ?? design.site.state, plan.county?.name);
  const countyName = plan.county ? `${plan.county.name}${plan.county.state ? `, ${plan.county.state}` : ""}` : null;
  const criteria = designCriteria(structure, county, countyName);
  const layout = siteLayout(plan, structure);
  const sheets = permitSheets(structure);
  const siteW = layout.bounds.x1 - layout.bounds.x0;
  const siteH = layout.bounds.y1 - layout.bounds.y0;
  // The site plan's box on A1 is about 6.3 × 9.3 in.; the street band and the graphic scale take ~1.75 in. below
  // the lot and north ~1.25 in. beside it, whatever the scale (deck-site-plan sizes them in paper inches).
  const scale = siteScale(siteW, siteH, { w: 6.3 - 1.25, h: 9.3 - 1.75 });
  const floorDetails = frame ? detailDrawings(structure, "floor") : [];
  const rDetails = roofDetails(structure, county?.windMph ?? null);
  const section = sectionDrawing(structure);
  const notes = permitNotes(structure, criteria.countyNotes, county?.edition ?? null);
  const fails = checks.filter((c) => c.level === "fail");
  const warns = [...criteria.warnings, ...layout.checks.filter((c) => c.level === "warn").map((c) => c.text)];
  const what = structureWords(design);
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  // The title block's project line: the draft's or proposal's own title when it already names the deck, else the deck and the title.
  const named = title && title !== "Deck" ? (title.toLowerCase().includes(what.toLowerCase()) ? title : `${what} — ${title}`) : what;
  const tb = { sheets, what: named, address, plan, shop, today, county: countyName, code: structure.code.short };

  return (
    <div className={`${s.sheet} jf-blueprint`}>
      <div className="content" style={{ display: "contents" }}>
        {/* ── On screen only: what to confirm before it prints ───────────── */}
        <div className={s.panel} data-permit-panel>
          <div className={s.panelHead}>
            <div>
              <div className={s.panelKick}>Permit set · {sheets.length} sheets, 11 × 17</div>
              <div className={s.panelTitle}>{what}</div>
              <div className={s.panelSub}>{address ?? "No job address — set it in the studio to keep the site plan and read the county."}</div>
            </div>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => window.print()}>Print / save as PDF</button>
          </div>
          {fails.length || warns.length ? (
            <div className={s.alerts} data-permit-alerts>
              {fails.map((c) => (
                <div key={c.id} className={s.alertFail}><b>{c.part}:</b> {c.text} — fix it in the studio before submitting.</div>
              ))}
              {warns.map((w, i) => (
                <div key={i} className={s.alertWarn}>{w}</div>
              ))}
            </div>
          ) : null}
          <SitePlanPanel plan={plan} fallback={fallback} update={update} readLot={readLot} busy={busy} said={said} editable={editable} hasAddress={!!address} detached={design.placement === "detached"} />
          <div className={s.panelFoot}>
            <span>{status}</span>
            <span>{county ? `${county.county}: the county's own figures on file (${RESEARCHED_ON}) — ${county.jurisdiction}.` : countyName ? `${countyName}: not among the counties on file — the state's figures are used; confirm them with the building department.` : "The county is read from the address."}</span>
          </div>
        </div>

        <div className={s.sheets} style={{ zoom }}>
          {/* ── A1 · the site plan and the project's data ─────────────────── */}
          <section className={s.page} data-permit-page="A1" data-permit-kind="site">
            <div className={s.a1}>
              <figure className={s.fig} style={{ gridArea: "site" }}>
                <figcaption className={s.figCap}>1 · Site plan<span>Scale 1&quot; = {scale}&apos;-0&quot;</span></figcaption>
                <div className={s.figBody}>
                  <SitePlanSvg layout={layout} plan={plan} scaleFtPerIn={scale} storeys={design.house.storeys} label={`Site plan of ${address ?? "the lot"}`} />
                </div>
                <div className={s.siteSource} data-site-source>
                  {plan.lot.kind === "parcel" ? `Property lines from the county's parcel map${plan.lot.apn ? ` (parcel ${plan.lot.apn})` : ""} — not a boundary survey; distances to the lines are approximate.` : "Lot as measured by the contractor — not a boundary survey."} New deck on the house&apos;s {DECK_SIDE_LABEL[plan.deckSide].toLowerCase()}{plan.deckSide === "rear" ? " wall" : ""}, located by the contractor. Locate the lines and the utilities before digging.
                </div>
              </figure>
              <div className={s.dataCol} style={{ gridArea: "data" }}>
                <div className={s.h2}>Project</div>
                <table className={s.kv}>
                  <tbody>
                    <tr><th>Scope</th><td>{scopeWords(structure)}</td></tr>
                    <tr><th>Property</th><td>{address ?? "—"}{plan.lot.kind === "parcel" && plan.lot.apn ? ` · parcel ${plan.lot.apn}` : ""}</td></tr>
                    <tr><th>Lot</th><td>{plan.lot.kind === "parcel" ? `${plan.lot.areaSqFt.toLocaleString("en-US")} sq ft, from the county's parcel record` : `${plan.lot.widthFt} ft × ${plan.lot.depthFt} ft (${Math.round(plan.lot.widthFt * plan.lot.depthFt).toLocaleString("en-US")} sq ft), as measured`}</td></tr>
                    <tr><th>Owner</th><td>{plan.owner || "—"}</td></tr>
                    <tr><th>Setbacks</th><td>{layout.distances.map((dd) => `${dd.side} ${ftIn(Math.round(dd.ft * 12))}`).join(" · ")}{plan.setbackRearFt != null ? ` — zoning: rear ${plan.setbackRearFt} ft` : ""}{plan.setbackSideFt != null ? `, side ${plan.setbackSideFt} ft` : ""}</td></tr>
                  </tbody>
                </table>
                <div className={s.h2}>Design criteria</div>
                <table className={s.crit} data-permit-criteria>
                  <tbody>
                    {criteria.rows.map((r) => (
                      <tr key={r.label} className={r.short ? s.critShort : undefined}><th>{r.label}</th><td>{r.value}</td><td className={s.rule}>{r.source}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <figure className={s.fig} style={{ gridArea: "elev" }}>
                <figcaption className={s.figCap}>2 · Front elevation, from the yard<span>Not to scale — dimensions govern</span></figcaption>
                <div className={s.figBody}><Elevation elevation={elevation} design={design} hasFrame={!!frame} /></div>
              </figure>
              <div className={s.notesBox} style={{ gridArea: "notes" }}>
                <div className={s.h2}>General notes</div>
                <ol className={s.notes} data-permit-notes>
                  {notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ol>
              </div>
            </div>
            <TitleBlock {...tb} sheet={sheets[0]} scaleLine={`Site plan 1" = ${scale}'-0"`} />
          </section>

          {/* ── S1 · the floor, the section, the lateral ─────────────────── */}
          {frame ? (
            <section className={s.page} data-permit-page="S1" data-permit-kind="floor">
              <div className={s.s1}>
                <figure className={s.fig} style={{ gridArea: "plan" }}>
                  <figcaption className={s.figCap}>1 · Floor framing plan<span>Not to scale — dimensions govern</span></figcaption>
                  <div className={s.figBody}><DeckPlan structure={structure} show="floor" marks={lateralDevices(frame).map((d, i) => ({ x: d.x, y: d.y, label: `LD-${i + 1}` }))} /></div>
                </figure>
                {section ? (
                  <figure className={s.fig} style={{ gridArea: "section" }}>
                    <figcaption className={s.figCap}>2 · Section through the deck<span>Looking along the house</span></figcaption>
                    <div className={s.figBody}><DrawingSvg drawing={section} label="Section through the deck" /></div>
                  </figure>
                ) : null}
                <div className={s.detailCol} style={{ gridArea: "details" }}>
                  {floorDetails.map((dt, i) => (
                    <Detail key={dt.title} n={i + 3} dt={dt} />
                  ))}
                </div>
                <div className={s.schedCol} style={{ gridArea: "sched" }}>
                  <FloorSchedules structure={structure} />
                </div>
              </div>
              <TitleBlock {...tb} sheet={sheets.find((x) => x.kind === "floor") ?? sheets[1]} scaleLine="As noted" />
            </section>
          ) : null}

          {/* ── S2 · the roof ────────────────────────────────────────────── */}
          {roof ? (
            <section className={s.page} data-permit-page={sheets.find((x) => x.kind === "roof")?.no} data-permit-kind="roof">
              <div className={s.s2}>
                <figure className={s.fig} style={{ gridArea: "plan" }}>
                  <figcaption className={s.figCap}>1 · {roof.kind === "pergola" ? "Pergola" : "Roof"} framing plan<span>Not to scale — dimensions govern</span></figcaption>
                  <div className={s.figBody}><DeckPlan structure={structure} show="roof" /></div>
                </figure>
                <div className={s.detailCol} style={{ gridArea: "details" }}>
                  {rDetails.map((dt, i) => (
                    <Detail key={dt.title} n={i + 2} dt={dt} />
                  ))}
                </div>
                <div className={s.schedCol} style={{ gridArea: "sched" }}>
                  <RoofSchedule structure={structure} />
                </div>
              </div>
              <TitleBlock {...tb} sheet={sheets.find((x) => x.kind === "roof") ?? sheets[sheets.length - 1]} scaleLine="As noted" />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The scope in a sentence, for the reviewer. */
function scopeWords(st: DeckStructure): string {
  const d = st.design;
  const f = st.frame;
  const parts: string[] = [`New ${structureWords(d)}`];
  if (f) parts.push(`${Math.round(f.areaSqFt)} sq ft, the walking surface ${ftIn(d.heightIn)} above grade`, PLACEMENT_LABEL[d.placement].toLowerCase(), `${f.decking.label} on ${f.species.short.toLowerCase()} framing`);
  if (st.rails.on) parts.push(`${st.rails.label} guard, ${st.rails.heightIn} in.`);
  if (st.stairs.length) parts.push(`${st.stairs.length} stair${st.stairs.length > 1 ? "s" : ""}`);
  if (st.roof) parts.push(st.roof.kind === "pergola" ? "a pergola over it" : `a ${st.roof.kind} roof over it, ${st.roof.roof.pitch}:12`);
  if (st.electrical.on) parts.push("lights and receptacles");
  return `${parts.join(" · ")}.`;
}

function TitleBlock({ sheet, sheets, what, address, plan, shop, today, county, code, scaleLine }: { sheet: PermitSheet; sheets: PermitSheet[]; what: string; address: string | null; plan: SitePlan; shop: Shop; today: string; county: string | null; code: string; scaleLine: string }) {
  const idx = Math.max(0, sheets.findIndex((x) => x.no === sheet.no));
  return (
    <aside className={s.tb} data-permit-titleblock>
      <div className={s.tbKick}>Permit drawings</div>
      <div className={s.tbProject}>{what}</div>
      <div className={s.tbLine}>{address ?? "Job address"}</div>
      {county ? <div className={s.tbLine}>{county}</div> : null}
      {plan.lot.kind === "parcel" && plan.lot.apn ? <div className={s.tbLine}>Parcel {plan.lot.apn}</div> : null}
      <div className={s.tbGroup}>
        <div className={s.tbLabel}>Owner</div>
        <div className={s.tbLine}>{plan.owner || " "}</div>
      </div>
      <div className={s.tbGroup}>
        <div className={s.tbLabel}>Prepared by</div>
        <div className={s.tbStrong}>{shop.name || "Contractor"}</div>
        {shop.address ? <div className={s.tbLine}>{shop.address}</div> : null}
        {shop.phone ? <div className={s.tbLine}>{shop.phone}</div> : null}
        <div className={s.tbLine}>License {plan.licence || "____________"}</div>
      </div>
      <div className={s.tbGroup}>
        <div className={s.tbLabel}>Sheets</div>
        {sheets.map((x) => (
          <div key={x.no} className={x.no === sheet.no ? s.tbIndexOn : s.tbIndex}><b>{x.no}</b> {x.name}</div>
        ))}
      </div>
      <table className={s.tbRev}>
        <thead><tr><th>Rev</th><th>Date</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td>—</td><td>{today}</td><td>Issued for permit</td></tr>
          <tr><td>&nbsp;</td><td /><td /></tr>
        </tbody>
      </table>
      <div className={s.tbFoot}>
        <div className={s.tbMeta}><span>Date</span>{today}</div>
        <div className={s.tbMeta}><span>Scale</span>{scaleLine}</div>
        <div className={s.tbMeta}><span>Code</span>{code}</div>
        <div className={s.tbSheetName}>{sheet.name}</div>
        <div className={s.tbSheetNo}>{sheet.no}</div>
        <div className={s.tbOf}>sheet {idx + 1} of {sheets.length}</div>
        <div className={s.tbFine}>Prescriptive design to the IRC deck provisions (R507) and AWC DCA 6 as adopted; the building department&apos;s review governs.</div>
      </div>
    </aside>
  );
}

function Detail({ n, dt }: { n: number; dt: DetailDrawing }) {
  return (
    <div className={s.detail} data-permit-detail={dt.title}>
      <div className={s.detailTitle}>{`${n} · ${dt.title}`}</div>
      <DrawingSvg drawing={dt.drawing} label={dt.title} className={s.dwDetail} fontScale={1.35} />
      <ol className={s.notes}>
        {dt.notes.map((t, k) => (
          <li key={k}>{t}</li>
        ))}
      </ol>
    </div>
  );
}

function Elevation({ elevation: E, design, hasFrame }: { elevation: Built["elevation"]; design: DeckDesign; hasFrame: boolean }) {
  const pad = 2.5;
  const vb = `${-pad} ${-(E.heightFt + pad)} ${E.widthFt + 2 * pad} ${E.heightFt + 2 * pad}`;
  const poly = (pts: number[]) => {
    const out: string[] = [];
    for (let i = 0; i < pts.length; i += 2) out.push(`${pts[i]},${-pts[i + 1]}`);
    return out.join(" ");
  };
  const fmt = (ft: number) => ftIn(ft * 12);
  return (
    <svg className={s.elev} viewBox={vb} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Front elevation, ${fmt(E.widthFt)} wide, ${fmt(E.heightFt)} high`}>
      <g className={s.deck}>{E.polys.filter((p) => DECK_LAYERS.has(p.layer)).map((p, i) => <polygon key={`d${i}`} points={poly(p.pts)} />)}</g>
      <g className={s.roof}>{E.polys.filter((p) => !DECK_LAYERS.has(p.layer) && !RAIL_LAYERS.has(p.layer)).map((p, i) => <polygon key={`r${i}`} points={poly(p.pts)} />)}</g>
      <g className={s.rail}>{E.polys.filter((p) => RAIL_LAYERS.has(p.layer)).map((p, i) => <polygon key={`l${i}`} points={poly(p.pts)} />)}</g>
      <line className={s.ground} x1={-pad} y1={0} x2={E.widthFt + pad} y2={0} />
      <g className={s.dim}>
        <line x1={0} y1={1.2} x2={E.widthFt} y2={1.2} strokeWidth={0.05} />
        <text x={E.widthFt / 2} y={2} fontSize={0.6} textAnchor="middle">{fmt(E.widthFt)}</text>
        <line x1={E.widthFt + 1} y1={0} x2={E.widthFt + 1} y2={-E.heightFt} strokeWidth={0.05} />
        <text x={E.widthFt + 1.4} y={-E.heightFt / 2} fontSize={0.6} transform={`rotate(90 ${E.widthFt + 1.4} ${-E.heightFt / 2})`} textAnchor="middle">{fmt(E.heightFt)}</text>
        {hasFrame ? <text x={0} y={-design.heightIn / 12 - 0.3} fontSize={0.5}>{`deck ${ftIn(design.heightIn)}`}</text> : null}
      </g>
    </svg>
  );
}

/** The floor's schedules: framing, footings by kind, connectors, stairs and guards. */
function FloorSchedules({ structure }: { structure: DeckStructure }) {
  const f = structure.frame;
  if (!f) return null;
  const d = structure.design;
  const posts = [...f.posts, ...(structure.lower?.frame.posts ?? [])];
  const beams = [...f.beams, ...(structure.lower?.frame.beams ?? [])];
  // Footings by kind: one row per post size, footing and depth.
  const groups = new Map<string, { n: number; text: string; depth: number; most: number }>();
  for (const p of posts) {
    const ft = p.footing;
    const text = ft.type === "poured" ? `${ft.padIn} in. × ${ft.padThickIn} in. pad, ${ft.pierIn}-in. pier` : "precast pier block";
    const key = `${p.size}|${text}|${ft.depthIn}`;
    const g = groups.get(key) ?? { n: 0, text: `${p.size} post · ${text}`, depth: ft.depthIn, most: 0 };
    g.n += 1;
    g.most = Math.max(g.most, p.tributarySqFt);
    groups.set(key, g);
  }
  const devices = lateralDevices(f);
  const hw = f.hardware;
  const ledgerFasteners = f.ledgers.reduce((a, l) => a + l.fasteners, 0);
  const connectors: Array<[string, string, number]> = [
    ["Joist hangers", "every joist end on a ledger or flush beam", hw.hangers],
    ["Double hangers", "doubled joists", hw.doubleHangers],
    ["Joist ties", "every joist on a dropped beam", hw.ties],
    ["Post bases", "every post, 1 in. off the concrete", hw.postBases],
    ["Post caps", "every post to its beam", hw.postCaps],
    ["Ledger fasteners", d.placement === "attached" ? LEDGER_FASTENER_LABEL[d.ledger.fastener] : "—", ledgerFasteners],
    ["Lateral devices", devices.length ? `${devices[0].lb.toLocaleString("en-US")}-lb hold-downs, ${RULE.lateral}` : "—", devices.length],
    ["Knee braces", "corner posts over 2 ft", hw.braces],
    ["Rim screws", "three at every joist end", hw.rimScrews],
  ];
  return (
    <>
      <div className={s.h2}>Framing schedule</div>
      <table className={s.table}>
        <thead><tr><th>Member</th><th>Size</th><th className={s.r}>Spacing / span</th><th>Table</th></tr></thead>
        <tbody>
          <tr><td>Joists</td><td>{f.joistSize}</td><td className={s.r}>{f.spacingIn}&quot; o.c. · {ftIn(Math.max(...f.zones.flatMap((z) => z.spansIn)))}</td><td className={s.rule}>{RULE.joist}</td></tr>
          {beams.map((b, i) => (
            <tr key={`${b.id}${i}`}><td>Beam {b.id}</td><td>{b.spec.size}{b.style === "flush" ? ", flush" : ""}</td><td className={s.r}>posts {ftIn(b.spanIn)} (≤ {ftIn(b.maxSpanIn)})</td><td className={s.rule}>{b.table === "DCA6" ? RULE.solidBeam : RULE.beam}</td></tr>
          ))}
          <tr><td>Posts</td><td>{d.framing.post}</td><td className={s.r}>{posts.length} · tallest {ftIn(Math.max(...posts.map((p) => p.heightIn)))}</td><td className={s.rule}>{RULE.post}</td></tr>
          {f.ledgers.map((l, i) => (
            <tr key={`l${i}`}><td>Ledger</td><td>{f.sticks.find((st) => st.role === "ledger")?.nominal ?? "2x"}</td><td className={s.r}>{l.fasteners} @ {l.spacingIn}&quot;, 2 rows</td><td className={s.rule}>{l.rule}</td></tr>
          ))}
          <tr><td>Rim</td><td>{f.joistSize}{d.framing.doubleRim ? ", doubled" : ""}</td><td className={s.r}>3 screws per joist</td><td className={s.rule}>{RULE.hangers}</td></tr>
        </tbody>
      </table>
      <div className={s.h2}>Footing schedule</div>
      <table className={s.table}>
        <thead><tr><th className={s.r}>No.</th><th>Footing</th><th className={s.r}>Depth</th><th className={s.r}>Carries</th></tr></thead>
        <tbody>
          {[...groups.values()].map((g, i) => (
            <tr key={i}><td className={s.r}>{g.n}</td><td>{g.text}</td><td className={s.r}>{g.depth} in.</td><td className={s.r}>≤ {Math.round(g.most)} sq ft</td></tr>
          ))}
        </tbody>
      </table>
      <div className={s.rule}>{RULE.footing} · {d.soilPsf.toLocaleString("en-US")} psf · frost {d.frostIn} in. ({RULE.frost})</div>
      <div className={s.h2}>Connector schedule</div>
      <table className={s.table}>
        <thead><tr><th>Connector</th><th>Where</th><th className={s.r}>Qty</th></tr></thead>
        <tbody>
          {connectors.filter((c) => c[2] > 0).map((c) => (
            <tr key={c[0]}><td>{c[0]}</td><td>{c[1]}</td><td className={s.r}>{c[2]}</td></tr>
          ))}
        </tbody>
      </table>
      {structure.stairs.length || structure.rails.on ? (
        <>
          <div className={s.h2}>Stairs and guards</div>
          <table className={s.table}>
            <tbody>
              {structure.stairs.map((st, i) => (
                <tr key={st.design.id}><td>{st.kind === "box" ? "Box steps" : `Stair ${i + 1} (${st.design.side})`}</td><td>{st.kind === "box" ? "2x6 box frames" : `${st.stringers.count} 2x12 stringers @ ${st.stringers.spacingIn}"`}</td><td className={s.r}>{st.risers} × {st.riserIn.toFixed(2)}&quot; · treads {st.runIn + 1}&quot; · {st.widthIn}&quot; wide</td></tr>
              ))}
              {structure.rails.on ? <tr><td>Guard</td><td>{structure.rails.label}, {structure.rails.infill}</td><td className={s.r}>{structure.rails.heightIn}&quot; · {Math.round(structure.rails.totalLf)} ft</td></tr> : null}
            </tbody>
          </table>
          <div className={s.rule}>{STAIR_RULES.riser.split(" — ")[0]} · {STAIR_RULES.tread.split(" — ")[0]} · {RULE.guard}</div>
        </>
      ) : null}
    </>
  );
}

function RoofSchedule({ structure }: { structure: DeckStructure }) {
  const roof = structure.roof;
  if (!roof) return null;
  return (
    <>
      <div className={s.h2}>{roof.kind === "pergola" ? "Pergola schedule" : "Roof schedule"}</div>
      <table className={s.table}>
        <thead><tr><th>Member</th><th>Size</th><th className={s.r}>Spacing / span</th><th>Table</th></tr></thead>
        <tbody>
          {roof.trusses ? <tr><td>Trusses</td><td>{roof.trusses.count} · {roof.trusses.chord}</td><td className={s.r}>{roof.trusses.spacingIn}&quot; o.c. · {ftIn(roof.trusses.spanIn)}</td><td className={s.rule}>IRC R802.10</td></tr> : <tr><td>Rafters</td><td>{roof.rafters.size}</td><td className={s.r}>{roof.rafters.spacingIn}&quot; o.c. · {ftIn(roof.rafters.spanIn)} (≤ {ftIn(roof.rafters.maxSpanIn)})</td><td className={s.rule}>{RULE_RAFTER[roof.roofLoad]}</td></tr>}
          {roof.headers.map((h) => (
            <tr key={h.id}><td>Header {h.id.replace("h", "")}</td><td>{h.spec.size}</td><td className={s.r}>{ftIn(h.lengthIn)} · supports {ftIn(h.spanIn)}</td><td className={s.rule}>{h.spec.kind === "lvl" ? "LVL maker's tables" : RULE.beam}</td></tr>
          ))}
          {roof.ridge ? <tr><td>Ridge</td><td>{roof.ridge.kind === "beam" ? `${roof.ridge.spec?.size ?? roof.ridge.nominal} beam` : `${roof.ridge.nominal} board`}</td><td className={s.r}>{ftIn(roof.ridge.lengthIn)}</td><td className={s.rule}>IRC R802.3</td></tr> : null}
          {roof.hips.count ? <tr><td>Hips</td><td>{roof.hips.nominal}</td><td className={s.r}>{roof.hips.count}</td><td className={s.rule}>IRC R802.3</td></tr> : null}
          <tr><td>Posts</td><td>{roof.roof.post}</td><td className={s.r}>{roof.posts.length} · {ftIn(roof.roof.eaveHeightIn)} to headers</td><td className={s.rule}>{RULE.post}</td></tr>
          {roof.ledger ? <tr><td>Roof ledger</td><td>{roof.ledger.nominal}</td><td className={s.r}>{roof.ledger.fasteners} screws</td><td className={s.rule}>{RULE.ledgerBoard}</td></tr> : null}
        </tbody>
      </table>
      <div className={s.h2}>Loads</div>
      <table className={s.table}>
        <tbody>
          <tr><td>Roof</td><td className={s.r}>{roof.roofLoad} psf {roof.roofLoad === 20 ? "live" : "snow"} · {roof.deadPsf} psf dead</td></tr>
          <tr><td>Pitch</td><td className={s.r}>{roof.roof.pitch}:12</td></tr>
          <tr><td>Stands</td><td className={s.r}>{roof.attach === "wall" ? "on the house wall and its posts" : "on its own posts, braced"}</td></tr>
        </tbody>
      </table>
    </>
  );
}

/* ── The site plan's figures, on screen ─────────────────────────────────── */
function SitePlanPanel({ plan, fallback, update, readLot, busy, said, editable, hasAddress, detached }: { plan: SitePlan; fallback: SitePlan; update: (p: SitePlan) => void; readLot: () => void; busy: boolean; said: string[]; editable: boolean; hasAddress: boolean; detached: boolean }) {
  const numIn = (label: string, value: number | null, set: (n: number | null) => void, opts: { allowEmpty?: boolean; step?: number; id?: string } = {}) => (
    <label className={s.field}>
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={opts.step ?? 0.5}
        value={value ?? ""}
        disabled={!editable}
        data-site-field={opts.id}
        onChange={(e) => {
          const raw = e.target.value.trim();
          if (raw === "") {
            if (opts.allowEmpty) set(null);
            return;
          }
          const n = Number(raw);
          if (Number.isFinite(n)) set(n);
        }}
      />
    </label>
  );
  const textIn = (label: string, value: string, set: (v: string) => void, placeholder = "", id?: string) => (
    <label className={s.field}>
      <span>{label}</span>
      <input type="text" value={value} placeholder={placeholder} disabled={!editable} data-site-field={id} onChange={(e) => set(e.target.value)} />
    </label>
  );
  const lot = plan.lot;
  return (
    <div className={s.sitePanel} data-site-panel>
      <div className={s.siteHow} data-site-how>
        <b>How the site plan is placed.</b> It starts from the job address: the address names the state&apos;s and the county&apos;s codes, and &ldquo;Read the lot&rdquo; draws the lot from the county&apos;s parcel record, the street side found from the address. The deck is drawn on the side of the house picked below — the back unless you change it.
        <span> Check before you print: the street runs along the bottom, the house sits where it really does on the lot, and the deck is on the right side of the house. Parcel lines are not a survey.</span>
      </div>
      <div className={s.siteGroup}>
        <div className={s.siteGroupTitle}>The lot</div>
        {lot.kind === "parcel" ? (
          <p className={s.siteSaid}>From the county&apos;s parcel record{lot.apn ? ` · parcel ${lot.apn}` : ""} · {lot.areaSqFt.toLocaleString("en-US")} sq ft.</p>
        ) : (
          <div className={s.fields}>
            {numIn("Width at the street, ft", lot.widthFt, (n) => update({ ...plan, lot: { ...lot, widthFt: n ?? lot.widthFt } }), { id: "lot-width" })}
            {numIn("Depth, ft", lot.depthFt, (n) => update({ ...plan, lot: { ...lot, depthFt: n ?? lot.depthFt } }), { id: "lot-depth" })}
          </div>
        )}
        <div className={s.siteBtns}>
          <button type="button" className={s.btn} disabled={!editable || !hasAddress || busy} onClick={readLot} data-site-read-lot>{busy ? "Reading…" : "Read the lot from the county record"}</button>
          {lot.kind === "parcel" ? (
            <>
              <button type="button" className={s.btn} disabled={!editable} onClick={() => update(turnLot(plan))} data-site-turn>Turn — next edge is the street</button>
              <button type="button" className={s.btn} disabled={!editable} onClick={() => update({ ...plan, lot: fallback.lot, house: { ...plan.house, footprint: null } })}>Type the lot instead</button>
            </>
          ) : null}
        </div>
        {said.map((t, i) => (
          <p key={i} className={s.siteSaid}>{t}</p>
        ))}
      </div>
      <div className={s.siteGroup}>
        <div className={s.siteGroupTitle}>The house on it</div>
        <div className={s.field}>
          <span>The deck is on the house&apos;s (as seen from the street)</span>
          <span className={s.sideSeg} role="group" aria-label="Which side of the house the deck is on">
            {DECK_SIDES.map((side) => (
              <button key={side} type="button" disabled={!editable} aria-pressed={plan.deckSide === side} className={plan.deckSide === side ? s.sideOn : undefined} onClick={() => update({ ...plan, deckSide: side })} data-site-side={side}>
                {DECK_SIDE_LABEL[side]}
              </button>
            ))}
          </span>
        </div>
        <div className={s.fields}>
          {numIn("Front wall to the street line, ft", plan.house.frontFt, (n) => update({ ...plan, house: { ...plan.house, frontFt: n ?? plan.house.frontFt, footprint: null } }), { id: "house-front" })}
          {numIn("Left side to the left line, ft", plan.house.leftFt, (n) => update({ ...plan, house: { ...plan.house, leftFt: n ?? plan.house.leftFt, footprint: null } }), { id: "house-left" })}
          {numIn("House depth, ft", plan.house.depthFt, (n) => update({ ...plan, house: { ...plan.house, depthFt: n ?? plan.house.depthFt, footprint: null } }), { id: "house-depth" })}
          {numIn("House width, ft (blank = the studio's wall)", plan.house.widthFt === "auto" ? null : plan.house.widthFt, (n) => update({ ...plan, house: { ...plan.house, widthFt: n ?? "auto", footprint: null } }), { allowEmpty: true, id: "house-width" })}
          {detached ? numIn("Deck from that wall, ft", plan.deckGapFt, (n) => update({ ...plan, deckGapFt: n ?? plan.deckGapFt }), { id: "deck-gap" }) : null}
        </div>
      </div>
      <div className={s.siteGroup}>
        <div className={s.siteGroupTitle}>Street, north, zoning</div>
        <div className={s.fields}>
          {textIn("Street", plan.street, (v) => update({ ...plan, street: v }), "Meadow Glen Dr", "street")}
          <div className={s.field}>
            <span>North, degrees from up</span>
            <span className={s.northRow}>
              <button type="button" className={s.btnSm} disabled={!editable} onClick={() => update({ ...plan, northDeg: (plan.northDeg + 345) % 360 })} aria-label="Turn north left">↺</button>
              <b>{plan.northDeg}°</b>
              <button type="button" className={s.btnSm} disabled={!editable} onClick={() => update({ ...plan, northDeg: (plan.northDeg + 15) % 360 })} aria-label="Turn north right">↻</button>
            </span>
          </div>
          {numIn("Rear setback (zoning), ft", plan.setbackRearFt, (n) => update({ ...plan, setbackRearFt: n }), { allowEmpty: true, id: "setback-rear" })}
          {numIn("Side setback (zoning), ft", plan.setbackSideFt, (n) => update({ ...plan, setbackSideFt: n }), { allowEmpty: true, id: "setback-side" })}
        </div>
      </div>
      <div className={s.siteGroup}>
        <div className={s.siteGroupTitle}>Title block</div>
        <div className={s.fields}>
          {textIn("Property owner", plan.owner, (v) => update({ ...plan, owner: v }), "", "owner")}
          {textIn("Contractor license no.", plan.licence, (v) => update({ ...plan, licence: v }), "", "licence")}
          {textIn("County", plan.county?.name ?? "", (v) => update({ ...plan, county: v.trim() ? { name: v, state: plan.county?.state ?? "", source: "typed" } : null }), "Harris County", "county")}
          {textIn("State", plan.county?.state ?? "", (v) => update({ ...plan, county: { name: plan.county?.name ?? "", state: v.toUpperCase().slice(0, 2), source: "typed" } }), "TX", "state")}
        </div>
      </div>
    </div>
  );
}
