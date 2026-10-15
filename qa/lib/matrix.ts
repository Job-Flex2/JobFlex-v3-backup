// ROLE × PAGE. What each role gets when it opens each page, as the server answers it:
//   open · login (sent to a sign-in page) · forbidden (403) · not-found (404)
//   redirect:<path> (sent somewhere else) · error:<status>
// compared with qa/config/access-matrix.yaml. `npm run qa -- --suite roles --update-matrix`
// writes what was observed back into the file (keeping its notes) and marks doubtful cells.
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { request, type APIRequestContext } from "@playwright/test";
import { CONFIG_DIR, baseUrl, runDir } from "./env";
import { ROLES, authFile, type RoleName } from "./roles";
import type { AppRoute } from "./routes";

export type Cell = string; // open | login | forbidden | not-found | redirect:/x | error:500
export type MatrixRow = Partial<Record<RoleName, Cell>> & { review?: RoleName[]; why?: string };
export type MatrixFile = { version: number; generated?: string; roles: RoleName[]; routes: Record<string, MatrixRow> };

export const MATRIX_FILE = path.join(CONFIG_DIR, "access-matrix.yaml");

export function readMatrix(): MatrixFile {
  if (!fs.existsSync(MATRIX_FILE)) return { version: 1, roles: [...ROLES], routes: {} };
  const m = YAML.parse(fs.readFileSync(MATRIX_FILE, "utf8")) as MatrixFile;
  m.routes ??= {};
  return m;
}

const contexts = new Map<RoleName, APIRequestContext>();
const octet = () => 1 + Math.floor(Math.random() * 250);
export async function roleRequest(role: RoleName): Promise<APIRequestContext> {
  let c = contexts.get(role);
  if (!c) {
    const signed = role !== "guest" && role !== "homeowner";
    c = await request.newContext({
      baseURL: baseUrl(),
      storageState: signed && fs.existsSync(authFile(role)) ? authFile(role) : undefined,
      extraHTTPHeaders: { "x-forwarded-for": `10.${octet()}.${octet()}.${octet()}` },
      ignoreHTTPSErrors: true,
    });
    contexts.set(role, c);
  }
  return c;
}
export async function disposeRequests(): Promise<void> {
  for (const c of contexts.values()) await c.dispose().catch(() => {});
  contexts.clear();
}

