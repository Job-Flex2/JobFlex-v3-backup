import * as React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";

// ── Palette (hardcoded — react-pdf can't use CSS vars) ─────────
const C = {
  paper: "#FAFAF7",
  ink: "#111113",
  soft: "#2A2A2E",
  muted: "#6B6A64",
  faint: "#A6A49D",
  line: "#E8E6DE",
  accent: "#1F7A52",
};

const s = StyleSheet.create({
  page: {
    backgroundColor: C.paper,
    color: C.ink,
    padding: 56,
    fontFamily: "Helvetica",
    fontSize: 10,
    lineHeight: 1.5,
  },
  // The shop's logo above the title: whole and in proportion inside a band
  // one line of title tall, left-aligned with everything under it.
  logoRow: { marginBottom: 18 },
  logo: { height: 46, maxWidth: 170, objectFit: "contain", objectPosition: "left" },
  eyebrow: {
    fontSize: 8,
    letterSpacing: 1.6,
    color: C.muted,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 32,
    fontFamily: "Helvetica-Bold",
    marginTop: 8,
    letterSpacing: -0.7,
    lineHeight: 1.08,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
    paddingBottom: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: C.line,
  },
  metaItem: { flexDirection: "column", gap: 2 },
  metaLabel: {
    fontSize: 7.5,
    letterSpacing: 1.4,
    color: C.muted,
    textTransform: "uppercase",
  },
  metaValue: { fontSize: 11, color: C.ink },

  section: { marginTop: 28 },
  sectionLabel: {
    fontSize: 8,
    letterSpacing: 1.6,
    color: C.muted,
    textTransform: "uppercase",
    marginBottom: 10,
  },

  tableHead: {
    flexDirection: "row",
    paddingBottom: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: C.line,
  },
  th: {
    fontSize: 7.5,
    letterSpacing: 1.3,
    color: C.muted,
    textTransform: "uppercase",
  },
  thItem: { flex: 3 },
  thQty: { flex: 0.7, textAlign: "right" },
  thUnit: { flex: 1, textAlign: "right" },
  thTotal: { flex: 1.1, textAlign: "right" },

  row: {
    flexDirection: "row",
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 0.25,
    borderBottomColor: C.line,
  },
  rowLast: { borderBottomWidth: 0 },
  itemName: { fontSize: 11, color: C.ink, fontFamily: "Helvetica-Bold" },
  itemDesc: { fontSize: 9, color: C.muted, marginTop: 2 },
  itemCaption: {
    fontSize: 7,
    letterSpacing: 1.2,
    color: C.faint,
    textTransform: "uppercase",
    marginTop: 3,
  },
  num: { fontSize: 10, color: C.soft, textAlign: "right" },
  total: {
    fontSize: 12,
    color: C.ink,
    textAlign: "right",
    fontFamily: "Helvetica-Bold",
  },

  totalsBlock: {
    marginTop: 18,
    alignSelf: "flex-end",
    width: 240,
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  totalsLabel: { fontSize: 10, color: C.muted },
  totalsValue: { fontSize: 10, color: C.ink },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 10,
    marginTop: 6,
    borderTopWidth: 1.5,
    borderTopColor: C.ink,
  },
  grandTotalLabel: {
    fontSize: 8,
    letterSpacing: 1.6,
    color: C.muted,
    textTransform: "uppercase",
  },
  grandTotalValue: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: C.ink,
    letterSpacing: -0.6,
  },

  prose: {
    fontSize: 10.5,
    color: C.soft,
    lineHeight: 1.65,
  },

  previewImg: {
    width: "100%",
    height: 230,
    objectFit: "cover",
    borderRadius: 6,
  },

  installmentsRow: {
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
  },
  installmentCard: {
    flex: 1,
    minWidth: 140,
    padding: 14,
    borderWidth: 0.5,
    borderColor: C.line,
    borderRadius: 6,
  },
  installmentNum: {
    fontSize: 7.5,
    letterSpacing: 1.4,
    color: C.faint,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  installmentLabel: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: C.ink,
    marginBottom: 4,
  },
  installmentAmount: { fontSize: 15, color: C.ink, letterSpacing: -0.3 },

  footer: {
    position: "absolute",
    bottom: 32,
    left: 56,
    right: 56,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: C.line,
  },
  footerText: { fontSize: 8, color: C.muted },
  footerAccent: { fontSize: 8, color: C.accent, letterSpacing: 0.5 },
});

