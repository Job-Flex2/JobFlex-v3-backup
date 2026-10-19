"use client";

// MANUAL PROPOSAL / BLUEPRINT — card 11, "The PDF".
//
// Card 10 is the client's copy as a SCREEN. This is the same proposal as a
// DOCUMENT: a real sheet of paper at true trim size, with the structure a
// contract needs and a screen does not — numbered sections, a letterhead that
// repeats, a footer that identifies the sheet if a page is separated from the
// rest, and an acceptance block at the end.
//
// ── THE PREVIEW IS HTML, THE FILE IS A FILE ──────────────────
// The sheet below is the on-screen preview (and what Ctrl+P prints). Download
// PDF does not print it: it builds a real .pdf from the same props with
// react-pdf (bp-pdf-file.tsx), because printing lets the browser add its own
// date, tab title, URL and "2/7" to the paper — on an iPhone with no way to
// turn them off. What the two share — which sections, in which order, under
// which numbers, the one date they carry — comes from bp-pdf-plan.ts.
//
// ── THE STRUCTURE, AND WHY IT IS IN THIS ORDER ───────────────
// A proposal is read in a fixed sequence by someone deciding whether to sign:
// who is this for → what will be done → what it costs → when it is paid → what
// the rules are → sign here. Every section below is one of those questions and
// they appear in that order. Sections are NUMBERED, and the numbers are
// computed rather than typed, because a proposal that omits its scope must not
// print "3. TOTALS" after "1. PREPARED FOR" — a gap in the numbering reads to a
// client as a page that went missing.
//
// Sections are also the atomic unit of pagination: each one carries
// `break-inside: avoid`, so a section that will not fit in what is left of a
// page moves to the next page WHOLE rather than being cut at an arbitrary
// line. The single exception is the one the property makes for itself — a
// section taller than a page cannot be moved anywhere it would fit, so it
// flows, breaking at a row (pricing, payments, attachments) or between lines
// of prose (scope, terms), and never mid-row.
//
// ── WHAT THIS PRINTS THAT CARD 10 DOES NOT ───────────────────
// The payment schedule, the attachment list and the project overview. All three
// exist in the builder (cards 01, 08, 09) and all three are things the client
// is entitled to have in writing. Card 10 is a preview of the PRICE; this is
// the whole agreement. Everything the two DO share is rendered from the same
// classes and the same `totals`, so the figure on the screen and the figure on
// the paper cannot drift.
//
// ── THE HONEST LIMITS ────────────────────────────────────────
// · "≈ N pages" packs the measured blocks under the same rule the print layer
//   gives the browser (a section that does not fit moves whole; one taller
//   than a page flows), so it agrees with the file in every case measured. It
//   keeps the ≈ because the measurement is taken from the PREVIEW, which the
//   shell's fluid-scale zoom lays out at a fraction of 1 while the paper is
//   always at zoom 1 — a line that wraps on screen can hold on the sheet.
// · "Page 1 of 3" exists only in the file. The preview's footer carries the
//   identifiers that survive a separated page (the reference, the client and
//   the expiry); the file adds the page number in its own footer.
// · The sheet carries ONE date, the expiry. The day it was drawn up is the
//   contractor's record, not a term of the offer.

import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/Toast";
import { fileSize, installmentValue, money, pct } from "../manual-focus/manual-focus-math";
// Who is sending this, under what reference and until when are facts about a
// REAL org and a REAL row, so they arrive as `doc.identity`, read on the
// server. See manual-blueprint-bridge.ts.
import {
  FLOWING_SECTIONS,
  MARGIN_IN,
  PAPER,
  fileStem,
  sectionPlan,
  sheetDate,
  unitText,
  type DocProps,
  type SectionKey,
  type PaperSize,
  type PdfSetup,
} from "./bp-pdf-plan";
import type { PdfPalette } from "./bp-pdf-file";
import styles from "./manual-blueprint.module.css";
import { Btn, Segmented, Toggle, ToggleCell, cx } from "./bp-ui";
import { useHandheld } from "./use-handheld";

