"use client";
// THE LAWN & LANDSCAPE ESTIMATOR (2026-10-18 — owner: "the landscaper uses the client's address and sees how much grass
// to service, and bark … calculates the square footage so they can estimate … and keep them on a service plan. Make it
// super smart."). Type the address: the lot comes from the county, the yard from the USDA aerial photo, the slope from
// USGS lidar — lawn front, back and sides, beds, trees, edges — every number correctable with a brush. Then every
// service priced by the crew's time at the company's rate, beside what the market charges, and a proposal for the
// season. Admin preview.
import * as React from "react";
import s from "./lawn.module.css";
import { YardMap, CLASS_COLOR } from "./yard-map";
import { CLS } from "@/lib/lawn/classify";
import { decodeLabels, encodeLabels, lotMaskOf, measureSite, type LawnSite } from "@/lib/lawn/site";
import { fromPx, ftPerPx, type Pt } from "@/lib/lawn/geo";
import { DEFAULT_LAWN_SETTINGS, DEFAULT_OPTIONS, MOWERS, priceYard, type LawnSettings, type Mower, type PricedService, type ServiceId, type ServiceOptions } from "@/lib/lawn/pricing";
import { monthsOf } from "@/lib/lawn/season";
import { rulesAt, type RuleKind } from "@/lib/lawn/rules";
import { planTotals, seasonCalendar, type PlanVisit } from "@/lib/lawn/calendar";
import { lawnTaxed, taxWords } from "@/lib/lawn/tax";
import { convertLawnToProposal, createLawnPlan, deleteLawnDraft, findLawnClients, listLawnDrafts, loadLawnDraft, readLawnProperty, readLawnSettings, saveLawnDraft, saveLawnSettings, type LawnClient, type LawnDraftRow } from "@/actions/lawnEstimator";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 1000 ? 0 : 2 });
const sqft = (n: number) => `${Math.round(n).toLocaleString("en-US")} sq ft`;
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const PAINTS: Array<{ cls: number; label: string }> = [
  { cls: CLS.LAWN, label: "Lawn" },
  { cls: CLS.BED, label: "Bed" },
  { cls: CLS.TREE, label: "Tree" },
  { cls: CLS.HARD, label: "Paving" },
];

/** Ticked by default: the season's core, and what the yard plainly needs. */
function defaultPicked(sv: PricedService[]): Set<ServiceId> {
  const on = new Set<ServiceId>(["mow", "fert", "aerate", "springCleanup", "fallCleanup", "mulch", "irrigationStart", "irrigationBlowout", "shrubs", "hedges", "snow"]);
  return new Set(sv.filter((x) => on.has(x.id)).map((x) => x.id));
}

