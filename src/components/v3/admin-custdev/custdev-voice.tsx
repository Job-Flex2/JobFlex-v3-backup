"use client";
// Customer development · Voice of the customer (owner, 2026-10-22: "support reflects the emails, so make it smart").
// Everything customers wrote — support tickets and every message under them, by email or in the app; cancellation
// reasons and the words under Other; trial-extension notes — sorted into themes by rule (lib/custDev/model THEMES),
// counted by company, with their own words; the tools they name; and the AI's reading of it all on request.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CustDevView } from "@/lib/custDev/read";
import { THEMES, quoteFor, themeLabel, type ThemeKey, type VoiceSource } from "@/lib/custDev/model";
import { custDevSynthesize } from "@/actions/custDev";
import { reasonLabel } from "@/lib/cancelFeedback";
import { Chip, Empty, cx } from "@/components/v3/admin-influencers/admin-ui";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import { Bar, Source, SOURCE_WORDS, dateWords, shortWords } from "./custdev-parts";
import s from "./custdev.module.css";

const PAGE = 40;

export function VoiceTab({ view }: { view: CustDevView }) {
  const router = useRouter();
  const [theme, setTheme] = useState<ThemeKey | "all">("all");
  const [source, setSource] = useState<VoiceSource | "all">("all");
  const [shown, setShown] = useState(PAGE);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const v = view.voice;
  const maxCompanies = Math.max(1, ...v.themes.map((t) => t.companies));
  const rows = useMemo(() => view.voiceRows.filter((r) => (theme === "all" || r.themes.includes(theme)) && (source === "all" || r.source === source)), [view.voiceRows, theme, source]);
  const syn = view.synthesis;

  const read = () =>
    start(async () => {
      setError(null);
      const r = await custDevSynthesize();
      if (!r.ok) setError(r.error);
      router.refresh();
    });

  return (
    <>
      <section className="card" aria-labelledby="cd-ai">
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title" id="cd-ai">What customers are telling us</div>
            <div className="card-sub">{syn ? `The AI read ${syn.read} messages on ${dateWords(syn.at)}.` : "The AI reads every message below and names the pains, the requests and the next tests."}</div>
          </div>
          <button type="button" className={cx("btn", syn ? ui.btnGhost : "btn-primary", ui.btnSm, s.tap, busy && ui.btnBusy)} disabled={busy || !v.total} onClick={read} data-custdev-synthesize>
            {busy ? "Reading…" : syn ? "Read again" : "Summarize with AI"}
          </button>
        </div>
        {error ? <p className={s.err} role="alert">{error}</p> : null}
        {syn ? (
          <div className={s.syn} data-custdev-synthesis>
            {syn.headline ? <p className={s.synHead}>{syn.headline}</p> : null}
            <div className={s.synCols}>
              {syn.pains.length ? (
                <div>
                  <div className={s.secL}>Pains</div>
                  <ol className={s.synList}>
                    {syn.pains.map((p) => (
                      <li key={p.title}>
                        <b>{p.title}</b>
                        {p.companies ? <span className={s.synN}> · {p.companies} {p.companies === 1 ? "company" : "companies"}</span> : null}
                        <span className={s.synDetail}>{p.detail}</span>
                        {p.quote ? <q className={s.synQuote}>{p.quote}</q> : null}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {syn.requests.length ? (
                <div>
                  <div className={s.secL}>Requests</div>
                  <ol className={s.synList}>
                    {syn.requests.map((p) => (
                      <li key={p.title}>
                        <b>{p.title}</b>
                        {p.companies ? <span className={s.synN}> · {p.companies}</span> : null}
                        <span className={s.synDetail}>{p.detail}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {syn.objections.length ? (
                <div>
                  <div className={s.secL}>Objections</div>
                  <ol className={s.synList}>
                    {syn.objections.map((p) => (
                      <li key={p.title}>
                        <b>{p.title}</b>
                        <span className={s.synDetail}>{p.detail}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {syn.nextExperiments.length ? (
                <div>
                  <div className={s.secL}>Next tests</div>
                  <ol className={s.synList}>
                    {syn.nextExperiments.map((p) => (
                      <li key={p.title}>
                        <b>{p.title}</b>
                        <span className={s.synDetail}>{p.detail}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </div>
            {syn.earlyAdopter ? (
              <p className={s.note}>
                <b>Early adopters:</b> {syn.earlyAdopter}
              </p>
            ) : null}
          </div>
        ) : !v.total ? (
          <Empty>Nothing written by customers yet — support tickets, cancellation reasons and trial notes appear here as they come in.</Empty>
        ) : null}
      </section>

      <div className={s.two}>
        <section className="card" aria-labelledby="cd-themes">
          <div className={cx("card-head", ui.cardHead)}>
            <div className="card-titles">
              <div className="card-title" id="cd-themes">Themes</div>
              <div className="card-sub">{v.total} messages from {v.companies} companies · counted by company, so one loud customer is one.</div>
            </div>
          </div>
          <ul className={s.themes}>
            {v.themes.map((t) => (
              <li key={t.key}>
                <button type="button" className={cx(s.theme, theme === t.key && s.themeOn)} aria-pressed={theme === t.key} disabled={!t.items} onClick={() => { setTheme(theme === t.key ? "all" : t.key); setShown(PAGE); }} data-custdev-theme={t.key}>
                  <span className={s.themeName}>{t.label}</span>
                  <Bar value={t.companies} max={maxCompanies} tone={t.tone === "ok" ? "ok" : t.tone === "bad" ? "bad" : t.tone === "wait" ? "wait" : t.tone === "bp" ? "bp" : "mute"} />
                  <span className={s.themeN}>
                    {t.companies} <small>{t.companies === 1 ? "company" : "companies"} · {t.items} msg{t.recent ? ` · ${t.recent} in 90 days` : ""}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="card" aria-labelledby="cd-tools">
          <div className={cx("card-head", ui.cardHead)}>
            <div className="card-titles">
              <div className="card-title" id="cd-tools">What they use besides us</div>
              <div className="card-sub">Tools named in tickets, emails, notes and interviews.</div>
            </div>
          </div>
          {v.tools.length || view.interviewStats.tools.length ? (
            <ul className={s.tools}>
              {mergeTools(v.tools, view.interviewStats.tools).map((t) => (
                <li key={t.name}>
                  <span className={s.toolName}>{t.name}</span>
                  <span className={s.toolN}>{t.n}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No tool named yet. Ask in every interview: “What do you use today?”</Empty>
          )}
        </section>
      </div>

      <section className="card" aria-labelledby="cd-msgs">
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title" id="cd-msgs">In their words</div>
            <div className="card-sub">{theme === "all" ? "Newest first." : `About ${themeLabel(theme).toLowerCase()} — newest first.`}</div>
          </div>
          <div className={s.cardActs}>
            <label className={s.pickInline}>
              <span className="sr-only">Theme</span>
              <span className="bp-sel bp-sel--admin">
                <select className="bp-sel-in" value={theme} onChange={(e) => { setTheme(e.target.value as ThemeKey | "all"); setShown(PAGE); }} data-custdev-theme-pick>
                  <option value="all">Every theme</option>
                  {THEMES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <label className={s.pickInline}>
              <span className="sr-only">Source</span>
              <span className="bp-sel bp-sel--admin">
                <select className="bp-sel-in" value={source} onChange={(e) => { setSource(e.target.value as VoiceSource | "all"); setShown(PAGE); }}>
                  <option value="all">Every source</option>
                  {(Object.keys(SOURCE_WORDS) as VoiceSource[]).map((k) => (
                    <option key={k} value={k}>
                      {SOURCE_WORDS[k]}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          </div>
        </div>
        {rows.length === 0 ? (
          <Empty>{view.voiceRows.length ? "Nothing here with these filters." : "Nothing written by customers yet."}</Empty>
        ) : (
          <ul className={s.msgs}>
            {rows.slice(0, shown).map((r) => (
              <li key={r.id} className={s.msg} data-custdev-msg={r.source}>
                <div className={s.msgHead}>
                  <Source source={r.source} />
                  <span className={s.msgCompany}>{r.company}</span>
                  <span className={s.msgTrade}>{r.trade}</span>
                  <span className={s.msgDate}>{shortWords(r.at)}</span>
                </div>
                {r.text.trim() ? <p className={s.msgText}>{r.text.length > 600 ? `${quoteFor(r.text, theme === "all" ? r.themes[0] ?? null : theme)} …` : r.text}</p> : null}
                {r.reasons?.length ? <p className={s.msgReasons}>Ticked: {r.reasons.map(reasonLabel).join(" · ")}</p> : null}
                {r.themes.length ? (
                  <div className={s.msgThemes}>
                    {r.themes.map((k) => {
                      const t = THEMES.find((x) => x.key === k);
                      return t ? <Chip key={k} tone={t.tone}>{t.label}</Chip> : null;
                    })}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {rows.length > shown ? (
          <button type="button" className={cx("btn", ui.btnGhost, s.more)} onClick={() => setShown((n) => n + PAGE)}>
            Show more ({rows.length - shown})
          </button>
        ) : null}
      </section>
    </>
  );
}

function mergeTools(a: Array<{ name: string; companies: number }>, b: Array<{ name: string; n: number }>): Array<{ name: string; n: number }> {
  const m = new Map<string, number>();
  for (const t of a) m.set(t.name, (m.get(t.name) ?? 0) + t.companies);
  for (const t of b) m.set(t.name, (m.get(t.name) ?? 0) + t.n);
  return [...m.entries()].map(([name, n]) => ({ name, n })).sort((x, y) => y.n - x.n);
}
