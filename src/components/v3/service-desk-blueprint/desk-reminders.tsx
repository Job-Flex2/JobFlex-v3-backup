"use client";

// HVAC SERVICES · REMINDERS (2026-10-18). Owner: "we need to set the reminders
// for the contractor." Two halves: WHEN JobFlex reminds you (a heads-up so
// many days before each plan visit, unsigned plans after so many days, one
// digest a day — in the bell for the office, by text to whoever has "Service
// reminders" on in Texting, with today's digest shown as it would read), and
// YOUR OWN reminders — a day, a note, a client — that ring on their day and
// stay on the Today tab until ticked done.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { addServiceReminder, removeServiceReminder, saveDeskPrefs, setServiceReminderDone, snoozeServiceReminder } from "@/actions/serviceDesk";
import { HEADS_UP_CHOICES, UNSIGNED_CHOICES, addDay, reminderPresets, type DeskPrefs } from "@/lib/serviceDesk";
import type { DeskReminderView } from "@/lib/serviceDeskBook";
import { Plate, cx, dayWords, useDesk } from "./desk-shared";

export function RemindersTab() {
  const { reminderPreset } = useDesk();
  return (
    <div className={cx("grid2", "grid2--even")}>
      <PrefsCard />
      <section className={cx("card")} data-desk-reminders>
        <div className={cx("card-h")}>
          <div className={cx("card-t")}>Your reminders</div>
          <div className={cx("card-s")}>rung on their day · listed on Today until done</div>
        </div>
        <ReminderForm key={reminderPreset?.nonce ?? 0} />
        <ReminderList />
      </section>
    </div>
  );
}

function PrefsCard() {
  const { data, act, busy } = useDesk();
  const [p, setP] = useState<DeskPrefs>(data.prefs);
  const changed = p.headsUpDays !== data.prefs.headsUpDays || p.unsignedDays !== data.prefs.unsignedDays || p.dailyDigest !== data.prefs.dailyDigest;
  const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  const { names, extras } = data.texting;

  return (
    <section className={cx("card")} data-desk-prefs>
      <div className={cx("card-h")}>
        <div className={cx("card-t")}>When JobFlex reminds you</div>
        <div className={cx("card-s")}>for the whole office</div>
      </div>
      <form
        className={cx("frm")}
        onSubmit={(e) => {
          e.preventDefault();
          act("prefs", () => saveDeskPrefs(p));
        }}
        data-prefs-form
      >
        <label className={cx("fld")}>
          <span className={cx("lbl")}>Heads-up before a plan visit</span>
          <select className={cx("sel")} value={p.headsUpDays} onChange={(e) => setP({ ...p, headsUpDays: Number(e.target.value) })} data-pref="headsUpDays">
            {HEADS_UP_CHOICES.map((n) => (
              <option key={n} value={n}>
                {days(n)} before
              </option>
            ))}
          </select>
        </label>
        <label className={cx("fld")}>
          <span className={cx("lbl")}>Follow up an unsigned plan</span>
          <select className={cx("sel")} value={p.unsignedDays} onChange={(e) => setP({ ...p, unsignedDays: Number(e.target.value) })} data-pref="unsignedDays">
            {UNSIGNED_CHOICES.map((n) => (
              <option key={n} value={n}>
                after {days(n)}
              </option>
            ))}
          </select>
        </label>
        <label className={cx("switch", "wide")}>
          <input type="checkbox" checked={p.dailyDigest} onChange={(e) => setP({ ...p, dailyDigest: e.target.checked })} data-pref="dailyDigest" />
          <span>
            <b>A daily digest</b>
            <span className={cx("hint")}>Once a day, mid-morning: today&apos;s visits, the visits {days(p.headsUpDays)} out, late bills, plans to sign or renew, and your reminders due. Nothing is sent on a quiet day.</span>
          </span>
        </label>
        <div className={cx("acts", "wide")}>
          <button type="submit" className={cx("btn", "btn-primary", "btn--sm")} disabled={!changed || !!busy} data-prefs-save>
            {busy === "prefs" ? "Saving…" : changed ? "Save" : "Saved"}
          </button>
        </div>
      </form>

      <div className={cx("sec-h")} style={{ marginTop: 18 }}>
        Where they show up
      </div>
      <p className={cx("hint")}>
        <b>In the bell</b> for everyone in the office — each visit&apos;s heads-up, each of your reminders, the digest.
        <br />
        <b>By text</b>{" "}
        {names.length || extras ? (
          <>
            to {names.join(", ")}
            {extras ? `${names.length ? " and " : ""}${extras} company number${extras === 1 ? "" : "s"}` : ""} — the digest only, one text a day at most.
          </>
        ) : (
          <>to nobody yet — switch on &ldquo;Service reminders&rdquo; for a person on the Texting page.</>
        )}{" "}
        <Link className={cx("linkish")} href={"/dashboard/texting" as Route}>
          Open Texting
        </Link>
      </p>

      <div className={cx("sec-h")} style={{ marginTop: 18 }}>
        Today&apos;s digest would read
      </div>
      {data.digestPreview && data.prefs.dailyDigest ? (
        <div className={cx("preview")} data-digest-preview>
          {data.digestPreview}
        </div>
      ) : (
        <p className={cx("hint")}>{data.prefs.dailyDigest ? "Nothing to send today — a quiet day sends nothing." : "The digest is off."}</p>
      )}
    </section>
  );
}

