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

export function baselinePath(id: string): string {
  const [viewport, role, slug] = id.split("--");
  return path.join(BASELINES_DIR, viewport, role, `${slug}.png`);
}

/** The screenshot, steadied: animations off, the caret hidden, volatile parts invisible. */
export async function steadyShot(page: Page, file: string): Promise<void> {
  const hide = qaConfig().visual.hide.join(", ");
  await page.addStyleTag({ content: `*, *::before, *::after { caret-color: transparent !important; transition: none !important; animation: none !important; } ${hide} { visibility: hidden !important; }` }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(400);
  const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0)).catch(() => 0);
  const vp = page.viewportSize() ?? { width: 390, height: 844 };
  const height = Math.max(vp.height, Math.min(h || vp.height, MAX_SHOT_HEIGHT));
  await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: 0, width: vp.width, height }, mask: masks(page), animations: "disabled", timeout: 60_000 });
}

export type VisualResult = { id: string; baseline?: string; actual: string; diff?: string; ratio?: number; created?: boolean; sizeChanged?: boolean; note?: string };

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
  } else {
    // within the threshold: keep nothing but the record
    fs.rmSync(dir, { recursive: true, force: true });
    res.baseline = undefined;
    res.actual = base;
  }
  if (sizeChanged) res.note = `size ${a.width}×${a.height} → ${b.width}×${b.height}`;
  return res;
}
