import crypto from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secretBox";
import { enforcePlanLimit } from "@/lib/limitsEngine";
import { consentKeysOf, MetaApiError, metaFormLegalSchema, metaId, metaPageSchema, metaGraph, metaLeadSchema, metaLeadFields, tickedBoxes } from "./graph";

// Namespaced records in the existing atomic key/value store: no schema push.
const pendingKey = (org: string) => `meta:pending:${org}`;
// One row per Page PER WORKSPACE (owner, 2026-10-30: several JobFlex accounts take leads from one company's
// Page). Before that a Page had a single owner row keyed by the Page alone; those rows are still read as the
// connection of the workspace they name, and are dropped when that workspace disconnects or reconnects.
const pageKey = (page: string, org: string) => `meta:page:${page}:${org}`;
const legacyPageKey = (page: string) => `meta:page:${page}`;
const jobKey = (org: string) => `meta:import:${org}`;
const pendingSchema = z.object({ actorId: z.string(), userId: metaId, expiresAt: z.number(), pages: z.array(metaPageSchema) });
const connectionSchema = z.object({ organizationId: z.string(), userId: metaId, pageId: metaId, pageName: z.string(), tokenBox: z.string(), generation: z.string() });
type Connection = z.infer<typeof connectionSchema>;
const jobSchema = z.object({ generation: z.string(), done: z.boolean(), forms: z.array(metaId), formAfter: z.string().optional(), leadAfter: z.string().optional(), formsLoaded: z.boolean(), imported: z.number(), skipped: z.number(), leaseUntil: z.number() });
type Job = z.infer<typeof jobSchema>;
const pagingSchema = z.object({ next: z.string().optional(), cursors: z.object({ after: z.string().optional() }).optional() }).optional();
function nextCursor(paging: z.infer<typeof pagingSchema>) {
  if (paging?.next && !paging.cursors?.after) throw new Error("Meta returned an incomplete pagination cursor. Please retry.");
  return paging?.next ? paging.cursors?.after : undefined;
}
function pageFromSettings(value: string | null) {
  try { return metaId.safeParse(JSON.parse(value || "{}").pageId).data; } catch { return undefined; }
}
/** This workspace's own row for the Page — the per-workspace key first, then a pre-2026-10-30 row that names it. */
async function connectionRow(client: { syncState: typeof db.syncState }, pageId: string, organizationId: string) {
  for (const key of [pageKey(pageId, organizationId), legacyPageKey(pageId)]) {
    const row = await client.syncState.findUnique({ where: { key } });
    if (!row) continue;
    let parsed;
    try { parsed = connectionSchema.safeParse(JSON.parse(row.cursor)); } catch { continue; }
    if (parsed.success && parsed.data.organizationId === organizationId) return { row, connection: parsed.data };
  }
  return null;
}
export async function getMetaConnection(organizationId: string) {
  const org = await db.organization.findFirst({ where: { id: organizationId, deletedAt: null }, select: { metaSettingsJson: true } });
  const pageId = pageFromSettings(org?.metaSettingsJson || null);
  if (!pageId) return null;
  const found = await connectionRow(db, pageId, organizationId);
  return found ? { ...found.connection, stored: found.row.cursor, key: found.row.key } : null;
}
export async function saveMetaCandidates(organizationId: string, actorId: string, grant: { userId: string; pages: z.infer<typeof metaPageSchema>[] }) {
  if (await getMetaConnection(organizationId)) throw new Error("Disconnect the current Page before choosing another Page.");
  const cursor = encryptSecret(JSON.stringify({ ...grant, actorId, expiresAt: Date.now() + 15 * 60_000 }));
  await db.syncState.upsert({ where: { key: pendingKey(organizationId) }, create: { key: pendingKey(organizationId), cursor }, update: { cursor } });
}
async function getPending(organizationId: string, actorId: string) {
  const row = await db.syncState.findUnique({ where: { key: pendingKey(organizationId) } });
  if (!row) return null;
  let result;
  try { result = pendingSchema.parse(JSON.parse(decryptSecret(row.cursor))); } catch { return null; }
  if (result.expiresAt < Date.now()) {
    await db.syncState.deleteMany({ where: { key: row.key, cursor: row.cursor } });
    return null;
  }
  return result.actorId === actorId ? { ...result, stored: row.cursor } : null;
}
export async function metaConnectionView(organizationId: string, actorId: string) {
  const [connection, pending, job] = await Promise.all([getMetaConnection(organizationId), getPending(organizationId, actorId), db.syncState.findUnique({ where: { key: jobKey(organizationId) } })]);
  return {
    connected: Boolean(connection), pageName: connection?.pageName || "", pageId: connection?.pageId || "",
    pages: pending?.pages.map(p => ({ id: p.id, name: p.name })) || [],
    lastImportAt: job?.updatedAt.toISOString() || null,
    canResume: Boolean(connection && job && !jobSchema.parse(JSON.parse(job.cursor)).done),
  };
}
export async function selectMetaPage(organizationId: string, actorId: string, pageId: string) {
  metaId.parse(pageId);
  const pending = await getPending(organizationId, actorId);
  const page = pending?.pages.find(p => p.id === pageId);
  if (!pending || !page) throw new Error("Authorization expired or Page was not granted. Connect Meta again.");
  // Verify read access before showing Connected. No ads are created or changed.
  await metaGraph(`${page.id}/leadgen_forms`, page.access_token, { fields: "id", limit: "1" });
  const connection: Connection = { organizationId, userId: pending.userId, pageId, pageName: page.name, tokenBox: encryptSecret(page.access_token), generation: crypto.randomUUID() };
  await db.$transaction(async tx => {
    const org = await tx.organization.findFirst({ where: { id: organizationId, deletedAt: null }, select: { metaSettingsJson: true } });
    if (!org) throw new Error("Workspace not found.");
    if (pageFromSettings(org.metaSettingsJson)) throw new Error("Disconnect the current Page first.");
    const consumed = await tx.syncState.deleteMany({ where: { key: pendingKey(organizationId), cursor: pending.stored } });
    if (!consumed.count) throw new Error("Authorization changed. Connect Meta again.");
    // Other workspaces connected to the same Page keep their own rows. A row of THIS workspace can only be a
    // leftover here (its settings name no Page — checked above), so it gives way to the new one.
    const stale = await connectionRow(tx, pageId, organizationId);
    if (stale) await tx.syncState.deleteMany({ where: { key: stale.row.key, cursor: stale.row.cursor } });
    await tx.syncState.upsert({ where: { key: pageKey(pageId, organizationId) }, create: { key: pageKey(pageId, organizationId), cursor: JSON.stringify(connection) }, update: { cursor: JSON.stringify(connection) } });
    const saved = await tx.organization.updateMany({ where: { id: organizationId, metaSettingsJson: org.metaSettingsJson }, data: { metaSettingsJson: JSON.stringify({ connected: true, autoCreate: false, autoText: false, pageId, defaultPage: page.name, formCategory: "auto" }) } });
    if (saved.count !== 1) throw new Error("Connection changed. Please try again.");
  });
}
export async function disconnectMetaPage(organizationId: string, expectedUserId?: string) {
  await db.$transaction(async tx => {
    const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { metaSettingsJson: true } });
    if (!org) return;
    const pageId = pageFromSettings(org.metaSettingsJson);
    const found = pageId ? await connectionRow(tx, pageId, organizationId) : null;
    if (expectedUserId && found?.connection.userId !== expectedUserId) return;
    if (found) await tx.syncState.deleteMany({ where: { key: found.row.key, cursor: found.row.cursor } });
    await tx.syncState.deleteMany({ where: { key: { in: [pendingKey(organizationId), jobKey(organizationId)] } } });
    const changed = await tx.organization.updateMany({ where: { id: organizationId, metaSettingsJson: org.metaSettingsJson }, data: { metaSettingsJson: JSON.stringify({ connected: false, autoCreate: false, autoText: false, defaultPage: "", formCategory: "auto" }) } });
    if (!changed.count) throw new Error("Connection changed. Please try again.");
  });
}

