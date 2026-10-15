// Functional pass over /dashboard/trade + the /dashboard/trade/[id] thread page.
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

  // ---- 1. Initial: empty board, category chips ----
  const cats = await page.locator(".cat").count();
  log(cats === 5, "board: 5 category chips render", String(cats));
  const posts0 = await page.locator(".post").count();
  log(posts0 === 0, "board: starts empty (no seeded posts)", String(posts0));

  // ---- 2. New post dialog ----
  await page.click("#newPostBtn");
  await page.waitForTimeout(600);
  log(await page.locator(".mdl.open").count() === 1, "dialog: opens");
  await page.click("#publishPost");
  await page.waitForTimeout(600);
  const err = await page.locator(".mf-err:visible, [role=alert]:visible").count();
  log(err > 0, "dialog: empty Post shows validation");
  await page.fill(".tf-in", "QA Trade Post — dump trailer");
  await page.fill(".tf-area", "Functional pass. Will be closed and deleted.");
  await page.locator(".tf .dd-btn").click();
  await page.waitForTimeout(400);
  const ddOpen = await page.locator(".tf .dd.open, .tf .dd-menu:visible").count();
  log(ddOpen > 0, "dialog: category picker opens");
  await page.locator(".tf .dd-item", { hasText: "Equipment" }).click();
  await page.waitForTimeout(300);
  await page.click("#publishPost");
  await page.waitForTimeout(2500);
  log(await page.locator(".mdl.open").count() === 0, "post: dialog closes");
  const card = page.locator(".post", { hasText: "QA Trade Post" });
  log(await card.count() === 1, "post: card renders on board");

  // ---- 3. Category filters ----
  await page.locator(".cat", { hasText: "Equipment" }).click();
  await page.waitForTimeout(400);
  log(await card.count() === 1, "filter: Equipment keeps the post");
  await page.locator(".cat", { hasText: "Question" }).click();
  await page.waitForTimeout(400);
  log(await page.locator(".post", { hasText: "QA Trade Post" }).count() === 0, "filter: Question hides it");
  await page.locator(".cat", { hasText: "All" }).click();
  await page.waitForTimeout(400);

  // ---- 4. Row menu ----
  await card.locator(".pt-open").click();
  await page.waitForTimeout(500);
  const items = (await page.locator(".pmenu .pmenu-item:visible").allTextContents()).map(t => t.trim().split("\n")[0]);
  log(items.length === 3, "menu: author sees Open/Close/Delete", items.join("/"));

  // ---- 5. Open thread -> reply on the thread page ----
  await page.locator(".pmenu .pmenu-item", { hasText: /Open thread/i }).click();
  await page.waitForURL(/\/dashboard\/trade\/[a-z0-9]+/i, { timeout: 15000 });
  await page.waitForTimeout(1500);
  log(true, "thread: navigates", page.url().replace(QA_BASE, ""));
  log((await page.locator("text=QA Trade Post").count()) > 0, "thread: post renders");
  const ta = page.locator("textarea");
  log(await ta.count() >= 1, "thread: reply form present (OPEN post)");
  await ta.first().fill("First reply from QA run.");
  await page.locator('button:has-text("Reply"), button[type="submit"]').first().click();
  await page.waitForTimeout(2500);
  log((await page.locator("text=First reply from QA run.").count()) > 0, "thread: reply posts and renders");

  // ---- 6. Back to board: reply count, then Close thread ----
  await page.goto(QA_BASE + "/dashboard/trade", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await card.locator(".pt-open").click();
  await page.waitForTimeout(500);
  const openItem = ((await page.locator(".pmenu .pmenu-item", { hasText: /Open thread/i }).textContent()) || "").replace(/\s+/g, " ");
  log(/1 reply/.test(openItem), "menu: reply count shows '1 reply'", openItem.slice(0, 40));
  await page.locator(".pmenu .pmenu-item", { hasText: /Close thread/i }).click();
  await page.waitForTimeout(2500);
  const closedBadge = await card.locator(".cat--closed").or(card.getByText(/closed/i)).count();
  log(closedBadge > 0, "close: card shows closed badge");
  await card.locator(".pt-open").click();
  await page.waitForTimeout(500);
  const items2 = (await page.locator(".pmenu .pmenu-item:visible").allTextContents()).map(t => t.trim().split("\n")[0]);
  log(!items2.some(t => /Close/i.test(t)), "close: menu no longer offers Close", items2.join("/"));

  // thread page after close: no reply form
  await page.locator(".pmenu .pmenu-item", { hasText: /Open thread/i }).click();
  await page.waitForURL(/\/dashboard\/trade\/[a-z0-9]+/i, { timeout: 15000 });
  await page.waitForTimeout(1200);
  // the support widget keeps a textarea of its own on every page — it is not the reply form
  log((await page.locator("textarea:not([class*=jfsup]):not(.jfsup *)").count()) === 0, "thread: closed post hides reply form");

  // ---- 7. Delete (cleanup) ----
  await page.goto(QA_BASE + "/dashboard/trade", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await card.locator(".pt-open").click();
  await page.waitForTimeout(500);
  await page.locator(".pmenu .pmenu-item.is-danger, .pmenu .pmenu-item", { hasText: /Delete/i }).click();
  await page.waitForTimeout(2500);
  log((await page.locator(".post", { hasText: "QA Trade Post" }).count()) === 0, "delete: post removed, board empty again");

  console.log("CONSOLE ERRORS: " + (errors.length ? "\n  " + errors.join("\n  ") : "none"));
  await page.screenshot({ path: "trade_final.png", fullPage: true });
  await browser.close();
}).catch((e) => { console.error("HARNESS FAIL:", e.message); process.exit(1); });
