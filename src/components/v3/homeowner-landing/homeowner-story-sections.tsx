// "WHY JOBFLEX" AND "GOOD TO KNOW" (2026-10-28) — two sections both homeowner pages draw (the desk build and the
// handheld one), from one set of words (./homeowner-story). The shells are the pages' own section classes (`steps`,
// `sec-in`, `sec-n`, `sec-h`), so they sit in each page's rhythm; the insides are this module's. Visible at rest — no
// scroll reveal. Server-safe: no state; the questions open with <details>.
import { STORY_ROWS, storyQuestions } from "./homeowner-story";
import s from "./homeowner-story.module.css";

/** `top`: the page's own anchor for the box at the top (#top on a desk, #jfmh-top on a phone). */
export function WhyJobflex({ top }: { top: string }) {
  return (
    <section className="steps" id={top === "#top" ? "why" : "jfmh-why"} data-home-why>
      <div className="sec-in">
        <div className="sec-n">Why JobFlex</div>
        <h2 className="sec-h">
          Know the price. <span className="inv">Meet one pro.</span>
        </h2>
        <div className={s.why}>
          <div className={s.head} aria-hidden="true">
            <span />
            <span className={s.headUsual}>The usual way</span>
            <span className={s.headJf}>With JobFlex</span>
          </div>
          {STORY_ROWS.map((r) => (
            <div className={s.row} key={r.topic}>
              <div className={s.topic}>{r.topic}</div>
              <div className={s.usual}>
                <span className={s.tag}>Usually</span>
                {r.usual}
              </div>
              <div className={s.jf}>
                <span className={s.tick} aria-hidden="true">✓</span>
                <span>
                  <span className={s.tag}>JobFlex</span>
                  {r.jobflex}
                </span>
              </div>
            </div>
          ))}
          <div className={s.foot}>
            <span>Free for homeowners · No account, no password · A price in about a minute</span>
            <a className={s.go} href={top} data-cta="why">
              See your price
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export function StoryQuestions({ house, top }: { house: boolean; top: string }) {
  return (
    <section className="steps" id={top === "#top" ? "questions" : "jfmh-questions"} data-home-questions>
      <div className="sec-in">
        <div className="sec-n">Good to know</div>
        <h2 className="sec-h">
          Questions, <span className="inv">answered.</span>
        </h2>
        <div className={s.qs}>
          {storyQuestions(house).map((x, i) => (
            <details className={s.q} key={x.q} open={i < 2}>
              <summary className={s.qT}>
                {x.q}
                <span className={s.qMark} aria-hidden="true" />
              </summary>
              <p className={s.qA}>{x.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
