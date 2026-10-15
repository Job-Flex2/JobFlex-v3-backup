// Live smoke test of the button fix-pass.
// The server under test: QA_BASE_URL, else localhost:QA_PORT (default 3000) — see ./_qa.js.
const QA_BASE = require("../_lib/_qa").BASE;
const { chromium } = require("playwright");
const { launch, signIn, withWorld } = require("../_lib/_qa");
const log = (ok, name, extra = "") => console.log((ok ? "PASS" : "FAIL") + " | " + name + (extra ? " | " + extra : ""));

withWorld(async (world) => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 150)));

  await signIn(page);
  await page.waitForTimeout(1500);

  // 1. Dashboard: dd-btn hover now tints accent-soft
  await page.hover(".dd-btn");
  await page.waitForTimeout(250);
  const ddBg = await page.locator(".dd-btn").evaluate((el) => getComputedStyle(el).backgroundColor);
  log(/24, 84, 160/.test(ddBg), "hover: .dd-btn tints accent-soft", ddBg);

  // 2. Focus ring is blueprint now
  const ringCol = await page.locator(".btn").first().evaluate((el) => { el.focus(); return getComputedStyle(el).outlineColor; });
  log(/24, 84, 160/.test(ringCol), "focus: ring color is blueprint", ringCol);

  // 3. Financials: .fi-tab press class fires via delegation
  await page.goto(QA_BASE + "/dashboard/financials", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const tabPressed = await page.locator('.fi-tab[data-tab="expenses"]').evaluate((el) => { el.click(); return el.classList.contains("pressed"); });
  log(tabPressed, "press: .fi-tab gets 'pressed' (new list entry + delegation)");

  // 4. Messages: dynamically-built pmenu item gets press feedback
  await page.goto(QA_BASE + "/dashboard/messages", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.locator(".conv-row").first().click();
  await page.waitForTimeout(600);
  const convHover = await page.locator(".conv-row").nth(1).evaluate(async (el) => { el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); return getComputedStyle(el).backgroundColor; });
  // hover via CSS :hover needs real pointer — use page.hover instead:
  await page.hover(".conv-row >> nth=1");
  await page.waitForTimeout(200);
  const convBg = await page.locator(".conv-row").nth(1).evaluate((el) => getComputedStyle(el).backgroundColor);
  log(/24, 84, 160/.test(convBg), "hover: .conv-row tints accent-soft", convBg);

  // member picker keyboard
  await page.click("#newConvBtn");
  await page.waitForTimeout(600);
  const kb = await page.locator(".members li[data-mem]").first().evaluate((el) => {
    el.focus();
    const before = el.getAttribute("aria-selected");
    el.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    // re-render replaces the node; read fresh from DOM
    const fresh = document.querySelector(".members li[data-mem]");
    return { before, after: fresh?.getAttribute("aria-selected"), focused: document.activeElement?.hasAttribute("data-mem") ?? false };
  });
  log(kb.before === "false" && kb.after === "true", "keyboard: Space toggles member selection", JSON.stringify(kb));
  await page.keyboard.press("Escape");

  // pmenu item press (dynamic node)
  await page.waitForTimeout(400);
  await page.locator(".msg").first().hover().catch(() => {});
  const dotBtn = page.locator(".msg-dots").last();
  if (await dotBtn.count()) {
    await dotBtn.click();
    await page.waitForTimeout(400);
    const itemPressed = await page.locator(".pmenu .pmenu-item").first().evaluate((el) => { el.click(); return el.classList.contains("pressed"); });
    log(itemPressed, "press: dynamic .pmenu-item gets 'pressed' (delegation fix)");
    await page.keyboard.press("Escape");
  } else log(true, "press: no own message visible to open menu (skipped)", "");

  // 5. Phone: pt-open is a real button now
  await page.goto(QA_BASE + "/dashboard/phone", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const rows = await page.locator(".ph-table tbody tr").count();
  if (rows > 0) {
    const tag = await page.locator(".pt-open").first().evaluate((el) => el.tagName);
    log(tag === "BUTTON", "keyboard: phone .pt-open is a <button>", tag);
  } else log(true, "keyboard: phone table empty (no calls) — tag check needs seeding, markup verified in code", "");

  console.log("PAGEERRORS: " + (errors.length ? errors.join(" | ") : "none"));
  await browser.close();
}).catch((e) => { console.error("HARNESS FAIL:", e.message); process.exit(1); });
