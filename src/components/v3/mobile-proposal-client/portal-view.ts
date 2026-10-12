// CLIENT PROPOSAL — the view model shared by both entry points.
//
// The handheld build of /portal/q/[publicId] is reachable from two URLs:
//
//   · /portal/q/<publicId>                    (the real, emailed link — the
//     desktop tree above 768px, this build at or below it)
//   · /mobile-proposal-client-v2/<publicId>   (the direct-review entry point)
//
// Both are SERVER components. Both do the Prisma read themselves and then call
// buildPortalView() to turn the row into the plain, already-formatted object
// below. Nothing here touches the database, and nothing here is a data-layer
// change: the query, its includes and the view-tracking write all stay exactly
// where they were, in the route files.
//
// WHY THE FORMATTING HAPPENS HERE, ON THE SERVER. `money()` and `longDate()`
// are Intl calls. Run inside the client component they would format against
// the phone's locale and timezone while the server-rendered desktop tree used
// the server's — the classic hydration-mismatch shape, and on a page whose
// entire job is showing a homeowner a price, a number that changes after
// hydration is the worst possible bug. Formatting once on the server means the
// mobile tree receives strings and cannot disagree with anything.
//
// `pay` is the resolved payment model (src/lib/payments/portalModel.ts):
// which stage is next, what "remaining" is, which buttons this contractor
// can offer. The pay routes derive every amount server-side again.

import type { PortalPayModel } from "@/lib/payments/portalModel";
import { clientSplit, splitCaption } from "@/lib/pricing/markup";
import { proposalLogoHref } from "@/lib/orgLogo";

/** Donor rule: "roof_squares" → "roof squares", empty → null. */
function measurementLabel(t: string | null | undefined) {
  if (!t) return null;
  const cleaned = t.replace(/_/g, " ").trim().toLowerCase();
  return cleaned.length ? cleaned : null;
}

export type PortalLineItem = {
  id: string;
  name: string;
  description: string | null;
  /** The donor's meta line: "2400 sqft · 2400 × $1.50". */
  meta: string | null;
  /** "Materials $472.00 · Labor $472.00" when the proposal shows its breakdown. */
  split: string | null;
  amount: string;
};

export type PortalInstallment = {
  id: string;
  /** "01", "02", … — the drawing-annotation index. */
  no: string;
  label: string;
  /** "40% of total", or null for a fixed-amount instalment. */
  share: string | null;
  amount: string;
};

/** The contractor's public standing, shown under their name in the header
 *  and linking to /r/<slug>. Null when they have no public reviews yet — a
 *  sales document never says "no reviews". */
export type PortalRating = {
  /** "4.8" — formatted on the server, one decimal. */
  avg: string;
  count: number;
  href: string;
};

/** A picture the proposal carries to the client (lib/proposalPictures):
 *  the fence's 3D snapshot or traced layout, the roof from the air. `overlay`
 *  is a drawing in a 0…1000 square over `src` (the deck's elevation on the
 *  house photo); `pin` is the roof's one pin there — a roof never carries an
 *  outline (owner, 2026-10-12). */
export type PortalPicture = {
  /** fence-scene (2026-09-27): the fence stood up in 3D on the page; `src` is
   *  the scene's JSON route and `poster` the studio's snapshot, when stored.
   *  deck-scene (2026-10-04): the Deck Studio's deck, the same way.
   *  deck-photo (2026-10-10): the contractor's photo of the house with the
   *  deck's elevation drawn over it where they placed it (`overlay`). */
  kind: "fence-3d" | "fence-scene" | "fence-plan" | "roof-photo" | "deck-scene" | "deck-photo";
  src: string;
  alt: string;
  caption: string;
  facts: string | null;
  overlay: string[] | null;
  /** The pin's tip in the 0…1000 square (the roof photo). */
  pin?: { x: number; y: number } | null;
  poster?: string | null;
};

export type PortalView = {
  publicId: string;
  status: string;
  rating: PortalRating | null;
  /** Raw dollars — the checkout payload needs cents, see the note above. */
  total: number;
  orgName: string;
  monogram: string;
  /** The shop's logo (Company → Branding) via /api/public-quote/<id>/logo; null = draw the monogram. */
  logoHref: string | null;
  clientName: string;
  refCode: string;
  title: string;
  createdOn: string;
  validUntil: string;
  totalLabel: string;
  subtotalLabel: string;
  taxLabel: string;
  taxAmount: string;
  description: string | null;
  scope: string | null;
  lineItems: PortalLineItem[];
  installments: PortalInstallment[];
  phone: string | null;
  telHref: string | null;
  pdfHref: string;
  /** Resolved payment view — stages, status, next payable, providers. */
  pay: PortalPayModel;
  /** Org standard terms, shown as a disclosure. Empty when none are set. */
  terms: string;
  /** The client's own job in pictures — the fence's 3D and layout, the
   *  roof from the air (2026-09-23) — or none. */
  pictures: PortalPicture[];
};

