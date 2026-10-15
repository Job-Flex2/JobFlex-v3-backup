// Small PNGs for the model and for the self-contained report.html: box-averaged down to a width,
// cut at a height. pngjs only — no native image library.
import { PNG } from "pngjs";

export function shrinkPng(buf: Buffer, maxWidth: number, maxHeight: number): Buffer {
  const src = PNG.sync.read(buf);
  const scale = Math.min(1, maxWidth / src.width);
  const w = Math.max(1, Math.round(src.width * scale));
  const fullH = Math.round(src.height * scale);
  const h = Math.max(1, Math.min(fullH, maxHeight));
  if (scale === 1 && h === src.height) return buf;
  const out = new PNG({ width: w, height: h });
  const step = 1 / scale;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * step), y1 = Math.min(src.height, Math.max(y0 + 1, Math.floor((y + 1) * step)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * step), x1 = Math.min(src.width, Math.max(x0 + 1, Math.floor((x + 1) * step)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * src.width + xx) * 4;
        r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; a += src.data[i + 3]; n++;
      }
      const o = (y * w + x) * 4;
      out.data[o] = r / n; out.data[o + 1] = g / n; out.data[o + 2] = b / n; out.data[o + 3] = a / n;
    }
  }
  return PNG.sync.write(out);
}

export function dataUri(buf: Buffer): string {
  return "data:image/png;base64," + buf.toString("base64");
}
