// MANUAL PROPOSAL / BLUEPRINT — the server read.
//
// This is the file that turns the builder from a fixture into a record. It runs
// on the server for the page at /dashboard/manual-blueprint and hands the
// client column four things: the org's clients, its projects, its saved
// markup/tax defaults, and — when the URL carries one — an existing proposal to
// reopen.
//
// THERE IS NO FIXTURE FALLBACK. An unresolvable `?proposal=` id returns
// `proposal: null` with `proposalMissing: true` and the page opens a NEW,
// EMPTY draft; it never invents a client, a line item or a scope paragraph.
// Same rule for `?client=`: an id belonging to another org resolves to nothing
// and the client field simply opens unset.
//
// The queries mirror /dashboard/proposals/new and /dashboard/proposals/[id]
// verbatim in intent — same org scoping, same selects — so the two builders
// describe the same org.
//
// DATES ARE FORMATTED HERE and travel as strings. A `new Date()` read during
// render is a guaranteed hydration mismatch, which is exactly why the fixture
// this replaces carried a hard-coded date string.

import { db } from "@/lib/db";
import { mediaHref } from "@/lib/media/signedLink";
import { FENCE_PLAN_EVENT } from "@/lib/fence/planSvg";
import { DECK_PLAN_EVENT } from "@/lib/deck/convertSchema";
import { mediaOf } from "@/lib/jobMediaShared";
import { actorsOf } from "@/lib/activityLog";
import type { CrewMediaItem } from "./manual-blueprint-bridge";
import type { EstimateSeed } from "@/lib/estimateSeed";
import { isEstimatorRole, isSalesRole } from "@/lib/orgContext";
import { APPROVED_CO_SELECT } from "@/lib/contractTotal";
import {
  draftFromProposal,
  proposalRef,
  UNSAVED_REF,
  type ManualClient,
  type ManualDefaults,
  type ManualProject,
  type ManualProposal,
  type SheetIdentity,
} from "./manual-blueprint-bridge";

export type ManualBuilderData = {
  /** Sender, reference, date and expiry for the sheet and the PDF. For a NEW
   *  proposal the reference is "DRAFT" and the dates are today / today + 14,
   *  which is the window `saveProposal` stamps on a fresh row. */
  identity: SheetIdentity;
  clients: ManualClient[];
  projects: ManualProject[];
  defaults: ManualDefaults;
  /** The proposal `?proposal=<id>` resolved to, or null for a new one. */
  proposal: ManualProposal | null;
  /** True when an id WAS supplied and did not resolve in this org. The page
   *  says so rather than opening a blank sheet that looks like a data loss. */
  proposalMissing: boolean;
  /** The client `?client=<id>` resolved to, or null. Ignored when a proposal
   *  was loaded — that record already names its own client. */
  initialClientId: string | null;
  /** The project `?project=<id>` resolved to (for a NEW proposal), or the
   *  reopened proposal's own project, or null. */
  initialProjectId: string | null;
  /** The lead this NEW sheet was opened from (2026-09-22), or null. When the
   *  lead's email or phone matched a client on file, `initialClientId` names
   *  that record; otherwise the sheet carries the lead's name as a one-off
   *  client and its contact, and a send makes the record. */
  seed: ManualSeed | null;
};

