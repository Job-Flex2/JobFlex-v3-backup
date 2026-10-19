"use client";

// YOUR OWN TEXTS (2026-09-29) — the screen. Owner: "make option for user to
// create new text situation by themselves". A list of the company's texts
// (on/off, edit, delete), ready-made ideas one tap away, and an editor:
// WHEN (a moment, or hours before / days after), WHO (the client, the office,
// the rep, the crew, named people), WHAT (the words, with {fields} that fill
// in from the job) — and the text as it will read, live, under the box.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { deleteTextRule, saveTextRule, setTextRuleActive, testTextRule, type TextRuleInput, type TextRuleResult } from "@/actions/textRules";
import {
  RULE_BODY_MAX,
  RULE_FIELDS,
  RULE_PRESETS,
  RULE_RECIPIENTS,
  RULE_TRIGGERS,
  SAMPLE_VARS,
  renderRuleText,
  signed,
  triggerOf,
  unknownFields,
  whenText,
  withStopLine,
  type RulePreset,
  type RuleRecipient,
} from "@/lib/sms/textRules";
import { roleLabel } from "@/lib/team/who";
import type { SmsRosterRow, TextRuleRow } from "@/components/v3/settings-blueprint/settings-data";
import { TEXTING_COPY, TEXTS_COPY } from "@/components/v3/settings-blueprint/settings-data";
import "./texting-kit.css";

type Draft = {
  id?: string;
  name: string;
  trigger: string;
  offset: number | null;
  to: Record<RuleRecipient, boolean>;
  toUserIds: string[];
  body: string;
  active: boolean;
};

const EMPTY: Draft = { name: "", trigger: "proposal.accepted", offset: null, to: { client: true, office: false, rep: false, crew: false }, toUserIds: [], body: "", active: true };
const GROUPS = [...new Set(RULE_TRIGGERS.map((t) => t.group))];

function fromRow(r: TextRuleRow): Draft {
  return { id: r.id, name: r.name, trigger: r.trigger, offset: r.offset, to: { client: r.toClient, office: r.toOffice, rep: r.toRep, crew: r.toCrew }, toUserIds: r.toUserIds, body: r.body, active: r.active };
}
function fromPreset(p: RulePreset): Draft {
  return { name: p.name, trigger: p.trigger, offset: p.offset ?? null, to: { client: p.to.includes("client"), office: p.to.includes("office"), rep: p.to.includes("rep"), crew: p.to.includes("crew") }, toUserIds: [], body: p.body, active: true };
}
function toInput(d: Draft): TextRuleInput {
  return { id: d.id, name: d.name, trigger: d.trigger, offset: d.offset, toClient: d.to.client, toOffice: d.to.office, toRep: d.to.rep, toCrew: d.to.crew, toUserIds: d.toUserIds, body: d.body, active: d.active };
}

