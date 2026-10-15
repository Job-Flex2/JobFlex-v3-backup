// Every page of the app, read from the file system (src/app/**/page.tsx): the roles matrix
// and the pages / visual suites are built from this list, so a new page is tested — and shows
// up as "unknown access" — the day it is added.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env";

export type AppRoute = {
  /** /dashboard/clients/[id] — the URL pattern, route groups removed */
  pattern: string;
  /** src/app/(dashboard)/dashboard/clients/[id]/page.tsx */
  file: string;
  /** the route groups it sits in: (dashboard), (portal)… */
  groups: string[];
  /** names of its dynamic segments */
  params: string[];
  /** a catch-all ([...x]) or optional catch-all ([[...x]]) segment */
  catchAll: boolean;
};

const APP = path.join(ROOT, "src", "app");

function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "api" && dir === APP) continue; // API routes are not pages
      if (e.name.startsWith("_") || e.name.startsWith("@")) continue; // private folders, parallel slots
      walk(p, out);
    } else if (/^page\.(tsx|ts|jsx|js|mdx)$/.test(e.name)) out.push(p);
  }
}

let cached: AppRoute[] | null = null;
export function appRoutes(): AppRoute[] {
  if (cached) return cached;
  const files: string[] = [];
  walk(APP, files);
  const byPattern = new Map<string, AppRoute>();
  for (const file of files) {
    const rel = path.relative(APP, path.dirname(file)).split(path.sep).filter(Boolean);
    const groups = rel.filter((s) => /^\(.*\)$/.test(s));
    const segs = rel.filter((s) => !/^\(.*\)$/.test(s));
    const params = segs.filter((s) => /^\[.*\]$/.test(s)).map((s) => s.replace(/^\[+(\.\.\.)?|\]+$/g, ""));
    const pattern = "/" + segs.join("/");
    const route: AppRoute = { pattern: pattern === "/" ? "/" : pattern, file: path.relative(ROOT, file).split(path.sep).join("/"), groups, params, catchAll: segs.some((s) => s.startsWith("[...") || s.startsWith("[[...")) };
    // Two files can serve one URL (src/app/dashboard/x and src/app/(dashboard)/dashboard/x);
    // Next refuses that at build time, so the first one found stands and the other is noted.
    if (!byPattern.has(route.pattern)) byPattern.set(route.pattern, route);
  }
  cached = [...byPattern.values()].sort((a, b) => a.pattern.localeCompare(b.pattern));
  return cached;
}

/** Areas of the app, for grouping in reports. */
export function areaOf(pattern: string): string {
  const first = pattern.split("/")[1] || "home";
  if (first.startsWith("mobile-")) return "mobile";
  return first;
}
