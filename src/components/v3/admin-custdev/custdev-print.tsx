"use client";
// The report's one control: the browser's print dialog, where "Save as PDF" makes the file to send.
export function PrintButton() {
  return (
    <button type="button" className="custdev-print" onClick={() => window.print()} data-custdev-print>
      Save as PDF
    </button>
  );
}
