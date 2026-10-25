"use server";
// JOBFLEX'S OUTREACH, THE DOORS (2026-10-23) — lib/outreach. The admin's (Admin → Outreach, platform admins only):
// paste a list, check which numbers are landlines, call the next ones, email the rest, mark "don't call", a test call
// to one's own phone. The contractor's (public, braked): "Have the AI desk call me" — their consent, and the call.

import { headers } from "next/headers";
import { appBaseUrl } from "@/lib/appUrl";
import { requirePlatformAdmin, UnauthorizedError } from "@/lib/orgContext";
import { clientIp, DAY, enforceRateLimit, HOUR, RateLimitError } from "@/lib/rateLimit";
import { toE164 } from "@/lib/phone";
import { emailFirst, funnel, routeFor, callableNow, type Prospect } from "@/lib/outreach/rules";
import { deleteProspect, listProspects, readProspect, updateProspect } from "@/lib/outreach/store";
import { allowUsCalls, callNext, callProspect, checkLines, emailProspects, importProspects, outreachReadiness, readCallMeToken, requestCallMe, testCallToAdmin, type OutreachReadiness } from "@/lib/outreach/server";
import { newHunt, runWords, type Hunt } from "@/lib/outreach/hunt";
import { deleteHunt, listHunts, newHuntId, placesConfigured, readHunt, readSettings, runHunt, writeHunt, writeSettings, type HuntRun, type OutreachSettings } from "@/lib/outreach/find";

type Fail = { ok: false; error: string };

async function admin(): Promise<{ ok: true; email: string; name: string | null } | Fail> {
  try {
    const u = await requirePlatformAdmin();
    return { ok: true, email: u.email, name: u.name ?? null };
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, error: "Platform admins only." };
    throw err;
  }
}

const base = async () => (await appBaseUrl()).replace(/\/$/, "");

export interface OutreachRow extends Prospect {
  route: ReturnType<typeof routeFor>;
  /** Why the AI may not call now, when it may not. */
  waitWhy: string | null;
  /** Why the run waits on this one (the email goes first, two days before the call) — "Call now" doesn't. */
  seqWhy: string | null;
}

export interface HuntView extends Omit<Hunt, "seen"> {
  seenCount: number;
}

const view = (h: Hunt): HuntView => {
  const { seen, ...rest } = h;
  return { ...rest, seenCount: seen.length };
};

export async function outreachBoard(): Promise<{ ok: true; rows: OutreachRow[]; readiness: OutreachReadiness; funnel: ReturnType<typeof funnel>; hunts: HuntView[]; settings: OutreachSettings; places: boolean } | Fail> {
  const a = await admin();
  if (!a.ok) return a;
  const [list, readiness, hunts, settings] = await Promise.all([listProspects(), outreachReadiness(), listHunts(), readSettings()]);
  const now = new Date();
  const rows = list.map((p) => {
    const may = callableNow(p, now);
    const seq = emailFirst(p, now, readiness.emails);
    return { ...p, route: routeFor(p), waitWhy: may.ok ? null : may.why, seqWhy: seq.ok ? null : seq.why };
  });
  return { ok: true, rows, readiness, funnel: funnel(list), hunts: hunts.map(view), settings, places: placesConfigured() };
}

/* ── Finding contractors (2026-10-25) ──────────────────────────────── */

/** A new hunt — the trade, the area, how many a day, every morning or not — run at once. The same trade in the same
 *  area again isn't a second hunt: the one there takes the new count and schedule and runs on from where it was. */
export async function createOutreachHunt(input: { trade: string; area: string; perDay: number; daily: boolean }): Promise<{ ok: true; hunt: HuntView; run: HuntRun; words: string } | Fail> {
  const a = await admin();
  if (!a.ok) return a;
  if (!placesConfigured()) return { ok: false, error: "JobFlex's Google key isn't set on this server (GOOGLE_MAPS_API_KEY) — the search needs it." };
  const made = newHunt({ trade: String(input.trade ?? ""), area: String(input.area ?? ""), perDay: Number(input.perDay), daily: input.daily === true, by: a.email }, newHuntId());
  if (!made.ok) return made;
  const hunts = await listHunts();
  const same = hunts.find((h) => h.trade === made.hunt.trade && h.area.toLowerCase() === made.hunt.area.toLowerCase());
  if (!same && hunts.length >= 40) return { ok: false, error: "Forty hunts is plenty — remove one first." };
  const hunt = same ? await writeHunt({ ...same, perDay: made.hunt.perDay, daily: made.hunt.daily, lastError: null }) : await writeHunt(made.hunt);
  const run = await runHunt(hunt.id);
  const after = (await readHunt(hunt.id)) ?? hunt;
  return { ok: true, hunt: view(after), run, words: runWords(run, after) };
}

export async function runOutreachHunt(id: string): Promise<{ ok: true; run: HuntRun; words: string } | Fail> {
  const a = await admin();
  if (!a.ok) return a;
  const h = await readHunt(String(id));
  if (!h) return { ok: false, error: "That hunt is gone." };
  const run = await runHunt(h.id);
  return { ok: true, run, words: runWords(run, h) };
}

export async function setOutreachHuntDaily(id: string, daily: boolean): Promise<{ ok: true } | Fail> {
  const a = await admin();
  if (!a.ok) return a;
  const h = await readHunt(String(id));
  if (!h) return { ok: false, error: "That hunt is gone." };
  await writeHunt({ ...h, daily: daily === true });
  return { ok: true };
}

