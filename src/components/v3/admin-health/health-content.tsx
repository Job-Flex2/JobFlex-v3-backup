"use client";

// ADMIN HEALTH — /admin/health, blueprint.
//
// A board of signals that are actually knowable. Three cards, and each one
// declares in its own column header what kind of evidence its rows carry:
//
//   1. VERIFIED LIVE      — the service answered a real request: a `SELECT 1`,
//                           a Stripe balance read, a HogQL POST. The first two
//                           are issued per render; PostHog's is cached 5 min in
//                           lib/posthog, which is why the column header claims
//                           "answered a live check" and never a timestamp.
//   2. CONFIGURED         — the env key is present. Nothing was contacted.
//   3. WEBHOOKS & SYNC    — rows the platform itself wrote to the database.
//
// The green success tone is reserved for the first card and for a live probe
// that answered; "key present" wears the neutral ink chip, because a key is
// not a heartbeat. Nothing on this page is synthesised: there is no latency,
// no uptime and no sweep time, because the platform records none of them.

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import s from "@/components/v3/admin-overview/admin-shared.module.css";
import { Ic, ago, shortDay } from "@/components/v3/admin-overview/admin-ui";
import { useAdminMotion } from "@/components/v3/admin-overview/admin-motion";
import { assignPlatformLine, pointVoiceWebhook } from "@/actions/adminAiDesk";
import type { DeskReadiness } from "@/lib/aiDesk/readiness";
import h from "./health.module.css";

const INTEGRATIONS = "/admin/integrations" as Route;

export type ProbeState = "ok" | "error" | "off";

export interface WebhookSnapshot {
  lastAt: string | null;
  received24h: number;
  processed24h: number;
  failed24h: number;
  lastFailure: { type: string; at: string; error: string | null } | null;
}

export interface HealthData {
  generatedAt: string;
  /** Probes made for this render. */
  database: { state: ProbeState; message: string | null };
  stripeApi: { state: ProbeState; message: string | null };
  analytics: { state: ProbeState; message: string | null };
  /** Env presence only. */
  emailTransport: "resend" | "smtp" | "none";
  smsConfigured: boolean;
  blobConfigured: boolean;
  stripeConfigured: boolean;
  stripeWebhookSecret: boolean;
  stripeKeyMode: "none" | "test" | "live";
  stripeWritesAllowed: boolean;
  cronSecret: boolean;
  adminDoor: boolean;
  /** Written by the platform. Null when the database did not answer. */
  webhooks: WebhookSnapshot | null;
  reconcileAt: string | null;
  /** The AI desk's go-live lights (lib/aiDesk/readiness, 2026-10-13). Null when the probe itself failed. */
  desk: DeskReadiness | null;
}

type Tone = "ok" | "warn" | "danger" | "ink" | "mute";

function chipClass(tone: Tone): string {
  switch (tone) {
    case "ok":
      return "chip ok";
    case "warn":
      return "chip wait";
    case "danger":
      return `chip ${s.chipDanger}`;
    case "ink":
      return `chip ${s.chipInk}`;
    default:
      return `chip ${s.chipMuted}`;
  }
}

function SignalRow({
  name,
  tone,
  label,
  reason,
}: {
  name: string;
  tone: Tone;
  label: string;
  reason?: string | null;
}) {
  return (
    <div className={`${s.row} ${h.sigRow}`}>
      <div className={s.rowMain}>
        <div className={`${s.rowTitle} ${h.sigName}`}>{name}</div>
        {reason ? <div className={h.rowErr}>{reason}</div> : null}
      </div>
      <span className={chipClass(tone)}>{label}</span>
    </div>
  );
}

function ProbeRow({
  name,
  probe,
}: {
  name: string;
  probe: { state: ProbeState; message: string | null };
}) {
  const tone: Tone = probe.state === "ok" ? "ok" : probe.state === "error" ? "danger" : "mute";
  const label = probe.state === "ok" ? "OK" : probe.state === "error" ? "Failed" : "Not configured";
  return (
    <SignalRow
      name={name}
      tone={tone}
      label={label}
      reason={probe.state === "error" ? probe.message : null}
    />
  );
}

function emailRow(transport: HealthData["emailTransport"]): { tone: Tone; label: string } {
  if (transport === "resend") return { tone: "ink", label: "Resend" };
  if (transport === "smtp") return { tone: "ink", label: "SMTP" };
  return { tone: "danger", label: "None" };
}

function stripeKeyRow(data: HealthData): { tone: Tone; label: string } {
  if (data.stripeKeyMode === "none") return { tone: "mute", label: "Not set" };
  return data.stripeKeyMode === "live"
    ? { tone: "ink", label: "Live" }
    : { tone: "ink", label: "Test" };
}

function webhookSecretRow(data: HealthData): { tone: Tone; label: string } {
  if (!data.stripeConfigured) return { tone: "mute", label: "Not configured" };
  return data.stripeWebhookSecret
    ? { tone: "ink", label: "Configured" }
    : { tone: "warn", label: "Missing" };
}

