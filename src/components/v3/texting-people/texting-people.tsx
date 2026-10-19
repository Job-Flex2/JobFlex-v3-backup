"use client";

// WHO GETS TEXTED — person by person (2026-09-29). The inside of the Texting
// page's "Your team" step, on the desk and the phone.
//
// Owner: "if I have managers I just add their name and phone number and the
// list of what they will receive — proposal accepted, job started,
// scheduled, something cancelled… for sales most of it is appointments or
// their proposal sold, for installers when they get the job or we
// reschedule it". Three rosters by role (office, sales, crew); each person is
// a row with their mobile and their own switches. The actions are actions/sms
// (setMemberMobile, setMemberTextEvents, setMemberTextsOn, the verify pair);
// the events and their example texts are lib/notificationPrefsShared.
//
// THE INSIDE, FOR CLARITY (owner, 2026-10-18): a row says first whether texts
// can reach the person — switch, name, number and its state — and the picks
// under it sit in a few labelled clusters in aligned columns, not a ragged
// run; when nothing can be sent (no mobile, texts off, STOP) the picks are
// kept and read as kept: grey, with the reason beside them. A group with
// nobody in it is one quiet line, and "What the texts say" is said once for
// the whole team. Styles: ./texting-kit.css (plain, under `.jf-tx`).

import { useState } from "react";
import { useRouter } from "next/navigation";

import { confirmPhoneVerification, setMemberMobile, setMemberTextEvents, setMemberTextsOn, startPhoneVerification, type SmsActionResult } from "@/actions/sms";
import { textEventsFor, type PrefEventMeta, type TextAudience } from "@/lib/notificationPrefsShared";
import { smsFailureMessage } from "@/lib/sms/actionGuard";
import { roleLabel } from "@/lib/team/who";
import type { SmsRosterRow } from "@/components/v3/settings-blueprint/settings-data";
import { TEXTING_COPY, TEXTS_COPY } from "@/components/v3/settings-blueprint/settings-data";
import "./texting-kit.css";

const AUDIENCES: readonly TextAudience[] = ["office", "sales", "crew"];

type ClusterKey = keyof typeof TEXTING_COPY.clusters;
/** Which labelled cluster an event sits in — the same families the "When" list of your own texts uses. */
const CLUSTER_OF: Record<string, ClusterKey> = {
  "lead-assigned": "leads",
  "proposal-accepted": "leads",
  "proposal-declined": "leads",
  "payment-received": "money",
  "change-order": "money",
  "appointment-booked": "visits",
  "appointment-moved": "visits",
  "job-scheduled": "visits",
  "job-started": "job",
  "job-completed": "job",
  "job-photos": "job",
  "worker-responded": "job",
  "crew-assigned": "crewJobs",
  "crew-moved": "crewJobs",
  "crew-tomorrow": "crewDaily",
  "crew-today": "crewDaily",
};
const CLUSTER_ORDER: readonly ClusterKey[] = ["leads", "money", "visits", "job", "crewJobs", "crewDaily", "other"];

function clustersOf(events: readonly PrefEventMeta[]) {
  return CLUSTER_ORDER.map((k) => ({ key: k, label: TEXTING_COPY.clusters[k], events: events.filter((e) => (CLUSTER_OF[e.key] ?? "other") === k) })).filter((c) => c.events.length);
}

type Run = (label: string, fn: () => Promise<SmsActionResult>, after?: () => void) => Promise<void>;
type RowMessage = { forRow: string; kind: "ok" | "err"; text: string };

/** (425) 772-6587 from whatever was typed; the digits back when it is not a US number. */
function prettyTyped(raw: string): string {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw.trim();
}

