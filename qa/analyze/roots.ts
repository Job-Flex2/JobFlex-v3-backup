// ROOT CAUSES AND THE NAMES IN THEM, without a model.
//   rootOf()   — "NoOrgError @ resolveOrg": the error's name and the first function of its stack,
//                read from a server action's RSC answer, a console line or a page error. Signals
//                with the same root are one finding, wherever they were seen.
//   namesIn()  — function and component names in a stack or a message (resolveOrg, ReferralBanner,
//                payWithTestCard), in the order they appear.
//   declared() — where such a name is declared: src/ first, then qa/ (a test's own helper).
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../lib/env";

// Names that are the runtime's, React's or Next's, never the app's.
const NOT_OURS = new Set([
  "Object", "Array", "Module", "Promise", "Function", "Error", "async", "eval", "anonymous", "new", "process", "processTicksAndRejections", "runMicrotasks",
  "Generator", "next", "step", "fulfilled", "rejected", "Proxy", "Reflect", "JSON", "Map", "Set", "Suspense", "Fragment", "StrictMode", "LinkComponent",
  "Link", "Image", "Script", "Router", "AppRouter", "ErrorBoundary", "OuterLayoutRouter", "InnerLayoutRouter", "RenderFromTemplateContext", "ScrollAndFocusHandler",
  "RedirectBoundary", "NotFoundBoundary", "LoadingBoundary", "HTTPAccessFallbackBoundary", "HotReload", "ReactDevOverlay", "ServerRoot", "Root", "Head", "Html",
  "renderWithHooks", "beginWork", "performUnitOfWork", "commitRoot", "callCallback", "invokeGuardedCallback", "Object.eval", "AsyncFunction",
  "Html", "Body", "Main", "Div", "Span", "TestInfo", "TimeoutError", "Locator", "Page", "Frame",
]);

/** A server error as `next start` logs it — the browser only ever sees its digest. */
export type ServerError = { name: string; message: string };
export type Digests = Map<string, ServerError>;

/** next start's log ("⨯ Error [NoOrgError]: No active organization … digest: '575467423'") → digest → error. */
export function serverDigests(log: string): Digests {
  const out: Digests = new Map();
  for (const block of log.split(/^⨯ /m).slice(1)) {
    const head = block.match(/^(?:Error \[(\w+)\]|([A-Z]\w*Error)): ([^\n]*)/);
    const digest = block.split(/^⨯ /m)[0].match(/digest: '(\d+)'/);
    if (head && digest && !out.has(digest[1])) out.set(digest[1], { name: head[1] ?? head[2], message: head[3].trim() });
  }
  return out;
}

