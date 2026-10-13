// THE OPT-IN PICTURE — /book/<slug>/opt-in.png (2026-10-12). The company's own booking form at the step where a client
// agrees to texts, drawn in the company's name with the checkbox as the client finds it — unticked — and the terms and
// privacy links beside it. Twilio's toll-free review is given this picture when JobFlex registers the company's number:
// the opt-in must show the business that sends the texts (error 30506), consent must be optional (30475, 30505) and its
// words explicit (30513). The words are the live page's own (bookingConsentText).
import { ImageResponse } from "next/og";
import { bookingConsentText } from "@/lib/sms/registrationShared";
import { phoneWords, smsCompany } from "../sms-company";

export const dynamic = "force-dynamic";

const INK = "#111111";
const MUTED = "#666666";
const LINE = "#d9d6cf";

// `half`: one of two fields side by side — only then may it grow; in the column a growing box is drawn at no height.
function Field({ label, value, half = false }: { label: string; value: string; half?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, ...(half ? { flex: 1 } : {}) }}>
      <div style={{ fontSize: 20, fontWeight: 600, color: INK }}>{label}</div>
      <div style={{ display: "flex", border: `2px solid ${LINE}`, borderRadius: 12, padding: "16px 20px", fontSize: 24, color: INK }}>{value}</div>
    </div>
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const c = await smsCompany((await params).slug);
  if (!c) return new Response("Not found", { status: 404 });
  const consent = bookingConsentText(c.name);
  const phone = phoneWords(c.phone);
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#f4f2ec", padding: 20, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", width: "100%", background: "#ffffff", border: `2px solid ${LINE}`, borderRadius: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", padding: "40px 48px 32px", borderBottom: `2px solid ${LINE}`, gap: 10 }}>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 4, color: "#555555", textTransform: "uppercase" }}>{c.name}</div>
            <div style={{ fontSize: 44, fontWeight: 700, color: INK }}>Book a visit</div>
            {phone ? <div style={{ fontSize: 22, color: MUTED }}>{`Rather call? ${phone}`}</div> : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", padding: "32px 48px 44px", gap: 26 }}>
            <div style={{ display: "flex", gap: 22, fontSize: 18, letterSpacing: 3, color: "#555555" }}>
              <span>1. SERVICE</span>
              <span>2. TIME</span>
              <span style={{ color: INK, fontWeight: 700 }}>3. DETAILS</span>
              <span>4. BOOKED</span>
            </div>
            <Field label="Full name" value="Jane Doe" />
            <div style={{ display: "flex", gap: 22 }}>
              <Field half label="Email" value="jane@example.com" />
              <Field half label="Phone" value="(206) 555-0142" />
            </div>
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <div style={{ display: "flex", width: 30, height: 30, marginTop: 2, border: `3px solid ${INK}`, borderRadius: 6, background: "#ffffff", flexShrink: 0 }} />
              <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 6, fontSize: 23, lineHeight: 1.4, color: INK }}>
                <div style={{ display: "flex", fontWeight: 700 }}>{consent.lead}</div>
                <div style={{ display: "flex" }}>{consent.rest}</div>
                <div style={{ display: "flex", gap: 12, color: "#1854a0" }}>
                  <span style={{ textDecoration: "underline" }}>Texting terms</span>
                  <span style={{ color: MUTED }}>·</span>
                  <span style={{ textDecoration: "underline" }}>Privacy policy</span>
                </div>
              </div>
            </div>
            <Field label="Address of the visit" value="4567 Rainier Ave S, Seattle, WA" />
            <div style={{ display: "flex", gap: 16 }}>
              <div style={{ display: "flex", background: INK, color: "#ffffff", borderRadius: 12, padding: "18px 30px", fontSize: 24, fontWeight: 700 }}>Book this visit</div>
              <div style={{ display: "flex", border: `2px solid ${INK}`, color: INK, borderRadius: 12, padding: "18px 30px", fontSize: 24, fontWeight: 700 }}>Back</div>
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 1060, height: c.phone ? 960 : 925, headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
