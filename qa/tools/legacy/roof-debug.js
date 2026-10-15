// The server under test: QA_BASE_URL, else localhost:QA_PORT (default 3000) — see ./_qa.js.
const QA_BASE = require("../../tests/_lib/_qa").BASE;
const { chromium } = require("playwright");
const { launch, signIn } = require("../../tests/_lib/_qa");
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 300)));
  await signIn(page);
  const resp = await page.goto(QA_BASE + "/dashboard/roof-estimator", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  console.log("status:", resp.status(), "url:", page.url());
  console.log("h1:", await page.locator("h1").allTextContents());
  console.log("rfx mount exists:", await page.locator(".rfx, [class*=rfx]").count());
  console.log("buttons on page:", (await page.locator("button").allTextContents()).map(t => t.trim()).filter(Boolean).slice(0, 20));
  console.log("body snippet:", (await page.locator(".content").innerText().catch(() => "NO .content")).slice(0, 600));
  console.log("CONSOLE ERRORS:", errors.length ? "\n  " + errors.join("\n  ") : "none");
  await page.screenshot({ path: "roof_debug.png" });
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
