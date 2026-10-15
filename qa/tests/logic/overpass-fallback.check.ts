// The Overpass fallback (2026-09-20): when the main host errors, answers
// non-200 or times out, the same query goes to the fallback hosts — all of
// them at once, first good answer wins — inside ONE budget, and the health
// tally says which way it went. fetch, the hosts, the
// budgets and the tally are all swapped — no network, no database.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/overpass-fallback.check.ts
import { askOverpass, overpassHosts, OVERPASS_DEFAULT_HOSTS, OVERPASS_MAIN_MS, OVERPASS_TOTAL_MS } from "../../../src/lib/overpass";

let failures = 0;
let passes = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : " — " + JSON.stringify(detail)}`);
};

const MAIN = "https://main.test/api";
const SECOND = "https://second.test/api";
const ANSWER = { elements: [{ type: "way", id: 1 }] };
type Behaviour = "ok" | "500" | "throw" | "hang";

/** A fetch that behaves per host, honours the abort signal, and keeps a log. */
function fakeFetch(plan: Record<string, Behaviour>) {
  const calls: Array<{ host: string; body: string; ua: string }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const host = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ host, body: String(init?.body ?? ""), ua: headers["User-Agent"] ?? "" });
    const how = plan[host];
    if (how === "throw") throw new TypeError("fetch failed");
    if (how === "500") return new Response("busy", { status: 504 });
    if (how === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
      });
    }
    return new Response(JSON.stringify(ANSWER), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}
const tally = () => {
  const seen: string[] = [];
  return { seen, record: (o: "ok" | "ok-fallback" | "failed") => void seen.push(o) };
};
const Q = '[out:json];way["building"](around:130,47.6,-122.1);out geom;';

async function main() {
  // AbortSignal.timeout()'s timer is unref'd: with a fetch that never settles nothing else holds the
  // process open, and Node would exit mid-check without a word.
  const keepAlive = setInterval(() => {}, 1000);
  // The shipped budget is what the owner agreed to.
  check("budget: the main host gets 5 s of a 12 s total", OVERPASS_MAIN_MS === 5000 && OVERPASS_TOTAL_MS === 12000);
  check("a main host and two different fallbacks ship by default", OVERPASS_DEFAULT_HOSTS.length === 3 && new Set(OVERPASS_DEFAULT_HOSTS).size === 3);

  { // main answers
    const f = fakeFetch({ [MAIN]: "ok", [SECOND]: "ok" });
    const t = tally();
    const r = await askOverpass<typeof ANSWER>(Q, { hosts: [MAIN, SECOND], fetchImpl: f.impl, record: t.record });
    check("main host answers: the second is never asked", r.host === 0 && f.calls.length === 1 && f.calls[0].host === MAIN);
    check("main host answers: tallied ok", t.seen.join() === "ok", t.seen);
    check("the query travels url-encoded with a real User-Agent", f.calls[0].body === "data=" + encodeURIComponent(Q) && /JobFlex/.test(f.calls[0].ua));
  }
  for (const how of ["throw", "500"] as const) { // main fails fast
    const f = fakeFetch({ [MAIN]: how, [SECOND]: "ok" });
    const t = tally();
    const r = await askOverpass<typeof ANSWER>(Q, { hosts: [MAIN, SECOND], fetchImpl: f.impl, record: t.record });
    check(`main host ${how === "throw" ? "unreachable" : "answers 504"}: the second host answers`, r.host === 1 && r.data?.elements.length === 1 && f.calls.map((c) => c.host).join() === [MAIN, SECOND].join());
    check(`main host ${how === "throw" ? "unreachable" : "answers 504"}: tallied as answered via the fallback`, t.seen.join() === "ok-fallback", t.seen);
    check(`main host ${how === "throw" ? "unreachable" : "answers 504"}: the same query went to both`, f.calls[0].body === f.calls[1].body);
  }
  { // main hangs: cut at its share, the second gets the rest (budgets scaled down 20× to keep the check quick)
    const f = fakeFetch({ [MAIN]: "hang", [SECOND]: "ok" });
    const t = tally();
    const r = await askOverpass<typeof ANSWER>(Q, { hosts: [MAIN, SECOND], fetchImpl: f.impl, record: t.record, mainMs: 350, totalMs: 600 });
    check("main host hangs: cut off at its share, the second host answers", r.host === 1 && r.tookMs >= 330 && r.tookMs < 600, r);
    check("main host hangs: tallied as answered via the fallback", t.seen.join() === "ok-fallback", t.seen);
  }
  { // both hang: the total is the ceiling
    const f = fakeFetch({ [MAIN]: "hang", [SECOND]: "hang" });
    const t = tally();
    const r = await askOverpass<typeof ANSWER>(Q, { hosts: [MAIN, SECOND], fetchImpl: f.impl, record: t.record, mainMs: 350, totalMs: 600 });
    check("both hosts hang: gives up at the total budget, not later", r.data === null && r.host === -1 && r.tookMs >= 580 && r.tookMs < 800, r);
    check("both hosts hang: tallied failed, once", t.seen.join() === "failed", t.seen);
  }
  { // the case the forced dev run hit: the main host dead, the FIRST fallback hanging, the second one fine
    const THIRD = "https://third.test/api";
    const f = fakeFetch({ [MAIN]: "throw", [SECOND]: "hang", [THIRD]: "ok" });
    const t = tally();
    const r = await askOverpass<typeof ANSWER>(Q, { hosts: [MAIN, SECOND, THIRD], fetchImpl: f.impl, record: t.record, mainMs: 350, totalMs: 600 });
    check("a hanging fallback does not hold up a working one", r.host === 2 && r.tookMs < 200 && r.data?.elements.length === 1, r);
    check("both fallbacks were asked at once, after the main host", f.calls.map((c) => c.host).join() === [MAIN, SECOND, THIRD].join() && t.seen.join() === "ok-fallback");
  }
  { // both refuse
    const f = fakeFetch({ [MAIN]: "500", [SECOND]: "throw" });
    const t = tally();
    const r = await askOverpass(Q, { hosts: [MAIN, SECOND], fetchImpl: f.impl, record: t.record });
    check("both hosts refuse: null, both were asked, tallied failed", r.data === null && f.calls.length === 2 && t.seen.join() === "failed");
  }
  { // the process-level override used to force the fallback in dev
    const before = process.env.OVERPASS_HOSTS;
    process.env.OVERPASS_HOSTS = " https://a.test/x , https://b.test/y ";
    check("OVERPASS_HOSTS replaces the host list for the process", overpassHosts().join() === "https://a.test/x,https://b.test/y");
    process.env.OVERPASS_HOSTS = "";
    check("an empty OVERPASS_HOSTS falls back to the shipped hosts", overpassHosts().join() === OVERPASS_DEFAULT_HOSTS.join());
    if (before === undefined) delete process.env.OVERPASS_HOSTS;
    else process.env.OVERPASS_HOSTS = before;
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  clearInterval(keepAlive);
  process.exit(failures ? 1 : 0);
}
void main();
