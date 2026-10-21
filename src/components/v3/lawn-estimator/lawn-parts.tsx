"use client";
// THE LAWN ESTIMATOR'S PARTS (2026-10-20): every piece the desk page (lawn-estimator.tsx) and the phone page
// (mobile-lawn-estimator) both show — the reading card, the map tools, the measurements, the services, the totals,
// the plan, the client, the rates. One markup vocabulary (`lw-*`), styled by lawn-estimator.css under either root
// (`.jf-lawn` desk, `.jf-mlawn` phone); each page composes them its own way.
import * as React from "react";
import { Check, ChevronDown, Ruler, Trash2, Undo2, RotateCcw, MousePointerClick, PenLine, X } from "lucide-react";
import { WorkSquare } from "@/components/v3/estimators-blueprint/work-square";
import { CLASS_COLOR, YardMap } from "./yard-map";
import { fromPx, ftPerPx } from "@/lib/lawn/geo";
import { REACHES_FT } from "@/lib/lawn/yard";
import { MOWERS, type LawnSettings, type Mower } from "@/lib/lawn/pricing";
import { monthsOf } from "@/lib/lawn/season";
import type { RuleKind } from "@/lib/lawn/rules";
import type { PlanVisit } from "@/lib/lawn/calendar";
import { taxWords } from "@/lib/lawn/tax";
import { findLawnClients, saveLawnSettings, type LawnClient } from "@/actions/lawnEstimator";
import { area, MONTH, PAINTS, READ_STEPS, sqft, usd, type LawnState } from "./use-lawn-estimator";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