export { DEFAULT_PDF_SETUP, type PaperSize, type PdfSetup } from "./bp-pdf-plan";

/** CSS px per inch — the preview is laid out in px, the margin is set in inches. */
const PX_IN = 96;

/** The two running bands cost their height on EVERY sheet, not once: they are
 *  a repeating <thead>/<tfoot> (see the note on the document), so the usable
 *  text height of every page is the page box less whichever bands are on.
 *  Measured from the rendered bands at true trim width. */
const RUNHEAD_H = 48;
const RUNFOOT_H = 53;

/* ============================================================
   11 — THE CARD FACE
   A drawing's title block: the four facts about the sheet, ruled
   into four cells, mono, before any control. You should be able
   to answer "what am I about to send?" without opening anything.
   ============================================================ */

/** The zoom ladder, in the order the buttons step through it. Ratios rather
 *  than a linear range: 0.6 → 0.8 → 1 → 1.25… is how every document viewer
 *  steps, because each press should be a visible change at any starting point,
 *  and a fixed +0.1 is a big jump at 0.5 and an invisible one at 2. */
const ZOOM_STOPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 2, 3] as const;
const ZOOM_FIT = 3; // index of 1 — "actual size"

export function PdfBlock({
  setup,
  onPatch,
  doc,
}: {
  setup: PdfSetup;
  onPatch: (patch: Partial<PdfSetup>) => void;
  doc: Omit<DocProps, "setup">;
}) {
  const [open, setOpen] = useState(false);
  const [zoomAt, setZoomAt] = useState(ZOOM_FIT);
  // The card's CHROME has a handheld build; the document, the page estimate,
  // the vault and the print path below are identical on both viewports and
  // stay single-sourced. See ./use-handheld.ts.
  const handheld = useHandheld();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const flowRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // The page estimate measures the REAL flow, at real paper width, whether or
  // not the preview is open — the vault clips the sheet but does not stop it
  // laying out, which is the whole reason it clips instead of unmounting.
  //
  // It measures the BLOCKS, not the total. Dividing one tall column by the
  // page height answers "how much paper is this", which stopped being the
  // question when the sheet started moving whole sections to the next page
  // rather than cutting them: a proposal whose sections happen to land badly
  // is genuinely longer than its own height, and an estimate that cannot see
  // that reads one page short exactly when the contractor is deciding whether
  // to trim something.
  useEffect(() => {
    const el = flowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      // `offsetHeight`, NOT getBoundingClientRect: the overlay scales the sheet
      // with a CSS transform, and a bounding rect is the VISUAL box — at 200%
      // zoom it would report twice the height and the card would claim the
      // proposal had doubled in length. offsetHeight is the layout box, which
      // is what a page count is a function of.
      //
      // The margin above each block is kept SEPARATE from its height, because
      // the two are not worth the same on paper: a margin at the top of a new
      // page is truncated by the fragmenter and costs nothing, which is worth
      // roughly one section's height across a long proposal. It is read from
      // the computed style rather than hard-coded so the stylesheet stays the
      // one place the rhythm is set.
      const next = Array.from(el.children).map((node) => {
        const n = node as HTMLElement;
        return { h: n.offsetHeight, mt: parseFloat(getComputedStyle(n).marginTop) || 0, flow: n.dataset.flow === "" };
      });
      // Read OUTSIDE the updater: a DOM read inside one runs twice under
      // StrictMode.
      setBlocks((prev) =>
        prev.length === next.length && prev.every((v, i) => v.h === next[i].h && v.mt === next[i].mt && v.flow === next[i].flow)
          ? prev
          : next,
      );
    };
    const ro = new ResizeObserver(measure);
    // Every block is watched, not just the flow: the flow's own height changes
    // for a hundred reasons, and what the estimate needs is which BLOCK grew.
    const watch = () => {
      ro.disconnect();
      ro.observe(el);
      Array.from(el.children).forEach((n) => ro.observe(n));
    };
    watch();
    // Sections come and go with the proposal — a section appears the moment
    // terms are typed — and a new child is not a resize of anything already
    // observed, so the list is re-watched when it changes rather than the
    // effect being re-run on every render of a doc object that is new each
    // time regardless of whether the document is.
    const mo = new MutationObserver(watch);
    mo.observe(el, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  // ESCAPE, and the scroll lock. Both belong to the overlay being open and both
  // have to be undone by the same effect that set them — a preview that leaves
  // `overflow: hidden` on the body after it closes has broken the whole page.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    // The close button is the one control that is always present, so it is
    // where focus goes — landing on <body> inside an open dialog is the same
    // bug the client picker fixed on card 01.
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const paper = PAPER[setup.paper];
  const usable =
    paper.h -
    2 * MARGIN_IN * PX_IN -
    (setup.letterhead ? RUNHEAD_H : 0) -
    (setup.footer ? RUNFOOT_H : 0);
  const bodyPages = fitPages(blocks, usable);
  const pages = bodyPages > 0 ? bodyPages + (setup.cover ? 1 : 0) : 0;
  const count = sectionCount(doc);

  const zoom = ZOOM_STOPS[zoomAt] ?? 1;
  const stepZoom = (dir: 1 | -1) =>
    setZoomAt((at) => Math.min(ZOOM_STOPS.length - 1, Math.max(0, at + dir)));

  /** DOWNLOAD PDF SAVES A FILE. It used to be window.print(), and the browser
   *  printed its own date, tab title, URL and page count on the client's copy
   *  (see the note at the head of bp-pdf-file.tsx). The builder and its fonts
   *  load on the first press only. */
  const [making, setMaking] = useState(false);
  const download = async () => {
    if (making) return;
    setMaking(true);
    try {
      const { buildProposalFile } = await import("./bp-pdf-file");
      const blob = await buildProposalFile({ ...doc, setup }, readPalette(flowRef.current), window.location.origin);
      saveBlob(blob, `${fileStem(doc)}.pdf`);
    } catch (err) {
      toast.error("Couldn't make the PDF", err instanceof Error ? err.message : "Try again in a moment.");
    } finally {
      setMaking(false);
    }
  };

  return (
    <div className={styles.pdfBlock}>
      {/* For Ctrl+P, which still prints the preview. @page cannot be scoped to
          a class, so the rule that follows the paper control is a real
          stylesheet, keyed so React replaces it rather than appending a second.
          The margin is 0: the browser prints its header and footer INSIDE the
          page margin, so with none it has nowhere to put them (Chrome, Edge).
          The sheet's own padding and the table bands' cells are the margin. */}
      <style key={setup.paper}>{`@page { size: ${paper.css} portrait; margin: 0; }`}</style>

      {/* ── THE CARD'S CHROME, IN TWO BUILDS ──────────────────────────
          On the desk it is a four-cell spec strip, a labelled segmented
          control and a three-across row of switch cells. None of the three
          survives 390px: the strip's four columns are ~85px each and every
          value inside them wraps ("US / Letter", "≈ 2 / pages"), and the
          three switch cells wrap their labels onto three lines apiece under
          22px plates.

          The handheld build asks the same four questions down one column:
          the spec strip becomes ONE mono line (it is a readout, and a readout
          is a sentence before it is a table), the paper control takes the full
          measure with its heading above it, the three facts become three
          full-width rows — label left, plate right, the whole row a target —
          and the two actions stack rather than splitting an already narrow
          card in half. */}
      {handheld ? (
        <div className={styles.pdfMobSpec}>
          {pages > 0 ? `≈ ${pages} ${pages === 1 ? "page" : "pages"}` : "Empty"}
          <span className={styles.pdfMobDot} aria-hidden="true">
            ·
          </span>
          {count} {count === 1 ? "section" : "sections"}
          <span className={styles.pdfMobDot} aria-hidden="true">
            ·
          </span>
          {/* No "portrait". The desk strip names the orientation because it has
              a cell going spare; here it is the one fact on the line nobody can
              change, and carrying it wrapped the readout onto a second row. */}
          {paper.label}
        </div>
      ) : (
        <div className={styles.pdfSpec}>
          <SpecCell label="Paper" value={paper.label} />
          <SpecCell label="Orient" value="Portrait" />
          <SpecCell label="Length" value={pages > 0 ? `≈ ${pages} ${pages === 1 ? "page" : "pages"}` : "—"} />
          <SpecCell label="Sections" value={String(count)} />
        </div>
      )}

      {handheld ? (
        <div className={styles.pdfMobSet}>
          <div className={styles.pdfMobField}>
            <span className={styles.pdfMobLbl}>Paper size</span>
            <Segmented<PaperSize>
              label="Paper size"
              hideLabel
              value={setup.paper}
              options={[
                { value: "letter", label: "US Letter" },
                { value: "a4", label: "A4" },
              ]}
              onChange={(v) => onPatch({ paper: v })}
            />
          </div>
          <div className={styles.pdfMobRows}>
            <Toggle
              label="Cover page"
              on={setup.cover}
              onChange={(on) => onPatch({ cover: on })}
            />
            <Toggle
              label="Letterhead every page"
              on={setup.letterhead}
              onChange={(on) => onPatch({ letterhead: on })}
            />
            <Toggle
              label="Footer every page"
              on={setup.footer}
              onChange={(on) => onPatch({ footer: on })}
            />
          </div>
        </div>
      ) : (
        <div className={styles.toggles}>
          <Segmented<PaperSize>
            label="Paper size"
            value={setup.paper}
            options={[
              { value: "letter", label: "Letter" },
              { value: "a4", label: "A4" },
            ]}
            onChange={(v) => onPatch({ paper: v })}
          />
          {/* The same three-cell row as card 06, for the same reason: three
              independent yes/no facts about one sheet, scanned in one sweep. */}
          <div className={styles.switchRow}>
            <ToggleCell
              label="Cover page"
              on={setup.cover}
              onChange={(on) => onPatch({ cover: on })}
            />
            <ToggleCell
              label="Letterhead every page"
              on={setup.letterhead}
              onChange={(on) => onPatch({ letterhead: on })}
            />
            <ToggleCell
              label="Footer every page"
              on={setup.footer}
              onChange={(on) => onPatch({ footer: on })}
            />
          </div>
        </div>
      )}

      <div className={cx(styles.pdfActions, handheld && styles.pdfActionsStack)}>
        <Btn icon="file" onClick={() => setOpen(true)}>
          Preview the sheet
        </Btn>
        <Btn tone="primary" icon="download" onClick={download} disabled={making}>
          {making ? "Making the PDF…" : "Download PDF"}
        </Btn>
      </div>

      {/* THE VAULT, WHICH IS ALSO THE VIEWER.
          Closed, it is clipped — not unmounted and not `display: none`, because
          the page estimate needs a laid-out document and the print layer needs
          one that is still in the DOM when the preview is shut.

          Open, the SAME element becomes a full-screen overlay. One instance of
          the document, in both states: a second copy rendered only for the
          modal would be a second thing to keep in agreement with the paper, and
          the measured flow would be whichever of the two happened to hold the
          ref. */}
      <div
        className={cx(styles.pdfVault, open && styles.pdfVaultOpen)}
        aria-hidden={!open}
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? "Proposal PDF preview" : undefined}
      >
        {open ? (
          <div className={styles.pdfBar}>
            <span className={styles.pdfBarTitle}>
              {doc.identity.ref}
              <span className={styles.pdfBarSep}>·</span>
              {paper.label}
              <span className={styles.pdfBarSep}>·</span>
              {pages > 0 ? `≈ ${pages} ${pages === 1 ? "page" : "pages"}` : "—"}
            </span>

            <div className={styles.pdfZoom}>
              <button
                type="button"
                className={styles.pdfZoomBtn}
                aria-label="Zoom out"
                disabled={zoomAt === 0}
                onClick={() => stepZoom(-1)}
              >
                −
              </button>
              {/* The readout is a BUTTON: the percentage is also the way back to
                  100%, which is the one zoom level anybody ever wants to return
                  to, and a viewer that can only step there is a viewer you have
                  to click four times. */}
              <button
                type="button"
                className={styles.pdfZoomNow}
                aria-label={`Zoom, ${Math.round(zoom * 100)} percent. Reset to actual size`}
                onClick={() => setZoomAt(ZOOM_FIT)}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                className={styles.pdfZoomBtn}
                aria-label="Zoom in"
                disabled={zoomAt === ZOOM_STOPS.length - 1}
                onClick={() => stepZoom(1)}
              >
                +
              </button>
            </div>

            <button
              ref={closeRef}
              type="button"
              className={styles.pdfClose}
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
        ) : null}

        {/* `--pdf-zoom` scales the sheet at the STAGE, not on the sheet itself:
            a transform creates a containing block, and scaling the article
            would take the print layer's `position: fixed` page furniture with
            it. The stage is screen-only scenery, so it is safe to transform. */}
        <div
          className={styles.pdfStage}
          style={{ "--pdf-zoom": open ? zoom : 1 } as React.CSSProperties}
        >
          <PdfDocument {...doc} setup={setup} flowRef={flowRef} />
        </div>
      </div>
    </div>
  );
}

/** One block of the flow — the document head, then one per section — with the
 *  space above it kept apart from its own height. */
type Block = { h: number; mt: number; flow: boolean };

/**
 * The page count, under the rule the printed sheet actually follows.
 *
 * It is the same rule stated twice — once to the browser as `break-inside`,
 * once here as arithmetic — because there is no way to ask a browser how many
 * pages something WILL be without printing it. The two are kept adjacent in
 * the comments for that reason: change one and the other is wrong.
 *
 *   · a block that does not fit in what is left of the page moves whole;
 *   · a block taller than a whole page is the exception, and flows;
 *   · a FLOWING section (`data-flow`: the price table, the payment schedule,
 *     the prose sections) starts where the last one ended and breaks at a row
 *     or a line;
 *   · a block that opens a page loses the margin above it, as the fragmenter
 *     truncates it — so it is charged for its height and nothing else.
 */
function fitPages(blocks: Block[], usable: number): number {
  if (usable <= 0 || blocks.length === 0) return 0;
  let pages = 1;
  let used = 0;
  for (const b of blocks) {
    if (b.flow) {
      const total = used + (used > 0 ? b.mt + b.h : b.h);
      const more = Math.max(0, Math.ceil(total / usable) - 1);
      pages += more;
      used = total - more * usable;
      continue;
    }
    if (used > 0 && used + b.mt + b.h > usable) {
      pages += 1;
      used = 0;
    }
    const cost = used > 0 ? b.mt + b.h : b.h;
    if (used + cost <= usable) {
      used += cost;
      continue;
    }
    // Taller than the page it starts on: it breaks, and what is left of it
    // decides how many further sheets it costs.
    const rest = cost - (usable - used);
    const extra = Math.ceil(rest / usable);
    pages += extra;
    used = rest - (extra - 1) * usable;
  }
  return pages;
}

/** The sheet's tokens as plain opaque colours for the file: react-pdf takes no
 *  CSS variables, and a token may be `rgba()` or `color-mix()`. A 1×1 canvas
 *  resolves any of them, flattened onto white paper. */
function readPalette(el: HTMLElement | null): PdfPalette {
  const fallback: PdfPalette = { ink: "#0a0a0a", soft: "#2a2a2a", muted: "#6b6b6b", rule: "#ebebeb", line: "#e0e0e0" };
  if (!el) return fallback;
  const css = getComputedStyle(el);
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return fallback;
  const solid = (token: string, dflt: string) => {
    const v = css.getPropertyValue(token).trim();
    if (!v) return dflt;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = dflt;
    ctx.fillStyle = v; // an unparseable value leaves the fallback in place
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  };
  return {
    ink: solid("--ink", fallback.ink),
    soft: solid("--ink-soft", fallback.soft),
    muted: solid("--muted", fallback.muted),
    rule: solid("--mb-rule", fallback.rule),
    line: solid("--mb-line", fallback.line),
  };
}

/** Hands the file to the browser as a download. iOS Safari opens it in its
 *  viewer with Share / Save to Files, which is that platform's download. */
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked late: Safari reads the URL after the click returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function SpecCell({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.pdfSpecCell}>
      <span className={styles.pdfSpecLabel}>{label}</span>
      <span className={styles.pdfSpecValue}>{value}</span>
    </div>
  );
}

