// THE HOME DASHBOARD (2026-10-03) — server only.
//
// Owner: "when a client submits a project, it automatically creates their
// dashboard, accessible at any time, where they keep all their projects, read
// the proposals, talk to the contractor, plan the next job and get reminded
// to submit it — without setting anything up." One Home per homeowner, made
// by the first request and keyed by the email they typed; the emailed link
// (/home/[key]) is the login, like every other page a homeowner gets. Each
// later request with that email joins it.
//
// Who may see what: the page is reached only through the key. The key is
// shown on screen right after a submission ONLY when nothing older exists
// for that email (a first-timer) or the request was made from the dashboard
// itself; otherwise it travels by email, because the intake is public and
// anyone can type someone else's address.
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { buildRequestPortal, type PortalOrg, type RequestPortalView } from "@/lib/requestPortal";
import { parseBookingSettings } from "@/lib/booking";
import { parseTradeTypes } from "@/lib/tradeTypes";
import { planWhen, remindModeOf, validTimeZone, type RemindMode } from "./dates";
import { listFolder, type FolderFileView, type FolderRequestView } from "./files";
import { storageMode, type StorageMode } from "@/lib/media/privateStore";
import type { WizardPrefill } from "./prefill";

export { mayShowHomeKey, planDate, planWhen, reminderFor, validTimeZone } from "./dates";

export const HOME_TZ_DEFAULT = "America/Los_Angeles";
const DASHBOARD_PROJECTS = 24;

export const homePath = (key: string) => `/home/${encodeURIComponent(key)}`;

const cleanEmail = (e: string) => e.trim().toLowerCase();

export type HomeRow = NonNullable<Awaited<ReturnType<typeof findHomeByKey>>>;

export function findHomeByKey(key: string) {
  return db.home.findUnique({ where: { accessToken: key } });
}

export async function homeUrl(key: string): Promise<string> {
  return `${await appBaseUrl()}${homePath(key)}`;
}

/** The dashboard link for a request's homeowner — adopting the request into the
 *  home that carries its email when the intake predates homes. Null when there
 *  is no home for it at all (never made: this request came before the feature
 *  and no later one followed). */
export async function homeUrlForLead(pl: { id: string; homeId: string | null; email: string }): Promise<string | null> {
  if (pl.homeId) {
    const h = await db.home.findUnique({ where: { id: pl.homeId }, select: { accessToken: true } });
    if (h) return homeUrl(h.accessToken);
  }
  const h = await db.home.findUnique({ where: { email: cleanEmail(pl.email) }, select: { id: true, accessToken: true } });
  if (!h) return null;
  await db.platformLead.updateMany({ where: { id: pl.id, homeId: null }, data: { homeId: h.id } }).catch(() => null);
  return homeUrl(h.accessToken);
}

export type NewHomeInput = {
  name: string;
  email: string;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  timezone?: string | null;
};

/** The home for this email — found, with its blanks filled, or made now. */
export async function findOrCreateHome(input: NewHomeInput): Promise<{ home: HomeRow; isNew: boolean }> {
  const email = cleanEmail(input.email);
  const tz = validTimeZone(input.timezone) ? input.timezone! : null;
  const found = await db.home.findUnique({ where: { email } });
  if (found) {
    const fill: Record<string, string> = {};
    if (!found.phone && input.phone?.trim()) fill.phone = input.phone.trim();
    if (!found.address && input.address?.trim()) {
      fill.address = input.address.trim();
      if (input.city?.trim()) fill.city = input.city.trim();
      if (input.state?.trim()) fill.state = input.state.trim();
      if (input.zip?.trim()) fill.zip = input.zip.trim();
    }
    if (!found.timezone && tz) fill.timezone = tz;
    const home = Object.keys(fill).length ? await db.home.update({ where: { id: found.id }, data: fill }) : found;
    return { home, isNew: false };
  }
  const home = await db.home.create({
    data: {
      email,
      name: input.name.trim() || "Homeowner",
      phone: input.phone?.trim() || null,
      address: input.address?.trim() || null,
      city: input.city?.trim() || null,
      state: input.state?.trim() || null,
      zip: input.zip?.trim() || null,
      timezone: tz,
      accessToken: randomBytes(18).toString("base64url"),
    },
  });
  return { home, isNew: true };
}

