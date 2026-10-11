"use client";

// Estimator picker — the "New Estimate" dialog.
//
// VERBATIM PORT of `jobflex-estimator-picker-blueprint (10).html`. The mockup's
// own sidebar, topbar, `.content` wrapper and the whole Overview page under the
// dialog were DROPPED, not forked: this component mounts inside blueprint-shell
// (and inside MobileNav on handheld), both of which already render that chrome.
// See estimators-global.css for the full drop list and the shell-vs-source
// token check. Only the `.estp*` block, and the four document-level rules that
// reach into it, were carried across.
//
// Mounted ONCE in each shell, beside the command palette, for the same
// reason: it is reachable from the topbar on every page, so it belongs to the
// chrome rather than to any one route. It opens on the `jf:estimator-picker`
// document event, which is the pattern the ⌘K palette already established —
// the topbar button stays a dumb dispatcher and does not have to own state or
// reach across the tree for it.
//
// It replaced a /dashboard/estimators PAGE and its sidebar item. Choosing an
// engine is a decision you make on the way to somewhere, not a destination you
// navigate to and look at, so it costs a click from wherever you already are
// instead of a page load and a trip back.
//
// Styling lives in estimators-global.css, NOT in estimators.module.css: this
// renders outside `.content`, and the module's `.bp` class is only applied
// while an /dashboard/estimators* route is on screen. A dialog reachable from
// every page cannot depend on one page's stylesheet being active.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { canOpen } from "@/components/v3/blueprint-shell/nav-map";
import { useNavLocked, useNavRole, useNavView } from "@/components/v3/blueprint-shell/nav-role";
import { clearFiling, writeFiling, type Filing } from "@/lib/filingCookie";
import { ENGINES, QUEUED_COUNT, type Engine, type EngineDiagram } from "./estimators-data";

// Split once at module scope — the roster is a constant, so there is nothing
// for the component to recompute on a render or memoise.
const active = ENGINES.filter((e) => e.status === "active");
const queued = ENGINES.filter((e) => e.status === "queued");
/* THE DECK STUDIO (2026-10-11, lib/editions): a live engine for an account that holds the edition — the sidebar's
   unlocked rows say so — and, for every other account, the queued stub becomes the way to add it. */
const DECK_ENGINE: Extract<Engine, { status: "active" }> = { id: "deck", no: "05", title: "Deck Studio", method: "3D on the house photo", diagram: "sheet", status: "active", href: "/dashboard/deck-estimator", spec: { input: "size · photo · state", output: "3D · permit set · proposal" } };
const DECK_ADD_HREF = "/dashboard/upgrade?edition=deck";

/** The drawing this engine makes, on the card's blueprint-blue graph paper.
    Straight from the source's DIA map — same viewBox, same path data, same
    `ln` / `bp` / `dim` line weights, same annotation text. */
