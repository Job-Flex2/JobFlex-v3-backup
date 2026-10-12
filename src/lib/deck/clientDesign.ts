// THE CLIENT DESIGNS THE DECK (2026-10-11). Owner: "send the client a link
// where the client can design and send it back … the client doesn't see a
// price; the client can start from blank or from the contractor's design to
// correct and finalize; make it smart and easy for the client." — pure.
//
// A link is one SyncState row `deckclient:<token>` (no table of its own, like
// the studio's drafts): the contractor's design when the link was made
// (`base`), what the client has done so far (`work`, saved as they go), their
// note, and where it came back to. The shop's list of its links is one more
// row, `deckclients:<orgId>`, newest first.
//
// What the client may change is a short list: the kind, the shape and size,
// the height, the stairs, the railing's style, the boards, a lower level and
// the roof's look. The engineering stays the contractor's — the lumber and
// member sizes, the footings, the ledger, the site, the house, the wiring,
// the rail's height — and is put back from `base` whatever the browser sends
// (mergeClientDesign). The frame is then settled to the tables, so what lands
// in the studio is a deck the tables carry. The client's page never prices.

import type { BoxRow, EmailDoc } from "../email/doc";
import { deckingProduct, railType } from "./catalog";
import { applyDeckPatch } from "./checks";
import { defaultDeckDesign, normalizeDeckDesign, ROOF_KIND_LABEL, structureWords, type DeckDesign, type RoofDesign } from "./design";
import { deckShapeForHouse } from "./house";
import { settleDesign } from "./settle";

export const CLIENT_LINK_PREFIX = "deckclient:";
export const CLIENT_INDEX_PREFIX = "deckclients:";
/** A shop keeps this many links; the oldest goes when a new one is made. */
export const CLIENT_LINK_MAX = 60;
/** A link stays open this long after it is made. */
export const CLIENT_LINK_DAYS = 90;
export const clientLinkKey = (token: string) => `${CLIENT_LINK_PREFIX}${token}`;
export const clientIndexKey = (organizationId: string) => `${CLIENT_INDEX_PREFIX}${organizationId}`;
export const CLIENT_TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
/** The studio's draft row (actions/deckEstimator) — the returned design lands in one, so it opens like any draft. */
export const deckDraftKey = (organizationId: string, id: string) => `deckdraft:${organizationId}:${id}`;
export const DECK_DRAFT_MAX = 60;
/** The activity kind the bell shows when a design comes back (actions/notifications reads its meta.href). */
export const DECK_DESIGN_RETURNED = "DECK_DESIGN_RETURNED";
/** The longest note a client can write. */
export const CLIENT_NOTE_MAX = 1500;

export type ClientStart = "mine" | "blank";

/** What the client said they are not sure of — the contractor measures it. */
export type ClientUnsure = "height";

export interface ClientDesignLink {
  v: 1;
  token: string;
  orgId: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  clientName: string;
  clientPhone: string | null;
  clientEmail: string | null;
  clientId: string | null;
  address: string | null;
  /** The contractor's name for it ("Smith deck"). */
  title: string;
  start: ClientStart;
  /** The contractor's design when the link was made — or a blank one with the contractor's site, house and lumber. */
  base: DeckDesign;
  /** The client's work so far (null until their first change). */
  work: DeckDesign | null;
  workAt: string | null;
  /** The client's first visit. */
  openedAt: string | null;
  note: string;
  unsure: ClientUnsure[];
  status: "open" | "sent";
  sentAt: string | null;
  sends: number;
  /** The studio draft it came back into — the same one on a second send. */
  draftId: string | null;
}

/** The row the contractor's list shows. */
export interface ClientLinkRow {
  token: string;
  clientName: string;
  clientPhone: string | null;
  clientEmail: string | null;
  title: string;
  start: ClientStart;
  createdAt: string;
  openedAt: string | null;
  workAt: string | null;
  status: "open" | "sent";
  sentAt: string | null;
  draftId: string | null;
  note: string;
  expired: boolean;
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strOrNull = (v: unknown, max: number): string | null => str(v, max) || null;
const iso = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);

