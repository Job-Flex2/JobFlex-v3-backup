// Renders film-demo.html frame by frame (every frame is a function of t) and encodes the hvac2
// landing's files with ffmpeg. No audio track: the landing plays them muted.
//   node render-demo.js 16x9|4x5
//     → out/hvac-demo-<fmt>-master.mkv   the lossless render (FFV1), kept out of git
//     → ../../public/landing-e/hvac-demo-<fmt>.mp4 (H.264 High, two-pass under the cap, +faststart)
//       + hvac-demo-<fmt>.webm (VP9, two-pass) + hvac-demo-poster-<fmt>.webp (the equipment step)
//     → frames/<fmt>/tNN.jpg, one frame of the MP4 at every whole second
// FFMPEG=<path to ffmpeg> when it is not on PATH; NODE_PATH must reach playwright-core.
const { chromium } = require("playwright-core");
const { execFileSync } = require("child_process");
const { pathToFileURL } = require("url");
const fs = require("fs");
const path = require("path");
const HERE = __dirname;
const PUB = path.resolve(HERE, "../../public/landing-e");
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const FMT = process.argv[2] === "4x5" ? "4x5" : "16x9";
const FPS = 30;
const W = FMT === "4x5" ? 1080 : 1920, H = FMT === "4x5" ? 1350 : 1080;
// the caps (decimal megabytes / kilobytes, so they hold however they are counted)
const CAP = FMT === "4x5" ? { mp4: 4e6, webm: 3e6, poster: 50e3 } : { mp4: 5e6, webm: 3.5e6, poster: 60e3 };
const NUL = process.platform === "win32" ? "NUL" : "/dev/null";
const OUT = path.join(HERE, "out");
const dir = path.join(OUT, `frames-${FMT}`);
const ff = (...args) => execFileSync(FFMPEG, ["-v", "error", "-y", ...args], { stdio: "inherit" });

(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--allow-file-access-from-files"] });
  const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message.split("\n")[0]));
  await page.goto(pathToFileURL(path.join(HERE, "film-demo.html")).href + `?fmt=${FMT}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const dur = await page.evaluate(() => window.__duration);
  const frames = Math.round(dur * FPS);
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    await page.evaluate((tt) => window.__seek(tt), i / FPS);
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(5, "0")}.png`) });
    if (i % 300 === 0) console.log(`${FMT}: frame ${i}/${frames} (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
  // where the poster comes from: the equipment step (the unit picked, its price), once the page is still
  // (the desktop 1.6 s in, the pointer on the pick; the phone 0.95 s in, between two swipes, no finger)
  const tape = JSON.parse(fs.readFileSync(path.join(HERE, "rec", FMT, "tape.json"), "utf8"));
  let off = 0; const at = {};
  for (const n of tape.order) { for (const m of tape.segs[n].marks) at[m.id] = off + m.t; off += tape.segs[n].dur; }
  await b.close();
  if (errs.length) console.log("page errors:", errs.slice(0, 3).join(" | "));
  const seconds = frames / FPS;
  const input = ["-framerate", String(FPS), "-i", path.join(dir, "f%05d.png")];

  // the lossless master (FFV1 in Matroska, full RGB), for re-encodes without a re-render
  const master = path.join(OUT, `hvac-demo-${FMT}-master.mkv`);
  ff(...input, "-c:v", "ffv1", "-level", "3", "-pix_fmt", "bgr0", "-an", master);
  console.log("wrote", master, (fs.statSync(master).size / 1e6).toFixed(1), "MB");

  // a bitrate that lands under the cap: bits for the clip, 6 % headroom for the container and the pass error
  const kbps = (bytes) => Math.floor((bytes * 8 * 0.94) / seconds / 1000);
  fs.mkdirSync(PUB, { recursive: true });
  const mp4 = path.join(PUB, `hvac-demo-${FMT}.mp4`), webm = path.join(PUB, `hvac-demo-${FMT}.webm`);
  const x264 = path.join(dir, "x264"), vp9 = path.join(dir, "vp9");
  const h = ["-c:v", "libx264", "-preset", "veryslow", "-tune", "animation", "-b:v", `${kbps(CAP.mp4)}k`, "-passlogfile", x264, "-pix_fmt", "yuv420p", "-profile:v", "high", "-r", String(FPS), "-an", "-map_metadata", "-1"];
  ff(...input, ...h, "-pass", "1", "-f", "mp4", NUL);
  ff(...input, ...h, "-pass", "2", "-movflags", "+faststart", mp4);
  console.log("wrote", mp4, fs.statSync(mp4).size, "B", `(${kbps(CAP.mp4)} kbit/s)`);
  const v = ["-c:v", "libvpx-vp9", "-b:v", `${kbps(CAP.webm)}k`, "-passlogfile", vp9, "-deadline", "good", "-cpu-used", "1", "-row-mt", "1", "-tile-columns", "2", "-pix_fmt", "yuv420p", "-r", String(FPS), "-an", "-map_metadata", "-1"];
  ff(...input, ...v, "-pass", "1", "-f", "webm", NUL);
  ff(...input, ...v, "-pass", "2", webm);
  console.log("wrote", webm, fs.statSync(webm).size, "B", `(${kbps(CAP.webm)} kbit/s)`);

  // the poster: the best WebP quality that keeps under its cap
  const posterT = (at["05"] ?? 18) + (FMT === "4x5" ? 0.95 : 1.6);
  const still = path.join(dir, `f${String(Math.round(posterT * FPS)).padStart(5, "0")}.png`);
  const poster = path.join(PUB, `hvac-demo-poster-${FMT}.webp`);
  let q = 90;
  for (; q >= 20; q -= 5) { ff("-i", still, "-c:v", "libwebp", "-quality", String(q), "-compression_level", "6", poster); if (fs.statSync(poster).size <= CAP.poster) break; }
  console.log("wrote", poster, fs.statSync(poster).size, "B", `(q${q}, t=${posterT.toFixed(2)} s)`);

  // one frame of the delivered MP4 at every whole second, to look at
  const fdir = path.join(HERE, "frames", FMT);
  fs.rmSync(fdir, { recursive: true, force: true });
  fs.mkdirSync(fdir, { recursive: true });
  for (let s = 0; s < Math.ceil(seconds); s++) ff("-ss", String(s), "-i", mp4, "-frames:v", "1", "-vf", `scale=${FMT === "4x5" ? 540 : 960}:-2:flags=lanczos`, "-q:v", "3", path.join(fdir, `t${String(s).padStart(2, "0")}.jpg`));
  fs.writeFileSync(path.join(OUT, `plates-${FMT}.json`), JSON.stringify({ duration: seconds, at }, null, 1));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(FMT, "done:", seconds.toFixed(2), "s");
})().catch((e) => { console.error("RENDER ERROR", e.message.split("\n")[0]); process.exit(1); });
