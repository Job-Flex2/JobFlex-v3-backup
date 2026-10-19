// Stills from the demo film at chosen seconds, to check the composition.
//   node preview-demo.js 16x9|4x5 "1,4,8,…"   → frames/pv-<fmt>-<t>.png
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const HERE = __dirname;
const FMT = process.argv[2] === "4x5" ? "4x5" : "16x9";
const W = FMT === "4x5" ? 1080 : 1920, H = FMT === "4x5" ? 1350 : 1080;
(async () => {
  fs.mkdirSync(path.join(HERE, "frames"), { recursive: true });
  const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--allow-file-access-from-files"] });
  const page = await b.newPage({ viewport: { width: W, height: H } });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message.split("\n")[0]));
  await page.goto(pathToFileURL(path.join(HERE, "film-demo.html")).href + `?fmt=${FMT}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const dur = await page.evaluate(() => window.__duration);
  const times = process.argv[3] ? process.argv[3].split(",").map(Number) : Array.from({ length: Math.ceil(dur) }, (_, i) => i);
  for (const t of times) {
    await page.evaluate((tt) => window.__seek(tt), t);
    await page.screenshot({ path: path.join(HERE, "frames", `pv-${FMT}-${t.toFixed(1).padStart(4, "0")}.png`) });
  }
  if (errs.length) console.log("errors:", errs.slice(0, 3).join(" | "));
  console.log(FMT, "duration", dur.toFixed(2), "s · stills", times.length);
  await b.close();
})().catch((e) => { console.error("PREVIEW ERROR", e.message.split("\n")[0]); process.exit(1); });
