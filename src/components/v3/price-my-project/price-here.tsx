"use client";
// "PRICE IT HERE" IN THE PORTAL'S BOX (2026-10-28, lib/home/portalPrice: one home portal, "make it smart"). Under the
// homeowner's description in both wizards (desk and phone): the estimators the portal runs as a row of tiles, and —
// as soon as the words point at one ("my roof is 15 years old…") — that estimator lit, with one line on what it does
// and the button into it. Whatever they wrote goes with them (lib/home/carry): the brief of "any project", the note to
// the pro on the others. Writing on and pressing Continue still sends the project as words, as before.
import { putCarriedWords } from "@/lib/home/carry";
import { PRICE_NUDGE, priceTradeFor, type PortalTrade } from "@/lib/home/portalPrice";
import { TRAFFIC_EVENTS } from "@/lib/traffic-contract";
import { trackTraffic } from "@/lib/traffic-client";
import { priceCards, type PriceCardKey } from "./cards";
import { Pic } from "./price-row";
import s from "./price-here.module.css";

const SHORT: Record<PriceCardKey, string> = { roof: "Roof", deck: "Deck", fence: "Fence", hvac: "Heating & cooling", any: "Kitchen, bath & more" };

export function PriceHere({ desc, house }: { desc: string; house: boolean }) {
  const cards = priceCards(house).filter((c) => c.live);
  const hit = priceTradeFor(desc, house);
  const lit = hit ? cards.find((c) => c.trade === hit) ?? null : null;
  const pick = (trade: PortalTrade, via: "nudge" | "tile") => {
    putCarriedWords(desc);
    trackTraffic(TRAFFIC_EVENTS.pricePick, { trade, via });
  };
  return (
    <div className={s.box} data-price-here={lit ? lit.trade : ""}>
      {lit && hit ? (
        <a className={s.nudge} href={lit.href} onClick={() => pick(hit, "nudge")} data-price-nudge={hit}>
          <span className={s.nudgePic}>
            <Pic k={lit.key} />
          </span>
          <span className={s.nudgeT}>{PRICE_NUDGE[hit].say}</span>
          <span className={s.nudgeGo}>{PRICE_NUDGE[hit].go} →</span>
        </a>
      ) : null}
      <div className={s.head}>{lit ? "Or price something else" : "Price it here first — about a minute"}</div>
      <div className={s.tiles}>
        {cards.map((c) => (
          <a key={c.key} className={`${s.tile}${lit && c.key === lit.key ? ` ${s.tileOn}` : ""}`} href={c.href} onClick={() => pick(c.trade, "tile")} data-price-tile={c.trade}>
            <span className={s.pic}>
              <Pic k={c.key} />
            </span>
            {SHORT[c.key]}
          </a>
        ))}
      </div>
    </div>
  );
}