export interface ProposalPdfData {
  title: string;
  description?: string | null;
  scopeOfWork?: string | null;
  notes?: string | null;
  subtotal: number;
  discountTotal: number;
  taxRate: number;
  taxTotal: number;
  total: number;
  currency: string;
  createdAt: Date;
  validUntil?: Date | null;
  publicId: string;
  orgName: string;
  /** The shop's logo as a PNG/JPEG data URL (lib/orgLogoServer pdfLogoSrc); absent = no logo printed. */
  logoSrc?: string | null;
  /** Approved change orders, printed under the original total with the contract value. */
  changeOrders?: Array<{ label: string; total: number }>;
  contractTotal?: number;
  previewImageUrl?: string | null;
  clientName?: string | null;
  clientAddress?: string | null;
  /** "Show to client" — the scope prints only when asked; every route passes it. */
  showScope?: boolean;
  lineItems: Array<{
    name: string;
    description?: string | null;
    measurementType: string;
    quantity: number;
    unitPrice: number;
    total: number;
    /** "Labor + material breakdown" — set by the route when the proposal shows it. */
    splitCaption?: string | null;
  }>;
  installments: Array<{
    label: string;
    amount: number;
    isPercent: boolean;
  }>;
}

export function money(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  }).format(n);
}

function longDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(d));
}

function measurementCaption(t: string) {
  switch (t) {
    case "SQFT":
      return "Sq ft";
    case "SQUARE":
      return "Square";
    case "LINEAR_FT":
      return "Linear ft";
    case "CUBIC_FT":
      return "Cubic ft";
    case "LUMP_SUM":
      return "Lump sum";
    case "HOUR":
      return "Hour";
    case "CU_YARD":
      return "Cubic yd";
    case "SQ_YARD":
      return "Sq yd";
    case "EACH":
    case "SHEET":
    case "BUNDLE":
    case "ROLL":
    case "BOX":
    case "BAG":
    case "PIECE":
    case "GALLON":
    case "TON":
    case "SET":
    case "BUCKET":
    case "TUBE":
      // "Each", "Sheet", "Bundle"… — the measure the line is counted or bought in.
      return t.charAt(0) + t.slice(1).toLowerCase();
    default:
      return "Unit";
  }
}

