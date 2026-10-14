import "server-only";
// THE INVESTOR LINK'S READERS AND OFFERS (2026-10-13) — who introduced themselves on /investors/<token>, how often
// they came back, and the VC offers sent from the page. Kept as SyncState JSON lists (no schema change), newest
// first. A reader's pass is a cookie signed with the auth secret AND the link's token, so a new link asks again and a
// cookie cannot be made up. Every introduction and every offer is emailed to the platform admins (the support
// recipients); an offer is sent with the investor's address as reply-to, so answering is one click.
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/sdk/resend";
import { renderEmail } from "@/lib/email/renderEmail";
import { appBaseUrl } from "@/lib/appUrl";
import { platformAlertRecipients } from "@/lib/integrationsAlertRecipients";
import { INVESTING_KINDS, type InvestorIntroInput, type InvestorOfferInput, type InvestorVisitorView } from "@/lib/investorGate";

const VISITORS_KEY = "investorVisitors";
const OFFERS_KEY = "investorOffers";
export const INVESTOR_PASS_COOKIE = "jf_inv";
const PASS_DAYS = 180;
const VISIT_GAP_MS = 30 * 60_000;

export interface InvestorVisitor extends InvestorVisitorView {
  id: string;
  at: string;
  lastSeen: string;
  visits: number;
  /** The link it was made on (its making time) — a new link starts a new list of readers. */
  linkMadeAt: string | null;
}

export interface InvestorOffer extends InvestorOfferInput {
  id: string;
  at: string;
  visitorId: string | null;
}

