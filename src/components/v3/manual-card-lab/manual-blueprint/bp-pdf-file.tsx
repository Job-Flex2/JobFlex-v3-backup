// MANUAL PROPOSAL / BLUEPRINT — card 11's document as a real .pdf FILE.
//
// ── WHY A FILE AND NOT window.print() ────────────────────────
// Printing hands the paper to the browser, and the browser adds to it: Chrome
// and Edge print the date, the tab title, the page's URL and "2/7" in the page
// margin whenever their "Headers and footers" box is ticked, Safari has its own
// box, and the iPhone's print sheet has none at all — it always prints them.
// `@page { margin: 0 }` takes Chrome's away and nobody else's. A proposal that
// carries the app's address down the foot of every page, on the one device the
// contractor cannot fix it from, is not a document they can send.
//
// So Download PDF builds the file here, in the browser, from the same props as
// the preview: vector, selectable text, the same sections under the same
// numbers (bp-pdf-plan.ts), and page furniture we draw ourselves — including
// "Page 2 of 7", which print CSS cannot produce in Chrome. Built from the live
// sheet, not the saved row, so an unsaved edit is in the file exactly as it is
// in the preview. Loaded only on the click: react-pdf and the fonts are not
// part of the page.

import { Document, Font, Page, Text, View, pdf, StyleSheet } from "@react-pdf/renderer";
import { fileSize, installmentValue, money, pct } from "../manual-focus/manual-focus-math";
import {
  FLOWING_SECTIONS,
  MARGIN_IN,
  PAPER,
  sectionPlan,
  sheetDate,
  unitText,
  type DocProps,
  type SectionKey,
} from "./bp-pdf-plan";

/** The sheet's colours, read from the tokens at the moment of download (see
 *  `readPalette` in bp-pdf.tsx), so a theme change reaches the file too. */
export type PdfPalette = {
  ink: string;
  soft: string;
  muted: string;
  rule: string;
  line: string;
};

const M = MARGIN_IN * 72;
/** The footer band: one 7pt line over an 8pt gap and a hairline. */
const FOOT_H = 20;
/** Clear space between the body and the footer band. */
const FOOT_GAP = 16;
/** Column widths of the priced tables, shared so every amount on the sheet
 *  sits on one right edge. */
const COL_AMT = 92;
const COL_QTY = 150;
const COL_SHARE = 120;

let fontsReady = false;
function registerFonts(origin: string) {
  if (fontsReady) return;
  fontsReady = true;
  Font.register({
    family: "Inter",
    fonts: [
      { src: `${origin}/fonts/pdf/Inter-400.ttf`, fontWeight: 400 },
      { src: `${origin}/fonts/pdf/Inter-600.ttf`, fontWeight: 600 },
      { src: `${origin}/fonts/pdf/Inter-800.ttf`, fontWeight: 800 },
    ],
  });
  Font.register({ family: "Mono", src: `${origin}/fonts/pdf/JetBrainsMono-600.ttf`, fontWeight: 600 });
  // Words are never hyphenated — a price list split as "Under-/layment" reads
  // as two items. Only a run longer than any column (a pasted link, a part
  // number) is cut, so it wraps inside its cell instead of running into the
  // price. (A zero-width space is no break point to react-pdf: the run then
  // overprints the next column — measured.)
  Font.registerHyphenationCallback((word) =>
    word.length > 28 ? word.match(/.{1,16}/g) ?? [word] : [word],
  );
}

