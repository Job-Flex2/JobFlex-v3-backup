// SIZES & MEASUREMENTS — the report as a real .pdf file (owner, 2026-10-21: "make it downloadable in PDF"). Built in
// the browser from the same report the screen draws (lib/plans/measureReport), loaded only on the click — react-pdf and
// the fonts are not part of the page (the manual proposal's file does the same, bp-pdf-file.tsx). Letter, portrait:
// the plan's name and address, the headline figures, what was asked, every room by floor, then each part of the house
// as a table — each figure with where it came from and its sheet — and "Page n of N" with the plan's name at the foot.
import { Document, Font, Page, Text, View, pdf, StyleSheet } from "@react-pdf/renderer";
import { MEASURE_SOURCE_WORD, type MeasureReport, type MeasureRow, type RoomRow } from "@/lib/plans/measureReport";

const INK = "#111317";
const SOFT = "#3d4148";
const MUTED = "#6b7078";
const RULE = "#d9dce1";
const BAND = "#f3f4f6";
const ACCENT = "#1854a0";

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
  // Words stay whole; only a run longer than a column is cut, so it wraps inside its cell.
  Font.registerHyphenationCallback((word) => (word.length > 26 ? word.match(/.{1,14}/g) ?? [word] : [word]));
}

const st = StyleSheet.create({
  // No page-wide lineHeight: with one, react-pdf 4 lays a row that lands on a page break out to ±1.6e22 pt and
  // throws "unsupported number" (found on the Eagle set's 112th work line, 2026-10-21).
  page: { paddingTop: 44, paddingBottom: 54, paddingHorizontal: 44, fontFamily: "Inter", fontSize: 9, color: INK },
  kicker: { fontFamily: "Mono", fontSize: 7.5, letterSpacing: 1.2, color: ACCENT, textTransform: "uppercase" },
  title: { fontSize: 20, fontWeight: 800, marginTop: 4 },
  sub: { fontSize: 9.5, color: SOFT, marginTop: 2 },
  meta: { fontSize: 8, color: MUTED, marginTop: 6 },
  summary: { flexDirection: "row", flexWrap: "wrap", marginTop: 14, borderTopWidth: 1.2, borderTopColor: INK, borderBottomWidth: 0.6, borderBottomColor: RULE },
  sumCell: { width: "25%", paddingVertical: 7, paddingRight: 8 },
  sumLabel: { fontFamily: "Mono", fontSize: 6.5, letterSpacing: 0.8, color: MUTED, textTransform: "uppercase" },
  sumValue: { fontSize: 11, fontWeight: 600, marginTop: 2 },
  h2: { fontSize: 11.5, fontWeight: 800, marginTop: 18, marginBottom: 5 },
  h3: { fontFamily: "Mono", fontSize: 7.5, letterSpacing: 0.8, color: SOFT, textTransform: "uppercase", marginTop: 8, marginBottom: 3 },
  head: { flexDirection: "row", backgroundColor: BAND, paddingVertical: 4, paddingHorizontal: 5, borderBottomWidth: 0.6, borderBottomColor: RULE },
  headCell: { fontFamily: "Mono", fontSize: 6.5, letterSpacing: 0.6, color: MUTED, textTransform: "uppercase" },
  row: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 5, borderBottomWidth: 0.5, borderBottomColor: RULE },
  label: { fontWeight: 600 },
  note: { fontSize: 7, color: MUTED, marginTop: 1 },
  value: { fontWeight: 600 },
  src: { fontSize: 7.5, color: SOFT },
  srcAssumed: { fontSize: 7.5, color: "#96691a" },
  pages: { fontFamily: "Mono", fontSize: 7.5, color: SOFT, textAlign: "right" },
  est: { fontFamily: "Mono", fontSize: 6.5, color: "#96691a" },
  check: { fontSize: 8, color: SOFT, marginTop: 3 },
  foot: { position: "absolute", left: 44, right: 44, bottom: 26, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.5, borderTopColor: RULE, paddingTop: 5, fontSize: 7, color: MUTED },
});

const sheetsOf = (p: number[]) => (p.length ? `p. ${p.slice(0, 6).join(", ")}${p.length > 6 ? "…" : ""}` : "—");

function Rows({ rows }: { rows: MeasureRow[] }) {
  return (
    <View>
      <View style={st.head} fixed={false}>
        <Text style={[st.headCell, { width: "44%" }]}>Item</Text>
        <Text style={[st.headCell, { width: "28%" }]}>Measurement</Text>
        <Text style={[st.headCell, { width: "17%" }]}>Source</Text>
        <Text style={[st.headCell, { width: "11%", textAlign: "right" }]}>Sheet</Text>
      </View>
      {rows.map((r, i) => (
        <View key={`${r.label}-${i}`} style={st.row} wrap={false}>
          <View style={{ width: "44%", paddingRight: 6 }}>
            <Text style={st.label}>{r.label}</Text>
            {r.note ? <Text style={st.note}>{r.note}</Text> : null}
          </View>
          <Text style={[st.value, { width: "28%", paddingRight: 6 }]}>{r.value}</Text>
          <Text style={[r.source === "rule" ? st.srcAssumed : st.src, { width: "17%" }]}>{MEASURE_SOURCE_WORD[r.source]}</Text>
          <Text style={[st.pages, { width: "11%" }]}>{sheetsOf(r.pages)}</Text>
        </View>
      ))}
    </View>
  );
}

