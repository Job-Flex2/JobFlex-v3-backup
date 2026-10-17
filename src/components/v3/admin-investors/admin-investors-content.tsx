"use client";

// ADMIN — INVESTORS, /admin/investors (2026-10-06; facts only since
// 2026-10-17). The report (shared with the public link and the PDF) with the
// owner's controls between its first sentences and the rest: Meta's spend
// (read now, or by itself every 15 minutes), days booked by hand for another
// platform, the start day, and the shared link. No assumptions to set: the
// daily budget, the realistic share, the projected spend and the horizon are
// gone (owner: "remove assumptions").

import { useState, type ReactNode } from "react";
import { Copy, ExternalLink, FileDown, Link as LinkIcon, RefreshCw, Trash2 } from "lucide-react";
import { addAdSpendAction, deleteAdSpendAction, getInvestorReport, investorLinkAction, pullMetaSpendAction, saveInvestorSettingsAction } from "@/actions/investors";
import type { InvestorReport } from "@/lib/investors";
import { dollars, longDate, PLATFORMS, PLATFORM_LABEL, type SpendPlatform } from "@/lib/investorModel";
import { InvestorReportView } from "./investor-report";
import shared from "@/components/v3/admin-overview/admin-shared.module.css";
import s from "./admin-investors.module.css";

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export function AdminInvestorsContent({ initial, origin, audience }: { initial: InvestorReport; origin: string; /** Who opened the link and their offers (2026-10-13), drawn by the page. */ audience?: ReactNode }) {
  const [report, setReport] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const f = report.facts;
  const a = report.settings;

  // Days booked by hand.
  const [from, setFrom] = useState(todayLocal());
  const [to, setTo] = useState(todayLocal());
  const [perDay, setPerDay] = useState("");
  // Meta reports itself once connected; a day by hand is then for another platform.
  const [platform, setPlatform] = useState<SpendPlatform>(initial.meta.configured ? "google" : "meta");
  // The start day.
  const [sinceDate, setSinceDate] = useState(a.sinceDate ?? "");
  const sinceOrNull = sinceDate.trim() === "" ? null : sinceDate;

  const run = async (call: () => Promise<{ ok: true; report: InvestorReport } | { ok: false; error: string }>) => {
    setPending(true);
    setError("");
    try {
      const res = await call();
      if (res.ok) setReport(res.report);
      else setError(res.error);
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  };
  const link = a.linkToken ? `${origin}/investors/${a.linkToken}` : null;
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Copy did not work here — select the link and copy it.");
    }
  };
  const sinceChanged = sinceOrNull !== a.sinceDate;
  const booked = report.entries;
  const handBooked = booked.filter((e) => e.source === "manual");

  const controls = (
    <div className={s.controls}>
      {/* The ad spend: Meta's own figures. */}
      <section className={s.panel} aria-label="Ad spend">
        <h2 className={s.panelTitle}>Ad spend</h2>
        <div className={s.metaRow} data-meta={report.meta.configured ? "on" : "off"}>
          <div>
            <b>Meta</b>{" "}
            {report.meta.configured
              ? <>connected{report.meta.lastPulledAt ? ` · last read ${when(report.meta.lastPulledAt)}, ${report.meta.daysPulled} ${report.meta.daysPulled === 1 ? "day" : "days"}` : " · not read yet"}{report.meta.lastError ? ` · ${report.meta.lastError}` : ""} · read again by itself when older than 15 minutes — on the shared link too — and every morning</>
              : <>not connected — add <code>META_ADS_ACCESS_TOKEN</code> and <code>META_AD_ACCOUNT_ID</code> to the deployment; then the exact spend per day is read by itself.</>}
          </div>
          {report.meta.configured && <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => void run(() => pullMetaSpendAction())}>Read from Meta now</button>}
        </div>
        <p className={s.hint}>The figures count only what was spent: Meta&apos;s own number for each day, and any day booked by hand below. Nothing is estimated.{f.leftOut.cents > 0 ? ` ${dollars(f.leftOut.cents)} spent while trials needed no card is left out of them.` : ""}</p>

        {/* Days booked by hand. */}
        <details className={s.fold}>
          <summary>Book days by hand · for a platform Meta does not report · {handBooked.length} {handBooked.length === 1 ? "day" : "days"}</summary>
          <form
            className={s.form}
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => addAdSpendAction({ from, to, perDayDollars: Number(perDay), platform }));
            }}
          >
            <label className={s.field}><span>From</span><input className={s.in} name="from" type="date" value={from} max={todayLocal()} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} required /></label>
            <label className={s.field}><span>To</span><input className={s.in} name="to" type="date" value={to} min={from} max={todayLocal()} onChange={(e) => setTo(e.target.value)} required /></label>
            <label className={s.field}><span>Spent per day, $</span><input className={s.in} name="perDay" type="number" inputMode="decimal" min={0} step="0.01" placeholder="e.g. 100" value={perDay} onChange={(e) => setPerDay(e.target.value)} required /></label>
            <label className={s.field}><span>Platform</span><select className={s.in} value={platform} onChange={(e) => setPlatform(e.target.value as SpendPlatform)}>{PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}</select></label>
            <button type="submit" className="btn btn-primary" disabled={pending}>Book spend</button>
          </form>
          <p className={s.hint}>{handBooked.length} {handBooked.length === 1 ? "day" : "days"} booked by hand. A day booked here adds to Meta&apos;s for another platform; a Meta day booked by hand is replaced by Meta&apos;s own figure on its next read.</p>
          {booked.length > 0 && (
            <div className={s.entryList}>
              {booked.slice(0, 120).map((e) => (
                <div key={e.id} className={s.entry}>
                  <span className={s.entryDate}>{e.date}</span>
                  <span>{PLATFORM_LABEL[e.platform]}{e.source === "meta" ? " · from Meta" : ""}</span>
                  <b>{dollars(e.cents)}</b>
                  <button type="button" className={s.iconBtn} aria-label={`Remove ${e.date} ${PLATFORM_LABEL[e.platform]}`} disabled={pending} onClick={() => void run(() => deleteAdSpendAction({ id: e.id }))}><Trash2 size={13} aria-hidden="true" /></button>
                </div>
              ))}
              {booked.length > 120 && <p className={s.hint}>The newest 120 are listed.</p>}
            </div>
          )}
        </details>
      </section>

      {/* The start day. */}
      <section className={s.panel} aria-label="Counting from">
        <h2 className={s.panelTitle}>Counting from</h2>
        <form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => saveInvestorSettingsAction({ sinceDate: sinceOrNull }));
          }}
        >
          <label className={`${s.field} ${s.wide}`}>
            <span>The day the first campaign went live</span>
            <input className={s.in} type="date" value={sinceDate} min="2025-01-01" max={todayLocal()} onChange={(e) => setSinceDate(e.target.value)} />
            <small>
              {report.firstAdDay ? (
                <>
                  First visitor from an ad seen on <b>{longDate(report.firstAdDay)}</b>
                  {report.firstAdDay !== sinceDate && <> · <button type="button" className={s.textBtn} onClick={() => setSinceDate(report.firstAdDay ?? "")}>use that day</button></>}.{" "}
                </>
              ) : (
                <>Blank counts from the live map&apos;s start, Sep 30, 2026. </>
              )}
              Spend, signups and payments before this day are left out; customers already paying count as paying.
            </small>
          </label>
          <button type="submit" className="btn btn-primary" disabled={pending || !sinceChanged}>Save</button>
        </form>
      </section>

      {/* The shared link. */}
      <section className={s.panel} aria-label="Shared link">
        <h2 className={s.panelTitle}>Share with investors</h2>
        <p className={s.hint}>A live page with these figures and no admin controls, and the same as a PDF. Anyone with the link can open it; make a new link to cut off the old one.</p>
        {link ? (
          <div className={s.linkRow} data-link-enabled={a.linkEnabled}>
            <code className={s.link}>{link}</code>
            <button type="button" className="btn btn-ghost" onClick={() => void copy()} disabled={!a.linkEnabled}><Copy size={14} aria-hidden="true" />{copied ? "Copied" : "Copy"}</button>
            <a className="btn btn-ghost" href={link} target="_blank" rel="noreferrer" aria-disabled={!a.linkEnabled}><ExternalLink size={14} aria-hidden="true" />Open</a>
          </div>
        ) : null}
        <div className={s.linkActs}>
          {link && <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => void run(() => investorLinkAction({ enabled: !a.linkEnabled }))}>{a.linkEnabled ? "Switch the link off" : "Switch the link on"}</button>}
          <button type="button" className={link ? "btn btn-ghost" : "btn btn-primary"} disabled={pending} onClick={() => void run(() => investorLinkAction({ rotate: true }))}><LinkIcon size={14} aria-hidden="true" />{link ? "Make a new link" : "Make the link"}</button>
          <button type="button" className={s.iconBtn} aria-label="Read the figures again" disabled={pending} onClick={() => void run(async () => ({ ok: true as const, report: await getInvestorReport() }))}><RefreshCw size={14} className={pending ? s.spin : ""} aria-hidden="true" /></button>
        </div>
      </section>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">Platform · Investors</div>
          <h1 className="page-title">Investors</h1>
        </div>
        <div className={shared.headSide}>
          {link && a.linkEnabled ? <span className="chip ok">Link live</span> : <span className={`chip ${shared.chipMuted}`}>Link off</span>}
          {link && a.linkEnabled && (
            <a className="btn btn-ghost" href={`/api/investors/${a.linkToken}/pdf`} target="_blank" rel="noreferrer">
              <FileDown size={15} aria-hidden="true" />
              PDF
            </a>
          )}
        </div>
      </div>

      {error && <p className={`${shared.note} ${s.err}`} role="alert">{error}</p>}

      {audience}

      <InvestorReportView report={report} between={controls} />
    </>
  );
}
