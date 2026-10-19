"use client";

// HVAC SERVICES · PLANS (2026-10-18): where the service side is SET UP. Put a
// client on a plan — and say what it belongs to: the proposal or project it
// was sold with (JobFlex picks the client's accepted HVAC proposal on its
// own) — next to what happens the moment a plan starts, then the plans the
// shop sells, each one editable.

import { useEffect, useRef, useState } from "react";
import { archiveServicePlanTemplate, enrollClient, saveServicePlanTemplate, seedStarterPlans } from "@/actions/servicePlans";
import { deskClientLinks } from "@/actions/serviceDesk";
import type { ServiceDeskData } from "@/lib/serviceDeskBook";
import { cx, useDesk } from "./desk-shared";

type Choices = { proposals: Array<{ id: string; label: string; hvac: boolean; accepted: boolean }>; projects: Array<{ id: string; label: string }> };

export function PlansTab() {
  const { data, act, busy, enrollPreset } = useDesk();
  const hasPlans = data.templates.length > 0;
  return (
    <div className={cx("stack")}>
      <div className={cx("grid2")}>
        <section className={cx("card")} data-desk-enroll>
          <div className={cx("card-h")}>
            <div className={cx("card-t")}>Enroll a client</div>
            <div className={cx("card-s")}>send it to sign, or start it today when they signed with you</div>
          </div>
          {hasPlans ? (
            <EnrollForm key={enrollPreset?.nonce ?? 0} />
          ) : (
            <div className={cx("empty")}>
              Add the plans you sell first — the three starter plans are one click away.
              <div style={{ marginTop: 10 }}>
                <button type="button" className={cx("btn", "btn-primary", "btn--sm")} disabled={!!busy} onClick={() => act("seed", () => seedStarterPlans(), "Three starter plans added — edit any number below.")} data-seed-plans>
                  Add the three starter plans
                </button>
              </div>
            </div>
          )}
        </section>

        <section className={cx("card")} data-desk-how>
          <div className={cx("card-h")}>
            <div className={cx("card-t")}>What happens when a plan starts</div>
          </div>
          <ol className={cx("steps-list")}>
            <li>
              <b>The visits go on the calendar.</b> Two a year land around Apr 15 (cooling tune-up) and Oct 1 (heating tune-up), at 9:00, with the crew&apos;s checklist and the report form in the notes. One a year takes the next season.
            </li>
            <li>
              <b>The first bill goes out</b> by email, then every month or year on its own. You mark them paid when the money lands.
            </li>
            <li>
              <b>The member discount rides on every new proposal</b> for that client — repairs, a new system, anything.
            </li>
            <li>
              <b>You get reminded:</b> a heads-up before each visit, a daily digest, unsigned plans and late bills on the Today tab. The client hears two weeks before a visit.
            </li>
            <li>
              <b>At the end it renews</b> on its own (or ends, if you turn auto-renew off). You hear 30 days ahead.
            </li>
          </ol>
        </section>
      </div>

      <section className={cx("card")} data-desk-templates>
        <div className={cx("card-h")}>
          <div className={cx("card-t")}>The plans you sell</div>
          <div className={cx("card-s")}>a member keeps the terms they signed · edits shape the next enrollment</div>
        </div>
        <div className={cx("tpl")}>
          {data.templates.map((t) => (
            <TemplateCard key={t.id} t={t} />
          ))}
          <div className={cx("tpl-card")} data-plan-template-new>
            <div className={cx("card-t")}>New plan</div>
            <div className={cx("tpl-terms")}>visits a year, price, discount, what it includes</div>
            <TemplateForm />
          </div>
        </div>
      </section>
    </div>
  );
}

