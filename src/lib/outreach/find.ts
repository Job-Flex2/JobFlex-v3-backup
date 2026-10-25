// THE HUNT RUN (2026-10-25, lib/outreach/hunt for the pure parts): Google's Places asked for the trade in the area, the
// new ones' websites read for an email, the rows added to the outreach list as found online; the hunts and the schedule
// kept in SyncState (no schema change); the scheduled work step the cron runs every hour — line checks, the email first,
// the AI's calls to landlines in their hours, as the outreach's own rules allow.
import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { logServerError } from "@/lib/server-events";
import { listProspects } from "./store";
import { checkLines, callNext, emailProspects, importRows, outreachReadiness } from "./server";
import { contactPages, emailFromHtml, huntDue, huntPhrases, huntQuery, placeToRow, placesErrorWords, rememberSeen, type FoundPlace, type FoundRow, type Hunt } from "./hunt";

const HUNT_PREFIX = "outreach:hunt:";
const SETTINGS_KEY = "outreach:settings";

export interface OutreachSettings {
  /** The cron works the list every hour: line checks, the email first, up to `callsPerRun` calls to landlines in hours. */
  autoWork: boolean;
  callsPerRun: number;
  emailsPerRun: number;
  lastWorkAt: string | null;
  lastWork: string | null;
}

export const DEFAULT_SETTINGS: OutreachSettings = { autoWork: false, callsPerRun: 5, emailsPerRun: 20, lastWorkAt: null, lastWork: null };

export const newHuntId = () => randomBytes(8).toString("hex");

/* ── The store ───────────────────────────────────────────────────────── */

function parseHunt(key: string, cursor: string | null): Hunt | null {
  try {
    const h = JSON.parse(cursor ?? "") as Hunt;
    return h && h.id === key.slice(HUNT_PREFIX.length) && typeof h.trade === "string" && typeof h.area === "string" ? { ...h, seen: Array.isArray(h.seen) ? h.seen : [], pageToken: h.pageToken ?? null, phraseIndex: Number(h.phraseIndex) || 0, exhausted: !!h.exhausted } : null;
  } catch {
    return null;
  }
}

export async function listHunts(): Promise<Hunt[]> {
  const rows = await db.syncState.findMany({ where: { key: { startsWith: HUNT_PREFIX } }, select: { key: true, cursor: true } });
  return rows
    .map((r) => parseHunt(r.key, r.cursor))
    .filter((h): h is Hunt => !!h)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readHunt(id: string): Promise<Hunt | null> {
  const row = await db.syncState.findUnique({ where: { key: `${HUNT_PREFIX}${id}` }, select: { key: true, cursor: true } });
  return row ? parseHunt(row.key, row.cursor) : null;
}

export async function writeHunt(h: Hunt): Promise<Hunt> {
  const key = `${HUNT_PREFIX}${h.id}`;
  const cursor = JSON.stringify(h);
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
  return h;
}

export async function deleteHunt(id: string): Promise<void> {
  await db.syncState.deleteMany({ where: { key: `${HUNT_PREFIX}${id}` } });
}

export async function readSettings(): Promise<OutreachSettings> {
  const row = await db.syncState.findUnique({ where: { key: SETTINGS_KEY }, select: { cursor: true } }).catch(() => null);
  try {
    const s = row?.cursor ? (JSON.parse(row.cursor) as Partial<OutreachSettings>) : {};
    return { ...DEFAULT_SETTINGS, ...s };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function writeSettings(s: OutreachSettings): Promise<OutreachSettings> {
  const cursor = JSON.stringify(s);
  await db.syncState.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, cursor }, update: { cursor } });
  return s;
}

/* ── Google's Places ─────────────────────────────────────────────────── */

const FIELDS = "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus,places.types,nextPageToken";