/** Ids and tokens in a redirect target are not part of the rule. */
export function normalisePath(p: string): string {
  return p
    .replace(/[?#].*$/, "")
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id")
    .replace(/\/c[a-z0-9]{20,}/g, "/:id")
    .replace(/\/qa-missing-0000/g, "/:id")
    .replace(/\/$/, "") || "/";
}

const LOGIN = /^\/(auth\/login|admin\/login|influencer\/login|mobile-v1\/auth\/login)(\/|$)/;

/** One page, as one role gets it from the server (no redirects followed). */
export async function probe(role: RoleName, urlPath: string): Promise<{ cell: Cell; status: number; location?: string; ms: number }> {
  const ctx = await roleRequest(role);
  const t0 = Date.now();
  const r = await ctx.get(urlPath, { maxRedirects: 0, timeout: 150_000, failOnStatusCode: false });
  const ms = Date.now() - t0;
  const status = r.status();
  const loc = r.headers()["location"];
  if (status >= 300 && status < 400 && loc) {
    const to = new URL(loc, baseUrl());
    const p = to.pathname;
    return { cell: LOGIN.test(p) ? "login" : `redirect:${normalisePath(p)}`, status, location: p, ms };
  }
  if (status === 200) {
    // A redirect or a not-found thrown after the page started streaming still answers 200.
    const body = await r.text().catch(() => "");
    const meta = body.match(/<meta id="__next-page-redirect"[^>]*content="\d+;url=([^"]+)"/);
    if (meta) {
      const p = new URL(meta[1].replace(/&amp;/g, "&"), baseUrl()).pathname;
      return { cell: LOGIN.test(p) ? "login" : `redirect:${normalisePath(p)}`, status, location: p, ms };
    }
    if (/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/.test(body)) return { cell: "not-found", status, ms };
    if (/NEXT_HTTP_ERROR_FALLBACK;403/.test(body)) return { cell: "forbidden", status, ms };
    if (/NEXT_HTTP_ERROR_FALLBACK;401/.test(body)) return { cell: "login", status, ms };
    return { cell: "open", status, ms };
  }
  if (status === 401) return { cell: "login", status, ms };
  if (status === 403) return { cell: "forbidden", status, ms };
  if (status === 404) return { cell: "not-found", status, ms };
  return { cell: `error:${status}`, status, ms };
}

/** "open|redirect:/x" — any of these. */
export function matches(expected: Cell | undefined, actual: Cell): boolean {
  if (!expected) return false;
  return expected.split("|").map((s) => s.trim()).some((e) => e === actual || (e.endsWith("*") && actual.startsWith(e.slice(0, -1))));
}

const PROTECTED = /^\/(dashboard|admin|influencer\/(dashboard|earnings|payouts)|v3|mobile-|trade-services)/;
const OWNER_ONLY = /^\/dashboard\/(settings\/billing|company\/subscription|subscription|upgrade|trial|settings\/payment|settings\/integrations|company\/team|settings\/team)/;
const WORKER_OK = /^\/dashboard(\/(jobs|calendar|messages))?(\/|$)/;

/** Cells a person should look at before the first matrix is trusted. */
export function doubtful(pattern: string, cells: Partial<Record<RoleName, Cell>>): { roles: RoleName[]; why: string[] } {
  const roles = new Set<RoleName>();
  const why: string[] = [];
  const say = (r: RoleName, w: string) => { roles.add(r); why.push(`${r}: ${w}`); };
  for (const r of ROLES) {
    const c = cells[r];
    if (!c) continue;
    if (c.startsWith("error:")) say(r, `the server fails (${c})`);
    if ((r === "guest" || r === "homeowner") && c === "open" && PROTECTED.test(pattern)) say(r, "opens a signed-in area without a session");
    if (r !== "admin" && c === "open" && /^\/admin(\/|$)/.test(pattern) && pattern !== "/admin/login") say(r, "opens the platform admin");
    if (r === "worker" && c === "open" && pattern.startsWith("/dashboard") && !WORKER_OK.test(pattern)) say(r, "an installer opens a page outside jobs / calendar / messages");
    if ((r === "manager" || r === "worker") && c === "open" && OWNER_ONLY.test(pattern)) say(r, "billing / team page open to a non-owner");
    if (r === "admin" && c === "open" && pattern.startsWith("/dashboard")) say(r, "a platform admin with no company opens the dashboard");
    if (r === "owner" && c === "not-found" && !pattern.includes("[")) say(r, "a static page answers 404 to its owner");
  }
  if (cells.guest && cells.homeowner && cells.guest !== cells.homeowner && !pattern.includes("[")) say("homeowner", `differs from a guest (${cells.homeowner} vs ${cells.guest}) on a page with no link token`);
  return { roles: [...roles], why };
}

/** Each test writes what it saw; the CLI folds them into the YAML afterwards (--update-matrix). */
export function saveObserved(route: AppRoute, cells: Partial<Record<RoleName, Cell>>): void {
  const dir = path.join(runDir(), "matrix-observed");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, route.pattern.replace(/[^a-z0-9]+/gi, "_") + ".json"), JSON.stringify({ pattern: route.pattern, cells }));
}

export function writeMatrixFromObserved(dir: string): number {
  const prev = readMatrix();
  const obsDir = path.join(dir, "matrix-observed");
  if (!fs.existsSync(obsDir)) return 0;
  const routes: Record<string, MatrixRow> = {};
  for (const f of fs.readdirSync(obsDir)) {
    const { pattern, cells } = JSON.parse(fs.readFileSync(path.join(obsDir, f), "utf8")) as { pattern: string; cells: Partial<Record<RoleName, Cell>> };
    const old = prev.routes[pattern];
    const d = doubtful(pattern, cells);
    const row: MatrixRow = {};
    for (const r of ROLES) if (cells[r]) row[r] = cells[r];
    // A person's decision stands: an existing `why` is kept, `review` is recomputed.
    if (d.roles.length) row.review = d.roles;
    if (old?.why && !old.why.startsWith("auto:")) row.why = old.why;
    else if (d.why.length) row.why = "auto: " + d.why.join("; ");
    routes[pattern] = row;
  }
  for (const [p, row] of Object.entries(prev.routes)) if (!routes[p]) routes[p] = row; // a page not probed this time keeps its row
  const sorted = Object.fromEntries(Object.entries(routes).sort(([a], [b]) => a.localeCompare(b)));
  const header = [
    "# ROLE × PAGE — what each role is expected to get on each page (qa/lib/matrix.ts).",
    "#   open · login · forbidden · not-found · redirect:<path> · error:<status>; alternatives with |",
    "# Generated from the app's behaviour by `npm run qa -- --suite roles --update-matrix`.",
    "# `review` lists the cells that need a person's decision; write the decision in `why`",
    "# (a `why` not starting with \"auto:\" is kept on the next update) and remove `review`.",
    "",
  ].join("\n");
  const out: MatrixFile = { version: 1, generated: new Date().toISOString().slice(0, 10), roles: [...ROLES], routes: sorted };
  fs.writeFileSync(MATRIX_FILE, header + YAML.stringify(out, { lineWidth: 0 }));
  return Object.keys(routes).length;
}
