"use client";
import { Fragment, useEffect, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { RefreshCw, FlaskConical, Info } from "lucide-react";
import { getTrafficExperimentsAction } from "@/actions/trafficDashboard";
import { conversionInterval, percent, type ExperimentResult, type TrafficFilters } from "@/lib/traffic-contract";
import { TRIAL_EXPERIMENT, TRIAL_TEST_ENDED, TRIAL_TEST_ENDED_NOTE } from "@/lib/trialOffer";
import { parseTrafficFilters } from "@/lib/traffic-query";
import { TRAFFIC_SINCE } from "@/lib/traffic-visitor";
import { TrafficDatePicker } from "./traffic-date-picker";
import s from "./traffic.module.css";
const n = (v: number) => v.toLocaleString("en-US");
const rate = (v: number | null) => v == null ? "--" : v.toFixed(1) + "%";
const MobileExperimentResults = dynamic(() => import("./experiment-results-mobile"), { ssr: false });
function subscribe(listener: () => void) { const query = matchMedia("(max-width: 768px)"); query.addEventListener("change", listener); return () => query.removeEventListener("change", listener); }
function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  // `bp-sel-in` is load-bearing: the wrapper draws the chevron, and only that class removes the native one.
  return <label className={s.filterLabel}><span>{label}</span><div className={`bp-sel ${s.selectWrap}`}><select className="bp-sel-in" value={value} onChange={e => onChange(e.target.value)}>{children}</select></div></label>;
}

