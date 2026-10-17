// The forms suite's machinery: find the forms on a page, fill them for a scenario, press submit
// (or, for a form that would send / pay / invite / delete, only check the validation before the
// press), and read what the person was shown. Also the snapshot / restore of QA Co's own rows
// around the suite, because a form that accepts bad input writes it.
import type { Page, Response } from "@playwright/test";
import { submitIsForbidden } from "./forbidden";
import { prisma, QA_ORG_SLUG } from "./db";
import { DEFAULT_USERS } from "./roles";

export type Scenario = "empty" | "too-long" | "invalid" | "special";
export const SCENARIOS: Scenario[] = ["empty", "too-long", "invalid", "special"];

export const XSS = `<img src=x onerror="window.__qaXss=1"><b class="qa-xss">x</b>'"; -- QA`;
const LONG = "QA" + "A".repeat(4998);

export type FoundForm = { index: number; kind: "form" | "loose"; fields: number; submit: string | null; submitForbidden: boolean; hasEmail: boolean; hasTel: boolean; hasNumber: boolean; hasUrl: boolean };

const FIELD = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=password]):not([type=submit]):not([type=button]):not([type=range]):not([type=color]):not([type=date]):not([type=time]):not([type=datetime-local]):not([type=month]), textarea';
const SUBMIT_TEXT = /^(save|create|add|submit|continue|update|next|apply|done|post|send|invite|confirm|book|request)\b/i;
// Inputs with no <form> around them count as a form only with a button that plainly submits:
// "Save", "Create client", "Update" — not a calendar's "Next" / "Add", an estimator's "Add run" or a material named "Post-on-pipe".
const LOOSE_SUBMIT = /^(save|create|submit|update)(?: [a-z][a-z ]{0,30})?$/i;
// …and "Add <what>" (2026-10-17): "Add applicant" is the hiring form's submit — dropping every "Add"
// in 41dd0170 lost that form and the ZodError → 500 it had caught (F-1f3f6da5). It counts when it
// names a thing (not "Add a line" / "Add row" / "Add item" — the estimators' row buttons), sits after
// the last field, and the page has 2–12 fields — a form's size, not an estimator's grid.
const LOOSE_ADD = /^add (?!(?:a|an|another|more|new|row|rows|line|lines|item|items|note|run|stage|unit|photo|video)\b)[a-z][a-z ]{0,30}$/i;

/** A button's text as a whole, case-insensitive (CSS upper-cases some labels in innerText). */
const wholeText = (text: string) => new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");

