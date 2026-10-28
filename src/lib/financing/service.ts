// WISETACK FINANCING — the service: what the Settings actions, the proposal editor, the client's page, the webhook
// and the reconcile call. Wisetack answers through ./provider; the states and their rules are ./state; where it is
// kept is ./store. Spec: docs/superpowers/specs/2026-10-28-wisetack-financing-design.md

import { db } from "@/lib/db";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { afterResponse } from "@/lib/server-events";
import { textOffice } from "@/lib/sms/send";
import { appBaseUrl } from "@/lib/appUrl";
import { OWNER_ROLE } from "@/lib/orgContext";
import { getProvider, type MerchantSnapshot } from "./provider";
import { merchantPrefill, readinessFacts, type PrefillOrg, type PrefillOwner } from "./prefill";
import { orgLetIn, readiness, type OrgFinancing } from "./state";
import { readOrgFinancing, readSwitch, writeOrgFinancing } from "./store";

export const SETTINGS_HREF = "/dashboard/settings?pane=payments&sub=financing";

/** Whether this contractor sees financing at all, and their record. */
export async function orgFinancingView(orgId: string): Promise<{ letIn: boolean; available: boolean; rec: OrgFinancing }> {
  const [sw, rec] = await Promise.all([readSwitch(), readOrgFinancing(orgId)]);
  return { letIn: orgLetIn(sw, orgId), available: getProvider() !== null, rec };
}

const ORG_SELECT = { id: true, name: true, phone: true, website: true, address: true, billingEmail: true, tradeTypesJson: true } as const;

async function orgAndOwner(orgId: string): Promise<{ org: PrefillOrg; owner: PrefillOwner } | null> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: ORG_SELECT });
  if (!org) return null;
  const seat = await db.membership.findFirst({ where: { organizationId: orgId, role: OWNER_ROLE }, select: { user: { select: { name: true, email: true } } } });
  return { org, owner: seat?.user ? { name: seat.user.name ?? null, email: seat.user.email ?? null } : null };
}

/** The readiness list for the Settings tab. */
export async function financingReadiness(orgId: string, rec: OrgFinancing) {
  const found = await orgAndOwner(orgId);
  if (!found) return readiness({ name: null, phone: null, email: null, address: null, website: null, trade: null, yearStarted: rec.yearStarted });
  return readiness(readinessFacts(found.org, found.owner, rec));
}

