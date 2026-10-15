// The server under test: QA_BASE_URL, else localhost:QA_PORT (default 3000) — see ./_qa.js.
const QA_BASE = require("../_lib/_qa").BASE;
const { chromium } = require("playwright");
const { launch, signIn, withWorld } = require("../_lib/_qa");
const log = (ok, name, extra = "") => console.log((ok ? "PASS" : "FAIL") + " | " + name + (extra ? " | " + extra : ""));
withWorld(async (world) => {
  const b = await launch();
  const p = await b.newPage({ viewport: { width: 1728, height: 1000 } });
  await signIn(p);
  await p.goto(QA_BASE + "/dashboard/reviews", { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);

  const cardVisible = () => p.locator("text=Great crew, clean site").count();
  await p.locator('.rv-chip[data-f="5"]').click();
  await p.waitForTimeout(400);
  log((await cardVisible()) > 0, "chips: 5-star filter keeps the review");
  await p.locator('.rv-chip[data-f="1"]').click(); // empty but clickable
  await p.waitForTimeout(400);
  const hidden = (await cardVisible()) === 0;
  const emptyMsg = await p.locator("#rvEmpty:visible, .rv-empty:visible").count();
  log(hidden, "chips: 1-star filter hides it", "emptyState=" + emptyMsg);
  await p.locator('.rv-chip[data-f="ALL"]').click();
  await p.waitForTimeout(400);
  log((await cardVisible()) > 0, "chips: All restores");
  await b.close();
}, { review: true }).catch((e) => { console.error("HARNESS FAIL:", e.message); process.exit(1); });
