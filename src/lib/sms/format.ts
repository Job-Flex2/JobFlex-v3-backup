// THE WORDS OF A TEXT (2026-09-24) — pure, no server, no DB.
//
// A text is read on a phone in a truck: one glance, 160 characters if it
// can be, two segments at most. Every builder here starts with the
// company's name, says one thing, and ends with a link only when a tap is the
// next step. Every text leaves from the company's own registered number
// (registration.ts); JobFlex's own codes go through Twilio Verify (verify.ts).

/** Two segments. Past this a text splits into three and reads as a wall. */
export const SMS_MAX = 320;

/** Cut at a word, never mid-word, with an ellipsis. */
export function clip(text: string, max = SMS_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.lastIndexOf(" ", max - 1);
  return `${t.slice(0, cut > max / 2 ? cut : max - 1).trimEnd()}…`;
}

/** "Ridgeline Roofing: Rick accepted …" — the company first, always. */
export function brand(org: string | null | undefined, text: string): string {
  const name = (org ?? "").replace(/\s+/g, " ").trim();
  return clip(name ? `${name}: ${text}` : text);
}

/** The company's name back off a branded text (for folding held texts). */
export function unbrand(org: string | null | undefined, text: string): string {
  const name = (org ?? "").replace(/\s+/g, " ").trim();
  return name && text.startsWith(`${name}: `) ? text.slice(name.length + 2) : text;
}

/** Links out of a text before it is logged anywhere a person can read. */
export function redactLinks(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, "<link>");
}

/** "$11,306.52" / "$12,000". */
export function money(n: number): string {
  const v = Math.round(n * 100) / 100;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** The carrier keywords Twilio's opt-out handles; the app mirrors them. */
export function isStopWord(body: string): boolean {
  return /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\b/i.test(body);
}
export function isStartWord(body: string): boolean {
  return /^\s*(start|unstop|yes|subscribe)\b/i.test(body);
}
export function isHelpWord(body: string): boolean {
  return /^\s*(help|info)\b/i.test(body);
}

// ── dates on a phone ──────────────────────────────────────────────────────

function parts(d: Date, tz: string): Record<string, string> {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
    return Object.fromEntries(dtf.formatToParts(d).map((x) => [x.type, x.value])) as Record<string, string>;
  } catch {
    const dtf = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
    return Object.fromEntries(dtf.formatToParts(d).map((x) => [x.type, x.value])) as Record<string, string>;
  }
}

/** "Tue Oct 7" */
export function dayLabel(d: Date, tz: string): string {
  const p = parts(d, tz);
  return `${p.weekday} ${p.month} ${p.day}`;
}

/** "8:00 AM" — "8 AM" when the minutes are zero. */
export function timeLabel(d: Date, tz: string): string {
  const p = parts(d, tz);
  return p.minute === "00" ? `${p.hour} ${p.dayPeriod}` : `${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/** "Tue Oct 7, 8 AM–4 PM" (the end only when it is a different time). */
export function spanLabel(startsAt: Date, endsAt: Date | null | undefined, tz: string): string {
  const day = dayLabel(startsAt, tz);
  const start = timeLabel(startsAt, tz);
  if (!endsAt || endsAt.getTime() <= startsAt.getTime()) return `${day}, ${start}`;
  return `${day}, ${start}–${timeLabel(endsAt, tz)}`;
}

/** The same calendar day in `tz`? */
export function sameLocalDay(a: Date, b: Date, tz: string): boolean {
  return dayLabel(a, tz) === dayLabel(b, tz);
}

/** The street line: "4567 Rainier Ave S". */
export function streetOf(address: string | null | undefined): string {
  return (address ?? "").split(/,|\n/)[0]?.trim() ?? "";
}

// ── the crew's texts ──────────────────────────────────────────────────────

export type CrewSlot = { title: string; startsAt: Date; endsAt?: Date | null; address?: string | null };

/** "Ridgeline Roofing: you're on "Roof replacement" Tue Oct 7, 8 AM–4 PM at 4567 Rainier Ave S. Details + confirm: <link>" */
export function crewAssignedText(org: string | null, slot: CrewSlot, link: string | null, tz: string): string {
  const where = streetOf(slot.address);
  const line = `you're on "${clip(slot.title, 60)}" ${spanLabel(slot.startsAt, slot.endsAt, tz)}${where ? ` at ${where}` : ""}.${link ? ` Details + confirm: ${link}` : ""}`;
  return brand(org, line);
}