function sheet(c: PdfPalette) {
  return StyleSheet.create({
    page: {
      paddingTop: M,
      paddingLeft: M,
      paddingRight: M,
      paddingBottom: M + FOOT_H + FOOT_GAP,
      fontFamily: "Inter",
      fontWeight: 400,
      // No lineHeight here: inherited by the footer's page-number text, it
      // makes react-pdf drop that text entirely (measured). Each style that
      // wraps sets its own.
      fontSize: 9,
      color: c.ink,
      backgroundColor: "#ffffff",
    },

    runHead: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      paddingBottom: 10,
      // Small on purpose: a section that opens a page brings its own 22pt.
      marginBottom: 10,
      borderBottomWidth: 1.5,
      borderBottomColor: c.ink,
    },
    headOrg: { fontSize: 10.5, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase" },
    headLine: { marginTop: 3, fontSize: 8, color: c.muted },
    headRef: { fontFamily: "Mono", fontWeight: 600, fontSize: 7.5, letterSpacing: 0.6, lineHeight: 1.6, color: c.muted, textAlign: "right", textTransform: "uppercase" },

    runFoot: {
      position: "absolute",
      left: M,
      right: M,
      bottom: M,
      minHeight: FOOT_H,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-end",
      paddingTop: 8,
      borderTopWidth: 0.75,
      borderTopColor: c.line,
      fontFamily: "Mono",
      fontWeight: 600,
      fontSize: 7,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      color: c.muted,
    },

    cover: { flexDirection: "column", paddingTop: 72 },
    coverKicker: { fontFamily: "Mono", fontWeight: 600, fontSize: 8, letterSpacing: 1.3, textTransform: "uppercase", color: c.muted },
    coverTitle: { marginTop: 14, fontSize: 28, fontWeight: 800, lineHeight: 1.1, textTransform: "uppercase" },
    coverFor: { marginTop: 18, fontSize: 10, lineHeight: 1.6, color: c.muted },
    coverTotal: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: "auto", paddingTop: 12, borderTopWidth: 1.5, borderTopColor: c.ink },
    coverTotalLabel: { fontSize: 8.5, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase" },
    coverTotalValue: { fontSize: 22, fontWeight: 800 },
    coverMeta: { marginTop: 10, fontFamily: "Mono", fontWeight: 600, fontSize: 7.5, letterSpacing: 0.8, textTransform: "uppercase", color: c.muted },

    docHead: { marginTop: 12 },
    docTitle: { fontSize: 15, fontWeight: 800, lineHeight: 1.2, letterSpacing: 0.15, textTransform: "uppercase" },
    docSub: { marginTop: 6, fontFamily: "Mono", fontWeight: 600, fontSize: 7.5, letterSpacing: 0.8, textTransform: "uppercase", color: c.muted },

    section: { marginTop: 22 },
    secHead: { flexDirection: "row", alignItems: "flex-end", paddingBottom: 6, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: c.ink },
    secNum: { width: 22, fontFamily: "Mono", fontWeight: 600, fontSize: 8.5, color: c.muted },
    secTitle: { fontSize: 9, fontWeight: 800, letterSpacing: 0.9, textTransform: "uppercase" },

    meta: { flexDirection: "row", flexWrap: "wrap" },
    metaPair: { width: "50%", flexDirection: "row", paddingVertical: 4, paddingRight: 16 },
    metaLabel: { width: 74, paddingTop: 1.5, fontFamily: "Mono", fontWeight: 600, fontSize: 7, letterSpacing: 0.7, textTransform: "uppercase", color: c.muted },
    metaValue: { flex: 1, fontSize: 9, fontWeight: 600, lineHeight: 1.4 },

    prose: { fontSize: 9, lineHeight: 1.6, color: c.soft },
    fine: { marginTop: 8, fontSize: 8, lineHeight: 1.5, color: c.muted },

    thRow: { flexDirection: "row", alignItems: "flex-end", paddingBottom: 6, borderBottomWidth: 0.75, borderBottomColor: c.line },
    th: { fontFamily: "Mono", fontWeight: 600, fontSize: 7, letterSpacing: 0.7, textTransform: "uppercase", color: c.muted },
    row: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 8, borderBottomWidth: 0.75, borderBottomColor: c.rule },
    cellItem: { flex: 1, paddingRight: 14 },
    cellQty: { width: COL_QTY, paddingRight: 12, textAlign: "right" },
    cellShare: { width: COL_SHARE, paddingRight: 12, textAlign: "right" },
    cellAmt: { width: COL_AMT, textAlign: "right" },
    name: { fontSize: 9.5, fontWeight: 600, lineHeight: 1.35 },
    sub: { marginTop: 3, fontSize: 8, lineHeight: 1.45, color: c.muted },
    num: { fontSize: 9, color: c.soft, textAlign: "right" },
    amt: { fontSize: 9.5, fontWeight: 600, textAlign: "right" },
    shareTxt: { fontFamily: "Mono", fontWeight: 600, fontSize: 7.5, letterSpacing: 0.5, textTransform: "uppercase", color: c.muted, textAlign: "right" },
    empty: { paddingVertical: 10, fontSize: 9, color: c.muted },

    sums: { alignSelf: "flex-end", width: 250 },
    sumRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingVertical: 4 },
    sumLabel: { fontSize: 9, color: c.muted },
    sumValue: { width: COL_AMT, fontSize: 9.5, fontWeight: 600, textAlign: "right", color: c.soft },
    sumTotal: { marginTop: 6, paddingTop: 9, borderTopWidth: 1.5, borderTopColor: c.ink },
    sumTotalLabel: { fontSize: 8.5, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase" },
    sumTotalValue: { fontSize: 14, fontWeight: 800, textAlign: "right" },

    signRow: { flexDirection: "row", marginTop: 40 },
    signCell: { flex: 1, paddingTop: 7, borderTopWidth: 0.75, borderTopColor: c.ink, fontFamily: "Mono", fontWeight: 600, fontSize: 7, letterSpacing: 0.7, textTransform: "uppercase", color: c.muted },
    signGap: { width: 28 },
  });
}

