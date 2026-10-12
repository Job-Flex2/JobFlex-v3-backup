// A JOB'S EXPENSES AND WHO MAY TOUCH THEM (stage A, 2026-09-30) — server.
//
// Owner's rules: a worker sends a receipt from their own dashboard or portal;
// it is SUBMITTED and counts nowhere until the owner or a manager approves
// it (never automatically) or rejects it with a reason. Reimbursement happens
// outside the app; the office only marks it. A worker may edit or delete
// their own receipt after sending — an edit leaves an "edited" mark — but
// not once it is approved. The office's own entries are approved at once.
//
// Every function takes a plain actor, so the session actions, the token
// route and the QA scripts share the one rule.

import { db } from "@/lib/db";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { isLimitedRole } from "@/lib/orgContext";
import { ExpensePaidBy, ExpenseStatus } from "@/lib/prismaEnums";
import { isPrivateJobFile } from "@/lib/media/privateStore";
import { deleteStoredUnlessReferenced } from "@/lib/media/ownedFiles";
import { IMAGE_DATA_URL } from "@/lib/safeHref";

export interface ExpenseActor {
  organizationId: string;
  userId: string;
  /** The membership role, or "WORKER_TOKEN" through the portal (a limited role). */
  role: string;
  /** The crew profile, when the actor has one (the portal always does). */
  workerId?: string | null;
  name?: string | null;
}

export type ExpenseAccess = "manager" | "worker";

const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

// ── JOB OR STOCK (stage D, 2026-09-30) ─────────────────────────────────────
// Every expense is money the company spent, once, the day it was spent — in
// the company's totals. What it bought decides the rest: a receipt FOR A JOB
// (purpose JOB, jobId) is also that job's cost; a purchase FOR STOCK (purpose
// STOCK, no job) is the warehouse's value and reaches a job only when stock is
// issued to it (lib/jobCost, at the movement's unit price) — never a second
// company expense.
export const EXPENSE_PURPOSE = { JOB: "JOB", STOCK: "STOCK" } as const;

/** A row of this company's, whether it hangs off a job or not. */
const ofOrg = (organizationId: string) => ({ OR: [{ organizationId }, { job: { organizationId } }] });
const withJob = { job: { select: { title: true, proposalId: true, clientId: true } } } as const;
/** What the trail calls the row's home: the job's title, or the stock. */
const homeOf = (ex: { job: { title: string } | null }) => ex.job?.title ?? "stock";

/** Once a stock purchase counts, its item's last price is what it cost per
 *  unit — the price stock issued to a job goes by from then on. */
async function stampStockCost(ex: { purpose: string; stockItemId: string | null; stockQty: number | null; amount: number }, organizationId: string) {
  if (ex.purpose !== EXPENSE_PURPOSE.STOCK || !ex.stockItemId || !ex.stockQty || ex.stockQty <= 0) return;
  const unit = Math.round((ex.amount / ex.stockQty) * 10000) / 10000;
  await db.inventoryItem.updateMany({ where: { id: ex.stockItemId, organizationId }, data: { lastCost: unit } });
}

// ── THE RECEIPT'S FILE (security audit 1.1, 2026-10-12) ──────────────────
// A receipt picture is a file in the job's own receipts folder in the store,
// or an inline picture — the rule the crew's upload routes already kept. Any
// other address (another company's stored file decoded out of a read link)
// is refused here, so every door — the dashboard's actions, the portal's
// routes, the QA — meets the same rule. A purchase for stock has no job, so
// only an inline picture.

/** True when `url` may be stored as this row's receipt. */
export function receiptFileAllowed(url: string, jobId: string | null): boolean {
  if (IMAGE_DATA_URL.test(url)) return true;
  return !!jobId && isPrivateJobFile(url, "receipts", jobId);
}

const RECEIPT_REFUSED = "That receipt file is not in this job's folder — upload the picture again.";

/** May this actor see and add to this job's expenses? A manager: any job of
 *  the company. A limited role: only a job they hold a live assignment on. */
export async function expenseJobAccess(actor: ExpenseActor, jobId: string): Promise<{ access: ExpenseAccess; job: { id: string; title: string; proposalId: string | null; clientId: string | null } } | null> {
  const job = await db.job.findFirst({ where: { id: jobId, organizationId: actor.organizationId }, select: { id: true, title: true, proposalId: true, clientId: true } });
  if (!job) return null;
  if (!isLimitedRole(actor.role) && actor.role !== "WORKER_TOKEN") return { access: "manager", job };
  const assigned = await db.jobAssignment.findFirst({
    where: { jobId, status: { not: "DECLINED" }, ...(actor.workerId ? { workerId: actor.workerId } : { worker: { userId: actor.userId } }) },
    select: { id: true },
  });
  return assigned ? { access: "worker", job } : null;
}