export function crewMovedText(org: string | null, slot: CrewSlot, link: string | null, tz: string): string {
  const where = streetOf(slot.address);
  const line = `"${clip(slot.title, 60)}" moved to ${spanLabel(slot.startsAt, slot.endsAt, tz)}${where ? ` at ${where}` : ""}.${link ? ` Details: ${link}` : ""}`;
  return brand(org, line);
}

export function crewCancelledText(org: string | null, slot: CrewSlot, tz: string): string {
  return brand(org, `"${clip(slot.title, 60)}" on ${dayLabel(slot.startsAt, tz)} is cancelled — you're not needed for it.`);
}

/**
 * The evening and morning digests: "Ridgeline Roofing — tomorrow (Tue Oct 7):
 * 8 AM Roof replacement, 4567 Rainier Ave S · 1 PM Gutter repair, 12 Main St.
 * Details: <link>". Sorted by start; past three items the rest is a count.
 */
export function crewDigestText(org: string | null, when: "today" | "tomorrow", slots: CrewSlot[], link: string | null, tz: string): string {
  const sorted = [...slots].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (!sorted.length) return "";
  const shown = sorted.slice(0, 3).map((s) => {
    const where = streetOf(s.address);
    return `${timeLabel(s.startsAt, tz)} ${clip(s.title, 40)}${where ? `, ${where}` : ""}`;
  });
  const more = sorted.length > 3 ? ` · +${sorted.length - 3} more` : "";
  const name = (org ?? "").trim();
  const head = `${name ? `${name} — ` : ""}${when} (${dayLabel(sorted[0].startsAt, tz)}): `;
  return clip(`${head}${shown.join(" · ")}${more}.${link ? ` Details: ${link}` : ""}`);
}

// ── the office's texts ────────────────────────────────────────────────────

/** Texts that waited out the quiet hours, folded into one. */
export function heldDigestText(org: string | null, lines: string[]): string {
  const clean = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (clean.length === 1) return brand(org, clean[0]);
  return brand(org, `overnight — ${clean.map((l) => l.replace(/\.$/, "")).join(" · ")}.`);
}

/** JobFlex's own texts held outside someone's texting hours (the team's alerts), folded into one text when the hours
 *  start: each line once without its link, every page they point to once at the end. */
export function jobflexRoundupText(lines: string[]): string {
  const links: string[] = [];
  const words = lines.map((raw) => {
    const l = raw.replace(/^JobFlex:\s*/, "").replace(/\s+/g, " ").trim();
    for (const u of l.match(/https?:\/\/\S+/g) ?? []) if (!links.includes(u)) links.push(u);
    return l.replace(/\s*(?:—\s*)?(?:Live map:\s*)?https?:\/\/\S+/g, "").replace(/[\s.]+$/, "");
  });
  const head = words.length === 1 ? words[0] : `${words.length} alerts — ${words.join(" · ")}`;
  return clip(`JobFlex: ${head}.${links.length ? ` ${links.join(" ")}` : ""}`);
}

export function welcomeText(org: string | null): string {
  return brand(org, "will text you job alerts through JobFlex. Reply STOP to opt out, HELP for help.");
}

export function verifyText(code: string): string {
  return `JobFlex code: ${code}. It expires in 10 minutes. Reply STOP to opt out of texts.`;
}

export function helpText(): string {
  return "JobFlex: lead alerts you turned on in your JobFlex settings. Reply STOP to opt out. Questions: support@jobflex.app";
}

/** The confirmation when a company turns on JobFlex's lead texts (2026-10-02). */
export function leadTextsOnText(org: string | null): string {
  const name = (org ?? "").replace(/\s+/g, " ").trim();
  return clip(`JobFlex: lead texts are on${name ? ` for ${name}` : ""}. We text this phone when a lead is reserved for you. Msg & data rates may apply. Reply STOP to opt out, HELP for help.`);
}

/** HELP on a company's own number (2026-10-02): the company answers, with a way to reach it. */
export function companyHelpText(org: string | null, phone: string | null): string {
  const d = (phone ?? "").replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
  const call = d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : "support@jobflex.app";
  return brand(org, `texts about your visits and estimates. Reply STOP to opt out. Questions: ${call}`);
}

export function testText(org: string | null): string {
  return brand(org, "test text from JobFlex — your number is set up.");
}