// One bounded request imports <=10 leads. The browser repeats while active;
// persisted cursors allow resuming, and the atomic lease rejects double-clicks.
export async function importMetaBatch(organizationId: string, actorId: string, restart: boolean) {
  const connection = await getMetaConnection(organizationId);
  if (!connection) throw new Error("Connect a Facebook Page first.");
  const key = jobKey(organizationId);
  let row = await db.syncState.findUnique({ where: { key } });
  let job: Job = row ? jobSchema.parse(JSON.parse(row.cursor)) : { generation: connection.generation, done: false, forms: [], formsLoaded: false, imported: 0, skipped: 0, leaseUntil: 0 };
  if (job.leaseUntil > Date.now()) throw new Error("An import is already running. Wait a moment before retrying.");
  if (restart || job.generation !== connection.generation) job = { generation: connection.generation, done: false, forms: [], formsLoaded: false, imported: 0, skipped: 0, leaseUntil: 0 };
  if (job.done) return { done: true, imported: job.imported, skipped: job.skipped };
  const locked = JSON.stringify({ ...job, leaseUntil: Date.now() + 120_000 });
  if (row) {
    const won = await db.syncState.updateMany({ where: { key, cursor: row.cursor }, data: { cursor: locked } });
    if (!won.count) throw new Error("An import is already running. Please wait.");
  } else {
    await db.syncState.create({ data: { key, cursor: locked } });
    row = { key, cursor: locked, updatedAt: new Date() };
  }
  try {
    const token = decryptSecret(connection.tokenBox);
    if (!job.forms.length && (!job.formsLoaded || job.formAfter)) {
      const batch = z.object({ data: z.array(z.object({ id: metaId })), paging: pagingSchema }).parse(await metaGraph(`${connection.pageId}/leadgen_forms`, token, { fields: "id", limit: "25", ...(job.formAfter ? { after: job.formAfter } : {}) }));
      job = { ...job, forms: batch.data.map(f => f.id), formsLoaded: true, formAfter: nextCursor(batch.paging) };
    }
    const formId = job.forms[0];
    const batch = formId ? z.object({ data: z.array(metaLeadSchema), paging: pagingSchema }).parse(await metaGraph(`${formId}/leads`, token, { fields: "id,created_time,field_data", limit: "10", ...(job.leadAfter ? { after: job.leadAfter } : {}) })) : { data: [], paging: undefined };
    const seen = await db.webhookEvent.count({ where: { provider: "META_LEADS", eventId: { in: batch.data.map(lead => `${organizationId}:${lead.id}`) } } });
    const needed = batch.data.length - seen;
    if (needed > 0) await enforcePlanLimit(organizationId, "leads", needed);
    await db.$transaction(async tx => {
      // Touch the ownership row to serialize against disconnect; the same
      // transaction that imports a batch must still own this exact grant.
      const owned = await tx.syncState.updateMany({ where: { key: connection.key, cursor: connection.stored }, data: { cursor: connection.stored } });
      const org = await tx.organization.findFirst({ where: { id: organizationId, deletedAt: null }, select: { id: true } });
      if (!owned.count || !org) throw new Error("Meta was disconnected. Import stopped.");
      for (const lead of batch.data) {
        const eventId = `${organizationId}:${lead.id}`;
        if (await tx.webhookEvent.findUnique({ where: { provider_eventId: { provider: "META_LEADS", eventId } } })) { job.skipped++; continue; }
        const id = `meta_${crypto.createHash("sha256").update(eventId).digest("hex").slice(0, 40)}`;
        await tx.lead.create({ data: { id, organizationId, ...metaLeadFields(lead), source: "FACEBOOK", status: "NEW" } });
        await tx.webhookEvent.create({ data: { provider: "META_LEADS", eventId, type: `page:${connection.pageId}`, status: "PROCESSED", processedAt: new Date() } });
        job.imported++;
      }
      job.leadAfter = nextCursor(batch.paging);
      if (!job.leadAfter && formId) job.forms.shift();
      job.done = job.formsLoaded && !job.forms.length && !job.formAfter;
      job.leaseUntil = 0;
      const saved = await tx.syncState.updateMany({ where: { key, cursor: locked }, data: { cursor: JSON.stringify(job) } });
      if (!saved.count) throw new Error("Import session changed. Please try again.");
      if (batch.data.length) await tx.activityEvent.create({ data: { organizationId, actorId, kind: "CREATED", summary: `Meta lead import: ${job.imported} imported in this run.` } });
    }, { timeout: 20000 });
    return { done: job.done, imported: job.imported, skipped: job.skipped };
  } catch (error) {
    // Restore the pre-batch cursor so failed imports are retried, never skipped.
    await db.syncState.updateMany({ where: { key, cursor: locked }, data: { cursor: row.cursor === locked ? JSON.stringify({ generation: connection.generation, done: false, forms: [], formsLoaded: false, imported: 0, skipped: 0, leaseUntil: 0 }) : row.cursor } });
    throw error;
  }
}

