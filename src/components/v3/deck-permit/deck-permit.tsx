"use client";
// THE PERMIT SET (2026-10-10; the submittal set 2026-10-20; the full plan set
// 2026-10-23) — what a building office asks for with a deck permit, drawn from
// the same engine the studio prices with (lib/deck). Since 2026-10-23 the
// sheets are the plan set (components/v3/deck-plans: the cover, the notes and
// the code compliance, the foundation and framing plans to scale, elevations,
// sections, details, schedules); this page keeps what only it knows — the site
// plan, kept by the property, and the county read from the address — and draws
// the site sheet (A-101) and the roof sheet into the set's own frame.
// Above the sheets, on screen only: the site plan's figures to confirm (kept
// by the property — actions/deckSitePlan), the county read from the address,
// and anything a reviewer would send back. Print to PDF from the browser.
import * as React from "react";
import { buildStructure, type DeckStructure } from "@/lib/deck/structure";
import { deckChecks } from "@/lib/deck/checks";
import { PLACEMENT_LABEL, structureWords, type DeckDesign } from "@/lib/deck/design";
import { ftIn, RULE } from "@/lib/deck/codeTables";
import { RULE_RAFTER } from "@/lib/deck/roofTables";
import { DeckPlan } from "@/components/v3/deck-estimator-blueprint/deck-plan";
import { permitNotes, roofDetails, type DetailDrawing } from "@/lib/deck/permit";
import { crewSheetList } from "@/lib/deck/plans/sheets";
import { DECK_SIDE_LABEL, DECK_SIDES, defaultSitePlan, normalizeSitePlan, siteLayout, siteScale, turnLot, type SitePlan } from "@/lib/deck/sitePlan";
import { countyCodeFor, designCriteria, RESEARCHED_ON } from "@/lib/deck/countyCodes";
import { readDeckCounty, readDeckLot, saveDeckSitePlan } from "@/actions/deckSitePlan";
import { DrawingSvg } from "./deck-sections";
import { SitePlanSvg } from "./deck-site-plan";
import { PlanSet, ViewFrame } from "@/components/v3/deck-plans/plan-set";
import ps from "@/components/v3/deck-plans/plan-set.module.css";
import s from "./deck-permit.module.css";

const SHEET_W_PX = 17 * 96;

type Shop = { name: string; address: string | null; phone: string | null; email: string | null };
type Built = { structure: DeckStructure; checks: ReturnType<typeof deckChecks> };