export function TextRules({ rules, roster, clientsOn, company }: { rules: TextRuleRow[]; roster: SmsRosterRow[]; clientsOn: boolean; company: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [armed, setArmed] = useState<string | null>(null);
  const run = async (label: string, fn: () => Promise<TextRuleResult>, after?: () => void) => {
    setBusy(label);
    setNote("");
    setErr("");
    try {
      const r = await fn();
      if (r.ok) {
        setNote(r.note ?? "Saved.");
        after?.();
        router.refresh();
      } else setErr(r.error);
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(null);
    }
  };
  const nameOf = (id: string) => roster.find((r) => r.userId === id)?.name ?? "someone";
  const toText = (r: TextRuleRow) =>
    [r.toClient ? "the client" : null, r.toOffice ? "owner & managers" : null, r.toRep ? "the rep" : null, r.toCrew ? "the crew" : null, ...r.toUserIds.map(nameOf)].filter(Boolean).join(", ");
  const preview = (r: TextRuleRow) => (r.toClient ? withStopLine(signed(company, renderRuleText(r.body, { ...SAMPLE_VARS, company }))) : signed(company, renderRuleText(r.body, { ...SAMPLE_VARS, company })));
  // THE INSIDE, FOR CLARITY (2026-10-18): the count and the one blue "+ New text" first; each text a row —
  // its switch, its name, When / To as two labelled facts, and how it reads; an idea is one tap, in a column.
  return (
    <div className="jf-tx tk-rules" data-text-rules data-nest="">
      {!draft ? (
        <div className="tk-rulesH">
          <b>{rules.length ? TEXTING_COPY.rulesCount(rules.length) : TEXTING_COPY.rulesEmpty}</b>
          <button type="button" className="tk-btn tk-btn--primary" onClick={() => setDraft({ ...EMPTY })} data-new-rule>
            {TEXTING_COPY.rulesNew}
          </button>
        </div>
      ) : null}
      {rules.length ? (
        <ul className="tk-ruleList">
          {rules.map((r) => (
            <li key={r.id} className={`tk-rule${r.active ? "" : " is-off"}`} data-rule={r.id}>
              <button
                type="button"
                className={`tk-switch tk-switch--bare${r.active ? " is-on" : ""}`}
                role="switch"
                aria-checked={r.active}
                aria-label={`${r.name} ${r.active ? "on" : "off"}`}
                disabled={busy !== null}
                onClick={() => run(`${r.id}:sw`, () => setTextRuleActive(r.id, !r.active))}
              >
                <i aria-hidden="true" />
              </button>
              <div className="tk-ruleMain">
                <span className="tk-ruleName">
                  <b>{r.name}</b>
                  {!r.active ? <span className="tk-tag">{TEXTS_COPY.clientsOff}</span> : null}
                </span>
                <p className="tk-facts">
                  <span>
                    <em>When</em>
                    {whenText(r.trigger, r.offset)}
                  </span>
                  <span>
                    <em>To</em>
                    {toText(r) || "nobody"}
                  </span>
                </p>
                <q className="tk-bubble">{preview(r)}</q>
              </div>
              <div className="tk-ruleA">
                <button type="button" className="tk-btn" disabled={busy !== null} onClick={() => { setDraft(fromRow(r)); setArmed(null); }}>
                  Edit
                </button>
                <button
                  type="button"
                  className={`tk-btn${armed === r.id ? " tk-btn--danger" : ""}`}
                  disabled={busy !== null}
                  onClick={() => (armed === r.id ? run(`${r.id}:del`, () => deleteTextRule(r.id), () => setArmed(null)) : setArmed(r.id))}
                >
                  {armed === r.id ? "Delete it" : "Delete"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {!draft ? (
        <div className="tk-ideas">
          <span className="tk-label">{TEXTING_COPY.rulesIdeas}</span>
          <div className="tk-ideasL">
            {RULE_PRESETS.map((p) => (
              <button key={p.id} type="button" className="tk-idea" onClick={() => setDraft(fromPreset(p))} data-preset={p.id}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <Editor draft={draft} setDraft={setDraft} roster={roster} clientsOn={clientsOn} company={company} busy={busy} run={run} />
      )}
      {note ? <p className="tk-msg" role="status">{note}</p> : null}
      {err ? <p className="tk-msg is-err" role="alert">{err}</p> : null}
    </div>
  );
}

function Editor({
  draft,
  setDraft,
  roster,
  clientsOn,
  company,
  busy,
  run,
}: {
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  roster: SmsRosterRow[];
  clientsOn: boolean;
  company: string;
  busy: string | null;
  run: (label: string, fn: () => Promise<TextRuleResult>, after?: () => void) => Promise<void>;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const t = triggerOf(draft.trigger)!;
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const insert = (field: string) => {
    const el = box.current;
    const token = `{${field}}`;
    if (!el) return set({ body: (draft.body + " " + token).trim() });
    const a = el.selectionStart ?? draft.body.length;
    const b = el.selectionEnd ?? a;
    const next = (draft.body.slice(0, a) + token + draft.body.slice(b)).slice(0, RULE_BODY_MAX);
    set({ body: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + token.length, a + token.length);
    });
  };
  const unknown = unknownFields(draft.body, draft.trigger);
  const words = renderRuleText(draft.body, { ...SAMPLE_VARS, company });
  const staffPreview = words ? signed(company, words) : "";
  const clientPreview = words ? withStopLine(signed(company, words)) : "";
  const anyone = (Object.keys(draft.to) as RuleRecipient[]).some((k) => draft.to[k] && t.recipients.includes(k)) || draft.toUserIds.length > 0;
  const canSave = draft.body.trim().length > 0 && unknown.length === 0 && anyone && busy === null;
  const ids = { name: "tr-name", when: "tr-when", offset: "tr-offset", body: "tr-body" };
  return (
    <div className="tk-editor" data-rule-editor>
      <h3>{draft.id ? TEXTING_COPY.ruleEditOld : TEXTING_COPY.ruleEditNew}</h3>
      <div className="tk-edRow">
        <label className="tk-label" htmlFor={ids.name}>Name</label>
        <div className="tk-edBody">
          <input id={ids.name} className="tk-input" value={draft.name} maxLength={80} placeholder={t.label} onChange={(e) => set({ name: e.target.value })} />
        </div>
      </div>
      <div className="tk-edRow">
        <label className="tk-label" htmlFor={ids.when}>When</label>
        <div className="tk-edBody">
          <select
            id={ids.when}
            className="tk-input"
            value={draft.trigger}
            onChange={(e) => {
              const nt = triggerOf(e.target.value)!;
              set({ trigger: nt.key, offset: nt.timed ? nt.timed.default : null });
            }}
          >
            {GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {RULE_TRIGGERS.filter((x) => x.group === g).map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                    {x.timed ? ` (${x.timed.unit} ${x.timed.dir})` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {t.timed ? (
            <span className="tk-offset">
              <input
                id={ids.offset}
                className="tk-input tk-input--num"
                type="number"
                min={t.timed.min}
                max={t.timed.max}
                value={draft.offset ?? t.timed.default}
                onChange={(e) => set({ offset: Math.max(t.timed!.min, Math.min(t.timed!.max, Number(e.target.value) || t.timed!.default)) })}
                aria-label={`${t.timed.unit} ${t.timed.dir}`}
              />
              <span>
                {t.timed.unit} {t.timed.dir}
              </span>
            </span>
          ) : null}
        </div>
      </div>
      <div className="tk-edRow">
        <span className="tk-label tk-label--top">Who gets it</span>
        <div className="tk-edBody">
          <div className="tk-ticks" role="group" aria-label="Who gets it">
            {(Object.keys(RULE_RECIPIENTS) as RuleRecipient[]).map((k) => {
              const can = t.recipients.includes(k);
              const on = can && draft.to[k];
              return (
                <button key={k} type="button" className={`tk-tick${on ? " is-on" : ""}`} aria-pressed={on} disabled={!can} title={can ? RULE_RECIPIENTS[k].sub : "Not for this moment"} data-to={k} onClick={() => set({ to: { ...draft.to, [k]: !draft.to[k] } })}>
                  <i aria-hidden="true" />
                  {RULE_RECIPIENTS[k].label}
                </button>
              );
            })}
          </div>
          {draft.to.client && t.recipients.includes("client") && !clientsOn ? <p className="tk-callout" data-tone="wait">Text clients is off (The company, below) — nothing goes to clients until it is on.</p> : null}
        </div>
      </div>
      {roster.length ? (
        <div className="tk-edRow">
          <span className="tk-label tk-label--top">Also</span>
          <div className="tk-edBody">
            <div className="tk-ticks tk-ticks--cols" role="group" aria-label="Also">
              {roster.map((r) => {
                const on = draft.toUserIds.includes(r.userId);
                return (
                  <button key={r.userId} type="button" className={`tk-tick${on ? " is-on" : ""}`} aria-pressed={on} title={r.phone ? `${roleLabel(r.role)} · ${r.phone}` : `${roleLabel(r.role)} · no mobile yet`} data-also={r.userId} onClick={() => set({ toUserIds: on ? draft.toUserIds.filter((x) => x !== r.userId) : [...draft.toUserIds, r.userId] })}>
                    <i aria-hidden="true" />
                    {r.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
      <div className="tk-edRow">
        <label className="tk-label" htmlFor={ids.body}>The text</label>
        <div className="tk-edBody">
          <textarea id={ids.body} className="tk-input" ref={box} value={draft.body} maxLength={RULE_BODY_MAX} rows={3} placeholder="Hi {first}, …" onChange={(e) => set({ body: e.target.value })} />
          <div className="tk-fills">
            <span>Fill in:</span>
            {t.fields.map((f) => (
              <button key={f} type="button" className="tk-fill" title={RULE_FIELDS[f].sub} onClick={() => insert(f)}>
                {RULE_FIELDS[f].label}
              </button>
            ))}
            <span className="tk-num">
              {draft.body.length}/{RULE_BODY_MAX}
            </span>
          </div>
          {unknown.length ? <p className="tk-msg is-err">{`This moment can't fill ${unknown.map((f) => `{${f}}`).join(", ")}.`}</p> : null}
        </div>
      </div>
      {words ? (
        <div className="tk-edRow">
          <span className="tk-label tk-label--top">How it reads</span>
          <div className="tk-preview">
            {draft.to.client && t.recipients.includes("client") ? (
              <p>
                <em>Client</em>
                <q className="tk-bubble">{clientPreview}</q>
              </p>
            ) : null}
            {(draft.to.office || draft.to.rep || draft.to.crew || draft.toUserIds.length) ? (
              <p>
                <em>Team</em>
                <q className="tk-bubble">{staffPreview}</q>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="tk-edActs">
        <button type="button" className="tk-btn tk-btn--primary" disabled={!canSave} onClick={() => run("save", () => saveTextRule(toInput(draft)), () => setDraft(null))}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button type="button" className="tk-btn" disabled={!canSave} onClick={() => run("test", () => testTextRule(toInput(draft)))}>
          Send me a test
        </button>
        <button type="button" className="tk-btn" disabled={busy !== null} onClick={() => setDraft(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
