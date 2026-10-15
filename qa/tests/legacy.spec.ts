// THE OLD QA SCRIPTS (qa/config/legacy.yaml) as tests of the QA Lab: one test per live script,
// tagged with its suite and @legacy, run one after another (they share QA Co and some throwaway
// rows — never in parallel). Each one's output is kept with the run (outputs/), redacted.
import { test, expect } from "../lib/fixtures";
import { baseUrl } from "../lib/env";
import { redact } from "../lib/redact";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const legacy = require("./_lib/legacy-run.js") as {
  runnable: () => { file: string; suite: string; kind: string; minutes: number; note?: string; seed?: string; path: string }[];
  runEntry: (e: unknown, o: { baseUrl: string }) => Promise<{ verdict: string; code: number; out: string; ms: number; detail: string; failures: string[] }>;
  guard: () => Promise<string | null>;
};

let refused: string | null | undefined;

for (const e of legacy.runnable()) {
  // page passes and production-build checks sign in and write in QA Co: never against production
  const writes = e.kind === "page" || e.kind === "prod" ? " @writes" : "";
  test(`legacy ${e.suite}/${e.file} @${e.suite} @legacy${writes}`, async ({}, info) => {
    test.setTimeout((e.minutes + 3) * 60_000);
    if (refused === undefined) refused = await legacy.guard();
    test.skip(!!refused, `QA guard refused: ${redact(refused ?? "")}`);
    if (e.note) info.annotations.push({ type: "note", description: e.note });
    const r = await legacy.runEntry(e, { baseUrl: baseUrl() });
    await info.attach("qa-output", { body: redact(r.out), contentType: "text/plain" });
    info.annotations.push({ type: "legacy", description: `${e.kind} · exit ${r.code} · ${Math.round(r.ms / 1000)} s · ${redact(r.detail)}` });
    test.skip(r.verdict === "STALE", `STALE: ${redact(r.detail)}`);
    const tail = r.out.trim().split(/\r?\n/).slice(-12).join("\n");
    expect(r.verdict, redact(`${e.suite}/${e.file} failed (exit ${r.code})\n${r.failures.length ? r.failures.join("\n") : tail}`)).toBe("PASS");
  });
}
