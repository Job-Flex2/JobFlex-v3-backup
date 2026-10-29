// WISETACK FINANCING — where it is kept: SyncState rows (JSON in `cursor`), no schema change.
//   financing:<orgId>            the contractor's record (OrgFinancing)
//   financingOffer:<proposalId>  the proposal's switch when it differs from the default ("1" / "0")
//   financingLoan:<proposalId>   the client's live loan (Loan)
//   financingLoanRef:<loanRef>   → proposalId, for Wisetack's webhook
//   financingSwitch              JobFlex's admin switch (off / pilot / all)

import { db } from "@/lib/db";
import { parseLoan, parseOrgFinancing, parseSwitch, type FinancingSwitch, type Loan, type OrgFinancing } from "./state";

const ORG = "financing:";
const OFFER = "financingOffer:";
const LOAN = "financingLoan:";
const LOAN_REF = "financingLoanRef:";
const SWITCH = "financingSwitch";

async function read(key: string): Promise<string | null> {
  const row = await db.syncState.findUnique({ where: { key } }).catch(() => null);
  return row?.cursor ?? null;
}
async function write(key: string, value: string): Promise<void> {
  await db.syncState.upsert({ where: { key }, update: { cursor: value }, create: { key, cursor: value } });
}
async function readMany(prefix: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.syncState.findMany({ where: { key: { in: ids.map((id) => prefix + id) } } }).catch(() => []);
  return new Map(rows.map((r) => [r.key.slice(prefix.length), r.cursor]));
}

export async function readOrgFinancing(orgId: string): Promise<OrgFinancing> {
  return parseOrgFinancing(await read(ORG + orgId));
}
export async function writeOrgFinancing(orgId: string, rec: OrgFinancing): Promise<void> {
  await write(ORG + orgId, JSON.stringify(rec));
}
export async function readOrgFinancings(orgIds: string[]): Promise<Map<string, OrgFinancing>> {
  const raw = await readMany(ORG, orgIds);
  return new Map(orgIds.map((id) => [id, parseOrgFinancing(raw.get(id))]));
}

export async function readSwitch(): Promise<FinancingSwitch> {
  return parseSwitch(await read(SWITCH));
}
export async function writeSwitch(sw: FinancingSwitch): Promise<void> {
  await write(SWITCH, JSON.stringify(sw));
}

export async function readOffer(proposalId: string): Promise<boolean | null> {
  const v = await read(OFFER + proposalId);
  return v === "1" ? true : v === "0" ? false : null;
}
/** null = follow the company's default (the row goes). */
export async function writeOffer(proposalId: string, on: boolean | null): Promise<void> {
  if (on === null) await db.syncState.deleteMany({ where: { key: OFFER + proposalId } });
  else await write(OFFER + proposalId, on ? "1" : "0");
}
export async function readOffers(ids: string[]): Promise<Map<string, boolean>> {
  const raw = await readMany(OFFER, ids);
  const out = new Map<string, boolean>();
  for (const [id, v] of raw) if (v === "1" || v === "0") out.set(id, v === "1");
  return out;
}

export async function readLoan(proposalId: string): Promise<Loan | null> {
  return parseLoan(await read(LOAN + proposalId));
}
export async function writeLoan(proposalId: string, l: Loan): Promise<void> {
  await write(LOAN + proposalId, JSON.stringify(l));
  await write(LOAN_REF + l.ref, proposalId);
}
export async function readLoans(ids: string[]): Promise<Map<string, Loan>> {
  const raw = await readMany(LOAN, ids);
  const out = new Map<string, Loan>();
  for (const [id, v] of raw) {
    const l = parseLoan(v);
    if (l) out.set(id, l);
  }
  return out;
}
export async function proposalForLoanRef(ref: string): Promise<string | null> {
  return read(LOAN_REF + ref);
}

/** Every contractor with a record (the admin board, the reconcile, a webhook's merchant lookup). */
export async function listOrgFinancing(): Promise<Array<{ orgId: string; rec: OrgFinancing }>> {
  const rows = await db.syncState.findMany({ where: { key: { startsWith: ORG } }, take: 2000 }).catch(() => []);
  return rows.map((r) => ({ orgId: r.key.slice(ORG.length), rec: parseOrgFinancing(r.cursor) }));
}
export async function listLoans(): Promise<Array<{ proposalId: string; loan: Loan }>> {
  const rows = await db.syncState.findMany({ where: { key: { startsWith: LOAN } }, take: 2000 }).catch(() => []);
  const out: Array<{ proposalId: string; loan: Loan }> = [];
  for (const r of rows) {
    const l = parseLoan(r.cursor);
    if (l) out.push({ proposalId: r.key.slice(LOAN.length), loan: l });
  }
  return out;
}
export async function orgIdForMerchantRef(ref: string): Promise<string | null> {
  return (await listOrgFinancing()).find((o) => o.rec.merchantRef === ref)?.orgId ?? null;
}