/** A stored link, read back; null when it is not one. */
export function parseClientLink(cursor: string): ClientDesignLink | null {
  try {
    const raw = JSON.parse(cursor) as Record<string, unknown>;
    if (!raw || raw.v !== 1 || typeof raw.token !== "string" || typeof raw.orgId !== "string") return null;
    const base = normalizeDeckDesign(raw.base);
    return {
      v: 1,
      token: raw.token,
      orgId: raw.orgId,
      createdBy: strOrNull(raw.createdBy, 64),
      createdAt: iso(raw.createdAt) ?? new Date(0).toISOString(),
      expiresAt: iso(raw.expiresAt) ?? new Date(0).toISOString(),
      clientName: str(raw.clientName, 80) || "Your client",
      clientPhone: strOrNull(raw.clientPhone, 40),
      clientEmail: strOrNull(raw.clientEmail, 200),
      clientId: strOrNull(raw.clientId, 64),
      address: strOrNull(raw.address, 300),
      title: str(raw.title, 120) || structureWords(base),
      start: raw.start === "blank" ? "blank" : "mine",
      base,
      work: raw.work ? normalizeDeckDesign(raw.work) : null,
      workAt: iso(raw.workAt),
      openedAt: iso(raw.openedAt),
      note: str(raw.note, CLIENT_NOTE_MAX),
      unsure: Array.isArray(raw.unsure) ? (raw.unsure.filter((u) => u === "height") as ClientUnsure[]) : [],
      status: raw.status === "sent" ? "sent" : "open",
      sentAt: iso(raw.sentAt),
      sends: typeof raw.sends === "number" && raw.sends >= 0 ? Math.floor(raw.sends) : 0,
      draftId: typeof raw.draftId === "string" && /^[a-f0-9-]{8,40}$/i.test(raw.draftId) ? raw.draftId : null,
    };
  } catch {
    return null;
  }
}

export function clientLinkRow(l: ClientDesignLink, now: number): ClientLinkRow {
  return {
    token: l.token,
    clientName: l.clientName,
    clientPhone: l.clientPhone,
    clientEmail: l.clientEmail,
    title: l.title,
    start: l.start,
    createdAt: l.createdAt,
    openedAt: l.openedAt,
    workAt: l.workAt,
    status: l.status,
    sentAt: l.sentAt,
    draftId: l.draftId,
    note: l.note,
    expired: Date.parse(l.expiresAt) < now,
  };
}

/** The contractor's design as the client gets it: no photo of the house (it is the shop's private file). */
export function clientCopyOf(design: DeckDesign): DeckDesign {
  return design.photo ? { ...design, photo: null } : design;
}

/** A blank start: the stock deck, on the contractor's site, house and lumber. */
export function blankFor(base: DeckDesign): DeckDesign {
  return mergeClientDesign(base, defaultDeckDesign({ state: base.site.state, frostIn: base.frostIn }), { settle: false });
}

/** The roof's numbers that are the contractor's to choose: its load, members and how it is framed. */
const ROOF_ENGINEERING = ["load", "post", "rafter", "rafterSpacingIn", "header", "ridge", "roofDeck"] as const satisfies ReadonlyArray<keyof RoofDesign>;

/**
 * The client's design laid over the contractor's: the client's kind, shape,
 * height, stairs, rail style, boards, lower level and roof look; everything
 * else from `base`. Settled to the tables unless `settle: false`.
 */
export function mergeClientDesign(base: DeckDesign, raw: unknown, opts: { settle?: boolean } = {}): DeckDesign {
  const c = normalizeDeckDesign(raw, { state: base.site.state, frostIn: base.frostIn });
  const sameKind = c.structure === base.structure;
  const roof: RoofDesign = { ...c.roof };
  if (sameKind) for (const k of ROOF_ENGINEERING) (roof as unknown as Record<string, unknown>)[k] = base.roof[k];
  let merged: DeckDesign = normalizeDeckDesign({
    ...c,
    wall: base.wall,
    loadPsf: base.loadPsf,
    soilPsf: base.soilPsf,
    frostIn: base.frostIn,
    framing: base.framing,
    ledger: base.ledger,
    footing: base.footing,
    extras: base.extras,
    site: base.site,
    house: base.house,
    photo: base.photo,
    electrical: base.electrical,
    rail: { ...c.rail, heightIn: base.rail.heightIn, postSpacingFt: base.rail.postSpacingFt, customPerFt: base.rail.customPerFt, type: c.rail.type === "custom" && base.rail.type !== "custom" ? base.rail.type : c.rail.type },
    decking: { ...c.decking, fastening: base.decking.fastening, fascia: base.decking.fascia, wastePct: base.decking.wastePct },
    roof,
  });
  // The deck and the contractor's house agree: a step in the wall under the deck notches it.
  const fit = deckShapeForHouse(merged.shape, merged.house);
  if (JSON.stringify(fit.shape) !== JSON.stringify(merged.shape)) merged = applyDeckPatch(merged, { shape: fit.shape });
  return opts.settle === false ? merged : settleDesign(merged).design;
}

