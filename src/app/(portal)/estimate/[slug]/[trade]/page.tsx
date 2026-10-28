// THE ESTIMATOR ON THE CONTRACTOR'S WEBSITE (2026-10-27): /estimate/<slug>/<trade> — the shop's roof, HVAC, fence or
// deck estimator for a homeowner, no login: an address, a few questions, the price in the shop's own prices, and
// "Get my full quote" onto the shop's My leads. Opened by the link the shop pastes anywhere, by the button
// (public/embed/estimator.js → ?embed=1&host=<their site>) or inside a frame. A shop's domain list is enforced here;
// nothing is fetched until the page runs. See lib/webEstimator, actions/webEstimator.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { webPageModel, webPageOffReason } from "@/actions/webEstimator";
import { WebEstimate } from "@/components/v3/web-estimate/web-estimate";
import { WebDeck } from "@/components/v3/web-estimate/web-deck";
import { WebRoof } from "@/components/v3/web-estimate/web-roof";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string; trade: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, trade } = await params;
  const m = await webPageModel(slug, trade, null).catch(() => null);
  return { title: m ? `${m.title} — ${m.shop.name}` : "Estimator", robots: { index: false, follow: false } };
}

export default async function WebEstimatePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug, trade } = await params;
  const sp = await searchParams;
  const embed = sp.embed === "1";
  // the site the button runs on: the embed says so; a frame tells by its referer
  const h = await headers();
  const referer = h.get("referer");
  let refHost: string | null = null;
  try { refHost = referer ? new URL(referer).host : null; } catch { refHost = null; }
  const host = typeof sp.host === "string" ? sp.host : refHost;
  const m = await webPageModel(slug, trade, embed ? host : null);
  if (!m) {
    // The shop's own people, signed in, asked for their own page while the trade is off (or unsaved): say so plainly.
    // Everyone else gets the 404 — an off trade is not a page.
    const why = await webPageOffReason(slug, trade).catch(() => null);
    if (why) {
      return (
        <main className="we" style={{ padding: 24, fontFamily: "Inter, -apple-system, sans-serif", maxWidth: 640, margin: "0 auto" }} data-web-off>
          <h1 style={{ fontSize: 22, margin: "0 0 10px" }}>{why.title}</h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: "#3b4150" }}>{why.text}</p>
        </main>
      );
    }
    notFound();
  }
  if (embed && !m.hostOk) {
    return (
      <main className="we" style={{ padding: 24, fontFamily: "Inter, -apple-system, sans-serif" }}>
        <p style={{ margin: 0, fontSize: 16 }}>This estimator isn&apos;t enabled for this website. The shop can add the site under Settings → Website estimators.</p>
      </main>
    );
  }
  if (m.trade === "deck") {
    // Deck Studio itself (2026-10-28): the homeowner designs in 3D; the price at the end; the lead with the design.
    return (
      <main style={{ minHeight: "100vh", background: embed ? "#fff" : "#f5f3ee" }}>
        <WebDeck shop={m.shop} title={m.title} embed={embed} />
      </main>
    );
  }
  if (m.trade === "roof") {
    // The roof estimator itself (2026-10-28): the live map with the pin, measured from the air, the material, the price.
    return (
      <main style={{ minHeight: "100vh", background: embed ? "#fff" : "#f5f3ee" }}>
        <WebRoof shop={m.shop} title={m.title} basis={m.basis} askEmail={m.askEmail} choices={m.choices} embed={embed} />
      </main>
    );
  }
  return (
    <main style={{ minHeight: "100vh", background: embed ? "#fff" : "#f5f3ee" }}>
      <WebEstimate shop={m.shop} trade={m.trade} title={m.title} basis={m.basis} askEmail={m.askEmail} choices={m.choices} questions={m.questions} embed={embed} />
    </main>
  );
}
