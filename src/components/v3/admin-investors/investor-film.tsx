"use client";

import { useEffect, useRef, useState } from "react";
import s from "./investor-film.module.css";

/* THE PITCH, ON THE INVESTORS PAGE (2026-10-25). Owner: "a professional video pitch for the investors link — what we
   have, our value, the estimators, the AI desk, the homeowner portal; emotional, professional". The film is
   advertisement/investor-pitch (real captures of the product, one narrator), about a minute and a half, 16:9.
   It sits above the figures on the shared link and on the admin page, with a poster until it is played; nothing is
   fetched until the reader presses play (preload none), so the figures load as fast as before. */

const FILM = { mp4: "/investors/pitch-16x9.mp4", poster: "/investors/pitch-poster.webp" } as const;
const LENGTH = "1:37";

/** The slides and the tour the other pages hold (./pitch, ./tour), named under the film when the link is known. */
export function InvestorFilm({ deckHref, tourHref }: { deckHref?: string | null; tourHref?: string | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const on = () => setPlaying(true);
    const off = () => setPlaying(false);
    v.addEventListener("play", on);
    v.addEventListener("pause", off);
    v.addEventListener("ended", off);
    return () => {
      v.removeEventListener("play", on);
      v.removeEventListener("pause", off);
      v.removeEventListener("ended", off);
    };
  }, []);

  const play = () => {
    const v = ref.current;
    if (!v) return;
    setStarted(true);
    void v.play().catch(() => {});
  };

  return (
    <section className={s.film} data-investor-film>
      <div className={s.head}>
        <div className={s.label}>The pitch · {LENGTH}</div>
        <p className={s.words}>
          What JobFlex is, in the product itself: the estimators, the AI desk, the crew, the homeowner side — one narrator, a minute and a half.
          {deckHref || tourHref ? (
            <>
              {" "}Prefer to read? {deckHref ? <a href={deckHref} data-investor-film-deck>The pitch deck</a> : null}
              {deckHref && tourHref ? " · " : null}
              {tourHref ? <a href={tourHref} data-investor-film-tour>The platform tour</a> : null}.
            </>
          ) : null}
        </p>
      </div>
      <div className={s.frame}>
        <video ref={ref} className={s.video} poster={FILM.poster} preload="none" controls={started} playsInline onClick={started ? undefined : play} data-investor-film-video>
          <source src={FILM.mp4} type="video/mp4" />
        </video>
        {!playing && !started ? (
          <button type="button" className={s.play} onClick={play} aria-label="Play the pitch" data-investor-film-play>
            <span className={s.playIcon} aria-hidden="true" />
            <span className={s.playWords}>Play the pitch</span>
          </button>
        ) : null}
      </div>
    </section>
  );
}
