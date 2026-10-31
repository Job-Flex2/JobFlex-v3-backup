import crypto from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto/secretBox";
import { enforcePlanLimit } from "@/lib/limitsEngine";
import { parseMetaSettings } from "@/lib/settings";
import { getMetaConnection } from "./connections";
import { metaConfigured, metaGraph, metaId, metaLeadFields, metaLeadSchema, type MetaLead } from "./graph";

// AUTOMATIC META LEADS (owner, 2026-10-30: "if a new lead comes to Meta it will automatically appear in JobFlex
// leads, and you can turn the toggle on or off in the settings").
//
// The switch is `autoCreate` in Organization.metaSettingsJson — the field was already there, never used. While it
// is on, the cron (/api/cron/meta-leads, every 5 minutes) asks Meta for each lead form's submissions created
// since the last sweep and files them in Leads exactly as the Import leads button does: the same lead id, the same
// META_LEADS receipt per lead, so a lead the button already brought in is never filed twice, and the reverse.
// Polling, not Meta's leadgen webhook: the webhook needs a Page subscription (pages_manage_metadata, a new
// permission and app review); polling works with the permissions every connected Page already granted.
//
// The sweep's place is a SyncState row per workspace: { pageId, since } — the Unix time the last sweep started.
// Turning the switch on starts it at that moment (older leads stay with the Import leads button); a new Page
// starts it over. A failed sweep leaves the row alone, so the next one asks again for the same window.

const sinceKey = (org: string) => `meta:auto:${org}`;
const sinceSchema = z.object({ pageId: metaId, since: z.number() });
const pagingSchema = z.object({ next: z.string().optional(), cursors: z.object({ after: z.string().optional() }).optional() }).optional();
const after = (paging: z.infer<typeof pagingSchema>) => (paging?.next ? paging.cursors?.after : undefined);
/** Meta can index a submission a little after its created_time; the receipts make the overlap free. */
const OVERLAP_SECONDS = 300;

export async function setMetaAutoImport(organizationId: string, on: boolean) {
  const connection = await getMetaConnection(organizationId);
  if (!connection) throw new Error("Connect a Facebook Page first.");
  await db.$transaction(async tx => {
    const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { metaSettingsJson: true } });
    if (!org?.metaSettingsJson) throw new Error("Connect a Facebook Page first.");
    const next = { ...JSON.parse(org.metaSettingsJson), autoCreate: on };
    const saved = await tx.organization.updateMany({ where: { id: organizationId, metaSettingsJson: org.metaSettingsJson }, data: { metaSettingsJson: JSON.stringify(next) } });
    if (saved.count !== 1) throw new Error("Connection changed. Please try again.");
    if (on) {
      const cursor = JSON.stringify({ pageId: connection.pageId, since: Math.floor(Date.now() / 1000) });
      await tx.syncState.upsert({ where: { key: sinceKey(organizationId) }, create: { key: sinceKey(organizationId), cursor }, update: { cursor } });
    } else {
      await tx.syncState.deleteMany({ where: { key: sinceKey(organizationId) } });
    }
  });
}