/** Visible forms; a page with inputs but no <form> counts as one loose form. */
export async function findForms(page: Page): Promise<FoundForm[]> {
  return page.evaluate(({ FIELD, SUBMIT, LOOSE, ADD }) => {
    const re = new RegExp(SUBMIT, "i");
    const strict = new RegExp(LOOSE, "i");
    const add = new RegExp(ADD, "i");
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
    const usable = (el: Element) => visible(el) && !(el as HTMLInputElement).disabled && !(el as HTMLInputElement).readOnly && !el.closest("[aria-hidden=true], [inert], header, nav");
    const describe = (root: Element | Document, kind: "form" | "loose", index: number) => {
      const fields = Array.from(root.querySelectorAll(FIELD)).filter(usable) as HTMLInputElement[];
      const buttons = Array.from(root.querySelectorAll('button, input[type=submit], [role=button]')).filter(visible) as HTMLElement[];
      const label = (b: HTMLElement) => (b.innerText || (b as HTMLInputElement).value || b.getAttribute("aria-label") || "").trim();
      let submit = kind === "form"
        ? (buttons.find((b) => (b as HTMLButtonElement).type === "submit") ?? buttons.find((b) => re.test(label(b))))
        : (buttons.find((b) => strict.test(label(b).replace(/\s+/g, " "))) ??
          (fields.length >= 2 && fields.length <= 12
            ? buttons.find((b) => add.test(label(b).replace(/\s+/g, " ")) && !!(fields[fields.length - 1].compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING))
            : undefined));
      // a sheet's footer often holds the submit outside the <form> (form="id", or just beside it)
      if (!submit && kind === "form") {
        const f = root as HTMLFormElement;
        const outside = Array.from(document.querySelectorAll(f.id ? `button[form="${f.id}"]` : "button[form]")).filter(visible) as HTMLElement[];
        const box = f.closest('[role="dialog"], dialog, aside, [data-sheet], [class*="sheet" i]') ?? f.parentElement?.parentElement ?? null;
        const near = box ? (Array.from(box.querySelectorAll("button")).filter(visible) as HTMLElement[]) : [];
        submit = outside[0] ?? near.find((b) => re.test(label(b)));
      }
      return {
        index, kind, fields: fields.length,
        submit: submit ? (submit.innerText || (submit as HTMLInputElement).value || submit.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 60) : null,
        submitForbidden: false,
        hasEmail: fields.some((f) => f.type === "email" || /e-?mail/i.test(f.name + f.id + (f.placeholder || ""))),
        hasTel: fields.some((f) => f.type === "tel" || /phone|tel/i.test(f.name + f.id)),
        hasNumber: fields.some((f) => f.type === "number" || f.inputMode === "decimal" || f.inputMode === "numeric"),
        hasUrl: fields.some((f) => f.type === "url"),
      };
    };
    const forms = Array.from(document.querySelectorAll("form")).filter((f) => visible(f) && !f.closest("header, nav"));
    const out = forms.map((f, i) => describe(f, "form", i)).filter((f) => f.fields > 0);
    if (!out.length) {
      const loose = describe(document, "loose", -1);
      if (loose.fields > 0 && loose.submit) out.push(loose);
    }
    return out;
  }, { FIELD, SUBMIT: SUBMIT_TEXT.source, LOOSE: LOOSE_SUBMIT.source, ADD: LOOSE_ADD.source }).then((list) => list.map((f) => ({ ...f, submitForbidden: !!f.submit && submitIsForbidden(f.submit) })));
}

const OPENER = /^\+?\s*(new|add|create)\b/i;

