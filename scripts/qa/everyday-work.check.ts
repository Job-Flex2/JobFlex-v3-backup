// The everyday work still works after the access and ceiling fixes (2026-10-12).
//
//   npx tsx --tsconfig tsconfig.json scripts/qa/everyday-work.check.ts
//
// The owner and a manager of a throwaway company (local dev database, network
// off — ./_actionHarness) do what they do every day through the real server
// actions: add a photo to a job, add an expense with and without a receipt
// picture, open the financials, and measure a roof the company already
// measured. Every one must answer — the fixes refuse strangers and limited
// roles, never the office.
import { actAs, check, outcome, summary } from "./_actionHarness";
import { randomBytes } from "node:crypto";
import { db } from "../../src/lib/db";
import { uploadJobPhoto, deleteJobPhoto } from "../../src/actions/jobMedia";
import { addJobExpense, deleteJobExpense } from "../../src/actions/expenses";
import { saveReceiptExpense } from "../../src/actions/receiptOcr";
import { loadFinancials } from "../../src/actions/financialsMobile";
import { loadFinancialsWho } from "../../src/app/(mobile)/mobile-financials-v2/who-action";
import { getDashboardData } from "../../src/app/dashboard/dashboard-actions";
import { measureRoofInstant } from "../../src/actions/roofMeasurement";
import { deleteStored } from "../../src/lib/media/privateStore";

const tag = `qa-everyday-${Date.now()}`;
const rid = () => randomBytes(6).toString("hex");
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function main() {
  const org = await db.organization.create({ data: { name: tag, slug: tag, isInternal: true } });
  await db.subscription.create({ data: { organizationId: org.id, plan: "PRO", status: "ACTIVE", provider: "STRIPE", currentPeriodEnd: new Date(Date.now() + 20 * 864e5) } });
  const people: Array<{ role: string; id: string }> = [];
  for (const role of ["OWNER", "MANAGER"]) {
    const u = await db.user.create({ data: { email: `${tag}-${role.toLowerCase()}@qa.test`, name: role, activeOrgId: org.id } });
    await db.membership.create({ data: { userId: u.id, organizationId: org.id, role } });
    people.push({ role, id: u.id });
  }
  const job = await db.job.create({ data: { organizationId: org.id, title: `Job ${tag}` } });
  const instant = {
    requestId: `qa-${rid()}`, address: "100 Main St, Springfield, IL 62701", lat: 39.8, lng: -89.6, imagery: [],
    structures: [{ areaSqft: 2000, squares: 20, pitch: "6/12", footprintSqft: 1800, outline: [{ lat: 39.8, lng: -89.6 }, { lat: 39.8001, lng: -89.6 }, { lat: 39.8001, lng: -89.6001 }] }],
    totals: { areaSqft: 2000, squares: 20, predominantPitch: 6, pitchLabel: "6/12", footprintSqft: 1800 },
  };
  const measured = { address: "100 Main St", city: "Springfield", state: "IL", zip: "62701" };
  await db.roofMeasurement.create({ data: { organizationId: org.id, source: "instant", modelJson: "{}", instantJson: JSON.stringify(instant), ...measured } as never });
  const files: string[] = [];
  process.env.EAGLEVIEW_CLIENT_ID = "qa-dummy";
  process.env.EAGLEVIEW_CLIENT_SECRET = "qa-dummy";
  try {
    for (const p of people) {
      actAs({ id: p.id, activeOrgId: org.id });
      const photo = await outcome(() => uploadJobPhoto(job.id, TINY_PNG, "site.png", "BEFORE"));
      check(`${p.role}: uploads a photo to a job`, !photo.refused, photo.text);
      const url = (photo.value as { url?: string } | undefined)?.url;
      if (url) files.push(url);
      const plain = await outcome(() => addJobExpense({ jobId: job.id, category: "Materials", amount: 120, note: "lumber" }));
      check(`${p.role}: adds an expense`, !plain.refused, plain.text);
      const withPic = await outcome(() => saveReceiptExpense({ jobId: job.id, dataUrl: TINY_PNG, filename: "r.png", vendor: "Depot", total: 45, category: "Materials", note: null, ocrJson: null }));
      check(`${p.role}: adds an expense with its receipt picture`, !withPic.refused, withPic.text);
      const fin = await outcome(() => loadFinancials());
      check(`${p.role}: opens the financials (the expenses are in them)`, !fin.refused && /lumber|Depot/.test(fin.text + JSON.stringify(fin.value ?? "")), fin.text);
      const who = await outcome(() => loadFinancialsWho());
      check(`${p.role}: the financials' who-did-it marks load`, !who.refused, who.text);
      const overview = await outcome(() => getDashboardData());
      check(`${p.role}: opens the Overview`, !overview.refused, overview.text);
      const roof = await outcome(() => measureRoofInstant(measured));
      check(`${p.role}: measures a roof the company already measured`, !roof.refused, roof.text);
      const pid = (photo.value as { id?: string } | undefined)?.id;
      if (pid) {
        const del = await outcome(() => deleteJobPhoto(pid));
        check(`${p.role}: deletes the photo again`, !del.refused, del.text);
      }
      const eid = (plain.value as { id?: string } | undefined)?.id;
      if (eid) {
        const del = await outcome(() => deleteJobExpense(eid));
        check(`${p.role}: deletes the expense again`, !del.refused, del.text);
      }
    }
  } finally {
    process.env.EAGLEVIEW_CLIENT_ID = "";
    process.env.EAGLEVIEW_CLIENT_SECRET = "";
    const rows = await db.jobExpense.findMany({ where: { organizationId: org.id }, select: { receiptUrl: true } });
    for (const u of [...files, ...rows.map((r) => r.receiptUrl).filter((x): x is string => !!x)]) await deleteStored(u);
    const del = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { /* next */ } };
    await del(() => db.activityEvent.deleteMany({ where: { organizationId: org.id } }));
    await del(() => db.jobPhoto.deleteMany({ where: { job: { organizationId: org.id } } }));
    await del(() => db.jobExpense.deleteMany({ where: { organizationId: org.id } }));
    await del(() => db.job.deleteMany({ where: { organizationId: org.id } }));
    await del(() => db.roofMeasurement.deleteMany({ where: { organizationId: org.id } }));
    await del(() => db.instantOrder.deleteMany({ where: { organizationId: org.id } }));
    await del(() => db.subscription.deleteMany({ where: { organizationId: org.id } }));
    await del(() => db.membership.deleteMany({ where: { organizationId: org.id } }));
    await del(() => db.syncState.deleteMany({ where: { key: { contains: org.id } } }));
    await del(() => db.organization.delete({ where: { id: org.id } }));
    await del(() => db.user.deleteMany({ where: { id: { in: people.map((p) => p.id) } } }));
    await db.$disconnect();
  }
  process.exit(summary() ? 1 : 0);
}

void main();