export interface NewExpense {
  jobId: string;
  category: string;
  amount: number;
  note?: string | null;
  receiptUrl?: string | null;
  ocrJson?: string | null;
  vendor?: string | null;
  spentAt?: Date | null;
  paidBy?: "WORKER" | "COMPANY" | null;
  via: "worker-portal" | "dashboard";
}

/** Create one. The office's row is APPROVED at once; a worker's is SUBMITTED. */
export async function createJobExpense(actor: ExpenseActor, input: NewExpense) {
  const gate = await expenseJobAccess(actor, input.jobId);
  if (!gate) throw new Error("Not found");
  if (input.receiptUrl && !receiptFileAllowed(input.receiptUrl, input.jobId)) throw new Error(RECEIPT_REFUSED);
  const manager = gate.access === "manager";
  const amount = Number.isFinite(input.amount) ? Math.min(Math.max(input.amount, 0), 1_000_000) : 0;
  const category = (input.category?.trim() || "Materials").slice(0, 60);
  const paidBy = input.paidBy ?? (manager ? ExpensePaidBy.COMPANY : ExpensePaidBy.WORKER);
  const now = new Date();
  const row = await db.jobExpense.create({
    data: {
      jobId: input.jobId,
      organizationId: actor.organizationId,
      submittedById: actor.userId,
      category,
      amount,
      note: input.note?.trim().slice(0, 2000) || null,
      receiptUrl: input.receiptUrl ?? null,
      ocrJson: input.ocrJson ?? null,
      vendor: input.vendor?.trim().slice(0, 120) || null,
      spentAt: input.spentAt ?? now,
      paidBy,
      status: manager ? ExpenseStatus.APPROVED : ExpenseStatus.SUBMITTED,
      reviewedById: manager ? actor.userId : null,
      reviewedAt: manager ? now : null,
    },
  });
  await logActivity({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    kind: TRAIL_KINDS.EXPENSE,
    summary: manager
      ? `Added a ${money(amount)} expense to ${gate.job.title} — ${category}${input.receiptUrl ? " (receipt attached)" : ""}`
      : `Sent a ${money(amount)} receipt for ${gate.job.title} — ${category}, on review`,
    proposalId: gate.job.proposalId,
    clientId: gate.job.clientId,
    meta: { jobId: input.jobId, expenseId: row.id, amount, category, status: row.status, paidBy, via: input.via },
  });
  return row;
}

export interface NewStockPurchase {
  category: string;
  amount: number;
  note?: string | null;
  receiptUrl?: string | null;
  vendor?: string | null;
  spentAt?: Date | null;
  paidBy?: "WORKER" | "COMPANY" | null;
  /** The warehouse item it bought, and how many — sets the item's lastCost. */
  stockItemId?: string | null;
  stockQty?: number | null;
}

/** A purchase for the warehouse: the office's, APPROVED at once, no job. */
export async function createStockPurchase(actor: ExpenseActor, input: NewStockPurchase) {
  if (isLimitedRole(actor.role) || actor.role === "WORKER_TOKEN") throw new Error("Manager access required");
  if (input.receiptUrl && !receiptFileAllowed(input.receiptUrl, null)) throw new Error(RECEIPT_REFUSED);
  const amount = Number.isFinite(input.amount) ? Math.min(Math.max(input.amount, 0), 1_000_000) : 0;
  const category = (input.category?.trim() || "Materials").slice(0, 60);
  let stockItemId: string | null = null;
  if (input.stockItemId) {
    const item = await db.inventoryItem.findFirst({ where: { id: input.stockItemId, organizationId: actor.organizationId }, select: { id: true } });
    if (!item) throw new Error("That stock item is not in this company's warehouse.");
    stockItemId = item.id;
  }
  const qty = input.stockQty && Number.isFinite(input.stockQty) && input.stockQty > 0 ? input.stockQty : null;
  const now = new Date();
  const row = await db.jobExpense.create({
    data: {
      jobId: null,
      purpose: EXPENSE_PURPOSE.STOCK,
      stockItemId,
      stockQty: stockItemId ? qty : null,
      organizationId: actor.organizationId,
      submittedById: actor.userId,
      category,
      amount,
      note: input.note?.trim().slice(0, 2000) || null,
      receiptUrl: input.receiptUrl ?? null,
      vendor: input.vendor?.trim().slice(0, 120) || null,
      spentAt: input.spentAt ?? now,
      paidBy: input.paidBy ?? ExpensePaidBy.COMPANY,
      status: ExpenseStatus.APPROVED,
      reviewedById: actor.userId,
      reviewedAt: now,
    },
  });
  await stampStockCost(row, actor.organizationId);
  await logActivity({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    kind: TRAIL_KINDS.EXPENSE,
    summary: `Added a ${money(amount)} purchase for stock — ${category}`,
    meta: { expenseId: row.id, amount, category, status: row.status, purpose: EXPENSE_PURPOSE.STOCK, stockItemId, via: "dashboard" },
  });
  return row;
}

