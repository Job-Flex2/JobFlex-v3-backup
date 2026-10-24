// /api/email/unsubscribe?o=<orgId>&t=<hmac> (2026-10-08; lib/adminMail/optout).
//
// GET shows a page with one button — it never unsubscribes by itself: mail
// security scanners open every link in a message, and a GET that acted
// would unsubscribe people who never asked. POST does it: from that page's
// button, or straight from the mail client's own Unsubscribe button (RFC
// 8058 one-click, body "List-Unsubscribe=One-Click"). A bad or missing
// token changes nothing.
import { db } from "@/lib/db";
import { verifyUnsubscribe, writeOptOut } from "@/lib/adminMail/optout";

export const dynamic = "force-dynamic";

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · JobFlex</title></head>
<body style="margin:0;background:#f2f0eb;font:16px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a;">
<main style="max-width:480px;margin:12vh auto 0;padding:28px 24px;background:#fff;border:2px solid #0a0a0a;">
<p style="margin:0 0 6px;font:700 12px/1.2 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#6a6a6a;">JobFlex</p>
<h1 style="margin:0 0 12px;font-size:24px;line-height:1.2;">${esc(title)}</h1>${body}</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

async function target(url: URL): Promise<{ orgId: string; token: string; business: string; prospect: boolean } | null> {
  const orgId = (url.searchParams.get("o") ?? "").slice(0, 64);
  const token = (url.searchParams.get("t") ?? "").slice(0, 64);
  if (!orgId || !verifyUnsubscribe(orgId, token)) return null;
  // A contractor JobFlex wrote to who has no account (lib/outreach: "prospect_<id>").
  if (orgId.startsWith("prospect_")) return { orgId, token, business: "this address", prospect: true };
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { name: true } }).catch(() => null);
  return { orgId, token, business: org?.name ?? "your account", prospect: false };
}

const BAD = () => page("This link doesn't work", `<p style="margin:0;">It may have been cut off by your mail app. Reply to any email from us and we'll take you off the list by hand.</p>`, 400);

export async function GET(req: Request) {
  const t = await target(new URL(req.url));
  if (!t) return BAD();
  const action = `/api/email/unsubscribe?o=${encodeURIComponent(t.orgId)}&t=${encodeURIComponent(t.token)}`;
  return page("Unsubscribe from JobFlex emails?", `<p style="margin:0 0 18px;">${t.prospect ? "We won't email this address again." : `We'll stop sending personal and promotional emails to ${esc(t.business)}. Notices about your account itself — billing, your trial — still arrive.`}</p>
<form method="post" action="${esc(action)}"><input type="hidden" name="from" value="page"><button type="submit" style="min-height:46px;padding:0 20px;border:2px solid #0a0a0a;background:#1854a0;color:#fff;font:700 15px/1 inherit;cursor:pointer;">Unsubscribe</button></form>`);
}

export async function POST(req: Request) {
  const t = await target(new URL(req.url));
  if (!t) return BAD();
  const form = await req.formData().catch(() => null);
  const oneClick = form?.get("List-Unsubscribe") === "One-Click";
  await writeOptOut(t.orgId, oneClick ? "one-click" : "page");
  // A contractor who stops our emails is not called by JobFlex either.
  if (t.prospect) {
    const { updateProspect } = await import("@/lib/outreach/store");
    await updateProspect(t.orgId.slice("prospect_".length), (p) => (p.dnc ? p : { ...p, dnc: { at: new Date().toISOString(), via: "email" } })).catch(() => null);
  }
  // The mail client's one-click needs only a 2xx; a person gets the page.
  return oneClick ? new Response(null, { status: 200 }) : page("You're unsubscribed", `<p style="margin:0;">We won't send ${esc(t.business)} these emails again. If that was a mistake, just reply to any of our emails.</p>`);
}
