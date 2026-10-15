"use client";

// Settings blueprint — Texting pane (2026-09-27).
//
// Owner: "make Twilio settings at the owner's side to set who receives SMS —
// look at how SmartSpace Pro did it." SmartSpace's page has three parts and
// so does this one: the hookup (here JobFlex owns the Twilio account, so the
// hookup is one line of status), the roster — who gets texted, by group —
// and the extra numbers outside the team. The member's own mobile (the
// six-digit verification) and the company's client texts and own number
// come back here from the Notifications page, where the owner took them
// off on 2026-09-26.
//
// The roster writes each member's stored Text cells (actions/sms
// setMemberTextGroups); textOffice already reads them, so a switch here is
// the whole change.

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  addNotificationPhone,
  confirmPhoneVerification,
  removeNotificationPhone,
  removeSmsPhone,
  sendTestText,
  setLeadTexts,
  setNotificationPhoneActive,
  startPhoneVerification,
  type SmsActionResult,
} from "@/actions/sms";
import { TextingPeople } from "@/components/v3/texting-people/texting-people";
import { ClientTextsSwitch, TextingOverview } from "@/components/v3/texting-people/texting-overview";
import { TextRules } from "@/components/v3/texting-people/text-rules";
import { OwnNumber } from "@/components/v3/texting-people/own-number";
import { REGISTRATION_COPY } from "@/lib/sms/registrationShared";
import { Field, actionError } from "../ui";
import type { PaneProps, SmsSettingsData } from "../settings-data";
import { TEXTING_COPY, TEXTS_COPY } from "../settings-data";

export function TextingPane({ data }: PaneProps) {
  const sms = data.notifications.sms;
  // THE ORDER IS THE SETUP (owner, 2026-10-13: "make it understandable for contractors"): what is texted now and the
  // steps, then each step in turn — the number (nothing goes out without it), the team, clients, your own texts —
  // and the rest after.
  return (
    <>
      {sms.canManage ? (
        <section className="sc" id="texting-overview">
          <div className="sc-h">
            <div>
              <div className="sc-t">{TEXTING_COPY.overviewTitle}</div>
              <div className="sc-s">{TEXTING_COPY.overviewSub}</div>
            </div>
            <span className="sc-badge" title={TEXTS_COPY.overage}>{TEXTS_COPY.usage(sms.monthCount, sms.allowance)}</span>
          </div>
          <div className="sc-b">
            <TextingOverview sms={sms} />
          </div>
        </section>
      ) : !sms.configured ? (
        <section className="sc" id="texting-status">
          <div className="sc-b">
            <p className="tx-note tx-note--warn" style={{ margin: 0 }}>{TEXTING_COPY.notConfiguredLong}</p>
          </div>
        </section>
      ) : null}
      {sms.canManage ? (
        <section className="sc" id="texting-own-number">
          <div className="sc-h">
            <div>
              <div className="sc-t">1 · {REGISTRATION_COPY.title}</div>
              <div className="sc-s">{REGISTRATION_COPY.sub}</div>
            </div>
          </div>
          <div className="sc-b">
            <OwnNumber view={sms.registration} configured={sms.configured} />
          </div>
        </section>
      ) : null}
      {sms.canManage ? <PeopleCard sms={sms} /> : null}
      {sms.canManage ? <ExtrasCard sms={sms} /> : null}
      {sms.canManage ? <ClientsCard sms={sms} /> : null}
      {sms.canManage ? (
        <section className="sc" id="texting-rules">
          <div className="sc-h">
            <div>
              <div className="sc-t">4 · {TEXTING_COPY.rulesTitle}</div>
              <div className="sc-s">{TEXTING_COPY.rulesSub}</div>
            </div>
          </div>
          <div className="sc-b">
            <TextRules rules={sms.rules} roster={sms.roster} clientsOn={sms.clientsOn} company={sms.companyName || "Your company"} />
          </div>
        </section>
      ) : null}
      {/* The office verifies its own mobile on its roster row (2026-10-14); this
          card is for a sales rep, an estimator or a worker who opens Settings. */}
      {sms.canManage ? null : <MobileCard sms={sms} />}
      {sms.canManage ? <LeadTextsCard sms={sms} /> : null}
    </>
  );
}