export function LawnEstimator({ initialDraftId }: { initialDraftId?: string | null }) {
  const [phase, setPhase] = React.useState<"start" | "reading" | "site">(initialDraftId ? "reading" : "start");
  const [address, setAddress] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [site, setSite] = React.useState<LawnSite | null>(null);
  const [labels, setLabels] = React.useState<Uint8Array | null>(null);
  const [past, setPast] = React.useState<Uint8Array[]>([]);
  const [settings, setSettings] = React.useState<LawnSettings>(DEFAULT_LAWN_SETTINGS);
  const [ownRate, setOwnRate] = React.useState(false);
  const [options, setOptions] = React.useState<ServiceOptions>(DEFAULT_OPTIONS);
  const [picked, setPicked] = React.useState<Set<ServiceId> | null>(null);
  const [paint, setPaint] = React.useState<number | null>(null);
  const [brushFt, setBrushFt] = React.useState(4);
  const [view, setView] = React.useState<"both" | "photo" | "classes">("both");
  const [drawingLot, setDrawingLot] = React.useState<Pt[] | null>(null);
  const [drafts, setDrafts] = React.useState<LawnDraftRow[]>([]);
  const [draftId, setDraftId] = React.useState<string | null>(initialDraftId ?? null);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [client, setClient] = React.useState<LawnClient | null>(null);
  const [made, setMade] = React.useState<string | null>(null);
  const [showRates, setShowRates] = React.useState(false);
  const [readStep, setReadStep] = React.useState(0);
  const [plan, setPlan] = React.useState<{ id: string; sent: boolean; emailed: boolean; href: string | null } | null>(null);
  const [sendPlanToo, setSendPlanToo] = React.useState(true);

  React.useEffect(() => {
    let live = true;
    readLawnSettings().then((r) => {
      if (live && r.ok) {
        setSettings(r.settings);
        setOwnRate(r.own);
      }
    });
    listLawnDrafts().then((r) => live && r.ok && setDrafts(r.drafts));
    if (initialDraftId)
      loadLawnDraft(initialDraftId).then((r) => {
        if (!live) return;
        if (!r.ok) {
          setError(r.error);
          setPhase("start");
          return;
        }
        const d = r.draft;
        setSite(d.site);
        setLabels(decodeLabels(d.site.labels, d.site.grid.w * d.site.grid.h));
        setOptions(d.options);
        setPicked(new Set(d.picked as ServiceId[]));
        setSavedAt(r.updatedAt);
        setPhase("site");
      });
    return () => {
      live = false;
    };
  }, [initialDraftId]);

  // The read takes a few seconds; say what it's doing while it does.
  React.useEffect(() => {
    if (phase !== "reading") return;
    const t = setInterval(() => setReadStep((n) => Math.min(n + 1, 4)), 1600);
    return () => clearInterval(t);
  }, [phase]);

  const read = async (input: { address?: string; lat?: number; lng?: number; ring?: Array<{ lat: number; lng: number }> }) => {
    setError(null);
    setReadStep(0);
    setPhase("reading");
    const r = await readLawnProperty(input);
    if (!r.ok) {
      setError(r.error);
      setPhase(site ? "site" : "start");
      return;
    }
    setSite(r.site);
    setLabels(decodeLabels(r.site.labels, r.site.grid.w * r.site.grid.h));
    setPast([]);
    setPicked(null);
    setMade(null);
    setDrawingLot(null);
    setOptions((o) => ({ ...o, stories: r.site.lot.stories && r.site.lot.stories > 0 ? Math.min(4, r.site.lot.stories) : o.stories }));
    setPhase("site");
  };

  const lotInfo = React.useMemo(() => (site ? lotMaskOf(site) : null), [site]);
  const measures = React.useMemo(() => (site && labels ? measureSite(site, labels) : null), [site, labels]);
  const quote = React.useMemo(() => (site && measures ? priceYard({ measures, settings, options, locationFactor: site.locationFactor, state: site.state, ownRate }) : null), [site, measures, settings, options, ownRate]);
  const chosen = React.useMemo(() => picked ?? (quote ? defaultPicked(quote.services) : new Set<ServiceId>()), [picked, quote]);
  const rules = React.useMemo(() => (site ? rulesAt(site.state, site.county ?? null, site.place) : null), [site]);
  // The season, date by date, from today: what the plan books and what the proposal counts.
  const calendar = React.useMemo<PlanVisit[]>(() => (quote && rules ? seasonCalendar({ start: new Date(), quote, picked: chosen, fertRounds: options.fertRounds, frequency: options.frequency, rules, crewSize: settings.crewSize }) : []), [quote, rules, chosen, options.fertRounds, options.frequency, settings.crewSize]);
  const lines = React.useMemo(() => {
    if (!quote) return [];
    const count = (id: ServiceId) => calendar.filter((v) => v.service === id).length;
    // Visits the calendar books are counted from it (mowing, bed weeding, fertilizer rounds the rules left in).
    return quote.services.filter((x) => chosen.has(x.id)).map((x) => (x.id === "mow" || x.id === "bedWeeding" || x.id === "fert" ? { ...x, qty: count(x.id) || x.qty } : x));
  }, [quote, chosen, calendar]);
  const season = lines.reduce((t, l) => t + l.unitPrice * l.qty, 0);
  const tax = site ? lines.reduce((t, l) => t + (lawnTaxed(site.state, l.taxClass) ? l.unitPrice * l.qty : 0), 0) : 0;
  const totals = quote ? planTotals(calendar, quote, chosen) : null;

  const stroke = (next: Uint8Array) => {
    if (labels) setPast((p) => [...p.slice(-30), labels]);
    setLabels(next);
  };
  const undo = () => {
    if (!past.length) return;
    setLabels(past[past.length - 1]);
    setPast(past.slice(0, -1));
  };
  const toggle = (id: ServiceId) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const draftOf = () => (site && labels ? { site: { ...site, labels: encodeLabels(labels) }, options, picked: [...chosen], clientId: client?.id ?? null, title: site.address } : null);
  const save = async () => {
    const d = draftOf();
    if (!d) return;
    setBusy("save");
    const r = await saveLawnDraft({ id: draftId, draft: d, lawnSqft: measures?.lawnSqft ?? null });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setDraftId(r.id);
    setSavedAt(r.updatedAt);
    if (typeof window !== "undefined") window.history.replaceState(null, "", `/dashboard/lawn-estimator?draft=${r.id}`);
  };
  const createProposal = async () => {
    if (!site || !measures || !quote || !lines.length) return;
    setBusy("proposal");
    setError(null);
    const months = monthsOf(quote.climate);
    const scope = [
      `Lawn and landscape care for ${site.address || "the property"}, ${MONTH[months[0] - 1]} through ${MONTH[months[months.length - 1] - 1]}.`,
      `Measured from the USDA aerial photo${site.photo ? ` of ${new Date(site.photo.date).toLocaleDateString("en-US", { month: "long", year: "numeric" })}` : ""}: ${sqft(measures.lawnSqft)} of lawn (front ${sqft(measures.lawnByZone.front)}, back ${sqft(measures.lawnByZone.back)}, sides ${sqft(measures.lawnByZone.side)}), ${sqft(measures.bedSqft)} of beds on a ${sqft(measures.lotSqft)} lot.`,
      ...lines.map((l) => `${l.name}: ${l.desc}.`),
      `The season comes to ${usd(season)}${tax ? " plus sales tax on the lines the state taxes" : ""} — ${usd(season / 12)} a month over 12 months on a service plan.`,
    ].join("\n");
    const r = await convertLawnToProposal({
      title: `Lawn care — ${site.address || site.place}`,
      clientId: client?.id ?? null,
      address: site.address || null,
      state: site.state,
      scope,
      lines: lines.map((l) => ({ key: l.id, name: l.name, description: l.desc, quantity: l.qty, unit: l.unit, unitPrice: l.unitPrice, labor: l.labor, taxClass: l.taxClass })),
      draftId,
      site: draftOf()?.site ?? null,
      measures,
    });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setMade(r.id);
  };

  const putOnPlan = async () => {
    if (!site || !quote || !client || !calendar.length) return;
    setBusy("plan");
    setError(null);
    const months = monthsOf(quote.climate);
    const benefits = lines.map((l) => `${l.name}${l.qty > 1 ? ` (${l.qty}${l.unit === "cu yd" ? " cu yd" : ""})` : ""}`);
    const r = await createLawnPlan({
      clientId: client.id,
      name: "Lawn care plan",
      description: `The season's lawn care for ${site.address || "your home"}, ${MONTH[months[0] - 1]}–${MONTH[months[months.length - 1] - 1]}: every visit on our calendar, billed in twelve equal months.`,
      address: site.address || null,
      monthly: Math.round((season / 12) * 100) / 100,
      visits: calendar,
      benefits,
      send: sendPlanToo,
    });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setPlan({ id: r.planId, sent: r.sent, emailed: r.emailed, href: r.acceptHref });
  };

  /* ── Start ── */
  if (phase === "start") {
    return (
      <div className={s.studio} data-lawn-start>
        <Head />
        {error ? <p className={`${s.note} ${s.noteWarn}`}>{error}</p> : null}
        <div className={s.startGrid}>
          <section className={s.card}>
            <div className={s.head}>
              <div>
                <div className={s.cardTitle}>Measure a yard</div>
                <p className={s.cardSub}>The client&apos;s address is enough: the lot from the county, the lawn, beds and trees from the USDA aerial photo, the slope from USGS lidar. Anywhere in the US.</p>
              </div>
            </div>
            <form
              className={s.body}
              onSubmit={(e) => {
                e.preventDefault();
                if (address.trim()) void read({ address: address.trim() });
              }}
            >
              <label className={s.field}>
                <span className={s.lbl}>The client&apos;s address</span>
                <input className={s.in} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="1234 Maple Ave, Naperville, IL 60540" autoComplete="street-address" data-lawn-address />
              </label>
              <div className={s.row}>
                <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={!address.trim()} data-lawn-measure>
                  Measure it
                </button>
                <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setShowRates((v) => !v)}>
                  Your rates
                </button>
              </div>
              {showRates ? <RatesCard settings={settings} own={ownRate} onSaved={(x) => { setSettings(x); setOwnRate(true); }} /> : null}
            </form>
          </section>
          <section className={s.card}>
            <div className={s.head}>
              <div>
                <div className={s.cardTitle}>Your lawn estimates</div>
                <p className={s.cardSub}>{drafts.length ? "Open one to keep going." : "Saved estimates show here."}</p>
              </div>
            </div>
            <div className={s.body}>
              {drafts.map((d) => (
                <div key={d.id} style={{ display: "flex", gap: 6 }}>
                  <button type="button" className={s.draft} onClick={() => (window.location.href = `/dashboard/lawn-estimator?draft=${d.id}`)} data-lawn-draft={d.id}>
                    <span className={s.draftName}>{d.title}</span>
                    <span className={s.mono}>{d.lawnSqft ? sqft(d.lawnSqft) : ""}</span>
                  </button>
                  <button
                    type="button"
                    className={`${s.btn} ${s.btnSm} ${s.btnDanger}`}
                    aria-label={`Delete ${d.title}`}
                    onClick={async () => {
                      if (!window.confirm(`Delete the estimate for ${d.title}?`)) return;
                      await deleteLawnDraft(d.id);
                      setDrafts((x) => x.filter((y) => y.id !== d.id));
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  }

  /* ── Reading ── */
  if (phase === "reading" || !site || !labels || !measures || !quote || !lotInfo) {
    const steps = ["Finding the address and the lot line", "Reading the USDA aerial photo", "Telling lawn from trees (tree heights)", "Measuring the slope (USGS lidar)", "Counting the lawn, beds and edges"];
    return (
      <div className={s.studio} data-lawn-reading>
        <Head />
        <section className={s.card}>
          <div className={s.progress}>
            <div className={s.cardTitle}>Reading the property…</div>
            <div className={s.bar}>
              <div className={s.barFill} style={{ width: `${((readStep + 1) / steps.length) * 100}%` }} />
            </div>
            {steps.map((t, i) => (
              <p key={t} className={`${s.note} ${i < readStep ? s.noteGood : ""}`}>
                {i < readStep ? "✓ " : i === readStep ? "… " : ""}
                {t}
              </p>
            ))}
          </div>
        </section>
      </div>
    );
  }

  /* ── The yard ── */
  const g = site.grid;
  const fpp = ftPerPx({ ...g });
  const conf = measures.confidence;
  const photoUrl = site.photo ? `/api/lawn/photo?item=${encodeURIComponent(site.photo.itemId)}&box=${g.box.map((v) => v.toFixed(2)).join(",")}&w=${g.w}&h=${g.h}&kind=rgb` : "";
  const mowLine = quote.services.find((x) => x.id === "mow");
  const months = monthsOf(quote.climate);
  return (
    <div className={s.studio} data-lawn-site>
      <Head
        title={site.address || site.place}
        sub={`${sqft(measures.lotSqft)} lot${site.lot.acreage ? ` (${site.lot.acreage.toFixed(2)} acre)` : ""} · ${site.place}${site.photo ? ` · aerial photo ${new Date(site.photo.date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}, ${Math.round(site.photo.gsdM * 100)} cm` : ""}`}
        right={
          <div className={s.row}>
            <span className={s.mono} data-lawn-saved>
              {busy === "save" ? "Saving…" : savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Not saved yet"}
            </span>
            <button type="button" className={`${s.btn} ${s.btnSm} ${s.btnPrimary}`} onClick={() => void save()} disabled={!!busy} data-lawn-save>
              Save
            </button>
            <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => (window.location.href = "/dashboard/lawn-estimator")}>
              New
            </button>
          </div>
        }
      />
      {error ? <p className={`${s.note} ${s.noteWarn}`}>{error}</p> : null}
      <div className={s.work}>
        <div className={s.stage}>
          <div className={s.toolbar}>
            <span className={s.lbl} style={{ marginRight: 4 }}>
              Paint
            </span>
            {PAINTS.map((p) => (
              <button key={p.cls} type="button" className={`${s.btn} ${s.btnSm} ${paint === p.cls ? s.btnOn : ""}`} onClick={() => setPaint((x) => (x === p.cls ? null : p.cls))} aria-pressed={paint === p.cls} data-lawn-paint={p.label.toLowerCase()}>
                <span className={s.swatch} style={{ background: `rgb(${CLASS_COLOR[p.cls].join(",")})` }} />
                {p.label}
              </button>
            ))}
            <div className={s.seg} role="group" aria-label="Brush size">
              {[2, 4, 8].map((b) => (
                <button key={b} type="button" className={`${s.segB} ${brushFt === b ? s.on : ""}`} onClick={() => setBrushFt(b)}>
                  {b === 2 ? "Fine" : b === 4 ? "Brush" : "Wide"}
                </button>
              ))}
            </div>
            <span className={s.toolSep} />
            <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={undo} disabled={!past.length} data-lawn-undo>
              Undo
            </button>
            <button
              type="button"
              className={`${s.btn} ${s.btnSm}`}
              onClick={() => {
                if (!window.confirm("Put the yard back the way the photo read it?")) return;
                setPast((p) => [...p, labels]);
                setLabels(decodeLabels(site.readLabels, g.w * g.h));
              }}
            >
              As read
            </button>
            <span className={s.toolSep} />
            <div className={s.seg} role="group" aria-label="View">
              {(["both", "photo", "classes"] as const).map((v) => (
                <button key={v} type="button" className={`${s.segB} ${view === v ? s.on : ""}`} onClick={() => setView(v)}>
                  {v === "both" ? "Both" : v === "photo" ? "Photo" : "Map"}
                </button>
              ))}
            </div>
            <button type="button" className={`${s.btn} ${s.btnSm} ${drawingLot ? s.btnOn : ""}`} onClick={() => setDrawingLot((d) => (d ? null : []))} data-lawn-lot-draw>
              {drawingLot ? "Cancel lot line" : "Redraw lot line"}
            </button>
          </div>
          {drawingLot ? (
            <p className={`${s.note} ${s.noteGood}`}>
              Click the lot&apos;s corners in order ({drawingLot.length} so far).{" "}
              {drawingLot.length >= 3 ? (
                <button type="button" className={s.link} onClick={() => void read({ lat: site.lat, lng: site.lng, address: site.address, ring: drawingLot.map((p) => fromPx({ ...g }, p)) })} data-lawn-lot-use>
                  Use this lot line and measure again
                </button>
              ) : null}
            </p>
          ) : null}
          <YardMap
            w={g.w}
            h={g.h}
            photoUrl={photoUrl}
            labels={labels}
            lot={lotInfo.mask}
            lotRing={lotInfo.ring}
            paint={drawingLot ? null : paint}
            brushPx={brushFt / fpp}
            view={view}
            onStroke={stroke}
            drawing={drawingLot ? { points: drawingLot, onAdd: (p) => setDrawingLot((d) => [...(d ?? []), p]) } : null}
          />
          <div className={s.row}>
            <span className={`${s.chip} ${conf.level === "green" ? s.chipGreen : conf.level === "amber" ? s.chipAmber : s.chipRed}`} data-lawn-confidence={conf.level}>
              {conf.level === "green" ? "Measured well" : conf.level === "amber" ? "Check the edges" : "Check it on site"}
            </span>
            {conf.reasons.slice(0, 3).map((r) => (
              <span key={r} className={s.note}>
                {r}.
              </span>
            ))}
          </div>
          <div className={s.numbers} data-lawn-numbers>
            <Num v={sqft(measures.lawnSqft)} l="Lawn" />
            <Num v={sqft(measures.lawnByZone.front)} l="Front lawn" />
            <Num v={sqft(measures.lawnByZone.back)} l="Back lawn" />
            <Num v={sqft(measures.lawnByZone.side)} l="Side lawns" />
            <Num v={sqft(measures.bedSqft)} l="Beds (mulch, rock)" />
            <Num v={`${measures.treesInLawn}`} l="Trees in the lawn" />
            <Num v={`${measures.edges.hardFt} ft`} l="Hard edging" />
            <Num v={`${measures.edges.houseFt + measures.edges.treeFt + measures.edges.lotLineFt} ft`} l="String-trim lines" />
          </div>
          <section className={s.card}>
            <div className={s.body}>
              <dl className={s.facts}>
                <dt>Slope</dt>
                <dd>{measures.slope.source === "lidar" ? `${Math.round(measures.slope.flat * 100)}% flat, ${Math.round(measures.slope.moderate * 100)}% rolling (10–20%), ${Math.round(measures.slope.steep * 100)}% steep${measures.slope.tooSteep > 0.02 ? " — some too steep to ride a mower on" : ""}` : "No lidar here — taken as flat"}</dd>
                <dt>Under trees</dt>
                <dd>{sqft(measures.treeCanopySqft)} of crowns{measures.canopyOverLawnSqft ? `, ${sqft(measures.canopyOverLawnSqft)} of them over the lawn (mowed too, not seen from the air)` : ""}</dd>
                <dt>Also</dt>
                <dd>
                  {sqft(measures.hardSqft)} paved · house {sqft(measures.houseSqft)}
                  {measures.poolSqft ? ` · pool ${sqft(measures.poolSqft)}` : ""} · {measures.edges.bedFt} ft of bed edge
                </dd>
                <dt>Grass</dt>
                <dd>
                  {quote.climate.grasses} ({quote.climate.zone === "cool" ? "cool-season" : quote.climate.zone === "warm" ? "warm-season" : "transition zone"}) · mowing {MONTH[months[0] - 1]}–{MONTH[months[months.length - 1] - 1]}
                </dd>
                <dt>Sources</dt>
                <dd>
                  {site.sources.parcel ? "lot line from the county" : "lot assumed — redraw it"} · {site.sources.footprintSource === "county" ? "house from the county" : site.sources.footprintSource === "usa-structures" ? "house from FEMA's USA Structures" : "house read from the photo"} · {site.sources.canopyMap ? "tree heights mapped" : "no tree heights"} · {site.sources.lidar ? "USGS lidar" : "no lidar"}
                </dd>
              </dl>
            </div>
          </section>
          <SeasonStrip visits={calendar} />
          {rules?.rules.length ? (
            <section className={s.card} data-lawn-rules>
              <div className={s.head}>
                <div>
                  <div className={s.cardTitle}>Rules at this address</div>
                  <p className={s.cardSub}>
                    {site.state}
                    {site.county ? `, ${site.county}` : ""} — the season&apos;s calendar already keeps out of the fertilizer blackouts. Summaries to plan by; the state and county have the last word.
                  </p>
                </div>
              </div>
              <div className={s.body}>
                {rules.rules.map((r) => (
                  <div key={r.title + r.detail} style={{ display: "grid", gap: 2 }}>
                    <div style={{ fontSize: 13, fontWeight: 800 }}>
                      <span className={s.mono} style={{ marginRight: 8 }}>
                        {KIND_WORD[r.kind]}
                      </span>
                      {r.title}
                    </div>
                    <div className={s.note}>{r.detail}</div>
                    <div className={s.market}>{r.source}</div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className={s.side}>
          <section className={s.card} data-lawn-services>
            <div className={s.head}>
              <div>
                <div className={s.cardTitle}>Services</div>
                <p className={s.cardSub}>
                  {MOWERS.find((x) => x.id === quote.mower)?.name}, {quote.difficulty.level} lawn{quote.difficulty.why.length ? ` (${quote.difficulty.why.join(", ")})` : ""} · {usd(quote.rate)} a person-hour{ownRate ? "" : " (the market's — set yours)"}
                </p>
              </div>
            </div>
            <div className={s.body}>
              <div className={s.row}>
                <div className={s.seg} role="group" aria-label="Mowing">
                  <button type="button" className={`${s.segB} ${options.frequency === "weekly" ? s.on : ""}`} onClick={() => setOptions({ ...options, frequency: "weekly" })} data-lawn-weekly>
                    Weekly
                  </button>
                  <button type="button" className={`${s.segB} ${options.frequency === "biweekly" ? s.on : ""}`} onClick={() => setOptions({ ...options, frequency: "biweekly" })} data-lawn-biweekly>
                    Every 2 weeks
                  </button>
                </div>
                <span className={s.mono}>{quote.visits} cuts a season</span>
              </div>
              <div>
                {quote.services.map((x) => {
                  const off = x.market ? x.unitPrice < x.market.low * 0.85 || x.unitPrice > x.market.high * 1.15 : false;
                  return (
                    <label key={x.id} className={s.svc} data-lawn-service={x.id}>
                      <input type="checkbox" checked={chosen.has(x.id)} onChange={() => toggle(x.id)} />
                      <span className={s.svcName}>{x.name}</span>
                      <span className={s.svcPrice}>
                        {usd(x.unitPrice)}
                        <span className={s.svcUnit}>
                          {x.unit === "visit" ? "a visit" : x.unit === "application" ? "a round" : x.unit === "cu yd" ? "a cu yd" : x.unit === "push" ? "a snowfall" : "the job"}
                          {x.qty !== 1 ? ` × ${x.qty}` : ""}
                        </span>
                      </span>
                      <span className={s.svcDesc}>
                        {x.desc}
                        {x.market ? (
                          <span className={`${s.market} ${off ? s.marketOff : ""}`} style={{ display: "block" }}>
                            Market {usd(x.market.low)}–{usd(x.market.high)} · {x.market.basis}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
              <details>
                <summary className={s.lbl} style={{ cursor: "pointer" }}>
                  What the photo can&apos;t see
                </summary>
                <div className={s.fields} style={{ marginTop: 10 }}>
                  <Num2 label="Fertilizer rounds a year" value={options.fertRounds} onChange={(v) => setOptions({ ...options, fertRounds: v })} max={10} />
                  <label className={s.field}>
                    <span className={s.lbl}>Mulch depth</span>
                    <select className={s.in} value={options.mulchDepthIn} onChange={(e) => setOptions({ ...options, mulchDepthIn: e.target.value === "3" ? 3 : 2 })}>
                      <option value={2}>2 inches (a refresh)</option>
                      <option value={3}>3 inches (new beds)</option>
                    </select>
                  </label>
                  <Num2 label="Small shrubs" value={options.shrubs.small} onChange={(v) => setOptions({ ...options, shrubs: { ...options.shrubs, small: v } })} max={500} />
                  <Num2 label="Medium shrubs" value={options.shrubs.medium} onChange={(v) => setOptions({ ...options, shrubs: { ...options.shrubs, medium: v } })} max={500} />
                  <Num2 label="Large shrubs" value={options.shrubs.large} onChange={(v) => setOptions({ ...options, shrubs: { ...options.shrubs, large: v } })} max={500} />
                  <Num2 label="Hedge face, sq ft" value={options.hedgeFaceSqft} onChange={(v) => setOptions({ ...options, hedgeFaceSqft: v })} max={100000} />
                  <Num2 label="Sprinkler zones" value={options.irrigationZones} onChange={(v) => setOptions({ ...options, irrigationZones: v })} max={60} />
                  <Num2 label="House stories" value={options.stories} onChange={(v) => setOptions({ ...options, stories: Math.max(1, v) })} max={4} />
                  <Num2 label="Snowfalls to clear" value={options.snowPushes} onChange={(v) => setOptions({ ...options, snowPushes: v })} max={60} />
                </div>
              </details>
              <dl className={s.totals} data-lawn-totals>
                <dt>{mowLine && chosen.has("mow") ? `Each ${options.frequency === "weekly" ? "weekly" : "biweekly"} visit` : "Services picked"}</dt>
                <dd>{mowLine && chosen.has("mow") ? usd(mowLine.unitPrice) : lines.length}</dd>
                <dt>Sales tax ({site.state ?? "state unknown"})</dt>
                <dd>{tax ? "on the taxed lines" : "none"}</dd>
                <dt>The season</dt>
                <dd className={s.totalBig} data-lawn-season>
                  {usd(season)}
                </dd>
                <dt>On a plan, a month (×12)</dt>
                <dd data-lawn-monthly>{usd(season / 12)}</dd>
                <dt>Visits on the calendar</dt>
                <dd>{totals?.visits ?? 0}</dd>
              </dl>
              <p className={s.note}>{taxWords(site.state)}</p>
              <ClientPicker client={client} onPick={setClient} />
              {made ? (
                <p className={`${s.note} ${s.noteGood}`} data-lawn-made>
                  Proposal created.{" "}
                  <a className={s.link} href={`/dashboard/proposals/${made}`}>
                    Open it
                  </a>
                </p>
              ) : (
                <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={!lines.length || !!busy} onClick={() => void createProposal()} data-lawn-proposal>
                  {busy === "proposal" ? "Creating…" : "Create the proposal"}
                </button>
              )}
              <div className={s.card} style={{ padding: 12, display: "grid", gap: 8 }} data-lawn-plan>
                <div className={s.cardTitle} style={{ fontSize: 12 }}>
                  Keep them on a plan
                </div>
                <p className={s.note}>
                  {calendar.length} visits a year booked on your calendar as the season comes, {usd(season / 12)} a month — the plan bills, reminds before the big visits (not every mow) and renews by itself.
                </p>
                {plan ? (
                  <p className={`${s.note} ${s.noteGood}`} data-lawn-plan-made>
                    Plan created{plan.sent ? (plan.emailed ? " and emailed to the client to accept" : " — no email on file, share the accept link") : ""}.{" "}
                    <a className={s.link} href="/dashboard/service-plans">
                      Service plans
                    </a>
                  </p>
                ) : (
                  <>
                    <label className={s.tool} style={{ fontSize: 12.5, fontWeight: 700 }}>
                      <input type="checkbox" checked={sendPlanToo} onChange={(e) => setSendPlanToo(e.target.checked)} /> Email it to the client to accept
                    </label>
                    <button type="button" className={`${s.btn} ${s.btnSm}`} disabled={!client || !calendar.length || !!busy} onClick={() => void putOnPlan()} title={client ? "" : "Pick the client first"} data-lawn-plan-go>
                      {busy === "plan" ? "Creating the plan…" : client ? "Put them on the plan" : "Pick the client to start a plan"}
                    </button>
                  </>
                )}
              </div>
              <button type="button" className={s.link} onClick={() => setShowRates((v) => !v)}>
                {showRates ? "Hide your rates" : "Your rates"}
              </button>
              {showRates ? <RatesCard settings={settings} own={ownRate} onSaved={(x) => { setSettings(x); setOwnRate(true); }} /> : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

const KIND_WORD: Record<RuleKind, string> = { fertilizer: "Fertilizer", pesticide: "Weed control", license: "Licence", water: "Water", equipment: "Equipment" };
const SHORT: Partial<Record<ServiceId, string>> = { mow: "Mow", fert: "Feed", aerate: "Aerate", overseed: "Seed", dethatch: "Dethatch", springCleanup: "Spring clean", fallCleanup: "Leaves", mulch: "Mulch", bedWeeding: "Beds", shrubs: "Shrubs", hedges: "Hedges", irrigationStart: "Sprinklers on", irrigationBlowout: "Blowout", gutters: "Gutters" };

/** The year at a glance: each month, what happens in it. */
function SeasonStrip({ visits }: { visits: PlanVisit[] }) {
  if (!visits.length) return null;
  const byMonth = new Map<string, PlanVisit[]>();
  for (const v of visits) {
    const k = v.date.slice(0, 7);
    byMonth.set(k, [...(byMonth.get(k) ?? []), v]);
  }
  const first = new Date(`${visits[0].date}T00:00:00Z`);
  const keys = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1));
    return d.toISOString().slice(0, 7);
  });
  return (
    <section className={s.card} data-lawn-season-strip>
      <div className={s.head}>
        <div>
          <div className={s.cardTitle}>The season</div>
          <p className={s.cardSub}>Every visit dated from today, for the grass and the climate here. The plan books these.</p>
        </div>
      </div>
      <div className={s.body} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: 6 }}>
        {keys.map((k) => {
          const list = byMonth.get(k) ?? [];
          const mows = list.filter((v) => v.service === "mow").length;
          const rest = list.filter((v) => v.service !== "mow");
          const [y, m] = k.split("-").map(Number);
          return (
            <div key={k} className={s.num} style={{ padding: "8px 9px", opacity: list.length ? 1 : 0.55 }}>
              <div className={s.numL}>
                {MONTH[m - 1]} {String(y).slice(2)}
              </div>
              <div style={{ fontSize: 12, fontWeight: 800, marginTop: 4 }}>{mows ? `Mow ×${mows}` : list.length ? "" : "—"}</div>
              {rest.map((v) => (
                <div key={v.date + v.service} style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
                  {SHORT[v.service] ?? v.label} {Number(v.date.slice(8))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Head({ title, sub, right }: { title?: string; sub?: string; right?: React.ReactNode }) {
  return (
    <header className={s.pageHead}>
      <div>
        <div className={s.kicker}>
          Lawn &amp; landscape estimator <span className={s.adminNote}>Admin preview</span>
        </div>
        <h1 className={s.pageTitle}>{title ?? "Measure a yard"}</h1>
        <p className={s.pageSub}>{sub ?? "From the address to the season's price: the lawn, beds and trees measured from the air, every service priced by your crew's time."}</p>
      </div>
      {right ?? null}
    </header>
  );
}

function Num({ v, l }: { v: string; l: string }) {
  return (
    <div className={s.num}>
      <div className={s.numV}>{v}</div>
      <div className={s.numL}>{l}</div>
    </div>
  );
}

function Num2({ label, value, onChange, max }: { label: string; value: number; onChange: (v: number) => void; max: number }) {
  return (
    <label className={s.field}>
      <span className={s.lbl}>{label}</span>
      <input className={s.in} inputMode="numeric" value={String(value)} onChange={(e) => onChange(Math.max(0, Math.min(max, Math.round(Number(e.target.value.replace(/[^0-9.]/g, "")) || 0))))} />
    </label>
  );
}

function ClientPicker({ client, onPick }: { client: LawnClient | null; onPick: (c: LawnClient | null) => void }) {
  const [q, setQ] = React.useState("");
  const [found, setFound] = React.useState<LawnClient[]>([]);
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
      <p className={s.note}>
        For <strong>{client.name}</strong>{" "}
        <button type="button" className={s.link} onClick={() => onPick(null)}>
          change
        </button>
      </p>
    );
  return (
    <div className={s.field}>
      <span className={s.lbl}>Client (optional)</span>
      <input className={s.in} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a client" data-lawn-client />
      {q.trim() && found.length ? (
        <div style={{ display: "grid", gap: 4 }}>
          {found.map((c) => (
            <button key={c.id} type="button" className={s.draft} onClick={() => onPick(c)}>
              <span className={s.draftName}>{c.name}</span>
              <span className={s.mono}>{c.address ?? c.email ?? ""}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RatesCard({ settings, own, onSaved }: { settings: LawnSettings; own: boolean; onSaved: (s: LawnSettings) => void }) {
  const [d, setD] = React.useState<LawnSettings>(settings);
  const [msg, setMsg] = React.useState<string | null>(null);
  const n = (k: keyof LawnSettings, label: string, unit = "") => (
    <label className={s.field}>
      <span className={s.lbl}>
        {label}
        {unit ? ` (${unit})` : ""}
      </span>
      <input className={s.in} inputMode="decimal" value={String(d[k] as number)} onChange={(e) => setD({ ...d, [k]: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })} />
    </label>
  );
  return (
    <div className={s.card} style={{ padding: 12 }} data-lawn-rates>
      <p className={s.note}>{own ? "Your own rates — every price follows them." : "Not set yet: prices follow the market's middle, scaled to the city. Set yours and every price follows them."}</p>
      <div className={s.fields} style={{ marginTop: 8 }}>
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
      <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
        <span className={s.lbl}>Mowers on the trailer</span>
        <div className={s.row}>
          {MOWERS.map((m) => (
            <label key={m.id} className={s.tool} style={{ fontSize: 12.5, fontWeight: 700 }}>
              <input type="checkbox" checked={d.mowers.includes(m.id)} onChange={(e) => setD({ ...d, mowers: e.target.checked ? [...d.mowers, m.id as Mower] : d.mowers.filter((x) => x !== m.id) })} />
              {m.name}
            </label>
          ))}
        </div>
      </div>
      <div className={s.row} style={{ marginTop: 10 }}>
        <button
          type="button"
          className={`${s.btn} ${s.btnSm} ${s.btnPrimary}`}
          onClick={async () => {
            const r = await saveLawnSettings(d);
            if (r.ok) {
              onSaved(r.settings);
              setMsg("Saved — every price follows them now.");
            } else setMsg(r.error);
          }}
          data-lawn-rates-save
        >
          Save my rates
        </button>
        {msg ? <span className={s.note}>{msg}</span> : null}
      </div>
    </div>
  );
}