// ── new leads by themselves (owner, 2026-10-31: "No leads come automatically. Meta.") ─────────────────────────────
// Every 2 minutes (the SmartBook cron) each connected workspace's Page is read for leads newer than the last check,
// with the Page token and the permissions already approved — no webhook, no new Meta review. They become the rows
// Import makes (Lead + WebhookEvent, so Import and this never make a lead twice), the office hears about each one
// (notifyLeadCreated), and SmartBook answers them when it is on. The form's consent boxes are read once per form and
// a ticked "texts" box is kept as the person's yes to texts. Import stays for history; this starts from the hour
// before the first check. A burst of more than 50 new leads on one form between two checks leaves the rest to Import.
const autoKey = (org: string) => `meta:auto:${org}`;
const autoSchema = z.object({
  generation: z.string(),
  since: z.number(),
  forms: z.array(metaId),
  formsAt: z.number(),
  consent: z.record(z.string(), z.object({ text: z.string().nullable(), call: z.string().nullable() })).default({}),
  limitAt: z.number().optional(),
  noBoxes: z.boolean().optional(),
});
type AutoState = z.infer<typeof autoSchema>;

/** Settings → SmartBook: how many of the Page's lead forms carry a texts box (and a calls box) — null before the first check. */
export async function metaConsentSummary(organizationId: string): Promise<{ forms: number; withTexts: number; withCalls: number } | null> {
  const row = await db.syncState.findUnique({ where: { key: autoKey(organizationId) }, select: { cursor: true } });
  if (!row) return null;
  try {
    const state = autoSchema.parse(JSON.parse(row.cursor));
    const boxes = state.forms.map((f) => state.consent[f]).filter((x): x is NonNullable<typeof x> => !!x);
    return { forms: state.forms.length, withTexts: boxes.filter((b) => b.text).length, withCalls: boxes.filter((b) => b.call).length };
  } catch {
    return null;
  }
}