type S = ReturnType<typeof sheet>;

/** THE PAGINATION RULE. The parties, the totals and the signatures move to
 *  the next page whole. A table or prose section (FLOWING_SECTIONS) does too
 *  while it is short — a three-row schedule split one and two reads as two
 *  schedules — but a long one flows, breaking only between rows (each row is
 *  unbreakable, its heading keeps a row under it) or between lines of prose
 *  (orphans/widows 3): moved whole, an eight-line price table left most of
 *  page one blank (measured). react-pdf cannot be asked "does it fit", so
 *  "short" is an estimate: under 30% of the page's text height. */
function holdsTogether(key: SectionKey, d: DocProps, usable: number): boolean {
  if (!FLOWING_SECTIONS.has(key)) return true;
  const proseH = (t: string) => t.split("\n").reduce((h, l) => h + Math.max(1, Math.ceil(l.length / 105)), 0) * 14.4;
  let h = 40;
  switch (key) {
    case "overview":
      h += proseH(d.description);
      break;
    case "scope":
      h += proseH(d.scopeOfWork);
      break;
    case "terms":
      h += proseH(d.terms);
      break;
    case "pricing":
      h += 20 + d.totals.printed.reduce((s, r) => s + 32 + (r.description ? Math.ceil(r.description.length / 70) * 11.6 : 0), 0);
      break;
    case "pay":
      h += 30 + d.installments.length * 26;
      break;
    case "files":
      h += 30 + d.files.length * 26;
      break;
    default:
      return true;
  }
  return h < usable * 0.3;
}

