// One company's rows and files are not another's (security audit 2026-10-12, section 1).
//
//   npx tsx --tsconfig tsconfig.json scripts/qa/tenant-isolation.check.ts
//
// Runs the real server actions, loaders and route handlers on the local dev
// database with the network off and every outside key blanked
// (./_actionHarness). Two throwaway organisations, A and B, are made and
// removed at the end. Each cross-company call must be refused AND leave A's
// row as it was; a control call by A's own owner shows the action works, so
// a refusal is the guard and not a broken fixture.
//
// The FILE rules (fixed 2026-10-12): an action takes only a file from the
// company's own folder in the store — a job's `jobs/<jobId>/` or
// `receipts/<jobId>/`, the deck's `deck-photos/<orgId>/`, a home request's
// `home/<homeId>/<leadId>/` — by the START of the path, never "contains";
// and a delete leaves the bytes alone while another row still names them.
import { actAs, check, outcome, summary } from "./_actionHarness";
import { randomBytes } from "node:crypto";
import { db } from "../../src/lib/db";
import * as clients from "../../src/actions/clients";
import * as proposals from "../../src/actions/proposals";
import * as jobs from "../../src/actions/jobs";
import * as leads from "../../src/actions/leads";
import * as jobMedia from "../../src/actions/jobMedia";
import * as changeOrders from "../../src/actions/changeOrders";
import * as appointments from "../../src/actions/appointments";
import * as projects from "../../src/actions/projects";
import * as team from "../../src/actions/team";
import * as workers from "../../src/actions/workers";
import * as installments from "../../src/actions/installments";
import * as templates from "../../src/actions/templates";
import * as expenses from "../../src/actions/expenses";
import * as messages from "../../src/actions/messages";
import * as homeFiles from "../../src/actions/homeFiles";
import * as deck from "../../src/actions/deckEstimator";
import * as roof from "../../src/actions/roofEstimator";
import { defaultDeckDesign } from "../../src/lib/deck/design";
import { deckScope, priceDeck } from "../../src/lib/deck/pricing";
import { deckScene } from "../../src/lib/deck/scene";
import * as bookingActions from "../../src/actions/booking";
import { loadClientDetail } from "../../src/components/v3/client-detail-blueprint/client-detail-load";
import { loadJobDetail } from "../../src/components/v3/job-detail-blueprint/job-detail-load";
import { loadProjectDetail } from "../../src/components/v3/project-detail-blueprint/project-detail-load";
import { verifyMediaLink } from "../../src/lib/media/signedLink";
import { isPrivateFileUnder, putPrivate, storedExists, deleteStored } from "../../src/lib/media/privateStore";
import * as pdfRoute from "../../src/app/api/proposals/[id]/pdf/route";
import * as clientsCsv from "../../src/app/api/exports/clients.csv/route";
import * as proposalsCsv from "../../src/app/api/exports/proposals.csv/route";
import * as crewMedia from "../../src/app/api/crew/media/[id]/route";
import * as crewReceipt from "../../src/app/api/crew/receipts/[id]/route";

const tag = `qa-iso-${Date.now()}`;
const rid = () => randomBytes(9).toString("hex");