export function AdminExperimentsContent({ initialFilters }: { initialFilters: TrafficFilters }) {
  const mobile = useSyncExternalStore(subscribe, () => matchMedia("(max-width: 768px)").matches, () => false);
  const [filters, setFilters] = useState(initialFilters);
  const [draft, setDraft] = useState(initialFilters);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [experiment, setExperiment] = useState("");
  const [control, setControl] = useState("");
  const [exp, setExp] = useState<{ key: string; rows: ExperimentResult[]; failed: boolean; readAt: string } | null>(null);
  const key = JSON.stringify(filters) + revision;
  useEffect(() => {
    let live = true;
    getTrafficExperimentsAction({ ...filters }).then(rows => { if (live) setExp({ key, rows, failed: false, readAt: new Date().toISOString() }); }).catch(() => { if (live) setExp({ key, rows: [], failed: true, readAt: "" }); });
    return () => { live = false; };
  }, [filters, key]);
  const experimentsLoading = exp?.key !== key;
  const experimentRows = experimentsLoading ? [] : exp.rows;
  const experimentNames = Array.from(new Set(experimentRows.map(e => e.experiment)));
  const selectedExperiment = experimentNames.includes(experiment) ? experiment : experimentNames[0] || "";
  const variants = experimentRows.filter(e => e.experiment === selectedExperiment);
  const baseline = variants.find(v => v.variant === control) || variants.find(v => v.variant === "control") || variants[0];
  const variantLabel = (variant: string) => selectedExperiment === TRIAL_EXPERIMENT ? variant === "a" ? "A · 3-day trial" : variant === "b" ? "B · 7-day trial" : variant : variant;
  const when = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: filters.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  function apply() { try { const next = parseTrafficFilters({ ...draft }); setFilters(next); setDraft(next); setRevision(v => v + 1); setError(""); } catch (err) { setError(err instanceof Error ? err.message : "Check the selected dates."); } }
  return <div className={s.root}>
    <header className={s.header}><div><div className={s.eyebrow}>Experiment results</div><h1>A/B testing<span>.</span></h1></div><button className={s.button} disabled={experimentsLoading} onClick={() => setRevision(v => v + 1)}><RefreshCw size={17}/>Refresh results</button></header>
    <div className={s.filterPanel}><div className={s.rangeRow}><TrafficDatePicker from={draft.from} to={draft.to} timezone={draft.timezone} min={TRAFFIC_SINCE} onChange={(from, to) => setDraft(v => ({ ...v, from, to }))}/><Select label="Conversion window" value={String(draft.windowDays)} onChange={v => setDraft(f => ({ ...f, windowDays: Number(v) }))}>{[1,7,14].map(d => <option key={d} value={d}>{d} days after exposure</option>)}</Select><button type="button" className={s.primary} disabled={experimentsLoading} onClick={apply}>Apply filters</button></div><p className={s.footnote}>Production visitors · live billing · {filters.timezone}. Showing {filters.from} to {filters.to}.</p>{error && <p role="alert" className={s.notice}>{error}</p>}</div>
    <section className={s.card}><div className={s.exploreBody}>
        <div className={s.exploreHead}><div><h2>Trial comparison</h2><p className={s.micro}>Recorded visitors and verified signups. Trial length test: A = 3 days; B = 7 days.</p>{TRIAL_TEST_ENDED && <p className={s.endedNote}>{TRIAL_TEST_ENDED_NOTE.split(" · ").map((part, i) => <Fragment key={i}>{i ? " · " : ""}<span>{part}</span></Fragment>)}</p>}</div><span className={s.stamp}>{experimentsLoading ? "Loading" : exp?.failed ? "Unavailable" : experimentNames.length ? `${experimentNames.length} observed` : "No recorded exposures"}</span></div>
        {experimentsLoading ? <div className={s.empty} role="status">Loading recorded experiment results…</div> : !variants.length ? exp?.failed ? <div className={s.empty}>Experiment results are unavailable. Refresh to retry. Missing data is not shown as zero conversions.</div> : <div className={s.experimentEmpty}><div className={s.experimentMark}><FlaskConical size={34}/><span>A / B</span></div><div><h3>No experiment exposures recorded in this range.</h3><p>{TRIAL_TEST_ENDED ? "The trial test has ended, so no new exposures are recorded. Choose dates up to Oct 11, 2026 to see its results." : "The trial test is active. Results appear after visitors actually see an offer and analytics records the visit."} No conversion rate is calculated without recorded exposures.</p><div className={s.experimentSteps}><span>A / 3-day trial</span><span>B / 7-day trial</span></div></div></div> : <>
          <div className={s.experimentControls}><Select label="Experiment" value={selectedExperiment} onChange={setExperiment}>{experimentNames.map(name => <option key={name} value={name}>{name === TRIAL_EXPERIMENT ? `Trial length · 3 vs 7 days${TRIAL_TEST_ENDED ? " · ended" : ""}` : name}</option>)}</Select><Select label="Compare against" value={baseline?.variant || ""} onChange={setControl}>{variants.map(v => <option key={v.variant} value={v.variant}>{variantLabel(v.variant)}</option>)}</Select></div>
          {mobile ? <MobileExperimentResults variants={variants} baseline={baseline} label={variantLabel}/> : <div className={s.tableScroll}><table className={s.table}><thead><tr><th>Variant</th><th>Exposed visitors</th><th>Attempts</th><th>Attempt rate</th><th>Verified signups</th><th>Signup rate</th><th>Lift</th><th>95% interval</th></tr></thead><tbody>{variants.map(v => {
            const r = percent(v.completed, v.visitors);
            const b = baseline ? percent(baseline.completed, baseline.visitors) : null;
            const ci = conversionInterval(v.completed, v.visitors);
            return <tr key={v.variant}><td><b>{variantLabel(v.variant)}</b>{v === baseline && <small>Baseline</small>}</td><td>{n(v.visitors)}</td><td>{n(v.attempts)}</td><td>{rate(percent(v.attempts, v.visitors))}</td><td>{n(v.completed)}</td><td><b>{rate(r)}</b></td><td>{v === baseline ? "--" : b && r != null ? `${((r / b - 1) * 100).toFixed(1)}%` : "--"}</td><td>{ci ? `${rate(ci[0])} to ${rate(ci[1])}` : "--"}</td></tr>;
          })}</tbody></table></div>}
          {variants.some(v => v.completedByMode) && <div className={s.tableScroll} style={{ marginTop: 14 }}><table className={s.table}><thead><tr><th>Verified signups by sign-up mode</th><th>3 steps</th><th>2 steps</th><th>Passwordless</th><th>Not recorded</th></tr></thead><tbody>{variants.map(v => <tr key={v.variant}><td><b>{variantLabel(v.variant)}</b></td><td>{n(v.completedByMode?.["3-step"] ?? 0)}</td><td>{n(v.completedByMode?.["2-step"] ?? 0)}</td><td>{n(v.completedByMode?.passwordless ?? 0)}</td><td>{n(v.completedByMode?.unknown ?? 0)}</td></tr>)}</tbody></table></div>}
          <p className={s.footnote}>{n(variants.reduce((sum, v) => sum + v.mixedVisitors, 0))} visitors with mixed variant exposures excluded. Rates use a {filters.windowDays}-day window after first exposure.</p>
        </>}
        {!experimentsLoading && !exp?.failed && exp?.readAt && <p className={s.footnote}>Experiment data read {when(exp.readAt)}. Refresh reloads this comparison.</p>}
        {!experimentsLoading && exp?.failed && <div className={s.notice}>Experiment results could not be loaded. This does not mean no experiments exist.</div>}
        <div className={s.experimentNote}><Info size={16}/><span>A conversion is a server-verified signup after account creation and Stripe verification. Starting a free trial does not mean a payment was collected. Each recorded visitor counts once per variant; duplicate events do not add conversions. Untracked visits and signups are not estimated. The 95% Wilson interval shows uncertainty, not a winning variant. Let cohorts mature before deciding.</span></div>
      </div></section>
  </div>;
}