function EnrollForm() {
  const { data, act, busy, enrollPreset, goTab, focus } = useDesk();
  const [clientId, setClientId] = useState(enrollPreset?.clientId ?? "");
  const [templateId, setTemplateId] = useState(data.templates[0]?.id ?? "");
  const [choices, setChoices] = useState<Choices | null>(null);
  const [tie, setTie] = useState<string>("auto");
  const [suggested, setSuggested] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!enrollPreset?.clientId);
  const ref = useRef<HTMLFormElement>(null);
  const presetProposal = enrollPreset?.proposalId ?? null;

  useEffect(() => {
    if (focus === "enroll") ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus]);

  // A client picked: their proposals and projects, with JobFlex's guess picked.
  useEffect(() => {
    let live = true;
    if (!clientId) return;
    deskClientLinks(clientId)
      .then((r) => {
        if (!live) return;
        if (!r.ok) {
          setChoices({ proposals: [], projects: [] });
          return;
        }
        setChoices({ proposals: r.proposals, projects: r.projects });
        const pick = presetProposal ? `p:${presetProposal}` : r.suggested.proposalId ? `p:${r.suggested.proposalId}` : r.suggested.projectId ? `j:${r.suggested.projectId}` : "";
        setTie(pick);
        setSuggested(pick || null);
      })
      .catch(() => live && setChoices({ proposals: [], projects: [] }))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [clientId, presetProposal]);

  const submit = async (then: "send" | "activate") => {
    const link = tie === "auto" ? undefined : { proposalId: tie.startsWith("p:") ? tie.slice(2) : null, projectId: tie.startsWith("j:") ? tie.slice(2) : null };
    let planId: string | null = null;
    const ok = await act(
      `enroll:${then}`,
      async () => {
        const r = await enrollClient({ clientId, templateId, send: then === "send", activate: then === "activate", link });
        if (r.ok) planId = r.planId;
        return r.ok ? { ok: true, note: then === "send" ? "Enrolled and sent to sign." : "Enrolled — the visits are on the calendar and the first bill is out." } : r;
      },
    );
    if (ok && planId) goTab("clients", planId);
  };

  const client = data.clients.find((c) => c.id === clientId);
  return (
    <form ref={ref} className={cx("frm")} onSubmit={(e) => e.preventDefault()} data-enroll-form>
      <label className={cx("fld", "wide")}>
        <span className={cx("lbl")}>Client</span>
        <select
          className={cx("sel")}
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setChoices(null);
            setTie("auto");
            setSuggested(null);
            setLoading(!!e.target.value);
          }}
          required
          data-enroll-client
        >
          <option value="">Pick a client…</option>
          {data.clients.map((c) => (
            <option key={c.id} value={c.id} disabled={c.onPlan}>
              {c.name}
              {c.address ? ` — ${c.address}` : ""}
              {c.onPlan ? " · already on a plan" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className={cx("fld", "wide")}>
        <span className={cx("lbl")}>Plan</span>
        <select className={cx("sel")} value={templateId} onChange={(e) => setTemplateId(e.target.value)} required data-enroll-plan>
          {data.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} — {t.terms}
            </option>
          ))}
        </select>
      </label>
      <label className={cx("fld", "wide")}>
        <span className={cx("lbl")}>It belongs to</span>
        <select className={cx("sel")} value={tie} onChange={(e) => setTie(e.target.value)} disabled={!clientId || loading} data-enroll-tie>
          {!clientId || !choices ? <option value="auto">{clientId ? "Looking at their proposals…" : "Pick the client first"}</option> : null}
          {choices && <option value="">Nothing — a plan on its own</option>}
          {choices && choices.proposals.length > 0 && (
            <optgroup label="Their proposals">
              {choices.proposals.map((p) => (
                <option key={p.id} value={`p:${p.id}`}>
                  {p.label}
                  {p.hvac ? " · HVAC" : ""}
                </option>
              ))}
            </optgroup>
          )}
          {choices && choices.projects.length > 0 && (
            <optgroup label="Their projects">
              {choices.projects.map((p) => (
                <option key={p.id} value={`j:${p.id}`}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <span className={cx("hint")}>
          {choices && suggested && tie === suggested ? "Picked for you: the system you sold them. Change it if the plan is for something else." : client ? "Shown on the plan's line in Clients — the proposal or project it was sold with." : "The proposal or project this plan was sold with."}
        </span>
      </label>
      <div className={cx("acts", "wide")}>
        <button type="button" className={cx("btn", "btn-primary", "btn--sm")} disabled={!clientId || !templateId || !!busy} onClick={() => submit("send")} data-enroll-send>
          {busy === "enroll:send" ? "Sending…" : "Enroll and send to sign"}
        </button>
        <button type="button" className={cx("btn", "btn-ghost", "btn--sm")} disabled={!clientId || !templateId || !!busy} onClick={() => submit("activate")} data-enroll-start>
          {busy === "enroll:activate" ? "Starting…" : "Enroll and start today"}
        </button>
      </div>
      <p className={cx("hint", "wide")}>&ldquo;Send to sign&rdquo; emails the plan with an accept link; it starts when they type their name. &ldquo;Start today&rdquo; is for a plan they signed with you on paper or by phone.</p>
    </form>
  );
}

function TemplateCard({ t }: { t: ServiceDeskData["templates"][number] }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className={cx("tpl-card")} data-plan-template>
      <div className={cx("card-t")}>{t.name}</div>
      <div className={cx("tpl-terms")}>
        {t.terms} · {t.members} member{t.members === 1 ? "" : "s"}
      </div>
      {t.description && <p className={cx("hint")}>{t.description}</p>}
      {t.benefits.length > 0 && (
        <ul className={cx("benefits")}>
          {t.benefits.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: 10 }}>
        <button type="button" className={cx("linkish")} onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
          {editing ? "Close" : "Edit this plan"}
        </button>
      </div>
      {editing && <TemplateForm t={t} onDone={() => setEditing(false)} />}
    </div>
  );
}

function TemplateForm({ t, onDone }: { t?: ServiceDeskData["templates"][number]; onDone?: () => void }) {
  const { act, busy } = useDesk();
  const key = `tpl:${t?.id ?? "new"}`;
  return (
    <form
      className={cx("frm")}
      style={{ marginTop: 10 }}
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        if (await act(key, () => saveServicePlanTemplate(fd), t ? "Plan saved." : "Plan added.")) {
          if (!t) form.reset();
          onDone?.();
        }
      }}
    >
      {t && <input type="hidden" name="id" value={t.id} />}
      <label className={cx("fld", "wide")}>
        <span className={cx("lbl")}>Name</span>
        <input name="name" className={cx("in")} defaultValue={t?.name ?? ""} required minLength={2} />
      </label>
      <label className={cx("fld")}>
        <span className={cx("lbl")}>Price ($)</span>
        <input name="priceDollars" className={cx("in")} type="number" step="0.01" min="0" defaultValue={t ? (t.priceCents / 100).toString() : "21"} required />
      </label>
      <label className={cx("fld")}>
        <span className={cx("lbl")}>Billed</span>
        <select name="billing" className={cx("sel")} defaultValue={t?.billing ?? "MONTHLY"}>
          <option value="MONTHLY">Monthly</option>
          <option value="YEARLY">Yearly</option>
        </select>
      </label>
      <label className={cx("fld")}>
        <span className={cx("lbl")}>Visits a year</span>
        <input name="visitsPerYear" className={cx("in")} type="number" min="0" max="12" defaultValue={t?.visitsPerYear ?? 2} required />
      </label>
      <label className={cx("fld")}>
        <span className={cx("lbl")}>Term (months)</span>
        <input name="termMonths" className={cx("in")} type="number" min="1" max="60" defaultValue={t?.termMonths ?? 12} required />
      </label>
      <label className={cx("fld")}>
        <span className={cx("lbl")}>Discount on repairs (%)</span>
        <input name="discountPct" className={cx("in")} type="number" min="0" max="100" defaultValue={t?.discountPct ?? 15} required />
      </label>
      <div className={cx("fld")}>
        <span className={cx("lbl")}>Perks</span>
        <label className={cx("chk")}>
          <input type="checkbox" name="priorityScheduling" defaultChecked={t ? t.priorityScheduling : true} /> Priority scheduling
        </label>
        <label className={cx("chk")}>
          <input type="checkbox" name="waivedDiagnostic" defaultChecked={t ? t.waivedDiagnostic : false} /> Diagnostic fee waived
        </label>
      </div>
      <label className={cx("fld", "wide")}>
        <span className={cx("lbl")}>Description (the client reads this)</span>
        <textarea name="description" className={cx("ta")} defaultValue={t?.description ?? ""} />
      </label>
      <label className={cx("fld", "wide")}>
        <span className={cx("lbl")}>What it includes, one per line</span>
        <textarea name="benefits" className={cx("ta")} defaultValue={t?.benefits.join("\n") ?? ""} />
      </label>
      <div className={cx("acts", "wide")}>
        <button className={cx("btn", "btn-primary", "btn--sm")} type="submit" disabled={!!busy}>
          {busy === key ? "Saving…" : t ? "Save" : "Add this plan"}
        </button>
        {t && (
          <button type="button" className={cx("btn", "btn-ghost", "btn--sm")} disabled={!!busy} onClick={() => act(`retire:${t.id}`, () => archiveServicePlanTemplate(t.id), "Retired — members keep their plans.")}>
            Retire
          </button>
        )}
      </div>
    </form>
  );
}