export function placesConfigured(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

/** One page of Google's text search for the hunt's phrase: up to twenty places and the token for the next page. */
export async function searchPlaces(query: string, pageToken: string | null): Promise<{ places: FoundPlace[]; nextPage: string | null }> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("JobFlex's Google key isn't set (GOOGLE_MAPS_API_KEY).");
  const base = (process.env.NODE_ENV !== "production" && process.env.GOOGLE_PLACES_BASE?.trim()) || "https://places.googleapis.com";
  const res = await fetch(`${base.replace(/\/$/, "")}/v1/places:searchText`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS },
    body: JSON.stringify({ textQuery: query, pageSize: 20, languageCode: "en", regionCode: "US", ...(pageToken ? { pageToken } : {}) }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { places?: Array<Record<string, unknown>>; nextPageToken?: string; error?: { message?: string; status?: string } };
  if (!res.ok) throw new Error(placesErrorWords(res.status, j.error?.message ?? j.error?.status ?? null));
  const places: FoundPlace[] = (j.places ?? []).map((p) => {
    const name = p.displayName as { text?: string } | undefined;
    return {
      id: String(p.id ?? ""),
      name: String(name?.text ?? ""),
      address: typeof p.formattedAddress === "string" ? p.formattedAddress : null,
      phone: typeof p.nationalPhoneNumber === "string" ? p.nationalPhoneNumber : typeof p.internationalPhoneNumber === "string" ? p.internationalPhoneNumber : null,
      website: typeof p.websiteUri === "string" ? p.websiteUri : null,
      rating: typeof p.rating === "number" ? p.rating : null,
      ratings: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
      types: Array.isArray(p.types) ? (p.types as unknown[]).map(String) : [],
      status: typeof p.businessStatus === "string" ? p.businessStatus : null,
    };
  });
  return { places: places.filter((p) => p.id), nextPage: typeof j.nextPageToken === "string" && j.nextPageToken ? j.nextPageToken : null };
}

/* ── The website's email ─────────────────────────────────────────────── */

const SITE_TIMEOUT_MS = 6_000;
const SITE_MAX_BYTES = 400_000;

async function pageText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; JobFlexBot/1.0; +https://jobflex.app)", Accept: "text/html" }, signal: AbortSignal.timeout(SITE_TIMEOUT_MS), redirect: "follow", cache: "no-store" });
    if (!res.ok || !/text\/html|application\/xhtml/i.test(res.headers.get("content-type") ?? "text/html")) return null;
    const text = await res.text();
    return text.slice(0, SITE_MAX_BYTES);
  } catch {
    return null;
  }
}

/** The business's email off its own site: the home page, then the contact and about pages, the first that has one. */
export async function emailFromSite(site: string): Promise<string | null> {
  for (const url of contactPages(site)) {
    const html = await pageText(url);
    if (!html) continue;
    const email = emailFromHtml(html, site);
    if (email) return email;
  }
  return null;
}

/* ── A run ───────────────────────────────────────────────────────────── */

export interface HuntRun {
  found: number;
  added: number;
  merged: number;
  onJobflex: number;
  withEmail: number;
  pages: number;
  error: string | null;
}

/** Pages of Google asked at most in one run. */
const MAX_PAGES = 5;
/** Websites read for an email in one run (each a few seconds at most). */
const MAX_SITES = 30;

/** One run of a hunt: the next places of its trade in its area, not seen before and not on the list, their emails
 *  read off their sites, added to the list as found online. The hunt remembers what it took and where to go on. */
