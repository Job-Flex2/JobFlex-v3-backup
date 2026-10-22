"use client";
// Customer development · Interviews (owner, 2026-10-22): the discovery log — who, when, what kind of conversation,
// how much the problem hurts, what they use today, would they pay and at what price, their own words, and which
// hypotheses it backs or breaks — and who to talk to next, by group, with the questions to ask.
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CustDevView } from "@/lib/custDev/read";
import { CALL_GROUPS, CHANNELS, INTERVIEW_KINDS, pct, type Interview, type InterviewKind, type WouldPay } from "@/lib/custDev/model";
import { custDevDeleteInterview, custDevSaveInterview } from "@/actions/custDev";
import { Empty, KpiStrip, Seg, Sheet, cx, useMdl, useReveal } from "@/components/v3/admin-influencers/admin-ui";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import { CallCards } from "./custdev-calls";
import { dateWords } from "./custdev-parts";
import s from "./custdev.module.css";

/** What opens the sheet: a fresh interview (maybe from a call card) or one to edit. */
export type InterviewDraft = Partial<Interview>;

const KIND_WORDS = Object.fromEntries(INTERVIEW_KINDS.map((k) => [k.key, k.label])) as Record<InterviewKind, string>;
const PAY_WORDS: Record<WouldPay, string> = { yes: "Would pay", maybe: "Maybe", no: "Would not pay" };

