"use client";

// Existing admin shell and controls, with bounded browser-open monitoring.

import Link from "next/link";
import { useState, useTransition, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { setStripeModeAction } from "@/actions/admin";
import type { Route } from "next";
import type { IntegrationGroup, IntegrationStatus } from "@/lib/sdk/integrations";
import s from "@/components/v3/admin-overview/admin-shared.module.css";
import { Ic } from "@/components/v3/admin-overview/admin-ui";
import { useAdminMotion } from "@/components/v3/admin-overview/admin-motion";
import { IntegrationLinks } from "./integration-links";
import i from "./integrations.module.css";
import { checkIntegrationsNow } from "@/actions/integrationsHealth";
import { freshReport, isFresh, HEALTH_INTERVAL_MS, type HealthReport, type ServiceHealth } from "@/lib/integrationHealthModel";

const HEALTH = "/admin/health" as Route;

const GROUPS: { key: IntegrationGroup; title: string }[] = [
  { key: "payments", title: "Payments" },
  { key: "messaging", title: "Email & SMS" },
  { key: "property", title: "Property data" },
  { key: "platform", title: "Platform" },
];

function statusLabel(item: IntegrationStatus, health?: ServiceHealth) {
  if (!item.enabled) return "Not configured";
  return health?.level === "ok" ? "Verified" : health?.level === "down" ? "Issue observed" : health?.level === "degraded" ? "Limited / incident" : "Unknown";
}

function EvidenceDetails({ health }: { health?: ServiceHealth }) {
  if (!health) return <p className={i.evidence}>Not checked yet. Configuration does not prove availability.</p>;
  return <div className={i.evidence}>
    <p>{health.reason}</p>
    <details><summary>Evidence, limits and timestamps</summary>
    {health.note ? <p role="status">{health.note}</p> : null}
    <dl>
      {([ ["authentication", "Authentication"], ["quota", "Quota / trial access"], ["provider", "Provider availability"], ["feature", "Feature end-to-end"] ] as const).map(([key, label]) => {
        const part = health[key];
        const fresh = isFresh(part?.observedAt);
        const state = part?.state === "unsupported" ? "Unsupported" : !fresh ? "Unknown" : part?.state === "ok" ? "Verified for this check" : part?.state === "error" ? "Issue observed" : part?.state === "limited" ? "Limited" : "Unknown";
        return <div key={key}><dt>{label}</dt><dd><strong>{state}</strong> — {part?.detail ?? "No evidence"}
          <span>Source: {part?.source ?? "None"}</span>
          <span>Observed: {part?.observedAt ?? "Never"}{part?.observedAt ? fresh ? " · fresh" : " · stale" : ""}</span>
          <span>Last successful observation: {part?.lastSuccessAt ?? "Not recorded"}</span>
        </dd></div>;
      })}
    </dl>
    <p>Last check: {health.checkedAt} · {isFresh(health.checkedAt) ? "fresh" : "stale"}</p>
    </details>
  </div>;
}

function GroupCard({
  title,
  items,
  report,
}: {
  title: string;
  items: IntegrationStatus[];
  report: HealthReport | null;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-titles">
          <div className="card-title">{title}</div>
        </div>
      </div>
      <hr className="card-rule" />
      {items.map((it) => {
        const health = report?.services.find(service => service.key === it.key);
        return (
          <div className={`${s.row} ${i.iRow}`} key={it.key}>
            <div className={s.rowMain}>
              <div className={s.rowTitle} title={it.name}>
                {it.name}
              </div>
            </div>
            <span className={`chip ${health?.level === "down" ? s.chipDanger : s.chipMuted}`}>{statusLabel(it, health)}</span>
            <IntegrationLinks id={it.key} />
            {it.setupHref ? (
              <Link className="btn btn-ghost btn-sm" href={it.setupHref as Route}>
                Set up
              </Link>
            ) : null}
            <EvidenceDetails health={health} />
            <div className={i.keys}>
              {it.envKeys.map((k) => (
                <span className={s.envk} key={k}>
                  {k}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The live/sandbox payments switch. Its truth is a SyncState row read by the
 *  checkout routes per request (lib/stripeMode) — flipping it changes where
 *  the NEXT checkout session is created, no restart involved. Exported: the
 *  plans page mounts the same control, because "where do these plans charge"
 *  is a question asked while editing plans as much as while wiring keys. */
export function StripeModeSwitch({
  mode,
  modes,
}: {
  mode: "live" | "test";
  modes: { live: boolean; test: boolean };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const pick = (next: "live" | "test") => {
    if (next === mode || pending) return;
    setErr(null);
    start(async () => {
      try {
        await setStripeModeAction(next);
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not switch.");
      }
    });
  };
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-titles">
          <div className="card-title">Payments mode</div>
          <div className="card-sub">
            Which Stripe account checkout charges — the live account or the test sandbox.
            Test mode prices from the catalog directly and takes Stripe&apos;s test cards
            (4242&nbsp;4242&nbsp;4242&nbsp;4242).
          </div>
        </div>
      </div>
      <hr className="card-rule" />
      <div className={i.modeRow}>
        {(["live", "test"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={i.modeBtn + (mode === m ? " " + i.modeOn : "")}
            aria-pressed={mode === m}
            disabled={pending || !modes[m]}
            title={modes[m] ? undefined : "No key configured for this mode"}
            onClick={() => pick(m)}
          >
            {m === "live" ? "Live" : "Sandbox"}
            <i>{m === "live" ? "sk_live" : "sk_test"}</i>
          </button>
        ))}
        <span className={i.modeNote}>
          {pending ? "Switching…" : mode === "test" ? "Payments go to the SANDBOX." : "Payments are REAL."}
        </span>
      </div>
      {err ? (
        <div className={i.modeErr} role="alert">
          {err}
        </div>
      ) : null}
    </div>
  );
}

export function AdminIntegrationsContent({
  items,
  initialHealth,
  stripeMode,
  stripeModes,
}: {
  items: IntegrationStatus[];
  initialHealth: HealthReport | null;
  stripeMode: "live" | "test";
  stripeModes: { live: boolean; test: boolean };
}) {
  useAdminMotion();
  const [report, setReport] = useState(initialHealth);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(false);
  const busy = useRef(false);
  const retryAt = useRef(0);
  const failures = useRef(0);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    if (busy.current || Date.now() < retryAt.current || document.hidden || !navigator.onLine) return;
    busy.current = true;
    setChecking(true);
    setCooldown(true);
    try {
      const result = await checkIntegrationsNow();
      if (!result.ok) throw new Error(result.error);
      failures.current = 0;
      retryAt.current = Math.max(Date.now() + HEALTH_INTERVAL_MS, Date.parse(result.report.nextCheckAt ?? "") || 0);
      if (mounted.current) { setReport(result.report); setError(null); }
    } catch {
      failures.current = Math.min(failures.current + 1, 4);
      retryAt.current = Date.now() + HEALTH_INTERVAL_MS * 2 ** failures.current;
      if (mounted.current) setError("Refresh unavailable. Previous evidence is retained and expires after 10 minutes. Automatic retry uses backoff.");
    } finally {
      busy.current = false;
      if (mounted.current) setChecking(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const initialTimer = window.setTimeout(() => void refresh(), 0);
    const tick = () => { setCooldown(Date.now() < retryAt.current); setReport(previous => previous ? freshReport(previous) : null); void refresh(); };
    const timer = window.setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("online", tick);
    return () => { mounted.current = false; window.clearInterval(timer); window.clearTimeout(initialTimer); document.removeEventListener("visibilitychange", tick); window.removeEventListener("online", tick); };
  }, [refresh]);
  const currentReport = report ? freshReport(report) : null;


  const configured = items.filter((it) => it.enabled).length;
  const cards = GROUPS.map((g) => ({
    ...g,
    items: items.filter((it) => it.group === g.key),
  }));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">
            Platform · {configured} of {items.length} available or configured
          </div>
          <h1 className="page-title">Integrations</h1>
        </div>
        <div className="page-actions">
          <Link className="btn btn-ghost" href={HEALTH}>
            <Ic id="i-check" />
            Health
          </Link>
        </div>
      </div>

      <section className={i.monitor} aria-label="Monitoring controls">
        <p>Checks refresh about every five minutes while this page is visible and online. Failed checks back off. No searches, paid reports, generation, messages or transactions are performed.</p>
        <p>The repository declares a daily server cron at 04:40 UTC; execution on this deployment is unverified. Browser refresh is not always-on monitoring.</p>
        <p role="status">{checking ? "Checking safe sources…" : currentReport ? `Report: ${currentReport.ranAt} · ${isFresh(currentReport.ranAt) ? "fresh" : "stale"}. Next eligible check: ${currentReport.nextCheckAt ?? "unknown"}` : "No current report. Status is unknown until checked."}</p>
        <button className="btn btn-ghost" disabled={checking || cooldown} onClick={() => void refresh()}>Refresh status</button>
        {error ? <p role="alert">{error}</p> : null}
        <p>Unknown means the available evidence cannot verify current service health. Unsupported means no documented free probe is configured. Provider status does not verify this account, quota or customer workflow.</p>
      </section>

      <StripeModeSwitch mode={stripeMode} modes={stripeModes} />

      <div className="grid-11">
        <GroupCard title={cards[0].title} items={cards[0].items} report={currentReport} />
        <GroupCard title={cards[1].title} items={cards[1].items} report={currentReport} />
      </div>

      <div className="grid-11">
        <GroupCard title={cards[2].title} items={cards[2].items} report={currentReport} />
        <GroupCard title={cards[3].title} items={cards[3].items} report={currentReport} />
      </div>
    </>
  );
}
