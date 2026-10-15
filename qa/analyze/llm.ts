// The model calls of the analysis, with their cost counted and a budget that stops them.
// Cheap model (qa.config.yaml analysis.cheapModel): grouping and the words for people.
// Strong model (analysis.strongModel): finding the code, and visual pairs the cheap one is unsure of.
// No ANTHROPIC_API_KEY (or --offline): every call answers null and the analysis uses its rules.
// Prompts carry only redacted text (lib/redact) — never a password, token, cookie or code.
import Anthropic from "@anthropic-ai/sdk";
import { qaConfig } from "../lib/config";
import { redact } from "../lib/redact";
import type { Cost } from "./types";

type Block = Anthropic.Beta.BetaContentBlockParam;

export class Llm {
  readonly cost: Cost;
  private client: Anthropic | null;
  private warned = false;

  constructor(opts: { offline?: boolean; budgetUsd?: number } = {}) {
    const cfg = qaConfig().analysis;
    const key = process.env.ANTHROPIC_API_KEY;
    this.client = !opts.offline && key ? new Anthropic({ apiKey: key, maxRetries: 2, timeout: 240_000 }) : null;
    this.cost = { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, byModel: {}, budgetUsd: opts.budgetUsd ?? cfg.budgetUsd, stoppedForBudget: false, mode: this.client ? "model" : "offline" };
  }

  get available(): boolean {
    return !!this.client && !this.cost.stoppedForBudget;
  }

  private price(model: string) {
    return qaConfig().analysis.pricing[model] ?? { input: 5, output: 25 };
  }

  /** A rough upper bound of what the call will cost, to refuse it before the budget is passed. */
  private estimate(model: string, chars: number, images: number, maxTokens: number): number {
    const p = this.price(model);
    const inTok = chars / 3.5 + images * 1600;
    return (inTok * p.input + Math.min(maxTokens, 4000) * p.output) / 1e6;
  }

  /**
   * One structured answer (JSON matching `schema`), or null — no key, over budget, refused or
   * unreadable. `images` are PNG files as base64.
   */
  async json<T>(o: { model: "cheap" | "strong"; system: string; text: string; schema: Record<string, unknown>; images?: { label: string; base64: string }[]; maxTokens?: number; effort?: "low" | "medium" | "high" }): Promise<T | null> {
    if (!this.client) return null;
    const cfg = qaConfig().analysis;
    const model = o.model === "cheap" ? cfg.cheapModel : cfg.strongModel;
    const maxTokens = o.maxTokens ?? 8000;
    const text = redact(o.text);
    const est = this.estimate(model, text.length + o.system.length, o.images?.length ?? 0, maxTokens);
    if (this.cost.usd + est > this.cost.budgetUsd) {
      this.cost.stoppedForBudget = true;
      if (!this.warned) console.warn(`analysis: budget $${this.cost.budgetUsd.toFixed(2)} reached — the rest is written without the model`);
      this.warned = true;
      return null;
    }
    const content: Block[] = [];
    for (const img of o.images ?? []) {
      content.push({ type: "text", text: img.label });
      content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: img.base64 } });
    }
    content.push({ type: "text", text });
    try {
      const res = await this.client.beta.messages.create({
        model,
        max_tokens: maxTokens,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: o.system,
        output_config: { effort: o.effort ?? (o.model === "cheap" ? "low" : "medium"), format: { type: "json_schema", schema: o.schema } },
        messages: [{ role: "user", content }],
      });
      const u = res.usage;
      const p = this.price(res.model || model);
      const usd = ((u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1) * p.input + u.output_tokens * p.output) / 1e6;
      this.cost.calls++;
      this.cost.inputTokens += u.input_tokens;
      this.cost.outputTokens += u.output_tokens;
      this.cost.usd += usd;
      const m = (this.cost.byModel[model] ??= { calls: 0, usd: 0 });
      m.calls++;
      m.usd += usd;
      if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return null;
      const out = res.content.find((b) => b.type === "text");
      return out && out.type === "text" ? (JSON.parse(out.text) as T) : null;
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) {
        console.warn("analysis: ANTHROPIC_API_KEY was refused — continuing without the model");
        this.client = null;
        this.cost.mode = "offline";
      } else if (e instanceof Anthropic.APIError) {
        console.warn(`analysis: model call failed (${e.status ?? "?"}) — that part is written by the rules`);
      } else {
        console.warn(`analysis: model answer unreadable — that part is written by the rules`);
      }
      return null;
    }
  }
}
