// WHAT IS SAID ALOUD, AND WHAT A CLIENT HEARS (2026-10-21) — pure.
//
// Owner: "don't repeat the pricing back for any changes … don't say and don't repeat any numbers, just listen to what
// the client wants to add; offer some other options, really quick, and understand different wording for clients …
// on the contractor side, if he builds by speech, don't speak back the measurements and pricing, just show it in the
// text, how much it's going to be, in the line."
//
//   · `spokenReply` — the reply as it is SPOKEN, to anyone: short, and without a number in it. A sentence about the
//     price goes; a sentence with a measurement keeps only its words ("It's over 30 in. up — add a railing?" → "Add a
//     railing?"); a change that leaves nothing to say is "Done." The written line keeps everything.
//   · the client's side (the homeowner's link): `clientGate` keeps the contractor's work out of their hands — prices,
//     the building parts (concrete, joists, permits, code), proposals, links, the shop's memory — and answers in words;
//     `clientText` takes any price out of what they read; `clientOffer` is the quick next idea after a change
//     ("Want to see it with a railing, or lights on the steps?").

import type { DeckDesign } from "../design";
import type { DeckCommand, Question } from "./commands";

export type Audience = "contractor" | "client";

/** A money figure or a statement of the price ("Price $9,910 (up $3,029).", "the price went up") — not the word
 *  itself ("Your contractor puts the price together" is said). */
const PRICE = /\$|\b(?:dollars?|bucks|before tax|per square foot|a square foot)\b|\b(?:price|cost|total)s?\s+(?:is|was|went|goes|now|up|down|unchanged|stays|comes|of)\b/i;
const DIGIT = /\d/;
/** A measurement in words ("about a quarter yard", "two feet") — a number word next to a unit. */
const NUMBER_WORD = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|half|quarter|third|dozen)\b/i;
const UNIT_WORD = /\b(?:yards?|feet|foot|ft|inch(?:es)?|sq|square|cubic|bags?|lbs?|pounds?|gallons?|degrees?|percent|tons?)\b/i;
const measured = (s: string) => DIGIT.test(s) || (NUMBER_WORD.test(s) && UNIT_WORD.test(s));

const COUNT_SAID = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
/** A count of things said in words ("Added 2 patio heaters" → "Added two patio heaters") — a count is not a
 *  measurement; a number with a unit after it ("2 ft", "6.5 in.", "2x8") stays a number and keeps its sentence out. */
const countsInWords = (s: string) =>
  s.replace(/(^|[\s(])([1-9]|1[0-2])(?=\s+(?!(?:ft|feet|foot|in|inch|inches|sq|square|cubic|yards?|lbs?|pounds?|gallons?|degrees?|percent|kw|volts?|amps?|by|x|of an?)\b)[a-z])/gi, (_m, pre: string, n: string) => `${pre}${COUNT_SAID[Number(n)]}`);

/** Sentences, kept whole ("Ready — 3 in 12." stays one; "3 ft 6 in. (42 in.) above the ground." stays one). */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"“])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const CONJ = /^(?:so|and|but|then|which|while)\s+/i;

/**
 * A sentence as it can be said: whole when it has no measure in it; else only the clauses that stand on their own —
 * its opening clause, one after "so / and / but", a question ("It's over 30 in. up, so the code wants a guard." →
 * "The code wants a guard."; "…6 risers of 6.5 in., 5 treads, onto a concrete pad" → nothing) — or null.
 */
function wordsOnly(sentence: string): string | null {
  if (PRICE.test(sentence)) return null;
  // "Heads up — stair 1 (left): 6 risers: a graspable handrail 34 to 38 in. …" — the code check is on the screen.
  if (/^heads up\b/i.test(sentence) && measured(sentence)) return "Heads up — there's a code check to look at.";
  const s = countsInWords(sentence.replace(/\s*\([^)]*\d[^)]*\)/g, ""));
  // "Switched to Trex Transcend (reddish brown)." → "…, reddish brown."
  if (!measured(s)) return tidy(s.replace(/\s*\(([^)]*)\)/g, ", $1"));
  const parts = s.split(/\s+[—–-]\s+|;\s+|:\s+|,\s+/).flatMap((raw, i) => {
    const p = raw.replace(CONJ, "").replace(/[.!]+$/, "").trim();
    const stands = i === 0 || CONJ.test(raw) || /^[A-Z]/.test(p) || p.endsWith("?");
    return stands && !measured(p) && p.replace(/[^a-z]/gi, "").length > 3 && p.split(/\s+/).length >= 2 ? [p] : [];
  });
  return parts.length ? tidy(parts.join(" — ")) : null;
}