/** One `run` for every button on the pane: the action's note or its error. */
function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  async function run(label: string, fn: () => Promise<SmsActionResult>, after?: () => void) {
    setBusy(label);
    setNote("");
    setErr("");
    try {
      const r = await fn();
      if (r.ok) {
        setNote(r.note ?? "Done.");
        after?.();
        router.refresh();
      } else setErr(r.error);
    } catch (e) {
      setErr(actionError(e));
    } finally {
      setBusy(null);
    }
  }
  const notes = (
    <>
      {note ? <p className="tx-note" role="status">{note}</p> : null}
      {err ? <p className="tx-note tx-note--err" role="alert">{err}</p> : null}
    </>
  );
  return { busy, run, notes };
}

/* ── who gets texted, person by person (2026-09-29) ─────────────────── */

function PeopleCard({ sms }: { sms: SmsSettingsData }) {
  return (
    <section className="sc" id="texting-roster" data-roster>
      <div className="sc-h">
        <div>
          <div className="sc-t">2 · {TEXTING_COPY.peopleTitle}</div>
          <div className="sc-s">{TEXTING_COPY.peopleSub}</div>
        </div>
      </div>
      <div className="sc-b">
        <TextingPeople roster={sms.roster} />
      </div>
    </section>
  );
}

/* ── my mobile ───────────────────────────────────────────────────────── */

function MobileCard({ sms }: { sms: SmsSettingsData }) {
  const { busy, run, notes } = useRun();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"idle" | "code">("idle");
  return (
    <section className="sc" id="texting-mobile">
      <div className="sc-h">
        <div>
          <div className="sc-t">{TEXTING_COPY.mineTitle}</div>
          <div className="sc-s">{TEXTING_COPY.mineSub}</div>
        </div>
      </div>
      <div className="sc-b">
        {sms.phone && stage === "idle" ? (
          <div className="tx-row">
            <div className="tx-row-t">
              <b>{sms.phone}</b>
              <span className={`tx-tag${sms.stopped ? " tx-tag--warn" : ""}`}>{sms.stopped ? TEXTS_COPY.stopped : TEXTS_COPY.verified}</span>
            </div>
            <div className="tx-row-a">
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => run("test", sendTestText)}>
                {TEXTS_COPY.testText}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => run("remove", removeSmsPhone)}>
                {TEXTS_COPY.remove}
              </button>
            </div>
          </div>
        ) : (
          <div className="tx-verify">
            {!sms.phone ? <p className="tx-note">{TEXTS_COPY.noPhone}</p> : null}
            <div className="fgrid">
              <Field label={TEXTS_COPY.mobileLabel} value={phone} placeholder={TEXTS_COPY.mobilePlaceholder} onChange={setPhone} disabled={stage === "code"} />
              {stage === "code" ? <Field label={TEXTS_COPY.codeLabel} value={code} placeholder="482913" onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} /> : null}
            </div>
            <div className="tx-row-a">
              {stage === "idle" ? (
                <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null || phone.replace(/\D/g, "").length < 10} onClick={() => run("code", () => startPhoneVerification(phone), () => setStage("code"))}>
                  {busy === "code" ? "Sending…" : TEXTS_COPY.sendCode}
                </button>
              ) : (
                <>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null || code.length !== 6} onClick={() => run("verify", () => confirmPhoneVerification(code), () => { setStage("idle"); setCode(""); setPhone(""); })}>
                    {busy === "verify" ? "Checking…" : TEXTS_COPY.verify}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => { setStage("idle"); setCode(""); }}>
                    {TEXTS_COPY.change}
                  </button>
                </>
              )}
            </div>
            <p className="tx-note" data-sms-consent>
              {TEXTS_COPY.consent} <a href="/terms">{TEXTS_COPY.terms}</a> · <a href="/privacy">{TEXTS_COPY.privacy}</a>
            </p>
          </div>
        )}
        {notes}
      </div>
    </section>
  );
}

/* ── 3 · clients (2026-10-13: its own card, with the same switch as the overview) ── */

