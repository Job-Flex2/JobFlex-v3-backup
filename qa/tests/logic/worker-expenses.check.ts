// WORKER EXPENSES (stage A, 2026-09-30): a worker's receipt is SUBMITTED and
// in no total until the office approves it; rejected with a reason;
// reimbursed when the money changed hands; a worker edits (edited mark) or
// deletes their own while it is on review, never once approved; only what
// counts is in the job's money and in Financials, and the two agree to the
// cent. Runs in QA Co on the local database.
//
// Stage D (2026-09-30) adds: the rule "job or stock" — a purchase for stock is
// a company expense once and the warehouse's value, never a job's cost until
// the stock is issued (PICKED / USED at the movement's price, less RETURNED),
// and the issue is never a second company expense; the review queue and its
// batch; what is owed to each worker; the job's cost on its page equals its
// row in Financials to the cent; QA Co's totals from before are unchanged.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/worker-expenses.check.ts
import "../_lib/_server-only";
import { db, makeCrewWorld } from "../_lib/_crewWorld";
import { createJobExpense, createStockPurchase, deleteJobExpense, editJobExpense, expenseJobAccess, listJobExpensesFor, reviewJobExpense, reviewJobExpenses } from "../../../src/lib/jobExpenses";
import { jobCostOf } from "../../../src/lib/jobCost";
import { getOfficeMoney } from "../../../src/lib/officeMoney";
import { countedAmounts, expenseDate, expenseTotals } from "../../../src/lib/expenseTotals";
import { jobMoney } from "../../../src/lib/jobCosting";
import { getFinancialsRollup, getMonthlyRollup } from "../../../src/actions/financials";

