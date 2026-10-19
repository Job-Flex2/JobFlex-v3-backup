// Stills from the film at chosen seconds, both formats, to check the composition.
//   node preview.js "2,6,10,16,20,24,28,34,40,44"   → frames/pv-<916|169>-<t>.png
//   PHONE=1 node preview.js …                        → also each 9:16 still at 390 px wide (frames/pv-916-<t>-390.png; FFMPEG=<path> if not on PATH)
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { execFileSync } = require("child_process");
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const HERE = __dirname;
const times = (process.argv[2] || "1,3,4.6,7,9.5,11,14,16.8,19.5,23,24,25.5,28,31.5,34.5,36.5,40,43.5").split(",").map(Number);
const url = (W, H, t) => pathToFileURL(path.join(HERE, "film-hvac.html")).href + `?w=${W}&h=${H}&t=${t}`;
(async () => {
  fs.mkdirSync(path.join(HERE, "frames"), { recursive: true });
  const b = await chromium.launch({ channel: "chrome", headless: true });
  for (const [W, H, fmt] of [[1080, 1920, "916"], [1920, 1080, "169"]]) {
    const page = await b.newPage({ viewport: { width: W, height: H } });
    const errs = []; page.on("pageerror", (e) => errs.push(e.message.split("\n")[0]));
    await page.goto(url(W, H, 0), { waitUntil: "load" });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    for (const t of times) {
      await page.evaluate((tt) => window.__seek(tt), t);
      const out = path.join(HERE, "frames", `pv-${fmt}-${t.toFixed(1).padStart(4, "0")}.png`);
      await page.screenshot({ path: out });
      // the 9:16 still as a 390-px-wide phone shows it (Lanczos, like a browser's downscale)
      if (process.env.PHONE && fmt === "916") execFileSync(FFMPEG, ["-v", "error", "-y", "-i", out, "-vf", "scale=390:-1:flags=lanczos", out.replace(/\.png$/, "-390.png")]);
    }
    if (errs.length) console.log(fmt, "errors:", errs.slice(0, 3).join(" | "));
    await page.close();
  }
  await b.close();
  console.log("stills done");
})().catch((e) => { console.error("PREVIEW ERROR", e.message.split("\n")[0]); process.exit(1); });
