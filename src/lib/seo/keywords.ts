// How people ask for each work's price (2026-10-26) — the cost guides' H1,
// sub-headings and FAQ are written to answer these phrasings, so one page
// covers "cost to replace a roof in Dallas", "roof replacement price Dallas
// TX" and "how much does a new roof cost in Dallas". The trade's landing copy
// (landing-e/landing-variants) names the work the same way. Plain data.

import type { SeoTradeSlug } from "./trades";

export type SeoPhrases = {
  /** "How much does a new roof cost" — the question form. */
  ask: string;
  /** "cost to replace a roof" — the "cost to" form. */
  costTo: string;
  /** "roof replacement price". */
  price: string;
  /** "roof cost per square foot". */
  perUnit: string;
  /** "roofing" — the material table's heading noun. */
  materialNoun: string;
  /** Other searched names for the work, used once in the lede. */
  aliases: string[];
};

export const SEO_PHRASES: Record<SeoTradeSlug, SeoPhrases> = {
  "roof-replacement": {
    ask: "How much does a new roof cost",
    costTo: "cost to replace a roof",
    price: "roof replacement price",
    perUnit: "roof cost per square foot",
    materialNoun: "roofing material",
    aliases: ["re-roof", "new shingle roof", "roof installation"],
  },
  "fence-installation": {
    ask: "How much does a new fence cost",
    costTo: "cost to install a fence",
    price: "fence installation price",
    perUnit: "fence cost per linear foot",
    materialNoun: "fence type",
    aliases: ["privacy fence", "vinyl fence", "chain-link fence"],
  },
  "hvac-replacement": {
    ask: "How much does a new HVAC system cost",
    costTo: "cost to replace an HVAC system",
    price: "HVAC replacement price",
    perUnit: "HVAC cost per ton",
    materialNoun: "system type",
    aliases: ["new AC and furnace", "heat pump installation", "central air replacement"],
  },
  "deck-building": {
    ask: "How much does it cost to build a deck",
    costTo: "cost to build a deck",
    price: "deck building price",
    perUnit: "deck cost per square foot",
    materialNoun: "decking material",
    aliases: ["new deck", "composite deck", "wood deck installation"],
  },
  "siding-installation": {
    ask: "How much does new siding cost",
    costTo: "cost to replace siding",
    price: "siding installation price",
    perUnit: "siding cost per square foot",
    materialNoun: "siding material",
    aliases: ["re-siding", "vinyl siding installation", "fiber-cement siding"],
  },
  "house-painting": {
    ask: "How much does it cost to paint a house",
    costTo: "cost to paint a house",
    price: "house painting price",
    perUnit: "painting cost per square foot",
    materialNoun: "painting scope",
    aliases: ["interior painting", "exterior house painting", "painters"],
  },
};