/* ============================================================
   THE DOCUMENT
   ============================================================ */

export function PdfDocument({
  identity,
  title,
  clientName,
  email,
  phone,
  address,
  projectName,
  description,
  scopeOfWork,
  terms,
  taxPct,
  options,
  totals,
  installments,
  files,
  setup,
  flowRef,
}: DocProps & { flowRef?: React.RefObject<HTMLDivElement | null> }) {
  const paper = PAPER[setup.paper];
  const jobTitle = title.trim() || "Untitled proposal";
  const client = clientName.trim() || "No client yet";
  const valid = sheetDate(identity.validUntil);
  const sections = buildSections({
    identity,
    title,
    clientName,
    email,
    phone,
    address,
    projectName,
    description,
    scopeOfWork,
    terms,
    taxPct,
    options,
    totals,
    installments,
    files,
    setup,
  });

  return (
    <article
      className={styles.pdfSheet}
      style={{ "--pdf-w": `${paper.w}px` } as React.CSSProperties}
      aria-label="Proposal PDF"
    >
      {/* ── THE PAGED FRAME ──────────────────────────────────────────
          A REAL TABLE, and the only reason is the one thing print CSS has no
          other way to say: repeat this band at the head of every sheet AND
          reserve its height in the text area of every sheet.

          `position: fixed` repeats a band, but a fixed box is out of flow, so
          nothing below it moves — it printed the letterhead straight through
          the opening lines of page two onward, and the padding that cleared it
          on page one could not reach page two, because padding belongs to a
          box and pages are not boxes. Negative offsets into the page margin do
          not help either: a fixed box that overflows the top of its page area
          is painted on the PREVIOUS sheet (measured, not assumed).
          `display: table-header-group` on a div is ignored by Chrome for
          repetition — also measured. A real <thead> is repeated, reserves its
          own space, and the section-level `break-inside: avoid` below keeps
          working inside the cell. That is the whole justification; the table
          carries no data and is marked `presentation` so it carries no
          meaning either.

          Both groups are there even with their band switched off: on paper
          their cells carry the sheet's top and bottom margin on every page
          (the @page margin is 0 — see the print layer). */}
      <table className={styles.pdfPaged} role="presentation">
        <thead>
          <tr>
            <td>
              {setup.letterhead ? (
                <header className={styles.pdfRunHead}>
                  <div>
                    <div className={styles.pdfHeadOrg}>{identity.orgName}</div>
                    {identity.orgLine ? (
                      <div className={styles.pdfHeadLine}>{identity.orgLine}</div>
                    ) : null}
                  </div>
                  <div className={styles.pdfHeadRef}>
                    Proposal {identity.ref}
                    <br />
                    Valid until {valid}
                  </div>
                </header>
              ) : null}
            </td>
          </tr>
        </thead>

        <tbody>
          <tr>
            <td>
      <div className={cx(styles.pdfFlow, setup.letterhead && styles.pdfFlowHead, setup.footer && styles.pdfFlowFoot)}>
        {setup.cover ? (
          <section className={styles.pdfCover}>
            <div className={styles.pdfCoverKicker}>Proposal {identity.ref}</div>
            <h1 className={styles.pdfCoverTitle}>{jobTitle}</h1>
            <div className={styles.pdfCoverFor}>
              Prepared for {client}
              {address ? (
                <>
                  <br />
                  {address}
                </>
              ) : null}
            </div>
            <div className={styles.pdfCoverTotal}>
              <span className={styles.pdfCoverTotalLabel}>Total</span>
              <span className={styles.pdfCoverTotalValue}>{money(totals.total)}</span>
            </div>
            <div className={styles.pdfCoverMeta}>
              {identity.orgName} · Valid until {valid}
            </div>
          </section>
        ) : null}

        {/* The measured element is the FLOW's inner stack, so the estimate is
            of the pages that actually flow — the cover is added separately
            because it is one page by construction. */}
        <div ref={flowRef} className={styles.pdfBody}>
          <div className={styles.pdfDocHead}>
            <h2 className={styles.pdfDocTitle}>{jobTitle}</h2>
            <div className={styles.pdfDocSub}>
              Proposal {identity.ref} · Valid until {valid}
            </div>
          </div>

          {sections.map((s, i) => (
            <section
              key={s.key}
              className={cx(styles.pdfSection, FLOWING_SECTIONS.has(s.key) && styles.pdfSectionFlow)}
              data-flow={FLOWING_SECTIONS.has(s.key) ? "" : undefined}
            >
              <div className={styles.pdfSecHead}>
                <span className={styles.pdfSecNum}>{String(i + 1).padStart(2, "0")}</span>
                <h3 className={styles.pdfSecTitle}>{s.title}</h3>
              </div>
              {s.body}
            </section>
          ))}
        </div>
      </div>
            </td>
          </tr>
        </tbody>

        <tfoot>
          <tr>
            <td>
              {setup.footer ? (
                <footer className={styles.pdfRunFoot}>
                  <span>
                    {identity.ref} · {client}
                  </span>
                  <span>
                    Valid until {valid} · {identity.orgName}
                  </span>
                </footer>
              ) : null}
            </td>
          </tr>
        </tfoot>
      </table>
    </article>
  );
}

