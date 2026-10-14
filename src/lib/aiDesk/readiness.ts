// GO-LIVE READINESS of the AI desk — server only; /admin/health shows it (step 6, 2026-10-13).
//
// Each light is something knowable from here: a key present, the voice server answering
// its /health, a company number's voice webhook as Twilio has it, each plan's included
// minutes. The steps at the end are what is still to do, in order — the owner's side of
// going live, written against what is actually missing.
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { isOpenAIEnabled } from "@/lib/sdk/openai";
import { isStripeEnabled } from "@/lib/sdk/stripe";
import { isTwilioEnabled, twilioClient, twilioSettings } from "@/lib/sdk/twilio";
import { parsePlanLimits } from "@/lib/planLimits";
import { parseRegistration } from "@/lib/sms/registrationShared";
import { voiceServerConfigured } from "./voiceToken";
import { DEFAULT_VOICE_MODEL } from "./testCall";
import { DESK_MINUTES_CUSTOM_WITH_PHONE, DESK_MINUTES_DEFAULT, minutesLeftWords, prettyPhone } from "./shared";
import { deskBalanceFor } from "./minutes";
import { organizationForCall, readDeskSettings } from "./numbers";

export type Light = "ok" | "warn" | "off";
export type ReadinessItem = { key: string; label: string; state: Light; detail: string };
export type DeskNumberRow = {
  organizationId: string;
  company: string;
  number: string;
  numberSid: string | null;
  /** Calls reach the voice webhook since the number was wired (lib/sms/registration). */
  voiceOn: boolean;
  /** What Twilio has as the number's voice URL, against ours. */
  webhook: "ok" | "wrong" | "unknown";
  webhookUrl: string | null;
  mode: string;
  minutes: string;
};
export type DeskPlanRow = { slug: string; name: string; minutes: number; source: "plan" | "default" };
/** JobFlex's own lines — the numbers on the Twilio account that no company registered (the texting number, the approved toll-free): a call to one is answered for the first company — the way to a first test before any company buys a number. */
export type PlatformNumber = {
  number: string;
  e164: string;
  numberSid: string | null;
  webhook: "ok" | "wrong" | "unknown";
  webhookUrl: string | null;
  /** The company its calls reach: the one it is assigned to, else the oldest company (the old fallback). */
  answeredFor: string | null;
  answeredForId: string | null;
  assigned: boolean;
};
export type DeskReadiness = { items: ReadinessItem[]; numbers: DeskNumberRow[]; platform: PlatformNumber[]; companies: Array<{ id: string; name: string; mine: boolean }>; plans: DeskPlanRow[]; voiceUrl: string; model: string; steps: string[] };

/** Where Twilio must send a call: TWILIO_APP_URL when set (lib/aiDesk/calls twilioBase), else this deployment. */
export async function voiceWebhookBase(): Promise<string> {
  return (process.env.TWILIO_APP_URL ?? (await appBaseUrl())).replace(/\/+$/, "");
}

const voiceModel = () => process.env.VOICE_MODEL?.trim() || DEFAULT_VOICE_MODEL;
const healthUrlOf = (ws: string) => ws.trim().replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/+$/, "") + "/health";

async function probeVoiceServer(): Promise<ReadinessItem> {
  const ws = process.env.VOICE_SERVER_URL?.trim() ?? "";
  if (!ws || !voiceServerConfigured()) {
    return { key: "voice", label: "Voice server", state: "off", detail: "VOICE_SERVER_URL and VOICE_SERVER_SECRET are not set on Vercel — callers get the recording until they are (voice/README.md)." };
  }
  const url = healthUrlOf(ws);
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(url, { signal: ctl.signal, cache: "no-store" }).finally(() => clearTimeout(t));
    const j = (await r.json().catch(() => null)) as { ok?: boolean; model?: string; api?: string } | null;
    if (!r.ok || !j?.ok) return { key: "voice", label: "Voice server", state: "warn", detail: `${url} answered ${r.status} — is the Fly app up (fly status)?` };
    const same = !j.model || j.model === voiceModel();
    return { key: "voice", label: "Voice server", state: same ? "ok" : "warn", detail: `${ws} answers · model ${j.model ?? "?"} · api ${j.api ?? "?"}${same ? "" : ` — the app's VOICE_MODEL is ${voiceModel()}: set the same on both`}` };
  } catch (err) {
    return { key: "voice", label: "Voice server", state: "warn", detail: `${url} did not answer (${err instanceof Error ? err.message : "error"}) — the DNS for voice.jobflex.app, or the Fly app is down.` };
  }
}

