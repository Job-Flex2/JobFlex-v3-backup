// A TRADE WORD FROM THE HOMEOWNER'S OWN WORDS (2026-10-14). Pure, client-safe.
//
// The AI classifier (lib/ai/detectTrade) names the trade a request is routed
// on; when it is off, unsure or failed, the request still has to read like
// something on the homeowner's dashboard, their project page, their calendar
// and the admin's alert — "Kitchen remodel · Kirkland, WA", not "Project ·
// 98033". This guess is for words only, never for routing: the Lead Center
// keeps its honest "unclassified" and a person places the request.

const RULES: readonly [RegExp, string][] = [
  [/\bepoxy\b|garage floor/i, "Epoxy floor"],
  [/\bgutter/i, "Gutters"],
  [/\broof|shingle|\bleak(s|ing)?\b.*(roof|chimney|ceiling)|\bchimney\b/i, "Roofing"],
  [/\bsiding\b|\bstucco\b/i, "Siding"],
  [/\bsolar\b/i, "Solar"],
  [/\bkitchen|cabinet|countertop|backsplash/i, "Kitchen remodel"],
  [/\bbath(room)?\b|\bshower\b|\btub\b|\bvanity\b|\btoilet\b/i, "Bathroom remodel"],
  [/\bbasement|crawl ?space/i, "Basement"],
  [/\bdeck\b|\bpergola\b|\bpatio cover|\bgazebo\b/i, "Deck"],
  [/\bfenc(e|ing)\b|\bgate\b/i, "Fence"],
  [/\bhvac\b|\bfurnace\b|\bheat pump\b|\ba\/?c\b|air condition|\bmini.?split\b|\bducts?\b|\bthermostat\b/i, "HVAC"],
  [/\bplumb|water heater|\bdrain\b|\bpipe\b|\bfaucet\b|\bsewer\b/i, "Plumbing"],
  [/\belectric|\bpanel\b|\boutlet|\bwiring\b|\bev charger\b|\blighting\b/i, "Electrical"],
  [/\bwindow|\bdoors?\b|\bslider\b/i, "Windows & doors"],
  [/\bpaint|\brepaint|\bstain(ing)?\b/i, "Painting"],
  [/\bdrywall|\bsheetrock|\bplaster/i, "Drywall"],
  [/\btile\b|\btiling\b/i, "Tile"],
  [/\bfloor|hardwood|\blvp\b|\blaminate\b|\bcarpet\b|\bvinyl plank/i, "Flooring"],
  [/\bconcrete\b|\bdriveway\b|\bsidewalk\b|\bslab\b|\bpaver/i, "Concrete"],
  [/\binsulat/i, "Insulation"],
  [/\bgarage door/i, "Garage door"],
  [/\blandscap|\byard\b|\bsod\b|\bsprinkler|\birrigation|\bretaining wall|\btree\b/i, "Landscaping"],
  [/\bremodel|\brenovat|\baddition\b|\badu\b/i, "Remodel"],
  [/\brepair|\bhandyman|\bfix\b/i, "Repair"],
];

/** "Kitchen remodel" from "redo my kitchen with shaker cabinets…"; null when the words say nothing. */
export function guessTrade(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  for (const [re, word] of RULES) if (re.test(t)) return word;
  return null;
}
