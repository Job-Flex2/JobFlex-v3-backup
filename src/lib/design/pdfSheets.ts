"use client";
// The Home Design Studio's plan upload (2026-10-17): every sheet of the PDFs (and photos) the contractor dropped, with
// a thumbnail and a guess at which is the floor plan — then, for the one picked, its own lines and text for
// lib/design/planRead, and a picture of any part of it (the underlay, and the numbered plan the room names are read
// from). Browser-only; the plan never leaves the browser except as that one small picture.
import { readVectorSheet, layerRole, type VectorSheet } from "./pdfVector";
import type { SheetText } from "./planRead";
import { classifySheet, type SheetClass } from "./planSet";

export const MAX_SHEETS = 60;
export const MAX_FILE_BYTES = 120 * 1024 * 1024;
const THUMB_PX = 320;

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjs: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjs) {
    pdfjs = import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
      m.GlobalWorkerOptions.workerPort = new Worker(new URL("../plans/pdf.worker.ts", import.meta.url), { type: "module" });
      return m;
    });
    pdfjs.catch(() => {
      pdfjs = null;
    });
  }
  return pdfjs;
}

export type SheetRead = { sheet: VectorSheet; texts: SheetText[] };

export type DesignSheet = {
  key: string;
  fileName: string;
  /** Page inside its file (1-based). */
  page: number;
  kind: "pdf" | "image";
  thumb: string;
  /** Sheet size in points (an image: its pixels). */
  width: number;
  height: number;
  /** What the sheet calls itself, when it says. */
  title: string;
  /** How likely this is the floor plan (higher first). */
  score: number;
  /** Why it was suggested: "Floor plan · CAD layers". */
  hint: string;
  /** The file keeps CAD layers by name (walls, doors, windows). */
  layered: boolean;
  /** Its text (a PDF page), and what that text says it is: floor plans by title, rooms by label (lib/design/planSet). */
  texts?: SheetText[];
  cls?: SheetClass;
  /** Its lines and text (a PDF page only). */
  read?: () => Promise<SheetRead>;
  /** A JPEG of part of the sheet (points), long edge at most maxPx; scale = pixels per point. */
  picture: (region: { x: number; y: number; w: number; h: number } | null, maxPx: number) => Promise<{ url: string; scale: number; w: number; h: number }>;
};


