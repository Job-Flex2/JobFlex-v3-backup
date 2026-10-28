"use client";

// Settings → Payments → Financing (Wisetack, owner 2026-10-28: "make it super smart where they can set it up and get
// the approval. Somewhere in settings"). One card, desk and phone: what lenders usually look at, Apply with the
// application already filled in (or link an existing Wisetack account), where Wisetack's decision stands with the next
// step, and once approved the default switch and the contractor's own "check your rate" link.
// The rules and words are lib/financing; the actions are actions/financing.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, Circle, Landmark, Link2, RefreshCw } from "lucide-react";
import { applyForFinancing, checkFinancingStatus, linkWisetackAccount, setFinancingDefault, setFinancingYearStarted } from "@/actions/financing";
import type { OrgFinancing } from "@/lib/financing/state";
import { FIN, feeLine, limitsLine, merchantWords, readinessLabel } from "@/lib/financing/words";
import type { FinancingSettingsData } from "../settings-data";
import { CopyBox, Toggle, actionError } from "../ui";
import styles from "../meta-connection.module.css";
import layout from "./integration-cards.module.css";

const money = (minor: number) => `$${Math.round(minor / 100).toLocaleString("en-US")}`;
const PILL: Record<OrgFinancing["state"], string> = {
  none: "Not set up",
  started: "Started",
  review: "In review",
  needs_info: "Needs info",
  approved: "Approved",
  declined: "Not approved",
  paused: "Paused",
};
const ACCOUNT_HREF = "/dashboard/settings?pane=account";

