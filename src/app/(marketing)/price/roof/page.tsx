// /price/roof — the homeowner's roof range from the address (2026-10-27). ?address=&city=&state=&zip= prefill the
// field (a cost guide knows its city); ?lat=&lng= too, for a stand with no Maps key. No account.
import type { Metadata } from "next";
import { PriceChrome } from "@/components/v3/price-my-project/price-row";
import { RoofFlow, type Resume } from "@/components/v3/price-my-project/roof-flow";
import type { Site } from "@/components/v3/price-my-project/place-field";
import { db } from "@/lib/db";
import { findHomeByKey } from "@/lib/home/portal";
import { parsePlanEstimate, parsePlanSite } from "@/lib/leadCenter/estimate";
import { PRO_IS } from "@/lib/home/jobflexPro";
import s from "@/components/v3/price-my-project/price.module.css";

export const metadata: Metadata = {
  title: "Price my roof — JobFlex",
  description: "Your roof, read from the sky: type your address, answer three questions, and see a price range for your house. Not a quote — a local JobFlex pro confirms on site.",
};

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim().slice(0, 200) : "");
const num = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** ?home=<key>&plan=<id> — a range saved from "Email me this range", picked up at the form (the dashboard's and the
 *  email's "Get quotes"). Only this home's own planned plan; anything else is the plain flow. */
async function resumeFrom(key: string, planId: string): Promise<Resume | null> {
  try {
    const home = await findHomeByKey(key);
    if (!home) return null;
    const plan = await db.homePlan.findFirst({ where: { id: planId, homeId: home.id, status: "PLANNED" }, select: { notes: true } });
    const e = parsePlanEstimate(plan?.notes);
    const site = parsePlanSite(plan?.notes);
    if (!e || e.trade !== "roof" || !site) return null;
    const homeSqft = e.basis === "size" && e.hidden.facts.footprintSqft ? Math.round(e.hidden.facts.footprintSqft * e.storeys) : null;
    return {
      site,
      plan: { homeKey: key, planId },
      priced: {
        answers: e.answers,
        budgetCents: e.budgetCents,
        homeSqft,
        // The form needs the number and the choices only; the hidden lines stay on the server.
        range: { low: e.range.low, mid: e.range.mid, high: e.range.high, squares: e.squares, pitchLabel: e.pitchLabel, basis: e.basis, scope: [], cityFactor: e.cityFactor, cityWords: null, hidden: { facts: e.hidden.facts, spec: e.hidden.spec, materials: [], labor: [], assumptions: [], scopeText: "" } },
      },
    };
  } catch {
    return null;
  }
}

export default async function PriceRoofPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const resume = typeof sp.home === "string" && typeof sp.plan === "string" ? await resumeFrom(sp.home, sp.plan) : null;
  const address = str(sp.address);
  const lat = num(sp.lat);
  const lng = num(sp.lng);
  const prefill: Site | null =
    address && lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      ? { address, city: str(sp.city), state: str(sp.state).toUpperCase(), zip: str(sp.zip), lat, lng }
      : null;
  return (
    <PriceChrome>
      <div style={{ display: "grid", gap: 8 }}>
        <p className={s.kicker}>Price my roof</p>
        <h1 className={s.h1}>Your roof, read from the sky.</h1>
        <p className={s.lede}>Type your address, answer three questions, see a range for your house. An estimate, not a quote — a local JobFlex pro confirms on site.</p>
      </div>
      <RoofFlow prefill={prefill} resume={resume} />
      <p className={s.small}>{PRO_IS}</p>
    </PriceChrome>
  );
}
