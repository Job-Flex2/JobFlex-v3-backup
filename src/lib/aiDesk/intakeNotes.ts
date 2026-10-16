// The desk's notes for the team (2026-10-16): the intake answers it writes into a booking or a message as short
// labelled lines — "Job: …", "Budget: …", "Email: …". Pure, so the QA reads it.

/** "Email: dana@example.com" in the desk's notes → the address, when it looks like one. */
export function emailFromNotes(text: string | null | undefined): string | null {
  const m = /(?:^|\n|;)\s*e-?mail\s*[:\-–]\s*([^\s,;]+@[^\s,;]+\.[a-z]{2,})/i.exec(text ?? "");
  return m ? m[1].toLowerCase().replace(/[.)]+$/, "") : null;
}