function SectionBody({ k, d, s }: { k: SectionKey; d: DocProps; s: S }) {
  switch (k) {
    case "parties":
      return (
        <View style={s.meta}>
          {[
            ["Client", d.clientName.trim() || "—"],
            ["Job address", d.address.trim() || "—"],
            ["Email", d.email.trim() || "—"],
            ["Phone", d.phone.trim() || "—"],
            ["Project", d.projectName || "—"],
            ["Prepared by", d.identity.orgName || "—"],
          ].map(([label, value]) => (
            <View key={label} style={s.metaPair}>
              <Text style={s.metaLabel}>{label}</Text>
              <Text style={s.metaValue}>{value}</Text>
            </View>
          ))}
        </View>
      );
    case "overview":
      return <Text style={s.prose} orphans={3} widows={3}>{d.description}</Text>;
    case "scope":
      return <Text style={s.prose} orphans={3} widows={3}>{d.scopeOfWork}</Text>;
    case "terms":
      return <Text style={s.prose} orphans={3} widows={3}>{d.terms}</Text>;
    case "pricing":
      if (d.totals.printed.length === 0) return <Text style={s.empty}>No priced lines.</Text>;
      return (
        <View>
          <View style={s.thRow} minPresenceAhead={40}>
            <Text style={[s.th, s.cellItem]}>Item</Text>
            <Text style={[s.th, s.cellQty]}>Qty × unit price</Text>
            <Text style={[s.th, s.cellAmt]}>Amount</Text>
          </View>
          {d.totals.printed.map((row) => {
            const split = !d.options.hideBreakdown
              ? [row.materialAmount > 0 ? `Materials ${money(row.materialAmount)}` : "", row.laborAmount > 0 ? `Labor ${money(row.laborAmount)}` : ""].filter(Boolean).join("  ·  ")
              : "";
            return (
              <View key={row.id} style={s.row} wrap={false}>
                <View style={s.cellItem}>
                  <Text style={s.name}>{row.name}</Text>
                  {row.description ? <Text style={s.sub}>{row.description}</Text> : null}
                  {split ? <Text style={s.sub}>{split}</Text> : null}
                </View>
                <Text style={[s.num, s.cellQty]}>{unitText(row)}</Text>
                <Text style={[s.amt, s.cellAmt]}>{money(row.amount)}</Text>
              </View>
            );
          })}
        </View>
      );
    case "totals":
      return (
        <View style={s.sums}>
          <View style={s.sumRow}>
            <Text style={s.sumLabel}>Subtotal</Text>
            <Text style={s.sumValue}>{money(d.totals.preTax)}</Text>
          </View>
          {d.totals.discountAmount > 0 ? (
            <View style={s.sumRow}>
              <Text style={s.sumLabel}>Discount</Text>
              <Text style={s.sumValue}>–{money(d.totals.discountAmount)}</Text>
            </View>
          ) : null}
          <View style={s.sumRow}>
            <Text style={s.sumLabel}>Tax · {pct(d.taxPct)}</Text>
            <Text style={s.sumValue}>{money(d.totals.tax)}</Text>
          </View>
          <View style={[s.sumRow, s.sumTotal]}>
            <Text style={s.sumTotalLabel}>Total</Text>
            <Text style={s.sumTotalValue}>{money(d.totals.total)}</Text>
          </View>
        </View>
      );
    case "pay":
      return (
        <View>
          <View style={s.thRow} minPresenceAhead={40}>
            <Text style={[s.th, s.cellItem]}>Payment</Text>
            <Text style={[s.th, s.cellShare]}>Basis</Text>
            <Text style={[s.th, s.cellAmt]}>Amount</Text>
          </View>
          {d.installments.map((inst, i) => {
            const row = (
              <View style={s.row} wrap={false}>
                <Text style={[s.name, s.cellItem]}>{inst.label.trim() || "Unnamed payment"}</Text>
                <Text style={[s.shareTxt, s.cellShare]}>{inst.isPercent ? `${inst.amount}% of total` : "Fixed amount"}</Text>
                <Text style={[s.amt, s.cellAmt]}>{money(installmentValue(inst, d.totals.total))}</Text>
              </View>
            );
            // The footnote stays with the row it follows.
            return i === d.installments.length - 1 ? (
              <View key={inst.id} wrap={false}>
                {row}
                <Text style={s.fine}>
                  Amounts are calculated from the total above. Any balance not covered by the schedule is due on completion.
                </Text>
              </View>
            ) : (
              <View key={inst.id}>{row}</View>
            );
          })}
        </View>
      );
    case "accept":
      return (
        <View wrap={false}>
          <Text style={s.prose}>
            Signing below accepts this proposal, its scope, its price of {money(d.totals.total)} and the terms above. This offer
            stands until {sheetDate(d.identity.validUntil)}.
          </Text>
          <View style={s.signRow}>
            <Text style={s.signCell}>Client signature</Text>
            <View style={s.signGap} />
            <Text style={s.signCell}>Date</Text>
          </View>
          <View style={s.signRow}>
            <Text style={s.signCell}>For {d.identity.orgName}</Text>
            <View style={s.signGap} />
            <Text style={s.signCell}>Date</Text>
          </View>
        </View>
      );
    case "files":
      return (
        <View>
          {d.files.map((f, i) => {
            const row = (
              <View style={s.row} wrap={false}>
                <Text style={[s.name, s.cellItem]}>{f.name}</Text>
                <Text style={[s.num, s.cellAmt]}>{fileSize(f.size)}</Text>
              </View>
            );
            return i === d.files.length - 1 ? (
              <View key={f.id} wrap={false}>
                {row}
                <Text style={s.fine}>Listed for reference — the files themselves are sent alongside this document.</Text>
              </View>
            ) : (
              <View key={f.id}>{row}</View>
            );
          })}
        </View>
      );
  }
}

