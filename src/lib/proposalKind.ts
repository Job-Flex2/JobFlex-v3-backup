// WHAT KIND OF PROPOSAL IS THIS (2026-10-17). Pure, client-safe.
//
// Owner: "since there is a lot of proposals, show which proposal belongs to —
// deck, roof, fence, or it's a remodel; if it uses Smart Proposal. Make it
// smart." Two facts per proposal, read from what is already stored (no schema
// change):
//   · the WORK — its family (deck · roof · fence · HVAC · remodel · other) and
//     its own word ("Kitchen remodel", "Gutters"): the estimator's `trade`
//     first, else the Smart Proposal's job type, the title, the scope and the
//     line names, through the same words the homeowner portal uses
//     (lib/tradeGuess);
//   · the TOOL that made it — the estimator, Smart Proposal, the video or
//     blueprint estimator, a template, a copy, or by hand — from the line the
//     proposal's activity trail wrote when it was made.
// The proposals list (desk and phone) prints both and filters by the family.

import { guessTrade } from "@/lib/tradeGuess";

export type WorkFamily = "deck" | "roof" | "fence" | "hvac" | "remodel" | "other";
export type ProposalTool = "deck" | "roof" | "fence" | "hvac" | "smart" | "video" | "blueprint" | "template" | "copy" | "manual";

/** The families in the order the filter lists them. */
export const WORK_FAMILIES: ReadonlyArray<{ key: WorkFamily; label: string }> = [
  { key: "deck", label: "Deck" },
  { key: "roof", label: "Roof" },
  { key: "fence", label: "Fence" },
  { key: "hvac", label: "HVAC" },
  { key: "remodel", label: "Remodel" },
  { key: "other", label: "Other" },
];

export const TOOL_WORDS: Record<ProposalTool, string> = {
  deck: "Deck Studio",
  roof: "Roof estimator",
  fence: "Fence estimator",
  hvac: "HVAC estimator",
  smart: "Smart Proposal",
  video: "Video estimator",
  blueprint: "Blueprint estimator",
  template: "Template",
  copy: "Copy",
  manual: "Manual",
};

export type ProposalKind = {
  family: WorkFamily;
  /** The work in its own word: "Deck", "Roof", "Kitchen remodel", "Gutters", "General". */
  work: string;
  tool: ProposalTool;
  /** "Smart Proposal", "Deck Studio", "Template", "Manual"… */
  toolWords: string;
  /** The template's name, or the title it was copied from. */
  via?: string;
};

/** A creation-ish line of the proposal's activity trail (kinds CREATED / ESTIMATE), oldest first. */
export type KindEvent = { summary: string; meta?: string | null };

export type KindInput = {
  /** Proposal.trade as stored — "deck", "roof", "fence", "hvac", or an older word like "roofing". */
  trade?: string | null;
  title: string;
  scope?: string | null;
  description?: string | null;
  events?: KindEvent[];
  lineNames?: string[];
};

/** "roofing" → "roof", "decking" → "deck"; null for anything that is not one of the four estimator trades. */
export function tradeFamily(trade: string | null | undefined): Exclude<WorkFamily, "remodel" | "other"> | null {
  const t = (trade ?? "").trim().toLowerCase();
  if (/^(deck|decks|decking)$/.test(t)) return "deck";
  if (/^(roof|roofs|roofing)$/.test(t)) return "roof";
  if (/^(fence|fences|fencing)$/.test(t)) return "fence";
  if (/^(hvac|heating|cooling)$/.test(t)) return "hvac";
  return null;
}

const TRADE_WORD: Record<"deck" | "roof" | "fence" | "hvac", string> = { deck: "Deck", roof: "Roof", fence: "Fence", hvac: "HVAC" };
const REMODEL = new Set(["Kitchen remodel", "Bathroom remodel", "Basement", "Remodel"]);
const REMODEL_WORDS = /\bremodel|\brenovat|\baddition\b|\badu\b/i;

/** A guessed trade word → its family and the word the list prints. */
function fromWord(word: string): { family: WorkFamily; work: string } {
  if (word === "Roofing") return { family: "roof", work: "Roof" };
  if (word === "Deck") return { family: "deck", work: "Deck" };
  if (word === "Fence") return { family: "fence", work: "Fence" };
  if (word === "HVAC") return { family: "hvac", work: "HVAC" };
  if (REMODEL.has(word)) return { family: "remodel", work: word };
  return { family: "other", work: word };
}