export type ManualSeed = {
  leadId: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  state: string | null;
  /** The sheet's title: the project type and the name. */
  title: string;
  /** The professional scope, else the homeowner's own words — the scope of work. */
  brief: string;
  /** The homeowner's own words, for the overview, when the brief is the professional scope. */
  words: string | null;
};

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D+/g, "");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-08-15" — the masthead's drawing-annotation date style. */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Aug 15, 2026", for the saved-record chip. */
export function dateLong(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${pad(d.getDate())}, ${d.getFullYear()}`;
}

/** The window `saveProposal` stamps on a new row, mirrored here so an UNSAVED
 *  sheet quotes the same expiry the record will carry the moment it is saved. */
const VALID_DAYS = 14;

function plusDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

const CLIENT_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  address: true,
  city: true,
  state: true,
  zip: true,
} as const;

export async function loadManualBuilder({
  organizationId,
  role,
  userId,
  clientId,
  proposalId,
  projectId,
  seed: leadSeed,
}: {
  organizationId: string;
  /** Active-org membership role — SALES and ESTIMATOR may only reopen their
   *  own proposals, the same scoping `requireProposalStaff` applies to writes. */
  role: string;
  userId: string;
  clientId?: string;
  proposalId?: string;
  projectId?: string;
  /** The lead hand-off (lib/estimateSeed), read by the page for the manual proposal. */
  seed?: EstimateSeed | null;
}): Promise<ManualBuilderData> {
  const ownProposalsOnly = isSalesRole(role) || isEstimatorRole(role);

  const [clientRows, projectRows, org, proposalRow] = await Promise.all([
    db.client.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { name: "asc" },
      select: CLIENT_SELECT,
    }),
    // Archived projects stay out of the picker — unless this proposal is
    // already in one, which the list below adds back.
    db.project.findMany({
      where: { organizationId, OR: [{ status: { not: "ARCHIVED" } }, ...(proposalId ? [{ proposals: { some: { id: proposalId } } }] : [])] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true, clientId: true },
    }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: {
        name: true,
        address: true,
        phone: true,
        defaultTaxRate: true,
        materialMarkupPct: true,
        laborMarkupPct: true,
      },
    }),
    proposalId
      ? db.proposal.findFirst({
          where: {
            id: proposalId,
            organizationId,
            ...(ownProposalsOnly ? { ownerId: userId } : {}),
          },
          include: {
            lineItems: { orderBy: { position: "asc" } },
            installments: { orderBy: { position: "asc" } },
            discounts: true,
            // An APPROVED change order is money the client owes on top of the
            // proposal's own total, and it arrives as its own installment row
            // (lib/changeOrders/respond). Without these the coverage meter
            // measures that row against a total that excludes it and calls a
            // balanced schedule "over". Same select every money read uses.
            changeOrders: APPROVED_CO_SELECT,
          },
        })
      : Promise.resolve(null),
  ]);

  const clients: ManualClient[] = clientRows.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email ?? "",
    phone: c.phone ?? "",
    // The street line only — the pickers and `addressOf` join the tail
    // themselves, exactly as they did against the fixture.
    address: (c.address ?? "").split("\n")[0] ?? "",
    city: c.city ?? "",
    state: c.state ?? "",
    zip: c.zip ?? "",
    tags: [],
  }));

  const projects: ManualProject[] = projectRows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? "",
  }));

  const defaults: ManualDefaults = {
    // The column is a fraction; the builder's field is a percentage.
    taxPct: Math.round((org?.defaultTaxRate ?? 0) * 10000) / 100,
    materialMarkupPct: org?.materialMarkupPct ?? 0,
    laborMarkupPct: org?.laborMarkupPct ?? 0,
  };

  // The fence drawing (2026-09-27): a FENCE_PLAN row means the drawing card
  // has something to show — the 3D and the plan come off the public routes.
  let fenceDrawing = false;
  // The Deck Studio's deck (2026-10-04): a DECK_PLAN row, its 3D off the public route.
  let deckDrawing = false;
  // What the crew shot on this proposal's job (2026-09-27): the newest 24
  // files, with who added each from the trail rows that name them.
  let media: CrewMediaItem[] = [];
  if (proposalRow) {
    try {
      const [rows, events, actors] = await Promise.all([
        db.jobPhoto.findMany({ where: { job: { proposalId: proposalRow.id, organizationId } }, orderBy: { createdAt: "desc" }, take: 24, select: { id: true, url: true, kind: true, analysis: true, createdAt: true, jobId: true } }),
        db.activityEvent.findMany({ where: { organizationId, kind: "PHOTO", proposalId: proposalRow.id }, orderBy: { createdAt: "desc" }, take: 100, select: { actorId: true, meta: true } }),
        actorsOf(organizationId),
      ]);
      const by = new Map<string, string>();
      for (const e of events) {
        try {
          const m = JSON.parse(e.meta ?? "{}") as { photoId?: string };
          if (m.photoId && e.actorId && !by.has(m.photoId)) by.set(m.photoId, actors.get(e.actorId)?.name ?? "Former member");
        } catch {
          /* a row without readable meta */
        }
      }
      media = rows.map((r) => ({
        id: r.id,
        // Private files are read through a short signed link (stage B); the
        // office reading this proposal was checked by the page.
        url: mediaHref(r.url) ?? r.url,
        kind: r.kind ? r.kind.charAt(0) + r.kind.slice(1).toLowerCase() : "Photo",
        media: mediaOf(r).media,
        when: r.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        by: by.get(r.id) ?? null,
        jobId: r.jobId,
      }));
    } catch {
      media = [];
    }
  }
  if (proposalRow) {
    try {
      fenceDrawing = !!(await db.activityEvent.findFirst({ where: { proposalId: proposalRow.id, kind: FENCE_PLAN_EVENT }, select: { id: true } }));
    } catch {
      fenceDrawing = false;
    }
    try {
      deckDrawing = !!(await db.activityEvent.findFirst({ where: { proposalId: proposalRow.id, kind: DECK_PLAN_EVENT }, select: { id: true } }));
    } catch {
      deckDrawing = false;
    }
  }
  const proposal: ManualProposal | null = proposalRow
    ? {
        id: proposalRow.id,
        publicId: proposalRow.publicId,
        fenceDrawing,
        deckDrawing,
        priceOnly: !!proposalRow.trade,
        trade: proposalRow.trade ?? null,
        media,
        ref: proposalRef(proposalRow.publicId),
        status: proposalRow.status,
        clientId: proposalRow.clientId,
        draft: draftFromProposal(
          {
            projectId: proposalRow.projectId,
            title: proposalRow.title,
            description: proposalRow.description,
            scopeOfWork: proposalRow.scopeOfWork,
            notes: proposalRow.notes,
            address: proposalRow.address,
            taxRate: proposalRow.taxRate,
            materialMarkupPct: proposalRow.materialMarkupPct,
            laborMarkupPct: proposalRow.laborMarkupPct,
            overheadPct: proposalRow.overheadPct,
            profitPct: proposalRow.profitPct,
            showBreakdown: proposalRow.showBreakdown,
            showScope: proposalRow.showScope,
            showSignature: proposalRow.showSignature,
            marginOnLabor: proposalRow.marginOnLabor,
            discountTotal: proposalRow.discountTotal,
            subtotal: proposalRow.subtotal,
            discounts: proposalRow.discounts.map((d) => ({
              amount: d.amount,
              isPercent: d.isPercent,
            })),
            lineItems: proposalRow.lineItems.map((l) => ({
              name: l.name,
              description: l.description,
              measurementType: l.measurementType,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              materialCost: l.materialCost,
              laborCost: l.laborCost,
            })),
            installments: proposalRow.installments.map((i) => ({
              id: i.id,
              label: i.label,
              amount: i.amount,
              isPercent: i.isPercent,
              status: i.status,
              paidAmount: i.paidAmount,
            })),
          },
          defaults,
        ),
        // Read-only context, not draft state: what the client owes on top of
        // this proposal because a change order was approved.
        changeOrders: proposalRow.changeOrders.map((c: { status: string; total: number | null }) => ({
          status: c.status,
          total: c.total,
        })),
      }
    : null;

  // An id that resolved to nothing is worth saying out loud; no id at all is
  // just a new proposal.
  const proposalMissing = Boolean(proposalId) && proposal === null;

  // A new proposal opened from a project files under it, and takes the
  // project's client when the link named none.
  const fromProject = !proposal && projectId ? (projectRows.find((p) => p.id === projectId) ?? null) : null;
  const initialProjectId = proposal ? (proposalRow?.projectId ?? null) : (fromProject?.id ?? null);

  // A lead whose email or phone is already a client on file files under that
  // record; the sheet then takes its address like any `?client=` would.
  const seed = !proposal && leadSeed ? leadSeed : null;
  const seedEmail = (seed?.email ?? "").trim().toLowerCase();
  const seedPhone = digits(seed?.phone);
  const matched = seed
    ? ((seed.clientId && clientRows.find((c) => c.id === seed.clientId)) ||
        clientRows.find((c) => (seedEmail && (c.email ?? "").trim().toLowerCase() === seedEmail) || (seedPhone.length >= 7 && digits(c.phone) === seedPhone)) ||
        null)
    : null;

  const initialClientId =
    proposal?.clientId ??
    (clientId && clients.some((c) => c.id === clientId) ? clientId : null) ??
    (fromProject?.clientId && clients.some((c) => c.id === fromProject.clientId) ? fromProject.clientId : null) ??
    (matched ? matched.id : null);

  const now = new Date();
  const identity: SheetIdentity = {
    orgName: org?.name ?? "",
    // Address is stored as a one-liner; the newline convention the client
    // record uses for a second line collapses to " · " here so a letterhead
    // stays one band tall.
    orgLine: [(org?.address ?? "").split("\n").filter(Boolean).join(" · "), org?.phone ?? ""]
      .filter((part) => part.trim().length > 0)
      .join(" · "),
    ref: proposal?.ref ?? UNSAVED_REF,
    date: isoDate(proposalRow?.createdAt ?? now),
    validUntil: isoDate(proposalRow?.validUntil ?? plusDays(now, VALID_DAYS)),
  };

  return {
    identity,
    clients,
    projects,
    defaults,
    proposal,
    proposalMissing,
    initialClientId,
    initialProjectId,
    seed: seed
      ? {
          leadId: seed.leadId,
          name: seed.name,
          email: seed.email,
          phone: seed.phone,
          address: seed.address,
          state: seed.state,
          title: [seed.projectType, seed.name].filter((x) => x && x.trim()).join(" — ") || "New proposal",
          brief: seed.brief,
          words: seed.words,
        }
      : null,
  };
}
