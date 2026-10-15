// The QA set's own safety net (./_world, ./_qa), driven from outside the way a mistake would:
//   node qa/tests/smoke/qa-guard.check.js          (from the project root; no dev server needed)
//  · a DATABASE_URL that is not a local dev database stops _world before it reads anything;
//  · qa@acme.test working anywhere but QA Co — or holding a seat where people work — stops it;
//  · a click, a key press or a tap on a forbidden control kills the script, and the page never
//    sees the event. Harmless look-alikes ("Delete photo", "Send") still work.
// The identity cases run against a FAKE Prisma object: nothing is written anywhere.
const { spawnSync } = require("child_process");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const world = require("../_lib/_world");

let passes = 0;
let failures = 0;
const check = (name, ok, detail) => {
  if (ok) passes++; else failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : " — " + String(detail).slice(0, 160)}`);
};
const node = (code, env) => spawnSync(process.execPath, ["-e", code], { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env }, timeout: 120000 });
const fakePrisma = (user) => ({ user: { findUnique: async () => user } });
const seat = (slug, name) => ({ organizationId: slug, organization: { id: slug, slug, name } });
const refuses = async (prisma) => world.assertSafe(prisma).then(() => null, (e) => e.message);

(async () => {
  // ── where ──
  for (const [url, local] of [["file:./dev.db", true], ["postgresql://u:p@localhost:5432/x", true], ["postgresql://u:p@127.0.0.1/x", true],
    ["postgresql://u:p@db.prod.example.com:5432/jobflex", false], ["postgres://u:p@ep-cool-name.us-east-2.aws.neon.tech/neondb", false], ["not a url", false]]) {
    check(`database: ${url.replace(/\/\/[^@]*@/, "//…@")} is ${local ? "local" : "NOT local"}`, world.isLocalDatabase(url) === local);
  }
  const remote = node("const{PrismaClient}=require('@prisma/client');require('./scripts/qa/_world').status(new PrismaClient()).then(()=>console.log('RAN')).catch(e=>{console.error(e.message);process.exit(1)})",
    { DATABASE_URL: "postgresql://u:p@db.prod.example.com:5432/jobflex" });
  check("a remote DATABASE_URL: _world refuses, exit 1", remote.status === 1 && /QA guard: DATABASE_URL from the process environment is not a local/.test(remote.stderr) && !/RAN/.test(remote.stdout), remote.stderr || remote.stdout);
  check("the refusal never prints the URL", !/db\.prod\.example|u:p@/.test(remote.stderr + remote.stdout));
  const runAll = spawnSync(process.execPath, ["qa/tests/_lib/run-all.js", "--checks"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, DATABASE_URL: "postgresql://u:p@db.prod.example.com:5432/jobflex" }, timeout: 120000 });
  check("a remote DATABASE_URL: run-all stops before its first check", runAll.status === 1 && /QA guard/.test(runAll.stderr + runAll.stdout) && !/^(PASS|FAIL)\s/m.test(runAll.stdout), (runAll.stderr + runAll.stdout).slice(0, 160));

  // ── who (fake Prisma: reads only, and not even those are real) ──
  const ok = { activeOrgId: "qa-co", memberships: [seat("qa-co", "QA Co")] };
  check("qa@ in QA Co: allowed", (await refuses(fakePrisma(ok))) === null);
  check("qa@ in QA Co plus a throwaway org of the set: allowed", (await refuses(fakePrisma({ ...ok, memberships: [seat("qa-co", "QA Co"), seat("refund-iso-17-a", "refund A")] }))) === null);
  check("no qa@ in the database: refused", /does not exist/.test((await refuses(fakePrisma(null))) || ""));
  check("qa@ ACTIVE in the owner's organisation: refused", /is working in "Acme Contracting", not QA Co/.test((await refuses(fakePrisma({ activeOrgId: "acme-contracting", memberships: [seat("acme-contracting", "Acme Contracting"), seat("qa-co", "QA Co")] }))) || ""));
  check("qa@ active in QA Co but still holding a seat in Acme: refused", /has a seat in "Acme Contracting"/.test((await refuses(fakePrisma({ activeOrgId: "qa-co", memberships: [seat("qa-co", "QA Co"), seat("acme-contracting", "Acme Contracting")] }))) || ""));
  check("qa@ with no active organisation: refused", /no organisation/.test((await refuses(fakePrisma({ activeOrgId: null, memberships: [] }))) || ""));

  // ── what ──
  const press = (label, attrs = "", how = "click") => {
    const code = `
      const { launch, forbidControls } = require("./scripts/qa/_qa");
      (async () => {
        const b = await launch(); const ctx = await b.newContext({ hasTouch: true }); await forbidControls(ctx);
        const p = await ctx.newPage();
        await p.route("**/*", (r) => r.fulfill({ contentType: "text/html", body: '<button id="t" ${attrs} onclick="document.title=\\'PRESSED\\'">${label}</button>' }));
        await p.goto("http://qa.invalid/");
        if (${JSON.stringify(how)} === "key") { await p.focus("#t"); await p.keyboard.press("Enter"); }
        else if (${JSON.stringify(how)} === "tap") await p.tap("#t");
        else await p.click("#t");
        await p.waitForTimeout(400);
        console.log("TITLE=" + (await p.title()));
        await b.close();
      })().catch((e) => { console.error("ERR " + e.message); process.exit(2); });`;
    return node(code, {});
  };
  const killed = (r) => r.status === 1 && /QA guard — a script tried to press a forbidden control/.test(r.stderr) && !/TITLE=PRESSED/.test(r.stdout);
  const alive = (r) => r.status === 0 && /TITLE=PRESSED/.test(r.stdout);
  for (const label of ["Delete account", "Delete my account", "Delete organization", "Cancel subscription", "Yes, cancel plan", "Send email", "Send proposal", "Send to client", "Order report", "Measure roof"]) {
    const r = press(label);
    check(`"${label}": the click is swallowed and the script dies`, killed(r), r.stderr || r.stdout);
  }
  check("a forbidden control by selector, whatever it is called", killed(press("Continue", 'data-act="delete-account"')));
  check("by aria-label, with an icon for a face", killed(press("×", 'aria-label="Delete account"')));
  check("Enter on a focused forbidden control", killed(press("Delete account", "", "key")));
  check("a tap on a forbidden control", killed(press("Cancel subscription", "", "tap")));
  for (const label of ["Delete photo", "Send", "Send request", "Cancel", "Measure", "Order materials"]) {
    const r = press(label);
    check(`"${label}" is an ordinary control and still works`, alive(r), r.stderr || r.stdout);
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("HARNESS FAIL:", e.message); process.exit(1); });