/** The shape buildPortalView needs — structural, so this module never has to
 *  import Prisma's generated types and can stay safe to pull into a client
 *  bundle for its `PortalView` type alone. */
type ProposalRow = {
  status: string;
  title: string;
  total: number;
  subtotal: number;
  taxRate: number;
  taxTotal: number;
  description: string | null;
  scopeOfWork: string | null;
  createdAt: Date;
  validUntil: Date | null;
  client: { name: string | null } | null;
  organization: { name: string | null; phone: string | null; logoUrl?: string | null };
  /** "Show to client" (saved on the row); absent on an older caller = shown. */
  showBreakdown?: boolean | null;
  marginOnLabor?: boolean | null;
  materialMarkupPct?: number | null;
  laborMarkupPct?: number | null;
  lineItems: Array<{
    id: string;
    name: string;
    description: string | null;
    quantity: number | null;
    unitPrice: number;
    total: number;
    measurementType: string | null;
    materialCost?: number | null;
    laborCost?: number | null;
  }>;
  installments: Array<{
    id: string;
    label: string;
    isPercent: boolean;
    amount: number;
  }>;
};

type Fmt = {
  money: (n: number) => string;
  longDate: (d: Date | string | null | undefined) => string;
};

export function buildPortalView(
  publicId: string,
  proposal: ProposalRow,
  fmt: Fmt,
  /** Built by the caller, which already has the row + org connections. */
  extras: { pay: PortalPayModel; terms: string; rating?: PortalRating | null; pictures?: PortalPicture[] },
): PortalView {
  const { money, longDate } = fmt;
  const org = proposal.organization;
  const phone = org.phone?.trim() || null;

  return {
    pay: extras.pay,
    terms: extras.terms,
    rating: extras.rating ?? null,
    pictures: extras.pictures ?? [],
    publicId,
    status: proposal.status,
    total: proposal.total,
    orgName: org.name ?? "",
    monogram: (org.name?.trim()?.[0] ?? "J").toUpperCase(),
    logoHref: proposalLogoHref(publicId, org.logoUrl),
    clientName: proposal.client?.name?.trim() || "you",
    // Same derivation as the desktop page: there is no proposal-number column
    // and adding one is a schema change, so this is the last four characters
    // of the row's publicId, uppercased.
    refCode: publicId.replace(/-/g, "").slice(-4).toUpperCase(),
    title: proposal.title,
    createdOn: longDate(proposal.createdAt),
    validUntil: longDate(proposal.validUntil),
    totalLabel: money(proposal.total),
    subtotalLabel: money(proposal.subtotal),
    // Always shown — at 0% it reads "Tax · 0.0%" / $0, exactly as desktop.
    taxLabel: `Tax · ${(proposal.taxRate * 100).toFixed(1)}%`,
    taxAmount: money(proposal.taxTotal),
    description: proposal.description?.trim() ? proposal.description : null,
    scope: proposal.scopeOfWork?.trim() ? proposal.scopeOfWork : null,
    lineItems: proposal.lineItems.map((item) => {
      const measure = measurementLabel(item.measurementType);
      const meta = [
        measure ? (item.quantity ? `${item.quantity} ${measure}` : measure) : null,
        item.quantity ? `${item.quantity} × ${money(item.unitPrice)}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        id: item.id,
        name: item.name,
        description: item.description?.trim() ? item.description : null,
        meta: meta || null,
        split:
          proposal.showBreakdown !== false
            ? splitCaption(clientSplit(item, { materialMarkupPct: proposal.materialMarkupPct ?? 0, laborMarkupPct: proposal.laborMarkupPct ?? 0 }, { marginOnLabor: proposal.marginOnLabor }), money)
            : null,
        amount: money(item.total),
      };
    }),
    installments: proposal.installments.map((inst, i) => ({
      id: inst.id,
      no: String(i + 1).padStart(2, "0"),
      label: inst.label,
      // The desktop prints a bare "40%". On a phone the percentage sits on its
      // own line under the label rather than in a fourth column, and a bare
      // number there reads as ambiguous — "of total" is the information the
      // extra line has room to carry.
      share: inst.isPercent ? `${inst.amount}% of total` : null,
      amount: money(inst.isPercent ? proposal.total * (inst.amount / 100) : inst.amount),
    })),
    phone,
    telHref: phone ? `tel:${phone.replace(/\s+/g, "")}` : null,
    pdfHref: `/api/public-quote/${publicId}/pdf`,
  };
}