/** One company number that points elsewhere: the button that points it here. */
function PointWebhookButton({ numberSid }: { numberSid: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [err, setErr] = useState("");
  const go = async () => {
    setState("busy");
    setErr("");
    try {
      const r = await pointVoiceWebhook(numberSid);
      if (r.ok) setState("done");
      else {
        setState("error");
        setErr(r.error);
      }
    } catch {
      setState("error");
      setErr("Twilio did not take the change.");
    }
  };
  if (state === "done") return <span className="chip ok">Pointed here</span>;
  return (
    <>
      <button type="button" className="btn btn-ghost btn--sm" disabled={state === "busy"} onClick={() => void go()} data-point-webhook>
        {state === "busy" ? "Pointing…" : "Point it here"}
      </button>
      {err ? <span className={h.rowErr}>{err}</span> : null}
    </>
  );
}

/** The platform's own line: which company its calls reach — the picker and its save. */
function AssignLine({ line, companies }: { line: DeskReadiness["platform"][number]; companies: DeskReadiness["companies"] }) {
  const [orgId, setOrgId] = useState(line.answeredForId ?? "");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const save = async (id: string) => {
    setState("busy");
    setMsg("");
    try {
      const r = await assignPlatformLine(line.e164, id);
      if (r.ok) {
        setState("done");
        setMsg(r.company ? `Answers for ${r.company}.` : "Assignment removed — back to the oldest company.");
      } else {
        setState("error");
        setMsg(r.error);
      }
    } catch {
      setState("error");
      setMsg("Could not save.");
    }
  };
  return (
    <div className={h.rowErr} data-assign-line>
      <label>
        answers for{" "}
        <select value={orgId} disabled={state === "busy"} onChange={(e) => setOrgId(e.target.value)} aria-label="The company this line answers for">
          <option value="">— the oldest company (no assignment) —</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>{" "}
      <button type="button" className="btn btn-ghost btn--sm" disabled={state === "busy" || orgId === (line.answeredForId ?? "") && line.assigned} onClick={() => void save(orgId)} data-assign-save>
        {state === "busy" ? "Saving…" : line.assigned && orgId === line.answeredForId ? "Assigned" : "Assign"}
      </button>
      {msg ? <span className={state === "error" ? h.rowErr : "chip ok"}>{msg}</span> : null}
    </div>
  );
}

const LIGHT_TONE: Record<DeskReadiness["items"][number]["state"], Tone> = { ok: "ok", warn: "warn", off: "mute" };
const LIGHT_LABEL: Record<DeskReadiness["items"][number]["state"], string> = { ok: "OK", warn: "Attention", off: "Not set" };

/** The AI desk's go-live card: the lights, the numbers as Twilio has them, the plans' minutes, and what is left to do. */
function DeskCard({ desk }: { desk: DeskReadiness | null }) {
  return (
    <div className="card" data-desk-readiness>
      <div className={`card-head ${h.head}`}>
        <div className="card-titles">
          <div className="card-title">AI desk · go live</div>
        </div>
        <div className={h.colHead}>Checked for this render</div>
      </div>
      <hr className="card-rule" />
      {!desk ? (
        <div className="empty">The readiness probe failed — the server log has it.</div>
      ) : (
        <>
          {desk.items.map((it) => (
            <SignalRow key={it.key} name={it.label} tone={LIGHT_TONE[it.state]} label={LIGHT_LABEL[it.state]} reason={it.detail} />
          ))}
          {desk.platform.length ? (
            <div className={`${s.connect} ${h.below}`} data-desk-platform>
              {desk.platform.map((p) => (
                <div key={p.number} className={`${s.row} ${h.sigRow}`}>
                  <div className={s.rowMain}>
                    <div className={`${s.rowTitle} ${h.sigName}`}>{p.number} · the platform&apos;s own line</div>
                    <div className={h.rowErr}>
                      {p.assigned ? `assigned to ${p.answeredFor}` : `not assigned — its calls reach ${p.answeredFor ?? "the oldest company"}, the oldest company`}
                      {p.webhook === "wrong" ? ` · voice webhook: ${p.webhookUrl || "none"}` : ""}
                    </div>
                    <AssignLine line={p} companies={desk.companies} />
                  </div>
                  {p.webhook === "ok" ? <span className="chip ok">Webhook OK</span> : p.webhook === "wrong" && p.numberSid ? <PointWebhookButton numberSid={p.numberSid} /> : <span className={chipClass("mute")}>Not checked</span>}
                </div>
              ))}
            </div>
          ) : null}
          {desk.numbers.length ? (
            <div className={`${s.connect} ${h.below}`} data-desk-numbers>
              {desk.numbers.map((n) => (
                <div key={n.number} className={`${s.row} ${h.sigRow}`}>
                  <div className={s.rowMain}>
                    <div className={`${s.rowTitle} ${h.sigName}`}>
                      {n.number} · {n.company}
                    </div>
                    <div className={h.rowErr}>
                      {n.mode === "ANSWER" ? "the desk answers" : "rings the company phone first"} · {n.minutes}
                      {n.webhook === "wrong" ? ` · voice webhook: ${n.webhookUrl || "none"}` : ""}
                    </div>
                  </div>
                  {n.webhook === "ok" ? <span className="chip ok">Webhook OK</span> : n.webhook === "wrong" && n.numberSid ? <PointWebhookButton numberSid={n.numberSid} /> : <span className={chipClass("mute")}>Not checked</span>}
                </div>
              ))}
            </div>
          ) : null}
          <div className={`${s.connect} ${h.below}`} data-desk-steps>
            <b>Still to do</b>
            <ol>
              {desk.steps.map((st) => (
                <li key={st}>{st}</li>
              ))}
            </ol>
          </div>
        </>
      )}
    </div>
  );
}

export function AdminHealthContent({ data }: { data: HealthData }) {
  useAdminMotion();

  const email = emailRow(data.emailTransport);
  const stripeKey = stripeKeyRow(data);
  const webhookSecret = webhookSecretRow(data);
  const wh = data.webhooks;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">Platform · {shortDay(data.generatedAt)}</div>
          <h1 className="page-title">Health</h1>
        </div>
        <div className="page-actions">
          <Link className="btn btn-ghost" href={INTEGRATIONS}>
            <Ic id="i-link" />
            Integrations
          </Link>
        </div>
      </div>

      <div className="grid-11">
        <div className="card">
          <div className={`card-head ${h.head}`}>
            <div className="card-titles">
              <div className="card-title">Verified live</div>
            </div>
            <div className={h.colHead}>Answered a live check</div>
          </div>
          <hr className="card-rule" />
          <ProbeRow name="Database" probe={data.database} />
          <ProbeRow name="Stripe API" probe={data.stripeApi} />
          <ProbeRow name="PostHog" probe={data.analytics} />
        </div>

        <div className="card">
          <div className={`card-head ${h.head}`}>
            <div className="card-titles">
              <div className="card-title">Configured</div>
            </div>
            <div className={h.colHead}>Key present · not contacted</div>
          </div>
          <hr className="card-rule" />
          <SignalRow name="Email transport" tone={email.tone} label={email.label} />
          <SignalRow
            name="SMS · Twilio"
            tone={data.smsConfigured ? "ink" : "mute"}
            label={data.smsConfigured ? "Configured" : "Not configured"}
          />
          <SignalRow
            name="Blob storage"
            tone={data.blobConfigured ? "ink" : "mute"}
            label={data.blobConfigured ? "Configured" : "Not configured"}
          />
          <SignalRow name="Stripe key" tone={stripeKey.tone} label={stripeKey.label} />
          {data.stripeKeyMode === "live" ? (
            <SignalRow
              name="Stripe live writes"
              tone={data.stripeWritesAllowed ? "warn" : "ink"}
              label={data.stripeWritesAllowed ? "Armed" : "Locked"}
            />
          ) : null}
          <SignalRow
            name="Webhook signature"
            tone={webhookSecret.tone}
            label={webhookSecret.label}
          />
          <SignalRow
            name="Cron secret"
            tone={data.cronSecret ? "ink" : "warn"}
            label={data.cronSecret ? "Set" : "Not set"}
          />
          <SignalRow
            name="Admin login"
            tone={data.adminDoor ? "ink" : "warn"}
            label={data.adminDoor ? "Set" : "Disabled"}
          />
        </div>
      </div>

      <DeskCard desk={data.desk} />

      <div className="card">
        <div className={`card-head ${h.head}`}>
          <div className="card-titles">
            <div className="card-title">Webhooks &amp; sync</div>
          </div>
          <div className={h.colHead}>Recorded in the database</div>
        </div>
        {wh === null ? (
          <div className="empty">The database did not answer.</div>
        ) : (
          <>
            <div className={s.mix}>
              <div className={s.mixCell}>
                <div className={s.mixLbl}>Last event</div>
                <div className={s.mixVal}>{wh.lastAt ? ago(wh.lastAt, data.generatedAt) : "—"}</div>
              </div>
              <div className={s.mixCell}>
                <div className={s.mixLbl}>Received · 24h</div>
                <div className={s.mixVal}>{wh.received24h}</div>
              </div>
              <div className={s.mixCell}>
                <div className={s.mixLbl}>Processed · 24h</div>
                <div className={s.mixVal}>{wh.processed24h}</div>
              </div>
              <div className={s.mixCell}>
                <div className={s.mixLbl}>Failed · 24h</div>
                <div className={`${s.mixVal} ${wh.failed24h > 0 ? h.bad : ""}`}>{wh.failed24h}</div>
              </div>
              <div className={s.mixCell}>
                <div className={s.mixLbl}>Stripe reconcile</div>
                <div className={s.mixVal}>
                  {data.reconcileAt ? ago(data.reconcileAt, data.generatedAt) : "—"}
                </div>
              </div>
            </div>
            {wh.lastFailure ? (
              <div className={`${s.connect} ${h.below}`}>
                Last failure · <b>{wh.lastFailure.type}</b> · {shortDay(wh.lastFailure.at)}
                {wh.lastFailure.error ? <div className={s.err}>{wh.lastFailure.error}</div> : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
