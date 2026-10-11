/* THE DECK STUDIO'S OWN PICTURES (owner, 2026-10-11): the hero is a 3D deck
   on the photo of a house; under it three shots — the state's code check,
   the permit drawing set, the proposal signed and paid on the homeowner's
   phone — with one caption. Real captures from the studio live in
   public/landing-e/deck; a missing file shows its own labelled frame rather
   than a broken image, so the page never waits on a picture. */
import Link from "next/link";
import type { Route } from "next";
import { AppFrame, STAGE } from "./showcase-kit";

export const DECK_SHOTS = {
  hero: { src: "/landing-e/deck/hero.jpg", alt: "A deck designed in 3D against the photo of the house, in the Deck Studio", w: 1200, h: 760 },
  code: { src: "/landing-e/deck/code.jpg", alt: "The code checks: the state's residential code, the guard's height, the stair's risers", w: 900, h: 600 },
  permit: { src: "/landing-e/deck/permit.jpg", alt: "The permit drawing set: the framing plan with its schedules", w: 900, h: 600 },
  phone: { src: "/landing-e/deck/phone.jpg", alt: "The proposal on the homeowner's phone, signed and paid", w: 780, h: 1200 },
} as const;

export const DECK_SHOTS_CAPTION = "Design, permit and office in one place — by JobFlex";

/** The hero's product shot: the studio's 3D on the house photo, in the app frame the other trades' shots use. */
export function DeckShot() {
  const s = DECK_SHOTS.hero;
  return (
    <AppFrame path="/dashboard/deck-estimator" body="#e9eef3">
      <div className={STAGE}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a static capture of the studio, sized by its own attributes */}
        <img src={s.src} alt={s.alt} width={s.w} height={s.h} className="absolute inset-0 h-full w-full object-cover" fetchPriority="high" decoding="async" />
      </div>
    </AppFrame>
  );
}

const THREE: Array<{ key: "code" | "permit" | "phone"; title: string; words: string }> = [
  { key: "code", title: "Checked to your state's code", words: "Guards, risers and treads in the state's own figures, the edition named; a one-tap fix where it falls short." },
  { key: "permit", title: "The permit set, printed", words: "Framing plan, elevation, schedules and the code notes — the drawings the office asks for." },
  { key: "phone", title: "Signed and paid on their phone", words: "The proposal with the 3D on it, signed and paid from the homeowner's own page." },
];

/** The three shots under the hero, with the one caption and the sign-up button. */
export function DeckShots({ registerHref, cta }: { registerHref: string; cta: string }) {
  return (
    <section id="showcase" className="lp-deck-shots px-5 py-[8vmin] sm:px-6" data-deck-shots>
      <div className="mx-auto max-w-6xl">
        <h2 className="text-[clamp(26px,4vw,40px)] font-black leading-[1.05] tracking-tight text-ink [text-wrap:balance]">The whole deck job, from the yard to the signature.</h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-3">
          {THREE.map(({ key, title, words }) => {
            const s = DECK_SHOTS[key];
            return (
              <figure key={key} className="rounded-md border border-black/10 bg-white p-2 shadow-lp-mock" data-deck-shot={key}>
                <div className={key === "phone" ? "relative mx-auto aspect-[39/60] w-[62%] overflow-hidden rounded-[18px] bg-[#e9eef3]" : "relative aspect-[3/2] w-full overflow-hidden rounded-[4px] bg-[#e9eef3]"}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a static capture of the studio */}
                  <img src={s.src} alt={s.alt} width={s.w} height={s.h} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover object-top" />
                </div>
                <figcaption className="px-2 pb-2 pt-3">
                  <span className="block text-[15px] font-bold leading-tight text-ink">{title}</span>
                  <span className="mt-1 block text-[13px] leading-snug text-ink-muted">{words}</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
        <p className="mt-6 text-center font-mono text-[12px] uppercase tracking-[0.12em] text-ink-muted" data-deck-caption>{DECK_SHOTS_CAPTION}</p>
        <div className="mt-6 flex justify-center">
          <Link className="lp-btn-dark inline-flex items-center justify-center" href={registerHref as Route}>{cta}</Link>
        </div>
      </div>
    </section>
  );
}
