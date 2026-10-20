"use client";

// THE INTEGRATIONS PANEL on Admin → Overview.
//
// One card for every outside service, because the question an operator asks is
// never "how is SerpAPI" — it is "is anything broken this morning". The card
// leads with that answer, then names what each service said and when it said
// it, so a red line can be argued with rather than just believed.
//
// The rows are the stored report: nothing is checked while the page renders.
// "Check now" re-runs the same sweep the nightly cron runs, and the button says
// which it is showing — a figure from last night is not a figure from now.

import { useState, useTransition, useEffect } from "react";
import { checkIntegrationsNow } from "@/actions/integrationsHealth";
import { freshReport, type HealthLevel, type HealthReport } from "@/lib/integrationHealthModel";
import s from "./admin-shared.module.css";
import { ago } from "./admin-ui";
import { IntegrationLinks } from "@/components/v3/admin-integrations/integration-links";

const WORD: Record<HealthLevel, string> = {
  ok: "Verified",
  unknown: "Unknown",
  degraded: "Degraded",
  down: "Down",
  off: "Not set up",
};

function toneClass(level: HealthLevel): string {
  if (level === "down") return s.healthDown;
  if (level === "degraded") return s.healthWarn;
  if (level === "off" || level === "unknown") return s.healthOff;
  return s.healthOk;
}

/** The sentence at the top: what an operator needs before reading any row.
 *  Optional services are counted apart — one of them being down is a note, not
 *  an incident, and folding it into the headline would cost the headline its
 *  meaning (see ServiceHealth.optional). */
function verdict(report: HealthReport | null): { text: string; level: HealthLevel } {
  if (!report) return { text: "Never checked", level: "degraded" };
  const load = report.services.filter((x) => !x.optional);
  const down = load.filter((x) => x.level === "down").length;
  const degraded = load.filter((x) => x.level === "degraded").length;
  const off = load.filter((x) => x.level === "off").length;
  const live = load.length - off;
  const unknown = load.filter((x) => x.level === "unknown").length;
  const spare = report.services.filter((x) => x.optional && x.level === "down").length;
  const tail = spare ? ` · ${spare} optional down` : "";
  if (down) return { text: `${down} down of ${live} configured${tail}`, level: "down" };
  if (degraded) return { text: `${degraded} degraded of ${live} configured${tail}`, level: "degraded" };
  if (unknown) return { text: `${unknown} unverified of ${live} configured${tail}`, level: "unknown" };
  return { text: `All ${live} monitored services verified${tail}`, level: spare ? "degraded" : "ok" };
}

export function IntegrationsHealthCard({
  initial,
  now,
}: {
  initial: HealthReport | null;
  /** Server clock, so the relative times render the same on both sides. */
  now: string;
}) {
  const [report, setReport] = useState<HealthReport | null>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [clock, setClock] = useState(now);
  useEffect(() => {
    const tick = () => setClock(new Date().toISOString());
    const timer = window.setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, []);
  const current = report ? freshReport(report, Date.parse(clock)) : null;
  const v = verdict(current);

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-titles">
          <div className="card-title">Integrations health</div>
          <div className={s.kpiSrc}>
            {report ? `Checked ${ago(report.ranAt, clock)} · ${report.tookMs} ms` : "Nightly at 04:40 UTC, or on demand"}
          </div>
        </div>
        <div className={s.headSide}>
          <span className={`${s.healthVerdict} ${toneClass(v.level)}`}>{v.text}</span>
          <button
            type="button"
            className={s.healthBtn}
            disabled={pending}
            onClick={() => {
              setErr(null);
              start(async () => {
                const res = await checkIntegrationsNow();
                if (res.ok) { setReport(res.report); setClock(new Date().toISOString()); }
                else setErr(res.error);
              });
            }}
          >
            {pending ? "Checking…" : "Check now"}
          </button>
        </div>
      </div>

      {err ? (
        <p className={`${s.kpiSrc} ${s.healthDown}`} role="alert">
          {err}
        </p>
      ) : null}

      {report ? (
        <ul className={s.healthList}>
          {current?.services.map((x) => (
            <li key={x.key} className={s.healthRow}>
              <span className={`${s.healthDot} ${toneClass(x.level)}`} aria-hidden />
              <span className={s.healthName}>
                {x.name}
                {x.note ? <span className={s.healthNote}>{x.note}</span> : null}
                <IntegrationLinks id={x.key} compact />
              </span>
              <span className={`${s.healthLevel} ${toneClass(x.level)}`}>{WORD[x.level]}</span>
              <span className={s.healthReason}>{x.reason}</span>
              <span className={s.healthWhen}>{ago(x.asOf ?? x.checkedAt, clock)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={s.kpiSrc}>
          Nothing has been checked on this deployment yet. Press Check now, or wait for the nightly run.
        </p>
      )}
    </div>
  );
}