// the office one-liners; each hook site builds its own from the facts it has
export function acceptedLine(client: string, title: string, total: number, link: string | null): string {
  return `${client} accepted "${clip(title, 50)}" — ${money(total)}. Schedule it${link ? `: ${link}` : "."}`;
}
export function declinedLine(client: string, title: string, note: string | null): string {
  return `${client} declined "${clip(title, 50)}"${note ? `: "${clip(note, 80)}"` : "."}`;
}
export function revertedLine(client: string, title: string, what: "accept" | "decline"): string {
  return `${client} took back their ${what === "accept" ? "acceptance" : "decline"} of "${clip(title, 50)}" — it's open again.`;
}
export function paymentLine(client: string, title: string, amount: number, remaining: number): string {
  return `${client} paid ${money(amount)} on "${clip(title, 50)}"${remaining > 0 ? ` — ${money(remaining)} still due.` : " — paid in full."}`;
}
export function leadLine(name: string, project: string | null, where: string | null, contact: string | null, link: string | null): string {
  const what = [project, where].filter(Boolean).join(" in ");
  return `New lead: ${name}${what ? `, ${what}` : ""}${contact ? ` (${contact})` : ""}.${link ? ` Open: ${link}` : ""}`;
}
export function leadOfferLine(trade: string, where: string, hoursLeft: number | null, link: string | null): string {
  const hold = hoursLeft == null ? "is reserved for you for 24 hours" : hoursLeft <= 1 ? "is yours for less than an hour more" : `is yours for ${hoursLeft} more hours`;
  return `A ${trade} lead in ${where} ${hold}.${link ? ` Claim it: ${link}` : ""}`;
}
export function changeOrderLine(client: string, approved: boolean, number: number | null, coTitle: string, total: number, context: string): string {
  return `${client} ${approved ? "approved" : "declined"} change order${number ? ` #${number}` : ""} "${clip(coTitle, 40)}" (${money(total)}) on "${clip(context, 40)}".`;
}
export function workerRespondedLine(worker: string, accepted: boolean, job: string, when: string | null): string {
  return `${worker} ${accepted ? "accepted" : "declined"} "${clip(job, 50)}"${when ? ` on ${when}` : ""}.`;
}
// the crew on site (2026-09-27) — to the owner and the manager
export function jobStartedLine(worker: string, job: string, link: string | null): string {
  return `${worker} started "${clip(job, 50)}".${link ? ` ${link}` : ""}`;
}
export function jobBackLine(worker: string, job: string, day: number, link: string | null): string {
  return `${worker} is back on "${clip(job, 50)}" — day ${day}.${link ? ` ${link}` : ""}`;
}
export function jobCompletedLine(worker: string, job: string, days: number, link: string | null): string {
  return `${worker} marked "${clip(job, 50)}" complete${days > 1 ? ` after ${days} days` : ""}.${link ? ` Photos: ${link}` : ""}`;
}
export function jobMediaLine(worker: string, job: string, photos: number, videos: number, link: string | null): string {
  const bits: string[] = [];
  if (photos) bits.push(`${photos} ${photos === 1 ? "photo" : "photos"}`);
  if (videos) bits.push(`${videos} ${videos === 1 ? "video" : "videos"}`);
  return `${worker} added ${bits.join(" and ") || "pictures"} of "${clip(job, 50)}".${link ? ` See them: ${link}` : ""}`;
}
// the calendar (2026-09-29) — to the office and the rep whose visit or job it is
export function appointmentBookedLine(title: string, who: string | null, when: string, where: string | null, by: "online" | string | null): string {
  const bits = [clip(title, 40), who, when, where ? streetOf(where) : null].filter(Boolean);
  return `Booked: ${bits.join(" · ")}${by === "online" ? " · online" : by ? ` · by ${by}` : ""}.`;
}
export function appointmentMovedLine(title: string, who: string | null, wasWhen: string | null, nowWhen: string): string {
  const what = [clip(title, 40), who].filter(Boolean).join(" · ");
  return wasWhen ? `Moved: ${what} — was ${wasWhen}, now ${nowWhen}.` : `Moved: ${what} — now ${nowWhen}.`;
}
export function appointmentCancelledLine(title: string, who: string | null, when: string, by: "online" | null): string {
  const what = [clip(title, 40), who].filter(Boolean).join(" · ");
  return `Cancelled: ${what} — ${when}${by === "online" ? ", by the client" : ""}.`;
}
export function jobScheduledLine(title: string, when: string, where: string | null, link: string | null): string {
  return `Scheduled: "${clip(title, 50)}" — ${when}${where ? ` at ${streetOf(where)}` : ""}.${link ? ` ${link}` : ""}`;
}
export function replyForwardLine(who: string, what: string, body: string): string {
  return `${who}${what ? ` (${what})` : ""} texted: "${clip(body, 200)}"`;
}
