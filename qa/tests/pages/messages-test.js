// Functional pass over /dashboard/messages.
// The server under test: QA_BASE_URL, else localhost:QA_PORT (default 3000) — see ./_qa.js.
const QA_BASE = require("../_lib/_qa").BASE;
const { chromium } = require("playwright");
const { launch, signIn, withWorld } = require("../_lib/_qa");
const log = (ok, name, extra = "") => console.log((ok ? "PASS" : "FAIL") + " | " + name + (extra ? " | " + extra : ""));

withWorld(async (world) => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1728, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 200)));

  await signIn(page);
  await page.goto(QA_BASE + "/dashboard/messages", { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);

  // ---- 1. Conversation rail renders ----
  const convRows = () => page.locator(".conv-row").count();
  log(await convRows() === 2, "rail: 2 seeded conversations", String(await convRows()));

  // ---- 2. Open seeded thread ----
  await page.locator(".conv-row", { hasText: "Morgan Lane" }).click();
  await page.waitForTimeout(800);
  const bubbles = await page.locator(".bub, [class*=bub]").count();
  log(bubbles >= 1, "thread: seeded conversation renders its message", String(bubbles));

  // ---- 3. New chat modal: search, pick, start ----
  await page.click("#newConvBtn");
  await page.waitForTimeout(600);
  log(await page.locator(".mdl.open").count() === 1, "modal: opens");
  const startDisabled = await page.locator("#startBtn[disabled]").count();
  log(startDisabled === 1, "modal: Start disabled before selection");
  await page.fill("#memberSearch", "Casey");
  await page.waitForTimeout(400);
  const memberRows = await page.locator(".members li[data-mem]:visible").count();
  log(memberRows === 1, "modal: search filters members", String(memberRows));
  await page.locator(".members li[data-mem]:visible").first().click();
  await page.waitForTimeout(300);
  log(await page.locator(".members li.on").count() === 1, "modal: member selects (.on)");
  await page.fill("#memberSearch", "");
  await page.waitForTimeout(300);
  await page.locator('.members li[data-mem]', { hasText: "Morgan" }).click();
  await page.waitForTimeout(300);
  log(await page.locator(".members li.on").count() === 2, "modal: second member selects (group)");
  const grpVisible = await page.locator("#grpTitleWrap:visible, #grpTitle:visible").count();
  log(grpVisible > 0, "modal: group-title field appears for 2+ members");
  await page.fill("#grpTitle", "QA Test Group");
  log(await page.locator("#startBtn[disabled]").count() === 0, "modal: Start enables");
  await page.click("#startBtn");
  await page.waitForTimeout(2500);
  log(await page.locator(".mdl.open").count() === 0, "modal: closes after Start");
  const rowsAfter = await convRows();
  log(rowsAfter === 3, "rail: new conversation appears", String(rowsAfter));

  // ---- 4. Post a message ----
  const composer = page.locator(".th-composer textarea, .th-composer [contenteditable], .content textarea").first();
  await composer.fill("Functional test message one");
  await page.click(".send-btn");
  await page.waitForTimeout(2000);
  log((await page.locator("text=Functional test message one").count()) > 0, "composer: message posts and renders");

  // ---- 5. Edit via ⋯ menu ----
  const ownBubbleMeta = page.locator(".msg", { hasText: "Functional test message one" }).first();
  await ownBubbleMeta.hover();
  await page.waitForTimeout(300);
  await page.locator(".msg-dots").last().click();
  await page.waitForTimeout(500);
  const menuItems = await page.locator(".pmenu .pmenu-item:visible").allTextContents();
  log(menuItems.length >= 2, "menu: opens with items", menuItems.map(t => t.trim().split("\n")[0]).join("/"));
  await page.locator(".pmenu .pmenu-item", { hasText: /Edit/i }).click();
  await page.waitForTimeout(500);
  log(await page.locator("#editCancel:visible").count() === 1, "edit: edit strip appears");
  await composer.fill("Functional test message one — edited");
  await page.click(".send-btn");
  await page.waitForTimeout(2000);
  log((await page.locator("text=one — edited").count()) > 0, "edit: bubble text updates");

  // ---- 6. Edit-cancel path ----
  await ownBubbleMeta.hover().catch(() => {});
  await page.locator(".msg-dots").last().click();
  await page.waitForTimeout(400);
  await page.locator(".pmenu .pmenu-item", { hasText: /Edit/i }).click();
  await page.waitForTimeout(400);
  await page.click("#editCancel");
  await page.waitForTimeout(400);
  log(await page.locator("#editCancel:visible").count() === 0, "edit: Cancel exits edit mode");
  log((await composer.inputValue().catch(() => "")) === "", "edit: composer cleared after cancel");

  // ---- 7. Copy via menu ----
  await page.locator(".msg-dots").last().click();
  await page.waitForTimeout(400);
  await page.locator(".pmenu .pmenu-item", { hasText: /Copy/i }).click();
  await page.waitForTimeout(400);
  let clip = ""; try { clip = await page.evaluate(() => navigator.clipboard.readText()); } catch {}
  log(clip.includes("edited"), "menu: Copy puts bubble text in clipboard", clip.slice(0, 40));

  // ---- 8. Clear thread (trash) on MY conversation ----
  await page.click(".th-clear");
  await page.waitForTimeout(2000);
  const cleared = (await page.locator("text=one — edited").count()) === 0;
  log(cleared, "clear: thread empties");

  // ---- 9. Seeded threads untouched ----
  await page.locator(".conv-row", { hasText: "Morgan Lane" }).click();
  await page.waitForTimeout(700);
  log((await page.locator(".bub, [class*=bub]").count()) >= 1, "sanity: seeded thread still has its message");

  console.log("CONSOLE ERRORS: " + (errors.length ? "\n  " + errors.join("\n  ") : "none"));
  await page.screenshot({ path: "messages_final.png", fullPage: false });
  await browser.close();
}).catch((e) => { console.error("HARNESS FAIL:", e.message); process.exit(1); });