async function makeOrg(letter: string) {
  const org = await db.organization.create({ data: { name: `${tag} ${letter}`, slug: `${tag}-${letter.toLowerCase()}`, isInternal: true } });
  const owner = await db.user.create({ data: { email: `${tag}-${letter.toLowerCase()}@qa.test`, name: `Owner ${letter}`, activeOrgId: org.id } });
  await db.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
  const client = await db.client.create({ data: { organizationId: org.id, name: `Client of ${letter} ${tag}`, email: `client-${letter}@qa.test` } });
  const lead = await db.lead.create({ data: { organizationId: org.id, name: `Lead of ${letter}`, status: "NEW" } });
  const proposal = await db.proposal.create({ data: { organizationId: org.id, publicId: rid(), title: `Proposal of ${letter} ${tag}`, clientId: client.id, status: "DRAFT", total: 1000, ownerId: owner.id } });
  const inst = await db.installment.create({ data: { proposalId: proposal.id, label: "Deposit", amount: 500, position: 0 } });
  const job = await db.job.create({ data: { organizationId: org.id, title: `Job of ${letter}`, clientId: client.id, proposalId: proposal.id } });
  const now = Date.now();
  const event = await db.jobEvent.create({ data: { organizationId: org.id, jobId: job.id, title: `Event of ${letter}`, startsAt: new Date(now + 864e5), endsAt: new Date(now + 900e5) } });
  const photo = await db.jobPhoto.create({ data: { jobId: job.id, url: `local:jobs/${job.id}/secret-${letter}.jpg`, kind: "BEFORE", uploadedById: owner.id } });
  const expense = await db.jobExpense.create({ data: { organizationId: org.id, jobId: job.id, category: "Materials", amount: 42, status: "SUBMITTED", submittedById: owner.id } });
  const co = await db.changeOrder.create({ data: { organizationId: org.id, proposalId: proposal.id, jobId: job.id, title: `CO of ${letter}`, amount: 100, publicToken: rid() } });
  const project = await db.project.create({ data: { organizationId: org.id, name: `Project of ${letter}` } });
  const appt = await db.appointment.create({ data: { organizationId: org.id, title: `Visit of ${letter}`, startsAt: new Date(now + 864e5), endsAt: new Date(now + 870e5), createdById: owner.id } });
  const tpl = await db.proposalTemplate.create({ data: { organizationId: org.id, name: `Template of ${letter}`, body: "{}" } });
  const staff = await db.user.create({ data: { email: `${tag}-${letter.toLowerCase()}-staff@qa.test`, name: `Staff ${letter}`, activeOrgId: org.id } });
  const staffM = await db.membership.create({ data: { userId: staff.id, organizationId: org.id, role: "MANAGER" } });
  const worker = await db.workerProfile.create({ data: { userId: staff.id, organizationId: org.id, displayName: `Worker ${letter}`, token: rid() } });
  const conv = await db.conversation.create({ data: { organizationId: org.id } });
  await db.conversationParticipant.create({ data: { conversationId: conv.id, userId: owner.id } });
  return { org, owner, client, lead, proposal, inst, job, event, photo, expense, co, project, appt, tpl, staff, staffM, worker, conv };
}

type World = Awaited<ReturnType<typeof makeOrg>>;
const as = (w: World) => actAs({ id: w.owner.id, activeOrgId: w.org.id });

/** B calls `fn` with A's ids: refused, and `still()` proves A's row is untouched. */
async function denied(name: string, B: World, fn: () => Promise<unknown>, still: () => Promise<boolean>) {
  as(B);
  const r = await outcome(fn);
  const intact = await still();
  check(`B → A: ${name} — refused and A unchanged${process.env.AUDIT_VERBOSE ? ` [${r.text.slice(0, 70)}]` : ""}`, r.refused && intact, { refused: r.refused, intact, said: r.text });
}

/** A calls the same action on its own row: it must work (the guard is what refused B). */
async function control(name: string, A: World, fn: () => Promise<unknown>) {
  as(A);
  const r = await outcome(fn);
  check(`control A → A: ${name} works`, !r.refused, r.text);
}

async function cleanup(ws: World[]) {
  for (const w of ws) {
    const orgId = w.org.id;
    const del = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { /* next */ } };
    await del(() => db.activityEvent.deleteMany({ where: { organizationId: orgId } }));
    await del(() => db.message.deleteMany({ where: { conversation: { organizationId: orgId } } }));
    await del(() => db.conversationParticipant.deleteMany({ where: { conversation: { organizationId: orgId } } }));
    await del(() => db.conversation.deleteMany({ where: { organizationId: orgId } }));
    await del(() => db.jobAssignment.deleteMany({ where: { job: { organizationId: orgId } } }));
    await del(() => db.jobPhoto.deleteMany({ where: { job: { organizationId: orgId } } }));
    await del(() => db.jobExpense.deleteMany({ where: { OR: [{ organizationId: orgId }, { job: { organizationId: orgId } }] } }));
    await del(() => db.jobEvent.deleteMany({ where: { organizationId: orgId } }));
    await del(() => db.changeOrder.deleteMany({ where: { organizationId: orgId } }));
    await del(() => db.job.deleteMany({ where: { organizationId: orgId } }));
    await del(() => db.installment.deleteMany({ where: { proposal: { organizationId: orgId } } }));
    await del(() => db.proposal.deleteMany({ where: { organizationId: orgId } }));
    await del(() => db.appointment.deleteMany({ where: { organizationId: orgId } }));
    await del(() => db.proposalTemplate.deleteMany({ where: { organizationId: orgId } }));
    await del(() => db.project.deleteMany({ where: { organizationId: orgId } }));
    await del(() => db.lead.deleteMany({ where: { organizationId: orgId } }));
    await del(() => db.client.deleteMany({ where: { organizationId: orgId } }));
    await del(() => db.workerProfile.deleteMany({ where: { organizationId: orgId } }));
    await del(() => db.membership.deleteMany({ where: { organizationId: orgId } }));
    await del(() => db.user.deleteMany({ where: { id: { in: [w.owner.id, w.staff.id] } } }));
    await del(() => db.organization.delete({ where: { id: orgId } }));
  }
}