/** A text and a bell row to the office. The bell opens `href`. */
export async function notifyFinancing(orgId: string, line: string, opts: { kind: string; href: string; proposalId?: string | null; clientId?: string | null }): Promise<void> {
  await logActivity({ organizationId: orgId, actorId: null, kind: opts.kind, summary: line, proposalId: opts.proposalId ?? null, clientId: opts.clientId ?? null, meta: { href: opts.href } });
  afterResponse(async () => {
    await textOffice(orgId, "financing", line);
  });
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const NOT_OPEN = "Financing isn't open for your account yet.";
const NO_ANSWER = "Wisetack didn't answer — try again in a minute.";

export async function startApplication(orgId: string, actorId: string): Promise<Result<{ url: string }>> {
  const provider = getProvider();
  const view = await orgFinancingView(orgId);
  if (!provider || !view.letIn) return { ok: false, error: NOT_OPEN };
  if (view.rec.state === "approved") return { ok: false, error: "You're already approved." };
  // An application that is open goes back to the same Wisetack page.
  if ((view.rec.state === "started" || view.rec.state === "needs_info") && view.rec.applyUrl) return { ok: true, url: view.rec.applyUrl };
  const found = await orgAndOwner(orgId);
  if (!found) return { ok: false, error: NOT_OPEN };
  const returnUrl = `${await appBaseUrl()}${SETTINGS_HREF}&financing=back`;
  try {
    const { merchantRef, url } = await provider.startMerchant(merchantPrefill(found.org, found.owner, view.rec, returnUrl));
    const now = new Date().toISOString();
    await writeOrgFinancing(orgId, { ...view.rec, merchantRef, state: "started", appliedAt: now, decidedAt: null, needs: [], note: null, applyUrl: url, checkedAt: now });
    await logActivity({ organizationId: orgId, actorId, kind: TRAIL_KINDS.SETTINGS, summary: "Started a Wisetack application for monthly payments" });
    return { ok: true, url };
  } catch {
    return { ok: false, error: NO_ANSWER };
  }
}

export async function linkExisting(orgId: string, email: string, actorId: string): Promise<Result<{ url: string | null; rec: OrgFinancing }>> {
  const provider = getProvider();
  const view = await orgFinancingView(orgId);
  if (!provider || !view.letIn) return { ok: false, error: NOT_OPEN };
  const clean = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(clean)) return { ok: false, error: "Type the email you use for Wisetack." };
  try {
    const r = await provider.linkMerchant({ email: clean, reference: orgId, returnUrl: `${await appBaseUrl()}${SETTINGS_HREF}&financing=back` });
    if ("error" in r) return { ok: false, error: "Wisetack doesn't have an account with that email. Use the email on your Wisetack account, or apply." };
    await writeOrgFinancing(orgId, { ...view.rec, merchantRef: r.merchantRef, state: "review", appliedAt: new Date().toISOString(), applyUrl: r.url });
    await logActivity({ organizationId: orgId, actorId, kind: TRAIL_KINDS.SETTINGS, summary: "Linked the company's Wisetack account" });
    const rec = await refreshMerchant(orgId);
    return { ok: true, url: r.url, rec };
  } catch {
    return { ok: false, error: NO_ANSWER };
  }
}

/** Ask Wisetack where the application stands. */
export async function refreshMerchant(orgId: string): Promise<OrgFinancing> {
  const provider = getProvider();
  const rec = await readOrgFinancing(orgId);
  if (!provider || !rec.merchantRef) return rec;
  return applyMerchantSnapshot(orgId, await provider.merchant(rec.merchantRef));
}

const DECIDED_WORDS: Partial<Record<OrgFinancing["state"], string>> = {
  approved: "Wisetack approved your company for monthly payments — turn it on for any proposal.",
  needs_info: "Wisetack needs a little more for your financing application — finish it in Settings → Payments → Financing.",
  declined: "Wisetack didn't approve your financing application — their email says why.",
  paused: "Wisetack paused financing on your account.",
};

export async function applyMerchantSnapshot(orgId: string, s: MerchantSnapshot): Promise<OrgFinancing> {
  const before = await readOrgFinancing(orgId);
  const now = new Date().toISOString();
  const changed = before.state !== s.state;
  const after: OrgFinancing = {
    ...before,
    state: s.state,
    needs: s.needs,
    note: s.note,
    minMinor: s.minMinor ?? before.minMinor,
    maxMinor: s.maxMinor ?? before.maxMinor,
    feeBps: s.feeBps ?? before.feeBps,
    prequalUrl: s.prequalUrl ?? before.prequalUrl,
    decidedAt: changed && (s.state === "approved" || s.state === "declined") ? now : before.decidedAt,
    checkedAt: now,
  };
  await writeOrgFinancing(orgId, after);
  const words = DECIDED_WORDS[s.state];
  if (changed && words) await notifyFinancing(orgId, words, { kind: "FINANCING_ACCOUNT", href: SETTINGS_HREF });
  return after;
}

export async function setDefault(orgId: string, on: boolean): Promise<OrgFinancing> {
  const rec = { ...(await readOrgFinancing(orgId)), offerByDefault: on };
  await writeOrgFinancing(orgId, rec);
  return rec;
}

export async function setYearStarted(orgId: string, year: number | null): Promise<OrgFinancing> {
  const ok = year !== null && Number.isInteger(year) && year >= 1900 && year <= new Date().getFullYear();
  const rec = { ...(await readOrgFinancing(orgId)), yearStarted: ok ? year : null };
  await writeOrgFinancing(orgId, rec);
  return rec;
}