export type ReviewDecision = "approve" | "reject" | "reimburse";

/** Approve, reject (with a reason) or mark reimbursed — the office only. The
 *  transitions are guarded in the query, so two reviewers cannot both win. */
export async function reviewJobExpense(actor: ExpenseActor, id: string, decision: ReviewDecision, reason?: string | null) {
  if (isLimitedRole(actor.role) || actor.role === "WORKER_TOKEN") throw new Error("Manager access required");
  const ex = await db.jobExpense.findFirst({ where: { id, ...ofOrg(actor.organizationId) }, include: withJob });
  if (!ex) throw new Error("Not found");
  const now = new Date();
  let r: { count: number };
  let summary: string;
  if (decision === "approve") {
    r = await db.jobExpense.updateMany({ where: { id, status: { in: [ExpenseStatus.SUBMITTED, ExpenseStatus.REJECTED] } }, data: { status: ExpenseStatus.APPROVED, reviewedById: actor.userId, reviewedAt: now, rejectReason: null } });
    summary = `Approved a ${money(ex.amount)} receipt on ${homeOf(ex)} — ${ex.category}`;
  } else if (decision === "reject") {
    const why = (reason ?? "").trim().slice(0, 500);
    if (!why) throw new Error("Give a reason for rejecting it.");
    r = await db.jobExpense.updateMany({ where: { id, status: { in: [ExpenseStatus.SUBMITTED, ExpenseStatus.APPROVED] } }, data: { status: ExpenseStatus.REJECTED, reviewedById: actor.userId, reviewedAt: now, rejectReason: why } });
    summary = `Rejected a ${money(ex.amount)} receipt on ${homeOf(ex)} — ${why}`;
  } else {
    if (ex.paidBy !== ExpensePaidBy.WORKER) throw new Error("Only a receipt the worker paid for can be reimbursed.");
    r = await db.jobExpense.updateMany({ where: { id, status: ExpenseStatus.APPROVED }, data: { status: ExpenseStatus.REIMBURSED, reimbursedAt: now } });
    summary = `Marked a ${money(ex.amount)} receipt on ${homeOf(ex)} reimbursed`;
  }
  if (r.count === 0) throw new Error("That expense cannot be moved from where it stands.");
  if (decision === "approve") await stampStockCost(ex, actor.organizationId);
  await logActivity({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    kind: TRAIL_KINDS.EXPENSE,
    summary,
    proposalId: ex.job?.proposalId ?? null,
    clientId: ex.job?.clientId ?? null,
    meta: { jobId: ex.jobId, expenseId: id, amount: ex.amount, category: ex.category, decision, reason: reason ?? undefined },
  });
  return db.jobExpense.findUniqueOrThrow({ where: { id } });
}

export interface ExpensePatch {
  category?: string;
  amount?: number;
  note?: string | null;
  vendor?: string | null;
  spentAt?: Date | null;
  paidBy?: "WORKER" | "COMPANY";
  receiptUrl?: string | null;
}

/** Edit one. The office edits any; a worker edits their own while it is
 *  SUBMITTED or REJECTED (a rejected one goes back on review). The row keeps
 *  an "edited" mark. */
