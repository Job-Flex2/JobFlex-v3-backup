// THE ESTIMATORS' CARDS (owner, 2026-10-27: "roof first; the other estimators visible in a row and very attractive";
// 2026-10-28: every card runs JobFlex's own estimator; then "one home portal"). They live in the portal now
// (lib/home/portalPrice): the roof prices itself at /homeowner/price/roof; the other four run the website estimators
// in house mode (lib/webEstimator houseShop) at /homeowner/price/<trade> once the Lead Center names the house org;
// until then they open the describe-and-match intake in the homeowner's words (lib/home/homeownerDoor).
// Pure, so the row is one function of one boolean.
import { homeownerDoorFor } from "@/lib/home/homeownerDoor";
import { portalPriceHref, type PortalTrade } from "@/lib/home/portalPrice";

export type PriceCardKey = "roof" | "deck" | "fence" | "hvac" | "any";

export interface PriceCard {
  key: PriceCardKey;
  /** The portal estimator this card runs ("any" is Smart Proposal: "smart"). */
  trade: PortalTrade;
  title: string;
  blurb: string;
  go: string;
  href: string;
  live: boolean;
}

export function priceCards(house: boolean): ReadonlyArray<PriceCard> {
  return [
    { key: "roof", trade: "roof", title: "Roof", blurb: "Measured from the sky · a range in a minute", go: "Price my roof", href: portalPriceHref("roof"), live: true },
    house
      ? { key: "deck", trade: "deck", title: "Deck", blurb: "Design it in 3D on your lot — priced as you build it.", go: "Design my deck", href: portalPriceHref("deck"), live: true }
      : { key: "deck", trade: "deck", title: "Deck", blurb: "Designed in 3D, priced before it's built. Describe it — a local JobFlex pro designs and prices it.", go: "Describe my deck", href: homeownerDoorFor("decking")?.href ?? "/homeowner", live: false },
    house
      ? { key: "fence", trade: "fence", title: "Fence", blurb: "Draw it on your lot from the air — a range in a minute.", go: "Price my fence", href: portalPriceHref("fence"), live: true }
      : { key: "fence", trade: "fence", title: "Fence", blurb: "Pick the sides, pick a style. Describe it — a local JobFlex pro prices it.", go: "Describe my fence", href: homeownerDoorFor("fencing")?.href ?? "/homeowner", live: false },
    house
      ? { key: "hvac", trade: "hvac", title: "Heating & cooling", blurb: "Your house looked up, the system sized to it — a range in a minute.", go: "Price my new system", href: portalPriceHref("hvac"), live: true }
      : { key: "hvac", trade: "hvac", title: "Heating & cooling", blurb: "Replace or add a system. Describe it — a local JobFlex pro prices it.", go: "Describe the job", href: homeownerDoorFor("hvac")?.href ?? "/homeowner", live: false },
    house
      ? { key: "any", trade: "smart", title: "Any project", blurb: "Describe it, add a photo — a range in a minute.", go: "Price my project", href: portalPriceHref("smart"), live: true }
      : { key: "any", trade: "smart", title: "Any project", blurb: "Send a photo, get a range. Describe it — a local JobFlex pro prices it.", go: "Describe my project", href: "/homeowner", live: false },
  ];
}