function Rooms({ rooms }: { rooms: RoomRow[] }) {
  const levels = Array.from(new Set(rooms.map((r) => r.level)));
  return (
    <View>
      {levels.map((lv) => (
        <View key={lv}>
          <Text style={st.h3} minPresenceAhead={40}>
            {lv} floor
          </Text>
          <View style={st.head}>
            <Text style={[st.headCell, { width: "30%" }]}>Room</Text>
            <Text style={[st.headCell, { width: "22%" }]}>Size</Text>
            <Text style={[st.headCell, { width: "13%", textAlign: "right" }]}>Sq ft</Text>
            <Text style={[st.headCell, { width: "11%", paddingLeft: 8 }]}>Ceiling</Text>
            <Text style={[st.headCell, { width: "14%" }]}>Floor</Text>
            <Text style={[st.headCell, { width: "10%", textAlign: "right" }]}>Sheet</Text>
          </View>
          {rooms
            .filter((r) => r.level === lv)
            .map((r, i) => (
              <View key={`${r.name}-${i}`} style={st.row} wrap={false}>
                <Text style={[st.label, { width: "30%", paddingRight: 6 }]}>{r.name}</Text>
                <Text style={{ width: "22%" }}>{r.size ?? "no size on the plans"}</Text>
                <View style={{ width: "13%", alignItems: "flex-end" }}>
                  <Text style={st.value}>{r.areaSqFt != null ? r.areaSqFt.toLocaleString("en-US") : "—"}</Text>
                  {r.estimated ? <Text style={st.est}>EST.</Text> : null}
                </View>
                <Text style={{ width: "11%", paddingLeft: 8 }}>{r.ceiling ?? "—"}</Text>
                <Text style={{ width: "14%" }}>{r.floor ?? "—"}</Text>
                <Text style={[st.pages, { width: "10%" }]}>{sheetsOf(r.pages)}</Text>
              </View>
            ))}
        </View>
      ))}
    </View>
  );
}

function MeasureFile({ report, plan, date }: { report: MeasureReport; plan: { name: string; address: string | null; file: string }; date: string }) {
  return (
    <Document title={`${plan.name} — sizes and measurements`} author="JobFlex" subject="Sizes and measurements read from the plans">
      <Page size="LETTER" style={st.page}>
        <Text style={st.kicker}>Sizes & measurements · from the plans</Text>
        <Text style={st.title}>{plan.name}</Text>
        {plan.address ? <Text style={st.sub}>{plan.address}</Text> : null}
        <Text style={st.meta}>
          {plan.file} · {report.sheets} sheet{report.sheets === 1 ? "" : "s"} read · {date}
        </Text>

        <View style={st.summary}>
          {report.summary.map((x) => (
            <View key={x.label} style={st.sumCell}>
              <Text style={st.sumLabel}>{x.label}</Text>
              <Text style={st.sumValue}>{x.value}</Text>
            </View>
          ))}
        </View>

        {report.asked && report.asked.rows.length ? (
          <View>
            <Text style={st.h2} minPresenceAhead={60}>
              You asked: {report.asked.request}
            </Text>
            <Rows rows={report.asked.rows} />
          </View>
        ) : null}

        {report.rooms.length ? (
          <View>
            <Text style={st.h2} minPresenceAhead={60}>
              Rooms
            </Text>
            <Rooms rooms={report.rooms} />
          </View>
        ) : null}

        {report.sections.map((s) => (
          <View key={s.key}>
            <Text style={st.h2} minPresenceAhead={60}>
              {s.title}
            </Text>
            <Rows rows={s.rows} />
          </View>
        ))}

        {report.checks.length ? (
          <View wrap={false}>
            <Text style={st.h2}>To check on site</Text>
            {report.checks.map((c) => (
              <Text key={c} style={st.check}>
                • {c}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={st.foot} fixed>
          <Text>
            {plan.name} · read from the plans by JobFlex — verify critical sizes on site before ordering
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** The report as a PDF (a Blob). `origin`: where the fonts are served from — the site, or a folder for the checks. */
export async function buildMeasurePdf(report: MeasureReport, plan: { name: string | null; address: string | null; file: string }, origin: string): Promise<{ blob: Blob; name: string }> {
  registerFonts(origin);
  const name = (plan.name || plan.file.replace(/\.pdf$/i, "") || "Plans").trim();
  const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const blob = await pdf(<MeasureFile report={report} plan={{ name, address: plan.address, file: plan.file }} date={date} />).toBlob();
  return { blob, name };
}

/** The report as a PDF file, saved to the device under the plan's name. */
export async function downloadMeasurePdf(report: MeasureReport, plan: { name: string | null; address: string | null; file: string }): Promise<void> {
  const { blob, name } = await buildMeasurePdf(report, plan, window.location.origin);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 80)} — sizes and measurements.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
