"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { FileText } from "lucide-react";
import { AppWindow } from "./app-window";
import { InvoiceMobile } from "./invoice-mobile";
import type { ProposalContent } from "./landing-groups";
import { Reveal } from "./reveal";
import { Counter } from "./counter";
import { useInView } from "./use-in-view";
import "./proposals-pass.css";

/* The document as it shipped — the kitchen — is the default page's and the
   interior trades'; the other groups hand in their own (landing-groups.ts). */
const KITCHEN: ProposalContent = {
  number: "P-1178",
  title: "Nguyen kitchen remodel — 10×10, maple & quartz",
  blurb:
    "Full scope for the kitchen: demo, rough-in for the relocated sink, semi-custom maple shaker cabinets and quartz counters. The price is complete — anything outside it gets a written change order first.",
  linesMobile: [
    ["Cabinets — maple shaker, 14 ln ft", "$8,400"],
    ["Countertop — quartz, 42 sf", "$2,436"],
    ["Labor — demo, install, finish", "$8,960"],
  ],
  linesDesktop: [
    ["Cabinets — semi-custom maple shaker, 14 ln ft", "$8,400"],
    ["Countertop — quartz, 42 sf installed", "$2,436"],
    ["Sink relocation — plumbing rough-in", "$1,850"],
    ["Labor — demo, install, finish (112 hrs)", "$8,960"],
  ],
  total: "$27,860",
  option: { name: "Option — soft-close hardware", note: "Client adds this in the portal", price: "+$640" },
  client: "M. Nguyen",
};

