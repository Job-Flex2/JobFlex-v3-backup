"use server";
// Wisetack financing — the contractor's own actions (Settings → Payments → Financing). Managers only: applying binds
// the company to Wisetack's merchant terms. lib/financing/service does the work.
import { revalidatePath } from "next/cache";
import { requireManager, requireProposalStaff } from "@/lib/orgContext";
import { assertWriteAllowed } from "@/lib/trialLock";
import { linkExisting, loadEditorFinancing, orgFinancingView, refreshMerchant, sendFinancingLinkFor, setDefault, setProposalOffer, setYearStarted, startApplication } from "@/lib/financing/service";
import type { EditorFinancing } from "@/lib/financing/view";
import { applyWisetackAnswer } from "@/lib/financing/desk";
import type { OrgFinancing } from "@/lib/financing/state";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const NOT_OPEN = "Financing isn't open for your account yet.";

// A locked trial applies for nothing and sends nothing. The database client's own guard lets SyncState and
// ActivityEvent through (lib/trialLock) — and the application reaches Wisetack before any write — so ask it here.
const LOCK_CHECK = ["Organization", "update"] as const;

export async function applyForFinancing(): Promise<Result<{ url: string }>> {
  const { organizationId, user } = await requireManager();
  await assertWriteAllowed(...LOCK_CHECK);
  const r = await startApplication(organizationId, user.id);
  revalidatePath("/dashboard/settings");
  return r;
}

export async function linkWisetackAccount(email: string): Promise<Result<{ url: string | null; rec: OrgFinancing }>> {
  const { organizationId, user } = await requireManager();
  await assertWriteAllowed(...LOCK_CHECK);
  const r = await linkExisting(organizationId, String(email ?? ""), user.id);
  revalidatePath("/dashboard/settings");
  return r;
}

export async function checkFinancingStatus(): Promise<Result<{ rec: OrgFinancing }>> {
  const { organizationId } = await requireManager();
  const view = await orgFinancingView(organizationId);
  if (!view.letIn || !view.available) return { ok: false, error: NOT_OPEN };
  try {
    return { ok: true, rec: await refreshMerchant(organizationId) };
  } catch {
    return { ok: false, error: "Wisetack didn't answer — try again in a minute." };
  }
}

export async function setFinancingDefault(on: boolean): Promise<Result<{ rec: OrgFinancing }>> {
  const { organizationId } = await requireManager();
  const view = await orgFinancingView(organizationId);
  if (!view.letIn) return { ok: false, error: NOT_OPEN };
  const rec = await setDefault(organizationId, on === true);
  revalidatePath("/dashboard/settings");
  return { ok: true, rec };
}

export async function setFinancingYearStarted(year: number | null): Promise<Result<{ rec: OrgFinancing }>> {
  const { organizationId } = await requireManager();
  const view = await orgFinancingView(organizationId);
  if (!view.letIn) return { ok: false, error: NOT_OPEN };
  return { ok: true, rec: await setYearStarted(organizationId, typeof year === "number" ? year : null) };
}

/** The editor's "Offer monthly payments" row for a saved proposal (null = no row). */
export async function getProposalFinancing(proposalId: string): Promise<EditorFinancing | null> {
  const { organizationId, proposalScope } = await requireProposalStaff();
  if (typeof proposalId !== "string" || !proposalId) return null;
  return loadEditorFinancing(organizationId, proposalId, proposalScope);
}

/** Per proposal: offer monthly payments or not (null = follow the company's default). */
export async function setProposalFinancing(proposalId: string, on: boolean | null): Promise<Result<{ row: EditorFinancing }>> {
  const { organizationId, proposalScope } = await requireProposalStaff();
  const row = await setProposalOffer(organizationId, String(proposalId ?? ""), on === null ? null : on === true, proposalScope);
  if (!row) return { ok: false, error: "That proposal wasn't found." };
  revalidatePath("/dashboard/proposals");
  return { ok: true, row };
}

/** The proposals row: send the client the proposal opened at Pay over time (the office's, like Remind). */
export async function sendFinancingLink(proposalId: string, via: "text" | "email" | "auto" = "auto"): Promise<Result<{ via: "text" | "email" }>> {
  const { organizationId, user } = await requireManager();
  await assertWriteAllowed(...LOCK_CHECK);
  const how = via === "text" || via === "email" ? via : "auto";
  return sendFinancingLinkFor(organizationId, String(proposalId ?? ""), how, user.id);
}

/** Settings → Financing: the AI desk's financing answer becomes the Wisetack line (the owner pressed it). */
export async function setWisetackDeskAnswer(): Promise<Result> {
  const { organizationId } = await requireManager();
  const view = await orgFinancingView(organizationId);
  if (!view.letIn || view.rec.state !== "approved") return { ok: false, error: "Financing isn't approved for your account yet." };
  if (!(await applyWisetackAnswer(organizationId))) return { ok: false, error: "Set up the AI desk first." };
  revalidatePath("/dashboard/settings");
  return { ok: true };
}
