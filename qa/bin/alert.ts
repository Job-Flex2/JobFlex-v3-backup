// npm run qa:alert [-- --run <folder>]
// After a CI run: if it ran against PRODUCTION (a host in qa.config.yaml productionHosts) and went
// red, tell the team — POST /api/qa/alert on that production host, with x-qa-secret, which texts the
// "QA failures" subscribers of /admin/tasks → Team (lib/adminAlerts, key "qa"). Any other target, or a
// green run: nothing is sent. The secret is QA_ALERT_SECRET, else QA_SECRET — it must equal the
// production deployment's QA_SECRET (docs/qa-ci.md). Never fails the job by itself: a lost alert is
// printed, the job's own red is what blocks.
import fs from "node:fs";
import path from "node:path";
import { RUNS_DIR, latestRunDir } from "../lib/env";
import { qaConfig } from "../lib/config";
import type { RawRun } from "../lib/raw";

const argv = process.argv.slice(2);
const val = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };

async function main(): Promise<void> {
  const named = val("run");
  const dir = named ? path.resolve(RUNS_DIR, named) : process.env.QA_RUN_DIR && fs.existsSync(path.join(process.env.QA_RUN_DIR, "raw.json")) ? process.env.QA_RUN_DIR : latestRunDir();
  const raw = dir && fs.existsSync(path.join(dir, "raw.json")) ? (JSON.parse(fs.readFileSync(path.join(dir, "raw.json"), "utf8")) as RawRun) : null;
  const base = (raw?.run.baseUrl || process.env.QA_BASE_URL || "").replace(/\/+$/, "");
  if (!base) return console.log("qa:alert — no run and no QA_BASE_URL: nothing to say.");
  // production = a host listed in qa.config.yaml productionHosts — not lib/target's "any unknown remote
  // host", which is right for refusing writes and wrong for paging people
  const host = new URL(base).hostname.toLowerCase();
  if (!qaConfig().productionHosts.some((p) => host === p || host.endsWith("." + p))) return console.log(`qa:alert — ${new URL(base).host} is not a production host: no alert.`);

  let text = "";
  if (!raw) text = `a run against ${new URL(base).host} stopped before its tests.`;
  else {
    const failed = raw.tests.filter((t) => t.outcome === "failed");
    const untrusted = raw.run.health?.status === "FAILED";
    const names = [...new Set(failed.map((t) => t.title.replace(/\s*@[\w-]+/g, "").trim()))];
    if (!raw.tests.length) text = `a run against ${new URL(base).host} stopped before its tests.`;
    else if (!failed.length && !untrusted) return console.log("qa:alert — the production run is green: no alert.");
    else text = failed.length
      ? `${failed.length} failed on ${new URL(base).host} (${raw.run.suites.join(",")}): ${names.slice(0, 4).join("; ")}${names.length > 4 ? ` +${names.length - 4} more` : ""}.`
      : `the run on ${new URL(base).host} cannot be trusted: ${raw.run.health!.problems[0] ?? "too many skips"}.`;
  }
  const ci = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : "";
  if (ci) text += ` ${ci}`;

  const secret = process.env.QA_ALERT_SECRET || process.env.QA_SECRET;
  if (!secret) return console.log(`qa:alert — red production run, but no QA_ALERT_SECRET / QA_SECRET to send it with. Text was: ${text}`);
  const run = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}` : raw?.run.id ?? "";
  const r = await fetch(`${base}/api/qa/alert`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-qa-secret": secret },
    body: JSON.stringify({ text, run }),
    signal: AbortSignal.timeout(30_000),
  }).catch((e: Error) => ({ status: 0, text: async () => e.message }) as unknown as Response);
  const said = await r.text().catch(() => "");
  if (r.status === 404) console.log("qa:alert — the production server answered 404: its QA_SECRET is not set or is not this one (docs/qa-ci.md).");
  else console.log(`qa:alert — HTTP ${r.status} ${said.slice(0, 200)} — ${text}`);
}

main().catch((e) => console.log(`qa:alert — not sent: ${(e as Error).message}`));