export function ProposalPdfDocument({ data }: { data: ProposalPdfData }) {
  const refNum = data.publicId.slice(0, 8).toUpperCase();
  return (
    <Document
      title={data.title}
      author={data.orgName}
      creator={data.orgName}
      producer="JobFlex"
    >
      <Page size="LETTER" style={s.page}>
        {data.logoSrc ? (
          <View style={s.logoRow}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image has no alt prop */}
            <Image src={data.logoSrc} style={s.logo} />
          </View>
        ) : null}
        <View>
          <Text style={s.eyebrow}>Prepared for {data.clientName ?? "client"}</Text>
          <Text style={s.title}>{data.title}</Text>
        </View>

        <View style={s.metaRow}>
          <View style={s.metaItem}>
            <Text style={s.metaLabel}>From</Text>
            <Text style={s.metaValue}>{data.orgName}</Text>
          </View>
          <View style={s.metaItem}>
            <Text style={s.metaLabel}>Reference</Text>
            <Text style={s.metaValue}>#{refNum}</Text>
          </View>
          <View style={s.metaItem}>
            <Text style={s.metaLabel}>Issued</Text>
            <Text style={s.metaValue}>{longDate(data.createdAt)}</Text>
          </View>
          <View style={s.metaItem}>
            <Text style={s.metaLabel}>Valid until</Text>
            <Text style={s.metaValue}>{longDate(data.validUntil)}</Text>
          </View>
        </View>

        {data.description && (
          <View style={s.section}>
            <Text style={s.prose}>{data.description}</Text>
          </View>
        )}

        {data.previewImageUrl ? (
          <View style={s.section} wrap={false}>
            <Text style={s.sectionLabel}>3D preview</Text>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image has no alt prop */}
            <Image src={data.previewImageUrl} style={s.previewImg} />
          </View>
        ) : null}

        <View style={s.section}>
          <Text style={s.sectionLabel}>Line items</Text>
          <View style={s.tableHead}>
            <Text style={[s.th, s.thItem]}>Item</Text>
            <Text style={[s.th, s.thQty]}>Qty</Text>
            <Text style={[s.th, s.thUnit]}>Unit</Text>
            <Text style={[s.th, s.thTotal]}>Total</Text>
          </View>
          {data.lineItems.map((l, i) => (
            <View
              key={i}
              style={[s.row, i === data.lineItems.length - 1 ? s.rowLast : {}]}
            >
              <View style={{ flex: 3 }}>
                <Text style={s.itemName}>{l.name}</Text>
                {l.description && <Text style={s.itemDesc}>{l.description}</Text>}
                <Text style={s.itemCaption}>{measurementCaption(l.measurementType)}</Text>
                {l.splitCaption ? <Text style={s.itemCaption}>{l.splitCaption}</Text> : null}
              </View>
              <Text style={[s.num, { flex: 0.7 }]}>{l.quantity}</Text>
              <Text style={[s.num, { flex: 1 }]}>{money(l.unitPrice, data.currency)}</Text>
              <Text style={[s.total, { flex: 1.1 }]}>{money(l.total, data.currency)}</Text>
            </View>
          ))}

          <View style={s.totalsBlock}>
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>Subtotal</Text>
              <Text style={s.totalsValue}>{money(data.subtotal, data.currency)}</Text>
            </View>
            {data.discountTotal > 0 && (
              <View style={s.totalsRow}>
                <Text style={s.totalsLabel}>Discount</Text>
                <Text style={s.totalsValue}>−{money(data.discountTotal, data.currency)}</Text>
              </View>
            )}
            {/* Always print the tax line — at 0% it reads "Tax · 0.00%" / $0. */}
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>
                Tax · {(data.taxRate * 100).toFixed(2)}%
              </Text>
              <Text style={s.totalsValue}>{money(data.taxTotal, data.currency)}</Text>
            </View>
            <View style={s.grandTotalRow}>
              <Text style={s.grandTotalLabel}>{data.changeOrders?.length ? "Original total" : "Total"}</Text>
              <Text style={s.grandTotalValue}>{money(data.total, data.currency)}</Text>
            </View>
            {data.changeOrders?.map((c, i) => (
              <View style={s.totalsRow} key={i}>
                <Text style={s.totalsLabel}>{c.label}</Text>
                <Text style={s.totalsValue}>{c.total >= 0 ? "+" : "−"}{money(Math.abs(c.total), data.currency)}</Text>
              </View>
            ))}
            {data.changeOrders?.length && data.contractTotal != null ? (
              <View style={s.grandTotalRow}>
                <Text style={s.grandTotalLabel}>Contract total</Text>
                <Text style={s.grandTotalValue}>{money(data.contractTotal, data.currency)}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {data.scopeOfWork && data.showScope !== false && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Scope of work</Text>
            <Text style={s.prose}>{data.scopeOfWork}</Text>
          </View>
        )}

        {data.installments.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Payment schedule</Text>
            <View style={s.installmentsRow}>
              {data.installments.map((i, idx) => (
                <View key={idx} style={s.installmentCard}>
                  <Text style={s.installmentNum}>#{idx + 1}</Text>
                  <Text style={s.installmentLabel}>{i.label}</Text>
                  <Text style={s.installmentAmount}>
                    {i.isPercent
                      ? `${i.amount}% · ${money(data.total * (i.amount / 100), data.currency)}`
                      : money(i.amount, data.currency)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {data.notes && (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Notes</Text>
            <Text style={s.prose}>{data.notes}</Text>
          </View>
        )}

        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            Prepared by {data.orgName} · #{refNum}
          </Text>
          <Text style={s.footerAccent}>JOBFLEX · jobflex.app</Text>
        </View>
      </Page>
    </Document>
  );
}