function tidy(s: string): string {
  let t = s.replace(/\s+([.,!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t += ".";
  return t;
}

const ACKS = ["Done.", "Got it.", "There you go."];
const isAsk = (s: string) => s.endsWith("?");

/**
 * The reply as it is spoken: what was done or found, and one question — no price and no measurement in it.
 * The first sentence carries the change or the answer: said when it can be said in words ("A curved front."), else
 * "Done." for a change (with one more thing worth hearing — "The code wants a guard.") or "It's on your screen." for
 * an answer made of numbers. One question, asked once: the reply's own, else the one waiting. `seed` picks the
 * acknowledgement so the studio does not say the same word every time.
 */
export function spokenReply(r: { say: string; pending: { ask: string } | null; changed: boolean }, audience: Audience, seed = 0): string {
  const said = sentences(r.say).map(wordsOnly);
  if (!said.length) return "";
  const first = said[0];
  const rest = said.slice(1).filter((s): s is string => !!s);
  const question = [first, ...rest].filter((s): s is string => !!s && isAsk(s)).pop() ?? (r.pending ? wordsOnly(r.pending.ask) : null);
  const screen = audience === "client" ? "Here it is." : "It's on your screen.";
  let out: string[];
  // "Added a chandelier at the peak. Added two patio heaters." — a second change of the same kind is said too.
  const lead = (x: string) => x.split(/\s+/)[0].toLowerCase();
  const also = first && !isAsk(first) ? rest.find((x) => !isAsk(x) && lead(x) === lead(first) && x !== first) : undefined;
  if (first && !isAsk(first)) out = also ? [first, also] : [first];
  else if (r.changed) {
    const more = rest.find((s) => !isAsk(s));
    out = [ACKS[Math.abs(seed) % ACKS.length], ...(more ? [more] : [])];
  } else out = first ? [] : [screen];
  if (question && !out.includes(question)) out.push(question);
  return out.join(" ").trim() || screen;
}

/** What a client reads: the reply without a price in it. */
export function clientText(say: string): string {
  const kept = sentences(say)
    .map((s) => {
      if (!PRICE.test(s)) return s;
      // "Glass panels, 36 in. high — up $4,511." → keep the part before the price.
      const parts = s.split(/\s+[—–-]\s+|;\s+|\.\s+|\(\s*/).filter((p) => !PRICE.test(p) && p.replace(/[^a-z]/gi, "").length > 3);
      return parts.length ? tidy(parts.join(" — ")) : "";
    })
    .filter(Boolean);
  return kept.join(" ").trim();
}

/** A question about money, in any wording ("how much is it" — not "how much concrete", "how much bigger"). */
export const isPriceAsk = (text: string) =>
  /\b(?:price|pricing|cost|costs|costing|expensive|cheap(?:er)?|afford|budget|dollars?|quote|estimate|ballpark)\b|\bwhat(?:'s| is| will| would) (?:it|that|this) (?:run|come to)\b/i.test(text) ||
  /\bhow much\b(?!\s+(?:concrete|wood|lumber|boards?|decking|space|room|time|weight|load|snow|gravel|screws?|nails?|joists?|posts?|beams?|footings?|stairs?|steps?|rail(?:ing)?s?|area|bigger|higher|wider|deeper|taller|longer|lower|smaller|shade|sun|light|of (?:the|it|my|our)\b))/i.test(text);

/** The studio's own chips that are the contractor's ("How much concrete?", "Make the proposal") — not on a client's page. */
const CONTRACTOR_CHIP = /\b(?:concrete|joists?|beams?|posts?|footings?|ledger|permit|code|lumber|screws?|fram(?:e|ing)|frost|snow|load|proposal|save|installer|yard'?s? list|materials?|labor|what if|compare|auto-?fix)\b/i;
const CLIENT_CHIPS = ["Make it bigger", "Darker boards", "Add stairs", "Show it at night"];
/** The chips a client sees: the studio's, less the contractor's — at least a few, from the look of the deck. */
export function clientChips(chips: readonly string[]): string[] {
  const kept = chips.filter((c) => !CONTRACTOR_CHIP.test(c) && !isPriceAsk(c) && !/\d/.test(c));
  return kept.length >= 2 ? kept : [...kept, ...CLIENT_CHIPS.filter((c) => !kept.includes(c))].slice(0, 4);
}

/** A homeowner saying they like it — answered, nothing changed. */
export const isPraise = (text: string) =>
  /^(?:(?:oh |wow |yes |yeah |ok(?:ay)? )?(?:i (?:really )?(?:like|love) (?:it|that|this)|(?:that |it |this )?looks? (?:good|great|nice|amazing|awesome|beautiful|perfect|fine)|perfect|beautiful|nice|great|awesome|love it|i love the (?:color|colour|look)|that'?s (?:great|perfect|nice|it)))[.!\s]*$/i.test(text.trim());

/** The building side — answered by the contractor, not on the client's page. */
const CONTRACTOR_QUESTIONS = new Set<Question>(["concrete", "footings", "boards", "screws", "lumber", "joists", "beams", "posts", "ledger", "price", "perSqFt", "labor", "permit", "code", "checks", "frame", "frost", "snow", "load", "electrical", "time", "compare"]);
/** Changes and actions that are the contractor's: the structure under the deck, the paperwork, the shop's memory. */
const CONTRACTOR_DOES = new Set<DeckCommand["do"]>(["save", "teach", "item", "forget", "go", "name", "address", "footing", "ledger", "framing", "autofix", "house", "site", "open", "compare", "whatif"]);

/** "a fire pit", "an outdoor kitchen", "built-in benches" — said, never priced. */
function spokenThing(name: string): string {
  const t = name.trim().toLowerCase();
  // A plural takes no article ("built-in benches", "lights"); "trellis", "glass", "cactus" are one thing.
  if (/^(?:a|an|the|some|my|our)\s/.test(t) || /[^siu]s$/.test(t)) return t;
  return `${/^[aeiou]/.test(t) ? "an" : "a"} ${t}`;
}
const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export const CLIENT_SAYS = {
  price: "Your contractor puts the price together once you send your design. What would you like on it?",
  building: "That's your contractor's side — they work out how it's built. Want to change how it looks — the size, the boards, the railing, stairs, a roof?",
  praise: "Glad you like it. Anything you'd change — a railing, lights, or a roof?",
  /** What the studio can't draw, written into the client's note for the contractor. */
  wish: (things: string[]) => `I've added ${andList(things.map(spokenThing))} to your notes for your contractor. Anything else?`,
};

/** The line a wish adds to the client's note: "Fire pit", "A privacy screen on one side". */
export const noteLine = (thing: string) => {
  const t = thing.trim().replace(/[.!?]+$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
};

/**
 * What a client may not have run: the commands taken out, the words to answer instead (null — all of it may), and
 * what they want that the studio can't draw ("a fire pit", "a bench") — for their note to the contractor, unpriced.
 */
export function clientGate(cmds: readonly DeckCommand[], heard: string): { keep: DeckCommand[]; say: string | null; wishes: string[] } {
  if (isPriceAsk(heard) && !cmds.some((c) => c.do !== "ask" && c.do !== "compare" && c.do !== "whatif")) return { keep: [], say: CLIENT_SAYS.price, wishes: [] };
  const keep: DeckCommand[] = [];
  const wishes: string[] = [];
  let blocked: "price" | "building" | null = null;
  for (const c of cmds) {
    if (c.do === "wish" || (c.do === "item" && c.op === "add")) {
      const thing = c.do === "wish" ? (c.item ?? c.text) : c.name;
      if (thing && !wishes.some((w) => w.toLowerCase() === thing.toLowerCase())) wishes.push(thing);
      continue;
    }
    if (c.do === "ask" && CONTRACTOR_QUESTIONS.has(c.q)) {
      blocked = blocked ?? (c.q === "price" || c.q === "perSqFt" || c.q === "labor" || c.q === "compare" ? "price" : "building");
      continue;
    }
    if (CONTRACTOR_DOES.has(c.do)) {
      blocked = blocked ?? (c.do === "compare" || c.do === "whatif" ? "price" : "building");
      continue;
    }
    keep.push(c);
  }
  const say = keep.length ? null : wishes.length ? CLIENT_SAYS.wish(wishes) : blocked ? CLIENT_SAYS[blocked] : null;
  return { keep, say, wishes };
}

/** The quick next idea after a client's change — a question, no numbers, not the same one twice. */
export function clientOffer(before: DeckDesign, after: DeckDesign, ran: readonly DeckCommand[], offered: readonly string[]): { key: string; say: string; chips: string[] } | null {
  const did = new Set(ran.map((c) => c.do));
  // The other railings than the one just picked ("glass" → cable, black metal, wood).
  const rails = ([["glass", "Glass railing"], ["cable", "Cable railing"], ["aluminum", "Black aluminum railing"], ["composite", "Composite railing"], ["treated", "Wood railing"]] as const).filter(([id]) => id !== after.rail.type).map(([, l]) => l).slice(0, 3);
  const ideas: Array<{ key: string; when: boolean; say: string; chips: string[] }> = [
    { key: "rail-look", when: did.has("rail") && after.rail.type !== "none", say: "Want to see a different railing next to it?", chips: rails },
    { key: "rail", when: (did.has("size") || did.has("shape") || did.has("height")) && after.rail.type === "none" && after.heightIn > 24, say: "Want to see it with a railing?", chips: ["Add a railing", "Glass railing", "Cable railing"] },
    { key: "boards", when: did.has("decking"), say: "Want it darker, lighter, or with a border around the edge?", chips: ["Darker", "Lighter", "Picture-frame border"] },
    { key: "stair-lights", when: did.has("stairs") && after.stairs.length > 0, say: "Lights on the steps for the evening?", chips: ["Lights on the steps", "Wider stairs", "Handrails on both sides"] },
    { key: "stairs", when: (did.has("size") || did.has("shape") || did.has("height")) && !after.stairs.length && after.heightIn > 8, say: "Want steps down to the yard?", chips: ["Add stairs", "Stairs on the left", "Wrap-around steps"] },
    { key: "roof-extras", when: did.has("roof") || did.has("structure"), say: "Want a ceiling fan or lights under it?", chips: ["Add a ceiling fan", "Lights under the roof", "Make it a pergola"] },
    { key: "spa", when: did.has("spa"), say: "Want lights or a bench by the hot tub?", chips: ["Add lights", "Show it at night", "Make it bigger"] },
    { key: "shade", when: (did.has("size") || did.has("shape")) && after.structure === "deck", say: "Want some shade — a pergola or a covered roof?", chips: ["Add a pergola", "Covered roof", "Show it at night"] },
    { key: "night", when: did.has("fixture"), say: "Want to see it at night?", chips: ["Show it at night", "More lights", "Lights on the steps"] },
  ];
  void before;
  const hit = ideas.find((i) => i.when && !offered.includes(i.key));
  return hit ? { key: hit.key, say: hit.say, chips: hit.chips } : null;
}
