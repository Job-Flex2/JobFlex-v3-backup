// Full-cycle functional pass: /dashboard/reviews + public /review/[token].
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
  await page.goto(QA_BASE + "/dashboard/reviews", { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);

  // ---- 1. Initial state ----
  const chips = await page.locator(".rv-chip").count();
  log(chips >= 6, "state: filter chips render", String(chips));
  const emptyChips = await page.locator(".rv-chip.empty").count();
  log(emptyChips >= 5, "state: star chips read empty (no reviews)", String(emptyChips));

  // ---- 2. Request dialog: pick job, send ----
  await page.click("#rvReqBtn");
  await page.waitForTimeout(600);
  log(await page.locator(".mdl.open").count() === 1, "dialog: opens");
  const jobOpts = await page.locator("#rvReqJob option").count();
  log(jobOpts === world.jobs, "dialog: every fixture job is in the picker", `${jobOpts} of ${world.jobs}`);
  const firstOpt = ((await page.locator("#rvReqJob option").first().textContent()) || "").trim();
  const pickedTitle = world.jobTitles.find((t) => firstOpt.startsWith(t)) || "";
  log(!!pickedTitle, "dialog: a completed fixture job leads the list", firstOpt.slice(0, 40));
  await page.selectOption("#rvReqJob", { index: 0 });
  await page.waitForTimeout(400);
  await page.click("#rvReqOk");
  await page.waitForTimeout(2500);
  log(await page.locator(".mdl.open").count() === 0, "send: dialog closes");
  const pendRow = page.locator(`text=${pickedTitle}`).first();
  log(await pendRow.count() > 0, "send: pending request renders");

  // ---- 3. Copy link ----
  await page.locator(".pend-btn").first().click();
  await page.waitForTimeout(500);
  let clip = ""; try { clip = await page.evaluate(() => navigator.clipboard.readText()); } catch {}
  log(/\/review\/[A-Za-z0-9_-]+/.test(clip), "copy: public /review/<token> link in clipboard", clip.slice(0, 60));
  const label = ((await page.locator(".pend-btn").first().textContent()) || "").trim();
  log(/Copied/i.test(label), "copy: button label flips to Copied", label);

  // ---- 4. Public page: submit a 5-star review ----
  await page.goto(clip, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  log((await page.locator(`text=${world.orgName}`).count()) > 0, "public: page renders with org name");
  await page.locator('button[aria-label^="5 stars"]').click();
  await page.waitForTimeout(300);
  const ta = page.locator("textarea");
  if (await ta.count()) await ta.fill("Great crew, clean site, on schedule. (QA test)");
  await page.locator("button", { hasText: "Submit review" }).click();
  await page.waitForTimeout(2500);
  const thanks = await page.locator("text=/Thank|received|submitted/i").count();
  log(thanks > 0, "public: submit lands on thank-you state");

  // idempotence: reload shows submitted state, no second form
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  log((await page.locator('button:has-text("Submit review")').count()) === 0, "public: reload shows submitted state (no resubmit)");

  // ---- 5. Back to dashboard: review card + chips ----
  await page.goto(QA_BASE + "/dashboard/reviews", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  log((await page.locator("text=Great crew, clean site").count()) > 0, "dashboard: completed review card renders");
  const chip5 = page.locator('.rv-chip[data-f="5"]');
  const chip5Empty = await page.locator('.rv-chip.empty[data-f="5"]').count();
  log(chip5Empty === 0, "dashboard: 5-star chip no longer empty");
  await chip5.click();
  await page.waitForTimeout(400);
  log((await page.locator("text=Great crew, clean site").count()) > 0, "chips: 5-star filter keeps the review");
  const chip1 = page.locator('.rv-chip[data-f="1"]');
  await chip1.click();
  await page.waitForTimeout(400);
  log((await page.locator("text=Great crew, clean site").count()) === 0, "chips: 1-star filter hides it");
  await page.locator('.rv-chip[data-f="ALL"]').click();
  await page.waitForTimeout(300);

  console.log("CONSOLE ERRORS: " + (errors.length ? "\n  " + errors.join("\n  ") : "none"));
  console.log("TOKEN_URL=" + clip);
  await page.screenshot({ path: "reviews_final.png", fullPage: true });
  await browser.close();
}).catch((e) => { console.error("HARNESS FAIL:", e.message); process.exit(1); });
