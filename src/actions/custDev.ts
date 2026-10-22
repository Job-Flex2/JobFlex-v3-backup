"use server";
// CUSTOMER DEVELOPMENT — the admin's moves (owner, 2026-10-22): log, edit and delete a discovery interview; give a
// hypothesis a verdict, a note or new words, add one or put it away; have the AI read what customers wrote and name
// the pains, the requests and the next experiments. Platform admin only. Everything is kept in SyncState rows
// (lib/custDev/store) — no schema change; the rules are lib/custDev/model.
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { logServerError } from "@/lib/server-events";
import { AREAS, DEFAULT_HYPOTHESES, checkInterview, pct, type HypArea, type HypothesisEdit, type Interview, type Status } from "@/lib/custDev/model";
import { deleteInterview, readHypothesisEdits, saveInterview, writeHypothesisEdits, writeSynthesis, type Synthesis } from "@/lib/custDev/store";

const PAGE = "/admin/customer-development";
type Done<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const adminName = (a: { name?: string | null; email?: string | null }) => a.name?.trim() || a.email || "Admin";

export async function custDevSaveInterview(input: unknown, id?: string | null): Promise<Done<{ interview: Interview }>> {
  const admin = await requirePlatformAdmin();
  const checked = checkInterview(input);
  if (!checked.ok) return checked;
  if (id && !/^[\w-]{8,64}$/.test(id)) return { ok: false, error: "That interview is not there any more." };
  try {
    const interview = await saveInterview(checked.value, adminName(admin), id ?? null);
    revalidatePath(PAGE);
    return { ok: true, interview };
  } catch (err) {
    logServerError("custdev-interview", err, { kind: "action" });
    return { ok: false, error: "The interview could not be saved. Try again." };
  }
}

export async function custDevDeleteInterview(id: string): Promise<Done> {
  await requirePlatformAdmin();
  if (!/^[\w-]{8,64}$/.test(String(id))) return { ok: false, error: "That interview is not there any more." };
  await deleteInterview(id);
  revalidatePath(PAGE);
  return { ok: true };
}

const STATUSES: Status[] = ["auto", "testing", "validated", "invalidated"];
const isArea = (v: unknown): v is HypArea => AREAS.some((a) => a.key === v);

/** A verdict, a note, new words or a new bar for one hypothesis; `archived` puts it away (and back). */
export async function custDevSetHypothesis(input: { id: string; status?: Status; notes?: string; statement?: string; test?: string; area?: HypArea; target?: number | null; archived?: boolean }): Promise<Done> {
  const admin = await requirePlatformAdmin();
  const id = String(input?.id ?? "");
  const list = await readHypothesisEdits();
  const known = DEFAULT_HYPOTHESES.find((h) => h.id === id);
  const prev = list.find((e) => e.id === id);
  if (!known && !prev?.custom) return { ok: false, error: "That hypothesis is not there any more." };
  if (input.status !== undefined && !STATUSES.includes(input.status)) return { ok: false, error: "Pick a verdict." };
  if (input.area !== undefined && !isArea(input.area)) return { ok: false, error: "Pick an area." };
  if (input.target !== undefined && input.target !== null && !(Number.isFinite(input.target) && input.target >= 0 && input.target <= 100)) return { ok: false, error: "The bar is a number." };
  const statement = input.statement === undefined ? undefined : String(input.statement).trim().slice(0, 300);
  if (statement !== undefined && statement.length < 8) return { ok: false, error: "Write the hypothesis as one full sentence." };
  const next: HypothesisEdit = {
    id,
    status: input.status ?? prev?.status ?? "auto",
    notes: input.notes === undefined ? (prev?.notes ?? "") : String(input.notes).trim().slice(0, 2000),
    statement: statement ?? prev?.statement,
    test: input.test === undefined ? prev?.test : String(input.test).trim().slice(0, 300),
    area: input.area ?? prev?.area,
    target: input.target === undefined ? prev?.target : input.target,
    archived: input.archived ?? prev?.archived ?? false,
    custom: prev?.custom ?? false,
    history: [...(prev?.history ?? [])],
  };
  if (input.status !== undefined && input.status !== (prev?.status ?? "auto")) next.history = [...next.history, { at: Date.now(), status: input.status, by: adminName(admin) }].slice(-50);
  await writeHypothesisEdits([...list.filter((e) => e.id !== id), next]);
  revalidatePath(PAGE);
  return { ok: true };
}

export async function custDevAddHypothesis(input: { area: HypArea; statement: string; test: string }): Promise<Done<{ id: string }>> {
  const admin = await requirePlatformAdmin();
  const statement = String(input?.statement ?? "").trim().slice(0, 300);
  if (statement.length < 8) return { ok: false, error: "Write the hypothesis as one full sentence." };
  if (!isArea(input?.area)) return { ok: false, error: "Pick an area." };
  const list = await readHypothesisEdits();
  if (list.filter((e) => e.custom && !e.archived).length >= 60) return { ok: false, error: "That is a lot of open hypotheses — put some away first." };
  const id = `c-${randomUUID().slice(0, 8)}`;
  await writeHypothesisEdits([
    ...list,
    { id, status: "testing", notes: "", statement, test: String(input.test ?? "").trim().slice(0, 300) || "Interviews and what customers write", area: input.area, custom: true, archived: false, history: [{ at: Date.now(), status: "testing", by: adminName(admin) }] },
  ]);
  revalidatePath(PAGE);
  return { ok: true, id };
}

/* ── the AI's reading of what customers wrote ── */