/** One workspace: the leads created since its last sweep, filed. Returns how many were new. */
async function importNewLeads(organizationId: string): Promise<number> {
  const connection = await getMetaConnection(organizationId);
  if (!connection) return 0;
  const startedAt = Math.floor(Date.now() / 1000);
  const row = await db.syncState.findUnique({ where: { key: sinceKey(organizationId) } });
  let place: z.infer<typeof sinceSchema> | null = null;
  try { place = row ? sinceSchema.parse(JSON.parse(row.cursor)) : null; } catch { place = null; }
  if (!place || place.pageId !== connection.pageId) {
    const cursor = JSON.stringify({ pageId: connection.pageId, since: startedAt });
    await db.syncState.upsert({ where: { key: sinceKey(organizationId) }, create: { key: sinceKey(organizationId), cursor }, update: { cursor } });
    return 0;
  }

  const token = decryptSecret(connection.tokenBox);
  const forms: string[] = [];
  let formAfter: string | undefined;
  for (let i = 0; i < 5; i++) {
    const batch = z.object({ data: z.array(z.object({ id: metaId })), paging: pagingSchema }).parse(await metaGraph(`${connection.pageId}/leadgen_forms`, token, { fields: "id", limit: "100", ...(formAfter ? { after: formAfter } : {}) }));
    forms.push(...batch.data.map(f => f.id));
    formAfter = after(batch.paging);
    if (!formAfter) break;
  }
  const filtering = JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: place.since - OVERLAP_SECONDS }]);
  const leads: MetaLead[] = [];
  for (const formId of forms) {
    let leadAfter: string | undefined;
    for (let i = 0; i < 10; i++) {
      const batch = z.object({ data: z.array(metaLeadSchema), paging: pagingSchema }).parse(await metaGraph(`${formId}/leads`, token, { fields: "id,created_time,field_data", limit: "50", filtering, ...(leadAfter ? { after: leadAfter } : {}) }));
      leads.push(...batch.data);
      leadAfter = after(batch.paging);
      if (!leadAfter) break;
    }
  }

  const eventIds = leads.map(lead => `${organizationId}:${lead.id}`);
  const seen = new Set((await db.webhookEvent.findMany({ where: { provider: "META_LEADS", eventId: { in: eventIds } }, select: { eventId: true } })).map(e => e.eventId));
  const fresh = leads.filter(lead => !seen.has(`${organizationId}:${lead.id}`));
  // Over the plan's lead limit this throws and the place stays put: the leads come in once there is room.
  if (fresh.length) await enforcePlanLimit(organizationId, "leads", fresh.length);

  let imported = 0;
  await db.$transaction(async tx => {
    // Still on, still this Page: a disconnect or a switch-off that landed mid-sweep wins.
    const org = await tx.organization.findFirst({ where: { id: organizationId, deletedAt: null }, select: { metaSettingsJson: true } });
    const settings = parseMetaSettings(org?.metaSettingsJson);
    if (!org?.metaSettingsJson || !settings.autoCreate || (settings as { pageId?: string }).pageId !== connection.pageId) return;
    const touched = await tx.organization.updateMany({ where: { id: organizationId, metaSettingsJson: org.metaSettingsJson }, data: { metaSettingsJson: org.metaSettingsJson } });
    if (!touched.count) return;
    for (const lead of fresh) {
      const eventId = `${organizationId}:${lead.id}`;
      if (await tx.webhookEvent.findUnique({ where: { provider_eventId: { provider: "META_LEADS", eventId } } })) continue;
      const id = `meta_${crypto.createHash("sha256").update(eventId).digest("hex").slice(0, 40)}`;
      await tx.lead.create({ data: { id, organizationId, ...metaLeadFields(lead), source: "FACEBOOK", status: "NEW" } });
      await tx.webhookEvent.create({ data: { provider: "META_LEADS", eventId, type: `page:${connection.pageId}`, status: "PROCESSED", processedAt: new Date() } });
      imported++;
    }
    if (imported) await tx.activityEvent.create({ data: { organizationId, kind: "CREATED", summary: `Facebook: ${imported} new ${imported === 1 ? "lead" : "leads"} came in from ${connection.pageName || "your Page"}.` } });
    await tx.syncState.updateMany({ where: { key: sinceKey(organizationId) }, data: { cursor: JSON.stringify({ pageId: connection.pageId, since: startedAt }) } });
  }, { timeout: 20000 });
  return imported;
}

/** The cron's sweep: every workspace with the switch on, one after another, inside the time it is given. */
export async function sweepMetaAutoImport(budgetMs = 45_000) {
  if (!metaConfigured()) return { ok: true as const, workspaces: 0, imported: 0, failed: 0 };
  const until = Date.now() + budgetMs;
  const orgs = await db.organization.findMany({ where: { deletedAt: null, metaSettingsJson: { contains: '"autoCreate":true' } }, select: { id: true, metaSettingsJson: true } });
  let workspaces = 0, imported = 0, failed = 0;
  for (const org of orgs) {
    if (Date.now() > until) break;
    if (!parseMetaSettings(org.metaSettingsJson).autoCreate) continue;
    workspaces++;
    try { imported += await importNewLeads(org.id); }
    catch (error) {
      failed++;
      console.error("[meta-leads] sweep failed for", org.id, error instanceof Error ? error.message : "unknown error");
    }
  }
  return { ok: true as const, workspaces, imported, failed };
}