export async function removeOutreachHunt(id: string): Promise<{ ok: true } | Fail> {
  const a = await admin();
  if (!a.ok) return a;
  await deleteHunt(String(id));
  return { ok: true };
}

/** The schedule: every hour the list is worked on its own — lines checked, the first emails, the AI's calls in hours. */
export async function setOutreachSchedule(on: boolean): Promise<{ ok: true; settings: OutreachSettings } | Fail> {
  const a = await admin();
  if (!a.ok) return a;
  const s = await readSettings();
  const settings = await writeSettings({ ...s, autoWork: on === true });
  return { ok: true, settings };
}

export async function importOutreachList(text: string): Promise<{ ok: true; added: number; merged: number; skipped: number; onJobflex: number } | Fail> {
  const a = await admin();
  if (!a.ok) return a;
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "Paste the list first." };
  if (text.length > 1_000_000) return { ok: false, error: "That list is too long for one paste — split it." };
  return { ok: true, ...(await importProspects(text)) };
}

export async function checkOutreachLines(limit = 50): Promise<{ ok: true; checked: number; failed: number; left: number; error: string | null } | Fail> {
  const a = await admin();
  if (!a.ok) return a;
  return { ok: true, ...(await checkLines(limit)) };
}

export async function callOutreachNext(n = 5): Promise<{ ok: true; placed: number; failed: number; waiting: number; errors: string[] } | Fail> {
  const a = await admin();
  if (!a.ok) return a;
  return { ok: true, ...(await callNext(n, await base())) };
}

export async function callOutreachOne(id: string): Promise<{ ok: true } | Fail> {
  const a = await admin();
  if (!a.ok) return a;
  const r = await callProspect(String(id), await base());
  return r.ok ? { ok: true } : r;
}

export async function emailOutreach(n = 20): Promise<{ ok: true; sent: number; skipped: number; error: string | null } | Fail> {
  const a = await admin();
  if (!a.ok) return a;
  return { ok: true, ...(await emailProspects(n, await base(), { name: a.name, email: a.email })) };
}

export async function setOutreachDnc(id: string, on: boolean): Promise<{ ok: true } | Fail> {
  const a = await admin();
  if (!a.ok) return a;
  const p = await updateProspect(String(id), (x) => ({ ...x, dnc: on ? (x.dnc ?? { at: new Date().toISOString(), via: "admin" }) : null }));
  return p ? { ok: true } : { ok: false, error: "That contractor isn't on the list." };
}

export async function removeOutreach(id: string): Promise<{ ok: true } | Fail> {
  const a = await admin();
  if (!a.ok) return a;
  await deleteProspect(String(id));
  return { ok: true };
}

/** The admin hears the call as a contractor would — on their own phone, by their own consent. */
export async function outreachTestCall(input: { phone: string; name: string; business: string; trade: string }): Promise<{ ok: true; note: string } | Fail> {
  const a = await admin();
  if (!a.ok) return a;
  if (!toE164(input.phone)) return { ok: false, error: "Type your own phone number." };
  const r = await testCallToAdmin({ phone: input.phone, name: input.name || a.name || "", business: input.business || "Test Roofing", trade: input.trade || "roofing", adminEmail: a.email }, await base());
  return r.ok ? { ok: true, note: r.note } : r;
}

/** Turn on US calling on JobFlex's Twilio account (the Voice geo permission), from the Outreach page. */
export async function allowOutreachUsCalls(): Promise<{ ok: true } | Fail> {
  const a = await admin();
  if (!a.ok) return a;
  return allowUsCalls();
}

/* ── The contractor's door ─────────────────────────────────────────── */

async function brake(key: string, max: number, windowMs: number): Promise<string | null> {
  try {
    await enforceRateLimit(key, max, windowMs, "call requests");
    return null;
  } catch (err) {
    if (err instanceof RateLimitError) return "We've had a few requests from here already — try again a little later.";
    throw err;
  }
}

/** What the call-me page shows for the email's link: the contractor's name and business, nothing else. */
export async function callMePrefill(token: string): Promise<{ name: string; business: string; phone: string; trade: string | null } | null> {
  const id = readCallMeToken(token);
  const p = id ? await readProspect(id) : null;
  return p ? { name: p.name, business: p.business, phone: p.phone ?? "", trade: p.trade } : null;
}

export async function askForOutreachCall(input: { token?: string | null; name: string; business: string; phone: string; email?: string | null; trade?: string | null; state?: string | null; consent: boolean }): Promise<{ ok: true; calling: boolean; note: string } | Fail> {
  const ip = await clientIp();
  const phone = toE164(String(input.phone ?? ""));
  const braked = (await brake(`outreach-ask-ip:${ip}`, 4, HOUR)) ?? (phone ? await brake(`outreach-ask-phone:${phone}`, 3, DAY) : null) ?? (await brake("outreach-ask:global", 60, HOUR));
  if (braked) return { ok: false, error: braked };
  const ua = (await headers()).get("user-agent");
  return requestCallMe(
    {
      token: input.token ?? null,
      name: String(input.name ?? "").slice(0, 120),
      business: String(input.business ?? "").slice(0, 120),
      phone: String(input.phone ?? ""),
      email: input.email ? String(input.email).slice(0, 160) : null,
      trade: input.trade ? String(input.trade).slice(0, 40) : null,
      state: input.state ? String(input.state).slice(0, 30) : null,
      consent: input.consent === true,
      ip,
      ua,
    },
    await base(),
  );
}
