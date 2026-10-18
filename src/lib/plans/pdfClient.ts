"use client";
// Browser-only: a plan set (PDF, or photos/scans of sheets) opened in the contractor's
// browser. Each page is rendered here and sent to the reader one sheet at a time, so a
// 60 MB plan set never has to travel to the server whole (Vercel takes ~4.5 MB a
// request). Per page:
//   · its text layer (pdf.js getTextContent) — every dimension string of a CAD export,
//     with positions; empty for a scan
//   · an overview JPEG of the whole sheet, long edge OVERVIEW_PX
//   · four close-up tiles (quarters) when the page has little or no text — the model
//     downsizes an image to ~768 px on its short side, so a whole 24×36 sheet alone
//     would turn 1/8" dimension text into a few pixels
//   · a small thumbnail for the page picker
import type { TextItem } from "./readPrompt";

export const MAX_PLAN_PAGES = 60;
export const MAX_PLAN_FILE_BYTES = 120 * 1024 * 1024;
const OVERVIEW_PX = 1800;
const THUMB_PX = 260;
/**
 * The vision model shrinks every image until its SHORT side is 768 px, so what decides
 * how small a letter it can read is how much sheet a close-up's short side covers — not
 * how many pixels we send. Close-ups of about nine inches of sheet put 1/8" dimension
 * text near 10 px: a 4 × 3 grid on a 36" × 24" set, 3 × 2 on 24" × 18", quarters below.
 */
const MODEL_SHORT_PX = 768;
const TILE_INCHES = 9;
const OVERLAP = 0.06;

/** The close-up grid [across, down] for a sheet of this size (a photo: quarters). */
export function tileGrid(widthIn: number | null, heightIn: number | null): [number, number] {
  if (!widthIn || !heightIn) return [2, 2];
  const long = Math.max(widthIn, heightIn);
  const short = Math.min(widthIn, heightIn);
  const a = Math.min(4, Math.max(2, Math.round(long / TILE_INCHES)));
  const d = Math.min(3, Math.max(2, Math.round(short / TILE_INCHES)));
  return widthIn >= heightIn ? [a, d] : [d, a];
}
/** A page with fewer text items than this gets close-up tiles (a scan, or an image-only export). */
const THIN_TEXT = 60;

export type PlanPage = {
  /** 1-based across everything the contractor added. */
  page: number;
  fileName: string;
  /** Page number inside its own file. */
  filePage: number;
  thumb: string;
  textItems: TextItem[];
  /** Joined text, for the local page classifier. */
  text: string;
  /** The title block's words (bottom right, or a strip down the right edge) — what the sheet calls itself. */
  titleText: string;
  widthIn: number | null;
  heightIn: number | null;
  /**
   * Rendered on demand. `light`: the overview and four close-ups instead of a full grid —
   * for a sheet with nothing small to measure (an elevation, a section, structural notes).
   */
  render: (opts?: { light?: boolean }) => Promise<RenderedSheet>;
  /**
   * A first look: the sheet small, then its four quarters at the size the model reads them
   * (about 64 px an inch on a 36 × 24 sheet) — drawing titles, schedule heads and notes
   * legible enough to say what is on the sheet, without the full close-ups.
   */
  glance: () => Promise<string[]>;
};

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjs: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjs) {
    // The legacy build runs on older Safari; the worker is our own module so the
    // bundler (Turbopack or webpack) emits it beside the page.
    pdfjs = import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
      m.GlobalWorkerOptions.workerPort = new Worker(new URL("./pdf.worker.ts", import.meta.url), { type: "module" });
      return m;
    });
    pdfjs.catch(() => {
      pdfjs = null;
    });
  }
  return pdfjs;
}

function canvasJpeg(c: HTMLCanvasElement, quality = 0.72): string {
  return c.toDataURL("image/jpeg", quality);
}

/* EVERY SHEET IS DRAWN HERE — and it keeps drawing with the tab in the back (owner,
   2026-10-17: the Eagle Ridge set stalled "no new sheet has finished reading for
   three minutes"). pdf.js paints a "display" render one animation frame at a time, and
   a browser runs no animation frames in a background tab or a covered window: the
   plans read only while someone watched them (a set that reads in three minutes in
   front took an hour of switching tabs). The "print" intent paints without frames; its
   pauses are handed to a MessageChannel — a task a background tab still runs, unlike a
   timer, which it slows to once a minute — so the page answers between chunks in front
   and the reading goes on behind. The layers are drawn as the sheet PLOTS (a CAD
   layer marked no-plot stays off — the printed sheet is the drawing the architect
   issued; pdf.js will not mix a print draw with the on-screen layer state). A draw
   that has not finished in DRAW_LIMIT_MS is cancelled and throws: the reader's own
   retry takes the sheet again instead of one slot hanging for good. */