function ClientsCard({ sms }: { sms: SmsSettingsData }) {
  return (
    <section className="sc" id="texting-clients">
      <div className="sc-h">
        <div>
          <div className="sc-t">3 · {TEXTS_COPY.clientsTitle}</div>
          <div className="sc-s">{TEXTS_COPY.clientsSub}</div>
        </div>
      </div>
      <div className="sc-b">
        <ClientTextsSwitch on={sms.clientsOn} />
        <p className="tx-note">{REGISTRATION_COPY.consent}</p>
      </div>
    </section>
  );
}

/* ── numbers outside the team ──────────────────────────────────────── */

function ExtrasCard({ sms }: { sms: SmsSettingsData }) {
  const { busy, run, notes } = useRun();
  const [extraName, setExtraName] = useState("");
  const [extraPhone, setExtraPhone] = useState("");
  return (
    <section className="sc" id="texting-extras">
      <div className="sc-h">
        <div>
          <div className="sc-t">{TEXTS_COPY.extrasTitle}</div>
          <div className="sc-s">{TEXTS_COPY.extrasSub}</div>
        </div>
      </div>
      <div className="sc-b">
        {sms.extras.length ? (
          <ul className="tx-list">
            {sms.extras.map((x) => (
              <li key={x.id} className={x.active ? "" : "is-paused"}>
                <span className="tx-list-n">{x.name}</span>
                <span className="tx-list-p">{x.phone}</span>
                {x.stopped ? <span className="tx-tag tx-tag--warn">{TEXTS_COPY.stopped}</span> : !x.active ? <span className="tx-tag">paused</span> : null}
                <span className="tx-list-a">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => run("toggle", () => setNotificationPhoneActive(x.id, !x.active))}>
                    {x.active ? TEXTS_COPY.pause : TEXTS_COPY.resume}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => run("drop", () => removeNotificationPhone(x.id))}>
                    {TEXTS_COPY.removeExtra}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="fgrid">
          <Field label={TEXTS_COPY.extraName} value={extraName} placeholder="Dispatch" onChange={setExtraName} />
          <Field label={TEXTS_COPY.extraPhone} value={extraPhone} placeholder={TEXTS_COPY.mobilePlaceholder} onChange={setExtraPhone} />
        </div>
        <div className="tx-row-a">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy !== null || !extraName.trim() || extraPhone.replace(/\D/g, "").length < 10}
            onClick={() => run("add", () => addNotificationPhone({ name: extraName, phone: extraPhone }), () => { setExtraName(""); setExtraPhone(""); })}
          >
            {busy === "add" ? "Adding…" : TEXTS_COPY.addExtra}
          </button>
        </div>
        {notes}
      </div>
    </section>
  );
}

/* ── JobFlex's own lead texts to the company (a different number: JobFlex's) ── */

function LeadTextsCard({ sms }: { sms: SmsSettingsData }) {
  const { busy, run, notes } = useRun();
  return (
    <section className="sc" id="texting-lead-texts" data-lead-texts={sms.leadTexts.on ? "on" : "off"}>
      <div className="sc-h">
        <div>
          <div className="sc-t">{TEXTS_COPY.leadTitle}</div>
          <div className="sc-s">{TEXTS_COPY.leadSub}</div>
        </div>
      </div>
      <div className="sc-b">
        <div className="tx-row-a tx-row-a--left">
          <button type="button" className={`btn btn-sm ${sms.leadTexts.on ? "btn-primary" : "btn-ghost"}`} disabled={busy !== null || sms.leadTexts.on || !sms.leadTexts.phone} onClick={() => run("lead", () => setLeadTexts(true))}>
            {TEXTS_COPY.clientsOn}
          </button>
          <button type="button" className={`btn btn-sm ${sms.leadTexts.on ? "btn-ghost" : "btn-primary"}`} disabled={busy !== null || !sms.leadTexts.on} onClick={() => run("lead", () => setLeadTexts(false))}>
            {TEXTS_COPY.clientsOff}
          </button>
          <span className="tx-note" style={{ margin: 0, alignSelf: "center" }}>{sms.leadTexts.phone ? `To ${sms.leadTexts.phone}` : TEXTS_COPY.leadNoPhone}</span>
        </div>
        <p className="tx-note" data-lead-consent>
          {TEXTS_COPY.leadConsent} <a href="/terms#sms">{TEXTS_COPY.terms}</a> · <a href="/privacy#sms">{TEXTS_COPY.privacy}</a>
        </p>
        {notes}
      </div>
    </section>
  );
}