let passes = 0;
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const head = (s: string) => console.log(`\n── ${s}`);
const throws = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); } };
const c2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  head("0 · pure totals");
  const t = expenseTotals([
    { amount: 10.1, status: "APPROVED", paidBy: "WORKER" }, { amount: 20.2, status: "REIMBURSED", paidBy: "WORKER" }, { amount: 5.55, status: "SUBMITTED" }, { amount: 7, status: "REJECTED" }, { amount: 1, status: null },
  ]);
  ok("APPROVED + REIMBURSED (+ a row from before statuses) count; SUBMITTED apart; REJECTED nothing; owed = APPROVED by a worker", t.counted === 31.3 && t.countedCount === 3 && t.pending === 5.55 && t.pendingCount === 1 && t.rejected === 7 && t.owedToWorkers === 10.1, JSON.stringify(t));
  ok("the date a total goes by is spentAt, else createdAt", expenseDate({ spentAt: new Date("2026-09-02"), createdAt: new Date("2026-09-20") }).toISOString().startsWith("2026-09-02") && expenseDate({ spentAt: null, createdAt: new Date("2026-09-20") }).toISOString().startsWith("2026-09-20"));

  const w = await makeCrewWorld("exp");
  const [A, B] = w.workers;
  const worker = (x: typeof A) => ({ organizationId: w.orgId, userId: x.userId, role: "INSTALLER", workerId: x.workerId, name: x.name });
  const portal = (x: typeof A) => ({ organizationId: w.orgId, userId: x.userId, role: "WORKER_TOKEN", workerId: x.workerId, name: x.name });
  const manager = { organizationId: w.orgId, userId: w.managerUserId, role: "MANAGER", name: "QA Manager" };
  const owner = { organizationId: w.orgId, userId: w.ownerUserId, role: "OWNER", name: "QA Owner" };
  const stockRows: string[] = [];
  const stockItems: string[] = [];
  const monthKeyNow = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
  // QA Co's month and 30 days BEFORE this check writes anything: the stage-D
  // queries (a company's rows with or without a job) must read the same
  // figures as the stage-A ones (rows through a job) while no stock purchase
  // exists — the only change stage A already made was adding ProjectExpense.
  const before = { month: (await getMonthlyRollup(w.orgId, 12)).find((b) => b.key === monthKeyNow())?.expenses ?? 0, rollup: await getFinancialsRollup(w.orgId) };
  try {
    head("0b · QA Co's totals from before are unchanged");
    {
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const [jobRows, projRows, paidCrew, stock] = await Promise.all([
        db.jobExpense.findMany({ where: { job: { organizationId: w.orgId }, status: { in: ["APPROVED", "REIMBURSED"] } }, select: { amount: true, spentAt: true, createdAt: true } }),
        db.projectExpense.findMany({ where: { project: { organizationId: w.orgId }, spentAt: { gte: monthStart } }, select: { amount: true } }),
        db.jobAssignment.findMany({ where: { job: { organizationId: w.orgId }, paidAt: { gte: monthStart } }, select: { pay: true } }),
        db.jobExpense.count({ where: { organizationId: w.orgId, jobId: null } }),
      ]);
      const stageA = c2(jobRows.filter((r) => expenseDate(r) >= monthStart).reduce((a, r) => a + r.amount, 0) + projRows.reduce((a, r) => a + r.amount, 0) + paidCrew.reduce((a, r) => a + r.pay, 0));
      ok("with no stock purchase in QA Co, this month's expenses read exactly as stage A computed them", stock > 0 || before.month === stageA, `${before.month} vs ${stageA}${stock ? ` (${stock} stock rows present)` : ""}`);
    }

    head("1 · who may touch a job's expenses");
    ok("the manager role is spelled MANAGER in Membership.role", (await db.membership.findFirst({ where: { userId: w.managerUserId, organizationId: w.orgId } }))?.role === "MANAGER");
    ok("a manager reaches any job; an assigned worker their job; an outsider nothing", (await expenseJobAccess(manager, w.jobId))?.access === "manager" && (await expenseJobAccess(worker(A), w.jobId))?.access === "worker" && (await expenseJobAccess(portal(B), w.jobId))?.access === "worker" && (await expenseJobAccess(worker(w.outsider), w.jobId)) === null);
    ok("a worker lists only a job they are on", (await listJobExpensesFor(worker(w.outsider), w.jobId)) === null && Array.isArray(await listJobExpensesFor(worker(A), w.jobId)));

    head("2 · statuses");
    const e1 = await createJobExpense(portal(A), { jobId: w.jobId, category: "Materials", amount: 120.55, note: "Screws", vendor: "Home Depot", via: "worker-portal" });
    ok("a worker's receipt is SUBMITTED, paid by the worker, dated today, with the org and who sent it", e1.status === "SUBMITTED" && e1.paidBy === "WORKER" && e1.organizationId === w.orgId && e1.submittedById === A.userId && !!e1.spentAt && e1.vendor === "Home Depot", JSON.stringify({ status: e1.status, paidBy: e1.paidBy }));
    const e2 = await createJobExpense(manager, { jobId: w.jobId, category: "Fuel", amount: 40, via: "dashboard" });
    ok("the office's row is APPROVED at once, paid by the company, reviewed by them", e2.status === "APPROVED" && e2.paidBy === "COMPANY" && e2.reviewedById === w.managerUserId && !!e2.reviewedAt);
    ok("a worker cannot approve", (await throws(() => reviewJobExpense(worker(B), e1.id, "approve"))) !== null);
    ok("rejecting needs a reason", (await throws(() => reviewJobExpense(manager, e1.id, "reject", "  "))) !== null);
    const rej = await reviewJobExpense(owner, e1.id, "reject", "Not this job's screws");
    ok("the owner rejects with a reason", rej.status === "REJECTED" && rej.rejectReason === "Not this job's screws" && rej.reviewedById === w.ownerUserId);
    const edited = await editJobExpense(worker(A), e1.id, { amount: 98.5, note: "Screws — the right job" });
    ok("the worker's correction goes back on review with an edited mark", edited.status === "SUBMITTED" && edited.amount === 98.5 && !!edited.editedAt && edited.rejectReason === null);
    ok("another worker cannot edit it", (await throws(() => editJobExpense(worker(B), e1.id, { amount: 1 }))) !== null);
    const appr = await reviewJobExpense(manager, e1.id, "approve");
    ok("the manager approves", appr.status === "APPROVED" && appr.reviewedById === w.managerUserId);
    ok("a worker cannot edit or delete an approved receipt", (await throws(() => editJobExpense(worker(A), e1.id, { amount: 1 }))) !== null && (await throws(() => deleteJobExpense(worker(A), e1.id))) !== null);
    ok("a company-paid row cannot be reimbursed", (await throws(() => reviewJobExpense(manager, e2.id, "reimburse"))) !== null);
    const reimb = await reviewJobExpense(owner, e1.id, "reimburse");
    ok("the owner marks the worker's approved receipt reimbursed", reimb.status === "REIMBURSED" && !!reimb.reimbursedAt);
    ok("the trail names every step", (await db.activityEvent.count({ where: { organizationId: w.orgId, kind: "EXPENSE", meta: { contains: `"expenseId":"${e1.id}"` } } })) >= 5);

    head("3 · a worker's own SUBMITTED receipt: editable, deletable");
    const e3 = await createJobExpense(worker(B), { jobId: w.jobId, category: "Tools", amount: 15, via: "dashboard" });
    const e3b = await editJobExpense(worker(B), e3.id, { amount: 16, vendor: "Lowe's" });
    ok("B edits their own on-review receipt: edited mark, still on review", e3b.editedAt !== null && e3b.status === "SUBMITTED" && e3b.amount === 16 && e3b.vendor === "Lowe's");
    ok("A cannot delete B's", (await throws(() => deleteJobExpense(worker(A), e3.id))) !== null);
    await deleteJobExpense(worker(B), e3.id);
    ok("B deletes their own", (await db.jobExpense.findUnique({ where: { id: e3.id } })) === null);

    head("4 · the totals: the job's figure is its share of Financials, to the cent");
    const e4 = await createJobExpense(portal(B), { jobId: w.jobId, category: "Materials", amount: 33.33, via: "worker-portal" }); // on review, never counted
    const e5 = await createJobExpense(manager, { jobId: w.jobId, category: "Permits", amount: 250.01, spentAt: new Date(), via: "dashboard" });
    const rows = await db.jobExpense.findMany({ where: { jobId: w.jobId } });
    const jobFig = jobMoney({ contract: 1000, collected: 0, lines: [], crewPay: [], expenses: countedAmounts(rows), pendingExpenses: rows.filter((r) => r.status === "SUBMITTED").map((r) => r.amount) });
    ok("the job page counts APPROVED + REIMBURSED only and shows the on-review figure apart", jobFig.expenses === c2(98.5 + 40 + 250.01) && jobFig.expensesPending === 33.33 && jobFig.cost === jobFig.expenses, JSON.stringify({ expenses: jobFig.expenses, pending: jobFig.expensesPending }));
    // Financials for QA Co this month: every job's counted expenses (by spentAt) + project expenses + crew pay handed over.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const [jobRows, projRows, paidCrew] = await Promise.all([
      db.jobExpense.findMany({ where: { job: { organizationId: w.orgId } }, select: { amount: true, status: true, spentAt: true, createdAt: true } }),
      db.projectExpense.findMany({ where: { project: { organizationId: w.orgId }, spentAt: { gte: monthStart } }, select: { amount: true } }),
      db.jobAssignment.findMany({ where: { job: { organizationId: w.orgId }, paidAt: { gte: monthStart } }, select: { pay: true } }),
    ]);
    const inMonth = (d: Date) => d >= monthStart;
    const expected = c2(jobRows.filter((r) => inMonth(expenseDate(r))).reduce((a, r) => a + (countedAmounts([r])[0] ?? 0), 0) + projRows.reduce((a, r) => a + r.amount, 0) + paidCrew.reduce((a, r) => a + r.pay, 0));
    const bucket = (await getMonthlyRollup(w.orgId, 12)).find((b) => b.key === monthKey);
    ok("the month's Financials expenses = Σ counted job expenses by spentAt + project expenses + crew pay handed over", bucket?.expenses === expected, `${bucket?.expenses} vs ${expected}`);
    const rollup = await getFinancialsRollup(w.orgId);
    ok("the 30-day roll-up reports what is on review apart, and never adds it", rollup.expensesOnReview >= 33.33 && rollup.expensesOnReviewCount >= 1 && (await db.jobExpense.count({ where: { job: { organizationId: w.orgId }, status: "SUBMITTED" } })) === rollup.expensesOnReviewCount);
    const [approvedThisJob] = [c2(98.5 + 40 + 250.01)];
    ok("this job's contribution to the month equals its own figure", c2(jobRows.length ? rows.filter((r) => ["APPROVED", "REIMBURSED"].includes(r.status)).reduce((a, r) => a + r.amount, 0) : 0) === approvedThisJob && jobFig.expenses === approvedThisJob);
    ok("cleanup rows exist", !!e4 && !!e5);

    head("5 · job or stock");
    const tag = `${Date.now()}`;
    const item = await db.inventoryItem.create({ data: { organizationId: w.orgId, trade: "fence", name: `QA post ${tag}`, key: `qa post ${tag}`, unit: "each", onHand: 0 } });
    const bare = await db.inventoryItem.create({ data: { organizationId: w.orgId, trade: "fence", name: `QA unpriced ${tag}`, key: `qa unpriced ${tag}`, unit: "each", onHand: 0 } });
    stockItems.push(item.id, bare.id);
    const monthBefore = (await getMonthlyRollup(w.orgId, 12)).find((b) => b.key === monthKeyNow())!.expenses;
    const costBefore = await jobCostOf(w.orgId, w.jobId);
    ok("a worker cannot book a purchase for stock", (await throws(() => createStockPurchase(worker(A), { category: "Materials", amount: 5 }))) !== null);
    const buy = await createStockPurchase(manager, { category: "Materials", amount: 120, vendor: "Supplier", stockItemId: item.id, stockQty: 12 });
    stockRows.push(buy.id);
    ok("a purchase for stock has no job, is the company's, approved at once", buy.jobId === null && buy.purpose === "STOCK" && buy.organizationId === w.orgId && buy.status === "APPROVED");
    ok("it sets the item's unit price (120 / 12 = 10)", (await db.inventoryItem.findUnique({ where: { id: item.id } }))?.lastCost === 10);
    const monthAfterBuy = (await getMonthlyRollup(w.orgId, 12)).find((b) => b.key === monthKeyNow())!.expenses;
    ok("the purchase is a company expense this month, once", c2(monthAfterBuy - monthBefore) === 120, `${monthBefore} → ${monthAfterBuy}`);
    ok("… and not the job's cost", (await jobCostOf(w.orgId, w.jobId)).total === costBefore.total);
    // Issue from stock: 3 picked at the stamped price, 1 used at the item's price, 1 back; 2 of an item with no price.
    await db.inventoryMovement.createMany({ data: [
      { itemId: item.id, kind: "PICKED", quantity: -3, jobId: w.jobId, unitCost: 10 },
      { itemId: item.id, kind: "USED", quantity: -1, jobId: w.jobId },
      { itemId: item.id, kind: "RETURNED", quantity: 1, jobId: w.jobId, unitCost: 10 },
      { itemId: bare.id, kind: "PICKED", quantity: -2, jobId: w.jobId },
    ] });
    const cost = await jobCostOf(w.orgId, w.jobId);
    ok("stock issued (PICKED + USED − RETURNED) is the job's cost at the movement's price, else the item's", cost.stock === c2(costBefore.stock + 30), `${cost.stock}`);
    ok("a line with no price anywhere counts $0 and is named", cost.unpriced.includes(bare.name) && cost.stockLines.find((l) => l.itemId === bare.id)?.cost === 0);
    ok("the issue is not a second company expense", (await getMonthlyRollup(w.orgId, 12)).find((b) => b.key === monthKeyNow())!.expenses === monthAfterBuy);
    await db.inventoryItem.update({ where: { id: item.id }, data: { lastCost: 99 } });
    ok("a later price change moves only the unstamped USED line (1 × 99)", (await jobCostOf(w.orgId, w.jobId)).stock === c2(costBefore.stock + 20 + 99));
    await db.inventoryItem.update({ where: { id: item.id }, data: { lastCost: 10 } });

    head("6 · the review queue, the batch, owed to workers");
    const q1 = await createJobExpense(portal(A), { jobId: w.jobId, category: "Fuel", amount: 21.1, via: "worker-portal" });
    const q2 = await createJobExpense(worker(B), { jobId: w.jobId, category: "Materials", amount: 12.2, via: "dashboard" });
    let office = await getOfficeMoney(w.orgId);
    const inQueue = (id: string) => office.queue.some((q) => q.id === id);
    ok("the queue lists every receipt on review, who sent it, the job, who paid", inQueue(q1.id) && inQueue(q2.id) && inQueue(e4.id) && office.queue.find((q) => q.id === q1.id)?.who === A.name && office.queue.find((q) => q.id === q1.id)?.job === w.jobTitle && office.queue.find((q) => q.id === q1.id)?.paidBy === "WORKER");
    const batch = await reviewJobExpenses(manager, [q1.id, q2.id, e2.id], "approve");
    ok("the batch approves the ones on review and reports the one that cannot move", batch.done.length === 2 && batch.failed.length === 1 && batch.failed[0].id === e2.id);
    ok("a worker cannot batch", (await reviewJobExpenses(worker(A), [e4.id], "approve")).failed.length === 1);
    const rejB = await reviewJobExpenses(owner, [e4.id], "reject", "Duplicate of yesterday's");
    ok("a batch rejection carries its reason to each receipt", rejB.done.length === 1 && (await db.jobExpense.findUnique({ where: { id: e4.id } }))?.rejectReason === "Duplicate of yesterday's");
    office = await getOfficeMoney(w.orgId);
    const owedA = office.owed.find((o) => o.name === A.name);
    const owedB = office.owed.find((o) => o.name === B.name);
    ok("owed to workers = approved, paid by the worker, not reimbursed — per worker", owedA?.total === 21.1 && owedB?.total === 12.2, JSON.stringify(office.owed.map((o) => [o.name, o.total])));
    const rollupD = await getFinancialsRollup(w.orgId);
    const owedAll = c2((await db.jobExpense.findMany({ where: { OR: [{ organizationId: w.orgId }, { job: { organizationId: w.orgId } }], status: "APPROVED", paidBy: "WORKER", reimbursedAt: null } })).reduce((a, r) => a + r.amount, 0));
    ok("the Financials figure is the sum of the workers' rows", rollupD.owedToWorkers === owedAll && office.owedTotal === owedAll, `${rollupD.owedToWorkers} / ${office.owedTotal} / ${owedAll}`);
    await reviewJobExpenses(owner, owedA!.items.map((i) => i.id), "reimburse");
    office = await getOfficeMoney(w.orgId);
    ok("Mark reimbursed takes the worker off the list", !office.owed.some((o) => o.name === A.name) && office.owed.some((o) => o.name === B.name));

    head("7 · the job's cost on its page = its row in Financials, to the cent");
    const { loadJobDetail } = await import("../../../src/components/v3/job-detail-blueprint/job-detail-load");
    await db.jobAssignment.updateMany({ where: { jobId: w.jobId }, data: { pay: 150.5 } });
    const page = await loadJobDetail(w.jobId, w.orgId, "OWNER", w.ownerUserId);
    office = await getOfficeMoney(w.orgId);
    const row = office.costs.find((c) => c.jobId === w.jobId);
    const direct = await jobCostOf(w.orgId, w.jobId);
    ok("crew + receipts + stock on the job page equal the Financials row", !!page?.money && !!row && c2(page.money.crew + page.money.expenses + page.money.stock) === row.total && row.total === direct.total, `${page?.money ? c2(page.money.crew + page.money.expenses + page.money.stock) : "?"} vs ${row?.total}`);
    ok("… line by line", !!row && page!.money!.crew === row.crew && page!.money!.expenses === row.receipts && page!.money!.stock === row.stock && page!.money!.expensesPending === row.receiptsPending);
    ok("the page names the unpriced stock line too", !!page?.money?.stockUnpriced.includes(bare.name));
  } finally {
    await db.jobExpense.deleteMany({ where: { id: { in: stockRows } } });
    await db.activityEvent.deleteMany({ where: { organizationId: w.orgId, OR: stockRows.map((id) => ({ meta: { contains: `"expenseId":"${id}"` } })) } }).catch(() => {});
    await db.inventoryItem.deleteMany({ where: { id: { in: stockItems } } });
    await w.cleanup();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