async function pdfSheets(file: File, onPage?: () => void): Promise<DesignSheet[]> {
  const lib = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
  // The file's CAD layers, by name: a wall layer means every sheet can be read exactly.
  let layerNames: string[] = [];
  let cfg: Awaited<ReturnType<typeof doc.getOptionalContentConfig>> | null = null;
  try {
    cfg = await doc.getOptionalContentConfig();
    const order = (cfg.getOrder?.() ?? []) as unknown[];
    const flat = (xs: unknown[]): string[] => xs.flatMap((x) => (Array.isArray(x) ? flat(x) : typeof x === "string" ? [x] : (x as { order?: unknown[] })?.order ? flat((x as { order: unknown[] }).order) : []));
    layerNames = flat(order).map((id) => cfg?.getGroup(id)?.name ?? "").filter(Boolean);
  } catch {
    cfg = null;
  }
  const layered = layerNames.some((n) => layerRole(n) === "wall");
  const n = Math.min(doc.numPages, MAX_SHEETS);
  const out: DesignSheet[] = [];
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const texts: SheetText[] = [];
    for (const it of tc.items) {
      if (!("str" in it) || !it.str?.trim()) continue;
      const [x, y] = lib.Util.applyTransform([it.transform[4], it.transform[5]], vp.transform);
      texts.push({ str: it.str, x, y, h: Math.hypot(it.transform[2], it.transform[3]) });
    }
    // The floor plan by its drawing title and the rooms it labels — not by the words "floor plan" anywhere in its
    // notes (a spec page said that too, and came first).
    const cls = classifySheet(texts, vp.width, vp.height);
    const titleText = texts
      .filter((t) => (t.x >= vp.width * 0.6 && t.y >= vp.height * 0.7) || t.x >= vp.width * 0.86)
      .map((t) => t.str)
      .join(" ");
    const why = [cls.why, layered ? "CAD layers" : ""].filter(Boolean);
    const tvp = page.getViewport({ scale: THUMB_PX / Math.max(vp.width, vp.height) });
    const c = document.createElement("canvas");
    c.width = Math.round(tvp.width);
    c.height = Math.round(tvp.height);
    await page.render({ canvasContext: c.getContext("2d")!, viewport: tvp }).promise;
    const thumb = c.toDataURL("image/jpeg", 0.7);
    c.width = c.height = 0;
    onPage?.();
    out.push({
      key: `${file.name}#${i}`,
      fileName: file.name,
      page: i,
      kind: "pdf",
      thumb,
      width: vp.width,
      height: vp.height,
      title: (cls.plans[0]?.title ?? titleText.slice(0, 60)).trim(),
      score: cls.score,
      hint: why.join(" · "),
      layered,
      texts,
      cls,
      read: async () => {
        const ol = await page.getOperatorList();
        const sheet = readVectorSheet({
          fnArray: ol.fnArray,
          argsArray: ol.argsArray,
          OPS: lib.OPS as unknown as Record<string, number>,
          viewport: vp.transform as [number, number, number, number, number, number],
          width: vp.width,
          height: vp.height,
          layerName: (id) => cfg?.getGroup(id)?.name ?? "",
          // Hatching (thousands of strokes) and elevations are never the plan.
          skipLayer: (name) => {
            const r = layerRole(name);
            return r === "wallFill" || r === "elevation";
          },
        });
        return { sheet, texts };
      },
      picture: async (region, maxPx) => {
        const R = region ?? { x: 0, y: 0, w: vp.width, h: vp.height };
        const scale = Math.min(maxPx / Math.max(R.w, R.h), Math.sqrt(14_000_000 / (vp.width * vp.height)));
        const rvp = page.getViewport({ scale, offsetX: -R.x * scale, offsetY: -R.y * scale });
        const cc = document.createElement("canvas");
        cc.width = Math.max(1, Math.round(R.w * scale));
        cc.height = Math.max(1, Math.round(R.h * scale));
        const g = cc.getContext("2d")!;
        g.fillStyle = "#fff";
        g.fillRect(0, 0, cc.width, cc.height);
        await page.render({ canvasContext: g, viewport: rvp }).promise;
        const url = cc.toDataURL("image/jpeg", 0.82);
        const res = { url, scale, w: cc.width, h: cc.height };
        cc.width = cc.height = 0;
        return res;
      },
    });
  }
  return out;
}

async function imageSheet(file: File): Promise<DesignSheet> {
  const bmp = await createImageBitmap(file);
  const draw = (sx: number, sy: number, sw: number, sh: number, maxPx: number) => {
    const k = Math.min(1, maxPx / Math.max(sw, sh));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(sw * k));
    c.height = Math.max(1, Math.round(sh * k));
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", 0.82);
    const out = { url, scale: k, w: c.width, h: c.height };
    c.width = c.height = 0;
    return out;
  };
  return {
    key: `${file.name}#1`,
    fileName: file.name,
    page: 1,
    kind: "image",
    thumb: draw(0, 0, bmp.width, bmp.height, THUMB_PX).url,
    width: bmp.width,
    height: bmp.height,
    title: file.name.replace(/\.[^.]+$/, ""),
    score: 1,
    hint: "Photo or scan — trace it",
    layered: false,
    picture: async (region, maxPx) => {
      const R = region ?? { x: 0, y: 0, w: bmp.width, h: bmp.height };
      return draw(R.x, R.y, R.w, R.h, maxPx);
    },
  };
}

export class SheetFileError extends Error {}

/** Every sheet of the files dropped, the likeliest floor plan first. */
export async function openDesignFiles(files: File[], onPage?: () => void): Promise<{ sheets: DesignSheet[]; skipped: string[] }> {
  const sheets: DesignSheet[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    if (sheets.length >= MAX_SHEETS) {
      skipped.push(`${f.name} — the ${MAX_SHEETS}-sheet limit was reached`);
      continue;
    }
    if (f.size > MAX_FILE_BYTES) {
      skipped.push(`${f.name} — larger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB`);
      continue;
    }
    const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    try {
      if (isPdf) sheets.push(...(await pdfSheets(f, onPage)).slice(0, MAX_SHEETS - sheets.length));
      else if (f.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(f.name)) {
        sheets.push(await imageSheet(f));
        onPage?.();
      } else skipped.push(`${f.name} — not a PDF or an image`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skipped.push(`${f.name} — could not be opened${/password/i.test(msg) ? " (it is password-protected)" : ""}`);
    }
  }
  return { sheets, skipped };
}
