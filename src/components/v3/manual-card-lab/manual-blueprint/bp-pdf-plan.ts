// MANUAL PROPOSAL / BLUEPRINT — card 11's document, as DATA.
//
// The sheet exists twice: as HTML in the preview (bp-pdf.tsx) and as the .pdf
// file Download PDF saves (bp-pdf-file.tsx). Both read what is in the document
// — which sections, in which order, under which numbers — from here, so the
// file cannot print "04 TERMS" over a preview that says "05".

import { UNIT_LABEL, money, qty } from "../manual-focus/manual-focus-math";
import type {
  Installment,
  PrintedLine,
  ProposalOptions,
  StagedFile,
  Totals,
} from "../manual-focus/manual-focus-types";
import type { SheetIdentity } from "./manual-blueprint-bridge";

export type PaperSize = "letter" | "a4";

/**
 * Deliberately NOT merged into `ProposalOptions`.
 *
 * That type is shared with four other card-lab variants and describes what the
 * client's copy SAYS. These four describe how the paper is built, which is a
 * different question with a different owner — and this variant does not get to
 * widen a shared type on the way to answering it.
 */
export type PdfSetup = {
  paper: PaperSize;
  /** A first page carrying the title, the client and the total, and nothing
   *  else. Off by default: it is a page of paper that says what page two
   *  already says, and it earns its place only on large jobs. */
  cover: boolean;
  /** The org band at the head of every page. */
  letterhead: boolean;
  /** The identifying strip at the foot of every page. */
  footer: boolean;
};

export const DEFAULT_PDF_SETUP: PdfSetup = {
  paper: "letter",
  cover: false,
  letterhead: true,
  footer: true,
};

/** Trim sizes: CSS px (96/in) for the preview, PDF points (72/in) for the file. */
export const PAPER: Record<PaperSize, { label: string; css: string; w: number; h: number; pt: [number, number] }> = {
  letter: { label: "US Letter", css: "Letter", w: 816, h: 1056, pt: [612, 792] },
  a4: { label: "A4", css: "A4", w: 794, h: 1123, pt: [595.28, 841.89] },
};

/** THE SHEET'S MARGIN, in inches — the white edge of the paper in both media:
 *  the preview's padding, the print layer's sheet padding (the @page margin is
 *  0 so the browser has nowhere to print its own header and footer), and the
 *  file's page padding. */
export const MARGIN_IN = 0.6;

export type DocProps = {
  /** Sender, reference and expiry — see SheetIdentity. */
  identity: SheetIdentity;
  title: string;
  clientName: string;
  email: string;
  phone: string;
  address: string;
  projectName: string;
  description: string;
  scopeOfWork: string;
  terms: string;
  taxPct: number;
  options: ProposalOptions;
  totals: Totals;
  installments: Installment[];
  files: StagedFile[];
  setup: PdfSetup;
};

export type SectionKey = "parties" | "overview" | "scope" | "pricing" | "totals" | "pay" | "terms" | "accept" | "files";

/** Built as a list so the numbering is a consequence of what is actually
 *  present: a proposal that omits its scope must not print "3. TOTALS" after
 *  "1. PREPARED FOR" — a gap reads to a client as a page that went missing. */
export function sectionPlan(d: Omit<DocProps, "setup">): { key: SectionKey; title: string }[] {
  const out: { key: SectionKey; title: string }[] = [{ key: "parties", title: "Prepared for" }];
  if (d.description.trim()) out.push({ key: "overview", title: "Project overview" });
  if (d.options.showScope && d.scopeOfWork.trim()) out.push({ key: "scope", title: "Scope of work" });
  out.push({ key: "pricing", title: "Schedule of work & pricing" });
  out.push({ key: "totals", title: "Totals" });
  if (d.installments.length > 0) out.push({ key: "pay", title: "Payment schedule" });
  if (d.terms.trim()) out.push({ key: "terms", title: "Terms & conditions" });
  if (d.options.showSignature) out.push({ key: "accept", title: "Acceptance" });
  if (d.files.length > 0) out.push({ key: "files", title: "Attachments" });
  return out;
}

/** THE SECTIONS THAT MAY BREAK ACROSS PAGES — tables and prose. The parties,
 *  the totals and the signatures always move to the next page whole; these
 *  break between rows or lines instead, because moving a long price table
 *  whole leaves most of a page blank above it. Their rows never split and
 *  their heading never ends a page. (The file keeps a SHORT one whole too —
 *  see `holdsTogether` in bp-pdf-file.tsx.) */
export const FLOWING_SECTIONS: ReadonlySet<SectionKey> = new Set<SectionKey>(["overview", "scope", "pricing", "pay", "terms", "files"]);

/** "2026-11-17" → "Nov 17, 2026". The sheet carries one date, the expiry; the
 *  day it was drawn up is the contractor's record, not the client's term. */
export function sheetDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // No-break spaces: a date is never split "Nov / 17, 2026" across two lines.
  return d
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .replace(/ /g, " ");
}

/** The file's name — "PRO-4C1B Roof replacement.pdf", never the app's tab title. */
export function fileStem(d: Pick<DocProps, "identity" | "title">): string {
  return [d.identity.ref, d.title.trim() || "Proposal"].join(" ").replace(/[\\/:*?"<>|]+/g, "-");
}

/** "24 sq ft × $450.00" — the middle column of the price table. A lump sum
 *  says so rather than "1 fixed × …". */
export function unitText(row: PrintedLine): string {
  if (row.unit === "FIXED") return "Lump sum";
  const label = UNIT_LABEL[row.unit];
  const unit = row.quantity !== 1 && (label === "unit" || label === "hour") ? `${label}s` : label;
  return `${qty(row.quantity)} ${unit} × ${money(row.unitPrice)}`;
}
