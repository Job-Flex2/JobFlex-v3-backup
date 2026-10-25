"use client";
// THE PLATFORM TOUR (owner, 2026-10-25): JobFlex's real screens one at a time, in the order a job lives — win the
// work, estimate, sell, run the work, run the company — each with what it does in a sentence. Chapters jump, the strip
// below picks any screen, Play walks through them.
import { useEffect, useRef } from "react";
import Image from "next/image";
import { TOUR_CHAPTERS, TOUR_SHOTS, tourSrc } from "./tour-shots";
import { useSlides } from "./use-slides";
import s from "./investor-deck.module.css";

const pad = (n: number) => String(n).padStart(2, "0");

export function PlatformTour() {
  const total = TOUR_SHOTS.length;
  const { index, move, playing, togglePlay, swipe } = useSlides(total);
  const shot = TOUR_SHOTS[index];
  const chapter = TOUR_CHAPTERS.find((c) => c.key === shot.chapter)!;
  const strip = useRef<HTMLDivElement>(null);

  // The neighbours load ahead, so the next screen is there when it is asked for.
  useEffect(() => {
    for (const n of [index + 1, index - 1]) {
      const next = TOUR_SHOTS[n];
      if (next) { const img = new window.Image(); img.src = tourSrc(next.slug); }
    }
    const el = strip.current?.querySelector<HTMLElement>(`[data-thumb="${index}"]`);
    if (el && strip.current) strip.current.scrollTo({ left: el.offsetLeft - strip.current.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
  }, [index]);

  return (
    <section className={s.tour} data-tour aria-roledescription="slideshow" aria-label="The JobFlex platform">
      <div className={s.chapters} role="tablist" aria-label="Chapters">
        {TOUR_CHAPTERS.map((c) => {
          const first = TOUR_SHOTS.findIndex((x) => x.chapter === c.key);
          const n = TOUR_SHOTS.filter((x) => x.chapter === c.key).length;
          return (
            <button key={c.key} type="button" role="tab" aria-selected={c.key === shot.chapter} className={s.chapter} onClick={() => move(first)} data-chapter={c.key}>
              {c.label}<i>{n}</i>
            </button>
          );
        })}
      </div>

      <div className={s.tourMain}>
        <figure className={s.stage} data-kind={shot.kind} {...swipe} aria-live="polite">
          {shot.kind === "desk" ? (
            <div className={s.browser} key={shot.slug}>
              <div className={s.browserBar} aria-hidden="true"><i /><i /><i /><span>jobflex.app</span></div>
              <div className={s.browserBody}>
                <Image draggable={false} src={tourSrc(shot.slug)} alt={shot.title} width={shot.w} height={shot.h} sizes="(max-width: 860px) 100vw, 760px" className={s.shotImg} style={{ objectPosition: shot.focus ?? "top" }} loading="eager" />
              </div>
            </div>
          ) : (
            <div className={s.phone} key={shot.slug}>
              <Image draggable={false} src={tourSrc(shot.slug)} alt={shot.title} width={shot.w} height={shot.h} sizes="320px" className={s.shotImg} loading="eager" />
            </div>
          )}
        </figure>

        <div className={s.caption}>
          <div className={s.capKicker} data-tour-count>{chapter.label} · {pad(index + 1)} / {pad(total)}</div>
          <h2 className={s.capTitle} data-tour-title>{shot.title}</h2>
          <p className={s.capText}>{shot.text}</p>
          <p className={s.capChapter}>{chapter.line}</p>
          <div className={s.controls}>
            <button type="button" className={s.ctl} onClick={() => move(index - 1)} disabled={index === 0} aria-label="Previous screen">←</button>
            <button type="button" className={`${s.ctl} ${s.ctlMain}`} onClick={() => move(index + 1)} disabled={index === total - 1} data-tour-next>Next →</button>
            <button type="button" className={s.ctl} onClick={togglePlay} aria-pressed={playing} data-tour-play>{playing ? "Pause" : "Play"}</button>
          </div>
          <p className={s.hint}>The arrow keys work too — or swipe the screen. <a href={tourSrc(shot.slug)} target="_blank" rel="noreferrer" data-tour-full>Full size ↗</a></p>
        </div>
      </div>

      <div className={s.strip} ref={strip} aria-label="Every screen">
        {TOUR_SHOTS.map((x, n) => (
          <button key={x.slug} type="button" className={s.thumb} data-thumb={n} aria-current={n === index ? "true" : undefined} onClick={() => move(n)} title={x.title}>
            <Image draggable={false} src={tourSrc(x.slug)} alt="" width={x.w} height={x.h} sizes="120px" className={s.thumbImg} data-kind={x.kind} />
            <span>{x.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
