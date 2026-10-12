import { createElement } from "react";
import { NextResponse } from "next/server";
import { clientSplit, splitCaption } from "@/lib/pricing/markup";
import { renderToStream } from "@react-pdf/renderer";
import { db } from "@/lib/db";
import { requireProposalStaff } from "@/lib/orgContext";
import { ProposalPdfDocument, money, type ProposalPdfData } from "@/lib/pdf/ProposalPdf";
import { pdfLogoSrc } from "@/lib/orgLogoServer";
import { satellitePhotoPng } from "@/lib/staticMapPhoto";
import { contractTotal } from "@/lib/contractTotal";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  // Sales reps / estimators can only render PDFs for proposals they own.
  const { organizationId, proposalScope } = await requireProposalStaff();
  const proposal = await db.proposal.findFirst({
    where: { id, organizationId, ...proposalScope },
    include: {
      lineItems: { orderBy: { position: "asc" } },
      installments: { orderBy: { position: "asc" } },
      changeOrders: { where: { status: "APPROVED" }, orderBy: { createdAt: "asc" }, select: { number: true, title: true, status: true, total: true, amount: true } },
      client: true,
      organization: { select: { name: true, logoUrl: true } },
    },
  });
  if (!proposal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let previewImageUrl: string | undefined;
  try {
    const arr = JSON.parse(proposal.beforePhotos ?? "[]");
    // Only trust https Vercel Blob URLs for server-side <Image> fetch (SSRF guard).
    if (
      Array.isArray(arr) &&
      typeof arr[0] === "string" &&
      /^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\//i.test(arr[0])
    ) {
      previewImageUrl = arr[0];
    }
  } catch {
    /* beforePhotos may be malformed; skip the preview */
  }
  // No uploaded photo: the measurement's satellite photo, when the proposal
  // was converted from a roof measurement (ProposalSitePhoto). Rendered from
  // bytes we fetched ourselves, so the SSRF guard above does not apply.
  if (!previewImageUrl) {
    try {
      const link = await db.proposalSitePhoto.findUnique({ where: { proposalId: proposal.id }, select: { roofMeasurementId: true } });
      const row = link
        ? await db.roofMeasurement.findUnique({
            where: { id: link.roofMeasurementId },
            select: { address: true, city: true, state: true, zip: true, lat: true, lng: true, instantJson: true },
          })
        : null;
      if (row) {
        const photo = await satellitePhotoPng(row);
        if (photo.ok) previewImageUrl = "data:image/png;base64," + photo.bytes.toString("base64");
      }
    } catch {
      /* link table not pushed yet, or the photo is unavailable — no preview */
    }
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
    // Approved change orders sit under the original total; the contract value
    // is derived (lib/contractTotal), never written back onto the proposal.
    changeOrders: proposal.changeOrders.map((c) => ({ label: `Change order${c.number ? ` #${c.number}` : ""} · ${c.title}`, total: c.total ?? c.amount })),
    contractTotal: contractTotal(proposal.total, proposal.changeOrders),
    currency: proposal.currency,
    createdAt: proposal.createdAt,
    validUntil: proposal.validUntil,
    publicId: proposal.publicId,
    orgName: proposal.organization.name,
    logoSrc: await pdfLogoSrc(proposal.organization.logoUrl),
    clientName: proposal.client?.name,
    clientAddress: proposal.client?.address,
    previewImageUrl,
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
