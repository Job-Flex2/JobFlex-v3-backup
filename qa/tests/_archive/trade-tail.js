// Continuation: verify closed state, thread lock, then delete (cleanup).
// The server under test: QA_BASE_URL, else localhost:QA_PORT (default 3000) — see ./_qa.js.
const QA_BASE = require("../_lib/_qa").BASE;
const { chromium } = require("playwright");
const { launch, signIn, withWorld } = require("../_lib/_qa");
const log = (ok, name, extra = "") => console.log((ok ? "PASS" : "FAIL") + " | " + name + (extra ? " | " + extra : ""));

withWorld(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 200)));

  await signIn(page);
  await page.goto(QA_BASE + "/dashboard/trade", { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);

  const card = page.locator(".post", { hasText: "QA Trade Post" });
  log(await card.count() === 1, "closed: post still on board");
  const badge = await card.locator(".cat--closed").count();
  const badgeTxt = ((await card.innerText()) || "").toLowerCase();
  log(badge > 0 || badgeTxt.includes("closed"), "closed: card carries closed badge");

  await card.locator(".pt-open").click();
  await page.waitForTimeout(500);
  const items = (await page.locator(".pmenu .pmenu-item:visible").allTextContents()).map(t => t.trim().split("\n")[0]);
  log(!items.some(t => /Close/i.test(t)), "closed: menu no longer offers Close", items.join(" / "));

  await page.locator(".pmenu .pmenu-item", { hasText: /Open thread/i }).click();
  await page.waitForURL(/\/dashboard\/trade\/[a-z0-9]+/i, { timeout: 15000 });
  await page.waitForTimeout(1200);
  // the support widget keeps a textarea of its own on every page — it is not the reply form
  log((await page.locator("textarea:not([class*=jfsup]):not(.jfsup *)").count()) === 0, "thread: closed post hides reply form");
  log((await page.locator("text=First reply from QA run.").count()) > 0, "thread: existing reply still visible");

  await page.goto(QA_BASE + "/dashboard/trade", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await card.locator(".pt-open").click();
  await page.waitForTimeout(500);
  await page.locator(".pmenu .pmenu-item.is-danger").click();
  await page.waitForTimeout(2500);
  log((await page.locator(".post", { hasText: "QA Trade Post" }).count()) === 0, "delete: post removed (cleanup)");

  console.log("CONSOLE ERRORS: " + (errors.length ? "\n  " + errors.join("\n  ") : "none"));
  await browser.close();
}, { closedTradePost: true }).catch((e) => { console.error("HARNESS FAIL:", e.message); process.exit(1); });