export async function editJobExpense(actor: ExpenseActor, id: string, patch: ExpensePatch) {
  const ex = await db.jobExpense.findFirst({ where: { id, ...ofOrg(actor.organizationId) }, include: withJob });
  if (!ex) throw new Error("Not found");
  const manager = !isLimitedRole(actor.role) && actor.role !== "WORKER_TOKEN";
  if (!manager) {
    if (ex.submittedById !== actor.userId) throw new Error("You can only edit your own receipts");
    if (ex.status !== ExpenseStatus.SUBMITTED && ex.status !== ExpenseStatus.REJECTED) throw new Error("An approved receipt can no longer be edited");
  }
  // The row's own receipt may be sent back as it is; a new one follows the rule.
  if (patch.receiptUrl && patch.receiptUrl !== ex.receiptUrl && !receiptFileAllowed(patch.receiptUrl, ex.jobId)) throw new Error(RECEIPT_REFUSED);
  const data: Record<string, unknown> = { editedAt: new Date() };
  if (patch.category !== undefined) data.category = patch.category.trim().slice(0, 60) || ex.category;
  if (patch.amount !== undefined) data.amount = Number.isFinite(patch.amount) ? Math.min(Math.max(patch.amount, 0), 1_000_000) : ex.amount;
  if (patch.note !== undefined) data.note = patch.note?.trim().slice(0, 2000) || null;
  if (patch.vendor !== undefined) data.vendor = patch.vendor?.trim().slice(0, 120) || null;
  if (patch.spentAt !== undefined) data.spentAt = patch.spentAt;
  if (patch.paidBy !== undefined) data.paidBy = patch.paidBy;
  if (patch.receiptUrl !== undefined) data.receiptUrl = patch.receiptUrl;
  // A worker's correction of a rejected receipt puts it back on review.
  if (!manager && ex.status === ExpenseStatus.REJECTED) Object.assign(data, { status: ExpenseStatus.SUBMITTED, rejectReason: null, reviewedById: null, reviewedAt: null });
  const row = await db.jobExpense.update({ where: { id }, data });
  // An approved stock purchase whose amount moved re-prices its item.
  if (manager && row.status === ExpenseStatus.APPROVED) await stampStockCost(row, actor.organizationId);
  // A replaced receipt picture leaves the store with the edit (stage B).
  // Not while another row still names the same file (lib/media/ownedFiles).
  if (patch.receiptUrl !== undefined && ex.receiptUrl && ex.receiptUrl !== patch.receiptUrl) await deleteStoredUnlessReferenced(ex.receiptUrl);
  await logActivity({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    kind: TRAIL_KINDS.EXPENSE,
    summary: `Edited a ${money(row.amount)} expense on ${homeOf(ex)} — ${row.category}`,
    proposalId: ex.job?.proposalId ?? null,
    clientId: ex.job?.clientId ?? null,
    meta: { jobId: ex.jobId, expenseId: id, amount: row.amount, category: row.category, edited: true },
  });
  return row;
}

/** Delete one. The office deletes any; a worker their own, never once approved. */
export async function deleteJobExpense(actor: ExpenseActor, id: string) {
  const ex = await db.jobExpense.findFirst({ where: { id, ...ofOrg(actor.organizationId) }, include: withJob });
  if (!ex) throw new Error("Not found");
  const manager = !isLimitedRole(actor.role) && actor.role !== "WORKER_TOKEN";
  if (!manager) {
    if (ex.submittedById !== actor.userId) throw new Error("You can only delete your own receipts");
    if (ex.status === ExpenseStatus.APPROVED || ex.status === ExpenseStatus.REIMBURSED) throw new Error("An approved receipt can no longer be deleted");
  }
  await db.jobExpense.delete({ where: { id } });
  await deleteStoredUnlessReferenced(ex.receiptUrl);
  await logActivity({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    kind: TRAIL_KINDS.EXPENSE,
    summary: `Deleted a ${money(ex.amount)} expense from ${homeOf(ex)} — ${ex.category}`,
    proposalId: ex.job?.proposalId ?? null,
    clientId: ex.job?.clientId ?? null,
    meta: { jobId: ex.jobId, expenseId: id, amount: ex.amount, category: ex.category, deleted: true },
  });
  return { jobId: ex.jobId };
}

/** A job's expenses for this actor: the office reads any job's; a worker
 *  only a job they are on (the job's receipts, as the portal already shows). */
export async function listJobExpensesFor(actor: ExpenseActor, jobId: string) {
  const gate = await expenseJobAccess(actor, jobId);
  if (!gate) return null;
  return db.jobExpense.findMany({ where: { jobId }, orderBy: { createdAt: "desc" } });
}

/** The office's batch: the same decision on several receipts, each through
 *  the one rule above. A receipt that cannot move is reported, not fatal. */
export async function reviewJobExpenses(actor: ExpenseActor, ids: string[], decision: ReviewDecision, reason?: string | null) {
  const done: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const id of [...new Set(ids)].slice(0, 200)) {
    try {
      await reviewJobExpense(actor, id, decision, reason);
      done.push(id);
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : "Could not review it." });
    }
  }
  return { done, failed };
}
