// Screenshot harness: logs into the local JobFlex dev server and captures
// full-page shots of the given routes. Usage: node shot.js /dashboard [/more...]
// The server under test: QA_BASE_URL, else localhost:QA_PORT (default 3000) — see ./_qa.js.
const QA_BASE = require("../../tests/_lib/_qa").BASE;
const { chromium } = require("playwright");
const { launch, signIn } = require("../../tests/_lib/_qa");

(async () => {
  const routes = process.argv.slice(2);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1728, height: 1000 } });

  // Login once (session cookie persists in the context).
  await signIn(page);
  await page.waitForTimeout(1500);

  for (const r of routes) {
    await page.goto(QA_BASE + r, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200); // let reveal animations settle
    const name = r.replace(/[\/?=]+/g, "_").replace(/^_+|_+$/g, "") || "root";
    await page.screenshot({ path: name + ".png", fullPage: false });
    console.log("saved", name + ".png", "title:", await page.title());
  }
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
