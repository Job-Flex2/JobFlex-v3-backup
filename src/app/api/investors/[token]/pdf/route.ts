import { createElement } from "react";
import { NextResponse } from "next/server";
import { visitorForLink } from "@/lib/investorVisitors";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { renderToStream } from "@react-pdf/renderer";
import { investorLinkOpen, investorReport, readInvestorSettings } from "@/lib/investors";
import { mayRead } from "@/lib/investorGate";
import { InvestorPdfDocument } from "@/lib/pdf/InvestorPdf";
import { rateLimitShared, ipFromRequest, HOUR } from "@/lib/rateLimit";

export const runtime = "nodejs";

// The investor figures as a PDF (2026-10-06), by the same shared-link token
// as the page; a dead link gets 404, like the page's "not active".
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const gate = await rateLimitShared(`investors-pdf:${ipFromRequest(req)}`, 30, HOUR);
  if (!gate.ok) return new Response("Too many requests", { status: 429 });
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token) || !(await investorLinkOpen(token))) return new Response("Not found", { status: 404 });
  // The PDF is the page's: the reader introduces themselves first (2026-10-13) and is let in (2026-10-20); an admin passes.
  const visitor = await visitorForLink(token);
  const known = (visitor && mayRead(visitor, (await readInvestorSettings()).approveReaders)) || (await requirePlatformAdmin().then(() => true).catch(() => false));
  if (!known) return NextResponse.redirect(new URL(`/investors/${token}`, req.url));
  const report = await investorReport();
  // The renderer wants a <Document> element; the component returns one (as the proposal route does).
  const stream = await renderToStream(createElement(InvestorPdfDocument, { report }) as unknown as Parameters<typeof renderToStream>[0]);
  const day = report.figures.today;
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="jobflex-investors-${day}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