export function InterviewsTab({ view, onLog }: { view: CustDevView; onLog: (d: InterviewDraft) => void }) {
  const st = view.interviewStats;
  const titles = useMemo(() => new Map(view.hypotheses.map((h) => [h.id, h.statement])), [view.hypotheses]);
  // This tab mounts after the page: its KPI strip plays the house entrance itself.
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);
  return (
    <div ref={ref} className={s.panel}>
      <KpiStrip
        cols={5}
        cells={[
          { label: "Interviews", value: String(st.total) },
          { label: "Last 30 days", value: String(st.last30) },
          { label: "Pain 4 or 5", value: pct(st.painHigh) },
          { label: "Would pay", value: pct(st.wouldPay) },
          { label: "Price they named", value: st.priceMedian === null ? "—" : `$${st.priceMedian}/mo` },
        ]}
      />

      <section className="card" aria-labelledby="cd-next">
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title" id="cd-next">Who to talk to next</div>
            <div className="card-sub">Ask about their past, not our product: what they did last time, what it cost them, what they use now. Accounts talked to in the last 30 days are left out.</div>
          </div>
        </div>
        {view.calls.length === 0 ? (
          <Empty>Nobody to call right now.</Empty>
        ) : (
          CALL_GROUPS.map((g) => {
            const list = view.calls.filter((c) => c.group === g.key);
            if (!list.length) return null;
            return (
              <div key={g.key} className={s.callGroupBlock} data-custdev-call-group={g.key}>
                <div className={s.secL}>
                  {g.label} · {list.length}
                </div>
                <p className={s.groupWhy}>{g.why}</p>
                <CallCards calls={list} onLog={onLog} />
              </div>
            );
          })
        )}
      </section>

      <section className="card" aria-labelledby="cd-log">
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title" id="cd-log">Interview log</div>
            <div className="card-sub">
              {st.total ? `${st.byKind.problem} problem · ${st.byKind.solution} solution · ${st.byKind.validation} validation · ${st.byKind.exit} exit` : "Every conversation with a contractor, kept here."}
            </div>
          </div>
          <button type="button" className={cx("btn", "btn-primary", ui.btnSm, s.tap)} onClick={() => onLog({})}>
            Log an interview
          </button>
        </div>
        {view.interviews.length === 0 ? (
          <Empty>No interviews logged yet. Start with five from “Who to talk to next” — fifteen problem interviews pass the first check of customer discovery.</Empty>
        ) : (
          <ul className={s.log}>
            {view.interviews.map((i) => (
              <li key={i.id} className={s.logRow} data-custdev-interview={i.id}>
                <div className={s.logHead}>
                  <span className={s.logDate}>{dateWords(i.at)}</span>
                  <span className={s.logCompany}>{i.company}</span>
                  {i.person ? <span className={s.logPerson}>{i.person}</span> : null}
                  <span className={s.logKind}>{KIND_WORDS[i.kind]}</span>
                </div>
                <p className={s.logFacts}>
                  <span>{i.trade}</span>
                  {i.pain !== null ? <span>Pain {i.pain}/5</span> : null}
                  {i.wouldPay ? <span>{PAY_WORDS[i.wouldPay]}{i.priceSaid ? ` · $${i.priceSaid}/mo` : ""}</span> : null}
                  {i.currentTool ? <span>Uses {i.currentTool}</span> : null}
                </p>
                {i.quote ? <q className={s.logQuote}>{i.quote}</q> : null}
                {i.hypotheses.length ? (
                  <ul className={s.logHyps}>
                    {i.hypotheses.map((h) => (
                      <li key={h.id} data-effect={h.effect}>
                        <b>{h.effect === "supports" ? "+" : "−"}</b> {titles.get(h.id) ?? "A hypothesis put away"}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className={s.logActs}>
                  <button type="button" className={cx("btn", ui.btnGhost, ui.btnSm, s.tap)} onClick={() => onLog(i)} data-custdev-edit-interview={i.id}>
                    Edit
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ── the sheet ─────────────────────────────────────────────────────────────────────────────────────────────────── */

type Handle = ReturnType<typeof useMdl>;

export function InterviewSheet({ handle, draft, view }: { handle: Handle; draft: { d: InterviewDraft; n: number } | null; view: CustDevView }) {
  return (
    <Sheet mdlRef={handle.ref} title={draft?.d.id ? "Edit interview" : "Log an interview"} titleId="cdIntT" size="lg" onClose={handle.close}>
      {draft ? <InterviewForm key={draft.n} draft={draft.d} view={view} onDone={handle.close} /> : null}
    </Sheet>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function InterviewForm({ draft, view, onDone }: { draft: InterviewDraft; view: CustDevView; onDone: () => void }) {
  const router = useRouter();
  const [company, setCompany] = useState(draft.company ?? "");
  const [orgId, setOrgId] = useState<string | null>(draft.orgId ?? null);
  const [trade, setTrade] = useState(draft.trade ?? "");
  const [person, setPerson] = useState(draft.person ?? "");
  const [date, setDate] = useState(draft.at ? new Date(draft.at).toISOString().slice(0, 10) : today());
  const [kind, setKind] = useState<InterviewKind>(draft.kind ?? "problem");
  const [channel, setChannel] = useState<Interview["channel"]>(draft.channel ?? "call");
  const [pain, setPain] = useState<string>(draft.pain ? String(draft.pain) : "none");
  const [tool, setTool] = useState(draft.currentTool ?? "");
  const [pay, setPay] = useState<string>(draft.wouldPay ?? "none");
  const [price, setPrice] = useState(draft.priceSaid ? String(draft.priceSaid) : "");
  const [quote, setQuote] = useState(draft.quote ?? "");
  const [notes, setNotes] = useState(draft.notes ?? "");
  const [effects, setEffects] = useState<Record<string, "supports" | "refutes">>(() => Object.fromEntries((draft.hypotheses ?? []).map((h) => [h.id, h.effect])));
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const open = view.hypotheses.filter((h) => !h.archived);
  const accountByName = useMemo(() => new Map(view.accounts.map((a) => [a.name.toLowerCase(), a])), [view.accounts]);

  const pickCompany = (v: string) => {
    setCompany(v);
    const a = accountByName.get(v.trim().toLowerCase());
    setOrgId(a?.id ?? null);
    if (a && !trade) setTrade(a.trade);
  };

  const save = () =>
    start(async () => {
      setError(null);
      const r = await custDevSaveInterview(
        {
          company,
          orgId,
          person,
          trade,
          at: `${date}T12:00:00Z`,
          kind,
          channel,
          pain: pain === "none" ? null : Number(pain),
          currentTool: tool,
          wouldPay: pay === "none" ? null : pay,
          priceSaid: price.trim() ? price : null,
          quote,
          notes,
          hypotheses: Object.entries(effects).map(([id, effect]) => ({ id, effect })),
        },
        draft.id ?? null,
      );
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onDone();
      router.refresh();
    });

  const remove = () =>
    start(async () => {
      if (!draft.id || !window.confirm("Delete this interview?")) return;
      const r = await custDevDeleteInterview(draft.id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onDone();
      router.refresh();
    });

  return (
    <form
      className={s.form}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      noValidate
    >
      <div className={ui.row2}>
        <div className="mf">
          <label className="mf-lbl" htmlFor="cdIntCompany">Company</label>
          <input className="mf-in" id="cdIntCompany" list="cdIntAccounts" value={company} onChange={(e) => pickCompany(e.target.value)} autoComplete="off" placeholder="Start typing — the accounts are listed" data-custdev-int-company />
          <datalist id="cdIntAccounts">
            {view.accounts.map((a) => (
              <option key={a.id} value={a.name} />
            ))}
          </datalist>
          <div className={cx(ui.hint, s.hintGap)}>{orgId ? "A JobFlex account — linked." : company.trim() ? "Not an account — kept as typed." : " "}</div>
        </div>
        <div className="mf">
          <label className="mf-lbl" htmlFor="cdIntPerson">Who you talked to</label>
          <input className="mf-in" id="cdIntPerson" value={person} onChange={(e) => setPerson(e.target.value)} autoComplete="off" placeholder="Owner's name" />
        </div>
      </div>
      <div className={ui.row2}>
        <div className="mf">
          <label className="mf-lbl" htmlFor="cdIntTrade">Trade</label>
          <input className="mf-in" id="cdIntTrade" value={trade} onChange={(e) => setTrade(e.target.value)} autoComplete="off" placeholder="Roofing" />
        </div>
        <div className="mf">
          <label className="mf-lbl" htmlFor="cdIntDate">Date</label>
          <input className="mf-in" id="cdIntDate" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="mf">
        <span className="mf-lbl">Kind of conversation</span>
        <Seg label="Kind of conversation" value={kind} onChange={setKind} options={INTERVIEW_KINDS.map((k) => ({ value: k.key, label: k.label }))} />
        <div className={cx(ui.hint, s.hintGap)}>{INTERVIEW_KINDS.find((k) => k.key === kind)?.hint}</div>
      </div>
      <div className={ui.row2}>
        <div className="mf">
          <label className="mf-lbl" htmlFor="cdIntChannel">How</label>
          <span className="bp-sel bp-sel--admin">
            <select className="bp-sel-in" id="cdIntChannel" value={channel} onChange={(e) => setChannel(e.target.value as Interview["channel"])}>
              {CHANNELS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </span>
        </div>
        <div className="mf">
          <label className="mf-lbl" htmlFor="cdIntTool">What they use today</label>
          <input className="mf-in" id="cdIntTool" value={tool} onChange={(e) => setTool(e.target.value)} autoComplete="off" placeholder="Pen and paper, Jobber, a spreadsheet…" />
        </div>
      </div>
      <div className="mf">
        <span className="mf-lbl">How much the problem hurts</span>
        <Seg label="Pain from 1 to 5" value={pain} onChange={setPain} options={[{ value: "none", label: "Not asked" }, ...["1", "2", "3", "4", "5"].map((v) => ({ value: v, label: v }))]} />
      </div>
      <div className={ui.row2}>
        <div className="mf">
          <span className="mf-lbl">Would they pay for it?</span>
          <Seg label="Would they pay" value={pay} onChange={setPay} options={[{ value: "none", label: "Not asked" }, { value: "yes", label: "Yes" }, { value: "maybe", label: "Maybe" }, { value: "no", label: "No" }]} />
        </div>
        <div className="mf">
          <label className="mf-lbl" htmlFor="cdIntPrice">A price they named ($ a month)</label>
          <input className="mf-in" id="cdIntPrice" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="99" />
        </div>
      </div>
      <div className="mf">
        <label className="mf-lbl" htmlFor="cdIntQuote">In their words</label>
        <textarea className={cx("mf-in", ui.area)} id="cdIntQuote" rows={2} value={quote} onChange={(e) => setQuote(e.target.value)} maxLength={1000} placeholder="The sentence that stuck with you, word for word" />
      </div>
      <div className="mf">
        <label className="mf-lbl" htmlFor="cdIntNotes">Notes</label>
        <textarea className={cx("mf-in", ui.area)} id="cdIntNotes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
      </div>
      {open.length ? (
        <fieldset className={s.effects}>
          <legend className="mf-lbl">What it tells us</legend>
          {open.map((h) => (
            <div key={h.id} className={s.effect}>
              <span className={s.effectText}>{h.statement}</span>
              <span className={s.effectBtns} role="group" aria-label={`This interview and: ${h.statement}`}>
                {(["supports", "refutes"] as const).map((e) => (
                  <button
                    key={e}
                    type="button"
                    className={cx(s.effectBtn, effects[h.id] === e && s.effectOn)}
                    data-effect={e}
                    aria-pressed={effects[h.id] === e}
                    onClick={() =>
                      setEffects((prev) => {
                        const next = { ...prev };
                        if (next[h.id] === e) delete next[h.id];
                        else next[h.id] = e;
                        return next;
                      })
                    }
                  >
                    {e === "supports" ? "Supports" : "Refutes"}
                  </button>
                ))}
              </span>
            </div>
          ))}
        </fieldset>
      ) : null}
      {error ? <p className={s.err} role="alert">{error}</p> : null}
      <div className={s.sheetActs}>
        {draft.id ? (
          <button type="button" className={cx("btn", ui.btnGhost)} disabled={busy} onClick={remove}>
            Delete
          </button>
        ) : null}
        <button type="submit" className={cx("btn btn-primary", busy && ui.btnBusy)} disabled={busy} data-custdev-int-save>
          {busy ? "Saving…" : draft.id ? "Save" : "Log it"}
        </button>
      </div>
    </form>
  );
}