export function FinancingSubpane({ d, mobile = false, returned = false }: { d: FinancingSettingsData; mobile?: boolean; returned?: boolean }) {
  const router = useRouter();
  const [rec, setRec] = useState<OrgFinancing>(d.rec);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [year, setYear] = useState(rec.yearStarted ? String(rec.yearStarted) : "");
  const words = merchantWords(rec.state);
  const primary = `${styles.button} ${styles.primary}`;
  const canApply = d.canManage && (rec.state === "none" || rec.state === "declined");
  const open = rec.state === "started" || rec.state === "needs_info";

  async function run<T>(key: string, work: () => Promise<T>): Promise<T | null> {
    setBusy(key);
    setErr("");
    try {
      return await work();
    } catch (error) {
      setErr(actionError(error));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    const r = await run("apply", () => applyForFinancing());
    if (!r) return;
    if (!r.ok) return setErr(r.error);
    window.location.href = r.url;
  }
  async function link() {
    const r = await run("link", () => linkWisetackAccount(email));
    if (!r) return;
    if (!r.ok) return setErr(r.error);
    setRec(r.rec);
    if (r.url) window.location.href = r.url;
    else router.refresh();
  }
  async function check() {
    const r = await run("check", () => checkFinancingStatus());
    if (!r) return;
    if (!r.ok) return setErr(r.error);
    setRec(r.rec);
  }

  // Back from Wisetack's page: ask once where the application stands.
  const asked = useRef(false);
  useEffect(() => {
    if (!returned || asked.current || rec.state === "none") return;
    asked.current = true;
    void checkFinancingStatus().then((r) => {
      if (r.ok) setRec(r.rec);
    });
  }, [returned, rec.state]);

  return (
    <section className={`${styles.root} ${layout.surface} ${mobile ? `${styles.mobile} ${layout.mobile}` : ""}`} aria-label="Financing" data-financing={rec.state}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <Landmark size={22} aria-hidden="true" />
          <h2>Financing · Wisetack</h2>
        </div>
        <span className={`${styles.status} ${rec.state === "approved" ? styles.connected : ""}`}>
          {rec.state === "approved" && <Check size={14} aria-hidden="true" />}
          {PILL[rec.state]}
        </span>
      </header>

      <div className={styles.body}>
        <div className={styles.intro}>
          <h3 data-fin-title>{words.title}</h3>
          <p>{words.sub}</p>
        </div>

        {rec.state === "needs_info" && rec.needs.length ? (
          <ul className={layout.scopes} data-fin-needs>
            {rec.needs.map((n) => (
              <li key={n}>
                <Circle size={14} aria-hidden="true" />
                {n}
              </li>
            ))}
          </ul>
        ) : null}

        {rec.state === "none" ? (
          <div data-fin-ready>
            <p className={styles.label}>{`${FIN.readinessTitle} · ${d.readiness.ready} of ${d.readiness.total}`}</p>
            <ul className={layout.scopes}>
              {d.readiness.items.map((item) => (
                <li key={item.key} data-ok={item.ok ? "1" : "0"}>
                  {item.ok ? <Check size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
                  <span>{readinessLabel(item.key)}</span>
                  {!item.ok && item.key !== "year" && d.canManage ? (
                    <a href={ACCOUNT_HREF} style={{ marginLeft: "auto" }}>
                      Add it
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
            {d.canManage ? (
              <label className={styles.label} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                {readinessLabel("year")}
                <input
                  inputMode="numeric"
                  maxLength={4}
                  value={year}
                  aria-label={readinessLabel("year")}
                  style={{ width: 80 }}
                  onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))}
                  onBlur={() => void setFinancingYearStarted(year ? Number(year) : null).then((r) => r.ok && setRec(r.rec))}
                  data-fin-year
                />
              </label>
            ) : null}
            <p>{FIN.readinessSub}</p>
          </div>
        ) : null}

        {rec.state === "approved" ? (
          <div data-fin-approved>
            {limitsLine(rec.minMinor, rec.maxMinor, money) ? <p>{limitsLine(rec.minMinor, rec.maxMinor, money)}</p> : null}
            {rec.feeBps !== null ? <p>{feeLine(rec.feeBps)}</p> : null}
          </div>
        ) : null}

        <div className={styles.actions}>
          {canApply ? (
            <button className={primary} type="button" disabled={busy !== null} onClick={() => void apply()} data-fin-apply>
              <ArrowUpRight size={18} aria-hidden="true" />
              {busy === "apply" ? "Opening Wisetack…" : rec.state === "declined" ? "Apply again" : FIN.applyButton}
            </button>
          ) : null}
          {canApply && rec.state === "none" ? (
            <button className={styles.button} type="button" aria-expanded={linkOpen} onClick={() => setLinkOpen((v) => !v)} data-fin-link-open>
              <Link2 size={18} aria-hidden="true" />
              {FIN.linkButton}
            </button>
          ) : null}
          {open && rec.applyUrl && d.canManage ? (
            <a className={primary} href={rec.applyUrl} data-fin-finish>
              <ArrowUpRight size={18} aria-hidden="true" />
              Finish on Wisetack
            </a>
          ) : null}
          {rec.state !== "none" && rec.state !== "approved" ? (
            <button className={styles.button} type="button" disabled={busy !== null} onClick={() => void check()} data-fin-check>
              <RefreshCw size={18} aria-hidden="true" />
              {busy === "check" ? "Checking…" : "Check again"}
            </button>
          ) : null}
        </div>

        {linkOpen && canApply ? (
          <div className={layout.keyForm} data-fin-link>
            <p>Type the email on your Wisetack account. JobFlex links it — no second application.</p>
            <input type="email" value={email} placeholder="you@company.com" aria-label="Wisetack account email" onChange={(e) => setEmail(e.target.value)} style={{ width: "100%" }} />
            <div className={styles.actions}>
              <button className={primary} type="button" disabled={busy !== null || !email.trim()} onClick={() => void link()} data-fin-link-go>
                {busy === "link" ? "Linking…" : "Link my Wisetack account"}
              </button>
            </div>
          </div>
        ) : null}

        {!d.canManage ? <p>Only the owner or a manager can set up financing.</p> : null}
        {err ? (
          <p className={styles.error} role="alert">
            {err}
          </p>
        ) : null}
      </div>

      {rec.state === "approved" ? (
        <div className={layout.section}>
          <h3 className={layout.sectionTitle}>Monthly payments on proposals</h3>
          <div className={layout.toggleRow}>
            <div>
              <strong>{FIN.defaultSwitch}</strong>
              <p>Each proposal has its own switch too.</p>
            </div>
            <Toggle
              checked={rec.offerByDefault}
              ariaLabel={FIN.defaultSwitch}
              onChange={(next) => {
                if (!d.canManage) return;
                setRec((r) => ({ ...r, offerByDefault: next }));
                void setFinancingDefault(next).catch((error) => {
                  setRec((r) => ({ ...r, offerByDefault: !next }));
                  setErr(actionError(error));
                });
              }}
            />
          </div>
          {rec.prequalUrl ? (
            <div data-fin-prequal>
              <p className={styles.label}>Your “check your rate” link — for your website, ads and emails</p>
              <CopyBox value={rec.prequalUrl} />
            </div>
          ) : null}
          {d.deskAnswer === "ours" ? <p data-fin-desk>Your AI desk tells callers you offer monthly payments through Wisetack.</p> : null}
          <p style={{ fontSize: 12, opacity: 0.75 }}>{FIN.disclosure}</p>
        </div>
      ) : null}
    </section>
  );
}
