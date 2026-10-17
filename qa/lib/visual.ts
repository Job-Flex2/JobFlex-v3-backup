// VISUAL BASELINES. One PNG per page × viewport × role in qa/baselines/; the first run makes it,
// later runs compare pixel by pixel (pixelmatch). A difference over the threshold leaves the
// three pictures — before / after / diff — in qa/runs/<run>/baselines-diff/<id>/ for the
// analysis, and `npm run qa:accept -- <id>` makes "after" the new baseline.
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import type { Page } from "@playwright/test";
import { BASELINES_DIR, runDir } from "./env";
import { qaConfig } from "./config";
import { masks } from "./fixtures";

export const MAX_SHOT_HEIGHT = 3000;

export function visualId(viewport: string, role: string, urlPath: string): string {
  const slug = urlPath.replace(/^\/+/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "home";
  return `${viewport}--${role}--${slug}`;
}

/** A production build draws differently from `next dev` (no dev badge, other chunks and fonts
 *  timing): its baselines live apart, in qa/baselines/prod/, and are never compared with dev's. */
export function baselinePath(id: string, server = process.env.QA_SERVER_KIND): string {
  const [viewport, role, slug] = id.split("--");
  return path.join(BASELINES_DIR, ...(server === "prod" ? ["prod"] : []), viewport, role, `${slug}.png`);
}

/** The screenshot, steadied: animations off, the caret hidden, volatile parts invisible. */
export async function steadyShot(page: Page, file: string): Promise<void> {
  const hide = qaConfig().visual.hide.join(", ");
  await page.addStyleTag({ content: `*, *::before, *::after { caret-color: transparent !important; transition: none !important; animation: none !important; } ${hide} { visibility: hidden !important; }` }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  // a page that fetches after it loads ("Loading recorded experiment results…") is pictured when it is done
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  // Text that changes by itself between two runs of the same day — "17m ago", "Oct 17", "9:00 AM",
  // "Good evening" — is made invisible in place (its box stays, so the layout is the same): a
  // baseline compares the page, not the clock (2026-10-17: such words were most visual "findings").
  await page.evaluate(() => {
    const VOLATILE = [
      /\b\d+\s?(?:s|m|h|d|w|mo|min|mins|minutes?|hrs?|hours?|days?|weeks?|months?)\s+ago\b/i,
      /\b(?:just now|yesterday|today|tomorrow)\b/i,
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b/i,
      /\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:AM|PM)?\b/i,
      /\bgood (?:morning|afternoon|evening)\b/i,
      /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
      /\b20\d\d-\d\d-\d\d\b/,
    ];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hits: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n as Text;
      if (t.data.trim() && VOLATILE.some((r) => r.test(t.data)) && !t.parentElement?.closest("script, style")) hits.push(t);
    }
    for (const t of hits) {
      const span = document.createElement("span");
      span.style.visibility = "hidden";
      span.setAttribute("data-qa-volatile", "");
      t.replaceWith(span);
      span.appendChild(t);
    }
  }).catch(() => {});
  await page.waitForTimeout(400);
  const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0)).catch(() => 0);
  const vp = page.viewportSize() ?? { width: 390, height: 844 };
  const height = Math.max(vp.height, Math.min(h || vp.height, MAX_SHOT_HEIGHT));
  await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: 0, width: vp.width, height }, mask: masks(page), animations: "disabled", timeout: 60_000 });
}

/** box: where the changed pixels are (x, y, width, height), for "one change on many pages" (analyze/group.ts). */
export type VisualResult = { id: string; baseline?: string; actual: string; diff?: string; ratio?: number; created?: boolean; sizeChanged?: boolean; note?: string; box?: { x: number; y: number; w: number; h: number } };

/** The bounding box of pixelmatch's red (changed) pixels. */
function changedBox(img: PNG): VisualResult["box"] {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i] === 255 && img.data[i + 1] === 0 && img.data[i + 2] === 0) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? undefined : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Compares the shot with its baseline; creates the baseline when there is none. */
export async function compare(id: string, actualFile: string): Promise<VisualResult> {
  const dir = path.join(runDir(), "baselines-diff", id);
  fs.mkdirSync(dir, { recursive: true });
  const after = path.join(dir, "after.png");
  fs.copyFileSync(actualFile, after);
  const base = baselinePath(id);
  if (!fs.existsSync(base)) {
    fs.mkdirSync(path.dirname(base), { recursive: true });
    fs.copyFileSync(actualFile, base);
    return { id, actual: after, created: true, note: "first run — baseline created" };
  }
  const before = path.join(dir, "before.png");
  fs.copyFileSync(base, before);
  const a = PNG.sync.read(fs.readFileSync(base));
  const b = PNG.sync.read(fs.readFileSync(actualFile));
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const crop = (img: PNG) => {
    if (img.width === width && img.height === height) return img.data;
    const out = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) img.data.copy(out, y * width * 4, y * img.width * 4, y * img.width * 4 + width * 4);
    return out;
  };
  const diff = new PNG({ width, height });
  const { default: pixelmatch } = (await import("pixelmatch")) as { default: (a: Uint8Array, b: Uint8Array, out: Uint8Array | null, w: number, h: number, o?: { threshold?: number; includeAA?: boolean }) => number };
  const changed = pixelmatch(crop(a), crop(b), diff.data, width, height, { threshold: qaConfig().visual.pixelThreshold, includeAA: false });
  const sizeChanged = a.width !== b.width || a.height !== b.height;
  // Height that appeared or disappeared counts as changed pixels.
  const extra = Math.abs(a.width * a.height - b.width * b.height);
  const ratio = (changed + extra) / Math.max(a.width * a.height, b.width * b.height);
  const res: VisualResult = { id, baseline: before, actual: after, ratio, sizeChanged };
  if (ratio > qaConfig().visual.maxDiffRatio) {
    const diffFile = path.join(dir, "diff.png");
    fs.writeFileSync(diffFile, PNG.sync.write(diff));
    res.diff = diffFile;
    res.box = changedBox(diff);
  } else {
    // within the threshold: keep nothing but the record
    fs.rmSync(dir, { recursive: true, force: true });
    res.baseline = undefined;
    res.actual = base;
  }
  if (sizeChanged) res.note = `size ${a.width}×${a.height} → ${b.width}×${b.height}`;
  return res;
}
