// THE ROW'S CARDS (owner, 2026-10-27: "roof first; the other estimators visible in a row and very attractive"; 2026-10-28:
// every card runs JobFlex's own estimator). The roof prices itself at /price/roof. The other four run the website
// estimators in house mode (/estimate/jobflex/<trade>, lib/webEstimator houseShop) once the Lead Center names the
// house org; until then they open the describe-and-match intake in the homeowner's words (lib/home/homeownerDoor).
// Pure, so the row is one function of one boolean.
import { homeownerDoorFor } from "@/lib/home/homeownerDoor";

export type PriceCardKey = "roof" | "deck" | "fence" | "hvac" | "any";

export interface PriceCard {
  key: PriceCardKey;
  title: string;
  blurb: string;
  go: string;
  href: string;
  live: boolean;
}

const HOUSE = "/estimate/jobflex";

export function priceCards(house: boolean): ReadonlyArray<PriceCard> {
  return [
    { key: "roof", title: "Roof", blurb: "Measured from the sky · a range in a minute", go: "Price my roof", href: "/price/roof", live: true },
    house
      ? { key: "deck", title: "Deck", blurb: "Design it in 3D on your lot — priced as you build it.", go: "Design my deck", href: `${HOUSE}/deck`, live: true }
      : { key: "deck", title: "Deck", blurb: "Designed in 3D, priced before it's built. Describe it — a local JobFlex pro designs and prices it.", go: "Describe my deck", href: homeownerDoorFor("decking")?.href ?? "/homeowner", live: false },
    house
      ? { key: "fence", title: "Fence", blurb: "Draw it on your lot from the air — a range in a minute.", go: "Price my fence", href: `${HOUSE}/fence`, live: true }
      : { key: "fence", title: "Fence", blurb: "Pick the sides, pick a style. Describe it — a local JobFlex pro prices it.", go: "Describe my fence", href: homeownerDoorFor("fencing")?.href ?? "/homeowner", live: false },
    house
      ? { key: "hvac", title: "Heating & cooling", blurb: "Your house looked up, the system sized to it — a range in a minute.", go: "Price my new system", href: `${HOUSE}/hvac`, live: true }
      : { key: "hvac", title: "Heating & cooling", blurb: "Replace or add a system. Describe it — a local JobFlex pro prices it.", go: "Describe the job", href: homeownerDoorFor("hvac")?.href ?? "/homeowner", live: false },
    house
      ? { key: "any", title: "Any project", blurb: "Describe it, add a photo — a range in a minute.", go: "Price my project", href: `${HOUSE}/smart`, live: true }
      : { key: "any", title: "Any project", blurb: "Send a photo, get a range. Describe it — a local JobFlex pro prices it.", go: "Describe my project", href: "/homeowner", live: false },
  ];
}
