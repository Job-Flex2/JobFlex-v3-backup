// The YAML files under qa/config, typed. Read once per process.
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { CONFIG_DIR } from "./env";

export type Viewport = { width: number; height: number };
export type QaConfig = {
  devPorts: number[];
  productionHosts: string[];
  productionSuites: string[];
  devOnlyRoutes?: string[];
  thresholds: { pageLoadMs: number; compileGraceMs: number; slowRequestMs: number; hungRequestMs: number };
  viewports: { phone: Viewport; desk: Viewport };
  visual: { pixelThreshold: number; maxDiffRatio: number; hide: string[] };
  perf: { pages: { path: string; role: string }[]; minScores: Record<string, number>; axeImpacts: string[] };
  blockThirdParty: string[];
  ignoreConsole: string[];
  analysis: {
    budgetUsd: number;
    cheapModel: string;
    strongModel: string;
    pricing: Record<string, { input: number; output: number }>;
    staleAfterRuns: number;
    maxLocalize: number;
    maxVisualReviews: number;
  };
};

export type ForbiddenConfig = {
  controls: { selectors: string[]; labels: string[] };
  requests: { method?: string; path?: string; host?: string; url?: string; why: string }[];
  formsNoSubmit: string[];
};

export type KnownIssue = { id: string; signature?: string; message?: string; test?: string; route?: string; why?: string; confirmed?: string };

const cache = new Map<string, unknown>();
export function readYaml<T>(name: string): T {
  if (!cache.has(name)) cache.set(name, YAML.parse(fs.readFileSync(path.join(CONFIG_DIR, name), "utf8")));
  return cache.get(name) as T;
}

export const qaConfig = (): QaConfig => readYaml<QaConfig>("qa.config.yaml");

/** A page only `next dev` serves (devOnlyRoutes): on a production build it must answer 404. */
export function devOnlyHere(pattern: string): boolean {
  return process.env.QA_SERVER_KIND === "prod" && (qaConfig().devOnlyRoutes ?? []).some((r) => new RegExp(r).test(pattern));
}
export const forbiddenConfig = (): ForbiddenConfig => readYaml<ForbiddenConfig>("forbidden.yaml");
export const knownIssues = (): KnownIssue[] => readYaml<{ issues: KnownIssue[] | null }>("known-issues.yaml").issues ?? [];