/** Requests made with this home's email before it existed join it. Returns how many did. */
/** The intake prefilled from a home (and a plan on it) — /homeowner?home=&plan=. */
export async function loadWizardPrefill(key: string | null | undefined, planId?: string | null, withOrgId?: string | null): Promise<WizardPrefill | null> {
  if (!key) return null;
  const home = await findHomeByKey(key);
  if (!home) return null;
  const plan = planId ? await db.homePlan.findFirst({ where: { id: planId, homeId: home.id, status: "PLANNED" } }) : null;
  // "Hire again": only a shop that had one of this home's requests; the ask
  // goes in the homeowner's own words, where the Lead Center reads it.
  let again = "";
  if (withOrgId) {
    const had = await db.platformLead.findFirst({ where: { homeId: home.id, OR: [{ matchedOrgId: withOrgId }, { offers: { some: { organizationId: withOrgId } } }] }, select: { detectedTrade: true, projectType: true, createdAt: true } });
    const org = had ? await db.organization.findUnique({ where: { id: withOrgId }, select: { name: true, deletedAt: true } }) : null;
    if (had && org && !org.deletedAt) again = `Please send this to ${org.name} again — they did my ${(had.detectedTrade ?? had.projectType ?? "last project").toLowerCase()} in ${had.createdAt.getFullYear()}. `;
  }
  return {
    name: home.name,
    email: home.email,
    phone: home.phone ?? "",
    address: home.address ?? "",
    zip: home.zip ?? "",
    homeKey: key,
    planId: plan?.id ?? null,
    description: `${again}${plan ? `${plan.title}${plan.notes ? ` — ${plan.notes}` : ""}` : ""}`,
  };
}

export async function adoptLeads(home: { id: string; email: string }): Promise<number> {
  const orphans = await db.platformLead.findMany({ where: { homeId: null }, select: { id: true, email: true }, take: 5000 });
  const mine = orphans.filter((o) => cleanEmail(o.email) === home.email).map((o) => o.id);
  if (!mine.length) return 0;
  const r = await db.platformLead.updateMany({ where: { id: { in: mine } }, data: { homeId: home.id } });
  return r.count;
}

// ── the dashboard ─────────────────────────────────────────────────────────

export interface HomePlanView {
  id: string;
  title: string;
  notes: string | null;
  /** YYYY-MM-DD (UTC date) — a month plan on its first day. */
  date: string;
  wholeMonth: boolean;
  when: string;
  status: string;
  /** The next reminder, when one is booked. */
  remindAt: string | null;
  /** The form's choice this reminder stands for. */
  remindMode: RemindMode;
  /** The first reminder went; the next is the last nudge. */
  reminded: boolean;
  /** The request it became, when submitted. */
  token: string | null;
}

export interface HomeMessageView {
  id: string;
  body: string;
  at: string;
  emailed: boolean;
}

export interface HomeContractor {
  org: PortalOrg;
  projects: number;
  lastAt: string;
  /** /book/<slug> when the shop takes bookings; null otherwise. */
  bookingHref: string | null;
  /** The intake, asking for this shop again (the Lead Center reads the ask). */
  hireHref: string;
}

export interface HomeMembership {
  name: string;
  orgName: string;
  /** SENT (offered, not yet accepted) | ACTIVE */
  status: string;
  href: string;
  nextVisit: { label: string; at: string } | null;
  endsAt: string | null;
}

export interface HomeNeed {
  /** `due`: a payment the shop arranges itself (no online payment) — shown, never a Pay button (2026-10-14). */
  kind: "proposal" | "pay" | "due" | "change" | "visit" | "review" | "plan" | "files";
  text: string;
  href: string;
  at: string | null;
}

export interface HomeCalendarItem {
  /** YYYY-MM-DD in the home's zone. */
  date: string;
  kind: "plan" | "visit" | "request" | "proposal" | "hired";
  label: string;
  href: string | null;
}

export interface HomeDocument {
  label: string;
  href: string;
  kind: "proposal" | "pdf" | "change";
  orgName: string;
  at: string;
}

export interface HomeActivity {
  at: string;
  text: string;
  /** "Roofing · Bothell, WA" — which project it belongs to. */
  project: string;
  href: string;
}

