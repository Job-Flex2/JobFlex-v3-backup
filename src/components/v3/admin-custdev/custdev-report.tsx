// CUSTOMER DEVELOPMENT · THE REPORT (owner, 2026-10-22: "we're going to show it to investors as well — but don't add
// anything to the investors link"). /admin/customer-development/report — admin only, drawn without the console's
// chrome, made to be printed or saved as a PDF and handed over. The same figures as the page, in the order an
// investor reads them; customers by trade and state, never by name (lib/custDev/model `anonymous`).
import type { CustDevView } from "@/lib/custDev/read";
import { AREAS, THEMES, anonymous, pct, targetWords } from "@/lib/custDev/model";
import { PrintButton } from "./custdev-print";
import { SHOWN_WORDS_PLAIN } from "./custdev-words";
import r from "./custdev-report.module.css";

const AREA = Object.fromEntries(AREAS.map((a) => [a.key, a.label]));
const asOf = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export function CustDevReport({ view }: { view: CustDevView }) {
  const m = view.measures;
  const steps = view.stages;
  const current = steps.find((s) => s.key === view.current);
  const funnelBy = new Map(view.funnel.map((f) => [f.key, f]));
  const themes = view.voice.themes.filter((t) => t.companies > 0).slice(0, 5);
  const hyps = view.hypotheses.filter((h) => !h.archived);
  const st = view.interviewStats;
  const quotes = view.interviews.filter((i) => i.quote.trim()).slice(0, 4);
  const next = [
    ...(view.synthesis?.nextExperiments ?? []).map((x) => ({ title: x.title, detail: x.detail })),
    ...hyps.filter((h) => h.shown === "early" || h.shown === "testing").map((h) => ({ title: h.statement, detail: `Test: ${h.test}${h.metric ? ` (bar ${targetWords(h)})` : ""}.` })),
  ].slice(0, 6);
  const tradeRows = view.segments.trade.slice(0, 8);

  return (
    <main className={r.doc} data-custdev-report>
      <header className={r.top}>
        <div>
          <div className={r.brand}>JobFlex</div>
          <h1 className={r.title}>Customer development</h1>
          <p className={r.sub}>Where we are, who our customer is, and what we have proven — as of {asOf(view.now)}.</p>
        </div>
        <PrintButton />
      </header>

      <section className={r.sec}>
        <h2 className={r.h2}>Where we are</h2>
        <p className={r.p}>
          We follow Steve Blank&apos;s customer development: discovery, validation, creation, company building. A step is passed when every check under it is met. We are in <b>{current?.label.toLowerCase() ?? "customer discovery"}</b>.
        </p>
        <ol className={r.steps}>
          {steps.map((s, i) => (
            <li key={s.key} className={r.step} data-now={s.key === view.current || undefined} data-done={s.done || undefined}>
              <div className={r.stepHead}>
                <span className={r.stepNo}>{i + 1}</span>
                <span className={r.stepName}>{s.label}</span>
                <span className={r.stamp} data-tone={s.done ? "ok" : s.key === view.current ? "bp" : "mute"}>{s.done ? "Passed" : s.key === view.current ? "In progress" : "Ahead"}</span>
              </div>
              <ul className={r.checks}>
                {s.criteria.map((c) => (
                  <li key={c.label} data-met={c.met || undefined}>
                    <span className={r.box} aria-hidden="true">{c.met ? "✓" : ""}</span>
                    <span>
                      {c.label}
                      <small>{c.now}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      <section className={r.sec}>
        <h2 className={r.h2}>Key figures</h2>
        <div className={r.figs}>
          <Fig label="Contractors signed up" value={String(view.totals.signups)} />
          <Fig label="Used an estimator in week 1" value={pct(m.activation)} note={m.activation.of ? `${m.activation.n} of ${m.activation.of}` : undefined} />
          <Fig label="Sent a proposal" value={String(funnelBy.get("sent")?.n ?? 0)} />
          <Fig label="Finished trials that paid" value={pct(m.trialToPaid)} note={m.trialToPaid.of ? `${m.trialToPaid.n} of ${m.trialToPaid.of}` : undefined} />
          <Fig label="Paying now" value={String(view.totals.payingNow)} />
          <Fig label="Still paying after a month" value={pct(m.retention30)} note={m.retention30.of ? `${m.retention30.n} of ${m.retention30.of}` : undefined} />
        </div>
        <p className={r.fine}>Rates count only accounts that have had the chance — a week old for week-1 use, a finished trial for trial → paid. Internal and test accounts are left out.</p>
      </section>

      <section className={r.sec}>
        <h2 className={r.h2}>Who our customer is</h2>
        <p className={r.p}>
          {view.segments.early ? (
            <>
              <b>{view.segments.early.key} contractors</b> turn trials into paying customers {view.segments.early.lift.toFixed(1)}× as often as the average — our early adopters so far.
            </>
          ) : (
            <>No trade has enough finished trials yet to name an early adopter; the table is the evidence so far.</>
          )}
        </p>
        <table className={r.table}>
          <thead>
            <tr>
              <th>Trade</th>
              <th>Sign-ups</th>
              <th>Week-1 use</th>
              <th>Sent a proposal</th>
              <th>Trial → paid</th>
              <th>Paying</th>
            </tr>
          </thead>
          <tbody>
            {tradeRows.map((t) => (
              <tr key={t.key}>
                <td>{t.key}</td>
                <td>{t.signups}</td>
                <td>{pct(t.activation)}</td>
                <td>{pct(t.sentProposal)}</td>
                <td>{pct(t.trialToPaid)}{t.trialToPaid.of ? <small> of {t.trialToPaid.of}</small> : null}</td>
                <td>{t.payingNow}</td>
              </tr>
            ))}
            <tr className={r.total}>
              <td>All</td>
              <td>{view.segments.overall.signups}</td>
              <td>{pct(view.segments.overall.activation)}</td>
              <td>{pct(view.segments.overall.sentProposal)}</td>
              <td>{pct(view.segments.overall.trialToPaid)}</td>
              <td>{view.segments.overall.payingNow}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className={r.sec}>
        <h2 className={r.h2}>What customers tell us</h2>
        <p className={r.p}>
          {view.voice.total} messages from {view.voice.companies} companies — support tickets and their email threads, cancellation reasons, trial notes — sorted into themes and counted by company.
        </p>
        {view.synthesis?.headline ? <p className={r.lead}>{view.synthesis.headline}</p> : null}
        {themes.length ? (
          <ul className={r.themes}>
            {themes.map((t) => (
              <li key={t.key}>
                <div className={r.themeHead}>
                  <b>{t.label}</b>
                  <span>
                    {t.companies} {t.companies === 1 ? "company" : "companies"}
                  </span>
                </div>
                {t.quotes.slice(0, 2).map((q) => (
                  <blockquote key={q.id} className={r.quote}>
                    “{q.text}”<cite>— {anonymous(q.trade, q.region)}</cite>
                  </blockquote>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <p className={r.fine}>Nothing written by customers yet.</p>
        )}
        {view.voice.tools.length ? <p className={r.fine}>Tools they named: {view.voice.tools.map((t) => `${t.name} (${t.companies})`).join(", ")}.</p> : null}
      </section>

      <section className={r.sec}>
        <h2 className={r.h2}>Hypotheses and evidence</h2>
        <table className={r.table}>
          <thead>
            <tr>
              <th>Area</th>
              <th>We believe</th>
              <th>The test</th>
              <th>Evidence</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {hyps.map((h) => (
              <tr key={h.id}>
                <td>{AREA[h.area]}</td>
                <td className={r.wide}>{h.statement}</td>
                <td>
                  {h.test}
                  {h.metric ? <small> · {targetWords(h)}</small> : null}
                </td>
                <td>
                  {h.evidence?.shown ?? "Interviews"}
                  {h.interviews.supports || h.interviews.refutes ? <small> · interviews +{h.interviews.supports} / −{h.interviews.refutes}</small> : null}
                </td>
                <td>
                  <span className={r.stamp} data-tone={SHOWN_WORDS_PLAIN[h.shown].tone}>{SHOWN_WORDS_PLAIN[h.shown].label}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={r.sec}>
        <h2 className={r.h2}>Discovery interviews</h2>
        <div className={r.figs}>
          <Fig label="Interviews" value={String(st.total)} note={st.total ? `${st.byKind.problem} problem · ${st.byKind.solution} solution · ${st.byKind.validation} validation · ${st.byKind.exit} exit` : undefined} />
          <Fig label="Rate the pain 4 or 5" value={pct(st.painHigh)} note={st.painHigh.of ? `${st.painHigh.n} of ${st.painHigh.of}` : undefined} />
          <Fig label="Would pay" value={pct(st.wouldPay)} note={st.wouldPay.of ? `${st.wouldPay.n} of ${st.wouldPay.of}${st.maybe ? `, ${st.maybe} maybe` : ""}` : undefined} />
          <Fig label="Price they named" value={st.priceMedian === null ? "—" : `$${st.priceMedian}/mo`} note={st.priceMedian === null ? undefined : "median"} />
        </div>
        {quotes.length ? (
          <div className={r.quotes}>
            {quotes.map((q) => (
              <blockquote key={q.id} className={r.quote}>
                “{q.quote}”<cite>— {anonymous(q.trade, null)}</cite>
              </blockquote>
            ))}
          </div>
        ) : null}
        {st.tools.length ? <p className={r.fine}>What they use today: {st.tools.map((t) => `${t.name} (${t.n})`).join(", ")}.</p> : null}
      </section>

      <section className={r.sec}>
        <h2 className={r.h2}>From sign-up to paying</h2>
        <table className={r.table}>
          <tbody>
            {view.funnel.map((f) => (
              <tr key={f.key}>
                <td className={r.wide}>{f.label}</td>
                <td>{f.n}</td>
                <td>{f.ofAll === null ? "" : `${pct(f.ofAll)} of sign-ups`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className={r.table}>
          <thead>
            <tr>
              <th>Week of</th>
              <th>Sign-ups</th>
              <th>Week-1 use</th>
              <th>Sent a proposal</th>
              <th>Paid</th>
            </tr>
          </thead>
          <tbody>
            {view.cohorts.slice(-8).map((c) => (
              <tr key={c.week}>
                <td>{c.label}</td>
                <td>{c.signups}</td>
                <td>{pct(c.activation)}</td>
                <td>{pct(c.sentProposal)}</td>
                <td>{pct(c.paid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {next.length ? (
        <section className={r.sec}>
          <h2 className={r.h2}>What we test next</h2>
          <ol className={r.next}>
            {next.map((n) => (
              <li key={n.title}>
                <b>{n.title}</b> {n.detail}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <footer className={r.foot}>
        Figures from JobFlex&apos;s own records and support inbox, {asOf(view.now)}. Customers are shown by trade and state only. Themes are sorted by rule ({THEMES.length} themes) and counted by company.
      </footer>
    </main>
  );
}

function Fig({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className={r.fig}>
      <div className={r.figL}>{label}</div>
      <div className={r.figV}>{value}</div>
      {note ? <div className={r.figN}>{note}</div> : null}
    </div>
  );
}