/** @param adminUserId the admin looking — the companies they belong to are marked "(your account)" in the picker. */
export async function deskReadiness(adminUserId: string | null = null): Promise<DeskReadiness> {
  const base = await voiceWebhookBase();
  const voiceUrl = `${base}/api/twilio/voice`;
  const openai = isOpenAIEnabled();
  const stripe = isStripeEnabled();
  const [voice, twilioOn] = await Promise.all([probeVoiceServer(), isTwilioEnabled()]);
  const items: ReadinessItem[] = [
    { key: "openai", label: "OpenAI key", state: openai ? "ok" : "off", detail: openai ? `OPENAI_API_KEY set · VOICE_MODEL ${voiceModel()}${process.env.VOICE_MODEL?.trim() ? "" : " (the default)"}` : "OPENAI_API_KEY is missing — the desk, the voices and the browser test need it." },
    voice,
    { key: "twilio", label: "Twilio", state: twilioOn ? "ok" : "off", detail: twilioOn ? `A call to a company's number arrives at ${voiceUrl}` : "Twilio is not configured — no numbers, no calls." },
    { key: "stripe", label: "Stripe", state: stripe ? "ok" : "warn", detail: stripe ? "Minute packs can be bought." : "Stripe is not configured — packs can't be bought; included minutes still work." },
  ];

  // The companies' numbers, as Twilio has them.
  const regs = await db.syncState.findMany({ where: { key: { startsWith: "smsreg:" } }, select: { key: true, cursor: true }, take: 50 });
  const orgIds = regs.map((r) => r.key.slice("smsreg:".length));
  const orgs = orgIds.length ? await db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(orgs.map((o) => [o.id, o.name || o.id]));
  const client = twilioOn ? await twilioClient().catch(() => null) : null;
  const numbers: DeskNumberRow[] = [];
  for (const r of regs) {
    const reg = parseRegistration(r.cursor);
    if (!reg.number) continue;
    const organizationId = r.key.slice("smsreg:".length);
    const [settings, balance] = await Promise.all([readDeskSettings(organizationId), deskBalanceFor(organizationId).catch(() => null)]);
    let webhook: DeskNumberRow["webhook"] = "unknown";
    let webhookUrl: string | null = null;
    if (client && reg.numberSid) {
      try {
        const n = await client.incomingPhoneNumbers(reg.numberSid).fetch();
        webhookUrl = n.voiceUrl || null;
        webhook = webhookUrl === voiceUrl ? "ok" : "wrong";
      } catch {
        webhook = "unknown";
      }
    }
    numbers.push({ organizationId, company: nameOf.get(organizationId) ?? organizationId, number: prettyPhone(reg.number), numberSid: reg.numberSid ?? null, voiceOn: Boolean(reg.voiceOnAt), webhook, webhookUrl, mode: settings.mode, minutes: balance ? minutesLeftWords(balance) : "?" });
  }
  // The platform's own lines: the account's numbers no company registered (the texting number
  // when there is one, the approved toll-free in the messaging service) — a call to any of them
  // is answered for the first company (lib/aiDesk/calls companyForCall).
  let platform: PlatformNumber[] = [];
  const [companies, memberships] = await Promise.all([
    db.organization.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }).catch(() => []),
    adminUserId ? db.membership.findMany({ where: { userId: adminUserId }, select: { organizationId: true } }).catch(() => []) : Promise.resolve([]),
  ]);
  const mine = new Set(memberships.map((m) => m.organizationId));
  const companyName = new Map(companies.map((c) => [c.id, c.name || c.id]));
  if (client) {
    const settings = await twilioSettings().catch(() => null);
    const companySids = new Set(numbers.map((n) => n.numberSid).filter(Boolean));
    const companyE164 = new Set(regs.map((r) => parseRegistration(r.cursor).number).filter(Boolean));
    const [first, own] = await Promise.all([
      db.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } }).catch(() => null),
      client.incomingPhoneNumbers.list({ limit: 20 }).catch(() => [] as Array<{ sid: string; phoneNumber: string; voiceUrl: string | null }>),
    ]);
    const mine = own.filter((n) => !companySids.has(n.sid) && !companyE164.has(n.phoneNumber));
    // The texting number first, then the rest as Twilio lists them.
    mine.sort((a, b) => (a.phoneNumber === settings?.fromNumber ? -1 : b.phoneNumber === settings?.fromNumber ? 1 : 0));
    platform = await Promise.all(
      mine.slice(0, 5).map(async (n) => {
        // Assigned to a company (the same index a bought number uses), else the oldest company.
        const assignedTo = await organizationForCall(n.phoneNumber).catch(() => null);
        return {
          number: prettyPhone(n.phoneNumber),
          e164: n.phoneNumber,
          numberSid: n.sid,
          webhook: n.voiceUrl === voiceUrl ? ("ok" as const) : ("wrong" as const),
          webhookUrl: n.voiceUrl || null,
          answeredFor: assignedTo ? (companyName.get(assignedTo) ?? assignedTo) : (first?.name ?? null),
          answeredForId: assignedTo ?? first?.id ?? null,
          assigned: Boolean(assignedTo),
        };
      }),
    );
  }
  const firstLine = platform[0] ?? null;

  const pointed = numbers.filter((n) => n.webhook === "ok").length;
  const assignedLines = platform.filter((p) => p.assigned);
  items.push({
    key: "numbers",
    label: "Company numbers",
    state: numbers.length ? (numbers.some((n) => n.webhook === "wrong") ? "warn" : "ok") : assignedLines.length ? "ok" : "warn",
    detail: numbers.length
      ? `${numbers.length} number${numbers.length === 1 ? "" : "s"} · ${pointed} pointed at the voice webhook${client ? "" : " (not checked: Twilio off)"}${assignedLines.length ? ` · ${assignedLines.length} of JobFlex's own assigned` : ""}`
      : assignedLines.length
        ? `No company bought a number yet; JobFlex's own ${assignedLines.map((p) => `${p.number} answers for ${p.answeredFor}`).join(", ")} — it shows on that company's AI desk and Phone pages.`
        : `No company has a number yet — Settings → Texting buys one (it takes calls the same day).${firstLine ? ` Until then, a call to the platform's own ${firstLine.number} is answered for ${firstLine.answeredFor ?? "the first company"} (the oldest company — assign it below).` : ""}`,
  });

  // Each plan's included minutes: set in the plan editor, or the tier's default.
  const planRows = await db.pricingPlan.findMany({ select: { slug: true, name: true, limitsJson: true }, orderBy: { order: "asc" } }).catch(() => []);
  const plans: DeskPlanRow[] = planRows.map((p) => {
    const set = parsePlanLimits(p.limitsJson).deskMinutes;
    const up = p.slug.toUpperCase();
    const def = up === "CUSTOM" ? DESK_MINUTES_CUSTOM_WITH_PHONE : (DESK_MINUTES_DEFAULT[up] ?? DESK_MINUTES_DEFAULT.ENTERPRISE);
    const fromPlan = typeof set === "number" && set >= 0;
    return { slug: p.slug, name: p.name, minutes: fromPlan ? set : def, source: fromPlan ? "plan" : "default" };
  });
  const defaults = plans.filter((p) => p.source === "default");
  items.push({
    key: "plans",
    label: "Included minutes",
    state: plans.length && !defaults.length ? "ok" : "warn",
    detail: plans.length ? plans.map((p) => `${p.name} ${p.minutes}${p.source === "default" ? "*" : ""}`).join(" · ") + (defaults.length ? " — * the tier's default until set in Plans" : "") : "No plan rows — the tier defaults apply (Professional 150, Advanced 500, Starter 0).",
  });

  const steps: string[] = [];
  if (!openai) steps.push("Set OPENAI_API_KEY on Vercel (Production) and redeploy.");
  if (!twilioOn) steps.push("Configure Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) — without it no company gets a number.");
  if (voice.state === "off") steps.push("Deploy the voice server on Fly (voice/README.md: account, secrets, fly deploy, voice.jobflex.app), then set VOICE_SERVER_URL=wss://voice.jobflex.app and VOICE_SERVER_SECRET on Vercel and redeploy.");
  else if (voice.state === "warn") steps.push("The voice server is set but not right: check `fly status`, the DNS for voice.jobflex.app, and VOICE_MODEL on both sides.");
  for (const n of numbers.filter((x) => x.webhook === "wrong")) steps.push(`Point ${n.number} (${n.company}) at the voice webhook — the button below.`);
  for (const p of platform.filter((x) => x.webhook === "wrong")) steps.push(`Point the platform's ${p.number} at the voice webhook — the button below (its calls are answered for ${p.answeredFor ?? "the first company"}).`);
  for (const p of platform.filter((x) => !x.assigned)) steps.push(`Assign the platform's ${p.number} to your own company — the picker below. Until then its calls reach ${p.answeredFor ?? "the oldest company"} (the oldest company, the old fallback): a test call would land on their Phone page and could book on their calendar.`);
  if (!numbers.length) steps.push(`For a first test, ${firstLine ? `call the platform's ${firstLine.number} once it is assigned, or ` : ""}buy a company a number on Settings → Texting — it takes calls the same day.`);
  if (defaults.length) steps.push(`Set AI desk minutes on ${defaults.map((p) => p.name).join(", ")} in Plans (the defaults apply until then).`);
  steps.push("Rehearse without a phone: `cd voice && OPENAI_API_KEY=… node test/live.mjs` — the real OpenAI realtime API, a scripted caller, the desk's voice saved to a WAV.");
  steps.push("Then the real thing: call a company's number from your phone. The call appears on its Phone page within a minute, with what the desk did; then try \"Test it here\" in Settings → AI desk.");
  return { items, numbers, platform, companies: companies.map((c) => ({ id: c.id, name: c.name || c.id, mine: mine.has(c.id) })), plans, voiceUrl, model: voiceModel(), steps };
}
