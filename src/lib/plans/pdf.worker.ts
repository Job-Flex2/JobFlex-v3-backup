// pdf.js's worker, as a module the bundler builds next to the page (pdfClient starts it
// with `new Worker(new URL("./pdf.worker.ts", import.meta.url))`). The legacy build:
// it runs on the Safari a two-year-old iPhone has.
import "pdfjs-dist/legacy/build/pdf.worker.min.mjs";
