import { createElement } from "react";
import { NextResponse } from "next/server";
import { clientSplit, splitCaption } from "@/lib/pricing/markup";
import { renderToStream } from "@react-pdf/renderer";
import { db } from "@/lib/db";
import { ProposalPdfDocument, money, type ProposalPdfData } from "@/lib/pdf/ProposalPdf";
import { pdfLogoSrc } from "@/lib/orgLogoServer";
import { rateLimitShared, ipFromRequest, HOUR } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await ctx.params;
  // Unauthenticated PDF render per hit — cap it per client.
  const gate = await rateLimitShared(`quote-pdf:${ipFromRequest(_req)}`, 20, HOUR);
  if (!gate.ok) return NextResponse.json({ error: "Too many requests — try again later." }, { status: 429 });
  const proposal = await db.proposal.findUnique({
    where: { publicId },
    include: {
      lineItems: { orderBy: { position: "asc" } },
      installments: { orderBy: { position: "asc" } },
      client: true,
      organization: { select: { name: true, deletedAt: true, logoUrl: true } },
    },
  });
  if (!proposal || proposal.organization.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data: ProposalPdfData = {
    title: proposal.title,
    description: proposal.description,
    scopeOfWork: proposal.scopeOfWork,
    notes: proposal.notes,
    subtotal: proposal.subtotal,
    discountTotal: proposal.discountTotal,
    taxRate: proposal.taxRate,
    taxTotal: proposal.taxTotal,
    total: proposal.total,
    currency: proposal.currency,
    createdAt: proposal.createdAt,
    validUntil: proposal.validUntil,
    publicId: proposal.publicId,
    orgName: proposal.organization.name,
    logoSrc: await pdfLogoSrc(proposal.organization.logoUrl),
    clientName: proposal.client?.name,
    clientAddress: proposal.client?.address,
    showScope: proposal.showScope,
    lineItems: proposal.lineItems.map((l) => ({
      name: l.name,
      description: l.description,
      measurementType: l.measurementType,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      total: l.total,
      // "Labor + material breakdown", as the proposal was saved to show it.
      splitCaption: proposal.showBreakdown
        ? splitCaption(clientSplit(l, { materialMarkupPct: proposal.materialMarkupPct, laborMarkupPct: proposal.laborMarkupPct }, { marginOnLabor: proposal.marginOnLabor }), (n) => money(n, proposal.currency))
        : null,
    })),
    installments: proposal.installments.map((i) => ({
      label: i.label,
      amount: i.amount,
      isPercent: i.isPercent,
    })),
  };

  const stream = await renderToStream(
    createElement(ProposalPdfDocument, { data }) as any,
  );
  const filename = `${proposal.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;

  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}