export async function syncMetaLeads(organizationId: string, now = new Date()): Promise<number> {
  const connection = await getMetaConnection(organizationId);
  if (!connection) return 0;
  const key = autoKey(organizationId);
  const row = await db.syncState.findUnique({ where: { key } });
  const fresh = (): AutoState => ({ generation: connection.generation, since: Math.floor(now.getTime() / 1000) - 3600, forms: [], formsAt: 0, consent: {} });
  let state: AutoState = fresh();
  if (row) {
    try {
      const parsed = autoSchema.parse(JSON.parse(row.cursor));
      if (parsed.generation === connection.generation) state = parsed;
    } catch { /* a broken row starts over */ }
  }
  const token = decryptSecret(connection.tokenBox);
  if (!state.forms.length || now.getTime() - state.formsAt > 6 * 3600_000) {
    const forms: string[] = [];
    let after: string | undefined;
    for (let page = 0; page < 4; page++) {
      const batch = z.object({ data: z.array(z.object({ id: metaId })), paging: pagingSchema }).parse(await metaGraph(`${connection.pageId}/leadgen_forms`, token, { fields: "id", limit: "100", ...(after ? { after } : {}) }));
      forms.push(...batch.data.map((f) => f.id));
      after = nextCursor(batch.paging);
      if (!after) break;
    }
    // The consent boxes are read again with the forms: a box the owner adds to a form later counts from then on.
    state = { ...state, forms, formsAt: now.getTime(), consent: {} };
  }
  const made: Array<{ id: string; text: boolean; call: boolean }> = [];
  let newest = state.since;
  let limited = false;
  for (const formId of state.forms.slice(0, 60)) {
    if (!state.consent[formId]) {
      try {
        state.consent[formId] = consentKeysOf(metaFormLegalSchema.parse(await metaGraph(formId, token, { fields: "legal_content{custom_disclaimer{checkboxes{key,text}}}" })));
      } catch {
        state.consent[formId] = { text: null, call: null };
      }
    }
    const read = (fields: string) => metaGraph(`${formId}/leads`, token, { fields, limit: "50", filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: state.since }]) });
    let raw: unknown;
    try {
      raw = await read(state.noBoxes ? "id,created_time,field_data" : "id,created_time,field_data,custom_disclaimer_responses");
    } catch (err) {
      // A Graph version that won't name the consent answers (an invalid-field error) must not stop the leads.
      if (!(err instanceof MetaApiError) || err.code !== 100 || state.noBoxes) throw err;
      state.noBoxes = true;
      raw = await read("id,created_time,field_data");
    }
    const batch = z.object({ data: z.array(metaLeadSchema) }).parse(raw);
    const seen = new Set((await db.webhookEvent.findMany({ where: { provider: "META_LEADS", eventId: { in: batch.data.map((l) => `${organizationId}:${l.id}`) } }, select: { eventId: true } })).map((e) => e.eventId));
    const todo = batch.data.filter((l) => !seen.has(`${organizationId}:${l.id}`));
    if (!todo.length) continue;
    try {
      await enforcePlanLimit(organizationId, "leads", todo.length);
    } catch {
      // The plan's lead limit: the leads wait on Facebook (the check doesn't move past them), the owner hears once a day.
      limited = true;
      if (!state.limitAt || now.getTime() - state.limitAt > 86_400_000) {
        state.limitAt = now.getTime();
        await db.activityEvent.create({ data: { organizationId, actorId: null, kind: "CREATED", summary: `Facebook leads are waiting: your plan's lead limit is reached. Upgrade on Subscription to bring them in.` } }).catch(() => null);
      }
      break;
    }
    const boxes = state.consent[formId];
    for (const lead of todo) {
      const eventId = `${organizationId}:${lead.id}`;
      const id = `meta_${crypto.createHash("sha256").update(eventId).digest("hex").slice(0, 40)}`;
      try {
        await db.$transaction(async (tx) => {
          const owned = await tx.syncState.updateMany({ where: { key: connection.key, cursor: connection.stored }, data: { cursor: connection.stored } });
          if (!owned.count) throw new Error("Meta was disconnected.");
          await tx.lead.create({ data: { id, organizationId, ...metaLeadFields(lead), source: "FACEBOOK", status: "NEW" } });
          await tx.webhookEvent.create({ data: { provider: "META_LEADS", eventId, type: `page:${connection.pageId}`, status: "PROCESSED", processedAt: now } });
        });
      } catch {
        continue; // Import took it a moment ago, or the Page went away.
      }
      const ticked = tickedBoxes(lead);
      made.push({ id, text: !!boxes.text && ticked.has(boxes.text), call: !!boxes.call && ticked.has(boxes.call) });
      const at = lead.created_time ? Math.floor(Date.parse(lead.created_time) / 1000) : NaN;
      if (Number.isFinite(at) && at > newest) newest = at;
    }
  }
  if (!limited) state.since = newest;
  await db.syncState.upsert({ where: { key }, create: { key, cursor: JSON.stringify(state) }, update: { cursor: JSON.stringify(state) } });
  if (made.length) {
    await db.activityEvent.create({ data: { organizationId, actorId: null, kind: "CREATED", summary: `${made.length} new Facebook lead${made.length === 1 ? "" : "s"} came in.` } }).catch(() => null);
    const [{ notifyLeadCreated }, { startSmartBook }] = await Promise.all([import("@/lib/notify"), import("@/lib/smartbook/engine")]);
    for (const m of made) {
      await notifyLeadCreated(m.id).catch((err) => console.warn(`[meta] lead notice: ${err instanceof Error ? err.message : String(err)}`));
      await startSmartBook(m.id, "facebook", { now, consent: { text: m.text ? "facebook-form" : null, call: m.call } }).catch((err) => console.warn(`[meta] smartbook: ${err instanceof Error ? err.message : String(err)}`));
    }
  }
  return made.length;
}

/** Every connected workspace, one after another; one that fails never stops the rest. */
export async function syncAllMetaLeads(now = new Date()): Promise<number> {
  const orgs = await db.organization.findMany({ where: { deletedAt: null, metaSettingsJson: { contains: '"connected":true' } }, select: { id: true }, take: 500 });
  let n = 0;
  for (const o of orgs) {
    try {
      n += await syncMetaLeads(o.id, now);
    } catch (err) {
      console.warn(`[meta] auto sync ${o.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return n;
}
