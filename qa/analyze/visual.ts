// The visual differences: the model looks at before / after / diff and says bug, intended change
// or noise. The cheap model first; when it is unsure, the strong one. Without a model the rule
// says: under 1 % of the pixels and no size change is likely noise, anything else needs a look.
import fs from "node:fs";
import path from "node:path";
import type { RawRun } from "../lib/raw";
import { qaConfig } from "../lib/config";
import { shrinkPng } from "./images";
import type { Llm } from "./llm";
import type { VisualVerdict } from "./types";

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["verdict", "why", "sure"],
  properties: { verdict: { type: "string", enum: ["bug", "intended", "noise"] }, why: { type: "string" }, sure: { type: "boolean" } },
};
const SYSTEM = `You review a visual regression of one page of JobFlex (a SaaS for contractors; mobile-first, "Blueprint" design: ink frames, paper background, mono annotations).
You get BEFORE (the baseline), AFTER (this run) and DIFF (changed pixels in red).
Decide: "bug" — something is broken or worse (cut off, overlapping, missing, misaligned, unstyled, an error state);
"intended" — a deliberate change of content or design that looks right; "noise" — data that changes by itself (dates, counts, names, a random order), anti-aliasing, a loading moment.
Answer in Russian in "why" (one or two sentences, name what changed and where). sure=false when you cannot tell.`;

export async function reviewVisual(llm: Llm, raw: RawRun, runDir: string): Promise<VisualVerdict[]> {
  const max = qaConfig().analysis.maxVisualReviews;
  const failing = raw.tests.filter((t) => t.meta?.kind === "visual" && t.outcome === "failed" && t.artifacts.visual?.diff);
  const out: VisualVerdict[] = [];
  let reviewed = 0;
  for (const t of failing) {
    const v = t.artifacts.visual!;
    const id = String(t.meta.visualId);
    const ratio = Number(v.ratio ?? 0);
    const base: VisualVerdict = {
      id, testTitle: t.title, route: String(t.meta.route), viewport: String(t.meta.viewport), role: String(t.meta.role), ratio,
      verdict: "unreviewed", why: "", reviewedBy: "rule", before: v.baseline, after: v.actual, diff: v.diff, accept: `npm run qa:accept -- ${id}`,
    };
    const rule = (): VisualVerdict => ({ ...base, verdict: ratio < 0.01 && !String(t.meta.note ?? "").startsWith("size") ? "noise" : "unreviewed", why: ratio < 0.01 ? `изменилось ${(ratio * 100).toFixed(2)}% пикселей, размер тот же — похоже на шум (правило, без модели)` : `изменилось ${(ratio * 100).toFixed(1)}% пикселей${t.meta.note ? `, ${t.meta.note}` : ""} — нужен взгляд человека`, reviewedBy: "rule" });
    if (!llm.available || reviewed >= max) { out.push(rule()); continue; }
    const img = (rel?: string) => (rel && fs.existsSync(path.join(runDir, rel)) ? shrinkPng(fs.readFileSync(path.join(runDir, rel)), 640, 2400).toString("base64") : null);
    const before = img(v.baseline), after = img(v.actual), diff = img(v.diff);
    if (!before || !after || !diff) { out.push(rule()); continue; }
    reviewed++;
    const images = [{ label: "BEFORE (baseline):", base64: before }, { label: "AFTER (this run):", base64: after }, { label: "DIFF (red = changed):", base64: diff }];
    const text = `Page ${base.route} at ${base.viewport}px as ${base.role}; ${(ratio * 100).toFixed(2)}% of pixels changed${t.meta.note ? `; ${t.meta.note}` : ""}.`;
    let r = await llm.json<{ verdict: "bug" | "intended" | "noise"; why: string; sure: boolean }>({ model: "cheap", system: SYSTEM, text, schema: SCHEMA, images, maxTokens: 3000 });
    let by = "cheap model";
    if (r && !r.sure) {
      const strong = await llm.json<{ verdict: "bug" | "intended" | "noise"; why: string; sure: boolean }>({ model: "strong", system: SYSTEM, text, schema: SCHEMA, images, maxTokens: 4000, effort: "medium" });
      if (strong) { r = strong; by = "strong model (the cheap one was unsure)"; }
    }
    out.push(r ? { ...base, verdict: r.verdict, why: r.why, reviewedBy: by } : rule());
  }
  return out;
}