const madeFiles: string[] = [];
const homes: string[] = [];
const leadsMade: string[] = [];

async function main() {
  const A = await makeOrg("A");
  const B = await makeOrg("B");
  try {
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    const json = (body: unknown) => new Request("http://local/x", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

    // ── clients ──
    await denied("updateClient", B, () => clients.updateClient(A.client.id, { name: "Hijacked" }), async () => (await db.client.findUnique({ where: { id: A.client.id } }))?.name === A.client.name);
    await denied("setClientEmail", B, () => clients.setClientEmail(A.client.id, "evil@qa.test"), async () => (await db.client.findUnique({ where: { id: A.client.id } }))?.email === A.client.email);
    await control("setClientEmail", A, () => clients.setClientEmail(A.client.id, A.client.email));
    // The proposal's client card writes email/phone onto the record (2026-10-13).
    await denied("saveClientContact", B, () => clients.saveClientContact(A.client.id, { email: "evil@qa.test", phone: "555" }), async () => { const c = await db.client.findUnique({ where: { id: A.client.id } }); return c?.email === A.client.email && c?.phone === A.client.phone; });
    await control("saveClientContact", A, () => clients.saveClientContact(A.client.id, { email: A.client.email ?? undefined }));

    // ── proposals ──
    await denied("updateProposalStatus", B, () => proposals.updateProposalStatus(A.proposal.id, "ACCEPTED" as never), async () => (await db.proposal.findUnique({ where: { id: A.proposal.id } }))?.status === "DRAFT");
    await denied("bulkUpdateProposalStatus", B, async () => { const r = await proposals.bulkUpdateProposalStatus([A.proposal.id], "ACCEPTED" as never); if ((r as { updated: number }).updated) return r; throw new Error("0 updated"); }, async () => (await db.proposal.findUnique({ where: { id: A.proposal.id } }))?.status === "DRAFT");
    await denied("bulkDeleteProposals", B, async () => { const r = await proposals.bulkDeleteProposals([A.proposal.id]); if (r.deleted) return r; throw new Error("0 deleted"); }, async () => !!(await db.proposal.findUnique({ where: { id: A.proposal.id } })));
    await denied("duplicateProposal", B, () => proposals.duplicateProposal(A.proposal.id), async () => (await db.proposal.count({ where: { organizationId: B.org.id } })) === 1);
    await denied("sendProposal", B, () => proposals.sendProposal(A.proposal.id), async () => (await db.proposal.findUnique({ where: { id: A.proposal.id } }))?.status === "DRAFT");
    // The Send box takes an address and writes it onto the client (2026-10-13): never across companies.
    await denied("sendProposal+email", B, () => proposals.sendProposal(A.proposal.id, { email: "evil@qa.test", name: "Evil" }), async () => { const p = await db.proposal.findUnique({ where: { id: A.proposal.id }, include: { client: true } }); return p?.status === "DRAFT" && p?.clientId === A.client.id && p?.client?.email === A.client.email && (await db.client.count({ where: { email: "evil@qa.test" } })) === 0; });
    await control("updateProposalStatus", A, () => proposals.updateProposalStatus(A.proposal.id, "DRAFT" as never));

    // ── payments (stages / invoices) ──
    await denied("markInstallmentPaid", B, () => installments.markInstallmentPaid({ installmentId: A.inst.id, method: "CASH" }), async () => (await db.installment.findUnique({ where: { id: A.inst.id } }))?.status !== "PAID");
    await denied("getProposalSchedule", B, async () => { const r = await installments.getProposalSchedule(A.proposal.id); if (r && (Array.isArray(r) ? r.length : Object.keys(r).length)) return r; throw new Error("empty"); }, async () => true);

    // ── jobs ──
    await denied("updateJob", B, () => jobs.updateJob(A.job.id, { title: "Hijacked" }), async () => (await db.job.findUnique({ where: { id: A.job.id } }))?.title === A.job.title);
    await denied("deleteJob", B, () => jobs.deleteJob(A.job.id), async () => !!(await db.job.findUnique({ where: { id: A.job.id } })));
    await denied("createJob linking A's client", B, () => jobs.createJob({ title: "Stolen client", clientId: A.client.id }), async () => (await db.job.count({ where: { organizationId: B.org.id, clientId: A.client.id } })) === 0);
    await denied("deleteJobEvent", B, () => jobs.deleteJobEvent(A.event.id), async () => !!(await db.jobEvent.findUnique({ where: { id: A.event.id } })));
    await denied("rescheduleJobEvent", B, () => jobs.rescheduleJobEvent(A.event.id, new Date().toISOString()), async () => (await db.jobEvent.findUnique({ where: { id: A.event.id } }))?.startsAt.getTime() === A.event.startsAt.getTime());
    await control("updateJob", A, () => jobs.updateJob(A.job.id, { title: A.job.title }));

    // ── leads ──
    await denied("updateLeadStatus", B, () => leads.updateLeadStatus(A.lead.id, "CONTACTED"), async () => (await db.lead.findUnique({ where: { id: A.lead.id } }))?.status === "NEW");
    await denied("deleteLead", B, () => leads.deleteLead(A.lead.id), async () => !!(await db.lead.findUnique({ where: { id: A.lead.id } })));

    // ── photos / videos / receipts ──
    await denied("createJobPhoto on A's job", B, () => jobMedia.createJobPhoto(A.job.id, { url: "https://example.com/x.jpg" }), async () => (await db.jobPhoto.count({ where: { jobId: A.job.id } })) === 1);
    await denied("editJobPhotoCaption", B, () => jobMedia.editJobPhotoCaption(A.photo.id, "hijacked"), async () => (await db.jobPhoto.findUnique({ where: { id: A.photo.id } }))?.caption == null);
    await denied("deleteJobPhoto", B, () => jobMedia.deleteJobPhoto(A.photo.id), async () => !!(await db.jobPhoto.findUnique({ where: { id: A.photo.id } })));
    await denied("PATCH /api/crew/media/[id]", B, async () => { const r = await crewMedia.PATCH(json({ caption: "x" }), ctx(A.photo.id)); if (r.status >= 400) throw new Error(`HTTP ${r.status}`); return r.status; }, async () => (await db.jobPhoto.findUnique({ where: { id: A.photo.id } }))?.caption == null);
    await denied("PATCH /api/crew/receipts/[id]", B, async () => { const r = await crewReceipt.PATCH(json({ amount: 1 }), ctx(A.expense.id)); if (r.status >= 400) throw new Error(`HTTP ${r.status}`); return r.status; }, async () => (await db.jobExpense.findUnique({ where: { id: A.expense.id } }))?.amount === 42);
    await denied("approveJobExpense", B, () => expenses.approveJobExpense(A.expense.id), async () => (await db.jobExpense.findUnique({ where: { id: A.expense.id } }))?.status === "SUBMITTED");
    await denied("deleteJobExpense", B, () => expenses.deleteJobExpense(A.expense.id), async () => !!(await db.jobExpense.findUnique({ where: { id: A.expense.id } })));
    await denied("addJobExpense on A's job", B, () => expenses.addJobExpense({ jobId: A.job.id, category: "x", amount: 1 }), async () => (await db.jobExpense.count({ where: { jobId: A.job.id } })) === 1);
    await control("editJobPhotoCaption", A, () => jobMedia.editJobPhotoCaption(A.photo.id, null));

    // ── change orders ──
    await denied("voidChangeOrder", B, () => changeOrders.voidChangeOrder(A.co.id), async () => (await db.changeOrder.findUnique({ where: { id: A.co.id } }))?.status === "DRAFT");
    await denied("deleteChangeOrder", B, () => changeOrders.deleteChangeOrder(A.co.id), async () => !!(await db.changeOrder.findUnique({ where: { id: A.co.id } })));
    await denied("changeOrdersFor(A's proposal)", B, async () => { const r = await changeOrders.changeOrdersFor({ proposalId: A.proposal.id }); if (r.length) return r; throw new Error("empty"); }, async () => true);

    // ── calendar, projects, templates ──
    await denied("updateAppointment", B, () => appointments.updateAppointment(A.appt.id, { title: "Hijacked" }), async () => (await db.appointment.findUnique({ where: { id: A.appt.id } }))?.title === A.appt.title);
    await denied("deleteAppointment", B, () => appointments.deleteAppointment(A.appt.id), async () => !!(await db.appointment.findUnique({ where: { id: A.appt.id } })));
    await denied("archiveProject", B, () => projects.archiveProject(A.project.id), async () => (await db.project.findUnique({ where: { id: A.project.id } }))?.status === A.project.status);
    await denied("attachJob(B's project, A's job)", B, () => projects.attachJob(B.project.id, A.job.id), async () => (await db.job.findUnique({ where: { id: A.job.id } }))?.projectId == null);
    await denied("deleteTemplate", B, () => templates.deleteTemplate(A.tpl.id), async () => !!(await db.proposalTemplate.findUnique({ where: { id: A.tpl.id } })));
    await denied("createProposalFromTemplate", B, () => templates.createProposalFromTemplate(A.tpl.id), async () => (await db.proposal.count({ where: { organizationId: B.org.id } })) === 1);

    // ── people ──
    await denied("updateMembershipRole → OWNER", B, () => team.updateMembershipRole(A.staffM.id, "OWNER"), async () => (await db.membership.findUnique({ where: { id: A.staffM.id } }))?.role === "MANAGER");
    await denied("removeMember", B, () => team.removeMember(A.staffM.id), async () => !!(await db.membership.findUnique({ where: { id: A.staffM.id } })));
    await denied("updateWorker", B, () => workers.updateWorker({ id: A.worker.id, name: "Hijacked" }), async () => (await db.workerProfile.findUnique({ where: { id: A.worker.id } }))?.displayName === A.worker.displayName);
    await denied("removeWorker", B, () => workers.removeWorker(A.worker.id), async () => !!(await db.workerProfile.findUnique({ where: { id: A.worker.id } })));
    await denied("assignWorker(B's job, A's worker)", B, () => workers.assignWorker(B.job.id, A.worker.id), async () => (await db.jobAssignment.count({ where: { workerId: A.worker.id } })) === 0);
    await denied("switchActiveOrg to A", B, () => team.switchActiveOrg(A.org.id), async () => (await db.user.findUnique({ where: { id: B.owner.id } }))?.activeOrgId === B.org.id);
    await denied("postMessage in A's thread", B, () => messages.postMessage(A.conv.id, "hello from B"), async () => (await db.message.count({ where: { conversationId: A.conv.id } })) === 0);

    // ── pages' loaders (what a detail page renders) ──
    as(B);
    check("B → A: client page loader finds nothing", (await loadClientDetail(A.client.id, B.org.id)).found === false);
    check("B → A: job page loader finds nothing", (await loadJobDetail(A.job.id, B.org.id, "OWNER", B.owner.id)) === null);
    check("B → A: project page loader finds nothing", (await loadProjectDetail(A.project.id, B.org.id)) === null);
    check("control A → A: job page loader finds the job", (await loadJobDetail(A.job.id, A.org.id, "OWNER", A.owner.id)) !== null);

    // ── PDF and exports ──
    as(B);
    const pdf = await outcome(async () => (await pdfRoute.GET(new Request("http://local/x"), ctx(A.proposal.id))).status);
    check("B → A: /api/proposals/[id]/pdf answers 404", pdf.text === "404", pdf.text);
    const csvB = await (await clientsCsv.GET()).text();
    check("B: clients.csv has none of A's clients", !csvB.includes(A.client.name) && csvB.includes(B.client.name), csvB.slice(0, 200));
    const pcsvB = await (await proposalsCsv.GET()).text();
    check("B: proposals.csv has none of A's proposals", !pcsvB.includes(A.proposal.title) && pcsvB.includes(B.proposal.title), pcsvB.slice(0, 200));

    // ── FINDING: a stored file URL from another company is accepted as B's own photo ──
    // B files A's private photo URL (decodable from any /api/media/f link A ever
    // showed) as a photo of B's OWN job; B's job page then mints a fresh signed
    // read link for A's file.
    as(B);
    const reg = await outcome(() => jobMedia.createJobPhoto(B.job.id, { url: A.photo.url }));
    const planted = await db.jobPhoto.findFirst({ where: { jobId: B.job.id, url: A.photo.url } });
    const view = await loadJobDetail(B.job.id, B.org.id, "OWNER", B.owner.id);
    const hrefs = JSON.stringify(view ?? {}).match(/\/api\/media\/f\?[^"]+/g) ?? [];
    const readsA = hrefs.some((h) => { const v = verifyMediaLink(new URLSearchParams(h.split("?")[1].replace(/\\u0026/g, "&").replace(/&amp;/g, "&"))); return v.ok && v.url === A.photo.url; });
    check("B cannot file A's private photo URL as a photo of B's own job", reg.refused && !planted, { said: reg.text, planted: !!planted });
    check("B's job page does not mint a read link for A's private file", !readsA, { links: hrefs.length });
    const recUrl = `https://abc123.private.blob.vercel-storage.com/receipts/${A.job.id}/receipt-${rid()}.jpg`;
    const rec = await outcome(() => expenses.addJobExpense({ jobId: B.job.id, category: "Materials", amount: 1, receiptUrl: recUrl }));
    check("B cannot file a receipt URL from A's receipts folder on B's own job (server action)", rec.refused, rec.text);

    // Every export of a "use server" file is a callable endpoint: none may
    // take an organizationId (the booking book's re-export did, 2026-10-12).
    check("actions/booking exports no organizationId-taking loadBookingDashboard", !("loadBookingDashboard" in bookingActions));

    // ── the file rules, door by door ──
    const blob = (p: string) => `https://abc123.private.blob.vercel-storage.com/${p}`;
    const fileOfA = blob(`jobs/${A.job.id}/secret-${rid()}.jpg`);
    const smuggled: Array<[string, string]> = [
      ["a query naming B's folder", `${fileOfA}?jobs/${B.job.id}/`],
      ["a climb out of B's folder (local)", `local:jobs/${B.job.id}/../../jobs/${A.job.id}/x.jpg`],
      ["an encoded climb out of B's folder (blob)", blob(`jobs/${B.job.id}/..%2F..%2Fjobs%2F${A.job.id}%2Fx.jpg`)],
      ["an outside https link", "https://example.com/x.jpg"],
    ];
    for (const [how, url] of smuggled) {
      as(B);
      const r = await outcome(() => jobMedia.createJobPhoto(B.job.id, { url }));
      check(`B cannot file A's photo by ${how}`, r.refused && !(await db.jobPhoto.findFirst({ where: { jobId: B.job.id, url } })), r.text);
    }
    await control("createJobPhoto with a file in the job's own folder", B, () => jobMedia.createJobPhoto(B.job.id, { url: `local:jobs/${B.job.id}/own-${rid()}.jpg` }));
    const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    await control("createJobPhoto with an inline picture", B, () => jobMedia.createJobPhoto(B.job.id, { url: TINY_PNG }));

    as(B);
    const sub = await outcome(() => expenses.submitJobExpense({ jobId: B.job.id, category: "Materials", amount: 2, receiptUrl: blob(`receipts/${A.job.id}/r.jpg`) }));
    check("B cannot send a receipt with A's file (submitJobExpense)", sub.refused, sub.text);
    const stock = await outcome(() => expenses.addStockPurchase({ category: "Materials", amount: 2, receiptUrl: blob(`receipts/${A.job.id}/r.jpg`) }));
    check("B cannot book a stock purchase with A's receipt file", stock.refused, stock.text);
    const ownRec = await outcome(() => expenses.addJobExpense({ jobId: B.job.id, category: "Materials", amount: 3, receiptUrl: blob(`receipts/${B.job.id}/own-${rid()}.jpg`) }));
    check("control B → B: a receipt from the job's own receipts folder is taken", !ownRec.refused, ownRec.text);
    const inlineRec = await outcome(() => expenses.addJobExpense({ jobId: B.job.id, category: "Materials", amount: 4, receiptUrl: TINY_PNG }));
    check("control B → B: an inline receipt picture is taken", !inlineRec.refused, inlineRec.text);
    const bExp = (ownRec.value as { id: string } | undefined)?.id;
    if (bExp) {
      const before = (await db.jobExpense.findUnique({ where: { id: bExp } }))?.receiptUrl ?? null;
      const ed = await outcome(() => expenses.editJobExpense(bExp, { receiptUrl: blob(`receipts/${A.job.id}/r.jpg`) }));
      check("B cannot re-point its receipt at A's file (editJobExpense)", ed.refused && (await db.jobExpense.findUnique({ where: { id: bExp } }))?.receiptUrl === before, ed.text);
      const same = await outcome(() => expenses.editJobExpense(bExp, { receiptUrl: before, note: "same file" }));
      check("control B → B: an edit that sends the row's own receipt back is taken", !same.refused, same.text);
    }

    // The deck's folder test is by the start of the path.
    check("deck: a query naming B's deck folder is not B's photo", !isPrivateFileUnder(`${fileOfA}?deck-photos/${B.org.id}/`, `deck-photos/${B.org.id}/`));
    await db.user.update({ where: { id: B.owner.id }, data: { isPlatformAdmin: true } });
    try {
      as(B);
      check("deck: deckPhotoHref mints nothing for A's file behind B's folder name", (await deck.deckPhotoHref(`${fileOfA}?deck-photos/${B.org.id}/`)) === null);
      check("control deck: deckPhotoHref mints a link for B's own deck photo", typeof (await deck.deckPhotoHref(blob(`deck-photos/${B.org.id}/p.jpg`))) === "string");
      // A saved proposal's deck opens again and is updated in place (2026-10-12): never another company's.
      const d = defaultDeckDesign({ state: "TX" });
      const pkg = priceDeck(d);
      const deckInput = (proposalId: string) => ({ proposalId, title: "Deck", scope: deckScope(pkg, null).join("\n"), assumptions: [], lines: pkg.lines.map((l) => ({ name: l.name, description: l.description, quantity: l.quantity, unit: l.unit, materialCost: l.materialCost, laborCost: l.laborCost })), address: null, plan: { design: d, scene: deckScene(pkg.structure) } });
      const linesOfA = () => db.lineItem.count({ where: { proposalId: A.proposal.id } });
      const nA = await linesOfA();
      const openA = await outcome(() => deck.loadDeckFromProposal(A.proposal.id));
      check("deck: B cannot open A's proposal in the studio (loadDeckFromProposal)", openA.refused, openA.text);
      await denied("updateDeckProposal (re-price A's proposal from B's deck)", B, () => deck.updateDeckProposal(deckInput(A.proposal.id)), async () => (await linesOfA()) === nA && (await db.proposal.findUnique({ where: { id: A.proposal.id } }))?.title === A.proposal.title);
      as(B);
      const ownUpd = await outcome(() => deck.updateDeckProposal(deckInput(B.proposal.id)));
      check("control B → B: updateDeckProposal re-prices B's own proposal", !ownUpd.refused && (await db.lineItem.count({ where: { proposalId: B.proposal.id } })) === pkg.lines.length, ownUpd.text);
    } finally {
      await db.user.update({ where: { id: B.owner.id }, data: { isPlatformAdmin: false } });
    }

    // A roof proposal opened again in the roof estimator and updated in place (2026-10-13): never another company's.
    {
      const roofLines = { materials: [{ name: "Shingles", quantity: 20, unitPrice: 120, unit: "sq" }], labor: [{ name: "Install", quantity: 20, unitPrice: 90, unit: "sq" }] };
      await db.proposal.update({ where: { id: A.proposal.id }, data: { trade: "roof" } });
      const roofLinesOfA = () => db.lineItem.count({ where: { proposalId: A.proposal.id } });
      const nRoofA = await roofLinesOfA();
      as(B);
      const openRoofA = await outcome(() => roof.loadRoofFromProposal(A.proposal.id));
      check("roof: B cannot open A's proposal in the roof estimator (loadRoofFromProposal)", openRoofA.refused, openRoofA.text);
      await denied("updateRoofProposal (re-price A's proposal from B's roof)", B, () => roof.updateRoofProposal({ proposalId: A.proposal.id, title: "Roof", ...roofLines }), async () => (await roofLinesOfA()) === nRoofA && (await db.proposal.findUnique({ where: { id: A.proposal.id } }))?.title === A.proposal.title);
      await db.proposal.update({ where: { id: B.proposal.id }, data: { trade: "roof" } });
      as(B);
      const ownRoof = await outcome(() => roof.updateRoofProposal({ proposalId: B.proposal.id, title: "Roof", ...roofLines }));
      check("control B → B: updateRoofProposal re-prices B's own roof proposal", !ownRoof.refused && (await db.lineItem.count({ where: { proposalId: B.proposal.id } })) === 2, ownRoof.text);
    }

    // A delete leaves the bytes while another row still names them.
    const sharedPhoto = await putPrivate(`jobs/${A.job.id}/shared-${rid()}.jpg`, Buffer.from("photo of A"), "image/jpeg");
    madeFiles.push(sharedPhoto.url);
    const aRow = await db.jobPhoto.create({ data: { jobId: A.job.id, url: sharedPhoto.url, kind: "AFTER", uploadedById: A.owner.id } });
    const bRow = await db.jobPhoto.create({ data: { jobId: B.job.id, url: sharedPhoto.url, kind: "AFTER", uploadedById: B.owner.id } }); // a row planted before the fix
    as(B);
    const delB = await outcome(() => jobMedia.deleteJobPhoto(bRow.id));
    check("B deleting its planted photo row leaves A's file in the store", !delB.refused && (await storedExists(sharedPhoto.url)), delB.text);
    as(A);
    await jobMedia.deleteJobPhoto(aRow.id);
    check("control A: A's own delete removes the file once no row names it", !(await storedExists(sharedPhoto.url)));
    const sharedRec = await putPrivate(`receipts/${A.job.id}/shared-${rid()}.jpg`, Buffer.from("receipt of A"), "image/jpeg");
    madeFiles.push(sharedRec.url);
    await db.jobExpense.update({ where: { id: A.expense.id }, data: { receiptUrl: sharedRec.url } });
    const planted2 = await db.jobExpense.create({ data: { organizationId: B.org.id, jobId: B.job.id, category: "Materials", amount: 1, status: "APPROVED", receiptUrl: sharedRec.url } });
    as(B);
    const delR = await outcome(() => expenses.deleteJobExpense(planted2.id));
    check("B deleting its planted receipt row leaves A's receipt file", !delR.refused && (await storedExists(sharedRec.url)), delR.text);

    // The home folder: a picture is put on a proposal only from its own folder.
    const home = await db.home.create({ data: { email: `${tag}-home@qa.test`, name: "QA Home", accessToken: rid() + rid() } });
    homes.push(home.id);
    const pl = await db.platformLead.create({ data: { name: "QA Home", email: `${tag}-home@qa.test`, matchedOrgId: A.org.id } });
    leadsMade.push(pl.id);
    const strayFile = await db.homeFile.create({ data: { homeId: home.id, platformLeadId: pl.id, organizationId: A.org.id, url: blob(`jobs/${B.job.id}/b-photo.jpg`), name: "x.jpg", contentType: "image/jpeg", bytes: 10, media: "photo" } });
    const goodFile = await db.homeFile.create({ data: { homeId: home.id, platformLeadId: pl.id, organizationId: A.org.id, url: TINY_PNG, name: "y.png", contentType: "image/png", bytes: 70, media: "photo" } });
    as(A);
    const att = await outcome(() => homeFiles.attachHomeFileToProposal({ fileId: strayFile.id, proposalId: A.proposal.id }));
    check("a home-folder row naming a file outside its folder is not read onto a proposal", att.refused, att.text);
    await control("attachHomeFileToProposal from the folder itself", A, () => homeFiles.attachHomeFileToProposal({ fileId: goodFile.id, proposalId: A.proposal.id }));
  } finally {
    for (const url of madeFiles) await deleteStored(url);
    await db.homeFile.deleteMany({ where: { homeId: { in: homes } } }).catch(() => {});
    await db.platformLead.deleteMany({ where: { id: { in: leadsMade } } }).catch(() => {});
    await db.home.deleteMany({ where: { id: { in: homes } } }).catch(() => {});
    await cleanup([A, B]);
    await db.$disconnect();
  }
  process.exit(summary() ? 1 : 0);
}

void main();
