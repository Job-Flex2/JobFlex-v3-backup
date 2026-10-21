// THE TEAM'S LIST AND WHO HAS WHICH TASK — server only, no schema change (2026-10-15).
//
//   adminTeam:members:v1   the list: [{ id, name, phone, on, hours?, addedAt, alerts? }]
//   adminTeam:assign:v1    taskId → member id, for a task given to someone on the list (its assignee column stays
//                          empty — that column only takes a sign-in account)
//   adminTeam:confirm:v1   taskId → { member, at, how }: they said they'll do it — replied OK to the text, or took
//                          it in admin themselves. Gone when the task goes to someone else.
//
// Every read and write takes the client it is given, so the service writes the pairing in the same transaction as
// the task and its journal.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { cleanMembers, isMemberRef, memberIdOf, memberRef, type TeamMember } from "./teamShared";
import type { AdminPersonDTO, TaskRowDTO } from "./model";

type Client = Prisma.TransactionClient | typeof db;

const MEMBERS = "adminTeam:members:v1";
const ASSIGN = "adminTeam:assign:v1";
const CONFIRM = "adminTeam:confirm:v1";

export type Confirmation = { member: string; at: string; how: "text" | "admin" };

/** Never throws: a list that can't be read is an empty list (the tasks page still opens). */
async function readJson(client: Client, key: string): Promise<unknown> {
  try {
    const row = await client.syncState.findUnique({ where: { key }, select: { cursor: true } });
    return row ? (JSON.parse(row.cursor) as unknown) : null;
  } catch {
    return null;
  }
}
async function writeJson(client: Client, key: string, value: unknown): Promise<void> {
  const cursor = JSON.stringify(value);
  await client.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
}

export async function readMembers(client: Client = db): Promise<TeamMember[]> {
  return cleanMembers(await readJson(client, MEMBERS));
}
export async function writeMembers(list: TeamMember[], client: Client = db): Promise<void> {
  await writeJson(client, MEMBERS, list);
}

export async function readAssignments(client: Client = db): Promise<Record<string, string>> {
  const v = await readJson(client, ASSIGN);
  const out: Record<string, string> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) for (const [k, m] of Object.entries(v as Record<string, unknown>)) if (typeof m === "string") out[k] = m;
  return out;
}

export async function readConfirmations(client: Client = db): Promise<Record<string, Confirmation>> {
  const v = await readJson(client, CONFIRM);
  const out: Record<string, Confirmation> = {};
  if (v && typeof v === "object" && !Array.isArray(v))
    for (const [k, c] of Object.entries(v as Record<string, unknown>)) {
      const o = c as Record<string, unknown> | null;
      if (o && typeof o.member === "string" && typeof o.at === "string") out[k] = { member: o.member, at: o.at, how: o.how === "admin" ? "admin" : "text" };
    }
  return out;
}

/** They said they'll do it. */
export async function setConfirmed(taskId: string, memberId: string, how: Confirmation["how"], client: Client = db, now = new Date()): Promise<void> {
  const map = await readConfirmations(client);
  map[taskId] = { member: memberId, at: now.toISOString(), how };
  await writeJson(client, CONFIRM, map);
}

/** Give a task to a member (or take it back from whoever on the list had it: null). A confirmation by anyone else
 *  goes with it. */
export async function setAssignment(taskId: string, memberId: string | null, client: Client = db): Promise<void> {
  const conf = await readConfirmations(client);
  if (conf[taskId] && conf[taskId].member !== memberId) {
    delete conf[taskId];
    await writeJson(client, CONFIRM, conf);
  }
  const map = await readAssignments(client);
  if (memberId) map[taskId] = memberId;
  else if (taskId in map) delete map[taskId];
  else return;
  await writeJson(client, ASSIGN, map);
}

/** Forget every task a member had (they left the list) — the task ids, so they can be touched. */
export async function dropMemberAssignments(memberId: string, client: Client = db): Promise<string[]> {
  const map = await readAssignments(client);
  const ids = Object.keys(map).filter((k) => map[k] === memberId);
  if (!ids.length) return [];
  for (const k of ids) delete map[k];
  await writeJson(client, ASSIGN, map);
  return ids;
}

/** The team as people a task can go to ("m:<id>"), for the selects and the filters. */
export function memberPeople(members: readonly TeamMember[]): AdminPersonDTO[] {
  return members.map((m) => ({ id: memberRef(m.id), email: "", name: m.name }));
}

/** The team's side of the tasks, read together. */
export type TeamState = { members: TeamMember[]; assign: Record<string, string>; confirm: Record<string, Confirmation> };
export async function readTeamState(client: Client = db): Promise<TeamState> {
  const [members, assign, confirm] = await Promise.all([readMembers(client), readAssignments(client), readConfirmations(client)]);
  return { members, assign, confirm };
}

/** A row as the page shows it: a task given to someone on the list carries their "m:<id>", their name, and when they
 *  said they'll do it. */
export function withMember<T extends TaskRowDTO>(row: T, team: TeamState): T {
  if (row.assigneeId) return row;
  const id = team.assign[row.id];
  const m = id ? team.members.find((x) => x.id === id) : null;
  if (!m) return row;
  const c = team.confirm[row.id];
  return { ...row, assigneeId: memberRef(m.id), assigneeName: m.name, confirmedAt: c && c.member === m.id ? c.at : null, confirmedBy: c && c.member === m.id ? c.how : null };
}

/** The member a task is given to, or null. */
export function memberOfRef(ref: string | null | undefined, members: readonly TeamMember[]): TeamMember | null {
  return isMemberRef(ref) ? members.find((m) => m.id === memberIdOf(ref)) ?? null : null;
}