/** "Jane Smith's deck design" — the draft's name in the studio. */
export function returnedTitle(link: Pick<ClientDesignLink, "clientName" | "title">): string {
  const who = link.clientName.trim();
  const own = who && who !== "Your client" ? `${who}${/s$/i.test(who) ? "'" : "'s"} design` : "The client's design";
  return `${own} — ${link.title}`.slice(0, 120);
}

/** The text a contractor sends with the link. */
export function clientLinkMessage(i: { org: string; clientName: string; link: string; start: ClientStart }): string {
  const first = i.clientName.trim().split(/\s+/)[0] || "there";
  const what = i.start === "mine" ? "Here is the deck we talked about — change anything you like" : "Design your deck here — pick a style, the size, stairs, railing and boards";
  return `Hi ${first}, it's ${i.org || "your contractor"}. ${what}, and press Send when it looks right: ${i.link}`;
}

/** What changed from the contractor's design, in a client's words, for the contractor's notice. */
export function changesFrom(base: DeckDesign, next: DeckDesign): string[] {
  const out: string[] = [];
  if (base.structure !== next.structure) out.push(`now a ${structureWords(next).toLowerCase()}`);
  if (base.shape.widthFt !== next.shape.widthFt || base.shape.depthFt !== next.shape.depthFt || base.shape.kind !== next.shape.kind) out.push(`size ${next.shape.widthFt} × ${next.shape.depthFt} ft${next.shape.kind === "L" ? " L-shaped" : ""}`);
  if (Math.abs(base.heightIn - next.heightIn) >= 1) out.push(`height ${Math.round(next.heightIn)} in.`);
  if (base.stairs.length !== next.stairs.length) out.push(`${next.stairs.length} ${next.stairs.length === 1 ? "stair" : "stairs"}`);
  if (base.rail.type !== next.rail.type) out.push(next.rail.type === "none" ? "no railing" : `${railType(next.rail.type).label.toLowerCase()} railing`);
  if (base.decking.product !== next.decking.product) out.push(`boards: ${deckingProduct(next.decking.product).label}`);
  if (base.lower.on !== next.lower.on) out.push(next.lower.on ? "a lower level" : "no lower level");
  if (base.roof.kind !== next.roof.kind && next.structure !== "deck") out.push(`${ROOF_KIND_LABEL[next.roof.kind].split(" — ")[0].toLowerCase()} roof`);
  return out;
}

/** The email to the member who made the link when the design comes back. */
export function returnedEmailDoc(i: {
  org: { name: string; logoUrl: string | null; phone: string | null };
  name: string;
  phone: string | null;
  note: string;
  unsure: ClientUnsure[];
  words: string;
  changes: string[];
  /** The studio draft, absolute. */
  href: string;
  again: boolean;
}): EmailDoc {
  const box: BoxRow[] = [
    { type: "field", label: "Client", value: i.name },
    ...(i.phone ? [{ type: "field" as const, label: "Phone", value: i.phone }] : []),
    { type: "field", label: "Design", value: i.words },
    ...(i.changes.length ? [{ type: "field" as const, label: "Changed", value: i.changes.join(", ") }] : []),
    // A condition row is always the last (lib/email/doc).
    ...(i.unsure.includes("height") ? [{ type: "cond" as const, label: "Height", chip: "Measure on site", tone: "warn" as const }] : []),
  ];
  return {
    subject: `${i.name} ${i.again ? "sent their deck design again" : "sent back their deck design"}`,
    lockup: { kind: "org", name: i.org.name, logoUrl: i.org.logoUrl },
    kicker: { text: "Deck design", tone: "ok" },
    headline: `${i.name} ${i.again ? "changed their deck design" : "designed their deck"}`,
    prose: i.note ? [`“${i.note}”`] : undefined,
    box,
    cta: { label: "Open it in the Deck Studio", href: i.href },
    after: ["It is saved in your drafts, framed to the code tables. Price it, then convert it to a proposal."],
    footer: { name: i.org.name, contact: i.org.phone ?? undefined },
  };
}
