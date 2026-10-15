// Where in src/ a finding comes from. First by rule — a src/ path in the stack, the page file of
// the route, the route file of the API, a component named in the stack — then, for P0–P2 and
// while the budget lasts, the strong model reads the candidates' code and names file and line.
// Nothing found → null, and the report says "не найдено".
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../lib/env";
import { appRoutes } from "../lib/routes";
import { pathOf } from "./signals";
import type { Llm } from "./llm";
import type { Finding, Location, Signal } from "./types";

const exists = (rel: string) => { try { return fs.statSync(path.join(ROOT, rel)).isFile(); } catch { return false; } };

function fromStack(text: string | undefined): Location[] {
  if (!text) return [];
  const out: Location[] = [];
  const re = /(src\/[\w\-./()[\]@]+?\.(?:tsx|ts|jsx|js))(?::(\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (exists(m[1]) && !out.some((o) => o.file === m![1])) out.push({ file: m[1], line: m[2] ? Number(m[2]) : null, why: "named in the error's stack", confidence: m[2] ? "high" : "medium", source: "stack" });
  }
  return out;
}

function apiRouteFile(urlPath: string): string | null {
  const segs = urlPath.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const walk = (dir: string, i: number): string | null => {
    if (i === segs.length) { const f = path.join(dir, "route.ts"); return fs.existsSync(f) ? f : null; }
    if (!fs.existsSync(dir)) return null;
    const exact = path.join(dir, segs[i]);
    if (fs.existsSync(exact)) { const r = walk(exact, i + 1); if (r) return r; }
    for (const d of fs.readdirSync(dir)) if (/^\[.*\]$/.test(d)) { const r = walk(path.join(dir, d), i + 1); if (r) return r; }
    return null;
  };
  const f = walk(path.join(ROOT, "src", "app", "api"), 0);
  return f ? path.relative(ROOT, f).split(path.sep).join("/") : null;
}

function pageFile(route: string): string | null {
  return appRoutes().find((r) => r.pattern === route)?.file ?? null;
}

/** React component names in a stack ("at ManualBlueprintContent (…)") → their source file. */
function components(stack: string | undefined): Location[] {
  if (!stack) return [];
  const names = [...new Set([...stack.matchAll(/at ([A-Z][A-Za-z0-9]{3,}) \(/g)].map((m) => m[1]))].slice(0, 3);
  const out: Location[] = [];
  for (const name of names) {
    const hit = grep(new RegExp(`(function|const|class) ${name}\\b`), path.join(ROOT, "src"));
    if (hit) out.push({ file: hit.file, line: hit.line, why: `defines the component ${name} named in the stack`, confidence: "medium", source: "component" });
  }
  return out;
}

function grep(re: RegExp, dir: string, depth = 0): { file: string; line: number } | null {
  if (depth > 8) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === "node_modules" || e.name.startsWith(".")) continue; const r = grep(re, p, depth + 1); if (r) return r; continue; }
    if (!/\.(tsx?|jsx?)$/.test(e.name)) continue;
    const lines = fs.readFileSync(p, "utf8").split("\n");
    const i = lines.findIndex((l) => re.test(l));
    if (i >= 0) return { file: path.relative(ROOT, p).split(path.sep).join("/"), line: i + 1 };
  }
  return null;
}

export function candidates(f: Finding, signals: Signal[]): Location[] {
  const out: Location[] = [];
  const add = (l: Location | null) => { if (l && !out.some((o) => o.file === l.file)) out.push(l); };
  for (const s of signals.slice(0, 6)) {
    fromStack(s.stack).forEach(add);
    fromStack(s.message).forEach(add);
    components(s.stack).forEach(add);
  }
  if (f.kind === "api-error" || f.kind === "network") {
    const url = signals.find((s) => s.url)?.url;
    const p = url ? pathOf(url) : "";
    if (p.startsWith("/api/")) { const file = apiRouteFile(p); if (file) add({ file, line: null, why: `the route handler of ${p}`, confidence: "medium", source: "route" }); }
  }
  for (const r of f.evidence.routes.slice(0, 2)) { const file = pageFile(r); if (file) add({ file, line: null, why: `the page file of ${r}`, confidence: f.kind === "layout" || f.kind === "access" ? "medium" : "low", source: "route" }); }
  if (f.kind === "legacy") { const file = signals[0]?.file; if (file && exists(file)) add({ file, line: null, why: "the failing check itself — its output names what it expected", confidence: "medium", source: "route" }); }
  return out;
}