/** The server error behind a digest in these texts ({"digest":"…"}, "[route-error] 2983290536 …"), if the log has it. */
export function digestError(texts: (string | undefined | null)[], digests?: Digests): ServerError | null {
  if (!digests?.size) return null;
  const text = texts.filter(Boolean).join("\n");
  for (const m of text.matchAll(/digest\\?"?'?\s*[:=]\s*\\?["']?(\d{5,})|\[route-error\] (\d{5,})/g)) {
    const e = digests.get(m[1] ?? m[2]);
    if (e) return e;
  }
  return null;
}

/** "NoOrgError @ resolveOrg" — or null when the text names no error with a function under it. */
export function rootOf(texts: (string | undefined | null)[], digests?: Digests): string | null {
  const text = texts.filter(Boolean).join("\n");
  // a server action's RSC answer: {"name":"NoOrgError","message":"…","stack":[["resolveOrg","C:\\…"
  let m = text.match(/"name":"([A-Za-z]\w*)","message":"(?:[^"\\]|\\.)*"(?:,"stack":\[\["([\w$.]+)")?/);
  if (m && m[1] !== "Error") return `${m[1]} @ ${m[2] ?? throwSite(m[1]) ?? "?"}`;
  // a production build: only a digest reaches the browser; the server's log names the error, and
  // its stack is minified — the function is the one in src/ that throws it
  const fromLog = digestError(texts, digests);
  if (fromLog && fromLog.name !== "Error") return `${fromLog.name} @ ${throwSite(fromLog.name) ?? "?"}`;
  // a console / page error: "NoOrgError: No active organization\n    at resolveOrg (…"
  m = text.match(/\b([A-Z]\w*(?:Error|Exception))(?:\]|\b)[^\n]*(?:\n[^\n]*?){0,3}?\bat (?:async )?([\w$.]+) \(/);
  if (m && m[1] !== "Error" && !NOT_OURS.has(m[2])) return `${m[1]} @ ${m[2]}`;
  m = text.match(/\b([A-Z]\w*(?:Error|Exception)): [^\n]{0,160}? at (?:async )?([\w$.]+) \(/);
  if (m && m[1] !== "Error" && !NOT_OURS.has(m[2])) return `${m[1]} @ ${m[2]}`;
  return null;
}

/** Function and component names, in order: stack frames, RSC stacks, JSX tags in React's trees. */
export function namesIn(texts: (string | undefined | null)[]): string[] {
  const text = texts.filter(Boolean).join("\n");
  const out: string[] = [];
  const add = (n: string | undefined) => {
    if (!n) return;
    const name = n.split(".").pop()!;
    if (name.length < 3 || NOT_OURS.has(name) || NOT_OURS.has(n) || /^(use[A-Z]|__|_)/.test(name)) return;
    if (!out.includes(name)) out.push(name);
  };
  for (const m of text.matchAll(/\bat (?:async )?([\w$.]+) \(/g)) add(m[1]);
  for (const m of text.matchAll(/\[\["([\w$.]+)",/g)) add(m[1]);
  for (const m of text.matchAll(/The above error occurred in the <([A-Z]\w+)> component/g)) add(m[1]);
  for (const m of text.matchAll(/<([A-Z][A-Za-z0-9]+)[\s>]/g)) add(m[1]);
  return out;
}

/** For a hydration error: the component above the first +/- line of React's diff, if the diff is there. */
export function hydrationComponent(message: string): string | null {
  if (!/hydrat/i.test(message)) return null;
  const lines = message.split("\n");
  const firstDiff = lines.findIndex((l) => /^[+-] {2,}|^\s*[+-]\s+</.test(l));
  if (firstDiff < 0) return null;
  for (let i = firstDiff; i >= 0; i--) {
    const m = lines[i].match(/<([A-Z][A-Za-z0-9]+)[\s>]/);
    if (m && !NOT_OURS.has(m[1])) return m[1];
  }
  return null;
}

type Hit = { file: string; line: number };
const cache = new Map<string, Hit | null>();
let files: string[] | null = null;

function sourceFiles(): string[] {
  if (files) return files;
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 12 || !fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "runs") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, "src"), 0);
  const src = out.length;
  walk(path.join(ROOT, "qa", "lib"), 0);
  walk(path.join(ROOT, "qa", "tests"), 0);
  files = out;
  (files as unknown as { srcCount: number }).srcCount = src;
  return files;
}

/** Where `name` is declared (export function / function / const X = / class X), src/ first. */
export function declared(name: string): Hit | null {
  if (cache.has(name)) return cache.get(name)!;
  const re = new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function\\*?\\s+${name}\\b|(?:const|let|var)\\s+${name}\\s*[=:]|class\\s+${name}\\b)`);
  let hit: Hit | null = null;
  for (const f of sourceFiles()) {
    const lines = fs.readFileSync(f, "utf8").split("\n");
    const i = lines.findIndex((l) => re.test(l));
    if (i >= 0) { hit = { file: path.relative(ROOT, f).split(path.sep).join("/"), line: i + 1 }; break; }
  }
  cache.set(name, hit);
  return hit;
}

const thrown = new Map<string, string | null>();
/** The function in src/ around the first `throw new <ErrorName>(` — the error's usual origin. */
export function throwSite(errorName: string): string | null {
  if (thrown.has(errorName)) return thrown.get(errorName)!;
  const re = new RegExp(`\\bthrow new ${errorName}\\(`);
  const fnRe = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+(\w+)|^\s*(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/;
  let name: string | null = null;
  const srcCount = (sourceFiles() as unknown as { srcCount: number }).srcCount;
  for (const f of sourceFiles().slice(0, srcCount)) {
    const lines = fs.readFileSync(f, "utf8").split("\n");
    const i = lines.findIndex((l) => re.test(l));
    if (i < 0) continue;
    for (let j = i; j >= 0 && !name; j--) { const m = lines[j].match(fnRe); if (m) name = m[1] ?? m[2]; }
    break;
  }
  thrown.set(errorName, name);
  return name;
}

/** How densely a file reads browser-only values — the usual hydration-mismatch suspects. */
export function browserOnlyDensity(file: string): number {
  try {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const n = (text.match(/typeof window|localStorage|sessionStorage|document\.cookie|Date\.now\(\)|Math\.random\(\)|navigator\./g) ?? []).length;
    return n / Math.max(1, text.split("\n").length);
  } catch { return 0; }
}
