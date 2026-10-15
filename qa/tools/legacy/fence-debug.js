// The server under test: QA_BASE_URL, else localhost:QA_PORT (default 3000) — see ./_qa.js.
const QA_BASE = require("../../tests/_lib/_qa").BASE;
const { chromium } = require("playwright");
const { launch, signIn } = require("../../tests/_lib/_qa");
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 250)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 250)));
  await signIn(page);
  await page.goto(QA_BASE + "/dashboard/fence-estimator", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  console.log("h1:", await page.locator("h1").allTextContents());
  console.log("buttons:", (await page.locator(".content button:visible").allTextContents()).map(t => t.trim().replace(/\s+/g, " ")).filter(Boolean));
  console.log("canvas:", await page.locator("canvas").count(), "svg-stage:", await page.locator(".map-slot svg, .model-slot canvas, [class*=stage] svg").count());
  console.log("selects:", await page.locator(".content select:visible").count(), "inputs:", await page.locator(".content input:visible").count());
  console.log("notice:", (await page.locator("text=/BROWSER_KEY|isn.t configured/i").allTextContents()).join(" | ").slice(0, 200));
  console.log("mats:", await page.locator(".mats li").count(), "segs:", await page.locator(".seg-btn").count(), "tools:", await page.locator(".tool").count(), "vsw:", await page.locator(".vsw-btn").count());
  console.log("runs rows:", await page.locator("[class*=run]").count());
  console.log("body head:", (await page.locator(".content").innerText()).slice(0, 500).replace(/\n+/g, " · "));
  console.log("ERRORS:", errors.length ? "\n  " + errors.join("\n  ") : "none");
  await page.screenshot({ path: "fence_debug.png", fullPage: true });
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