function ReminderForm() {
  const { data, act, busy, reminderPreset, focus } = useDesk();
  const [dueOn, setDueOn] = useState(addDay(data.today, 1));
  const [note, setNote] = useState(reminderPreset?.note ?? "");
  const [clientId, setClientId] = useState(reminderPreset?.clientId ?? "");
  const ref = useRef<HTMLFormElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focus === "add") {
      ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      noteRef.current?.focus({ preventScroll: true });
    }
  }, [focus]);
  const presets = reminderPresets(data.today);

  return (
    <form
      ref={ref}
      className={cx("frm")}
      onSubmit={async (e) => {
        e.preventDefault();
        const plan = reminderPreset?.planId ?? data.plans.find((x) => x.clientId === clientId && x.filter !== "past")?.id ?? null;
        if (await act("reminder:add", () => addServiceReminder({ dueOn, note, clientId: clientId || null, planId: plan }))) setNote("");
      }}
      data-reminder-form
    >
      <label className={cx("fld", "wide")}>
        <span className={cx("lbl")}>Remind me to</span>
        <input ref={noteRef} className={cx("in")} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Call about the filter swap · follow up the quote · check the warranty" maxLength={400} required minLength={2} data-reminder-note />
      </label>
      <label className={cx("fld")}>
        <span className={cx("lbl")}>On</span>
        <input className={cx("in")} type="date" value={dueOn} min={data.today} onChange={(e) => setDueOn(e.target.value)} required data-reminder-day />
      </label>
      <label className={cx("fld")}>
        <span className={cx("lbl")}>For a client (optional)</span>
        <select className={cx("sel")} value={clientId} onChange={(e) => setClientId(e.target.value)} data-reminder-client>
          <option value="">No client</option>
          {data.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.onPlan ? " · on a plan" : ""}
            </option>
          ))}
        </select>
      </label>
      <div className={cx("chips", "wide")}>
        {presets.map((p) => (
          <button key={p.label} type="button" className={cx("chip", dueOn === p.day && "chip--on")} onClick={() => setDueOn(p.day)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className={cx("acts", "wide")}>
        <button type="submit" className={cx("btn", "btn-primary", "btn--sm")} disabled={!!busy || note.trim().length < 2} data-reminder-add>
          {busy === "reminder:add" ? "Setting…" : `Remind me ${dueOn ? `on ${dayWords(dueOn)}` : ""}`}
        </button>
      </div>
    </form>
  );
}

function ReminderList() {
  const { data } = useDesk();
  const open = data.reminders.filter((r) => !r.done);
  const done = data.reminders.filter((r) => r.done).slice(0, 10);
  if (!open.length && !done.length) return <div className={cx("empty")}>No reminders yet.</div>;
  return (
    <>
      {open.length > 0 && (
        <>
          <div className={cx("sec-h")} style={{ marginTop: 18 }}>
            Open · {open.length}
          </div>
          {open.map((r) => (
            <ReminderRow key={r.id} r={r} />
          ))}
        </>
      )}
      {done.length > 0 && (
        <>
          <div className={cx("sec-h")} style={{ marginTop: 18 }}>
            Done · last 30 days
          </div>
          {done.map((r) => (
            <ReminderRow key={r.id} r={r} />
          ))}
        </>
      )}
    </>
  );
}

function ReminderRow({ r }: { r: DeskReminderView }) {
  const { act, busy } = useDesk();
  const k = (w: string) => `rem:${r.id}:${w}`;
  const b = (w: string, label: string, fn: () => Promise<unknown>, primary = false) => (
    <button type="button" className={cx("btn", primary ? "btn-primary" : "btn-ghost", "btn--xs")} disabled={!!busy} onClick={() => act(k(w), fn)} data-rem-act={w}>
      {busy === k(w) ? "…" : label}
    </button>
  );
  return (
    <div className={cx("rem", r.done && "rem--done")} data-reminder={r.state}>
      <Plate tone={r.state}>{r.state === "late" ? "Late" : r.state === "due" ? "Today" : r.state === "done" ? "Done" : r.dayText}</Plate>
      <div>
        <div className={cx("rem-t")}>{r.note}</div>
        <span className={cx("sub")}>
          {[r.state === "late" || r.state === "due" ? r.dayText : null, r.clientName, r.by ? `set by ${r.by}` : null].filter(Boolean).join(" · ")}
        </span>
      </div>
      <div className={cx("acts")}>
        {r.done ? (
          b("undo", "Open again", () => setServiceReminderDone(r.id, false))
        ) : (
          <>
            {b("done", "Done", () => setServiceReminderDone(r.id, true), r.state !== "ahead")}
            {b("day", "+1 day", () => snoozeServiceReminder(r.id, 1))}
            {b("week", "+1 week", () => snoozeServiceReminder(r.id, 7))}
          </>
        )}
        {b("remove", "Remove", () => removeServiceReminder(r.id))}
      </div>
    </div>
  );
}
