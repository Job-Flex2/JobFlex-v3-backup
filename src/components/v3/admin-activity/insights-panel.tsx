"use client";
// WHAT MEMBERS DO — the analyst's card on /admin/activity (owner, 2026-10-28: "analyze the user activity page …
// make some conclusions that will help us make the platform better … or give us some statistics. Make it smart.")
//
// One line of what is going on, then the findings — each a sentence of evidence with the numbers in it and one
// thing to do — then the tables they were read from: the screens members open (paying against lost side by side),
// a new workspace's first day, what the ones who paid did in week one, proposals opened and signed, estimators
// looked at and never used, when members work and where sittings end. All of it from lib/activityInsights; nothing
// here reads or writes.
import { AlertTriangle, CheckCircle2, Info, Lightbulb } from "lucide-react";
import { hourWord, pct, type ActivityInsights, type InsightFinding } from "@/lib/activityInsights";
import { Empty, KpiStrip, cx } from "@/components/v3/admin-influencers/admin-ui";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import s from "./insights.module.css";

const TONE_ICON: Record<InsightFinding["tone"], typeof Info> = { bad: AlertTriangle, warn: AlertTriangle, good: CheckCircle2, info: Info };
const TONE_WORD: Record<InsightFinding["tone"], string> = { bad: "Fix", warn: "Watch", good: "Working", info: "Note" };
const share = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const hours = (h: number | null) => (h === null ? "—" : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${h < 10 ? h.toFixed(1).replace(/\.0$/, "") : Math.round(h)} h` : `${(h / 24).toFixed(1).replace(/\.0$/, "")} days`);
const tradeWord = (t: string) => (t === "hvac" ? "HVAC" : t === "other" ? "No estimator named" : t.charAt(0).toUpperCase() + t.slice(1));

function Bar({ value, tone }: { value: number | null; tone?: "paying" | "lapsed" }) {
  return (
    <span className={s.barWrap} data-tone={tone}>
      <i style={{ width: `${Math.round(Math.max(0, Math.min(1, value ?? 0)) * 100)}%` }} />
      <b>{share(value)}</b>
    </span>
  );
}

function Block({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className={s.block}>
      <h3 className={s.blockTitle}>{title}</h3>
      <p className={s.blockSub}>{sub}</p>
      {children}
    </section>
  );
}

export function InsightsPanel({ insights: r, rangeWords, zoneWords }: { insights: ActivityInsights; rangeWords: string; zoneWords: string }) {
  const busyMax = Math.max(1, ...r.hours.byHour);
  const busy = new Set(r.hours.byHour.map((n, h) => (n >= busyMax * 0.6 && n > 0 ? h : -1)).filter((h) => h >= 0));
  const weekend = r.hours.byWeekday[0] + r.hours.byWeekday[6];
  return (
    <section className="card rv" data-insights>
      <div className={cx("card-head", ui.cardHead)}>
        <div className="card-titles">
          <div className="card-title">
            <Lightbulb size={15} aria-hidden="true" /> What members do
          </div>
          <div className="card-sub" data-insights-headline>
            {r.headline}
          </div>
          <div className={s.headNote}>
            {rangeWords} · read from the screens members opened, the trail and the plans · staff, test and hidden workspaces left out
            {r.truncated ? " · the newest rows only — the read hit its cap" : ""}
          </div>
        </div>
      </div>

      {r.quiet ? (
        <Empty>Too few workspaces were active in this range for the analyst to say anything it can back. Widen the range.</Empty>
      ) : (
        <>
          <KpiStrip
            cols={5}
            cells={[
              { label: "Active workspaces", value: String(r.sample.active) },
              { label: "New in the range", value: String(r.sample.newOnes) },
              { label: "Paying · trial · lost", value: `${r.sample.paying} · ${r.sample.trial} · ${r.sample.lapsed}` },
              { label: "Members seen", value: String(r.sample.members) },
              { label: `Typical sitting · ${r.sittings.medianScreens ?? 1} ${r.sittings.medianScreens === 1 ? "screen" : "screens"}`, value: r.sittings.medianMinutes === null ? "—" : `${Math.max(1, Math.round(r.sittings.medianMinutes))} min` },
            ]}
          />

          {r.findings.length > 0 && (
            <ol className={s.findings} data-insights-findings>
              {r.findings.map((f) => {
                const Icon = TONE_ICON[f.tone];
                return (
                  <li key={f.key} className={s.finding} data-tone={f.tone} data-finding={f.key}>
                    <span className={s.toneWord}>
                      <Icon size={13} aria-hidden="true" /> {TONE_WORD[f.tone]}
                    </span>
                    <div className={s.findingBody}>
                      <b className={s.findingTitle}>{f.title.charAt(0).toUpperCase() + f.title.slice(1)}</b>
                      <p className={s.evidence}>{f.evidence}</p>
                      <p className={s.action}>
                        <span>Do</span> {f.action}
                      </p>
                      {f.names?.length ? (
                        <div className={s.names}>
                          {f.names.map((n) => (
                            <em key={n}>{n}</em>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          <div className={s.grid}>
            <Block title="Screens members open" sub={`Of the ${r.sample.viewers} workspaces that opened anything in the range — and, beside it, the share among paying accounts and among lost trials.`}>
              <table className={s.tbl}>
                <thead>
                  <tr>
                    <th>Screen</th>
                    <th>Workspaces</th>
                    <th data-aside>Paying</th>
                    <th data-aside>Lost</th>
                  </tr>
                </thead>
                <tbody>
                  {r.areas.slice(0, 14).map((a) => (
                    <tr key={a.area}>
                      <td>{a.area}</td>
                      <td>
                        <Bar value={a.share} /> <small>{a.workspaces}</small>
                      </td>
                      <td data-aside>{a.payingShare === null ? <small>—</small> : <Bar value={a.payingShare} tone="paying" />}</td>
                      <td data-aside>{a.lapsedShare === null ? <small>—</small> : <Bar value={a.lapsedShare} tone="lapsed" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Block>

            <Block title="A new workspace's first day" sub={`The ${r.firstDay.newOnes} workspaces made in the range: what they did in their first 24 hours, and where the first sitting started and ended.`}>
              {r.firstDay.newOnes === 0 ? (
                <Empty>No workspace was made in this range.</Empty>
              ) : (
                <>
                  <table className={s.tbl}>
                    <tbody>
                      <tr>
                        <td>Priced an estimate</td>
                        <td>
                          <Bar value={r.firstDay.priced / r.firstDay.newOnes} /> <small>{r.firstDay.priced} of {r.firstDay.newOnes}</small>
                        </td>
                      </tr>
                      <tr>
                        <td>Wrote a proposal</td>
                        <td>
                          <Bar value={r.firstDay.proposed / r.firstDay.newOnes} /> <small>{r.firstDay.proposed}</small>
                        </td>
                      </tr>
                      <tr>
                        <td>Sent a proposal</td>
                        <td>
                          <Bar value={r.firstDay.sent / r.firstDay.newOnes} /> <small>{r.firstDay.sent}</small>
                        </td>
                      </tr>
                      <tr>
                        <td>Median first proposal</td>
                        <td>{r.firstDay.medianHoursToFirstProposal === null ? <small>none yet</small> : `${hours(r.firstDay.medianHoursToFirstProposal)} after sign-up`}</td>
                      </tr>
                      <tr>
                        <td>Nothing after three days</td>
                        <td>{r.firstDay.idle}</td>
                      </tr>
                    </tbody>
                  </table>
                  {r.firstDay.firstScreens.length > 0 && (
                    <p className={s.chips}>
                      <span>First sitting starts on</span>
                      {r.firstDay.firstScreens.map((x) => (
                        <em key={x.screen}>
                          {x.screen} <b>{x.n}</b>
                        </em>
                      ))}
                    </p>
                  )}
                  {r.firstDay.endsOn.length > 0 && (
                    <p className={s.chips}>
                      <span>…and ends on</span>
                      {r.firstDay.endsOn.map((x) => (
                        <em key={x.screen}>
                          {x.screen} <b>{x.n}</b>
                        </em>
                      ))}
                    </p>
                  )}
                </>
              )}
            </Block>

            <Block title="What the ones who paid did in week one" sub="Paying accounts against lost trials, both made in the range and at least a week old: the share of each that did the thing in its first seven days.">
              {r.cohorts ? (
                <table className={s.tbl}>
                  <thead>
                    <tr>
                      <th>In the first week</th>
                      <th>Paying ({r.cohorts.paying})</th>
                      <th>Lost ({r.cohorts.lapsed})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...r.cohorts.rows]
                      .sort((a, b) => b.gap - a.gap)
                      .map((c) => (
                        <tr key={c.what} data-gap={c.gap >= 0.25 ? "wide" : undefined}>
                          <td>{c.what}</td>
                          <td>
                            <Bar value={c.payingShare} tone="paying" />
                          </td>
                          <td>
                            <Bar value={c.lapsedShare} tone="lapsed" />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : (
                <Empty>Needs three paying accounts and three lost trials made in the range and at least a week old. Widen the range.</Empty>
              )}
            </Block>

            <Block title="Proposals sent in the range" sub="Sent, opened by the client, signed and paid — with the median wait for an open and for a signature.">
              {r.proposals.sent === 0 ? (
                <Empty>No proposal was sent in this range.</Empty>
              ) : (
                <>
                  <table className={s.tbl}>
                    <tbody>
                      <tr>
                        <td>Sent</td>
                        <td>{r.proposals.sent}</td>
                      </tr>
                      <tr>
                        <td>Opened by the client</td>
                        <td>
                          <Bar value={r.proposals.openRate} /> <small>{r.proposals.viewed}</small>
                        </td>
                      </tr>
                      <tr>
                        <td>Signed</td>
                        <td>
                          <Bar value={r.proposals.winRate} /> <small>{r.proposals.accepted}</small>
                        </td>
                      </tr>
                      <tr>
                        <td>Declined · paid</td>
                        <td>
                          {r.proposals.declined} · {r.proposals.paid}
                        </td>
                      </tr>
                      <tr>
                        <td>Median open · signature</td>
                        <td>
                          {hours(r.proposals.medianHoursToView)} · {hours(r.proposals.medianHoursToAccept)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  {r.proposals.byTrade.length > 0 && (
                    <p className={s.chips}>
                      <span>By estimator</span>
                      {r.proposals.byTrade.map((t) => (
                        <em key={t.trade}>
                          {tradeWord(t.trade)} <b>{t.sent}</b> sent · {pct(t.accepted, t.sent)} signed
                        </em>
                      ))}
                    </p>
                  )}
                </>
              )}
            </Block>

            <Block title="Estimators" sub="Estimates saved per estimator, the workspaces that saved them, and the workspaces that opened the screen and never priced anything.">
              {r.estimators.length === 0 ? (
                <Empty>No estimator was opened or used in this range.</Empty>
              ) : (
                <table className={s.tbl}>
                  <thead>
                    <tr>
                      <th>Estimator</th>
                      <th>Estimates</th>
                      <th>Workspaces</th>
                      <th>Looked, didn&apos;t price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.estimators.map((e) => (
                      <tr key={e.trade}>
                        <td>{e.area === e.trade ? tradeWord(e.trade) : e.area}</td>
                        <td>{e.estimates}</td>
                        <td>{e.workspaces}</td>
                        <td data-lookers={e.lookers > 0 && e.lookers >= e.workspaces ? "many" : undefined}>{e.lookers}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Block>

            <Block title="When members work, and where a sitting ends" sub={`Sittings by the hour they started (${zoneWords}); the busy hours are filled. A sitting is one member's screens with no gap of ten minutes.`}>
              {r.sittings.n === 0 ? (
                <Empty>No screens were opened in this range.</Empty>
              ) : (
                <>
                  <div className={s.hours} role="img" aria-label={`Sittings by hour: ${r.hours.byHour.map((n, h) => `${hourWord(h)} ${n}`).join(", ")}`}>
                    {r.hours.byHour.map((n, h) => (
                      <i key={h} data-busy={busy.has(h) ? "1" : undefined} style={{ height: `${Math.max(2, Math.round((n / busyMax) * 100))}%` }} title={`${hourWord(h)} · ${n}`} />
                    ))}
                  </div>
                  <div className={s.hourLabels}>
                    <span>12 am</span>
                    <span>6 am</span>
                    <span>12 pm</span>
                    <span>6 pm</span>
                  </div>
                  <p className={s.note}>
                    {r.hours.busy ? `Busy ${r.hours.busy}. ` : ""}
                    {pct(weekend, r.sittings.n)} of sittings on a weekend; {share(r.sittings.oneScreenShare)} are one screen and gone.
                  </p>
                  {r.sittings.endsOn.length > 0 && (
                    <p className={s.chips}>
                      <span>Sittings end on</span>
                      {r.sittings.endsOn.slice(0, 6).map((e) => (
                        <em key={e.screen} data-ratio={e.ratio >= 2 && e.n >= 10 ? "high" : undefined} title={`${e.n} sittings ended here (${pct(e.n, r.sittings.n)}); ${Math.round(e.viewShare * 100)}% of all screens opened`}>
                          {e.screen} <b>{e.n}</b>
                          {e.ratio >= 2 && e.n >= 10 ? ` · ${e.ratio.toFixed(1)}×` : ""}
                        </em>
                      ))}
                    </p>
                  )}
                </>
              )}
            </Block>
          </div>
        </>
      )}
    </section>
  );
}