/* Mobile proposal card — a real document with a visible send action */
function ProposalMobile({ p }: { p: ProposalContent }) {
  return (
    <AppWindow title={`app.jobflex.com/proposals/${p.number}`}>
      <div className="px-4 py-4">
        <div className="text-[10px] font-bold uppercase tracking-[1.4px] text-[#6a6a6a]">
          Proposal · #{p.number}
        </div>
        <div className="mt-1.5 text-[17px] font-bold leading-snug tracking-tight text-ink">
          {p.title}
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
          {p.linesMobile.map(([l, r], i) => (
            <div
              key={l}
              className={`flex items-center justify-between px-3 py-2.5 text-[12px] ${i % 2 ? "bg-lp-paper" : "bg-white"}`}
            >
              <span className="text-[#555555]">{l}</span>
              <span className="font-semibold text-ink">{r}</span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-slate-200 px-3 py-3">
            <span className="text-[12px] font-bold text-ink">Project total</span>
            <span className="text-[16px] font-bold tracking-tight text-ink"><Counter value={p.total} /></span>
          </div>
        </div>

        <button
          type="button"
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-lp-ink text-[15px] font-semibold text-white"
        >
          Send to client
          <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
            <path d="M1.5 8L14.5 1.5 10 14.5l-2.6-4.4L1.5 8z" fill="currentColor" />
          </svg>
        </button>
      </div>
    </AppWindow>
  );
}

type SendStage = "draft" | "pressing" | "delivered" | "approved";

/* The desktop proposal. Deliberately compact — the whole document has to be
   readable inside one screen, so this is a trimmed plate rather than a
   full-bleed page.

   It also plays the thing the section claims. The one action button carries the
   whole story rather than a toast appearing beside it: it is pressed, the
   button itself becomes "Delivered to M. Nguyen", and when the client approves
   the same button becomes the
   approved confirmation. One stage value drives the button, the total, the
   scrawl and the stamp, so they can never disagree. */
function ProposalDoc({ p }: { p: ProposalContent }) {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const [stage, setStage] = useState<SendStage>("draft");

  useEffect(() => {
    if (!inView) return;
    // Reduced motion gets the outcome, with no press or loop.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setStage("approved"));
      return () => cancelAnimationFrame(id);
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const run = () => {
      setStage("draft");
      at(1500, () => {
        setStage("pressing");
      });
      at(1980, () => setStage("delivered"));
      at(4400, () => setStage("approved"));
      at(9200, run);
    };
    run();
    return () => timers.forEach(clearTimeout);
  }, [inView]);

  const sent = stage === "delivered" || stage === "approved";
  const approved = stage === "approved";
  const pressing = stage === "pressing";

  return (
    <div ref={ref} className="relative mx-auto max-w-[42rem]">
      <div
        className="lp-prop-doc overflow-hidden rounded-xl bg-white shadow-lp-mock"
      >
        {/* Editor chrome — one button, and it reports the whole flow */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 text-[12px] sm:px-5">
          <div className="flex items-center gap-2.5">
            <span className="font-semibold text-ink">&lsaquo; Proposals</span>
            <span className="hidden text-[#6a6a6a] sm:inline">
              {approved ? "Approved" : sent ? "Sent" : "Draft — saved"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden font-medium text-[#666666] sm:inline">Preview</span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-semibold ${
                approved
                  ? "bg-emerald-600 text-white"
                  : sent
                    ? "bg-lp-blue text-white"
                    : "bg-lp-ink text-white"
              }`}
              style={{
                transform: pressing ? "scale(.94)" : "scale(1)",
                transition:
                  "transform .28s cubic-bezier(.22,.61,.36,1), background-color .35s ease",
              }}
            >
              {approved ? (
                <>
                  <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden>
                    <path
                      d="M3 8.5l3.2 3L13 5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {p.client} approved the proposal
                </>
              ) : sent ? (
                /* No blinking dot (owner, 2026-08-25): a pulsing indicator on a
                   finished action reads as a bot thinking, not as a delivery. */
                <>
                  <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden>
                    <path d="M1.5 8L14.5 1.5 10 14.5l-2.6-4.4L1.5 8z" fill="currentColor" />
                  </svg>
                  Delivered to {p.client}
                </>
              ) : (
                <>
                  Send for approval
                  <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden>
                    <path d="M1.5 8L14.5 1.5 10 14.5l-2.6-4.4L1.5 8z" fill="currentColor" />
                  </svg>
                </>
              )}
            </span>
          </div>
        </div>

      {/* Document body */}
      <div className="mx-auto max-w-[38rem] px-5 pb-6 pt-6 sm:px-8">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] font-bold uppercase tracking-[1.4px] text-[#6a6a6a]">
            Proposal · #{p.number}
          </div>
          <div className="text-[10px] font-medium text-[#6a6a6a]">Valid 30 days</div>
        </div>
        <h3 className="mt-1.5 text-[clamp(18px,2vw,26px)] font-bold leading-[1.15] tracking-[-0.02em] text-ink">
          {p.title}
        </h3>
        <p className="mt-2.5 font-serif text-[12.5px] leading-[1.55] text-[#555555]">{p.blurb}</p>

        {/* Line items */}
        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
          {p.linesDesktop.map(([l, r], i) => (
            <div
              key={l}
              className={`flex items-center justify-between gap-4 px-3 py-1.5 text-[11.5px] ${
                i % 2 ? "bg-slate-50/60" : "bg-white"
              }`}
            >
              <span className="min-w-0 truncate text-[#555555]">{l}</span>
              <span className="shrink-0 font-semibold text-ink">{r}</span>
            </div>
          ))}
          <div
            className={`flex items-center justify-between border-t px-3 py-2 transition-colors duration-500 ${
              approved ? "border-emerald-200 bg-emerald-50/70" : "border-slate-200 bg-white"
            }`}
          >
            <span className="text-[12px] font-bold text-ink">Project total</span>
            <span className="text-[15px] font-bold tracking-tight text-ink"><Counter value={p.total} /></span>
          </div>
        </div>

        {/* Option and approval share a row so the plate stays short */}
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-[11.5px] font-bold text-ink">{p.option.name}</div>
              <div className="truncate text-[10px] text-[#6a6a6a]">{p.option.note}</div>
            </div>
            <span className="shrink-0 text-[12.5px] font-bold text-ink">{p.option.price}</span>
          </div>

          {/* Approval block. It drew a handwritten scrawl until 2026-09-18,
              which promised an e-signature the product does not have: the
              public accept route records no signature, no typed name and no
              signed-at. A tick and the client's name is what actually happens.
              The stamp lands on the corner of the block it belongs to rather
              than floating over the photo strip. */}
          <div className="relative rounded-lg border border-slate-200 px-3 py-2">
            {approved && (
              <div
                className="pointer-events-none absolute -top-3.5 right-1 z-10 -rotate-[9deg] rounded-md border-2 border-emerald-600/70 bg-white/85 px-2.5 py-0.5 text-[11.5px] font-black uppercase tracking-[0.2em] text-emerald-700/90"
                style={{ animation: "lpStamp .45s cubic-bezier(.2,.8,.3,1.2) backwards" }}
              >
                Accepted
              </div>
            )}
            <div className="text-[9.5px] font-bold uppercase tracking-[1.2px] text-[#6a6a6a]">
              Client approval
            </div>
            <div className="relative h-7">
              <svg viewBox="0 0 150 34" className="absolute inset-0 h-full w-[120px]" aria-hidden>
                <path
                  d="M8 19 l9 9 l20 -20"
                  fill="none"
                  stroke="#1854A0"
                  strokeWidth="2"
                  strokeLinecap="round"
                  pathLength={1}
                  style={{
                    strokeDasharray: 1,
                    strokeDashoffset: approved ? 0 : 1,
                    transition: "stroke-dashoffset 1.1s cubic-bezier(.4,0,.2,1)",
                  }}
                />
              </svg>
            </div>
            <div className="border-t border-slate-200 pt-1 text-[9.5px] text-[#6a6a6a]">
              {approved ? `${p.client} · approved today` : "Awaiting the client"}
            </div>
          </div>
        </div>

        {/* Reference photo — kept, but reduced to a strip so the plate fits */}
        <div className="mt-3 overflow-hidden rounded-lg">
          <Image
            src="/landing-d/service-remodel.jpg"
            alt="Reference photo included with the proposal"
            width={1104}
            height={520}
            className="block h-20 w-full object-cover"
          />
        </div>
        </div>
      </div>
    </div>
  );
}

const EXTRACTED: [string, string][] = [
  ["Framing lumber", "$102.72"],
  ["Drywall finishing", "$51.84"],
  ["Fasteners", "$28.90"],
];

function ReceiptCluster() {
  const { ref, inView } = useInView<HTMLDivElement>(0.4);
  // After each scan pass, line descriptions resolve into dollar amounts
  const [priced, setPriced] = useState(false);

  useEffect(() => {
    if (!inView) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setPriced(true));
      return () => cancelAnimationFrame(id);
    }
    const t = setInterval(() => setPriced((p) => !p), 2600);
    return () => clearInterval(t);
  }, [inView]);

  return (
    <div ref={ref} className="relative mx-auto max-w-[34rem] py-6">
      {/* receipt */}
      <div className="lp-prop-card relative w-[58%] -rotate-3 rounded-lg bg-white p-4 shadow-lp-card">
        <div className="text-center text-[10px] font-bold tracking-widest text-[#666666]">
          BIG BOX SUPPLY #214
        </div>
        <div className="mt-2 border-t border-dashed border-slate-200 pt-2 font-mono text-[10px] leading-[1.9] text-[#666666]">
          <div className="flex justify-between"><span>2X4X8 KD STUD ×24</span><span>102.72</span></div>
          <div className="flex justify-between"><span>JNT COMPOUND 4.5G ×3</span><span>51.84</span></div>
          <div className="flex justify-between"><span>DW SCREW 1-5/8 5LB</span><span>28.90</span></div>
          <div className="flex justify-between font-bold text-ink"><span>TOTAL</span><span>183.46</span></div>
        </div>
        {inView && (
          /* The scan runs on a transform (pass C): a carrier 80 % of the
             receipt tall slides down by its own height, the bar riding its
             top edge — 8 % to 88 %, as before, without a `top` animation. */
          <span
            className="pointer-events-none absolute inset-x-2 top-[8%] h-[80%]"
            style={{ animation: "scanline 2.6s cubic-bezier(.4,0,.4,1) .3s infinite" }}
            aria-hidden
          >
            <span className="absolute inset-x-0 top-0 h-[3px] rounded-full bg-lp-lime shadow-[0_0_14px_2px_rgb(209_255_25/0.9)]" />
          </span>
        )}
      </div>
      {/* extracted card */}
      <div className="lp-prop-card absolute right-0 top-10 w-[54%] rotate-2 rounded-lg bg-white p-4 shadow-lp-card">
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-600">
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-100 text-[8px]">✓</span>
          3 ITEMS EXTRACTED
        </div>
        <div className="mt-2.5 space-y-1.5">
          {EXTRACTED.map(([label, price], i) => (
            <div key={label} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-[#666666]">{label}</span>
              {priced ? (
                <span
                  key="price"
                  className="font-bold text-ink"
                  style={{ animation: `toast-in .35s cubic-bezier(.2,.6,.2,1) ${i * 0.12}s backwards` }}
                >
                  {price}
                </span>
              ) : (
                <span key="bar" className="h-1 w-10 rounded-full bg-slate-100" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* THE PAPER SHEET (owner, 2026-09-26): the section is the paper ground and
   the content lies on one white sheet of paper — a hairline edge and a
   slight lift at the bottom corners (proposals-pass.css). It replaced the
   2026-09-10 title sheet's double ink rule, corner ticks and SHEET 03 stamp,
   all removed. On a phone there is no sheet and no frame. The mocks keep a
   1 px ink line and a hard offset shadow (landing-e.css, .lp-props). */
export function ProposalsSection({ proposal = KITCHEN, registerHref = "/auth/register", cta = "Start my free trial" }: { proposal?: ProposalContent; registerHref?: string; cta?: string }) {
  return (
    <section
      id="proposals"
      className="lp-props relative overflow-hidden px-5 py-[8vmin] max-sm:pb-[16vmin] max-sm:pt-[16vmin] sm:px-6"
    >
      <div className="lp-props-wrap relative z-[1] mx-auto lp-wrap sm:py-14">
        <PaperSheet />
        <Reveal className="lp-props-copy">
          {/* The eyebrow is desktop-only: on a phone it just crowded the
              headline it was labelling (owner, 2026-08-25). */}
          <h2 className="lp-eyebrow hidden text-[#555555] sm:block">Proposals &amp; contracts</h2>
          <p className="lp-props-title max-w-[56rem] sm:mt-5 text-[clamp(36px,4.4vw,64px)] font-bold leading-[1.02] tracking-[-0.02em] text-ink">
            Send proposals clients can approve online.
          </p>
          <p className="mt-5 text-[17px] font-medium leading-[1.5] text-[#555555] sm:mt-7 sm:text-[clamp(19px,1.7vw,24px)]">
            A finished estimate becomes an approved job in one click.
          </p>
        </Reveal>

        <Reveal delay={120} className="mt-10 sm:hidden">
          <ProposalMobile p={proposal} />
        </Reveal>
        <Reveal delay={120} className="mt-14 hidden sm:block">
          <div data-parallax="22">
            <ProposalDoc p={proposal} />
          </div>
        </Reveal>

        {/* Sub-feature: receipts — text leads on mobile, cluster leads on desktop */}
        <div className="mt-[26vmin] grid items-center gap-10 sm:mt-[10vmin] lg:grid-cols-2 lg:gap-16">
          <Reveal className="order-2 lg:order-1">
            <ReceiptCluster />
          </Reveal>
          <Reveal delay={100} className="lp-props-copy order-1 lg:order-2">
            <h3 className="text-[clamp(26px,2.6vw,36px)] font-bold tracking-[-0.015em] text-ink">
              Save every receipt.
            </h3>
            <p className="mt-4 max-w-[30rem] text-[17px] leading-[1.5] text-[#555555] sm:text-[19px]">
              Photograph it at the counter. The scanner reads every line and
              files the cost to the right job.
            </p>
          </Reveal>
        </div>

        {/* Sub-feature: invoicing */}
        <div className="mt-[26vmin] grid items-center gap-10 sm:mt-[9vmin] lg:grid-cols-2 lg:gap-16">
          <Reveal className="lp-props-copy lg:order-1">
            <h3 className="text-[clamp(26px,2.6vw,36px)] font-bold tracking-[-0.015em] text-ink">
              Send invoices to clients.
            </h3>
            <p className="mt-4 max-w-[30rem] text-[17px] leading-[1.5] text-[#555555] sm:text-[19px]">
              Send the invoice when the work is done. Your client pays by
              card through Stripe or Square.
            </p>
          </Reveal>
          <Reveal delay={100} className="lg:order-2">
            <div className="w-full lg:mx-auto lg:max-w-[26rem]">
              <InvoiceMobile />
            </div>
          </Reveal>
        </div>

        {/* The section's CTA (pass B): the trial, and the sample proposal —
            public/samples/jobflex-sample-proposal.pdf, exported from the app's
            own proposal export so the page shows the real thing rather than a
            drawing of it. Opens in a new tab: a visitor reading the page is not
            done with it. Two buttons since 2026-09-26 (owner): the sample is
            the bordered secondary, the trial stays the blue primary; on a
            phone they stack full width, primary first. */}
        <Reveal className="mt-[12vmin] flex flex-col items-stretch gap-3 sm:mt-[8vmin] sm:flex-row sm:items-center sm:gap-4">
          <a href={registerHref} className="lp-btn-lime lp-trial-cta w-full sm:w-auto" data-cta="proposals">
            {cta}
            <span aria-hidden>→</span>
          </a>
          <a
            href="/samples/jobflex-sample-proposal.pdf"
            target="_blank"
            rel="noopener"
            className="lp-btn-sheet w-full sm:w-auto"
            data-cta="sample_pdf"
            aria-label="See a sample proposal (PDF, opens in a new tab)"
          >
            <FileText className="h-5 w-5 shrink-0" strokeWidth={1.9} aria-hidden />
            See a sample proposal
            <span className="lp-btn-sheet-tag" aria-hidden>PDF</span>
          </a>
        </Reveal>
      </div>
    </section>
  );
}

/* The white sheet the section's content lies on, and — a sibling beneath
   it, since a child cannot paint under its parent's background — the shadow
   of its two lifted bottom corners. Both fill the wrap; hidden on a phone. */
function PaperSheet() {
  return (
    <>
      <div className="lp-props-lift" aria-hidden />
      <div className="lp-props-sheet" aria-hidden />
    </>
  );
}