async function readList<T>(key: string): Promise<T[]> {
  const row = await db.syncState.findUnique({ where: { key } }).catch(() => null);
  if (!row) return [];
  try {
    const v = JSON.parse(row.cursor) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}
async function writeList<T>(key: string, list: T[], cap: number): Promise<void> {
  const cursor = JSON.stringify(list.slice(0, cap));
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
}

export const readInvestorVisitors = () => readList<InvestorVisitor>(VISITORS_KEY);
export const readInvestorOffers = () => readList<InvestorOffer>(OFFERS_KEY);

// ── the reader's pass ──
function secret(): string {
  return process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "jobflex-investor-pass";
}
function sign(id: string, exp: number, token: string): string {
  return createHmac("sha256", secret()).update(`${id}.${exp}.${token}`).digest("base64url");
}
function passFor(id: string, token: string): { value: string; maxAge: number } {
  const exp = Date.now() + PASS_DAYS * 86_400_000;
  return { value: `${id}.${exp}.${sign(id, exp, token)}`, maxAge: PASS_DAYS * 86_400 };
}
/** The visitor id the cookie carries for this link, or null (none, forged, expired, another link's). */
export function verifyPass(raw: string | undefined | null, token: string): string | null {
  if (!raw) return null;
  const [id, expS, sig] = raw.split(".");
  const exp = Number(expS);
  if (!id || !sig || !Number.isFinite(exp) || exp < Date.now()) return null;
  const want = Buffer.from(sign(id, exp, token));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

/** The reader this browser introduced on this link — and a visit counted when they come back after a while. */
export async function visitorForLink(token: string, opts: { countVisit?: boolean } = {}): Promise<InvestorVisitor | null> {
  const id = verifyPass((await cookies()).get(INVESTOR_PASS_COOKIE)?.value, token);
  if (!id) return null;
  const list = await readInvestorVisitors();
  const i = list.findIndex((v) => v.id === id);
  if (i < 0) return null;
  const v = list[i];
  if (opts.countVisit && Date.now() - Date.parse(v.lastSeen) > VISIT_GAP_MS) {
    const next = { ...v, visits: v.visits + 1, lastSeen: new Date().toISOString() };
    list[i] = next;
    await writeList(VISITORS_KEY, list, 1000).catch(() => {});
    return next;
  }
  return v;
}

// ── the emails ──
async function tellAdmins(subject: string, headline: string, rows: Array<{ label: string; value: string }>, prose: string[], replyTo?: string): Promise<void> {
  const to = await platformAlertRecipients();
  if (!to.length) return;
  const base = (await appBaseUrl()).replace(/\/$/, "");
  const { subject: subj, html } = renderEmail({
    subject,
    lockup: { kind: "platform" },
    kicker: { text: "Investor link", tone: "ok" },
    headline,
    prose,
    box: rows.filter((r) => r.value).map((r) => ({ type: "field" as const, label: r.label, value: r.value })),
    cta: { label: "See who opened it", href: `${base}/admin/investors#audience` },
    footer: { name: "JobFlex" },
  });
  for (const address of to) {
    try {
      await sendEmail({ to: address, subject: subj, html, ...(replyTo ? { replyTo } : {}) });
    } catch (err) {
      console.error("[investors] admin email failed:", err instanceof Error ? err.message : err);
    }
  }
}

/** A reader introduces themselves: kept, the admins told, and this browser given its pass for the link. */
export async function introduceVisitor(token: string, linkMadeAt: string | null, input: InvestorIntroInput): Promise<InvestorVisitor> {
  const list = await readInvestorVisitors();
  const now = new Date().toISOString();
  // The same person on the same link (same email) is one reader who came back, not two.
  const same = list.findIndex((v) => v.email === input.email && v.linkMadeAt === linkMadeAt);
  let visitor: InvestorVisitor;
  if (same >= 0) {
    visitor = { ...list[same], name: input.name, company: input.company, kind: input.kind, phone: input.phone ?? list[same].phone, visits: list[same].visits + 1, lastSeen: now };
    list.splice(same, 1);
  } else {
    visitor = { id: randomBytes(9).toString("base64url"), at: now, lastSeen: now, visits: 1, linkMadeAt, name: input.name, company: input.company, kind: input.kind, email: input.email, phone: input.phone ?? null };
  }
  await writeList(VISITORS_KEY, [visitor, ...list], 1000);
  const pass = passFor(visitor.id, token);
  (await cookies()).set(INVESTOR_PASS_COOKIE, pass.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: pass.maxAge });
  await tellAdmins(
    `Investor link opened — ${visitor.name}, ${visitor.company}`,
    same >= 0 ? `${visitor.name} came back to the investor page` : `${visitor.name} opened the investor page`,
    [
      { label: "Name", value: visitor.name },
      { label: "Company", value: visitor.company },
      { label: "Business", value: visitor.kind },
      { label: "Email", value: visitor.email },
      { label: "Phone", value: visitor.phone ?? "" },
    ],
    [INVESTING_KINDS.has(visitor.kind) ? `An investor (${visitor.kind.toLowerCase()}) is reading the live figures now.` : `They describe themselves as: ${visitor.kind.toLowerCase()}.`],
  ).catch(() => {});
  return visitor;
}

/** An offer from the page: kept, and emailed to the admins with the investor as reply-to. */
export async function recordOffer(visitorId: string | null, input: InvestorOfferInput): Promise<InvestorOffer> {
  const offer: InvestorOffer = { ...input, id: randomBytes(9).toString("base64url"), at: new Date().toISOString(), visitorId };
  const list = await readInvestorOffers();
  await writeList(OFFERS_KEY, [offer, ...list], 300);
  await tellAdmins(
    `VC offer — ${offer.company}: ${offer.amount} · ${offer.instrument}`,
    `${offer.company} sent ${offer.type === "Term sheet" ? "a term sheet" : offer.type === "Intro call first" ? "a request for an intro call" : "an investment interest"}`,
    [
      { label: "From", value: `${offer.name} · ${offer.company}` },
      { label: "Email", value: offer.email },
      { label: "Phone", value: offer.phone ?? "" },
      { label: "What", value: offer.type },
      { label: "Amount", value: offer.amount },
      { label: "Instrument", value: offer.instrument },
      { label: "Valuation / cap", value: offer.valuation ?? "" },
      { label: "Timeline", value: offer.timeline },
    ],
    offer.message ? [`"${offer.message}"`, "Reply to this email to answer them directly."] : ["Reply to this email to answer them directly."],
    offer.email,
  ).catch(() => {});
  return offer;
}
