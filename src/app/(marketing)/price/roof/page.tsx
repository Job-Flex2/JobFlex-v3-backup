// /price/roof — the homeowner's roof range from the address (2026-10-27). ?address=&city=&state=&zip= prefill the
// field (a cost guide knows its city); ?lat=&lng= too, for a stand with no Maps key. No account.
import type { Metadata } from "next";
import { PriceChrome } from "@/components/v3/price-my-project/price-row";
import { RoofFlow } from "@/components/v3/price-my-project/roof-flow";
import type { Site } from "@/components/v3/price-my-project/place-field";
import s from "@/components/v3/price-my-project/price.module.css";

export const metadata: Metadata = {
  title: "Price my roof — JobFlex",
  description: "Your roof, read from the sky: type your address, answer three questions, and see a price range for your house. Not a quote — a local pro confirms on site.",
};

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim().slice(0, 200) : "");
const num = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

export default async function PriceRoofPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
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
        <p className={s.lede}>Type your address, answer three questions, see a range for your house. An estimate, not a quote — a local pro confirms on site.</p>
      </div>
      <RoofFlow prefill={prefill} />
    </PriceChrome>
  );
}
