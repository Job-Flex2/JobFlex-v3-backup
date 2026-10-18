"use client";
// Drawing a PDF page into a canvas — the one way the plan tools draw (the Blueprint estimator's sheets, the Design
// Studio's previews and underlays).
type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfPage = Awaited<ReturnType<Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>["getPage"]>>;

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



export async function drawPage(page: PdfPage, canvasContext: CanvasRenderingContext2D, viewport: ReturnType<PdfPage["getViewport"]>): Promise<void> {
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
