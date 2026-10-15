// MEDIA STORAGE (stages B–C, 2026-09-30): the crew's photos, videos and
// receipts are private files. Checked here, on the local fallback (no Blob
// store in development — the same code paths as the private store, less the
// store's own calls, which wait for a real store):
//
//   · read rights — a file is read only through a short signed link a page
//     mints after it checked the reader; a tampered or expired link is
//     refused; the job page will not load for a worker who is not on it,
//     through either door;
//   · deletion — deleting a photo, deleting a receipt and replacing a
//     receipt's picture remove the file from the store, not only the row;
//   · 100 MB — the upload ticket refuses a bigger file, the local upload
//     cuts a body past its ceiling;
//   · a foreign job — a worker cannot get an upload ticket for a job they are
//     not on, nor for another company's job.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/roles/media-storage.check.ts
//
// --real (2026-10-01, the store exists): the same promises against the REAL
// private Blob store — BLOB_PRIVATE_READ_WRITE_TOKEN from .env.local, and the
// dev server (QA_BASE_URL, default http://localhost:3001) for the browser's
// own route: a photo, an HEVC .mov (multipart) and a receipt go straight to
// the store with a client token the server grants only for the caller's job;
// read links redirect to presigned URLs that die on time and cannot be edited
// to another file; byte ranges; deletes reach the store. Everything it puts
// in the store it removes. run-all runs the default (local) mode only.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/roles/media-storage.check.ts --real
import "../_lib/_server-only";
import fs from "node:fs";
import { db, makeCrewWorld } from "../_lib/_crewWorld";

const REAL = process.argv.includes("--real");
const BASE = process.env.QA_BASE_URL || `http://localhost:${process.env.QA_PORT || "3001"}`;
if (REAL) {
  // The store's token and the link secret as the dev server has them.
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^(BLOB_PRIVATE_READ_WRITE_TOKEN|NEXTAUTH_SECRET|AUTH_SECRET)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  delete process.env.VERCEL;
} else {
  // The local fallback, whatever the shell carries: no private store, not Vercel.
  delete process.env.BLOB_PRIVATE_READ_WRITE_TOKEN;
  delete process.env.VERCEL;
}
if (!process.env.NEXTAUTH_SECRET && !process.env.AUTH_SECRET) process.env.NEXTAUTH_SECRET = "qa-media-storage-secret";

let passes = 0;
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const head = (s: string) => console.log(`\n── ${s}`);
const throws = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); } };
const MB = 1024 * 1024;