export function ProposalFile({ d, palette }: { d: DocProps; palette: PdfPalette }) {
  const s = sheet(palette);
  const paper = PAPER[d.setup.paper];
  const jobTitle = d.title.trim() || "Untitled proposal";
  const client = d.clientName.trim() || "No client yet";
  const valid = sheetDate(d.identity.validUntil);
  const usable = paper.pt[1] - M - (M + FOOT_H + FOOT_GAP) - (d.setup.letterhead ? 60 : 0);
  const sections = sectionPlan(d);

  return (
    <Document title={`${d.identity.ref} ${jobTitle}`} author={d.identity.orgName} creator={d.identity.orgName} producer={d.identity.orgName}>
      <Page size={paper.pt} style={s.page}>
        {d.setup.letterhead ? (
          <View style={s.runHead} fixed>
            <View style={{ flex: 1, paddingRight: 16 }}>
              <Text style={s.headOrg}>{d.identity.orgName}</Text>
              {d.identity.orgLine ? <Text style={s.headLine}>{d.identity.orgLine}</Text> : null}
            </View>
            <Text style={s.headRef}>
              Proposal {d.identity.ref}
              {"\n"}Valid until {valid}
            </Text>
          </View>
        ) : null}

        {d.setup.cover ? (
          <View style={[s.cover, { height: usable - 24 }]}>
            <Text style={s.coverKicker}>Proposal {d.identity.ref}</Text>
            <Text style={s.coverTitle}>{jobTitle}</Text>
            <Text style={s.coverFor}>
              Prepared for {client}
              {d.address.trim() ? `\n${d.address.trim()}` : ""}
            </Text>
            <View style={s.coverTotal}>
              <Text style={s.coverTotalLabel}>Total</Text>
              <Text style={s.coverTotalValue}>{money(d.totals.total)}</Text>
            </View>
            <Text style={s.coverMeta}>
              {d.identity.orgName} · Valid until {valid}
            </Text>
          </View>
        ) : null}

        <View style={s.docHead} break={d.setup.cover} minPresenceAhead={120}>
          <Text style={s.docTitle}>{jobTitle}</Text>
          <Text style={s.docSub}>
            Proposal {d.identity.ref} · Valid until {valid}
          </Text>
        </View>

        {sections.map((sec, i) => {
          const head = (
            <View style={s.secHead} minPresenceAhead={64}>
              <Text style={s.secNum}>{String(i + 1).padStart(2, "0")}</Text>
              <Text style={s.secTitle}>{sec.title}</Text>
            </View>
          );
          return holdsTogether(sec.key, d, usable) ? (
            <View key={sec.key} style={s.section} wrap={false}>
              {head}
              <SectionBody k={sec.key} d={d} s={s} />
            </View>
          ) : (
            <View key={sec.key} style={s.section}>
              {head}
              <SectionBody k={sec.key} d={d} s={s} />
            </View>
          );
        })}

        {d.setup.footer ? (
          <View style={s.runFoot} fixed>
            <Text style={{ flex: 1, paddingRight: 16 }}>
              {d.identity.ref} · {client}
            </Text>
            {/* A dynamic text is measured before it has content, so it is given
                its width rather than asked for one. */}
            <Text
              style={{ width: 230, textAlign: "right" }}
              render={({ pageNumber, totalPages }) => `Valid until ${valid} · Page ${pageNumber} of ${totalPages}`}
            />
          </View>
        ) : null}
      </Page>
    </Document>
  );
}

/** Builds the file. `origin` is where the fonts are served from. */
export async function buildProposalFile(d: DocProps, palette: PdfPalette, origin: string): Promise<Blob> {
  registerFonts(origin);
  return pdf(<ProposalFile d={d} palette={palette} />).toBlob();
}
