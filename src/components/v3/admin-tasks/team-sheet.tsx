"use client";

// ADMIN · TASKS — the team (owner, 2026-10-15: "I can add the team name and their phone number … everybody in the team
// gets the text message"; then "let's not do any logins — I just add their phone number … they go to admin and mark
// what's done"; then "make sure Twilio will send them texts"). A name and a mobile each, no sign-in. The sheet shows
// whether texts can go at all (Twilio set up, JobFlex's number approved), sends a test text on demand, and says
// whether each person's last text arrived (the carrier's receipt, through /api/twilio/sms/status). The rules of who
// gets which text: lib/adminTasks/teamShared.

import { useEffect, useState } from "react";
import { BellOff, Check, Moon, Pencil, Phone, Send, Trash2, UserPlus } from "lucide-react";
import { Note, SheetBody, SheetFoot } from "@/components/v3/admin-users/admin-kit";
import { addAdminTeamMember, getAdminTeam, removeAdminTeamMember, setAdminSurgeThreshold, testAdminTeamText, updateAdminTeamMember, type TeamResult } from "@/actions/adminTasks";
import { ALERT_KEYS, ALERT_WORDS, deliveryWords, type TeamMemberView, type TextingStatus } from "@/lib/adminTasks/teamShared";
import type { AdminPersonDTO } from "@/lib/adminTasks/model";
import { cx } from "./task-bits";

