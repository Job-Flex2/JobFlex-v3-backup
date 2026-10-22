import { CompareSection } from "./compare-section";
import { COMPARE_COMPETITORS, COMPARE_ROWS } from "./landing-compare";

/* THE SECOND SCREEN — the comparison, drawn as a blueprint sheet (owner,
   2026-10-21: "redesign the second section to look like the blueprint
   design"). The sheet's stamp over the title, the ink-framed plate with a hard
   offset shadow, an ink title bar, JobFlex's column tinted blueprint blue,
   square answer marks, and the sheet's own title block under it. The rules
   live in compare-pass.css (the "blueprint pass"); the data and the table are
   unchanged (landing-compare.ts, compare-section.tsx). */
export function Intro() {
  return (
    <section id="compare" className="lp-cmpx lp-compare-section lp-compare-section--bp">
      <div className="relative z-[1] mx-auto lp-wrap">
        <header className="lp-compare-heading">
          <p className="lp-eyebrow lp-compare-stamp">Sheet 02 · Comparison</p>
          <h2>JobFlex vs. other contractor apps.</h2>
          <p className="lp-compare-intro">
            {COMPARE_ROWS.length} things a contractor&apos;s app should do, read against {COMPARE_COMPETITORS.map((b) => b.name).join(", ")} — each one from the vendor&apos;s own pages.
          </p>
        </header>
        <CompareSection />
        <div className="lp-compare-titleblock" aria-hidden="true">
          <span>JobFlex · Sheet 02</span>
          <span>{COMPARE_ROWS.length} features · {COMPARE_COMPETITORS.length + 1} apps</span>
          <span>Vendors&apos; own pages · Oct 2026</span>
        </div>
      </div>
    </section>
  );
}