export async function runHunt(id: string): Promise<HuntRun> {
  const hunt = await readHunt(id);
  if (!hunt) return { found: 0, added: 0, merged: 0, onJobflex: 0, withEmail: 0, pages: 0, error: "That hunt is gone." };
  const out: HuntRun = { found: 0, added: 0, merged: 0, onJobflex: 0, withEmail: 0, pages: 0, error: null };
  const now = new Date().toISOString();
  try {
    const list = await listProspects();
    const known = new Set<string>([...list.map((p) => p.phone).filter((x): x is string => !!x), ...list.map((p) => p.website?.toLowerCase()).filter((x): x is string => !!x)]);
    const seen = new Set(hunt.seen);
    const rows: FoundRow[] = [];
    const taken: string[] = [];
    // Where the last run left off: its page of its phrase; a hunt that ran dry starts over for newcomers.
    const phrases = huntPhrases(hunt.trade);
    let phrase = hunt.exhausted ? 0 : Math.min(hunt.phraseIndex, phrases.length - 1);
    let token = hunt.exhausted ? null : hunt.pageToken;
    let exhausted = false;
    let pages = 0;
    while (rows.length < hunt.perDay && pages < MAX_PAGES) {
      const page = await searchPlaces(huntQuery({ ...hunt, phraseIndex: phrase }), token);
      pages++;
      for (const p of page.places) {
        if (rows.length >= hunt.perDay) break;
        if (seen.has(p.id)) continue;
        const row = placeToRow(p, hunt);
        taken.push(p.id);
        if (!row) continue;
        if ((row.phone && known.has(row.phone)) || (row.website && known.has(row.website.toLowerCase()))) continue;
        rows.push(row);
        if (row.phone) known.add(row.phone);
        if (row.website) known.add(row.website.toLowerCase());
      }
      token = page.nextPage;
      if (!token) {
        // This phrase has run dry — on to the next one; past the last, Google knows no more of this trade here.
        if (phrase + 1 < phrases.length) {
          phrase++;
          continue;
        }
        exhausted = true;
        break;
      }
    }
    out.pages = pages;
    out.found = rows.length;
    // The emails off their sites, a few at a time.
    const withSite = rows.filter((r) => r.website).slice(0, MAX_SITES);
    for (let i = 0; i < withSite.length; i += 3) {
      await Promise.all(
        withSite.slice(i, i + 3).map(async (r) => {
          r.email = await emailFromSite(r.website!);
        }),
      );
    }
    out.withEmail = rows.filter((r) => r.email).length;
    const imported = await importRows(rows, "found", { huntId: hunt.id });
    out.added = imported.added;
    out.merged = imported.merged;
    out.onJobflex = imported.onJobflex;
    await writeHunt({ ...hunt, seen: rememberSeen(hunt.seen, taken), pageToken: exhausted ? null : token, phraseIndex: exhausted ? 0 : phrase, exhausted, lastRunAt: now, lastFound: imported.added, totalFound: hunt.totalFound + imported.added, lastError: null });
  } catch (err) {
    out.error = err instanceof Error ? err.message : "The search didn't work.";
    logServerError("outreach-hunt", err, { kind: "action" });
    await writeHunt({ ...hunt, lastRunAt: now, lastError: out.error }).catch(() => {});
  }
  return out;
}

/** The hunts due this hour, run one after another (the cron). */
export async function runDueHunts(now = new Date()): Promise<Array<{ id: string; run: HuntRun }>> {
  const hunts = await listHunts();
  const out: Array<{ id: string; run: HuntRun }> = [];
  for (const h of hunts.filter((x) => huntDue(x, now)).slice(0, 4)) out.push({ id: h.id, run: await runHunt(h.id) });
  return out;
}

/** The scheduled work step (the cron, every hour, when the schedule is on): the lines checked, the emails that are due
 *  sent, the landlines whose turn it is called — each by the outreach's own rules (hours, two calls, consent). */
export async function workOutreach(base: string, now = new Date()): Promise<{ checked: number; emailed: number; called: number; waiting: number; notes: string[] }> {
  const notes: string[] = [];
  const readiness = await outreachReadiness();
  const lines = await checkLines(50).catch((err) => {
    notes.push(`Line check: ${err instanceof Error ? err.message : "failed"}`);
    return { checked: 0, failed: 0, left: 0, error: null };
  });
  if (lines.error) notes.push(`Line check: ${lines.error}`);
  let emailed = 0;
  if (readiness.emails) {
    const admin = await db.user.findFirst({ where: { isPlatformAdmin: true, email: { not: "" } }, orderBy: { createdAt: "asc" }, select: { name: true, email: true } });
    if (admin) {
      const settings = await readSettings();
      const m = await emailProspects(settings.emailsPerRun, base, { name: admin.name, email: admin.email }).catch((err) => ({ sent: 0, skipped: 0, error: err instanceof Error ? err.message : "failed" }));
      emailed = m.sent;
      if (m.error) notes.push(`Emails: ${m.error}`);
    } else notes.push("Emails: no admin with an address to send from.");
  } else notes.push("Emails aren't set up — the AI calls landlines without the email first.");
  let called = 0;
  let waiting = 0;
  if (readiness.calls) {
    const settings = await readSettings();
    const c = await callNext(settings.callsPerRun, base).catch((err) => ({ placed: 0, failed: 0, waiting: 0, errors: [err instanceof Error ? err.message : "failed"] }));
    called = c.placed;
    waiting = c.waiting;
    notes.push(...c.errors.slice(0, 3));
  } else notes.push("Calls aren't ready (Twilio or the voice server).");
  const summary = `${now.toISOString().slice(0, 16).replace("T", " ")}Z — checked ${lines.checked}, emailed ${emailed}, called ${called}${waiting ? `, ${waiting} waiting` : ""}${notes.length ? ` · ${notes[0]}` : ""}`;
  const s = await readSettings();
  await writeSettings({ ...s, lastWorkAt: now.toISOString(), lastWork: summary }).catch(() => {});
  return { checked: lines.checked, emailed, called, waiting, notes };
}