const DRAW_LIMIT_MS = 120_000;

let yieldPort: { post: (fn: () => void) => void } | null = null;
function nextTask(fn: () => void) {
  if (!yieldPort) {
    const ch = new MessageChannel();
    const waiting: Array<() => void> = [];
    ch.port1.onmessage = () => waiting.shift()?.();
    yieldPort = {
      post: (f) => {
        waiting.push(f);
        ch.port2.postMessage(0);
      },
    };
  }
  yieldPort.post(fn);
}

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>["getPage"]>>;

async function drawPage(page: PdfPage, canvasContext: CanvasRenderingContext2D, viewport: ReturnType<PdfPage["getViewport"]>): Promise<void> {
  const task = page.render({ canvasContext, viewport, intent: "print" });
  task.onContinue = (cont: () => void) => nextTask(cont);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      task.cancel();
      reject(new Error("This sheet took too long to draw."));
    }, DRAW_LIMIT_MS);
  });
  try {
    await Promise.race([task.promise, limit]);
  } finally {
    clearTimeout(timer);
  }
}

function scaledCanvas(src: CanvasImageSource, sw: number, sh: number, maxPx: number, sx = 0, sy = 0, cw = sw, ch = sh): HTMLCanvasElement {
  const k = Math.min(1, maxPx / Math.max(cw, ch));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(cw * k));
  c.height = Math.max(1, Math.round(ch * k));
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, sx, sy, cw, ch, 0, 0, c.width, c.height);
  return c;
}

export type RenderedSheet = { overview: string; tiles: string[]; grid: [number, number] | null };

/** What a first look sends: the whole sheet at 1,024 px, then its quarters. */
const GLANCE_PX = 1024;

/** The sheet small, then its four quarters (each at the model's 768 px short side). */
function glanceImages(big: HTMLCanvasElement): string[] {
  const W = big.width;
  const H = big.height;
  const { tiles } = overviewAndTiles(big, [2, 2]);
  return [canvasJpeg(scaledCanvas(big, W, H, GLANCE_PX), 0.6), ...tiles];
}

/** Whole sheet + overlapping close-ups in a grid, in reading order, from one big canvas. */
function overviewAndTiles(big: HTMLCanvasElement, grid: [number, number] | null): RenderedSheet {
  const W = big.width;
  const H = big.height;
  const overview = canvasJpeg(scaledCanvas(big, W, H, OVERVIEW_PX));
  if (!grid) return { overview, tiles: [], grid: null };
  const [cols, rows] = grid;
  const tw = W / cols + W * OVERLAP;
  const th = H / rows + H * OVERLAP;
  const tiles: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      // Each tile reaches past its cell by half the overlap on every side, kept on the sheet.
      const sx = Math.max(0, Math.min(W - tw, (W / cols) * k - (W * OVERLAP) / 2));
      const sy = Math.max(0, Math.min(H - th, (H / rows) * r - (H * OVERLAP) / 2));
      // Sent at the size the model reads it: short side 768 px (long side at most 2048).
      const k2 = Math.min(1, MODEL_SHORT_PX / Math.min(tw, th), 2048 / Math.max(tw, th));
      tiles.push(canvasJpeg(scaledCanvas(big, W, H, Math.max(tw, th) * k2, sx, sy, tw, th), 0.75));
    }
  }
  return { overview, tiles, grid };
}

