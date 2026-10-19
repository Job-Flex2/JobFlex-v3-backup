import { TrialStartLabel } from "@/components/providers/trial-offer";
import { CookieSettingsLink, DoNotSellLink } from "@/components/consent/cookie-settings-link";
import { Logo } from "./logo";
import { REGISTER } from "./routes";
import { Reveal } from "./reveal";
import { Counter } from "./counter";

/* Only routes that exist are linked (CRO stage 2, 2026-09-09). Pricing left
   the footer with the nav link (owner, 2026-09-26); /pricing itself stays. */
const LINKS: [string, string][] = [
  ["About", "/about"],
  ["Client portal", "/homeowner"],
];

/* 44 px targets on a phone; one text row on a desktop. */
const LINK = "inline-flex min-h-[44px] items-center transition-colors hover:text-white md:min-h-0";

export function CtaFooter({
  registerHref = REGISTER,
  cta,
  terms,
}: {
  registerHref?: string;
  /** A trade variant's primary CTA words; the default page keeps its own. */
  cta?: string;
  /** hvac2 only: the trial's two lines of terms under the button, as under every
   *  button on that page (hvac2/hvac2-terms). Absent everywhere else. */
  terms?: [string, string];
}) {
  return (
    <section id="final" className="relative overflow-hidden bg-lp-base px-5 text-white sm:px-6">
      <div className="lp-bg lp-bg--roofs" aria-hidden data-lazy />
      {/* Final CTA */}
      <div id="final-cta" className="relative z-[1] mx-auto flex max-w-[86rem] flex-col items-center py-[12vmin] text-center max-sm:pb-[22vmin] max-sm:pt-[16vmin]">
        <Reveal>
          <h2 className="lp-eyebrow text-lp-sky">Run a tighter shop</h2>
          {/* The fact all in white, the turn in sky (owner, 2026-09-26):
              #4A9EFF on the ink is 6.5:1. */}
          <p className="mx-auto mt-8 max-w-[54rem] text-[clamp(30px,4vw,56px)] font-bold leading-[1.12] tracking-[-0.02em] text-white">
            Last week, <Counter value="4,812" /> estimates went out the door through JobFlex.
          </p>
          <p className="mt-3 text-[clamp(30px,4vw,56px)] font-bold leading-[1.1] tracking-[-0.02em] text-lp-sky">
            Today, it&rsquo;s your turn.
          </p>
          {/* One button, both viewports (owner, 2026-08-25). The white mobile
              variant and the blue one were rendering together — `.jf-lp
              .lp-btn-lime` sets display and outranks Tailwind's `hidden` — and
              two primaries stacked is a choice, not a CTA. Blue keeps the page
              on one accent and is the only colour in this black section. */}
          <div className="mt-10 w-full sm:mt-12 sm:w-auto">
            <a href={registerHref} className="lp-btn-lime lp-trial-cta w-full sm:w-auto" data-cta="footer">
              {cta ?? <TrialStartLabel />}
              <span aria-hidden>→</span>
            </a>
            {terms ? (
              <p className="lp-h2-final-terms">
                <span>{terms[0]}</span>
                <span>{terms[1]}</span>
              </p>
            ) : null}
          </div>
        </Reveal>
      </div>

      {/* Footer, compacted (owner, 2026-09-26): one row — the mark, the pages
          that exist, the rating — then one legal row. The planned five-column
          site map had two links in it and took ~400 px; it returns when the
          pages do. The legal row carries the two consent links (2026-09-10):
          14 px, white/60 (5.6:1 on the ink). */}
      <footer className="relative z-[1] border-t border-white/[0.07]">
        <div className="mx-auto lp-wrap pb-[calc(16px+env(safe-area-inset-bottom))] pt-5 md:py-6">
          <div className="flex items-center justify-between gap-x-3 md:gap-x-8">
            <div className="flex shrink-0 items-center gap-x-9">
              <Logo dark />
              <nav aria-label="Footer" className="hidden items-center gap-x-8 text-[15px] font-medium text-white/70 md:flex">
                {LINKS.map(([label, href]) => (
                  <a key={href} href={href} className={LINK}>
                    {label}
                  </a>
                ))}
              </nav>
            </div>
            <span className="flex shrink-0 items-center overflow-hidden rounded-md text-[14px] font-semibold ring-1 ring-white/15">
              <span className="flex items-center gap-1.5 bg-white/[0.08] px-2 py-1 md:px-3 md:py-1.5">
                <span className="text-lp-gold" aria-hidden>★</span> 4.9
              </span>
              <span className="whitespace-nowrap px-2 py-1 text-white/60 md:px-3 md:py-1.5">
                2,300+ <span className="max-sm:hidden">contractor </span>reviews
              </span>
            </span>
          </div>

          <div className="mt-3 flex flex-col-reverse gap-y-1 border-t border-white/[0.07] pt-2 text-[14px] text-white/60 md:mt-5 md:flex-row md:items-center md:justify-between md:gap-x-8 md:pt-4">
            <span className="md:shrink-0">
              © 2026 JobFlex
              <span className="hidden lg:inline"> — The operating system for small-shop contractors.</span>
            </span>
            <span className="flex flex-wrap items-center gap-x-5 md:justify-end md:gap-x-6 md:gap-y-1">
              {LINKS.map(([label, href]) => (
                <a key={href} href={href} className={`${LINK} md:hidden`}>
                  {label}
                </a>
              ))}
              <a href="/terms" className={LINK}>Terms</a>
              <a href="/privacy" className={LINK}>Privacy</a>
              <CookieSettingsLink className={LINK} />
              <DoNotSellLink className={`${LINK} text-left`} />
            </span>
          </div>
        </div>
      </footer>
    </section>
  );
}