function Diagram({ kind }: { kind: EngineDiagram }) {
  return (
    <svg className="estp-dia" viewBox="0 0 164 72" aria-hidden="true">
      {/* ROOF PLAN — вид сверху: контур, ridge, хипы 45°, стрелки уклона 4:12, размер, north arrow */}
      {kind === "roof" && (
        <>
          <rect className="ln" x="34" y="14" width="96" height="44" />
          <path className="ln" d="M62 36 H102" />
          <path className="ln" d="M34 14 L62 36 M34 58 L62 36 M130 14 L102 36 M130 58 L102 36" />
          <path className="bp" d="M82 32 V20 M79 23 L82 20 L85 23" />
          <path className="bp" d="M82 40 V52 M79 49 L82 52 L85 49" />
          <text x="88" y="26">4:12</text>
          <path className="dim" d="M34 66 H130 M34 63 V69 M130 63 V69" />
          <text x="82" y="64" textAnchor="middle">{'38\'-0"'}</text>
          <circle className="bp" cx="148" cy="21" r="7" />
          <path className="bp" d="M148 26 V16 M145 19 L148 16 L151 19" />
          <text x="148" y="38" textAnchor="middle">N</text>
        </>
      )}
      {/* FENCE ELEVATION — столбы с кэпами, рейки, пикеты (прорисованы и осями), грунт со штриховкой, размеры */}
      {kind === "fence" && (
        <>
          <path className="ln" d="M10 56 H154" />
          <path
            className="dim"
            d="M18 56 l-5 6 M32 56 l-5 6 M46 56 l-5 6 M60 56 l-5 6 M74 56 l-5 6 M88 56 l-5 6 M102 56 l-5 6 M116 56 l-5 6 M130 56 l-5 6 M144 56 l-5 6"
          />
          <rect className="ln" x="22" y="20" width="4" height="36" />
          <rect className="ln" x="74" y="20" width="4" height="36" />
          <rect className="ln" x="126" y="20" width="4" height="36" />
          <path
            className="ln"
            d="M20 20 L30 20 L28 15 L22 15 Z M72 20 L82 20 L80 15 L74 15 Z M124 20 L134 20 L132 15 L126 15 Z"
          />
          <path className="ln" d="M26 27 H74 M26 49 H74 M78 27 H126 M78 49 H126" />
          <path className="ln" d="M32 52 V23 M40 52 V23 M48 52 V23 M56 52 V23 M64 52 V23" />
          <path className="bp" d="M88 52 V23 M102 52 V23 M116 52 V23" strokeDasharray="3 3" />
          <path className="dim" d="M140 20 V56 M137 20 H143 M137 56 H143" />
          <text x="146" y="40">{'6\'-0"'}</text>
          <path className="dim" d="M24 10 H76 M24 7 V13 M76 7 V13" />
          <text x="50" y="8" textAnchor="middle">{'8\'-0" O.C.'}</text>
        </>
      )}
      {/* DETAIL — секция стена/фундамент, штриховка бетона, выноски-кружки 1·2·3 (= line items) */}
      {kind === "sheet" && (
        <>
          <rect className="ln" x="28" y="40" width="50" height="20" />
          <path className="dim" d="M31 58 L47 42 M41 58 L57 42 M51 58 L67 42 M61 58 L76 43" />
          <path className="ln" d="M42 40 V12 M52 40 V12" />
          <path className="bp" d="M39 12 L55 8" />
          <circle className="bp" cx="100" cy="16" r="8" />
          <text x="100" y="19" textAnchor="middle">1</text>
          <path className="dim" d="M92 18 L54 22" />
          <circle className="bp" cx="116" cy="38" r="8" />
          <text x="116" y="41" textAnchor="middle">2</text>
          <path className="dim" d="M108 40 L78 46" />
          <circle className="bp" cx="100" cy="60" r="8" />
          <text x="100" y="63" textAnchor="middle">3</text>
          <path className="dim" d="M92 60 L66 56" />
          <text x="132" y="62">DETAIL 3</text>
        </>
      )}
      {/* HOUSE ELEVATION — фасад: фронтон, труба, дверь, окна с переплётами, грунт со штриховкой */}
      {kind === "prose" && (
        <>
          <path className="ln" d="M14 60 H150" />
          <path
            className="dim"
            d="M22 60 l-5 6 M38 60 l-5 6 M54 60 l-5 6 M70 60 l-5 6 M86 60 l-5 6 M102 60 l-5 6 M118 60 l-5 6 M134 60 l-5 6 M148 60 l-5 6"
          />
          <rect className="ln" x="40" y="30" width="84" height="30" />
          <path className="ln" d="M34 30 L82 8 L130 30 Z" />
          <path className="ln" d="M100 14 V6 H108 V10" />
          <rect className="ln" x="74" y="40" width="16" height="20" />
          <circle className="bp" cx="87" cy="51" r="1.4" />
          <rect className="ln" x="48" y="38" width="14" height="12" />
          <path className="bp" d="M55 38 V50 M48 44 H62" />
          <rect className="ln" x="102" y="38" width="14" height="12" />
          <path className="bp" d="M109 38 V50 M102 44 H116" />
          <path className="bp" d="M40 34 H124" strokeDasharray="4 3" />
          <text x="140" y="12" textAnchor="end">A-201</text>
        </>
      )}
      {/* WALKTHROUGH PLAN — камера, пунктирная траектория обхода, четыре точки
          съёмки с выносками на объект, таймкод и размер. Drawn in the same
          language as the four above (same viewBox, same ln / bp / dim weights,
          same annotation type); this engine has no donor card, so the plate is
          new work rather than ported path data. */}
      {kind === "video" && (
        <>
          <path className="ln" d="M14 56 H150" />
          <rect className="ln" x="10" y="20" width="13" height="11" />
          <path className="ln" d="M23 23 L30 19 V32 L23 28 Z" />
          <path className="bp" d="M34 26 H142" strokeDasharray="4 3" />
          <rect className="bp" x="44" y="23" width="6" height="6" />
          <rect className="bp" x="74" y="23" width="6" height="6" />
          <rect className="bp" x="104" y="23" width="6" height="6" />
          <rect className="bp" x="132" y="23" width="6" height="6" />
          <path
            className="dim"
            d="M47 29 V56 M77 29 V56 M107 29 V56 M135 29 V56"
            strokeDasharray="3 3"
          />
          <text x="44" y="16">04:12</text>
          <path className="dim" d="M14 66 H150 M14 63 V69 M150 63 V69" />
          <text x="82" y="64" textAnchor="middle">{'128\'-0"'}</text>
        </>
      )}
      {/* HVAC — a house section: the outdoor unit on its pad at left, the
          line set into the air handler, a supply trunk with three registers,
          and the design-temperature annotation. Same language as the plates
          above; no donor card exists for this engine either. */}
      {kind === "hvac" && (
        <>
          <path className="ln" d="M14 56 H150" />
          <rect className="ln" x="14" y="38" width="20" height="18" />
          <path className="ln" d="M18 42 H30 M18 46 H30 M18 50 H30" />
          <path className="ln" d="M56 56 V22 L100 10 L144 22 V56" />
          <rect className="bp" x="66" y="36" width="14" height="20" />
          <path className="bp" d="M34 47 H66" strokeDasharray="4 3" />
          <path className="bp" d="M80 40 H134" />
          <rect className="bp" x="92" y="40" width="7" height="4" />
          <rect className="bp" x="110" y="40" width="7" height="4" />
          <rect className="bp" x="127" y="40" width="7" height="4" />
          <text x="86" y="32" textAnchor="middle">3.0 T</text>
          <path className="dim" d="M14 66 H150 M14 63 V69 M150 63 V69" />
          <text x="82" y="64" textAnchor="middle">99°F / 28°F</text>
        </>
      )}
    </svg>
  );
}