function metaSource(meta: string | null | undefined): string | null {
  if (!meta) return null;
  try {
    const m = JSON.parse(meta) as { source?: unknown };
    return typeof m.source === "string" ? m.source : null;
  } catch {
    return null;
  }
}

/** The tool that made it, from the trail's creation line; `projectType` is the AI estimate's own job words. */
export function toolOf(events: KindEvent[] | undefined, trade: string | null | undefined): { tool: ProposalTool; via?: string; projectType?: string } {
  for (const e of events ?? []) {
    const s = e.summary ?? "";
    const ai = /^Converted "(.*)" AI estimate to proposal/.exec(s);
    if (ai) {
      const src = metaSource(e.meta);
      const tool: ProposalTool = src === "video" ? "video" : src === "blueprint" ? "blueprint" : "smart";
      return { tool, projectType: ai[1] || undefined };
    }
    if (/^Converted HVAC estimate to proposal/i.test(s)) return { tool: "hvac" };
    if (/^Converted roof estimate to proposal/i.test(s)) return { tool: "roof" };
    if (/^Converted fence estimate to proposal/i.test(s)) return { tool: "fence" };
    if (/^Priced a deck\b/i.test(s)) return { tool: "deck" };
    const tpl = /^Created proposal ".*" from template "(.*)"$/.exec(s);
    if (tpl) return { tool: "template", via: tpl[1] };
    const dup = /^Duplicated "(.*)" as /.exec(s);
    if (dup) return { tool: "copy", via: dup[1] };
    if (/^Created proposal "/.test(s)) return { tool: "manual" };
  }
  // No creation line (an older proposal, a seeded one): an estimator's trade names its estimator.
  const fam = tradeFamily(trade);
  return { tool: fam ?? "manual" };
}

/** The work and the tool of one proposal. */
export function proposalKindOf(input: KindInput): ProposalKind {
  const { tool, via, projectType } = toolOf(input.events, input.trade);
  const fam = tradeFamily(input.trade);
  let work: { family: WorkFamily; work: string } | null = fam ? { family: fam, work: TRADE_WORD[fam] } : null;
  if (!work) {
    // The AI estimate's job words first (they ARE the job), then the title the office reads, then the scope and the lines.
    for (const text of [projectType, input.title, input.scope, input.description, (input.lineNames ?? []).join(" · ")]) {
      const word = guessTrade(text ?? "");
      if (word) {
        work = fromWord(word);
        // "Second-floor addition", "whole-house renovation with new tile": a remodel word outranks a material
        // the shared rules happened to meet first (they read "floor" before "addition").
        if (work.family === "other" && REMODEL_WORDS.test(text ?? "")) work = { family: "remodel", work: "Remodel" };
        break;
      }
    }
  }
  // A deck tool with no trade still made a deck (the estimators always set it; a copy of one keeps it).
  if (!work && (tool === "deck" || tool === "roof" || tool === "fence" || tool === "hvac")) work = { family: tool, work: TRADE_WORD[tool] };
  const w = work ?? { family: "other" as const, work: "General" };
  return { family: w.family, work: w.work, tool, toolWords: TOOL_WORDS[tool], ...(via ? { via } : {}) };
}

/** Counts per family for the filter, families with none left out, in the filter's order. */
export function familyCounts(kinds: Array<Pick<ProposalKind, "family">>): Array<{ key: WorkFamily; label: string; count: number }> {
  const n = new Map<WorkFamily, number>();
  for (const k of kinds) n.set(k.family, (n.get(k.family) ?? 0) + 1);
  return WORK_FAMILIES.filter((f) => (n.get(f.key) ?? 0) > 0).map((f) => ({ ...f, count: n.get(f.key) ?? 0 }));
}

/** The one word the list's tag prints (owner, 2026-10-20: "Roof", not "Roof · Manual"). "General" only means no
 *  trade could be read from the proposal, so it says how the proposal was made instead — "Manual", "Template". */
export function kindWord(k: ProposalKind): string {
  return k.family === "other" && k.work === "General" ? k.toolWords : k.work;
}

/** "Kitchen remodel · Smart Proposal", "Deck · Deck Studio", "Gutters · Template". */
export function kindLine(k: ProposalKind): string {
  return `${k.work} · ${k.toolWords}`;
}