/* ============================================================
   THE SECTIONS
   Which ones, in which order, is `sectionPlan` (bp-pdf-plan.ts) —
   the list the file is built from too, so the numbering cannot
   differ between the preview and the PDF. This only draws them.
   ============================================================ */

type Section = { key: SectionKey; title: string; body: React.ReactNode };

function sectionCount(doc: Omit<DocProps, "setup">): number {
  return sectionPlan(doc).length;
}

function buildSections(d: DocProps): Section[] {
  return sectionPlan(d).map(({ key, title }) => ({ key, title, body: sectionBody(key, d) }));
}

function sectionBody(key: SectionKey, d: DocProps): React.ReactNode {
  switch (key) {
    case "parties":
      return (
        <div className={styles.pdfMeta}>
          <MetaPair label="Client" value={d.clientName.trim() || "—"} />
          <MetaPair label="Job address" value={d.address.trim() || "—"} />
          <MetaPair label="Email" value={d.email.trim() || "—"} />
          <MetaPair label="Phone" value={d.phone.trim() || "—"} />
          <MetaPair label="Project" value={d.projectName || "—"} />
          <MetaPair label="Prepared by" value={d.identity.orgName} />
        </div>
      );
    case "overview":
      return <p className={styles.pdfProse}>{d.description}</p>;
    case "scope":
      return <p className={styles.pdfProse}>{d.scopeOfWork}</p>;
    case "terms":
      return <p className={styles.pdfProse}>{d.terms}</p>;
    case "pricing":
      // THREE COLUMNS — item, quantity × unit price, amount — under heads, so
      // a figure is read by its column rather than found inside a sentence.
      // The file draws the same table (bp-pdf-file.tsx).
      return d.totals.printed.length === 0 ? (
        <div className={styles.empty}>No named lines yet — nothing prints.</div>
      ) : (
        <>
          <div className={cx(styles.pdfLine, styles.pdfLineHead)}>
            <span>Item</span>
            <span>Qty × unit price</span>
            <span>Amount</span>
          </div>
          {d.totals.printed.map((row) => (
            <div key={row.id} className={styles.pdfLine}>
              <span>
                <span className={styles.printName}>{row.name}</span>
                {row.description ? <span className={styles.printSub}>{row.description}</span> : null}
                {!d.options.hideBreakdown ? (
                  <span className={styles.printSub}>
                    {[row.materialAmount > 0 ? `Materials ${money(row.materialAmount)}` : "", row.laborAmount > 0 ? `Labor ${money(row.laborAmount)}` : ""].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </span>
              <span className={styles.pdfLineQty}>{unitText(row)}</span>
              <span className={styles.pdfLineAmt}>{money(row.amount)}</span>
            </div>
          ))}
        </>
      );
    case "totals":
      return (
        <div className={styles.pdfSums}>
          <div className={styles.sumRow}>
            <span className={styles.sumLabel}>Subtotal</span>
            <span className={styles.sumValue}>{money(d.totals.preTax)}</span>
          </div>
          {/* Printed only when it is worth something. A "Discount $0.00" row on a
              client's copy invites the question it answers. */}
          {d.totals.discountAmount > 0 ? (
            <div className={styles.sumRow}>
              <span className={styles.sumLabel}>Discount</span>
              <span className={styles.sumValue}>−{money(d.totals.discountAmount)}</span>
            </div>
          ) : null}
          <div className={styles.sumRow}>
            <span className={styles.sumLabel}>Tax · {pct(d.taxPct)}</span>
            <span className={styles.sumValue}>{money(d.totals.tax)}</span>
          </div>
          <div className={cx(styles.sumRow, styles.sumTotal)}>
            <span className={styles.sumTotalLabel}>Total</span>
            <span className={styles.sumTotalValue}>{money(d.totals.total)}</span>
          </div>
        </div>
      );
    case "pay":
      return (
        <>
          <div className={cx(styles.pdfPayRow, styles.pdfLineHead)}>
            <span>Payment</span>
            <span>Basis</span>
            <span>Amount</span>
          </div>
          {d.installments.map((inst) => (
            <div key={inst.id} className={styles.pdfPayRow}>
              <span className={styles.printName}>{inst.label.trim() || "Unnamed payment"}</span>
              <span className={styles.pdfPayShare}>
                {inst.isPercent ? `${inst.amount}% of total` : "Fixed amount"}
              </span>
              <span className={styles.pdfLineAmt}>{money(installmentValue(inst, d.totals.total))}</span>
            </div>
          ))}
          <p className={styles.pdfFine}>
            Amounts are calculated from the total above. Any balance not covered by the
            schedule is due on completion.
          </p>
        </>
      );
    case "accept":
      return (
        <>
          <p className={styles.pdfProse}>
            Signing below accepts this proposal, its scope, its price of{" "}
            {money(d.totals.total)} and the terms above. This offer stands until{" "}
            {sheetDate(d.identity.validUntil)}.
          </p>
          <div className={styles.signRow}>
            <div className={styles.signLine}>Client signature</div>
            <div className={styles.signLine}>Date</div>
          </div>
          <div className={styles.signRow}>
            <div className={styles.signLine}>For {d.identity.orgName}</div>
            <div className={styles.signLine}>Date</div>
          </div>
        </>
      );
    case "files":
      return (
        <>
          {d.files.map((f, i) => (
            <div key={f.id} className={cx(styles.pdfFileRow, i === 0 && styles.printFirst)}>
              <span className={styles.printName}>{f.name}</span>
              <span className={styles.pdfLineAmt}>{fileSize(f.size)}</span>
            </div>
          ))}
          {/* The list is a manifest, not the files. Saying so on the paper is
              the difference between a client waiting for a page that is not
              coming and one who knows to look in the email. */}
          <p className={styles.pdfFine}>
            Listed for reference — the files themselves are sent alongside this document.
          </p>
        </>
      );
  }
}

function MetaPair({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.pdfMetaPair}>
      <span className={styles.pdfMetaLabel}>{label}</span>
      <span className={styles.pdfMetaValue}>{value}</span>
    </div>
  );
}
