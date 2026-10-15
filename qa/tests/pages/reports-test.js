// Functional pass over /dashboard/reports (last page of the sweep).
// The server under test: QA_BASE_URL, else localhost:QA_PORT (default 3000) — see ./_qa.js.
const QA_BASE = require("../_lib/_qa").BASE;
const { chromium } = require("playwright");
const { launch, signIn } = require("../_lib/_qa");
const fs = require("fs");
const log = (ok, name, extra = "") => console.log((ok ? "PASS" : "FAIL") + " | " + name + (extra ? " | " + extra : ""));

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 200)));

  await signIn(page);
  await page.goto(QA_BASE + "/dashboard/reports", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // ---- 1. Sheet renders ----
  const ranges = await page.locator(".range").count();
  log(ranges === 4, "ranges: 4 period chips", String(ranges));
  const defOn = ((await page.locator(".range.on").textContent().catch(() => "")) || "").trim();
  log(/Quarter/i.test(defOn), "ranges: Quarter is the default", defOn);
  log((await page.locator("svg path, svg rect").count()) > 5, "charts: svg marks render");
  const crewRows = await page.locator(".rp-table tbody tr").count();
  log(crewRows > 0, "crew: table rows render", String(crewRows));

  // ---- 2. Range switching ----
  const snapshot = async () => (await page.locator(".content").innerText()).replace(/\s+/g, " ");
  const before = await snapshot();
  await page.locator(".range", { hasText: "This month" }).click();
  await page.waitForTimeout(900);
  const onMoved = ((await page.locator(".range.on").textContent()) || "").trim();
  log(/This month/i.test(onMoved), "ranges: .on moves to This month", onMoved);
  const after = await snapshot();
  log(before !== after, "ranges: sheet recomputes on switch");
  await page.locator(".range", { hasText: "Last 12 months" }).click();
  await page.waitForTimeout(900);
  const after12 = await snapshot();
  log(after12 !== after, "ranges: second switch recomputes again");
  await page.locator(".range", { hasText: "Quarter" }).click();
  await page.waitForTimeout(700);

  // ---- 3. Export modal ----
  await page.click("#exportBtn");
  await page.waitForTimeout(600);
  log(await page.locator(".mdl.open").count() === 1, "export: modal opens");
  const opts = await page.locator(".exp-opt").count();
  log(opts === 3, "export: 3 format options", String(opts));
  log(await page.locator(".exp-opt.on", { hasText: /CSV/i }).count() === 1, "export: CSV selected by default");
  const soon = await page.locator(".exp-opt.is-soon[disabled], .exp-opt.is-soon[aria-disabled='true']").count();
  log(soon === 2, "export: PDF/Excel honestly disabled", String(soon));
  await page.locator(".exp-opt.is-soon").first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
  log(await page.locator(".exp-opt.on", { hasText: /CSV/i }).count() === 1, "export: clicking a disabled option changes nothing");

  // ---- 4. Download the CSV ----
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.click("#downloadBtn"),
  ]);
  const fname = download.suggestedFilename();
  log(fname === "jobflex-report-q.csv", "export: CSV downloads with range-stamped name", fname);
  const tmp = "report-dl.csv";
  await download.saveAs(tmp);
  const head = fs.readFileSync(tmp, "utf8").split("\n").slice(0, 3).join(" \\n ");
  log(head.length > 10 && head.includes(","), "export: CSV has content", head.slice(0, 100));

  // ---- 5. Close paths ----
  await page.locator('.mdl-foot .btn-ghost, .mdl [data-mdl-close].btn').first().click().catch(() => {});
  await page.waitForTimeout(500);
  const closed1 = await page.locator(".mdl.open").count() === 0;
  if (!closed1) { await page.keyboard.press("Escape"); await page.waitForTimeout(400); }
  log(await page.locator(".mdl.open").count() === 0, "export: modal closes (Cancel/Esc)");

  console.log("CONSOLE ERRORS: " + (errors.length ? "\n  " + errors.join("\n  ") : "none"));
  await page.screenshot({ path: "reports_final.png", fullPage: true });
  await browser.close();
})().catch((e) => { console.error("HARNESS FAIL:", e.message); process.exit(1); });