export interface HomeDashboard {
  key: string;
  name: string;
  firstName: string;
  /** Seen the dashboard before this visit. */
  returning: boolean;
  /** What the homeowner told us, editable on the dashboard. */
  details: { name: string; email: string; phone: string; address: string; city: string; state: string; zip: string };
  documents: HomeDocument[];
  activity: HomeActivity[];
  /** Each project's job folder, by the request's token (lib/home/files). */
  folders: Record<string, { files: FolderFileView[]; requests: FolderRequestView[] }>;
  /** How files are stored on this server: "inline" = small pictures only. */
  storage: StorageMode;
  email: string;
  phone: string | null;
  address: string | null;
  place: string | null;
  since: string;
  timeZone: string;
  projects: RequestPortalView[];
  needs: HomeNeed[];
  contractors: HomeContractor[];
  memberships: HomeMembership[];
  plans: HomePlanView[];
  calendar: HomeCalendarItem[];
  messages: Record<string, HomeMessageView[]>;
  stats: { projects: number; hired: number; spent: number };
}

const usd0 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function ymdIn(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export async function loadHomeDashboard(key: string, now = new Date()): Promise<HomeDashboard | null> {
  const home = await findHomeByKey(key);
  if (!home) return null;
  await adoptLeads(home);
  const returning = Boolean(home.lastSeenAt);
  db.home.update({ where: { id: home.id }, data: { lastSeenAt: now } }).catch(() => null);
  const tz = home.timezone && validTimeZone(home.timezone) ? home.timezone : HOME_TZ_DEFAULT;

  const [leads, planRows, messageRows] = await Promise.all([
    db.platformLead.findMany({
      where: { homeId: home.id },
      orderBy: { createdAt: "desc" },
      take: DASHBOARD_PROJECTS,
      include: { offers: { orderBy: { createdAt: "asc" } }, home: { select: { accessToken: true } } },
    }),
    db.homePlan.findMany({ where: { homeId: home.id, status: { in: ["PLANNED", "SUBMITTED"] } }, orderBy: { plannedFor: "asc" } }),
    db.homeMessage.findMany({ where: { homeId: home.id }, orderBy: { createdAt: "desc" }, take: 60 }),
  ]);
  const projects = await Promise.all(leads.map((pl) => buildRequestPortal(pl)));
  const folders: HomeDashboard["folders"] = {};
  await Promise.all(leads.map(async (pl) => { folders[pl.accessToken ?? ""] = await listFolder(pl.id, key); }));
  const tokenById = new Map(leads.map((l) => [l.id, l.accessToken ?? ""]));

  // Contractors: every shop a project is or was with, newest first.
  const seen = new Map<string, HomeContractor>();
  const orgIds: string[] = [];
  for (const p of projects) {
    const orgs = [...(p.current ? [p.current.org] : []), ...p.previous.map((x) => x.org)];
    for (const org of orgs) {
      const c = seen.get(org.id);
      if (c) c.projects += 1;
      else {
        seen.set(org.id, { org, projects: 1, lastAt: p.submittedAt, bookingHref: null, hireHref: `/homeowner?home=${encodeURIComponent(key)}&with=${encodeURIComponent(org.id)}` });
        orgIds.push(org.id);
      }
    }
  }
  if (orgIds.length) {
    const rows = await db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, slug: true, bookingSettingsJson: true, tradeTypesJson: true } });
    for (const o of rows) {
      const c = seen.get(o.id);
      if (c && parseBookingSettings(o.bookingSettingsJson, parseTradeTypes(o.tradeTypesJson)).enabled) c.bookingHref = `/book/${encodeURIComponent(o.slug)}`;
    }
  }

  // Reviews waiting: a shop asked, the homeowner has not answered. And the
  // memberships (service plans) a shop offered or runs for them.
  const clientIds = projects.flatMap((p) => p.clients.map((c) => c.clientId));
  const [reviews, planRowsSp] = clientIds.length
    ? await Promise.all([
        db.reviewRequest.findMany({ where: { clientId: { in: clientIds }, status: "SENT", completedAt: null, hiddenAt: null }, select: { publicToken: true, organizationId: true, sentAt: true } }),
        db.servicePlan.findMany({
          where: { clientId: { in: clientIds }, status: { in: ["SENT", "ACTIVE"] } },
          orderBy: { createdAt: "desc" },
          include: { organization: { select: { name: true } }, visits: { where: { status: "SCHEDULED" }, orderBy: { dueAt: "asc" }, take: 1 } },
        }),
      ])
    : [[], []];
  const memberships: HomeMembership[] = planRowsSp.map((sp) => ({
    name: sp.name,
    orgName: sp.organization.name,
    status: sp.status,
    href: `/plan/${encodeURIComponent(sp.acceptToken)}`,
    nextVisit: sp.visits[0] ? { label: sp.visits[0].label, at: sp.visits[0].dueAt.toISOString() } : null,
    endsAt: sp.endsAt?.toISOString() ?? null,
  }));

  // What needs the homeowner now, most pressing first.
  const needs: HomeNeed[] = [];
  for (const p of projects) {
    const href = `/request/${encodeURIComponent(p.token)}`;
    for (const c of p.changeOrders) needs.push({ kind: "change", text: `${p.current?.org.name ?? "Your contractor"} sent a change to approve: ${c.title}`, href: `/co/${encodeURIComponent(c.token)}`, at: null });
    for (const q of p.proposals) {
      if (q.current && (q.stage === "NEW" || q.stage === "OPENED")) needs.push({ kind: "proposal", text: `${q.orgName}'s proposal is ready: ${q.title}`, href: `/portal/q/${encodeURIComponent(q.publicId)}`, at: q.sentAt });
    }
    for (const v of p.visits) {
      if (Date.parse(v.startsAt) - now.getTime() < 7 * 24 * 60 * 60_000) needs.push({ kind: "visit", text: `${v.orgName}: ${v.title}`, href, at: v.startsAt });
    }
  }
  for (const r of reviews) {
    const org = seen.get(r.organizationId)?.org;
    needs.push({ kind: "review", text: `${org?.name ?? "A contractor"} asked for a review`, href: `/review/${encodeURIComponent(r.publicToken)}`, at: r.sentAt?.toISOString() ?? null });
  }
  for (const m of memberships) if (m.status === "SENT") needs.push({ kind: "plan", text: `${m.orgName} offered you a plan: ${m.name}`, href: m.href, at: null });
  for (const p of projects) {
    for (const r of folders[p.token]?.requests ?? []) {
      if (!r.fulfilledAt) needs.push({ kind: "files", text: `${r.orgName} asks for pictures${r.note ? `: “${r.note}”` : ""}`, href: `#folder-${encodeURIComponent(p.token)}`, at: r.at });
    }
  }
  for (const p of projects) {
    for (const q of p.proposals) {
      if (q.current && q.nextDue && q.remaining > 0) needs.push(q.payOnline
        ? { kind: "pay", text: `${q.orgName}: ${q.nextDue.label} due — ${usd0(q.nextDue.amount)}`, href: `/portal/q/${encodeURIComponent(q.publicId)}`, at: null }
        : { kind: "due", text: `${q.orgName}: ${q.nextDue.label} due — ${usd0(q.nextDue.amount)} · they'll tell you how to pay`, href: `/portal/q/${encodeURIComponent(q.publicId)}`, at: null });
    }
  }
  for (const pl of planRows) {
    if (pl.status === "PLANNED" && pl.plannedFor.getTime() <= now.getTime()) needs.push({ kind: "plan", text: `You planned: ${pl.title} — ready to submit it?`, href: `/homeowner?home=${encodeURIComponent(key)}&plan=${encodeURIComponent(pl.id)}`, at: pl.plannedFor.toISOString() });
  }

  const plans: HomePlanView[] = planRows.map((p) => ({
    id: p.id,
    title: p.title,
    notes: p.notes,
    date: p.plannedFor.toISOString().slice(0, 10),
    wholeMonth: p.wholeMonth,
    when: planWhen(p.plannedFor, p.wholeMonth),
    status: p.status,
    remindAt: p.remindAt?.toISOString() ?? null,
    remindMode: p.remindedAt ? (p.remindAt ? "start" : "none") : remindModeOf(p.plannedFor, p.remindAt),
    reminded: Boolean(p.remindedAt),
    token: p.platformLeadId ? tokenById.get(p.platformLeadId) || null : null,
  }));

  // The calendar: plans, visits, the requests and what came of them.
  const calendar: HomeCalendarItem[] = [];
  for (const p of plans) if (p.status === "PLANNED") calendar.push({ date: p.date, kind: "plan", label: p.title, href: null });
  for (const m of memberships) if (m.nextVisit) calendar.push({ date: ymdIn(m.nextVisit.at, tz), kind: "visit", label: `${m.orgName}: ${m.nextVisit.label} (${m.name})`, href: m.href });
  for (const p of projects) {
    const href = `/request/${encodeURIComponent(p.token)}`;
    calendar.push({ date: ymdIn(p.submittedAt, tz), kind: "request", label: `Sent: ${p.trade ?? "request"}`, href });
    for (const v of p.visits) calendar.push({ date: ymdIn(v.startsAt, v.timeZone), kind: "visit", label: `${v.orgName}: ${v.title}`, href });
    for (const q of p.proposals) {
      if (q.sentAt) calendar.push({ date: ymdIn(q.sentAt, tz), kind: "proposal", label: `Proposal: ${q.title}`, href: `/portal/q/${encodeURIComponent(q.publicId)}` });
    }
    for (const e of p.events) if (/^You accepted /.test(e.text)) calendar.push({ date: ymdIn(e.at, tz), kind: "hired", label: e.text.replace(/^You accepted /, "Hired: ").replace(/'s proposal$/, ""), href });
  }
  calendar.sort((a, b) => a.date.localeCompare(b.date));

  const messages: Record<string, HomeMessageView[]> = {};
  for (const m of messageRows) {
    const token = tokenById.get(m.platformLeadId);
    if (!token) continue;
    (messages[token] ??= []).push({ id: m.id, body: m.body, at: m.createdAt.toISOString(), emailed: m.emailed });
  }

  // The paperwork, newest first: every proposal (and its PDF) and every change order.
  const documents: HomeDocument[] = [];
  const activity: HomeActivity[] = [];
  for (const p of projects) {
    const project = `${p.trade ?? "Project"}${p.place ? ` · ${p.place}` : ""}`;
    const href = `/request/${encodeURIComponent(p.token)}`;
    for (const q of p.proposals) {
      documents.push({ label: q.title, href: `/portal/q/${encodeURIComponent(q.publicId)}`, kind: "proposal", orgName: q.orgName, at: q.sentAt ?? p.submittedAt });
      documents.push({ label: `${q.title} — PDF`, href: `/api/public-quote/${encodeURIComponent(q.publicId)}/pdf`, kind: "pdf", orgName: q.orgName, at: q.sentAt ?? p.submittedAt });
    }
    for (const c of p.changeOrders) documents.push({ label: c.number ? `Change order #${c.number} · ${c.title}` : c.title, href: `/co/${encodeURIComponent(c.token)}`, kind: "change", orgName: p.current?.org.name ?? "", at: p.submittedAt });
    for (const e of p.events) activity.push({ at: e.at, text: e.note ? `${e.text} — ${e.note}` : e.text, project, href });
  }
  documents.sort((a, b) => b.at.localeCompare(a.at));
  activity.sort((a, b) => b.at.localeCompare(a.at));

  const hired = projects.filter((p) => p.status2 === "HIRED" || p.status2 === "DONE");
  const spent = Math.round(hired.reduce((n, p) => n + p.proposals.filter((q) => q.current && (q.stage === "ACCEPTED" || q.stage === "PAID" || q.stage === "COMPLETED")).reduce((m, q) => m + q.total + q.approvedChanges, 0), 0) * 100) / 100;
  const place = [home.city, home.state].filter(Boolean).join(", ") || home.zip || projects[0]?.place || null;
  return {
    key,
    name: home.name,
    firstName: home.name.trim().split(/\s+/)[0] || "there",
    returning,
    details: { name: home.name, email: home.email, phone: home.phone ?? "", address: home.address ?? "", city: home.city ?? "", state: home.state ?? "", zip: home.zip ?? "" },
    documents: documents.slice(0, 12),
    activity: activity.slice(0, 10),
    folders,
    storage: storageMode(),
    email: home.email,
    phone: home.phone,
    address: home.address ?? projects.find((p) => p.place)?.place ?? null,
    place,
    since: home.createdAt.toISOString(),
    timeZone: tz,
    projects,
    needs,
    contractors: [...seen.values()],
    memberships,
    plans,
    calendar,
    messages,
    stats: { projects: projects.length, hired: hired.length, spent },
  };
}