/* ── The read in progress: the roof estimator's measuring card, line for line ── */
export function ReadingCard({ L }: { L: LawnState }) {
  return (
    <section className="lw-card lw-reading" data-lawn-reading-card>
      <div className="lw-ms-body">
        <div className="lw-ms-num">{L.readingAddress || "—"}</div>
        <div className="lw-ms-head">
          <div className="lw-ms-stage" role="status" aria-live="polite">
            {READ_STEPS[L.readStep]}…
          </div>
          <div className="lw-ms-pct">{L.readPct}%</div>
        </div>
        <div className="lw-ms-track" role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={L.readPct}>
          <span className="lw-ms-fill" style={{ width: `${L.readPct}%` }} />
        </div>
        <ol className="lw-ms-steps" aria-label="Reading steps">
          {READ_STEPS.map((label, i) => (
            <li key={label} className={cx("lw-ms-step", i < L.readStep && "is-done", i === L.readStep && "is-active")}>
              <WorkSquare state={i < L.readStep ? "done" : i === L.readStep ? "now" : "wait"} />
              <span>{label}</span>
              <span className="lw-ms-step-state">{i < L.readStep ? "done" : i === L.readStep ? "in progress" : ""}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── The address search ── */
export function SearchForm({ L, big }: { L: LawnState; big?: boolean }) {
  const id = React.useId();
  return (
    <form
      className={cx("lw-search", big && "lw-search--big")}
      onSubmit={(e) => {
        e.preventDefault();
        if (L.address.trim()) void L.read({ address: L.address.trim() });
      }}
    >
      <label className="lw-label" htmlFor={id}>
        Client&apos;s address
      </label>
      <div className="lw-search-row">
        <input
          id={id}
          className="lw-input lw-search-in"
          value={L.address}
          onChange={(e) => L.setAddress(e.target.value)}
          placeholder="1234 Maple Ave, Naperville, IL 60540"
          autoComplete="street-address"
          enterKeyHint="go"
          data-lawn-address
        />
        <button type="submit" className="lw-btn lw-btn--primary lw-search-go" disabled={!L.address.trim()} data-lawn-measure>
          <Ruler aria-hidden="true" />
          Measure yard
        </button>
      </div>
      <ul className="lw-sources" aria-label="What gets read">
        <li>
          <b>Lot line</b> county records
        </li>
        <li>
          <b>Lawn, beds, trees</b> USDA aerial photo
        </li>
        <li>
          <b>Slope</b> USGS lidar
        </li>
      </ul>
    </form>
  );
}

/* ── Saved estimates ── */
export function SavedList({ L }: { L: LawnState }) {
  return (
    <section className="lw-card lw-saved" aria-labelledby="lw-saved-h">
      <header className="lw-card-head">
        <h2 className="lw-card-title" id="lw-saved-h">
          Saved estimates
        </h2>
        {L.drafts.length ? <span className="lw-count">{L.drafts.length}</span> : null}
      </header>
      {L.drafts.length ? (
        <ul className="lw-saved-list">
          {L.drafts.map((d) => (
            <li key={d.id} className="lw-saved-row">
              <button type="button" className="lw-saved-open" onClick={() => L.openDraft(d.id)} data-lawn-draft={d.id}>
                <span className="lw-saved-name">{d.title || d.address || "Untitled yard"}</span>
                <span className="lw-saved-meta">
                  {d.lawnSqft ? `${sqft(d.lawnSqft)} lawn · ` : ""}
                  {new Date(d.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </button>
              <button
                type="button"
                className="lw-icon-btn lw-icon-btn--danger"
                aria-label={`Delete ${d.title}`}
                title="Delete"
                onClick={async () => {
                  if (!window.confirm(`Delete the estimate for ${d.title}?`)) return;
                  await L.removeDraft(d.id);
                }}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="lw-empty">{L.draftsLoaded ? "No saved estimates yet. Measure a yard and save it — it lands here." : "Loading…"}</p>
      )}
    </section>
  );
}

/* ── The map's tools ── */
export function MapTools({ L, compact }: { L: LawnState; compact?: boolean }) {
  const site = L.site!;
  const m = L.measures!;
  const fix = (
    <div className="lw-tgroup" role="group" aria-label="Fix the map">
      <span className="lw-tlabel">Fix</span>
      <button type="button" className={cx("lw-tool", L.tapping && "is-on")} onClick={L.toggleTapping} aria-pressed={L.tapping} title="Tap a dimmed piece to count it in, or a lawn, bed or paving piece to leave it out" data-lawn-tap>
        <MousePointerClick aria-hidden="true" />
        Count in / leave out
      </button>
      <button type="button" className="lw-tool" onClick={L.undo} disabled={!L.past.length} data-lawn-undo>
        <Undo2 aria-hidden="true" />
        Undo
      </button>
      <button
        type="button"
        className="lw-tool"
        onClick={() => {
          if (!window.confirm("Put the yard back the way the photo read it?")) return;
          L.resetToRead();
        }}
      >
        <RotateCcw aria-hidden="true" />
        As read
      </button>
    </div>
  );
  const show = (
    <div className="lw-tgroup" role="group" aria-label="Show">
      <span className="lw-tlabel">Show</span>
      <div className="lw-seg" role="group" aria-label="View">
        {(["both", "photo", "classes"] as const).map((v) => (
          <button key={v} type="button" className={cx("lw-seg-b", L.view === v && "is-on")} aria-pressed={L.view === v} onClick={() => L.setView(v)}>
            {v === "both" ? "Both" : v === "photo" ? "Photo" : "Map"}
          </button>
        ))}
      </div>
      {m.yardSqft && m.yardSqft < m.lotSqft * 0.45 ? (
        <div className="lw-seg" role="group" aria-label="Zoom">
          <button type="button" className={cx("lw-seg-b", L.zoom === "yard" && "is-on")} aria-pressed={L.zoom === "yard"} onClick={() => L.setZoom("yard")} data-lawn-zoom="yard">
            The yard
          </button>
          <button type="button" className={cx("lw-seg-b", L.zoom === "lot" && "is-on")} aria-pressed={L.zoom === "lot"} onClick={() => L.setZoom("lot")} data-lawn-zoom="lot">
            Whole lot
          </button>
        </div>
      ) : null}
      <button type="button" className={cx("lw-tool", L.drawingLot && "is-on")} onClick={() => L.setDrawingLot((d) => (d ? null : []))} aria-pressed={!!L.drawingLot} data-lawn-lot-draw>
        <PenLine aria-hidden="true" />
        {L.drawingLot ? "Cancel lot line" : "Redraw lot line"}
      </button>
    </div>
  );
  return (
    <div className="lw-tools">
      <div className="lw-tgroup lw-tgroup--paint" role="group" aria-label="Paint">
        <span className="lw-tlabel">Paint</span>
        <div className="lw-paints">
          {PAINTS.map((p) => {
            const on = L.paint === p.cls && !L.tapping;
            return (
              <button key={p.cls} type="button" className={cx("lw-tool", on && "is-on")} onClick={() => L.pickPaint(p.cls)} aria-pressed={on} data-lawn-paint={p.label.toLowerCase()}>
                <span className="lw-swatch" style={{ background: `rgb(${CLASS_COLOR[p.cls].join(",")})` }} aria-hidden="true" />
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="lw-seg" role="group" aria-label="Brush size">
          {[2, 4, 8].map((b) => (
            <button key={b} type="button" className={cx("lw-seg-b", L.brushFt === b && "is-on")} aria-pressed={L.brushFt === b} onClick={() => L.setBrushFt(b)}>
              {b === 2 ? "Fine" : b === 4 ? "Brush" : "Wide"}
            </button>
          ))}
        </div>
      </div>
      {compact ? (
        <details className="lw-more">
          <summary className="lw-more-sum">
            More map tools <ChevronDown aria-hidden="true" />
          </summary>
          <div className="lw-more-body">
            {fix}
            {show}
          </div>
        </details>
      ) : (
        <>
          {fix}
          {show}
        </>
      )}
      {site.yard?.reachFt != null ? (
        <div className="lw-tgroup lw-reach" role="group" aria-label="Lawn counted within" data-lawn-reach>
          <span className="lw-tlabel">Lawn within</span>
          <div className="lw-seg" role="group" aria-label="Yard reach">
            {REACHES_FT.map((r) => (
              <button key={r} type="button" className={cx("lw-seg-b", site.yard?.reachFt === r && "is-on")} aria-pressed={site.yard?.reachFt === r} onClick={() => L.setReach(r)} data-lawn-reach-ft={r}>
                {r} ft
              </button>
            ))}
          </div>
          <span className="lw-tnote">of the buildings — grass past it is left as field</span>
        </div>
      ) : null}
    </div>
  );
}

/* ── The map, its notes and its key ── */
export function MapPanel({ L, compact }: { L: LawnState; compact?: boolean }) {
  const site = L.site!;
  const m = L.measures!;
  const lotInfo = L.lotInfo!;
  const g = site.grid;
  const fpp = ftPerPx({ ...g });
  const photoUrl = site.photo ? `/api/lawn/photo?item=${encodeURIComponent(site.photo.itemId)}&box=${g.box.map((v) => v.toFixed(2)).join(",")}&w=${g.w}&h=${g.h}&kind=rgb` : "";
  return (
    <section className="lw-card lw-mapcard" aria-label="The yard">
      <MapTools L={L} compact={compact} />
      {L.tapping ? (
        <p className="lw-hint" data-lawn-tap-note>
          {L.tapNote ?? "Tap a dimmed piece (field, brush) to count it in, or a lawn, bed or paving piece to leave it out."}
        </p>
      ) : null}
      {L.drawingLot ? (
        <p className="lw-hint">
          Click the lot&apos;s corners in order ({L.drawingLot.length} so far).{" "}
          {L.drawingLot.length >= 3 ? (
            <button type="button" className="lw-link" onClick={() => void L.read({ lat: site.lat, lng: site.lng, address: site.address, ring: L.drawingLot!.map((p) => fromPx({ ...g }, p)) })} data-lawn-lot-use>
              Use this lot line and measure again
            </button>
          ) : null}
        </p>
      ) : null}
      <YardMap
        w={g.w}
        h={g.h}
        gsdM={g.gsdM}
        photoUrl={photoUrl}
        labels={L.labels!}
        lot={lotInfo.mask}
        lotRing={lotInfo.ring}
        paint={L.drawingLot || L.tapping ? null : L.paint}
        brushPx={L.brushFt / fpp}
        view={L.view}
        zoom={L.drawingLot ? "lot" : L.zoom}
        frameKey={`${site.readAt}|${site.yard?.reachFt ?? ""}`}
        onStroke={L.stroke}
        onTap={L.tapping && !L.drawingLot ? L.tapPiece : null}
        drawing={L.drawingLot ? { points: L.drawingLot, onAdd: (p) => L.setDrawingLot((d) => [...(d ?? []), p]) } : null}
      />
      <ul className="lw-legend" aria-label="Map key" data-lawn-legend>
        <li>
          <i className="lw-key lw-key--yard" />
          Maintained yard{m.yardSqft ? ` · ${area(m.yardSqft)}` : ""}
        </li>
        <li>
          <i className="lw-key lw-key--lawn" />
          Lawn
        </li>
        <li>
          <i className="lw-key lw-key--bed" />
          Beds
        </li>
        <li>
          <i className="lw-key lw-key--pool" />
          Pool
        </li>
        <li>
          <i className="lw-key lw-key--out" />
          Not serviced{m.naturalSqft ? ` · ${area(m.naturalSqft)} left natural` : ""}
        </li>
      </ul>
      {(m.naturalSqft ?? 0) >= 5000 ? (
        <p className="lw-note" data-lawn-natural-note>
          Woods, field and brush past the yard aren&apos;t counted. If the crew keeps some of it, choose <b>Count in / leave out</b> and tap the dimmed ground.
        </p>
      ) : null}
    </section>
  );
}

/* ── What was measured ── */
export function Measured({ L }: { L: LawnState }) {
  const m = L.measures!;
  const conf = m.confidence;
  const tone = conf.level === "green" ? "good" : conf.level === "amber" ? "warn" : "bad";
  return (
    <section className="lw-card lw-measured" aria-labelledby="lw-meas-h" data-lawn-numbers>
      <div className="lw-meas-top">
        <div className="lw-meas-lead">
          <h2 className="lw-cap" id="lw-meas-h">
            Lawn to service
          </h2>
          <div className="lw-meas-big">
            {Math.round(m.lawnSqft).toLocaleString("en-US")}
            <span className="lw-unit">sq ft</span>
          </div>
        </div>
        <span className={cx("lw-stamp", `lw-stamp--${tone}`)} data-lawn-confidence={conf.level}>
          {conf.level === "green" ? "Measured well" : conf.level === "amber" ? "Check the edges" : "Check it on site"}
        </span>
      </div>
      {conf.reasons.length ? <p className="lw-meas-why">{conf.reasons.slice(0, 3).map((r) => `${r}.`).join(" ")}</p> : null}
      <dl className="lw-cells lw-cells--3">
        <Cell l="Front lawn" v={sqft(m.lawnByZone.front)} />
        <Cell l="Back lawn" v={sqft(m.lawnByZone.back)} />
        <Cell l="Side lawns" v={sqft(m.lawnByZone.side)} />
      </dl>
      <dl className="lw-cells lw-cells--4">
        <Cell l="Beds (mulch, rock)" v={sqft(m.bedSqft)} />
        <Cell l="Trees in the lawn" v={`${m.treesInLawn}`} />
        <Cell l="Hard edging" v={`${m.edges.hardFt} ft`} />
        <Cell l="String-trim lines" v={`${m.edges.houseFt + m.edges.treeFt + m.edges.lotLineFt} ft`} />
      </dl>
    </section>
  );
}

function Cell({ l, v }: { l: string; v: string }) {
  return (
    <div className="lw-cell">
      <dt>{l}</dt>
      <dd>{v}</dd>
    </div>
  );
}

/* ── The site's facts ── */
export function SiteFacts({ L }: { L: LawnState }) {
  const site = L.site!;
  const m = L.measures!;
  const q = L.quote!;
  const months = monthsOf(q.climate);
  return (
    <section className="lw-card" aria-labelledby="lw-site-h">
      <header className="lw-card-head">
        <h2 className="lw-card-title" id="lw-site-h">
          The site
        </h2>
      </header>
      <dl className="lw-facts">
        <dt>Slope</dt>
        <dd>{m.slope.source === "lidar" ? `${Math.round(m.slope.flat * 100)}% flat, ${Math.round(m.slope.moderate * 100)}% rolling (10–20%), ${Math.round(m.slope.steep * 100)}% steep${m.slope.tooSteep > 0.02 ? " — some too steep to ride a mower on" : ""}` : "No lidar here — taken as flat"}</dd>
        <dt>Under trees</dt>
        <dd>
          {m.yardCanopySqft != null ? `${sqft(m.yardCanopySqft)} of crowns over and beside the yard (${area(m.treeCanopySqft)} on the lot)` : `${sqft(m.treeCanopySqft)} of crowns`}
          {m.canopyOverLawnSqft ? `, ${sqft(m.canopyOverLawnSqft)} of them over the lawn (mowed too, not seen from the air)` : ""}
        </dd>
        <dt>Also</dt>
        <dd>
          {sqft(m.hardSqft)} paved · house {sqft(m.houseSqft)}
          {m.poolSqft ? ` · pool ${sqft(m.poolSqft)}` : ""} · {m.edges.bedFt} ft of bed edge
        </dd>
        <dt>Grass</dt>
        <dd>
          {q.climate.grasses} ({q.climate.zone === "cool" ? "cool-season" : q.climate.zone === "warm" ? "warm-season" : "transition zone"}) · mowing {MONTH[months[0] - 1]}–{MONTH[months[months.length - 1] - 1]}
        </dd>
        <dt>Sources</dt>
        <dd className="lw-facts-quiet">
          {site.sources.parcel ? "lot line from the county" : "lot assumed — redraw it"} · {site.sources.footprintSource === "county" ? "house from the county" : site.sources.footprintSource === "usa-structures" ? "house from FEMA's USA Structures" : "house read from the photo"} · {site.sources.canopyMap ? "tree heights mapped" : "no tree heights"} · {site.sources.lidar ? "USGS lidar" : "no lidar"}
        </dd>
      </dl>
    </section>
  );
}

const KIND_WORD: Record<RuleKind, string> = { fertilizer: "Fertilizer", pesticide: "Weed control", license: "Licence", water: "Water", equipment: "Equipment" };

/* ── The rules at this address ── */
export function RulesCard({ L }: { L: LawnState }) {
  const site = L.site!;
  if (!L.rules?.rules.length) return null;
  return (
    <section className="lw-card" aria-labelledby="lw-rules-h" data-lawn-rules>
      <header className="lw-card-head lw-card-head--stack">
        <h2 className="lw-card-title" id="lw-rules-h">
          Rules at this address
        </h2>
        <p className="lw-card-sub">
          {site.state}
          {site.county ? `, ${site.county}` : ""} — the calendar already keeps out of fertilizer blackouts. Summaries to plan by; the state and county have the last word.
        </p>
      </header>
      <ul className="lw-rules">
        {L.rules.rules.map((r) => (
          <li key={r.title + r.detail} className="lw-rule">
            <div className="lw-rule-t">
              <span className="lw-rule-k">{KIND_WORD[r.kind]}</span>
              {r.title}
            </div>
            <p className="lw-rule-d">{r.detail}</p>
            <p className="lw-rule-s">{r.source}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const SHORT: Partial<Record<string, string>> = { mow: "Mow", fert: "Feed", aerate: "Aerate", overseed: "Seed", dethatch: "Dethatch", springCleanup: "Spring clean", fallCleanup: "Leaves", mulch: "Mulch", bedWeeding: "Beds", shrubs: "Shrubs", hedges: "Hedges", irrigationStart: "Sprinklers on", irrigationBlowout: "Blowout", gutters: "Gutters" };

/* ── The year at a glance: each month, what happens in it ── */
export function SeasonStrip({ visits }: { visits: PlanVisit[] }) {
  if (!visits.length) return null;
  const byMonth = new Map<string, PlanVisit[]>();
  for (const v of visits) {
    const k = v.date.slice(0, 7);
    byMonth.set(k, [...(byMonth.get(k) ?? []), v]);
  }
  const first = new Date(`${visits[0].date}T00:00:00Z`);
  const keys = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1)).toISOString().slice(0, 7));
  return (
    <section className="lw-card" aria-labelledby="lw-season-h" data-lawn-season-strip>
      <header className="lw-card-head lw-card-head--stack">
        <h2 className="lw-card-title" id="lw-season-h">
          The season
        </h2>
        <p className="lw-card-sub">Every visit dated from today, for the grass and the climate here. The plan books these.</p>
      </header>
      <ol className="lw-months">
        {keys.map((k) => {
          const list = byMonth.get(k) ?? [];
          const mows = list.filter((v) => v.service === "mow").length;
          const rest = list.filter((v) => v.service !== "mow");
          const [y, mo] = k.split("-").map(Number);
          return (
            <li key={k} className={cx("lw-month", !list.length && "is-quiet")}>
              <div className="lw-month-l">
                {MONTH[mo - 1]} {String(y).slice(2)}
              </div>
              <div className="lw-month-mow">{mows ? `Mow ×${mows}` : list.length ? "" : "—"}</div>
              {rest.map((v) => (
                <div key={v.date + v.service} className="lw-month-v">
                  {SHORT[v.service] ?? v.label} {Number(v.date.slice(8))}
                </div>
              ))}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ── The season's price and the proposal ── */
export function QuoteCard({ L, noAction }: { L: LawnState; noAction?: boolean }) {
  const site = L.site!;
  const q = L.quote!;
  const mowLine = q.services.find((x) => x.id === "mow");
  return (
    <section className="lw-card lw-quote" aria-labelledby="lw-quote-h" data-lawn-totals>
      <div className="lw-quote-top">
        <h2 className="lw-cap" id="lw-quote-h">
          The season
        </h2>
        <div className="lw-quote-big" data-lawn-season>
          {usd(L.season)}
        </div>
        <div className="lw-quote-month">
          <b data-lawn-monthly>{usd(L.season / 12)}</b> a month on a plan (×12)
        </div>
      </div>
      <dl className="lw-quote-rows">
        <dt>{mowLine && L.chosen.has("mow") ? `Each ${L.options.frequency === "weekly" ? "weekly" : "biweekly"} visit` : "Services picked"}</dt>
        <dd>{mowLine && L.chosen.has("mow") ? usd(mowLine.unitPrice) : L.lines.length}</dd>
        <dt>Visits on the calendar</dt>
        <dd>{L.totals?.visits ?? 0}</dd>
        <dt>Sales tax ({site.state ?? "state unknown"})</dt>
        <dd>{L.tax ? "on the taxed lines" : "none"}</dd>
      </dl>
      <p className="lw-note">{taxWords(site.state)}</p>
      <ClientPicker client={L.client} onPick={L.setClient} />
      {noAction ? null : <ProposalAction L={L} />}
    </section>
  );
}

export function ProposalAction({ L }: { L: LawnState }) {
  if (L.made)
    return (
      <p className="lw-done" data-lawn-made>
        <Check aria-hidden="true" />
        Proposal created.{" "}
        <a className="lw-link" href={`/dashboard/proposals/${L.made}`}>
          Open it
        </a>
      </p>
    );
  return (
    <button type="button" className="lw-btn lw-btn--primary lw-btn--wide" disabled={!L.lines.length || !!L.busy} onClick={() => void L.createProposal()} data-lawn-proposal>
      {L.busy === "proposal" ? "Creating…" : "Create proposal"}
    </button>
  );
}

/* ── The services ── */
export function ServicesCard({ L }: { L: LawnState }) {
  const q = L.quote!;
  const o = L.options;
  const set = L.setOptions;
  return (
    <section className="lw-card lw-services" aria-labelledby="lw-svc-h" data-lawn-services>
      <header className="lw-card-head lw-card-head--stack">
        <h2 className="lw-card-title" id="lw-svc-h">
          Services
        </h2>
        <p className="lw-card-sub">
          {MOWERS.find((x) => x.id === q.mower)?.name}, {q.difficulty.level} lawn{q.difficulty.why.length ? ` (${q.difficulty.why.join(", ")})` : ""} · {usd(q.rate)} a person-hour{L.ownRate ? "" : " (the market's — set yours)"}
        </p>
      </header>
      <div className="lw-freq">
        <div className="lw-seg lw-seg--fill" role="group" aria-label="Mowing">
          <button type="button" className={cx("lw-seg-b", o.frequency === "weekly" && "is-on")} aria-pressed={o.frequency === "weekly"} onClick={() => set({ ...o, frequency: "weekly" })} data-lawn-weekly>
            Weekly
          </button>
          <button type="button" className={cx("lw-seg-b", o.frequency === "biweekly" && "is-on")} aria-pressed={o.frequency === "biweekly"} onClick={() => set({ ...o, frequency: "biweekly" })} data-lawn-biweekly>
            Every 2 weeks
          </button>
        </div>
        <span className="lw-freq-n">{q.visits} cuts a season</span>
      </div>
      <ul className="lw-svcs">
        {q.services.map((x) => {
          const off = x.market ? x.unitPrice < x.market.low * 0.85 || x.unitPrice > x.market.high * 1.15 : false;
          const on = L.chosen.has(x.id);
          return (
            <li key={x.id}>
              <label className={cx("lw-svc", on && "is-on")} data-lawn-service={x.id}>
                <input type="checkbox" className="lw-check" checked={on} onChange={() => L.toggle(x.id)} />
                <span className="lw-box" aria-hidden="true">
                  <Check />
                </span>
                <span className="lw-svc-name">{x.name}</span>
                <span className="lw-svc-price">
                  {usd(x.unitPrice)}
                  <span className="lw-svc-unit">
                    {x.unit === "visit" ? "a visit" : x.unit === "application" ? "a round" : x.unit === "cu yd" ? "a cu yd" : x.unit === "push" ? "a snowfall" : "the job"}
                    {x.qty !== 1 ? ` × ${x.qty}` : ""}
                  </span>
                </span>
                <span className="lw-svc-desc">
                  {x.desc}
                  {x.market ? <span className={cx("lw-market", off && "is-off")}>Market {usd(x.market.low)}–{usd(x.market.high)} · {x.market.basis}</span> : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <details className="lw-disclose">
        <summary className="lw-disclose-sum">
          What the photo can&apos;t see <ChevronDown aria-hidden="true" />
        </summary>
        <div className="lw-fields">
          <NumField label="Fertilizer rounds a year" value={o.fertRounds} onChange={(v) => set({ ...o, fertRounds: v })} max={10} />
          <SelectField label="Mulch depth" value={String(o.mulchDepthIn)} onChange={(v) => set({ ...o, mulchDepthIn: v === "3" ? 3 : 2 })} options={[["2", "2 inches (a refresh)"], ["3", "3 inches (new beds)"]]} />
          <NumField label="Small shrubs" value={o.shrubs.small} onChange={(v) => set({ ...o, shrubs: { ...o.shrubs, small: v } })} max={500} />
          <NumField label="Medium shrubs" value={o.shrubs.medium} onChange={(v) => set({ ...o, shrubs: { ...o.shrubs, medium: v } })} max={500} />
          <NumField label="Large shrubs" value={o.shrubs.large} onChange={(v) => set({ ...o, shrubs: { ...o.shrubs, large: v } })} max={500} />
          <NumField label="Hedge face, sq ft" value={o.hedgeFaceSqft} onChange={(v) => set({ ...o, hedgeFaceSqft: v })} max={100000} />
          <NumField label="Sprinkler zones" value={o.irrigationZones} onChange={(v) => set({ ...o, irrigationZones: v })} max={60} />
          <NumField label="House stories" value={o.stories} onChange={(v) => set({ ...o, stories: Math.max(1, v) })} max={4} />
          <NumField label="Snowfalls to clear" value={o.snowPushes} onChange={(v) => set({ ...o, snowPushes: v })} max={60} />
        </div>
      </details>
    </section>
  );
}

/* ── Keep them on a plan ── */
export function PlanCard({ L }: { L: LawnState }) {
  return (
    <section className="lw-card" aria-labelledby="lw-plan-h" data-lawn-plan>
      <header className="lw-card-head lw-card-head--stack">
        <h2 className="lw-card-title" id="lw-plan-h">
          Keep them on a plan
        </h2>
        <p className="lw-card-sub">
          {L.calendar.length} visits a year booked on your calendar as the season comes, {usd(L.season / 12)} a month — the plan bills, reminds before the big visits (not every mow) and renews by itself.
        </p>
      </header>
      <div className="lw-card-body">
        {L.plan ? (
          <p className="lw-done" data-lawn-plan-made>
            <Check aria-hidden="true" />
            Plan created{L.plan.sent ? (L.plan.emailed ? " and emailed to the client to accept" : " — no email on file, share the accept link") : ""}.{" "}
            <a className="lw-link" href="/dashboard/service-plans">
              Service plans
            </a>
          </p>
        ) : (
          <>
            <label className="lw-tick">
              <input type="checkbox" className="lw-check" checked={L.sendPlanToo} onChange={(e) => L.setSendPlanToo(e.target.checked)} />
              <span className="lw-box" aria-hidden="true">
                <Check />
              </span>
              Email it to the client to accept
            </label>
            <button type="button" className="lw-btn lw-btn--wide" disabled={!L.client || !L.calendar.length || !!L.busy} onClick={() => void L.putOnPlan()} title={L.client ? "" : "Pick the client first"} data-lawn-plan-go>
              {L.busy === "plan" ? "Creating the plan…" : L.client ? "Put them on the plan" : "Pick the client to start a plan"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/* ── Fields ── */
function NumField({ label, value, onChange, max }: { label: string; value: number; onChange: (v: number) => void; max: number }) {
  const id = React.useId();
  return (
    <div className="lw-field">
      <label className="lw-label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="lw-input" inputMode="numeric" value={String(value)} onChange={(e) => onChange(Math.max(0, Math.min(max, Math.round(Number(e.target.value.replace(/[^0-9.]/g, "")) || 0))))} />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  const id = React.useId();
  return (
    <div className="lw-field">
      <label className="lw-label" htmlFor={id}>
        {label}
      </label>
      <div className="lw-select">
        <select id={id} className="lw-input" value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" />
      </div>
    </div>
  );
}

export function ClientPicker({ client, onPick }: { client: LawnClient | null; onPick: (c: LawnClient | null) => void }) {
  const [q, setQ] = React.useState("");
  const [found, setFound] = React.useState<LawnClient[]>([]);
  const id = React.useId();
  React.useEffect(() => {
    if (!q.trim()) return;
    let live = true;
    const t = setTimeout(() => findLawnClients(q).then((r) => live && r.ok && setFound(r.clients)), 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  if (client)
    return (
      <div className="lw-client-on">
        <span className="lw-label">Client</span>
        <div className="lw-client-row">
          <strong>{client.name}</strong>
          <button type="button" className="lw-icon-btn" aria-label="Change client" title="Change client" onClick={() => onPick(null)}>
            <X aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  return (
    <div className="lw-field">
      <label className="lw-label" htmlFor={id}>
        Client <span className="lw-opt">optional</span>
      </label>
      <input id={id} className="lw-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a client" autoComplete="off" data-lawn-client />
      {q.trim() && found.length ? (
        <ul className="lw-found">
          {found.map((c) => (
            <li key={c.id}>
              <button type="button" className="lw-found-b" onClick={() => onPick(c)}>
                <span className="lw-found-name">{c.name}</span>
                <span className="lw-found-meta">{c.address ?? c.email ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ── Your rates ── */
export function RatesCard({ settings, own, onSaved, onClose }: { settings: LawnSettings; own: boolean; onSaved: (s: LawnSettings) => void; onClose?: () => void }) {
  const [d, setD] = React.useState<LawnSettings>(settings);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const n = (k: keyof LawnSettings, label: string, unit = "") => (
    <NumText key={k} label={`${label}${unit ? ` (${unit})` : ""}`} value={String(d[k] as number)} onChange={(v) => setD({ ...d, [k]: Number(v.replace(/[^0-9.]/g, "")) || 0 })} />
  );
  return (
    <section className="lw-card lw-rates" aria-labelledby="lw-rates-h" data-lawn-rates>
      <header className="lw-card-head">
        <div>
          <h2 className="lw-card-title" id="lw-rates-h">
            Your rates
          </h2>
          <p className="lw-card-sub">{own ? "Your own rates — every price follows them." : "Not set yet: prices follow the market's middle, scaled to the city. Set yours and every price follows them."}</p>
        </div>
        {onClose ? (
          <button type="button" className="lw-icon-btn" aria-label="Close your rates" title="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        ) : null}
      </header>
      <div className="lw-card-body">
        <div className="lw-fields">
          {n("ratePerPersonHour", "Rate a person-hour", "$")}
          {n("crewSize", "Crew size")}
          {n("minimumStop", "Minimum a stop", "$")}
          {n("stopMinutes", "Drive & unload a stop", "min")}
          {n("mulchCostPerYd", "Mulch cost", "$ / cu yd")}
          {n("deliveryFee", "Mulch delivery", "$")}
          {n("fertCostPer1000", "Fertilizer cost", "$ / 1,000 sq ft")}
          {n("seedCostPer1000", "Seed cost", "$ / 1,000 sq ft")}
          {n("materialMarkupPct", "Markup on materials", "%")}
          {n("haulFee", "Debris haul", "$")}
          {n("equipmentFee", "Aerator / dethatcher", "$ a job")}
        </div>
        <fieldset className="lw-mowers">
          <legend className="lw-label">Mowers on the trailer</legend>
          <div className="lw-mowers-row">
            {MOWERS.map((m) => (
              <label key={m.id} className="lw-tick">
                <input type="checkbox" className="lw-check" checked={d.mowers.includes(m.id)} onChange={(e) => setD({ ...d, mowers: e.target.checked ? [...d.mowers, m.id as Mower] : d.mowers.filter((x) => x !== m.id) })} />
                <span className="lw-box" aria-hidden="true">
                  <Check />
                </span>
                {m.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="lw-rates-foot">
          <button
            type="button"
            className="lw-btn lw-btn--primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              const r = await saveLawnSettings(d);
              setSaving(false);
              if (r.ok) {
                onSaved(r.settings);
                setMsg("Saved — every price follows them now.");
              } else setMsg(r.error);
            }}
            data-lawn-rates-save
          >
            {saving ? "Saving…" : "Save my rates"}
          </button>
          {msg ? (
            <span className="lw-note" role="status">
              {msg}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function NumText({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = React.useId();
  return (
    <div className="lw-field">
      <label className="lw-label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="lw-input" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** The error line, in words, where the work happens. */
export function ErrorNote({ L }: { L: LawnState }) {
  if (!L.error) return null;
  return (
    <p className="lw-alert" role="alert">
      {L.error}
    </p>
  );
}

/** The save line: Saving… / Saved 3:42 PM / Not saved yet. */
export function savedWords(L: LawnState) {
  return L.busy === "save" ? "Saving…" : L.savedAt ? `Saved ${new Date(L.savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Not saved yet";
}
