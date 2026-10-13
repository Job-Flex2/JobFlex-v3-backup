"use client";

// THE PLAN STEP ON A PHONE (owner, 2026-10-12). The swiped row of full cards
// showed one plan at a time; at ≤768px register-content mounts these instead:
//
//   PlanTiles  — every plan at once, a 2×2 grid of compact tiles (three plans:
//                two over one full-width). A tile is the choice: name, "Most
//                picked", the price on the switch's term, the year's stamp and
//                saving (or "Billed monthly"). No list, no button in a tile;
//                the whole tile is the target. Each term's lines keep one box,
//                so no tile changes height on the switch.
//   PlanDetail — the chosen plan whole under the tiles: "Free until …", its
//                full list (ticks and dashes, as the cards), and the custom
//                plan's page picker.
//   PlanBar    — one start button pinned to the bottom edge, the chosen plan
//                and term under it, the step's error over it. It steps aside
//                while a field has the keyboard, and the sheet keeps its
//                height as room at the bottom so it never covers the terms.
//
// Selection, prices, the code and every start path stay register-content's;
// these draw them. The desk keeps its cards (exactly one tree mounts).
import * as React from "react";
import { PlanCardHead, PlanDealSlot, PlanPrice } from "@/components/billing/PlanTermSwitch";
import { annualDeal, planTerm, savedYearWords, type BillingTerm } from "@/lib/planDeal";
import s from "./plan-phone.module.css";

export interface PhoneTile {
  slug: string;
  name: string;
  monthlyCents: number;
  yearlyCents: number | null | undefined;
  /** The recommended plan's blue offset (the cards' `pw-plan--hero`). */
  hero: boolean;
  /** "Most picked", on the tile's top edge. */
  tag: string | null;
  /** The custom plan before any page is ticked: its price is a floor. */
  from?: boolean;
  /** What a code does to this price, on its own line ("$95 $76/mo"). */
  code?: React.ReactNode;
}

export function PlanTiles({ tiles, term, selected, onPick }: { tiles: PhoneTile[]; term: BillingTerm; selected: string | null; onPick: (slug: string) => void }) {
  const odd = tiles.length % 2 === 1;
  const withCode = tiles.some((t) => t.code);
  return (
    <div className={s.tiles} role="group" aria-label="Plans" data-plan-tiles={tiles.length}>
      {tiles.map((t, i) => {
        const on = selected === t.slug;
        // The year's saving lies under the live line unpainted, so the slot is as tall
        // on Monthly as on Annual (it wraps to two lines in a half-width tile).
        const saving = t.yearlyCents ? savedYearWords(annualDeal(t.monthlyCents, t.yearlyCents)) : "";
        return (
          <div
            key={t.slug}
            role="button"
            tabIndex={0}
            aria-pressed={on}
            className={s.tile}
            data-on={on || undefined}
            data-hero={t.hero || undefined}
            data-wide={odd && i === tiles.length - 1 ? true : undefined}
            data-plan-card={t.slug}
            data-monthly-cents={t.monthlyCents}
            data-yearly-cents={t.yearlyCents ?? undefined}
            onClick={() => onPick(t.slug)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick(t.slug);
              }
            }}
          >
            {t.tag ? <span className={s.tag}>{t.tag}</span> : null}
            <PlanCardHead className={s.head} term={term} monthlyCents={t.monthlyCents} yearlyCents={t.yearlyCents} name={<span className={s.name}>{t.name}</span>} />
            <PlanPrice
              term={term}
              monthlyCents={t.monthlyCents}
              yearlyCents={t.yearlyCents}
              figureClassName={s.price}
              figure={(num, per) => (
                <>
                  {t.from ? <small>from </small> : null}
                  {num}
                  <i>{per}</i>
                </>
              )}
            />
            <span className={s.deal}>
              <PlanDealSlot term={term} monthlyCents={t.monthlyCents} yearlyCents={t.yearlyCents} />
              {saving ? (
                <span className={s.dealGhost} aria-hidden="true">
                  <span className="jf-ghost-t" data-c={saving} />
                </span>
              ) : null}
            </span>
            {withCode ? <span className={s.code}>{t.code ?? null}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

export interface DetailRow {
  label: string;
  on: boolean;
  /** The custom plan's "Add pages · $10 each" line. */
  add?: boolean;
}

export function PlanDetail({ slug, when, rows, onSelectPages }: { slug: string; when: string | null; rows: DetailRow[]; onSelectPages?: () => void }) {
  return (
    <div className={s.detail} data-plan-detail={slug}>
      {when ? <p className={s.when}>{when}</p> : null}
      <span className={`pw-feats ${s.feats}`} data-plan-feats>
        {rows.map((r) => (
          <span key={r.label} className={r.add ? "pw-f pw-f--add" : r.on ? "pw-f" : "pw-f pw-f--no"}>
            <svg className="ic" aria-hidden="true">
              <use href={r.add ? "#i-plus" : r.on ? "#i-check" : "#i-minus"} />
            </svg>
            {r.label}
          </span>
        ))}
      </span>
      {onSelectPages ? (
        <button type="button" className={`pw-edit ${s.pages}`} onClick={onSelectPages}>
          Select pages
        </button>
      ) : null}
    </div>
  );
}

export function PlanBar({
  label,
  sub,
  error,
  busy,
  disabled,
  onStart,
}: {
  label: string;
  sub: React.ReactNode;
  error: string | null;
  busy: boolean;
  disabled: boolean;
  onStart: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [typing, setTyping] = React.useState(false);

  /* Room at the bottom of the sheet for the bar, so the terms and the last row
     scroll clear of it. */
  React.useEffect(() => {
    const bar = ref.current;
    const sheet = bar?.closest<HTMLElement>(".plan-sheet-in");
    if (!bar || !sheet) return;
    const fit = () => sheet.style.setProperty("padding-bottom", `${Math.ceil(bar.getBoundingClientRect().height) + 20}px`);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      sheet.style.removeProperty("padding-bottom");
    };
  }, []);

  /* A field with the keyboard (the code): the bar steps aside, and the field
     is kept in sight as the keyboard takes the screen. */
  React.useEffect(() => {
    const field = (e: EventTarget | null) => e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement;
    const on = (e: FocusEvent) => setTyping(field(e.target));
    const off = () => window.setTimeout(() => setTyping(field(document.activeElement)), 0);
    const vv = window.visualViewport;
    const keep = () => {
      const el = document.activeElement;
      if (field(el)) (el as HTMLElement).scrollIntoView({ block: "center" });
    };
    document.addEventListener("focusin", on);
    document.addEventListener("focusout", off);
    vv?.addEventListener("resize", keep);
    return () => {
      document.removeEventListener("focusin", on);
      document.removeEventListener("focusout", off);
      vv?.removeEventListener("resize", keep);
    };
  }, []);

  return (
    <div ref={ref} className={s.bar} data-plan-bar data-typing={typing || undefined}>
      {error ? (
        <p className={s.barErr} role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" className={"btn pw-go " + s.go + (busy ? " is-busy" : "")} aria-busy={busy || undefined} disabled={disabled} onClick={onStart} data-plan-go>
        {label}
      </button>
      <p className={s.sub} data-plan-sub>
        {sub}
      </p>
    </div>
  );
}

/** The term a tile bills on: the switch's, or the month for a plan with no year. */
export const tileTerm = (term: BillingTerm, t: Pick<PhoneTile, "yearlyCents">) => planTerm(term, t.yearlyCents);