type Ok = Extract<TeamResult, { ok: true }>;
const NO_LINE = { ok: false as const, error: "No connection — try again." };

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Member({ m, onTeam }: { m: TeamMemberView; onTeam: (r: TeamResult) => string | null }) {
  const [busy, setBusy] = useState<null | "test" | "save" | "flags" | "remove">(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(m.name);
  const [phone, setPhone] = useState(m.phone);
  const [sure, setSure] = useState(false);

  const act = async (kind: NonNullable<typeof busy>, call: () => Promise<TeamResult>) => {
    setBusy(kind);
    setNote(null);
    const r = await call().catch(() => NO_LINE);
    setBusy(null);
    const err = onTeam(r);
    if (err) setNote({ tone: "bad", text: err });
    else if (r.ok && r.note && kind !== "flags") setNote({ tone: "ok", text: r.note });
    if (r.ok && kind === "save") setEditing(false);
  };

  const sent = deliveryWords(m.last);
  const state = m.stopped ? "stop" : m.on ? "on" : "off";
  return (
    <li className={cx("tmRow")} data-team-member={m.id} data-state={state}>
      <div className={cx("tmHead")}>
        <div className={cx("tmWho")}>
          <b>{m.name}</b>
          <span>
            {m.phone} · {m.open ? `${m.open} open task${m.open === 1 ? "" : "s"}` : "no open tasks"}
          </span>
        </div>
        <span className={cx("tmState", state === "on" ? "tmOk" : state === "stop" ? "tmBad" : "tmOff")}>
          {state === "on" ? (
            <>
              <Check size={13} aria-hidden /> Texts on
            </>
          ) : state === "stop" ? (
            "Replied STOP"
          ) : (
            <>
              <BellOff size={13} aria-hidden /> Texts off
            </>
          )}
        </span>
      </div>

      {m.stopped ? (
        <p className={cx("tmSent", "tmSentBad")}>They replied STOP, so no text reaches them — they text START to JobFlex&apos;s number to get them again.</p>
      ) : sent && m.last ? (
        <p className={cx("tmSent", sent.tone === "ok" ? "tmSentOk" : sent.tone === "bad" ? "tmSentBad" : "tmSentWait")} data-team-sent={sent.tone}>
          <span className={cx("tmDot")} aria-hidden="true" />
          {sent.words} · {when(m.last.at)}
        </p>
      ) : (
        <p className={cx("tmSent")} data-team-sent="none">
          <span className={cx("tmDot")} aria-hidden="true" />
          No text sent yet
        </p>
      )}

      {editing ? (
        <form
          className={cx("tmEdit")}
          onSubmit={(e) => {
            e.preventDefault();
            void act("save", () => updateAdminTeamMember(m.id, { name, phone }));
          }}
        >
          <input className={cx("in")} value={name} maxLength={60} autoComplete="off" aria-label="Name" onChange={(e) => setName(e.target.value)} data-team-edit-name />
          <input className={cx("in")} value={phone} inputMode="tel" autoComplete="off" aria-label="Mobile" onChange={(e) => setPhone(e.target.value)} data-team-edit-phone />
          <span className={cx("tmBtns")}>
            <button type="button" className={cx("btn", "btn-quiet", "btn-sm")} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className={cx("btn", "btn-primary", "btn-sm")} disabled={busy !== null || !name.trim() || !phone.trim()} data-team-edit-save>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
          </span>
        </form>
      ) : null}

      <div className={cx("tmFlags")}>
        <label className={cx("tmFlag")}>
          <input type="checkbox" checked={m.on} disabled={busy !== null} onChange={(e) => void act("flags", () => updateAdminTeamMember(m.id, { on: e.target.checked }))} data-team-on />
          <span>Task texts</span>
        </label>
        <label className={cx("tmFlag")}>
          <input type="checkbox" checked={m.quietNights} disabled={busy !== null || !m.on} onChange={(e) => void act("flags", () => updateAdminTeamMember(m.id, { quietNights: e.target.checked }))} data-team-quiet />
          <span>
            <Moon size={13} aria-hidden /> Quiet 9 PM–7 AM <small>(Urgent still texts)</small>
          </span>
        </label>
      </div>

      <div className={cx("tmAlerts")} data-team-alerts>
        <p className={cx("tmAlertsHead")}>Alert texts — what&apos;s happening on JobFlex itself:</p>
        <div className={cx("tmFlags")}>
          {ALERT_KEYS.map((k) => {
            const onNow = m.alerts.includes(k);
            return (
              <label key={k} className={cx("tmFlag")} title={ALERT_WORDS[k].hint}>
                <input type="checkbox" checked={onNow} disabled={busy !== null || !m.on} onChange={() => void act("flags", () => updateAdminTeamMember(m.id, { alertSet: { key: k, on: !onNow } }))} data-team-alert={k} />
                <span>{ALERT_WORDS[k].label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className={cx("tmBtns")}>
        <button type="button" className={cx("btn", "btn-ghost", "btn-sm")} disabled={busy !== null || m.stopped} onClick={() => void act("test", () => testAdminTeamText(m.id))} data-team-test>
          <Send size={14} aria-hidden />
          {busy === "test" ? "Sending…" : "Send a test text"}
        </button>
        {!editing ? (
          <button
            type="button"
            className={cx("btn", "btn-quiet", "btn-sm")}
            disabled={busy !== null}
            onClick={() => {
              setName(m.name);
              setPhone(m.phone);
              setEditing(true);
            }}
            data-team-edit
          >
            <Pencil size={14} aria-hidden />
            Edit
          </button>
        ) : null}
        {sure ? (
          <>
            <button type="button" className={cx("btn", "btn-danger", "btn-sm")} disabled={busy !== null} onClick={() => void act("remove", () => removeAdminTeamMember(m.id))} data-team-remove-yes>
              {busy === "remove" ? "Removing…" : `Remove ${m.name.split(/\s+/)[0]}${m.open ? ` · ${m.open === 1 ? "their task goes" : `${m.open} tasks go`} back to nobody` : ""}`}
            </button>
            <button type="button" className={cx("btn", "btn-quiet", "btn-sm")} onClick={() => setSure(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className={cx("btn", "btn-quiet", "btn-sm", "tmRemove")} disabled={busy !== null} onClick={() => setSure(true)} data-team-remove>
            <Trash2 size={14} aria-hidden />
            Remove
          </button>
        )}
      </div>

      {note ? (
        <p className={cx("tmNote", note.tone === "bad" && "tmNoteBad")} role={note.tone === "bad" ? "alert" : "status"}>
          {note.text}
        </p>
      ) : null}
    </li>
  );
}

function AddMember({ onTeam }: { onTeam: (r: TeamResult) => string | null }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  return (
    <form
      className={cx("tmAdd")}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setNote(null);
        const r = await addAdminTeamMember(name, phone).catch(() => NO_LINE);
        setBusy(false);
        const err = onTeam(r);
        if (err) return setNote({ tone: "bad", text: err });
        setName("");
        setPhone("");
        if (r.ok && r.note) setNote({ tone: "ok", text: r.note });
      }}
      data-team-add
    >
      <div className={cx("tmAddRow")}>
        <input className={cx("in")} value={name} maxLength={60} autoComplete="off" placeholder="Name — e.g. Ivan" aria-label="Their name" onChange={(e) => setName(e.target.value)} data-team-add-name />
        <span className={cx("tmPhone")}>
          <Phone size={15} aria-hidden />
          <input className={cx("in")} value={phone} inputMode="tel" autoComplete="off" placeholder="Mobile — (425) 555-0100" aria-label="Their mobile" onChange={(e) => setPhone(e.target.value)} data-team-add-phone />
        </span>
        <button type="submit" className={cx("btn", "btn-primary")} disabled={busy || !name.trim() || !phone.trim()} data-team-add-go>
          <UserPlus size={15} aria-hidden />
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      {note ? (
        <p className={cx("tmNote", note.tone === "bad" && "tmNoteBad")} role={note.tone === "bad" ? "alert" : "status"} data-team-add-note>
          {note.text}
        </p>
      ) : null}
    </form>
  );
}

function SurgeDial({ threshold, onTeam }: { threshold: number; onTeam: (r: TeamResult) => string | null }) {
  const [value, setValue] = useState(String(threshold));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => setValue(String(threshold)), [threshold]);
  const dirty = value.trim() !== String(threshold);
  return (
    <form
      className={cx("tmDial")}
      data-team-surge-dial
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setNote(null);
        const r = await setAdminSurgeThreshold(Number(value)).catch(() => NO_LINE);
        setBusy(false);
        const err = onTeam(r);
        setNote(err);
      }}
    >
      <span>
        <b>Traffic surge</b> texts when the site holds{" "}
        <input className={cx("in", "tmDialIn")} value={value} inputMode="numeric" aria-label="Visitors at once" onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 3))} data-team-surge-threshold />{" "}
        or more visitors at once (checked every 5 minutes, told once per surge).
      </span>
      {dirty ? (
        <button type="submit" className={cx("btn", "btn-primary", "btn-sm")} disabled={busy || !value.trim()}>
          {busy ? "Saving…" : "Save"}
        </button>
      ) : null}
      {note ? (
        <p className={cx("tmNote", "tmNoteBad")} role="alert">
          {note}
        </p>
      ) : null}
    </form>
  );
}