async function main() {
  const { storageMode, putPrivate, storedExists, isPrivateJobFile } = await import("../../../src/lib/media/privateStore");
  const { mediaHref, verifyMediaLink, uploadTicket } = await import("../../../src/lib/media/signedLink");
  const { recordJobMedia, authorizeJobMediaFor, deleteJobMediaFor } = await import("../../../src/lib/jobMedia");
  const { createJobExpense, editJobExpense, deleteJobExpense } = await import("../../../src/lib/jobExpenses");
  const { POST: ticketRoute } = await import("../../../src/app/api/crew/upload-ticket/route");
  const { PUT: localUpload } = await import("../../../src/app/api/crew/upload-local/route");
  const { GET: readRoute } = await import("../../../src/app/api/media/f/route");
  const { loadJobDetail, loadJobDetailForPortal } = await import("../../../src/components/v3/job-detail-blueprint/job-detail-load");
  const { MAX_FILE_BYTES } = await import("../../../src/lib/jobMediaShared");

  ok("development runs on the local fallback without a store", storageMode() === "local");

  const w = await makeCrewWorld("media");
  const [A, B] = w.workers;
  const made: string[] = [];
  try {
    const ticket = (token: string, jobId: string, bytes: number, contentType = "image/jpeg", folder = "jobs") =>
      ticketRoute(new Request("http://qa/api/crew/upload-ticket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, token, folder, name: "qa.jpg", contentType, bytes }) }));

    head("1 · 100 MB and file types");
    const at = await ticket(A.token, w.jobId, MAX_FILE_BYTES);
    const atBody = (await at.json()) as { mode?: string; pathname?: string; uploadUrl?: string };
    ok("exactly 100 MB is accepted, into this job's folder", at.status === 200 && atBody.mode === "local" && !!atBody.pathname?.startsWith(`jobs/${w.jobId}/`) && !!atBody.uploadUrl, JSON.stringify(atBody).slice(0, 120));
    const over = await ticket(A.token, w.jobId, MAX_FILE_BYTES + 1);
    const overBody = (await over.json()) as { error?: string };
    ok("100 MB + 1 byte is refused with 413, in words", over.status === 413 && /larger than 100 MB/.test(overBody.error ?? ""), overBody.error);
    ok("a HEIC is not accepted", (await ticket(A.token, w.jobId, MB, "image/heic")).status === 415);
    ok("a PDF is a receipt, not a job photo", (await ticket(A.token, w.jobId, MB, "application/pdf", "jobs")).status === 415 && (await ticket(A.token, w.jobId, MB, "application/pdf", "receipts")).status === 200);
    // The local upload cuts a body past the ticket's ceiling.
    const small = uploadTicket(`jobs/${w.jobId}/qa-ceiling.jpg`, "image/jpeg", 1000);
    const cut = await localUpload(new Request(`http://qa/api/crew/upload-local?ticket=${encodeURIComponent(small)}`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array(5000) }));
    ok("the local upload refuses a body past its ceiling (413)", cut.status === 413);

    head("2 · a foreign job");
    ok("the outsider gets no ticket for a job they are not on (403)", (await ticket(w.outsider.token, w.jobId, MB)).status === 403);
    const foreign = await db.job.findFirst({ where: { organizationId: { not: w.orgId } }, select: { id: true } });
    ok("nor for another company's job (403)", foreign ? (await ticket(A.token, foreign.id, MB)).status === 403 : true, foreign ? "" : "no other company's job to try");
    ok("a receipt path is only good for its own job", isPrivateJobFile(`local:receipts/${w.jobId}/x.jpg`, "receipts", w.jobId) && !isPrivateJobFile(`local:receipts/${w.jobId}/x.jpg`, "receipts", foreign?.id ?? "other") && !isPrivateJobFile(`local:jobs/${w.jobId}/x.jpg`, "receipts", w.jobId));

    head("3 · read rights");
    const up = await localUpload(new Request(`http://qa${atBody.uploadUrl}`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array(4096).fill(7) }));
    const upBody = (await up.json()) as { url?: string; bytes?: number };
    ok("A's picture lands in the private store", up.status === 200 && !!upBody.url?.startsWith("local:jobs/") && upBody.bytes === 4096);
    const href = mediaHref(upBody.url!)!;
    ok("a page shows it through a short signed link, never the stored path", href.startsWith("/api/media/f?") && !href.includes("jobs%2F") && !href.includes("jobs/"));
    const read = await readRoute(new Request(`http://qa${href}`));
    ok("the link reads the file", read.status === 200 && (await read.arrayBuffer()).byteLength === 4096);
    const ranged = await readRoute(new Request(`http://qa${href}`, { headers: { Range: "bytes=0-99" } }));
    ok("with byte ranges (a video seeks)", ranged.status === 206 && ranged.headers.get("content-range") === "bytes 0-99/4096");
    const u = new URL(`http://qa${href}`);
    const forged = new URL(u);
    forged.searchParams.set("u", Buffer.from(`local:jobs/${w.jobId}/someone-else.jpg`).toString("base64url"));
    ok("a link edited to name another file is refused", !verifyMediaLink(forged.searchParams).ok && (await readRoute(new Request(forged.toString()))).status === 404);
    ok("a link past its 15 minutes is refused (410, in words)", verifyMediaLink(u.searchParams, Date.now() + 16 * 60_000).ok === false && (verifyMediaLink(u.searchParams, Date.now() + 16 * 60_000) as { reason: string }).reason === "expired");
    ok("the job page does not load for a worker who is not on it — dashboard door", (await loadJobDetail(w.jobId, w.orgId, "INSTALLER", w.outsider.userId)) === null);
    const aAssign = await db.jobAssignment.findFirst({ where: { jobId: w.jobId, workerId: A.workerId }, select: { id: true } });
    ok("… nor through the portal with another worker's assignment", (await loadJobDetailForPortal(w.outsider.token, aAssign!.id)) === null);
    const onJob = await loadJobDetailForPortal(A.token, aAssign!.id);
    ok("A's own portal page loads, on the token door, in the portal frame", !!onJob && onJob.door.kind === "token" && onJob.chrome === "portal");

    head("4 · deletion takes the file out of the store");
    const callerA = await authorizeJobMediaFor({ organizationId: w.orgId, userId: A.userId, role: "INSTALLER" }, w.jobId);
    const photo = await recordJobMedia({ caller: callerA!, url: upBody.url!, kind: "PROGRESS", meta: { media: "photo", contentType: "image/jpeg", bytes: 4096 }, via: "worker-portal" });
    ok("B cannot delete A's photo", (await throws(() => deleteJobMediaFor({ organizationId: w.orgId, userId: B.userId, role: "INSTALLER" } as never, photo.id))) !== null && (await storedExists(upBody.url!)));
    await deleteJobMediaFor({ organizationId: w.orgId, userId: A.userId, role: "INSTALLER" } as never, photo.id);
    ok("A deletes their photo: the row and the file are gone", (await db.jobPhoto.findUnique({ where: { id: photo.id } })) === null && !(await storedExists(upBody.url!)));

    const r1 = await putPrivate(`receipts/${w.jobId}/qa-r1.jpg`, Buffer.alloc(900, 1), "image/jpeg");
    const r2 = await putPrivate(`receipts/${w.jobId}/qa-r2.jpg`, Buffer.alloc(900, 2), "image/jpeg");
    const worker = { organizationId: w.orgId, userId: A.userId, role: "WORKER_TOKEN", workerId: A.workerId, name: A.name };
    const ex = await createJobExpense(worker, { jobId: w.jobId, category: "Materials", amount: 12, receiptUrl: r1.url, via: "worker-portal" });
    made.push(ex.id);
    await editJobExpense(worker, ex.id, { receiptUrl: r2.url });
    ok("replacing a receipt's picture removes the old file", !(await storedExists(r1.url)) && (await storedExists(r2.url)));
    await deleteJobExpense(worker, ex.id);
    ok("deleting the receipt removes its file", (await db.jobExpense.findUnique({ where: { id: ex.id } })) === null && !(await storedExists(r2.url)));
  } finally {
    await db.jobExpense.deleteMany({ where: { id: { in: made } } });
    await w.cleanup();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exit(1);
}

// ── the real store ─────────────────────────────────────────────────────────
/** How long until the URL answers with one of `codes` (ms), or null. */
async function untilRefused(url: string, codes: number[], maxMs: number): Promise<number | null> {
  const t0 = Date.now();
  for (;;) {
    const r = await fetch(url, { cache: "no-store" });
    await r.arrayBuffer().catch(() => null);
    if (codes.includes(r.status)) return Date.now() - t0;
    if (Date.now() - t0 > maxMs) {
      console.log(`      (last answer ${r.status}, x-vercel-cache ${r.headers.get("x-vercel-cache")}, age ${r.headers.get("age")})`);
      return null;
    }
    await new Promise((res) => setTimeout(res, 3_000));
  }
}

async function realMain() {
  const ps = await import("../../../src/lib/media/privateStore");
  const { mediaHref, verifyMediaLink } = await import("../../../src/lib/media/signedLink");
  const { deleteJobMediaFor } = await import("../../../src/lib/jobMedia");
  const { editJobExpense, deleteJobExpense } = await import("../../../src/lib/jobExpenses");
  const { GET: readRoute } = await import("../../../src/app/api/media/f/route");
  const { loadJobDetail } = await import("../../../src/components/v3/job-detail-blueprint/job-detail-load");
  const { upload } = await import("@vercel/blob/client");
  const { MAX_FILE_BYTES } = await import("../../../src/lib/jobMediaShared");

  ok("the private store is configured (.env.local)", ps.storageMode() === "blob");
  const alive = await fetch(BASE + "/api/crew/upload-ticket", { method: "POST", body: "{}" }).then((r) => r.status).catch(() => 0);
  ok(`the dev server answers at ${BASE}`, alive > 0, String(alive));
  if (ps.storageMode() !== "blob" || !alive) return;

  const w = await makeCrewWorld("mediareal");
  const [A, B] = w.workers;
  const stored: string[] = [];
  const rows: { photos: string[]; expenses: string[] } = { photos: [], expenses: [] };
  const post = (path: string, body: unknown) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  /** The browser's route: a ticket from the server, then the file straight to the store. */
  const direct = async (token: string, jobId: string, folder: "jobs" | "receipts", name: string, type: string, bytes: Buffer) => {
    const t = await post("/api/crew/upload-ticket", { jobId, token, folder, name, contentType: type, bytes: bytes.byteLength });
    const tj = (await t.json()) as { mode?: string; pathname?: string; error?: string };
    if (t.status !== 200 || tj.mode !== "blob" || !tj.pathname) return { status: t.status, ticket: tj, url: null as string | null, error: tj.error };
    try {
      const put = await upload(tj.pathname, new Blob([bytes], { type }), {
        access: "private",
        handleUploadUrl: BASE + "/api/jobs/media/token",
        contentType: type,
        multipart: bytes.byteLength > 8 * MB,
        clientPayload: JSON.stringify({ jobId, token, folder, contentType: type, bytes: bytes.byteLength }),
      });
      stored.push(put.url);
      return { status: 200, ticket: tj, url: put.url, error: null };
    } catch (err) {
      return { status: 0, ticket: tj, url: null, error: err instanceof Error ? err.message : String(err) };
    }
  };
  try {
    head("R1 · tickets and client tokens only for the caller's job");
    const tk = await post("/api/crew/upload-ticket", { jobId: w.jobId, token: A.token, folder: "jobs", name: "p.jpg", contentType: "image/jpeg", bytes: 1000 });
    const tkj = (await tk.json()) as { mode?: string; pathname?: string };
    ok("the ticket says: straight to the store, into this job's folder", tk.status === 200 && tkj.mode === "blob" && !!tkj.pathname?.startsWith(`jobs/${w.jobId}/`), JSON.stringify(tkj));
    ok("over 100 MB is refused before anything moves (413)", (await post("/api/crew/upload-ticket", { jobId: w.jobId, token: A.token, folder: "jobs", name: "v.mov", contentType: "video/quicktime", bytes: MAX_FILE_BYTES + 1 })).status === 413);
    ok("the outsider gets no ticket (403)", (await post("/api/crew/upload-ticket", { jobId: w.jobId, token: w.outsider.token, folder: "jobs", name: "p.jpg", contentType: "image/jpeg", bytes: 1000 })).status === 403);
    // The store's own client-token request, as @vercel/blob/client sends it.
    const tokenReq = (token: string, pathname: string, folder = "jobs") =>
      post("/api/jobs/media/token", { type: "blob.generate-client-token", payload: { pathname, callbackUrl: BASE + "/api/jobs/media/token", clientPayload: JSON.stringify({ jobId: w.jobId, token, folder }), multipart: false } });
    ok("the store's client token is granted for the caller's own job", (await tokenReq(A.token, `jobs/${w.jobId}/x.jpg`)).status === 200);
    ok("… refused to the outsider (403)", (await tokenReq(w.outsider.token, `jobs/${w.jobId}/x.jpg`)).status === 403);
    ok("… refused for a path outside the job's folder", (await tokenReq(A.token, `jobs/other-job/x.jpg`)).status >= 400);
    const foreign = await db.job.findFirst({ where: { organizationId: { not: w.orgId } }, select: { id: true } });
    if (foreign) {
      const r = await post("/api/jobs/media/token", { type: "blob.generate-client-token", payload: { pathname: `jobs/${foreign.id}/x.jpg`, callbackUrl: BASE, clientPayload: JSON.stringify({ jobId: foreign.id, token: A.token, folder: "jobs" }), multipart: false } });
      ok("… refused for another company's job (403)", r.status === 403);
    }

    head("R2 · straight from the phone to the store");
    const jpg = fs.readFileSync("public/landing-d/project-1.jpg");
    const ph = await direct(A.token, w.jobId, "jobs", "photo.jpg", "image/jpeg", jpg);
    ok("a photo goes straight to the private store", !!ph.url && ps.kindOfUrl(ph.url) === "private-blob" && ps.isPrivateJobFile(ph.url, "jobs", w.jobId), ph.error ?? "");
    const recP = await post("/api/jobs/media", { jobId: w.jobId, token: A.token, url: ph.url, kind: "PROGRESS", contentType: "image/jpeg", bytes: jpg.byteLength, name: "photo.jpg" });
    const recPj = (await recP.json()) as { id?: string };
    if (recPj.id) rows.photos.push(recPj.id);
    ok("… and is recorded on the job", recP.status === 200 && !!recPj.id);
    const movPath = ".cache/blob-real/IMG_0002.MOV";
    if (fs.existsSync(movPath)) {
      const mov = fs.readFileSync(movPath);
      const t0 = Date.now();
      const vd = await direct(A.token, w.jobId, "jobs", "IMG_0002.MOV", "video/quicktime", mov);
      ok(`an HEVC .mov of ${Math.round(mov.byteLength / MB)} MB goes up in parts (multipart), as it is`, !!vd.url && ps.kindOfUrl(vd.url) === "private-blob", `${vd.error ?? ""} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      if (vd.url) {
        const recV = await post("/api/jobs/media", { jobId: w.jobId, token: A.token, url: vd.url, kind: "PROGRESS", contentType: "video/quicktime", bytes: mov.byteLength, name: "IMG_0002.MOV" });
        const recVj = (await recV.json()) as { id?: string; media?: string };
        if (recVj.id) rows.photos.push(recVj.id);
        ok("… recorded as a video", recV.status === 200 && recVj.media === "video");
      }
    } else ok("the HEVC test clip exists (.cache/blob-real/IMG_0002.MOV)", false);
    ok("the store refuses a recorded URL outside the job's folder", (await post("/api/jobs/media", { jobId: w.jobId, token: A.token, url: ph.url!.replace(`/jobs/${w.jobId}/`, "/jobs/someone-else/"), kind: "PROGRESS", contentType: "image/jpeg" })).status === 400);
    const rc = await direct(B.token, w.jobId, "receipts", "receipt.jpg", "image/jpeg", fs.readFileSync("public/landing-d/project-3.jpg"));
    ok("a receipt goes straight to the store, into receipts/<job>/", !!rc.url && ps.isPrivateJobFile(rc.url, "receipts", w.jobId), rc.error ?? "");
    const recR = await post(`/api/crew/${w.jobId}/receipts`, { token: B.token, url: rc.url, amount: 23.45, vendor: "QA Store", category: "Materials", paidBy: "WORKER" });
    const recRj = (await recR.json()) as { id?: string; status?: string };
    if (recRj.id) rows.expenses.push(recRj.id);
    ok("… and is on review with its private picture", recR.status === 200 && recRj.status === "SUBMITTED" && (await db.jobExpense.findUnique({ where: { id: recRj.id! } }))?.receiptUrl === rc.url);
    ok("a receipt picture cannot be recorded on another job", (await post(`/api/crew/${w.jobId}/receipts`, { token: B.token, url: rc.url!.replace(`/receipts/${w.jobId}/`, "/receipts/other/"), amount: 1 })).status === 400);

    head("R3 · reading: short links, presigned, ranges");
    const href = mediaHref(ph.url)!;
    const r302 = await readRoute(new Request("http://qa" + href));
    const loc = r302.headers.get("location") ?? "";
    ok("the page's link redirects (302) to a presigned store URL", r302.status === 302 && /\.private\.blob\.vercel-storage\.com\//.test(loc) && /vercel-blob-signature=/.test(loc));
    const got = await fetch(loc);
    ok("… which serves the photo", got.status === 200 && (got.headers.get("content-type") ?? "").startsWith("image/") && (await got.arrayBuffer()).byteLength === jpg.byteLength);
    const until = Number(new URL(loc).searchParams.get("vercel-blob-valid-until"));
    ok("… and is good for at most 15 minutes", until > Date.now() && until - Date.now() <= 15 * 60_000 + 5_000, `${Math.round((until - Date.now()) / 1000)} s`);
    const ranged = await fetch(loc, { headers: { Range: "bytes=100-1123" } });
    ok("byte ranges from the store (206)", ranged.status === 206 && ranged.headers.get("content-range") === `bytes 100-1123/${jpg.byteLength}` && (await ranged.arrayBuffer()).byteLength === 1024);
    const edited = loc.replace(/\/jobs\/[^?]+/, `/jobs/${w.jobId}/someone-else.jpg`);
    ok("a presigned URL edited to name another file is refused by the store", (await fetch(edited)).status === 403);
    // The store allows a little clock skew past vercel-blob-valid-until
    // (measured 2026-10-01: still 200 five seconds after, 403 by thirty).
    const short = await ps.presignedGet(ph.url!, 2_000);
    const refusedAt = await untilRefused(short, [401, 403], 90_000);
    ok("a presigned URL past its time is refused by the store (within the store's skew allowance)", refusedAt !== null, refusedAt === null ? "still served after 90 s" : `refused ${Math.round(refusedAt / 1000)} s after it was minted`);
    const dl = await readRoute(new Request("http://qa" + mediaHref(ph.url, { download: "photo.jpg" })!));
    const dlr = await fetch(dl.headers.get("location") ?? "");
    ok("Download asks the browser to save it", /attachment/i.test(dlr.headers.get("content-disposition") ?? ""), dlr.headers.get("content-disposition") ?? "");
    const u = new URL("http://qa" + href);
    ok("our short link is refused after 15 minutes (410)", (verifyMediaLink(u.searchParams, Date.now() + 16 * 60_000) as { reason?: string }).reason === "expired");
    ok("the job page does not load for a worker who is not on it", (await loadJobDetail(w.jobId, w.orgId, "INSTALLER", w.outsider.userId)) === null);

    head("R4 · deletes reach the store");
    const photoRow = rows.photos[0];
    await deleteJobMediaFor({ organizationId: w.orgId, userId: A.userId, role: "INSTALLER" } as never, photoRow);
    ok("deleting the photo removes the row and the stored file", (await db.jobPhoto.findUnique({ where: { id: photoRow } })) === null && !(await ps.storedExists(ph.url!)));
    const goneAt = await untilRefused(loc, [403, 404], 90_000);
    ok("… and its old presigned URL stops working", goneAt !== null, goneAt === null ? "still served after 90 s" : `gone after ${Math.round(goneAt / 1000)} s`);
    if (rows.photos[1]) {
      const v = await db.jobPhoto.findUnique({ where: { id: rows.photos[1] } });
      await deleteJobMediaFor({ organizationId: w.orgId, userId: A.userId, role: "INSTALLER" } as never, rows.photos[1]);
      ok("deleting the video removes it from the store", !!v && !(await ps.storedExists(v.url)));
    }
    const rc2 = await direct(B.token, w.jobId, "receipts", "receipt2.jpg", "image/jpeg", fs.readFileSync("public/landing-d/project-2.jpg"));
    const bWorker = { organizationId: w.orgId, userId: B.userId, role: "WORKER_TOKEN", workerId: B.workerId, name: B.name };
    await editJobExpense(bWorker, recRj.id!, { receiptUrl: rc2.url });
    ok("replacing a receipt's picture removes the old one from the store", !(await ps.storedExists(rc.url!)) && (await ps.storedExists(rc2.url!)));
    await deleteJobExpense(bWorker, recRj.id!);
    ok("deleting the receipt removes its picture from the store", !(await ps.storedExists(rc2.url!)));

    head("R5 · the orphan report reads the real store");
    const orphan = await ps.putPrivate(`jobs/${w.jobId}/qa-orphan.jpg`, Buffer.alloc(512, 3), "image/jpeg");
    stored.push(orphan.url);
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync(process.execPath, [require.resolve("tsx/cli"), "--tsconfig", "tsconfig.json", "scripts/maintenance/media-orphans.ts", "--json"], { encoding: "utf8", env: { ...process.env } });
    const rep = JSON.parse(out.slice(out.indexOf("{"))) as { summary: { mode: string }; orphans: Array<{ where: string; url: string }> };
    ok("the report lists the store's file that no row names", rep.summary.mode === "blob" && rep.orphans.some((o) => o.where === "private store" && o.url === orphan.url), `storage ${rep.summary.mode}, ${rep.orphans.length} orphan(s)`);
    ok("… and deletes nothing", await ps.storedExists(orphan.url));
  } finally {
    for (const id of rows.expenses) await db.jobExpense.delete({ where: { id } }).catch(() => {});
    for (const url of stored) await ps.deleteStored(url);
    const left = [];
    for (const url of stored) if (await ps.storedExists(url)) left.push(url);
    ok("everything this check put in the store is gone", left.length === 0, left.join(" "));
    await w.cleanup();
  }
}

(REAL ? realMain() : main())
  .then(() => {
    if (REAL) {
      console.log(`\n${passes} passed, ${failures} failed`);
      if (failures) process.exit(1);
    }
  })
  .catch((e) => { console.error(e); process.exit(1); });
