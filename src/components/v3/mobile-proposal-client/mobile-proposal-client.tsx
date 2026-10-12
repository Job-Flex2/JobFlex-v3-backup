"use client";

// Handheld proposal: required typed acceptance and the shared payment center.
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/Toast";
import { lockScroll } from "@/lib/scrollLock";
import { useSheetDrag } from "@/components/v3/mobile-shell/use-sheet-drag";
import type { PortalView } from "./portal-view";
import type { PortalPayModel } from "@/lib/payments/portalModel";
import { ProposalDecision } from "./proposal-decision";
import { PaymentCenter } from "./payment-center";
import { usePayReturn } from "./use-pay-return";
import { StarsInline } from "@/components/reviews/StarsInline";
import { FenceSceneFigure } from "@/components/v3/fence-scene/fence-scene-figure";
import { DeckSceneFigure } from "@/components/v3/deck-scene/deck-scene-figure";
import "./mobile-proposal-client.css";

/** `"open"` is the one local value the SERVER never sends: a revert has put the
 *  proposal back, and the page must show it open before the refresh lands. */
type Settled = "accepted" | "paid" | "declined" | "open" | null;
type Provider = "stripe" | "square" | "stax";

/** The way back, held in memory only — a reload forgets it, which is the whole
 *  point: "revert" exists for the tap that was a slip, not for next week. */
/* A DECLINE only. An accept has no way back from here (owner, 2026-09-23):
   the server hands no token for it and refuses one; undoing an acceptance is
   the contractor's call, in the dashboard. */
type Revert = { token: string; kind: "decline" };

function PayReturnBanner({ publicId, paidInFull }: { publicId: string; paidInFull: boolean }) {
  const state = usePayReturn(publicId);
  if (state.kind === "idle" || state.kind === "canceled") return null;
  // Once the proposal is PAID the decision plate just below says "Paid in full
  // — thank you."; the banner does not say it a second time (owner, 2026-09-26).
  if (paidInFull) return null;
  return (
    <div className={`mpc-payret mpc-payret--${state.kind}`} role="status" aria-live="polite">
      {state.kind === "processing"
        ? "Confirming your payment…"
        : state.kind === "paid"
          ? state.proposalPaid
            ? "Paid in full — thank you."
            : "Payment received — thank you."
          : "Taking a moment to confirm — you'll get an email receipt when it lands."}
    </div>
  );
}

function settledFrom(status: string): Settled {
  if (status === "PAID") return "paid";
  // COMPLETED is an accepted job whose work is done — settled, still payable.
  if (status === "ACCEPTED" || status === "COMPLETED") return "accepted";
  if (status === "DECLINED") return "declined";
  return null;
}

/* ── Icons. Inline <svg>, no ids, so there is no <symbol> sheet to collide
      with the desktop tree's. 2px stroke on the 24 grid, currentColor. ── */
const IcDownload = () => (
  <svg className="mpc-ic" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3v12" />
    <path d="M7 11l5 5 5-5" />
    <path d="M4 20h16" />
  </svg>
);
const IcCheck = () => (
  <svg className="mpc-ic" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 12.5l5 5L20 6.5" />
  </svg>
);
const IcMinus = () => (
  <svg className="mpc-ic" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h14" />
  </svg>
);
const IcPhone = () => (
  <svg className="mpc-ic" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5L17 13l4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 3 5.2 2 2 0 0 1 5 3Z" />
  </svg>
);