/** Exit duration — the source's `reduce ? 0 : 190`. */
const EXIT_MS = 190;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function EstimatorPicker() {
  const router = useRouter();
  // The engines this role can actually open. Both topbars already hide their
  // New Estimate button when this comes back empty, so in practice the dialog
  // never opens on nothing — but the filter lives HERE as well, because the
  // dialog is also opened from a client record's own "New proposal" button, and
  // a card that routes somewhere the gate bounces is worse than an absent one.
  const role = useNavRole();
  const locked = useNavLocked();
  const view = useNavView();
  const deckOpen = view.unlocked.includes("/dashboard/deck-estimator");
  const openEngines = useMemo(
    () => [...active.filter((engine) => canOpen(role, engine.href, locked)), ...(deckOpen && canOpen(role, DECK_ENGINE.href, locked) ? [DECK_ENGINE] : [])],
    [role, locked, deckOpen],
  );
  // Two flags because the source has two classes. `open` drives the `hidden`
  // attribute (`.estp[hidden] { display: none }`); `on` is added a frame later
  // so the enter transition has a start state to leave from — the source's
  // double-requestAnimationFrame, kept.
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Set when the dialog is opened FROM a client's record, cleared otherwise.
  // The topbar's New Estimate button opens the picker with no client, and a
  // client id left over from a previous open would silently attach the wrong
  // homeowner to the next estimate anybody started from anywhere in the app.
  // Since 2026-09-18 a project can ride along too ("New proposal" on a project
  // page): whichever engine is chosen files its proposal there.
  const [filing, setFiling] = useState<Filing | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Whatever had focus when the dialog opened — almost always the topbar's
  // New Estimate button. Focus goes back there on close, so dismissing does not
  // dump the user at the top of the document.
  const returnRef = useRef<HTMLElement | null>(null);
  const exitTimer = useRef<number | null>(null);

  const close = useCallback(() => {
    setLeaving(true);
    setOn(false);
    if (exitTimer.current) window.clearTimeout(exitTimer.current);
    exitTimer.current = window.setTimeout(
      () => {
        setOpen(false);
        setLeaving(false);
        returnRef.current?.focus();
        returnRef.current = null;
      },
      prefersReducedMotion() ? 0 : EXIT_MS,
    );
  }, []);

  useEffect(() => {
    function onOpen(e: Event) {
      returnRef.current = document.activeElement as HTMLElement | null;
      if (exitTimer.current) window.clearTimeout(exitTimer.current);
      // The detail is optional and read defensively: the topbar dispatches a
      // plain Event, a client record or a project a CustomEvent.
      const detail = (e as CustomEvent<Filing | undefined>).detail;
      setFiling(detail && (detail.clientId || detail.projectId) ? detail : null);
      setLeaving(false);
      setOpen(true);
    }
    document.addEventListener("jf:estimator-picker", onOpen);
    return () => document.removeEventListener("jf:estimator-picker", onOpen);
  }, []);

  // The source's rAF(rAF(add .on; focus first card)).
  useEffect(() => {
    if (!open || leaving) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        setOn(true);
        boxRef.current?.querySelector<HTMLButtonElement>(".estp-card")?.focus();
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
  }, [open, leaving]);

  useEffect(() => {
    if (!open || leaving) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Not in the source, which has no competing handler. Kept because the
        // handheld shell binds its own Escape for the nav drawer, and one key
        // press should not dismiss two things.
        e.stopPropagation();
        close();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, leaving, close]);

  useEffect(
    () => () => {
      if (exitTimer.current) window.clearTimeout(exitTimer.current);
    },
    [],
  );

  function choose(href: string) {
    // The client and the project ride through to whichever engine was picked.
    // Which engine it is does not matter and is not this dialog's business —
    // the user chose an ENGINE, they had already chosen WHERE by starting from
    // a client's record or a project, and an estimate that forgot that is how a
    // finished proposal ends up saved against nobody.
    //
    // Two carriers, because the engines differ (2026-09-18): the manual builder
    // reads `?client=` / `?project=`; the estimators read neither (several are
    // mounted with no props on a phone), so the choice is also written to the
    // filing cookie, which their convert actions read on the server
    // (lib/filingContext) and a chip on their page shows. Opened with no
    // context — the topbar's New Estimate — any earlier filing is dropped, so
    // a fresh estimate never lands in a project nobody chose for it.
    if (filing) writeFiling(filing);
    else clearFiling();
    const q = new URLSearchParams();
    if (filing?.clientId) q.set("client", filing.clientId);
    if (filing?.projectId) q.set("project", filing.projectId);
    const to = q.size ? `${href}?${q.toString()}` : href;
    // Navigate first, then play the exit: the dialog is leaving either way, and
    // waiting 190ms before routing makes the click feel sticky.
    router.push(to as Route);
    close();
  }

  return (
    <div
      className={["estp", on ? "on" : "", leaving ? "leaving" : ""].filter(Boolean).join(" ")}
      data-nest=""
      hidden={!open}
      role="dialog"
      aria-modal="true"
      aria-labelledby="estpTitle"
    >
      <div className="estp-bg" onClick={close} />

      <div className="estp-box" ref={boxRef}>
        <div className="estp-head">
          <div className="estp-title" id="estpTitle">
            New estimate
          </div>
          <span className="estp-kick">
            {filing?.projectName || filing?.clientName ? (
              <>
                Files under <b>{filing.projectName ?? filing.clientName}</b>
                {filing.projectName && filing.clientName ? <> &middot; {filing.clientName}</> : null}
              </>
            ) : (
              <>
                {openEngines.length} active &middot; {QUEUED_COUNT} queued
              </>
            )}
          </span>
          <button className="estp-x" type="button" aria-label="Close" onClick={close}>
            <svg className="ic">
              <use href="#i-x" />
            </svg>
          </button>
        </div>

        {/* Two blocks, not one: the live engines sit in a two-column catalogue
            at full card weight, and the queued trades run underneath as a thin
            strip of dashed stubs. A single grid would have stretched the stubs
            to card height and given three unbuildable trades the same visual
            footprint as the ones you can actually start.
            (Was a fixed 2×2 until Video made five; an odd last card takes the
            full width — see .estp-grid in estimators-global.css.) */}
        <div className="estp-grid">
          {openEngines.map((engine) => (
            <button
              key={engine.id}
              type="button"
              className="estp-card"
              onClick={() => choose(engine.href)}
            >
              <span className="estp-dia-cell">
                <Diagram kind={engine.diagram} />
              </span>
              <span className="estp-nameline">
                <span className="estp-nm">
                  <span className="estp-name">{engine.title}</span>
                  <span className="estp-method">{engine.method}</span>
                </span>
              </span>
            </button>
          ))}
        </div>

        {queued.length > 0 && (
          <div className="estp-queue">
            <span className="estp-queue-label">In the queue</span>
            {queued
              .filter((engine) => !(deckOpen && engine.id === "deck"))
              .map((engine) =>
                engine.id === "deck" ? (
                  <a key={engine.id} className="estp-stub estp-stub--add" href={DECK_ADD_HREF} data-deck-add onClick={() => close()}>
                    <i>{engine.no}</i>
                    Deck Studio · add it
                  </a>
                ) : (
                  <span key={engine.id} className="estp-stub">
                    <i>{engine.no}</i>
                    {engine.title}
                  </span>
                ),
              )}
          </div>
        )}
      </div>
    </div>
  );
}
