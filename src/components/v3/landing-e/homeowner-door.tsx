// "Homeowner looking for a fence? Get quotes from local pros →" — under the button below the product shot on a trade's
// ad landing (lib/home/homeownerDoor). Its own tracked spot ("homeowner"), so a homeowner's click is told apart from
// the sign-up buttons on the live map and in the analyst.
import { homeownerDoorFor } from "@/lib/home/homeownerDoor";
import { portalPriceHref, type PortalTrade } from "@/lib/home/portalPrice";

/** "See your price first" (2026-10-27; in the homeowner portal since 2026-10-28): the trade's own estimator where the
 *  portal runs one (the page sends them to the describe box while the house estimators are off), else the portal. */
const PRICED: Record<string, PortalTrade> = { roofing: "roof", decking: "deck", fencing: "fence", hvac: "hvac", "kitchen-bath": "smart" };
const priceHref = (key: string) => (PRICED[key] ? portalPriceHref(PRICED[key]) : "/homeowner");

export function HomeownerDoor({ trade }: { trade?: string | null }) {
  const door = homeownerDoorFor(trade);
  if (!door) return null;
  return (
    <p className="lp-home-door" data-home-door={door.key}>
      Homeowner looking for {door.thing}?{" "}
      <a href={door.href} data-cta="homeowner">
        Get quotes from local pros<span aria-hidden> →</span>
      </a>
      {" · "}
      <a href={priceHref(door.key)} data-cta="price">
        See your price first<span aria-hidden> →</span>
      </a>
    </p>
  );
}