export function MobileProposalClient({ view }: { view: PortalView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  // The accept flourish — set on the click that settles the deal, never on a
  // reload of an already-accepted page.
  const [cheer, setCheer] = useState(false);
  // Only providers with a healthy connection on this contractor's account —
  // the same gate the pay routes enforce (src/lib/payments/payOptions.ts).
  const [freshPay, setFreshPay] = useState<PortalPayModel | null>(null);
  const pay = ["ACCEPTED", "COMPLETED", "PAID"].includes(view.status) ? view.pay : freshPay ?? view.pay;
  const payOptions: Array<{ id: Provider; name: string }> = [
    ...(pay.providers.stripe.ok
      ? [{ id: "stripe" as const, name: "Stripe" }]
      : []),
    ...(pay.providers.square.ok ? [{ id: "square" as const, name: "Square" }] : []),
    ...(pay.providers.stax.ok ? [{ id: "stax" as const, name: "Stax" }] : []),
  ];
  // Which target the sheet is paying: the next stage, or everything left.
  const [payTarget, setPayTarget] = useState<"next" | "remaining">("next");
  const [note, setNote] = useState("");
  const [noteErr, setNoteErr] = useState(false);
  const [local, setLocal] = useState<Settled>(null);
  const [revert, setRevert] = useState<Revert | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const introRef = useRef<HTMLElement | null>(null);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  const settled = view.status === "PAID" ? "paid" : local === "open" ? null : (local ?? settledFrom(view.status));
  const positive = settled === "accepted" || settled === "paid";
  const sheetOpen = declineOpen;

  const closeSheets = useCallback(() => {
    setPayOpen(false);
    setDeclineOpen(false);
  }, []);

  const declineDrag = useSheetDrag(declineOpen, () => setDeclineOpen(false));

  /* ── Reveal. Same contract as the desktop port: the first two blocks are
        primed on a timer, the rest wait for the observer and unobserve
        themselves. Reduced motion (or no IntersectionObserver) reveals
        everything at once. Scoped to this tree's root so a client-side
        navigation cannot reach another surface's .rv. ── */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(".rv"));
    if (!items.length) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("on"));
      return () => items.forEach((el) => el.classList.remove("on"));
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add("on");
            io.unobserve(en.target);
          }
        });
      },
      { threshold: 0.12 },
    );

    const timers: number[] = [];
    items.forEach((el, i) => {
      if (i < 2) {
        timers.push(window.setTimeout(() => el.classList.add("on"), 90 + i * 110));
      } else {
        io.observe(el);
      }
    });

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      io.disconnect();
      items.forEach((el) => el.classList.remove("on"));
    };
  }, []);

  /* ── Sheet plumbing: one reference-counted scroll lock (never a hand-rolled
        body.style.overflow, which poisons every other lock on the page) and
        Escape to close. ── */
  useEffect(() => {
    if (!sheetOpen) return;
    const release = lockScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSheets();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      release();
      window.removeEventListener("keydown", onKey);
    };
  }, [sheetOpen, closeSheets]);

  /* The decline sheet is a form: put the caret where the work is. */
  useEffect(() => {
    if (!declineOpen) return;
    const t = window.setTimeout(() => noteRef.current?.focus(), 320);
    return () => window.clearTimeout(t);
  }, [declineOpen]);

  /* ── The settle moment. The action bar is the last thing the reader touched
        and it disappears on settle, so if they were scrolled to the bottom the
        confirmation would land off-screen behind them. Bring the intro card —
        which now carries the settled plate — back into view. ── */
  useEffect(() => {
    if (!local) return;
    const el = introRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [local]);

  async function accept(name: string) {
    if (busy) return;
    setBusy("accept");
    closeSheets();
    try {
      const res = await fetch(`/api/public-quote/${view.publicId}/accept`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; pay?: PortalPayModel };
      if (!res.ok) throw new Error(data.error ?? "Couldn't record acceptance");
      if (data.pay) setFreshPay(data.pay);
      setLocal("accepted");
      setCheer(true);
      setRevert(null);
      router.refresh();
    } catch (err) {
      toast.error("Acceptance failed", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  async function decline() {
    const trimmed = note.trim();
    // The desktop guard, unchanged: an empty note reveals the error line and
    // stops before any network call.
    if (!trimmed) {
      setNoteErr(true);
      noteRef.current?.focus();
      return;
    }
    setNoteErr(false);
    try {
      setBusy("decline");
      const res = await fetch(`/api/public-quote/${view.publicId}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; revertToken?: string };
      if (!res.ok) throw new Error(data?.error ?? "Couldn't record your response");
      closeSheets();
      setLocal("declined");
      if (data.revertToken) setRevert({ token: data.revertToken, kind: "decline" });
      router.refresh();
    } catch (err) {
      toast.error("Couldn't decline", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  /** Take the decline back. One shot: the token is dropped on success. */
  async function undo() {
    if (!revert) return;
    setBusy("revert");
    try {
      const res = await fetch(`/api/public-quote/${view.publicId}/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: revert.token }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data?.error ?? "Couldn't revert");
      setRevert(null);
      setLocal("open");
      setNote("");
      router.refresh();
    } catch (err) {
      toast.error("Couldn't revert", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  // Under the declined plate this page's own tap produced, and only while the
  // token from that tap is in memory. Never under the accepted plate.
  const revertRow =
    revert && settled === "declined" ? (
      <div className="mpc-revert">
        <button
          className="mpc-btn mpc-btn--frame mpc-revert-b"
          type="button"
          disabled={busy !== null}
          onClick={undo}
        >
          <span className="mpc-revert-ic" aria-hidden="true">↺</span>
          {busy === "revert" ? "Reverting…" : "Revert decline"}
        </button>
        <span className="mpc-revert-n">Only while this page stays open</span>
      </div>
    ) : null;

  return (
    <div className="jf-mobile-proposal-client" ref={rootRef}>
      <div className="mpc-doc">
        <header className="mpc-head rv">
          {view.logoHref ? (
            // eslint-disable-next-line @next/next/no-img-element -- the shop's own logo, served by /api/public-quote/[publicId]/logo
            <img className="mpc-logo" src={view.logoHref} alt={view.orgName ? `${view.orgName} logo` : "Company logo"} />
          ) : (
            <span className="mpc-mark" aria-hidden="true">
              {view.monogram}
            </span>
          )}
          <span className="mpc-org">
            <b className="mpc-org-n" title={view.orgName}>{view.orgName}</b>
            <span className="mpc-org-r">{`№ ${view.refCode} · ${view.createdOn}`}</span>
          </span>
          <a
            className="mpc-pdf"
            href={view.pdfHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Download this proposal as a PDF"
          >
            <IcDownload />
            <i aria-hidden="true">PDF</i>
          </a>
          {/* The contractor's standing as the header's own second line: a
              full-width plate under the identity row (the header wraps), a
              44px tap target, the count at the right edge as the door. Not
              inside `.mpc-org` — there it hung under the reference line on
              negative margins and overlapped it. */}
          {view.rating ? (
            <a
              className="mpc-rating"
              href={view.rating.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Rated ${view.rating.avg} out of 5 from ${view.rating.count} client ${view.rating.count === 1 ? "review" : "reviews"} — see all reviews`}
            >
              <StarsInline value={Number(view.rating.avg)} size={14} />
              <em>{view.rating.avg}</em>
              <i>{`${view.rating.count} ${view.rating.count === 1 ? "review" : "reviews"} →`}</i>
            </a>
          ) : null}
        </header>

        <section className="mpc-intro rv" ref={introRef}>
          <div className="mpc-card">
            <div className="mpc-kicker">{`Prepared for ${view.clientName}`}</div>
            <h1 className="mpc-h1">{view.title}</h1>
            <div className="mpc-facts">
              <div className="mpc-fact mpc-fact--total">
                <span>Total</span>
                <b>{view.totalLabel}</b>
              </div>
              <div className="mpc-fact">
                <span>Valid until</span>
                <b>{view.validUntil}</b>
              </div>
            </div>

            {/* THE CLIENT'S OWN JOB IN PICTURES — the fence's 3D and traced
                layout, the roof from the air with one pin on the house (never
                an outline — owner, 2026-10-12), exactly the set the desk page
                shows (2026-09-23). */}
            {view.pictures.filter((p) => p.kind === "fence-scene").map((p) => (
              <FenceSceneFigure key={p.kind} className="mpc-scene" src={p.src} poster={p.poster ?? null} caption={p.caption} facts={p.facts} />
            ))}
            {view.pictures.filter((p) => p.kind === "deck-scene").map((p) => (
              <DeckSceneFigure key={p.kind} className="mpc-scene" src={p.src} caption={p.caption} facts={p.facts} />
            ))}
            {view.pictures.filter((p) => p.kind !== "fence-scene" && p.kind !== "deck-scene").map((p) => (
              <figure key={p.kind} className="mpc-site" data-picture={p.kind}>
                <div className="mpc-site-frame">
                  {/* eslint-disable-next-line @next/next/no-img-element -- streamed from this app's own routes or Blob; next/image adds nothing */}
                  <img src={p.src} alt={p.alt} loading="lazy" />
                  {p.overlay ? (
                    <svg className="mpc-site-ov" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
                      {p.overlay.map((pts, i) => <polygon key={i} points={pts} />)}
                    </svg>
                  ) : null}
                  {p.pin ? (
                    <span className="mpc-site-pin" style={{ left: `${p.pin.x / 10}%`, top: `${p.pin.y / 10}%` }} data-roof-pin>
                      <svg viewBox="-40 -104 80 112" aria-hidden="true"><ellipse cx="0" cy="2" rx="16" ry="6" fill="#000" fillOpacity="0.28" /><path d="M0 0C-6-22-34-40-34-62a34 34 0 1 1 68 0C34-40 6-22 0 0z" fill="#e5322d" stroke="#fff" strokeWidth="6" strokeLinejoin="round" /><circle cx="0" cy="-62" r="12" fill="#fff" /></svg>
                    </span>
                  ) : null}
                </div>
                <figcaption>
                  {p.caption}
                  {p.facts ? <span className="mpc-site-facts">{p.facts}</span> : null}
                </figcaption>
              </figure>
            ))}

            {/* HOW TO PAY — only once accepted. It used to live in the action
                bar next to Decline, asking for money before the client had
                agreed to anything; and because that bar is hidden the moment
                the proposal settles, paying became unreachable at exactly the
                point it starts to make sense. */}
            <Suspense fallback={null}>
              <PayReturnBanner publicId={view.publicId} paidInFull={view.status === "PAID"} />
            </Suspense>
            <ProposalDecision settled={settled} busy={busy !== null} model={pay}
              acceptedMessage={
                <div
                  className="mpc-state"
                  role="status"
                  hidden={!positive}
                  data-cheer={cheer ? "1" : undefined}
                >
                  {cheer && (
                    <span className="mpc-cheer" aria-hidden="true">
                      {Array.from({ length: 8 }, (_, i) => (
                        <i key={i} style={{ "--i": i } as React.CSSProperties} />
                      ))}
                    </span>
                  )}
                  <IcCheck />
                  <span>
                    {settled === "paid"
                      ? "Paid in full — thank you."
                      : "Accepted — thank you."}
                  </span>
                </div>
              } onAccept={accept} onDecline={() => setDeclineOpen(true)} />
            {settled === "accepted" && !pay.anyWay ? (
              <div className="mpc-pay-sum mpc-pay-touch">The team will be in touch about payment.</div>
            ) : null}
            <div
              className="mpc-state mpc-state--declined"
              role="status"
              hidden={settled !== "declined"}
            >
              <IcMinus />
              <span>You declined this proposal.</span>
            </div>
            {revertRow}
          </div>
        </section>

        {/* OVERVIEW — not a mockup section. `proposal.description` is
            contractor-authored copy the mockup's intro card has no slot for;
            rather than drop customer content it reuses this page's own section
            + prose pair, exactly as the desktop port does. */}
        {view.description ? (
          <section className="mpc-sec rv">
            <h2 className="mpc-sec-h">Overview</h2>
            <p className="mpc-prose">{view.description}</p>
          </section>
        ) : null}

        <section className="mpc-sec rv">
          <h2 className="mpc-sec-h">Estimate detail</h2>
          <div className="mpc-ledger">
            {/* The line items get their own wrapper so `:last-child` provably
                lands on the last ITEM — see the note in the stylesheet. */}
            <div className="mpc-lis">
              {view.lineItems.length ? (
                view.lineItems.map((item) => (
                  <div className="mpc-li" key={item.id}>
                    <div className="mpc-li-t">
                      <div className="mpc-li-n">{item.name}</div>
                      {item.description ? <div className="mpc-li-d">{item.description}</div> : null}
                      {item.split ? <div className="mpc-li-m">{item.split}</div> : null}
                      {item.meta ? <div className="mpc-li-m">{item.meta}</div> : null}
                    </div>
                    <div className="mpc-li-v">{item.amount}</div>
                  </div>
                ))
              ) : (
                <div className="mpc-li-none">No itemised lines on this proposal</div>
              )}
            </div>
            <div className="mpc-tot">
              <div className="mpc-tot-r">
                <span>Subtotal</span>
                <b>{view.subtotalLabel}</b>
              </div>
              <div className="mpc-tot-r">
                <span>{view.taxLabel}</span>
                <b>{view.taxAmount}</b>
              </div>
              <div className="mpc-tot-due">
                <span>Total due</span>
                <b>{view.totalLabel}</b>
              </div>
            </div>
          </div>
        </section>

        {view.scope ? (
          <section className="mpc-sec rv">
            <h2 className="mpc-sec-h">Scope of work</h2>
            <p className="mpc-prose">{view.scope}</p>
          </section>
        ) : null}

        <section className="mpc-sec rv">
          <h2 className="mpc-sec-h">Payment schedule</h2>
          <div className="mpc-pay">
            {pay.stages.map((s) => {
              const active = settled === "accepted" && s.payable && pay.anyWay;
              const word =
                s.status === "PAID"
                  ? s.paidOn
                    ? `Paid · ${s.paidOn}`
                    : "Paid"
                  : s.status === "PENDING"
                    ? "Processing"
                    : s.status === "WAIVED"
                      ? "Closed"
                      : s.payable && settled === "accepted"
                        ? "Due now"
                        : "Due";
              return (
                <div
                  className={`mpc-pay-r${s.status === "PAID" ? " is-paid" : ""}${active ? " is-next" : ""}`}
                  key={s.id}
                >
                  <span className="mpc-pay-no">{s.no}</span>
                  <span className="mpc-pay-n">{s.label}</span>
                  <span className="mpc-pay-v">{s.amount}</span>
                  <span className={`mpc-pay-s mpc-pay-st--${s.status.toLowerCase()}`}>
                    {s.share ? `${s.share} of total · ${word}` : word}
                  </span>
                  {active ? (
                    <div className="mpc-pay-act">
                      {payOptions.length ? (
                        <button
                          className="mpc-btn mpc-btn--primary"
                          type="button"
                          disabled={busy !== null || (s.belowMin.stripe && s.belowMin.square && s.belowMin.stax)}
                          onClick={() => {
                            setPayTarget("next");
                            setPayOpen(true);
                          }}
                        >
                          {`Pay ${s.amount}`}
                        </button>
                      ) : null}
                      {pay.bankTransfer.ok ? (
                        <details className="mpc-pay-bank">
                          <summary>{payOptions.length ? "Or pay by bank transfer" : "Pay by bank transfer"}</summary>
                          <pre className="mpc-pay-bank-body">{pay.bankTransfer.instructions}</pre>
                          <div className="mpc-pay-bank-note">
                            {`Reference "${s.label}" — the team will mark it paid once it arrives.`}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {pay.paidMinor > 0 && pay.remainingMinor > 0 ? (
            <div className="mpc-pay-sum">
              <span>{`Paid to date ${pay.paid}`}</span>
              <b>{`Remaining ${pay.remaining}`}</b>
            </div>
          ) : null}
          {settled === "accepted" && !pay.anyWay ? (
            <div className="mpc-pay-sum">The team will be in touch about payment.</div>
          ) : null}
        </section>

        {/* Terms as a disclosure — closed by default. Long legal copy between a
            thumb and the Accept button is copy nobody reads, but it has to be
            one tap away. A real <details>, so it prints open. */}
        {view.terms ? (
          <section className="mpc-sec rv">
            <details className="mpc-terms">
              <summary>Terms &amp; conditions</summary>
              <div className="mpc-terms-b">{view.terms}</div>
            </details>
          </section>
        ) : null}

        {view.telHref ? (
          <section className="mpc-call rv">
            <div className="mpc-call-t">Questions in the meantime? Just call.</div>
            <a className="mpc-call-a" href={view.telHref}>
              <IcPhone />
              <span>{view.phone}</span>
            </a>
          </section>
        ) : null}

        <footer className="mpc-foot rv">
          <i aria-hidden="true">JF</i>
          <span>{`Prepared by ${view.orgName} on JobFlex`}</span>
        </footer>
      </div>

      {/* One scrim for both sheets — only one is ever open. */}
      <div
        className={`mpc-scrim${sheetOpen ? " on" : ""}`}
        aria-hidden="true"
        onClick={closeSheets}
      />

      {payOpen && <PaymentCenter model={pay} initialTarget={payTarget} onClose={() => setPayOpen(false)} />}

      {/* ── DECLINE SHEET. The note and its required-note guard, unchanged. ── */}
      <div
        className={`mpc-sheet${declineOpen ? " on" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mpc-dec-t"
        {...declineDrag.sheetProps}
      >
        <div className="mpc-grab" {...declineDrag.handleProps} />
        <div className="mpc-sheet-h" {...declineDrag.handleProps}>
          <div className="mpc-sheet-k">Response</div>
          <div className="mpc-sheet-t" id="mpc-dec-t">
            Decline proposal
          </div>
        </div>
        <div className="mpc-sheet-b">
          <div className="mpc-form">
            <label className="mpc-label" htmlFor="mpc-note">
              Tell the team why — required
            </label>
            <textarea
              className="mpc-ta"
              id="mpc-note"
              ref={noteRef}
              placeholder="A sentence is plenty"
              maxLength={2000}
              value={note}
              aria-invalid={noteErr || undefined}
              aria-describedby={noteErr ? "mpc-err" : undefined}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="mpc-err" id="mpc-err" role="alert" hidden={!noteErr}>
              A note is required so the team knows why.
            </div>
            <button
              className="mpc-confirm"
              type="button"
              disabled={busy !== null}
              onClick={decline}
            >
              Confirm decline
            </button>
          </div>
        </div>
        <button className="mpc-cancel" type="button" onClick={closeSheets}>
          Cancel
        </button>
      </div>
    </div>
  );
}