const SYSTEM = `You are a customer development analyst (Steve Blank's method) for JobFlex, software that small US contracting businesses (roofing, HVAC, fencing, decks and more) use to estimate jobs and send proposals.
You read what customers wrote — support tickets and email replies, cancellation reasons and comments, trial-extension notes — and the product's own figures.
Reply with JSON only:
{"headline": "one sentence: the most important thing customers are telling us",
 "pains": [{"title": "short", "detail": "one or two sentences", "companies": number of different companies that raised it, "quote": "their exact words, short"}],
 "requests": [{"title": "short", "detail": "one sentence", "companies": number}],
 "objections": [{"title": "short", "detail": "one sentence"}],
 "earlyAdopter": "one or two sentences: which customers look like early adopters and why, from the figures",
 "nextExperiments": [{"title": "short", "detail": "the test to run next and what result would confirm or kill the idea"}]}
Use only what is in the material — never invent customers, numbers or quotes. Quotes are copied word for word. At most 5 items per list, ranked by how many companies raised them. Plain words, no jargon.`;

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = <T>(v: unknown, map: (x: Record<string, unknown>) => T | null, max = 5): T[] =>
  Array.isArray(v) ? v.map((x) => (x && typeof x === "object" ? map(x as Record<string, unknown>) : null)).filter((x): x is T => x !== null).slice(0, max) : [];
const count = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(10_000, Math.round(Number(v)))) : 0);

export async function custDevSynthesize(): Promise<Done<{ synthesis: Synthesis }>> {
  await requirePlatformAdmin();
  const { getOpenAI, isOpenAIEnabled, resolveOpenAIModel, samplingOptions, friendlyAIError } = await import("@/lib/sdk/openai");
  if (!isOpenAIEnabled()) return { ok: false, error: "The AI is not set up on this server (OPENAI_API_KEY)." };
  const { readCustDev } = await import("@/lib/custDev/read");
  const view = await readCustDev();
  const items = view.voiceRows.filter((v) => v.text.trim().length >= 8 || (v.reasons?.length ?? 0) > 0).slice(0, 250);
  const companyIds = new Map<string, number>();
  const companyNo = (key: string) => {
    if (!companyIds.has(key)) companyIds.set(key, companyIds.size + 1);
    return companyIds.get(key) as number;
  };
  if (!items.length) return { ok: false, error: "Nothing written by customers yet — support tickets, cancellation reasons or trial notes." };
  const lines = items.map((v, i) => {
    const reasons = v.reasons?.length ? ` [reasons: ${v.reasons.join(", ")}]` : "";
    // Companies as a number, never a name: the reading needs who is the same company, not who it is.
    return `${i + 1}. (${v.source}, ${v.trade}${v.region ? `, ${v.region}` : ""}, company #${companyNo(v.orgId ?? v.company)}, ${new Date(v.at).toISOString().slice(0, 10)})${reasons} ${v.text.replace(/\s+/g, " ").slice(0, 500)}`;
  });
  const seg = view.segments.trade.slice(0, 10).map((r) => `${r.key}: ${r.signups} sign-ups, first-week use ${pct(r.activation)}, trial → paid ${pct(r.trialToPaid)}, paying now ${r.payingNow}`);
  const figures = [
    `Sign-ups ${view.totals.signups}; paying now ${view.totals.payingNow}; on a trial ${view.totals.trialing}; left ${view.totals.left}.`,
    `First-week use ${pct(view.measures.activation)}; trial → paid ${pct(view.measures.trialToPaid)}; still paying after a month ${pct(view.measures.retention30)}.`,
    `Themes counted by rule: ${view.voice.themes.filter((t) => t.items).map((t) => `${t.label} ${t.items} (${t.companies} companies)`).join("; ")}.`,
    `Tools customers named: ${view.voice.tools.map((t) => `${t.name} (${t.companies})`).join(", ") || "none"}.`,
  ];
  try {
    const model = await resolveOpenAIModel();
    const res = await getOpenAI().chat.completions.create({
      model,
      ...(await samplingOptions(0.2)),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `FIGURES\n${figures.join("\n")}\nBY TRADE\n${seg.join("\n")}\n\nWHAT CUSTOMERS WROTE (${lines.length})\n${lines.join("\n")}` },
      ],
    });
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(res.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
    } catch {
      raw = {};
    }
    const synthesis: Synthesis = {
      at: Date.now(),
      read: items.length,
      headline: clip(raw.headline, 300),
      pains: list(raw.pains, (x) => (clip(x.title, 80) ? { title: clip(x.title, 80), detail: clip(x.detail, 400), companies: count(x.companies), quote: clip(x.quote, 240) } : null)),
      requests: list(raw.requests, (x) => (clip(x.title, 80) ? { title: clip(x.title, 80), detail: clip(x.detail, 300), companies: count(x.companies) } : null)),
      objections: list(raw.objections, (x) => (clip(x.title, 80) ? { title: clip(x.title, 80), detail: clip(x.detail, 300) } : null)),
      earlyAdopter: clip(raw.earlyAdopter, 500),
      nextExperiments: list(raw.nextExperiments, (x) => (clip(x.title, 80) ? { title: clip(x.title, 80), detail: clip(x.detail, 400) } : null)),
    };
    if (!synthesis.headline && !synthesis.pains.length) return { ok: false, error: "The AI's answer was empty — try again." };
    await writeSynthesis(synthesis);
    revalidatePath(PAGE);
    return { ok: true, synthesis };
  } catch (err) {
    return { ok: false, error: friendlyAIError(err, "custdev.synthesize") };
  }
}
