// Synthetic check of the Cool Calc client — no network.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/hvac-coolcalc.check.ts
// A fake server speaks the documented HATEOAS flow (dealer → MJ8Projects
// template/POST with Location → HVACSystems POST → MJ8Report bytes) and the
// client walks it with HTTP Basic auth; a server that omits the Location
// header is handled by name; the config gate and the address splitter answer
// known cases.
import { coolCalcConfig, coolCalcCreateProject, coolCalcCreateSystem, coolCalcFetchReport, findLink, idFromLocation, isCoolCalcEnabled, splitAddress, type FetchLike } from "../../../src/lib/hvac/coolcalc";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

// config
ok("Disabled without the three env vars", !isCoolCalcEnabled({} as NodeJS.ProcessEnv) && !isCoolCalcEnabled({ COOLCALC_CLIENT_ID: "a", COOLCALC_API_KEY: "b" } as NodeJS.ProcessEnv));
const cfg = coolCalcConfig({ COOLCALC_CLIENT_ID: "AtixHVAC", COOLCALC_API_KEY: "secret", COOLCALC_DEALER_ID: "1626443386", COOLCALC_BASE_URL: "https://stagingapi.coolcalc.com/staging/" } as NodeJS.ProcessEnv)!;
ok("Config reads the staging base without a trailing slash", cfg.baseUrl === "https://stagingapi.coolcalc.com/staging");
ok("Default base is production", coolCalcConfig({ COOLCALC_CLIENT_ID: "a", COOLCALC_API_KEY: "b", COOLCALC_DEALER_ID: "c" } as NodeJS.ProcessEnv)!.baseUrl === "https://api3.coolcalc.com/current");

// helpers
ok("idFromLocation reads the tail id", idFromLocation("https://x/dealers/1/MJ8Projects/2105") === "2105" && idFromLocation("https://x/dealers/1/MJ8Projects/2105/HVACSystems/2440/?a=1") === "2440" && idFromLocation("https://x/dealers/1/MJ8Projects/") === null);
ok("findLink by rel, by href tail, and misses", findLink([{ rel: "MJ8Projects", href: "https://x/p" }], "MJ8Projects") === "https://x/p" && findLink([{ href: "https://x/dealers/1/HVACSystems/" }], "HVACSystems") === "https://x/dealers/1/HVACSystems/" && findLink([{ rel: "self", href: "https://x" }], "MJ8Reports") === null);
const a1 = splitAddress("461 Ocean Blvd, Golden Beach, FL 33160");
ok("splitAddress street/city/state/zip", a1.address === "461 Ocean Blvd" && a1.city === "Golden Beach" && a1.state === "FL" && a1.zip === "33160", JSON.stringify(a1));
const a2 = splitAddress("4518 Bluestem Hollow Dr, Frisco, TX");
ok("splitAddress without zip", a2.city === "Frisco" && a2.state === "TX" && a2.zip === "");
const a3 = splitAddress("12 Main St, Austin TX 78701");
ok("splitAddress two-part", a3.address === "12 Main St" && a3.city === "Austin" && a3.state === "TX" && a3.zip === "78701", JSON.stringify(a3));

// fake server
const calls: Array<{ method: string; url: string; auth?: string; body?: string }> = [];
const json = (obj: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" }, ...init });
const fakeFetch: FetchLike = async (url, init) => {
  const method = init.method ?? "GET";
  const headers = init.headers as Record<string, string>;
  calls.push({ method, url, auth: headers?.Authorization, body: typeof init.body === "string" ? init.body : undefined });
  const base = cfg.baseUrl;
  if (url === `${base}/dealers/1626443386` && method === "GET") return json({ dealer: { dealerId: 1626443386 }, links: [{ rel: "self", href: url }, { rel: "MJ8Projects", href: `${base}/dealers/1626443386/MJ8Projects/` }] });
  if (url === `${base}/dealers/1626443386/MJ8Projects/` && method === "POST") return json({ MJ8Projects: [{ projectId: 2105, project: "Erics house · JobFlex abc123" }] }, { headers: { "Content-Type": "application/json", Location: `${base}/dealers/1626443386/MJ8Projects/2105` } });
  if (url === `${base}/dealers/1626443386/MJ8Projects/2105` && method === "GET") return json({ MJ8Project: { projectId: 2105 }, links: [{ rel: "HVACSystems", href: `${base}/dealers/1626443386/MJ8Projects/2105/HVACSystems/` }] });
  if (url === `${base}/dealers/1626443386/MJ8Projects/2105/HVACSystems/` && method === "POST") return json({ HVACSystems: [{ HVACSystemId: 2440, HVACSystemName: "System 1" }] }, { headers: { "Content-Type": "application/json", Location: `${base}/dealers/1626443386/MJ8Projects/2105/HVACSystems/2440` } });
  if (url === `${base}/dealers/1626443386/MJ8Projects/2105/HVACSystems/2440/MJ8Report` && method === "GET") return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200, headers: { "Content-Type": "application/pdf" } });
  return new Response("nope", { status: 404 });
};

(async () => {
  const project = await coolCalcCreateProject(cfg, { project: "Erics house · JobFlex abc123", address: "461 Ocean Blvd", city: "Golden Beach", state: "FL", zip: "33160" }, fakeFetch);
  ok("Project id from the Location header", project.projectId === "2105" && project.projectUrl.endsWith("/MJ8Projects/2105"), JSON.stringify(project));
  const post = calls.find((c) => c.method === "POST");
  ok("POST body is the documented MJ8Project template", !!post && JSON.parse(post.body!).MJ8Project.address === "461 Ocean Blvd" && JSON.parse(post.body!).MJ8Project.state === "FL", post?.body);
  ok("HTTP Basic with client id and key", calls.every((c) => c.auth === "Basic " + Buffer.from("AtixHVAC:secret").toString("base64")));
  const system = await coolCalcCreateSystem(cfg, project, "System 1", fakeFetch);
  ok("System id and report URL", system.systemId === "2440" && system.reportUrl.endsWith("/HVACSystems/2440/MJ8Report"), system.reportUrl);
  const rep = await coolCalcFetchReport(cfg, system.reportUrl, fakeFetch);
  ok("Report bytes and content type pass through", rep.ok && rep.contentType === "application/pdf" && rep.bytes.length === 4);

  // a server without Location headers: the id comes from the listing
  const noLoc: FetchLike = async (url, init) => {
    const r = await fakeFetch(url, init);
    if ((init.method ?? "GET") !== "POST") return r;
    return new Response(await r.text(), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const p2 = await coolCalcCreateProject(cfg, { project: "Erics house · JobFlex abc123", address: "461 Ocean Blvd", city: "Golden Beach", state: "FL" }, noLoc);
  ok("No Location header → id found by project name", p2.projectId === "2105" && p2.projectUrl.endsWith("/MJ8Projects/2105"));
  const s2 = await coolCalcCreateSystem(cfg, p2, "System 1", noLoc);
  ok("No Location header → system found by name", s2.systemId === "2440");

  // a refusal surfaces as an error, not a silent id
  const refuse: FetchLike = async () => new Response("bad key", { status: 401 });
  let threw = "";
  try { await coolCalcCreateProject(cfg, { project: "x", address: "y", city: "", state: "" }, refuse); } catch (e) { threw = (e as Error).message; }
  ok("401 throws with the status", /401/.test(threw), threw);
  const bad = await coolCalcFetchReport(cfg, "https://stagingapi.coolcalc.com/staging/x", refuse);
  ok("Report refusal is a typed failure", !bad.ok && bad.status === 401);

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
