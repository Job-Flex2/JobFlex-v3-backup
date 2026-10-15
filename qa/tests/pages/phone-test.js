// Functional pass over /dashboard/phone (Twilio unconfigured + 3 seeded calls).
// The server under test: QA_BASE_URL, else localhost:QA_PORT (default 3000) — see ./_qa.js.
const QA_BASE = require("../_lib/_qa").BASE;
const { chromium } = require("playwright");
const { launch, signIn } = require("../_lib/_qa");
const log = (ok, name, extra = "") => console.log((ok ? "PASS" : "FAIL") + " | " + name + (extra ? " | " + extra : ""));

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1728, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 200)));

  await signIn(page);
  await page.goto(QA_BASE + "/dashboard/phone", { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);

  // ---- 1. Twilio-unconfigured banner + webhook copy ----
  log((await page.locator("text=/api\\/twilio\\/voice/").count()) > 0, "cfg: webhook URL shown (Twilio empty)");
  const hookCopy = page.locator(".hook-copy");
  if (await hookCopy.count()) {
    await hookCopy.click();
    await page.waitForTimeout(400);
    let clip = ""; try { clip = await page.evaluate(() => navigator.clipboard.readText()); } catch {}
    log(clip.includes("/api/twilio/voice"), "cfg: Copy puts webhook in clipboard", clip.slice(0, 60));
  } else log(false, "cfg: .hook-copy button missing");

  // ---- 2. Table + chips filter ----
  const rows = () => page.locator(".ph-table tbody tr:visible").count();
  log(await rows() === 3, "table: 3 seeded calls render", String(await rows()));
  const chip = (t) => page.locator(".ph-chip", { hasText: t }).first();
  await chip("Inbound").click(); await page.waitForTimeout(400);
  log(await rows() === 2, "chips: Inbound filters to 2", String(await rows()));
  await chip("Outbound").click(); await page.waitForTimeout(400);
  log(await rows() === 1, "chips: Outbound filters to 1", String(await rows()));
  await chip("Became leads").click(); await page.waitForTimeout(400);
  log(await rows() === 0, "chips: Became leads filters to 0", String(await rows()));
  await chip("All").click(); await page.waitForTimeout(400);
  log(await rows() === 3, "chips: All restores 3", String(await rows()));
  const chipPressed = await page.locator('.ph-chip.on[aria-pressed="true"]').count();
  log(chipPressed === 1, "chips: aria-pressed synced on selection");

  // ---- 3. Row opens the transcript sheet ----
  await page.locator(".ph-table tbody tr").first().click();
  await page.waitForTimeout(700);
  const sheetOpen = () => page.locator(".sheet:visible, [class*=sheet].open").count();
  log(await sheetOpen() > 0, "sheet: opens on row click");
  const agentLines = await page.locator(".script-line.agent, [class*=script-line][class*=agent]").count();
  const callerLines = await page.locator(".script-line:not(.agent), [class*=script-line]:not([class*=agent])").count();
  log(agentLines >= 2 && callerLines >= 2, "sheet: transcript split agent/caller", `${agentLines}/${callerLines}`);

  // ---- 4. Play button on recorded call ----
  const play = page.locator(".play-btn");
  if (await play.count()) {
    const ariaBefore = await play.getAttribute("aria-label");
    await play.click(); await page.waitForTimeout(600);
    const ariaAfter = await play.getAttribute("aria-label");
    log(true, "sheet: play button clickable", `aria "${ariaBefore}" -> "${ariaAfter}"`);
  } else log(false, "sheet: play button missing on recorded call");

  // ---- 5. Escape closes; reopen; X closes ----
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  log(await sheetOpen() === 0, "sheet: Escape closes");
  await page.locator(".ph-table tbody tr").first().click(); await page.waitForTimeout(600);
  await page.locator(".sheet-x").click(); await page.waitForTimeout(500);
  log(await sheetOpen() === 0, "sheet: X closes");

  // ---- 6. Create lead (real action), foot switches, chip count updates ----
  await page.locator(".ph-table tbody tr").first().click(); await page.waitForTimeout(600);
  const createBtn = page.locator(".sh-act .btn-primary", { hasText: /Create lead/i });
  log(await createBtn.count() === 1, "lead: Create lead button present");
  await createBtn.click();
  await page.waitForTimeout(2500);
  const openLead = page.locator(".sh-act a", { hasText: /Open lead/i });
  log(await openLead.count() === 1, "lead: foot switches to Open lead after create");
  const href = await openLead.getAttribute("href").catch(() => null);
  log(!!href && href.includes("/dashboard/leads"), "lead: Open lead href points to leads", href || "");
  const callback = page.locator(".sh-act a", { hasText: /Call back/i });
  if (await callback.count()) log(((await callback.getAttribute("href")) || "").startsWith("tel:"), "lead: Call back is tel: link");
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  await chip("Became leads").click(); await page.waitForTimeout(400);
  log(await rows() === 1, "chips: Became leads now 1 after create", String(await rows()));

  console.log("CONSOLE ERRORS: " + (errors.length ? "\n  " + errors.join("\n  ") : "none"));
  await page.screenshot({ path: "phone_final.png", fullPage: true });
  await browser.close();
})().catch((e) => { console.error("HARNESS FAIL:", e.message); process.exit(1); });
