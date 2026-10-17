"use client";

// Settings → Estimating (2026-10-16): the company's own estimating method — one switch (OFF until the company turns
// it on) and the numbers Smart Proposal and the video estimator then price by (lib/estimate/companyPricing). The same
// piece sits in the desk pane and the phone pane, so it carries its own styles. Saves by itself, like the rest of
// Settings.

import { useEffect, useId, useRef, useState } from "react";
import type { Ref } from "react";

import { loadCompanyPricing, saveCompanyPricing } from "@/actions/companyPricing";
import {
  cleanCompanyPricing,
  overheadProfitFactor,
  pricingWords,
  type CompanyPricing,
  type LaborBasis,
  type TaxMode,
} from "@/lib/estimate/companyPricing";
import styles from "./company-pricing-form.module.css";

type Draft = {
  on: boolean;
  laborBasis: LaborBasis;
  crewSize: string;
  laborRate: string;
  materialMarkupPct: string;
  overheadPct: string;
  profitPct: string;
  taxMode: TaxMode;
  taxRatePct: string;
};

const str = (n: number) => (n ? String(n) : "");

function toDraft(p: CompanyPricing): Draft {
  return {
    on: p.on,
    laborBasis: p.laborBasis,
    crewSize: String(p.crewSize),
    laborRate: str(p.laborRate),
    materialMarkupPct: str(p.materialMarkupPct),
    overheadPct: str(p.overheadPct),
    profitPct: str(p.profitPct),
    taxMode: p.taxMode,
    taxRatePct: p.taxRatePct == null ? "" : String(p.taxRatePct),
  };
}

const rateOf = (d: Draft) => Number(d.laborRate) || 0;

/** What is saved: the switch only counts once a rate is in — "on" with no rate would price nothing. */
function fromDraft(d: Draft): CompanyPricing {
  return cleanCompanyPricing({ ...d, on: d.on && rateOf(d) > 0 });
}

/** Digits and one point — a rate or a percent, never a minus or a letter. */
const decimal = (v: string) => {
  const clean = v.replace(/[^\d.]/g, "");
  const dot = clean.indexOf(".");
  return dot < 0 ? clean : clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, "");
};

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

type SaveState = "idle" | "saving" | "saved" | "error";