export function TextingPeople({ roster }: { roster: SmsRosterRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<SmsRosterRow[]>(roster);
  // A saved mobile comes back through router.refresh() as new props: take them.
  const [seen, setSeen] = useState(roster);
  if (seen !== roster) {
    setSeen(roster);
    setRows(roster);
  }
  const [busy, setBusy] = useState<string | null>(null);
  // The answer lands on the row that asked (2026-10-14: the owner tapped "Text me a code" on
  // a long roster and the note sat at the bottom, out of sight). Labels are `<userId>:<what>`.
  const [msg, setMsg] = useState<RowMessage | null>(null);
  const run: Run = async (label, fn, after) => {
    const forRow = label.split(":")[0] ?? "";
    setBusy(label);
    setMsg(null);
    try {
      const r = await fn();
      if (r.ok) {
        setMsg({ forRow, kind: "ok", text: r.note ?? "Saved." });
        after?.();
        router.refresh();
      } else setMsg({ forRow, kind: "err", text: r.error });
    } catch (e) {
      // A throw that reached the browser (the sign-in redirected the action, a deploy in between): words, not "#441" (2026-10-14).
      setMsg({ forRow, kind: "err", text: smsFailureMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  const flip = (row: SmsRosterRow, keys: string[], on: boolean) => {
    const patch = Object.fromEntries(keys.map((k) => [k, on]));
    setRows((rs) => rs.map((r) => (r.userId === row.userId ? { ...r, cells: { ...r.cells, ...patch } } : r)));
    void run(`${row.userId}:ev`, () => setMemberTextEvents(row.userId, patch));
  };
  // Every text any group can get, once, in its cluster (the three disclosures repeated each other).
  const allEvents = [...new Map(AUDIENCES.flatMap((a) => textEventsFor(a)).map((e) => [e.key, e])).values()];
  return (
    <div className="jf-tx tk-team" data-texting-people data-nest="">
      {AUDIENCES.map((aud) => {
        const events = textEventsFor(aud);
        const people = rows.filter((r) => r.audience === aud);
        const copy = TEXTING_COPY.sections[aud];
        if (!people.length) {
          return (
            <section key={aud} className="tk-group is-empty" data-audience={aud} aria-label={copy.title}>
              <h3>{copy.title}</h3>
              <p>{TEXTING_COPY.emptySection}</p>
            </section>
          );
        }
        return (
          <section key={aud} className="tk-group" data-audience={aud} aria-labelledby={`tk-aud-${aud}`}>
            <div className="tk-groupH">
              <h3 id={`tk-aud-${aud}`}>{copy.title}</h3>
              <p>{copy.sub}</p>
              <span className="tk-count">{TEXTING_COPY.peopleCount(people.length)}</span>
            </div>
            <ul className="tk-people">
              {people.map((r) => (
                <PersonRow key={r.userId} row={r} events={events} busy={busy} run={run} onFlip={flip} msg={msg?.forRow === r.userId ? msg : null} />
              ))}
            </ul>
          </section>
        );
      })}
      <details className="tk-more" data-texting-examples>
        <summary>{TEXTING_COPY.examplesTitle}</summary>
        <div className="tk-examples">
          {clustersOf(allEvents).map((c) => (
            <section key={c.key}>
              <h4>{c.label}</h4>
              <ul>
                {c.events.map((e) => (
                  <li key={e.key}>
                    <b>{e.name}</b>
                    <q className="tk-bubble">{e.example}</q>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </details>
    </div>
  );
}

function PersonRow({
  row,
  events,
  busy,
  run,
  onFlip,
  msg,
}: {
  row: SmsRosterRow;
  events: readonly PrefEventMeta[];
  busy: string | null;
  run: Run;
  onFlip: (row: SmsRosterRow, keys: string[], on: boolean) => void;
  msg: RowMessage | null;
}) {
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState("");
  // YOUR OWN ROW (2026-10-14): your mobile is verified by a six-digit code — the
  // code is your consent — right here, where everyone else's is typed in by
  // the office. The separate "Your mobile" card is gone for the office.
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const texting = Boolean(row.phone) && !row.stopped;
  const onCount = events.filter((e) => row.cells[e.key]).length;
  const inputId = `tx-mobile-${row.userId}`;
  // THE SWITCH (owner, 2026-10-13: "easy on and off for anybody"): off keeps the mobile and the choices.
  const mobile = row.phone ?? row.phoneOnFile;
  const canSwitch = Boolean(mobile) && !row.stopped && busy === null;
  const switchWhy = row.stopped ? TEXTING_COPY.stoppedHelp : !mobile ? TEXTING_COPY.switchNoMobile : texting ? TEXTING_COPY.switchOnHelp : TEXTING_COPY.switchOffHelp;
  const idle = texting ? null : row.stopped ? TEXTING_COPY.picksIdleStop : !mobile ? TEXTING_COPY.picksIdleNone : TEXTING_COPY.picksIdleOff;
  const sendCode = () => run(`${row.userId}:code`, () => startPhoneVerification(phone), () => setStage("code"));
  const verify = () => run(`${row.userId}:verify`, () => confirmPhoneVerification(code), () => setEditing(false));
  const saveTheirs = () => run(`${row.userId}:mobile`, () => setMemberMobile(row.userId, phone), () => setEditing(false));
  return (
    <li className="tk-person" data-member={row.userId} data-me={row.isMe || undefined} data-texting={texting ? "on" : row.paused ? "off" : "none"}>
      <div className="tk-personH">
        <button
          type="button"
          role="switch"
          aria-checked={texting}
          aria-label={`Texts to ${row.name}`}
          title={switchWhy}
          className={`tk-switch${texting ? " is-on" : ""}`}
          disabled={!canSwitch}
          onClick={() => run(`${row.userId}:switch`, () => setMemberTextsOn(row.userId, !texting))}
          data-texting-switch
        >
          <i aria-hidden="true" />
          <span>{texting ? TEXTING_COPY.switchOn : TEXTING_COPY.switchOff}</span>
        </button>
        <div className="tk-who">
          <span className="tk-whoName">
            <b>{row.name}</b>
            <span>
              {roleLabel(row.role)}
              {row.isMe ? ` · ${TEXTING_COPY.whoMe}` : ""}
            </span>
          </span>
          <span className="tk-whoLine">
            {row.phone ? (
              <>
                <span className="tk-num">{row.phone}</span>
                <span className="tk-tag" data-tone={row.stopped ? "bad" : "ok"}>
                  {row.stopped ? TEXTS_COPY.stopped : row.phoneBy === "office" ? TEXTING_COPY.byOffice : TEXTING_COPY.bySelf}
                </span>
              </>
            ) : row.phoneOnFile ? (
              <>
                <span className="tk-num">{row.phoneOnFile}</span>
                <span className="tk-tag" data-tone={row.stopped ? "bad" : undefined}>
                  {row.stopped ? TEXTS_COPY.stopped : TEXTING_COPY.onFileOff}
                </span>
              </>
            ) : (
              <span className="tk-tag" data-tone="bad">
                {TEXTING_COPY.noMobileLong}
              </span>
            )}
          </span>
        </div>
        {!editing ? (
          <div className="tk-personA">
            {mobile && !texting && !row.stopped ? (
              <button type="button" className="tk-btn" disabled={busy !== null} onClick={() => run(`${row.userId}:switch`, () => setMemberTextsOn(row.userId, true))} data-texting-turn-on>
                {TEXTING_COPY.turnOn}
              </button>
            ) : null}
            <button
              type="button"
              className="tk-btn"
              disabled={busy !== null}
              onClick={() => {
                setEditing(true);
                setPhone("");
                setCode("");
                setStage("phone");
              }}
              data-texting-edit-mobile
            >
              {mobile ? TEXTING_COPY.changeMobile : TEXTING_COPY.addMobile}
            </button>
          </div>
        ) : null}
      </div>

      {msg ? (
        <p className={`tk-msg${msg.kind === "err" ? " is-err" : ""}`} role={msg.kind === "err" ? "alert" : "status"} data-row-message>
          {msg.text}
        </p>
      ) : null}

      {editing && row.isMe ? (
        <div className="tk-panel" data-texting-own-editor>
          {stage === "code" ? (
            <>
              <p className="tk-sent" data-texting-sent-to>
                {TEXTS_COPY.sentTo(prettyTyped(phone))}{" "}
                <button type="button" className="tk-link tk-link--inline" disabled={busy !== null} onClick={() => { setStage("phone"); setCode(""); }}>
                  {TEXTS_COPY.notYours}
                </button>
              </p>
              <div className="tk-panelRow">
                <label className="tk-field tk-field--code" htmlFor={`${inputId}-code`}>
                  <span className="tk-label">{TEXTS_COPY.codeLabel}</span>
                  <input
                    id={`${inputId}-code`}
                    className="tk-input tk-input--code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    placeholder="482913"
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && code.length === 6) void verify();
                      if (e.key === "Escape") setEditing(false);
                    }}
                  />
                </label>
                <button type="button" className="tk-btn tk-btn--primary" disabled={busy !== null || code.length !== 6} onClick={() => void verify()} data-texting-verify>
                  {busy === `${row.userId}:verify` ? "Checking…" : TEXTS_COPY.verify}
                </button>
                <button type="button" className="tk-btn" disabled={busy !== null} onClick={() => void sendCode()} data-texting-send-again>
                  {busy === `${row.userId}:code` ? "Sending…" : TEXTS_COPY.sendAgain}
                </button>
              </div>
              <p className="tk-note" data-texting-code-hint>{TEXTS_COPY.codeHint}</p>
            </>
          ) : (
            <div className="tk-panelRow">
              <label className="tk-field" htmlFor={inputId}>
                <span className="tk-label">{TEXTS_COPY.mobileLabel}</span>
                <input
                  id={inputId}
                  className="tk-input tk-input--num"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  value={phone}
                  placeholder={TEXTS_COPY.mobilePlaceholder}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && phone.replace(/\D/g, "").length >= 10) void sendCode();
                    if (e.key === "Escape") setEditing(false);
                  }}
                />
              </label>
              <button type="button" className="tk-btn tk-btn--primary" disabled={busy !== null || phone.replace(/\D/g, "").length < 10} onClick={() => void sendCode()} data-texting-send-code>
                {busy === `${row.userId}:code` ? "Sending…" : TEXTS_COPY.sendCode}
              </button>
              <button type="button" className="tk-btn" disabled={busy !== null} onClick={() => setEditing(false)}>
                {TEXTING_COPY.cancel}
              </button>
            </div>
          )}
          <p className="tk-note" data-sms-consent>
            {TEXTS_COPY.consent} <a href="/terms">{TEXTS_COPY.terms}</a> · <a href="/privacy">{TEXTS_COPY.privacy}</a>
          </p>
        </div>
      ) : editing ? (
        <div className="tk-panel" data-texting-their-editor>
          <div className="tk-panelRow">
            <label className="tk-field" htmlFor={inputId}>
              <span className="tk-label">{TEXTING_COPY.theirMobile(row.name)}</span>
              <input
                id={inputId}
                className="tk-input tk-input--num"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={phone}
                placeholder={TEXTS_COPY.mobilePlaceholder}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && phone.replace(/\D/g, "").length >= 10) void saveTheirs();
                  if (e.key === "Escape") setEditing(false);
                }}
              />
            </label>
            <button type="button" className="tk-btn tk-btn--primary" disabled={busy !== null || phone.replace(/\D/g, "").length < 10} onClick={() => void saveTheirs()}>
              {busy === `${row.userId}:mobile` ? "Saving…" : TEXTING_COPY.saveMobile}
            </button>
            <button type="button" className="tk-btn" disabled={busy !== null} onClick={() => setEditing(false)}>
              {TEXTING_COPY.cancel}
            </button>
          </div>
          <p className="tk-note">{TEXTING_COPY.typedInNote}</p>
        </div>
      ) : null}

      <div className="tk-picks" data-live={texting ? "1" : "0"} role="group" aria-label={`Texts to ${row.name}`}>
        <div className="tk-picksH">
          <b>{TEXTING_COPY.picksTitle}</b>
          <span className="tk-num">
            {onCount}/{events.length}
          </span>
          {idle ? <span className="tk-idle">{idle}</span> : null}
          <span className="tk-allNone">
            <button type="button" className="tk-link" disabled={onCount === events.length} onClick={() => onFlip(row, events.map((e) => e.key), true)}>
              {TEXTING_COPY.all}
            </button>
            <button type="button" className="tk-link" disabled={onCount === 0} onClick={() => onFlip(row, events.map((e) => e.key), false)}>
              {TEXTING_COPY.none}
            </button>
          </span>
        </div>
        <div className="tk-clusters">
          {clustersOf(events).map((c) => (
            <div key={c.key} className="tk-cluster" role="group" aria-label={c.label}>
              <h4>{c.label}</h4>
              {c.events.map((e) => {
                const on = Boolean(row.cells[e.key]);
                return (
                  <button key={e.key} type="button" className={`tk-tick${on ? " is-on" : ""}`} aria-pressed={on} title={e.sub} data-event={e.key} onClick={() => onFlip(row, [e.key], !on)}>
                    <i aria-hidden="true" />
                    {e.name}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </li>
  );
}