export function TeamSheetContent({ onClose, onPeople }: { onClose: () => void; onPeople: (people: AdminPersonDTO[]) => void }) {
  const [data, setData] = useState<{ team: TeamMemberView[]; texting: TextingStatus; surgeThreshold: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const take = (r: Ok) => {
    setData({ team: r.team, texting: r.texting, surgeThreshold: r.surgeThreshold });
    onPeople(r.people);
  };

  // Read on open, then every 15 s while open: a test text's delivery receipt lands within seconds.
  useEffect(() => {
    let live = true;
    const load = () =>
      void getAdminTeam()
        .then((r) => {
          if (!live) return;
          if (r.ok) take(r);
          else setError(r.error);
        })
        .catch(() => undefined);
    load();
    const t = window.setInterval(load, 15_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per open (the sheet remounts on each open)
  }, []);

  const onTeam = (r: TeamResult): string | null => {
    if (r.ok) {
      take(r);
      return null;
    }
    return r.error;
  };

  const on = data?.team.filter((m) => m.on && !m.stopped).length ?? 0;
  return (
    <>
      <SheetBody>
        <p className={cx("tmIntro")}>
          The people who work JobFlex&apos;s tasks — a name and a mobile, no sign-in. They get a text when a new task needs
          someone, when one is given to them, when someone takes one, and when one is done. They answer right in the text:{" "}
          <b>OK</b> to take it or confirm they&apos;ll do it, <b>DONE</b> when it&apos;s finished, <b>NO</b> if they can&apos;t — anything
          else they write lands on the task as their note. Or they open Tasks in admin.
        </p>
        {error ? <Note tone="danger">{error}</Note> : null}
        {data ? (
          <p className={cx("tmTexting", data.texting.ready ? "tmTextingOk" : "tmTextingBad")} data-team-texting={data.texting.ready ? "1" : "0"}>
            <span className={cx("tmDot")} aria-hidden="true" />
            {data.texting.words}
          </p>
        ) : null}
        <AddMember onTeam={onTeam} />
        {!data && !error ? (
          <div className={cx("tbl-empty")} role="status">
            Loading the team…
          </div>
        ) : null}
        {data ? (
          <>
            <p className={cx("tmCount")} data-team-ready={on}>
              {data.team.length === 0
                ? "Nobody on the team yet — add a name and a mobile above."
                : `${data.team.length} on the team · ${on} get${on === 1 ? "s" : ""} task texts`}
            </p>
            <ul className={cx("tmList")}>
              {data.team.map((m) => (
                <Member key={m.id} m={m} onTeam={onTeam} />
              ))}
            </ul>
            {data.team.length ? <SurgeDial threshold={data.surgeThreshold} onTeam={onTeam} /> : null}
          </>
        ) : null}
      </SheetBody>
      <SheetFoot>
        <button type="button" className={cx("btn", "btn-primary")} onClick={onClose}>
          Done
        </button>
      </SheetFoot>
    </>
  );
}