export function CompanyPricingForm() {
  const uid = useId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  /** The settings last known to be on the server, as saved. */
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>("idle");
  const [err, setErr] = useState("");
  const seq = useRef(0);
  const pending = useRef<string | null>(null);
  const rateRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let live = true;
    loadCompanyPricing()
      .then((r) => {
        if (!live) return;
        setDraft(toDraft(r.pricing));
        setSavedKey(JSON.stringify(r.pricing));
        setCanEdit(r.canEdit);
      })
      .catch(() => {
        if (live) setLoadErr("Couldn't load your estimating settings. Refresh the page to try again.");
      });
    return () => {
      live = false;
    };
  }, []);

  const next = draft ? fromDraft(draft) : null;
  const nextKey = next ? JSON.stringify(next) : null;

  // Autosave a beat after the last edit; one answer at a time counts (the newest).
  useEffect(() => {
    if (!canEdit || !nextKey || nextKey === savedKey) return;
    const t = window.setTimeout(() => {
      const mine = ++seq.current;
      setState("saving");
      setErr("");
      saveCompanyPricing(JSON.parse(nextKey))
        .then((r) => {
          if (mine !== seq.current) return;
          if (r.ok) {
            setSavedKey(JSON.stringify(r.pricing));
            setState("saved");
          } else {
            setState("error");
            setErr(r.error);
          }
        })
        .catch(() => {
          if (mine !== seq.current) return;
          setState("error");
          setErr("Couldn't save just now. Check your connection and try again.");
        });
    }, 800);
    return () => window.clearTimeout(t);
  }, [nextKey, savedKey, canEdit]);

  // An edit still waiting when the tab is hidden goes out then.
  useEffect(() => {
    pending.current = canEdit && nextKey && nextKey !== savedKey ? nextKey : null;
  });
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && pending.current) void saveCompanyPricing(JSON.parse(pending.current));
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  if (loadErr) return <p className={`${styles.note} ${styles.isErr}`}>{loadErr}</p>;
  if (!draft || !next) return <p className={styles.note}>Loading your estimating settings…</p>;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const rate = rateOf(draft);
  const waitingForRate = draft.on && rate <= 0;
  const crew = draft.laborBasis === "crew";
  const crewSize = next.crewSize;
  const factor = overheadProfitFactor(next);
  const hourWord = crew ? "crew-hour" : "person-hour";
  const exHours = crew ? 6 : 6 * Math.max(2, crewSize);
  const exPeople = crew ? crewSize : Math.max(2, crewSize);
  const exLabor = exHours * rate * factor;

  const status = !canEdit
    ? "Only an owner or manager can change this."
    : waitingForRate
      ? "Enter your labor rate — this turns on once the rate is in."
      : state === "saving"
        ? "Saving…"
        : state === "saved"
          ? "Saved"
          : state === "error"
            ? err
            : "Saves automatically";
  const statusTone = waitingForRate ? styles.isWarn : state === "error" ? styles.isErr : state === "saved" ? styles.isOk : "";

  const num = (k: "crewSize" | "laborRate" | "materialMarkupPct" | "overheadPct" | "profitPct" | "taxRatePct", label: string, opts: { prefix?: string; suffix?: string; placeholder?: string; hint?: string; ref?: Ref<HTMLInputElement>; whole?: boolean; flag?: boolean } = {}) => (
    <label className={styles.fld} data-cp-field={k}>
      <span className={styles.lbl}>{label}</span>
      <span className={`${styles.box} ${opts.flag ? styles.isFlag : ""}`}>
        {opts.prefix ? <i className={styles.affix}>{opts.prefix}</i> : null}
        <input
          ref={opts.ref}
          className={styles.in}
          type="text"
          inputMode={opts.whole ? "numeric" : "decimal"}
          value={draft[k]}
          placeholder={opts.placeholder ?? "0"}
          disabled={!canEdit}
          onChange={(e) => set(k, opts.whole ? e.target.value.replace(/\D/g, "").slice(0, 2) : decimal(e.target.value).slice(0, 8))}
        />
        {opts.suffix ? <i className={styles.affix}>{opts.suffix}</i> : null}
      </span>
      {opts.hint ? <span className={styles.hint}>{opts.hint}</span> : null}
    </label>
  );

  const seg = <V extends string>(k: "laborBasis" | "taxMode", label: string, options: Array<{ v: V; t: string; d: string }>) => (
    <div className={styles.fld}>
      <span className={styles.lbl} id={`${uid}-${k}`}>{label}</span>
      <div className={styles.seg} role="radiogroup" aria-labelledby={`${uid}-${k}`} data-cp-seg={k}>
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={draft[k] === o.v}
            className={styles.segBtn}
            disabled={!canEdit}
            onClick={() => set(k, o.v as Draft[typeof k])}
          >
            <b>{o.t}</b>
            <span>{o.d}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className={styles.form} data-company-pricing data-on={next.on ? "1" : "0"}>
      <div className={styles.switchRow}>
        <div className={styles.switchTxt}>
          <b>Price estimates my company&rsquo;s way</b>
          <span>
            {draft.on
              ? "New Smart Proposal and video estimates use your labor rate, markup and tax rule below."
              : "Off — estimates use JobFlex's price book and the markup set on your proposals."}
          </span>
        </div>
        <button
          className={styles.tg}
          type="button"
          role="switch"
          aria-checked={draft.on}
          aria-label="Price estimates my company's way"
          disabled={!canEdit}
          data-cp-switch
          onClick={() => {
            const on = !draft.on;
            set("on", on);
            if (on && rate <= 0) window.setTimeout(() => rateRef.current?.focus(), 0);
          }}
        />
      </div>

      <div className={`${styles.body} ${draft.on ? "" : styles.isOff}`}>
        <section className={styles.group}>
          <h4 className={styles.gh}>Labor</h4>
          {seg<LaborBasis>("laborBasis", "Labor is charged", [
            { v: "crew", t: "Per crew-hour", d: "One rate for the whole crew" },
            { v: "person", t: "Per person-hour", d: "A rate for each worker" },
          ])}
          <div className={styles.grid}>
            {num("crewSize", "People on a crew", { whole: true, placeholder: "2" })}
            {num("laborRate", `Labor rate per ${hourWord}`, {
              prefix: "$",
              ref: rateRef,
              placeholder: crew ? "220" : "110",
              flag: waitingForRate,
            })}
          </div>
          {rate > 0 ? (
            <p className={styles.example} data-cp-example>
              A line that takes {crew ? `6 crew-hours (${exPeople} people × 6 hours)` : `${exHours} person-hours (${exPeople} people × 6 hours)`} ={" "}
              {exHours} × {money(rate)}
              {factor !== 1 ? " + overhead and profit" : ""} = <b>{money(exLabor)}</b> labor.
            </p>
          ) : null}
        </section>

        <section className={styles.group}>
          <h4 className={styles.gh}>Materials and margin</h4>
          <div className={styles.grid3}>
            {num("materialMarkupPct", "Materials markup", { suffix: "%" })}
            {num("overheadPct", "Overhead", { suffix: "%" })}
            {num("profitPct", "Profit", { suffix: "%" })}
          </div>
          <p className={styles.hint}>Leave overhead and profit at 0 when your labor rate already covers them. A permit fee is passed through at cost.</p>
        </section>

        <section className={styles.group}>
          <h4 className={styles.gh}>Sales tax</h4>
          {seg<TaxMode>("taxMode", "Charge sales tax", [
            { v: "job", t: "On the whole job", d: "Materials and labor" },
            { v: "materials", t: "On materials only", d: "Labor is not taxed" },
            { v: "none", t: "No sales tax", d: "Nothing is added" },
          ])}
          {draft.taxMode !== "none" ? (
            <div className={styles.grid}>
              {num("taxRatePct", "Tax rate", {
                suffix: "%",
                placeholder: "Job's state rate",
                hint: "Leave blank to use the base rate of the state the job is in.",
              })}
            </div>
          ) : null}
        </section>

        {rate > 0 ? (
          <p className={styles.preview} data-cp-preview>
            <span>Each estimate will say</span>
            Priced your company&rsquo;s way: {pricingWords(next)}.
          </p>
        ) : null}
        <p className={styles.hint}>
          Used by Smart Proposal and the video estimator. Proposals you build by hand, and the roof, fence, HVAC, deck
          and blueprint estimators, keep their own pricing.
        </p>
      </div>

      <p className={`${styles.status} ${statusTone}`} role="status" aria-live="polite" data-cp-status>
        {status}
      </p>
    </div>
  );
}