/** A "New client" / "+ Add" button that opens a form in a sheet — its text, or null. */
export async function findOpener(page: Page): Promise<string | null> {
  const texts = await page.locator("button, [role=button]").filter({ visible: true }).evaluateAll((els) =>
    els.filter((e) => !e.closest("header, nav")).map((e) => ((e as HTMLElement).innerText || e.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim()).filter((t) => t && t.length < 40));
  return texts.find((x) => OPENER.test(x) && !submitIsForbidden(x) && !/estimate$/i.test(x)) ?? null;
}

/** Presses the opener and waits for the sheet. */
export async function pressOpener(page: Page, text: string): Promise<boolean> {
  const ok = await page.getByRole("button", { name: wholeText(text) }).filter({ visible: true }).first().click({ timeout: 8000 }).then(() => true).catch(() => false);
  if (ok) await page.waitForTimeout(1200);
  return ok;
}

/** Fills the form's fields for the scenario. Returns how many were filled. */
export async function fillScenario(page: Page, form: FoundForm, scenario: Scenario): Promise<number> {
  const root = form.kind === "form" ? page.locator("form").filter({ visible: true }).nth(form.index) : page.locator("body");
  const fields = root.locator(FIELD).filter({ visible: true });
  const n = await fields.count();
  let filled = 0;
  for (let i = 0; i < n; i++) {
    const f = fields.nth(i);
    const info = await f.evaluate((el: HTMLInputElement) => ({ type: el.type, name: el.name + " " + el.id + " " + (el.placeholder || ""), disabled: el.disabled || el.readOnly, inHeader: !!el.closest("header, nav"), mode: el.inputMode })).catch(() => null);
    if (!info || info.disabled || info.inHeader) continue;
    const isEmail = info.type === "email" || /e-?mail/i.test(info.name);
    const isTel = info.type === "tel" || /phone|\btel\b/i.test(info.name);
    const isNum = info.type === "number" || info.mode === "decimal" || info.mode === "numeric";
    const isUrl = info.type === "url";
    let value: string | null = null;
    if (scenario === "empty") value = "";
    else if (scenario === "too-long") value = isEmail ? "a".repeat(300) + "@qa.jobflex.test" : isNum ? "9".repeat(40) : LONG;
    else if (scenario === "invalid") value = isEmail ? "not-an-email" : isTel ? "abc-phone" : isNum ? "-1e999" : isUrl ? "not a url" : null;
    else if (scenario === "special") value = isEmail ? `qa+"<x>"@qa.jobflex.test` : isNum ? "1;DROP" : XSS;
    if (value === null) continue;
    try {
      await f.fill(value, { timeout: 5000 });
      filled++;
    } catch { /* a field that refuses a value (type=number) is itself validation */ }
  }
  return filled;
}

export type Outcome = { pressed: boolean; validation: string[]; savedRequests: number; failedSaves: number; xss: boolean; crashed: boolean };

/** Presses submit (unless forbidden) and reads what the person sees. */
export async function submitAndRead(page: Page, form: FoundForm): Promise<Outcome> {
  const saves: number[] = [];
  const origin = new URL(page.url()).origin;
  const onResp = (r: Response) => {
    const m = r.request().method();
    if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS" && r.url().startsWith(origin)) saves.push(r.status());
  };
  page.on("response", onResp);
  let pressed = false;
  const before = await visibleMessages(page);
  if (form.submit && !form.submitForbidden) {
    // by its words on the whole page: a sheet's submit can sit outside its <form>
    const btn = page.getByRole("button", { name: wholeText(form.submit) }).filter({ visible: true }).last();
    pressed = await btn.click({ timeout: 8000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(2000);
  }
  const after = await visibleMessages(page);
  const native = await page.evaluate(() => Array.from(document.querySelectorAll("input, textarea, select")).filter((el) => (el as HTMLInputElement).willValidate && !(el as HTMLInputElement).checkValidity()).map((el) => `${(el as HTMLInputElement).name || el.id || el.tagName}: ${(el as HTMLInputElement).validationMessage}`).slice(0, 6)).catch(() => [] as string[]);
  const aria = await page.evaluate(() => Array.from(document.querySelectorAll('[aria-invalid="true"]')).map((el) => (el as HTMLInputElement).name || el.id || el.tagName).slice(0, 6)).catch(() => [] as string[]);
  const xss = await page.evaluate(() => !!(window as unknown as { __qaXss?: number }).__qaXss || !!document.querySelector("b.qa-xss")).catch(() => false);
  const crashed = await page.evaluate(() => /Application error|Something went wrong|Unhandled Runtime Error/i.test(document.body?.innerText ?? "")).catch(() => false);
  page.off("response", onResp);
  const fresh = after.filter((m) => !before.includes(m));
  const validation = [...native.map((n) => "native: " + n), ...aria.map((a) => "aria-invalid: " + a), ...fresh.map((m) => "shown: " + m)];
  return { pressed, validation, savedRequests: saves.filter((s) => s < 400).length, failedSaves: saves.filter((s) => s >= 500).length, xss, crashed };
}

async function visibleMessages(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out = new Set<string>();
    const sel = '[role="alert"], [role="status"], [aria-live], .error, .err, [data-error], [class*="error" i], [class*="invalid" i], [class*="toast" i], [data-sonner-toast]';
    for (const el of Array.from(document.querySelectorAll(sel))) {
      const r = el.getBoundingClientRect();
      const t = ((el as HTMLElement).innerText || "").replace(/\s+/g, " ").trim();
      if (r.width > 0 && r.height > 0 && t && t.length < 300) out.add(t.slice(0, 160));
    }
    return [...out];
  }).catch(() => []);
}

// ── QA Co's rows around the suite ───────────────────────────────────────────
type Snapshot = { since: Date; org: Record<string, unknown> | null; users: Record<string, unknown>[] };
const CREATED_MODELS = ["client", "lead", "proposal", "job", "project", "tradePost", "jobPost", "inventoryItem", "expense", "jobExpense", "invoice", "changeOrder", "task", "note", "servicePlan", "equipment", "booking", "reviewRequest", "conversation", "applicant", "appointment", "invite", "activityEvent"];
/** model → the text field the forms suite fills (its values are recognisable: LONG, XSS) */
const MARKED: [string, string][] = [["followUpRule", "name"], ["jobEvent", "title"], ["appointment", "title"], ["applicant", "fullName"], ["client", "name"], ["lead", "name"], ["job", "title"], ["project", "name"], ["tradePost", "title"]];

export async function snapshotQaCo(): Promise<Snapshot> {
  const db = prisma();
  const org = (await db.organization.findUnique({ where: { slug: QA_ORG_SLUG } })) as Record<string, unknown> | null;
  const emails = Object.values(DEFAULT_USERS).filter(Boolean) as string[];
  const users = (await db.user.findMany({ where: { email: { in: emails } } })) as unknown as Record<string, unknown>[];
  return { since: new Date(), org, users };
}

/** QA Co's rows that carry the suite's own values (LONG, XSS) — safe to remove after any test. */
export async function removeMarked(orgId?: string): Promise<string[]> {
  const db = prisma() as unknown as Record<string, { deleteMany: (a: unknown) => Promise<{ count: number }> }>;
  const id = orgId ?? (await prisma().organization.findUnique({ where: { slug: QA_ORG_SLUG }, select: { id: true } }))?.id;
  const notes: string[] = [];
  if (!id) return notes;
  for (const [model, field] of MARKED) {
    if (!db[model]?.deleteMany) continue;
    try {
      const r = await db[model].deleteMany({ where: { organizationId: id, OR: [{ [field]: { startsWith: LONG.slice(0, 12) } }, { [field]: { contains: "qa-xss" } }] } });
      if (r.count) notes.push(`${model}: ${r.count} removed (by the suite's own values)`);
    } catch { /* no such field, or still referenced */ }
  }
  return notes;
}

/** Puts QA Co's organisation row and the QA users back, and removes what the suite created there. */
export async function restoreQaCo(s: Snapshot): Promise<string[]> {
  const db = prisma() as unknown as Record<string, { deleteMany: (a: unknown) => Promise<{ count: number }>; update: (a: unknown) => Promise<unknown> }>;
  const notes: string[] = [];
  if (!s.org) return notes;
  const orgId = s.org.id as string;
  for (const model of CREATED_MODELS) {
    if (!db[model]?.deleteMany) continue;
    try {
      const r = await db[model].deleteMany({ where: { organizationId: orgId, createdAt: { gte: s.since } } });
      if (r.count) notes.push(`${model}: ${r.count} removed`);
    } catch { /* this model has no organizationId / createdAt, or a row is still referenced */ }
  }
  // Rows with no createdAt (follow-up rules, calendar events) and anything missed above: by what the
  // suite typed — the too-long "QAAAA…" and the XSS probe. Before 2026-10-17 these stayed: 27 rules
  // and 20 events in QA Co, the Free plan's calendar cap reached, the dashboard's grid broken by "QAAAA…".
  notes.push(...(await removeMarked(orgId)));
  const strip = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== "id" && k !== "createdAt" && k !== "updatedAt"));
  try { await db.organization.update({ where: { id: orgId }, data: strip(s.org) }); } catch (e) { notes.push("organisation not restored: " + String((e as Error).message).slice(0, 120)); }
  for (const u of s.users) {
    try { await db.user.update({ where: { id: u.id }, data: strip(u) }); } catch (e) { notes.push(`user ${String(u.email)} not restored: ` + String((e as Error).message).slice(0, 120)); }
  }
  return notes;
}
