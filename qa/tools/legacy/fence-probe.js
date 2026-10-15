// The server under test: QA_BASE_URL, else localhost:QA_PORT (default 3000) — see ./_qa.js.
const QA_BASE = require("../../tests/_lib/_qa").BASE;
const { chromium } = require("playwright");
const { launch, signIn } = require("../../tests/_lib/_qa");
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 200)));
  await signIn(page);
  await page.goto(QA_BASE + "/dashboard/fence-estimator", { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);

  const totalNow = async () => {
    const t = await page.locator(".content").innerText();
    const m = t.match(/ESTIMATED TOTAL\s*·?\s*\$?([\d,]+|—)/);
    return m ? m[1] : "?";
  };

  // add two runs
  await page.click('button:has-text("Add run")');
  await page.waitForTimeout(300);
  let inputs = page.locator(".content input:visible");
  await inputs.last().fill("100"); await inputs.last().press("Enter");
  await page.waitForTimeout(400);
  await page.click('button:has-text("Add run")');
  await page.waitForTimeout(300);
  inputs = page.locator(".content input:visible");
  await inputs.last().fill("50"); await inputs.last().press("Enter");
  await page.waitForTimeout(500);
  console.log("total after 100+50:", await totalNow());

  // dump the runs/ledger region DOM
  const ledger = await page.evaluate(() => {
    const zone = document.querySelector(".runs, [class*=runs]")?.closest(".card, section, div");
    const rows = [...document.querySelectorAll(".run-row, [class*=run-row], .runs li, .runs > div")].map(r => ({
      cls: r.className.toString().slice(0, 60),
      text: r.innerText.replace(/\s+/g, " ").slice(0, 80),
      buttons: [...r.querySelectorAll("button")].map(b => (b.getAttribute("aria-label") || b.className.toString().slice(0, 30)) + "|" + b.innerText.trim()),
    }));
    return rows;
  });
  console.log("ledger rows:", JSON.stringify(ledger, null, 1).slice(0, 1500));

  // all remove-ish buttons
  const removers = await page.evaluate(() =>
    [...document.querySelectorAll(".row-x, [aria-label*=Remove], [aria-label*=remove]")].map(b => ({
      cls: b.className.toString().slice(0, 40), aria: b.getAttribute("aria-label"), txt: b.innerText.trim(),
      row: b.closest("[class*=run],li,tr")?.innerText.replace(/\s+/g, " ").slice(0, 50),
    })));
  console.log("removers:", JSON.stringify(removers, null, 1));

  // remove the LAST one and watch total
  if (removers.length) {
    await page.locator(".row-x, [aria-label*='Remove']").last().click();
    await page.waitForTimeout(600);
    console.log("total after removing last remover:", await totalNow());
  }

  // 3D probe
  await page.click('.vsw-btn:has-text("3D")');
  await page.waitForTimeout(3000);
  const threeD = await page.evaluate(() => {
    const slot = document.querySelector(".model-slot, [class*=model-slot]");
    return {
      slotExists: !!slot,
      slotHTMLHead: slot ? slot.innerHTML.slice(0, 300) : null,
      canvases: document.querySelectorAll("canvas").length,
      slotText: slot ? slot.innerText.replace(/\s+/g, " ").slice(0, 200) : null,
    };
  });
  console.log("3D state:", JSON.stringify(threeD, null, 1));

  // Find probe with proper toast capture
  await page.click('.vsw-btn:has-text("Draw")');
  await page.waitForTimeout(400);
  await page.locator(".fs-search, .content input[placeholder]").first().fill("419 Prairie Ridge Ln").catch(() => {});
  await page.click('button:has-text("Find")');
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(700);
    const btnTxt = (await page.locator(".fs-find").textContent().catch(() => "")) || "";
    const toast = await page.locator(".fixed.bottom-6 [class*=paper-card], .fixed.bottom-6 > div > div").allTextContents();
    if (btnTxt.trim() !== "Find" || toast.length) { console.log(`find t+${(i + 1) * 0.7}s: btn="${btnTxt.trim()}" toast=${JSON.stringify(toast)}`); }
  }
  console.log("find final btn:", ((await page.locator(".fs-find").textContent().catch(() => "")) || "").trim());
  await page.screenshot({ path: "fence_probe.png", fullPage: true });
  await browser.close();
})().catch(e => { console.error("HARNESS FAIL:", e.message); process.exit(1); });
