// Renders film-hvac.html frame by frame (every frame is a pure function of t) and
// encodes the landing's files with ffmpeg. No audio track: the landing plays it muted.
//   node render.js 169|916 [fps] [seconds]
//     169 → public/landing-e/hvac-demo-169.mp4 (H.264) + hvac-demo-169.webm (VP9) + hvac-demo-poster.webp (t = 24 s)
//     916 → public/landing-e/hvac-demo-916.mp4 (H.264)
// FFMPEG=<path to ffmpeg> when it is not on PATH; NODE_PATH must reach playwright-core.
const { chromium } = require("playwright-core");
const { execFileSync } = require("child_process");
const { pathToFileURL } = require("url");
const fs = require("fs");
const path = require("path");
const HERE = __dirname;
const PUB = path.resolve(HERE, "../../public/landing-e");
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const format = process.argv[2] || "169";
const fps = Number(process.argv[3] || 30);
const seconds = Number(process.argv[4] || 45);
const POSTER_T = 24;
const W = format === "916" ? 1080 : 1920;
const H = format === "916" ? 1920 : 1080;
const name = `hvac-demo-${format}`;
const dir = path.join(HERE, "frames", name);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const ff = (...args) => execFileSync(FFMPEG, ["-v", "error", "-y", ...args], { stdio: "inherit" });
// a bitrate that lands under the size cap: kbit/s for the whole clip, a little headroom
const kbps = (mb) => Math.floor((mb * 8 * 1024 * 0.94) / seconds);

(async () => {
  const b = await chromium.launch({ channel: "chrome", headless: true });
  const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(HERE, "film-hvac.html")).href + `?w=${W}&h=${H}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const frames = Math.round(seconds * fps);
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    await page.evaluate((tt) => window.__seek(tt), i / fps);
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(5, "0")}.png`) });
    if (i % 150 === 0) console.log(`${name}: frame ${i}/${frames} (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
  await b.close();
  fs.mkdirSync(PUB, { recursive: true });
  const input = ["-framerate", String(fps), "-i", path.join(dir, "f%05d.png")];
  const mp4 = path.join(PUB, `${name}.mp4`);
  const passlog = path.join(dir, "x264");
  // two passes at a fixed bitrate: the cap holds whatever the frames are
  ff(...input, "-c:v", "libx264", "-preset", "slow", "-b:v", `${kbps(6)}k`, "-pass", "1", "-passlogfile", passlog, "-pix_fmt", "yuv420p", "-an", "-f", "mp4", process.platform === "win32" ? "NUL" : "/dev/null");
  ff(...input, "-c:v", "libx264", "-preset", "slow", "-b:v", `${kbps(6)}k`, "-pass", "2", "-passlogfile", passlog, "-pix_fmt", "yuv420p", "-profile:v", "high", "-an", "-movflags", "+faststart", mp4);
  console.log("wrote", mp4, (fs.statSync(mp4).size / 1048576).toFixed(2), "MB");
  if (format === "169") {
    const webm = path.join(PUB, `${name}.webm`);
    const vplog = path.join(dir, "vp9");
    ff(...input, "-c:v", "libvpx-vp9", "-b:v", `${kbps(4)}k`, "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", "-pass", "1", "-passlogfile", vplog, "-pix_fmt", "yuv420p", "-an", "-f", "webm", process.platform === "win32" ? "NUL" : "/dev/null");
    ff(...input, "-c:v", "libvpx-vp9", "-b:v", `${kbps(4)}k`, "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", "-pass", "2", "-passlogfile", vplog, "-pix_fmt", "yuv420p", "-an", webm);
    console.log("wrote", webm, (fs.statSync(webm).size / 1048576).toFixed(2), "MB");
    const poster = path.join(PUB, "hvac-demo-poster.webp");
    ff("-i", path.join(dir, `f${String(Math.round(POSTER_T * fps)).padStart(5, "0")}.png`), "-c:v", "libwebp", "-quality", "82", poster);
    console.log("wrote", poster, (fs.statSync(poster).size / 1024).toFixed(0), "KB");
  }
  fs.rmSync(dir, { recursive: true, force: true });
})().catch((e) => { console.error("RENDER ERROR", e.message.split("\n")[0]); process.exit(1); });