export function DeckPermitSheet({ design, address, title, shop, initialPlan = null, editable = true }: { design: DeckDesign | null; address: string | null; title: string; shop: Shop; initialPlan?: SitePlan | null; editable?: boolean }) {
  const built = React.useMemo<Built | null>(() => {
    if (!design) return null;
    const structure = buildStructure(design);
    return { structure, checks: deckChecks(structure) };
  }, [design]);
  if (!design || !built) {
    return (
      <div className={s.sheet}>
        <div className={s.empty}>
          <div className={s.title}>Permit set</div>
          <p>No deck design was handed to this page. Open it from the Deck Studio&apos;s Permit &amp; build set button, or from a saved draft or proposal.</p>
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
  const { structure, checks } = built;
  const { roof } = structure;
  const fallback = React.useMemo(() => defaultSitePlan(structure, address), [structure, address]);
  const [plan, setPlan] = React.useState<SitePlan>(() => (initialPlan ? normalizeSitePlan(initialPlan, fallback) : fallback));
  const [status, setStatus] = React.useState("");
  const [said, setSaid] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  // The building department's set (11 × 17) or the crew's (letter) — the same design, drawn for each.
  const [which, setWhich] = React.useState<"permit" | "crew">("permit");
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
  const siteW = layout.bounds.x1 - layout.bounds.x0;
  const siteH = layout.bounds.y1 - layout.bounds.y0;
  // The site plan's frame on A-101 is about 8.6 × 9.4 in.; the street band and the graphic scale take ~1.75 in. below
  // the lot and north ~1.25 in. beside it, whatever the scale (deck-site-plan sizes them in paper inches).
  const scale = siteScale(siteW, siteH, { w: 8.6 - 1.25, h: 9.2 - 1.75 });
  const rDetails = roofDetails(structure, county?.windMph ?? null);
  const notes = permitNotes(structure, criteria.countyNotes, county?.edition ?? null);
  const fails = checks.filter((c) => c.level === "fail");
  const warns = [...criteria.warnings, ...layout.checks.filter((c) => c.level === "warn").map((c) => c.text)];
  const what = structureWords(design);
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  // The title block's project line: the draft's or proposal's own title when it already names the deck, else the deck and the title.
  const named = title && title !== "Deck" ? (title.toLowerCase().includes(what.toLowerCase()) ? title : `${what} — ${title}`) : what;

  return (
    <div className={`${s.sheet} jf-blueprint`}>
      <div className="content" style={{ display: "contents" }}>
        {/* ── On screen only: what to confirm before it prints ───────────── */}
        <div className={s.panel} data-permit-panel>
          <div className={s.panelHead}>
            <div>
              <div className={s.panelKick}>{which === "permit" ? "Permit set · for the building department · 11 × 17" : `Construction set · for the crew · ${crewSheetList(structure).length} sheets, letter`}</div>
              <div className={s.panelTitle}>{what}</div>
              <div className={s.panelSub}>{address ?? "No job address — set it in the studio to keep the site plan and read the county."}</div>
            </div>
            <div className={s.panelActions}>
              <span className={ps.seg} role="group" aria-label="Which set">
                <button type="button" aria-pressed={which === "permit"} onClick={() => setWhich("permit")} data-plan-set-pick="permit">Permit set</button>
                <button type="button" aria-pressed={which === "crew"} onClick={() => setWhich("crew")} data-plan-set-pick="crew">Construction set</button>
              </span>
              <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => window.print()}>Print / save as PDF</button>
            </div>
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

        <div style={{ zoom }}>
          <PlanSet
            structure={structure}
            checks={checks}
            set={which}
            shop={shop}
            criteria={criteria.rows}
            notes={notes}
            project={{ title: named, address, owner: plan.owner, parcel: plan.lot.kind === "parcel" ? plan.lot.apn ?? null : null, county: countyName, licence: plan.licence, date: today, code: structure.code.short }}
            slots={{
              site: (_sheet, frameIt) =>
                frameIt(<SiteSheet layout={layout} plan={plan} scale={scale} structure={structure} address={address} />, ps.foundation),
              roof: roof
                ? (_sheet, frameIt) =>
                    frameIt(
                      <>
                        <ViewFrame no={1} sheetNo={_sheet.no} title={roof.kind === "pergola" ? "Pergola framing plan" : "Roof framing plan"} scaleLabel="Not to scale — dimensions govern">
                          <div className={s.roofPlan}><DeckPlan structure={structure} show="roof" /></div>
                        </ViewFrame>
                        <div className={ps.side}>
                          {rDetails.map((dt, i) => (
                            <Detail key={dt.title} n={i + 2} dt={dt} />
                          ))}
                          <RoofSchedule structure={structure} />
                        </div>
                      </>,
                      ps.foundation,
                    )
                : undefined,
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ── A-101 · the site plan, in the plan set's frame ───────────────────── */
function SiteSheet({ layout, plan, scale, structure, address }: { layout: ReturnType<typeof siteLayout>; plan: SitePlan; scale: number; structure: DeckStructure; address: string | null }) {
  const area = (ring: Array<[number, number]>) => Math.abs(ring.reduce((a, p, i) => a + p[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * p[1], 0) / 2);
  const lotSqFt = plan.lot.kind === "parcel" ? plan.lot.areaSqFt : plan.lot.widthFt * plan.lot.depthFt;
  const houseSqFt = area(layout.house);
  const deckSqFt = layout.deck.reduce((a, r) => a + area(r), 0);
  const cover = lotSqFt > 0 ? ((houseSqFt + deckSqFt) / lotSqFt) * 100 : 0;
  const req = (side: string) => (side === "rear" ? plan.setbackRearFt : side === "left" || side === "right" ? plan.setbackSideFt : null);
  return (
    <>
      <ViewFrame no={1} sheetNo="A-101" title="Site plan" scaleLabel={`1" = ${scale}'-0"`} id="site">
        <SitePlanSvg layout={layout} plan={plan} scaleFtPerIn={scale} storeys={structure.design.house.storeys} label={`Site plan of ${address ?? "the lot"}`} />
      </ViewFrame>
      <div className={ps.side}>
        <div>
          <div className={ps.h}>Project</div>
          <table className={ps.kv}>
            <tbody>
              <tr><th>Scope</th><td>{scopeWords(structure)}</td></tr>
              <tr><th>Property</th><td>{address ?? "—"}{plan.lot.kind === "parcel" && plan.lot.apn ? ` · parcel ${plan.lot.apn}` : ""}</td></tr>
              <tr><th>Lot</th><td>{plan.lot.kind === "parcel" ? `${plan.lot.areaSqFt.toLocaleString("en-US")} sq ft, from the county's parcel record` : `${plan.lot.widthFt} ft × ${plan.lot.depthFt} ft, as measured`}</td></tr>
              <tr><th>Owner</th><td>{plan.owner || "—"}</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <div className={ps.h}>Lot coverage</div>
          <table className={ps.t} data-plan-coverage>
            <tbody>
              <tr><td>Lot</td><td className={ps.n}>{Math.round(lotSqFt).toLocaleString("en-US")} sf</td></tr>
              <tr><td>House footprint</td><td className={ps.n}>{Math.round(houseSqFt).toLocaleString("en-US")} sf</td></tr>
              <tr><td>New deck{layout.stairs.length ? " (stairs not counted)" : ""}</td><td className={ps.n}>{Math.round(deckSqFt).toLocaleString("en-US")} sf</td></tr>
              <tr className={ps.sub}><td>Coverage, house + deck</td><td className={ps.n}>{cover.toFixed(1)}%</td></tr>
            </tbody>
          </table>
          <div className={ps.small} style={{ marginTop: 3 }}>Whether a deck counts toward lot coverage is the zoning code&apos;s call; both figures are given.</div>
        </div>
        <div>
          <div className={ps.h}>Setbacks<span>deck to the property lines</span></div>
          <table className={ps.t} data-plan-setbacks>
            <thead>
              <tr><th>Line</th><th className={ps.n}>Provided</th><th className={ps.n}>Required</th><th className={ps.c}>OK</th></tr>
            </thead>
            <tbody>
              {layout.distances.map((dd) => {
                const r = req(dd.side);
                return (
                  <tr key={dd.side}>
                    <td className={ps.k}>{dd.side}</td>
                    <td className={ps.n}>{ftIn(Math.round(dd.ft * 12))}</td>
                    <td className={ps.n}>{r != null ? `${r} ft` : "per zoning"}</td>
                    <td className={ps.c}>{r == null ? <span className={ps.mut}>—</span> : dd.ft + 1e-6 >= r ? <span className={ps.ok}>✓</span> : <span className={ps.bad}>NO</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div>
          <div className={ps.h}>Site notes</div>
          <ol className={ps.notes}>
            <li>{plan.lot.kind === "parcel" ? `Property lines from the county's parcel map${plan.lot.apn ? ` (parcel ${plan.lot.apn})` : ""} — not a boundary survey; distances are approximate.` : "Lot as measured by the contractor — not a boundary survey."}</li>
            <li>New deck on the house&apos;s {DECK_SIDE_LABEL[plan.deckSide].toLowerCase()}{plan.deckSide === "rear" ? " wall" : ""}, located by the contractor; confirm against the site before digging.</li>
            <li>Locate the property lines and every utility before excavating; call 811 at least two business days ahead.</li>
            <li>Keep the grade sloping away from the house under the deck; no change to drainage onto a neighbouring lot.</li>
          </ol>
        </div>
      </div>
    </>
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