async function pdfPages(file: File, start: number, onPage?: () => void): Promise<PlanPage[]> {
  const lib = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
  const n = Math.min(doc.numPages, MAX_PLAN_PAGES);
  const out: PlanPage[] = [];
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const textItems: TextItem[] = [];
    for (const it of tc.items) {
      if (!("str" in it) || !it.str || !it.str.trim()) continue;
      textItems.push({ str: it.str, x: it.transform[4], y: it.transform[5] });
    }
    const thumbScale = THUMB_PX / Math.max(vp1.width, vp1.height);
    const tvp = page.getViewport({ scale: thumbScale });
    const tc2 = document.createElement("canvas");
    tc2.width = Math.round(tvp.width);
    tc2.height = Math.round(tvp.height);
    const tg = tc2.getContext("2d")!;
    tg.fillStyle = "#fff";
    tg.fillRect(0, 0, tc2.width, tc2.height);
    // A thumbnail that will not draw stays blank — the set still opens; its read retries.
    await drawPage(page, tg, tvp).catch(() => undefined);
    const thin = textItems.length < THIN_TEXT;
    // The title block: the bottom-right corner, or a vertical strip down the right edge.
    const titleText = textItems
      .filter((t) => (t.x >= vp1.width * 0.6 && t.y <= vp1.height * 0.3) || t.x >= vp1.width * 0.86)
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map((t) => t.str)
      .join(" ");
    onPage?.();
    out.push({
      page: start + i,
      fileName: file.name,
      filePage: i,
      thumb: canvasJpeg(tc2, 0.6),
      textItems,
      text: textItems.map((t) => t.str).join(" "),
      titleText,
      widthIn: Math.round((vp1.width / 72) * 10) / 10,
      heightIn: Math.round((vp1.height / 72) * 10) / 10,
      glance: async () => {
        // Each quarter's short side at the model's 768 px: about 64 px an inch on a 36 × 24
        // sheet — ¼" drawing titles at 16 px, ⅛" notes at 8.
        const wIn = vp1.width / 72;
        const hIn = vp1.height / 72;
        const ppi = Math.min(110, Math.max(48, (MODEL_SHORT_PX / (Math.min(wIn, hIn) / 2)) * 1.05));
        const vp = page.getViewport({ scale: ppi / 72 });
        const c = document.createElement("canvas");
        c.width = Math.round(vp.width);
        c.height = Math.round(vp.height);
        const g = c.getContext("2d")!;
        g.fillStyle = "#fff";
        g.fillRect(0, 0, c.width, c.height);
        await drawPage(page, g, vp);
        const out = glanceImages(c);
        c.width = c.height = 0;
        return out;
      },
      render: async (opts) => {
        // A scan, or CAD lettering drawn as lines (no text layer), needs the close-ups — and
        // so does any big sheet: a text layer often carries only a table while the notes
        // beside it are drawn. A letter-size page with text is read from its text.
        const wIn = vp1.width / 72;
        const hIn = vp1.height / 72;
        const full = thin || Math.max(wIn, hIn) >= 17 ? tileGrid(wIn, hIn) : null;
        // A light read: four close-ups (quarters) are enough for notes and larger lettering.
        const grid: [number, number] | null = full && opts?.light ? [2, 2] : full;
        // Sharp enough that each close-up's short side has its 768 px, and no bigger than a
        // phone's canvas allows (~16 megapixels).
        const tileShortIn = grid ? Math.min(wIn / grid[0], hIn / grid[1]) * (1 + OVERLAP) : 12;
        const ppi = Math.min(150, Math.max(72, (MODEL_SHORT_PX / tileShortIn) * 1.1), Math.sqrt(15_000_000 / (wIn * hIn)));
        const vp = page.getViewport({ scale: ppi / 72 });
        const c = document.createElement("canvas");
        c.width = Math.round(vp.width);
        c.height = Math.round(vp.height);
        const g = c.getContext("2d")!;
        g.fillStyle = "#fff";
        g.fillRect(0, 0, c.width, c.height);
        await drawPage(page, g, vp);
        const r = overviewAndTiles(c, grid);
        c.width = c.height = 0; // free the big bitmap now
        return r;
      },
    });
  }
  return out;
}

async function imagePage(file: File, start: number): Promise<PlanPage> {
  const bmp = await createImageBitmap(file);
  const thumb = canvasJpeg(scaledCanvas(bmp, bmp.width, bmp.height, THUMB_PX), 0.6);
  return {
    page: start + 1,
    fileName: file.name,
    filePage: 1,
    thumb,
    textItems: [],
    text: "",
    titleText: "",
    widthIn: null,
    heightIn: null,
    glance: async () => [canvasJpeg(scaledCanvas(bmp, bmp.width, bmp.height, GLANCE_PX), 0.6)],
    render: async () => {
      // A photo of a sheet: quarters, from the photo at up to 3,000 px.
      const c = scaledCanvas(bmp, bmp.width, bmp.height, 3000);
      return overviewAndTiles(c, [2, 2]);
    },
  };
}

export class PlanFileError extends Error {}

/** Open every file the contractor dropped (PDFs and images), as one numbered set of pages. */
export async function openPlanFiles(files: File[], onPage?: () => void): Promise<{ pages: PlanPage[]; skipped: string[] }> {
  const pages: PlanPage[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    if (pages.length >= MAX_PLAN_PAGES) {
      skipped.push(`${f.name} — the ${MAX_PLAN_PAGES}-page limit was reached`);
      continue;
    }
    if (f.size > MAX_PLAN_FILE_BYTES) {
      skipped.push(`${f.name} — larger than ${Math.round(MAX_PLAN_FILE_BYTES / 1024 / 1024)} MB`);
      continue;
    }
    const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    try {
      if (isPdf) pages.push(...(await pdfPages(f, pages.length, onPage)).slice(0, MAX_PLAN_PAGES - pages.length));
      else if (f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(f.name)) {
        pages.push(await imagePage(f, pages.length));
        onPage?.();
      }
      else skipped.push(`${f.name} — not a PDF or an image`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skipped.push(`${f.name} — could not be opened${/password/i.test(msg) ? " (it is password-protected)" : ""}`);
    }
  }
  return { pages, skipped };
}