function excerpt(loc: Location): string {
  try {
    const lines = fs.readFileSync(path.join(ROOT, loc.file), "utf8").split("\n");
    const from = loc.line ? Math.max(0, loc.line - 40) : 0;
    const to = loc.line ? Math.min(lines.length, loc.line + 40) : Math.min(lines.length, 140);
    return lines.slice(from, to).map((l, i) => `${from + i + 1}: ${l}`).join("\n");
  } catch { return ""; }
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["found", "file", "line", "why", "confidence"],
  properties: { found: { type: "boolean" }, file: { type: "string" }, line: { type: ["integer", "null"] }, why: { type: "string" }, confidence: { type: "string", enum: ["high", "medium", "low"] } },
};
const SYSTEM = `You locate the source of a defect in a Next.js 16 / React 19 / Prisma app (repo paths start with src/).
You get one finding from automated tests (the error, stack, test names, pages) and excerpts of candidate files with line numbers.
Answer with the file and line most likely responsible, and why (Russian, one or two sentences). Use only files shown to you.
If the excerpts do not show the cause, answer found=false with file "" — do not guess.`;

export async function localize(llm: Llm, f: Finding, signals: Signal[]): Promise<{ location: Location | null; note?: string; byModel: boolean }> {
  const cands = candidates(f, signals);
  if (!cands.length) return { location: null, note: "не найдено: ни стек, ни маршрут, ни компонент не указывают на файл в src/", byModel: false };
  if (!llm.available || f.severity === "P3") return { location: cands[0], byModel: false };
  const text = JSON.stringify({
    finding: { title: f.title, kind: f.kind, message: f.evidence.message, stack: f.evidence.stack?.slice(0, 3000), tests: f.evidence.tests.slice(0, 5).map((t) => t.title), routes: f.evidence.routes.slice(0, 5), alsoSeen: f.evidence.alsoSeen },
    candidates: cands.slice(0, 4).map((c) => ({ file: c.file, line: c.line, why: c.why, code: excerpt(c) })),
  });
  const r = await llm.json<{ found: boolean; file: string; line: number | null; why: string; confidence: "high" | "medium" | "low" }>({ model: "strong", system: SYSTEM, text, schema: SCHEMA, maxTokens: 6000, effort: "medium" });
  if (!r) return { location: cands[0], byModel: false };
  if (!r.found || !exists(r.file)) return { location: cands[0], note: "модель не нашла причину в коде кандидатов; показан ближайший файл по правилу", byModel: true };
  return { location: { file: r.file, line: r.line, why: r.why, confidence: r.confidence, source: "model" }, byModel: true };
}

/** The fix prompt for Claude Code under every P0–P2 finding. */
export function fixPrompt(f: Finding): string {
  const loc = f.location ? `${f.location.file}${f.location.line ? ":" + f.location.line : ""} (${f.location.why})` : "не найдено — начни с маршрута и стека ниже";
  return [
    `Почини дефект, найденный QA Lab (находка ${f.id}, ${f.severity}): ${f.title}`,
    "",
    `Что происходит: ${f.human.what}`,
    `Кому мешает: ${f.human.whoIsAffected}`,
    `Вероятное место: ${loc}`,
    f.evidence.routes.length ? `Страницы: ${f.evidence.routes.slice(0, 6).join(", ")}` : "",
    "",
    "Исходная ошибка:",
    "```",
    f.evidence.message.slice(0, 1500),
    f.evidence.stack ? "\n" + f.evidence.stack.split("\n").slice(0, 12).join("\n") : "",
    "```",
    `Тесты: ${f.evidence.tests.slice(0, 6).map((t) => t.title.replace(/@\w+/g, "").trim()).join("; ")}`,
    "",
    "Как воспроизвести:",
    ...f.human.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "Сначала найди причину (не симптом), затем исправь и проверь тем же тестом:",
    `npm run qa -- --suite ${(f.evidence.tests[0]?.title.match(/@(smoke|signup|billing|roles|pages|forms|visual|perf|logic)\b/) ?? [])[1] ?? "smoke"} --grep "${(f.evidence.tests[0]?.title ?? "").replace(/@\w+/g, "").trim().slice(0, 50)}"`,
    "Правила проекта — CLAUDE.md и DESIGN.md; не коммить без просьбы.",
  ].filter((l) => l !== "").join("\n");
}
