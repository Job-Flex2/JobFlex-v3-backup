// SmartHelp · THE AI ANSWER — what the model reads, the answer it must return, and what of that answer the panel may
// show. Pure: no model call, no database (the call, the limits and the log are Task 5's lib/smarthelp/server.ts).
//
// ONE SYSTEM MESSAGE FOR EVERYONE. smartHelpSystemPrompt() is the rules, the pages and Show me targets an answer may
// use, the guides and the customer handbook: the same bytes for every person and every question, so OpenAI's
// automatic prompt caching reuses the long prefix. Everything about the person — page, role, plan, setup facts, the
// conversation, the question — goes in smartHelpUserPrompt() only.
//
// THE MODEL IS NOT TRUSTED WITH THE SCREEN. cleanAnswer() drops an Open that is not a SmartHelp page and a Show me
// that is not a known target (the step's words stay), keeps a role- or plan-blocked step's words but not its
// buttons, gives no steps below CONFIDENCE_MIN, and turns an answer that commits money or data — or names the buttons
// that cancel or delete — into "Ask a person".
//
// PERSON TOPICS ARE CAUGHT TWICE: personTopic() before the model (no call is made), and after it the model's own kind
// "person" plus commitsMoneyOrData on everything it wrote. The topics are the support AI's own (PERSON_ONLY_TOPICS,
// lib/support/aiReply) — shared, not copied.
import { z } from "zod";
import { NAV_SECTIONS, flattenNavItems } from "@/components/v3/blueprint-shell/nav-map";
import { PERSON_ONLY_TOPICS, commitsMoneyOrData } from "@/lib/support/aiReply";
import { GUIDES, GUIDE_TARGETS } from "./guides";
import { customerHandbook } from "./knowledge";
import { HELP_PAGES, isHelpPage, pathOf } from "./pages";
import type { HelpContext, HelpStep, SetupKey, StepView } from "./types";
import { stepView } from "./view";

/** Below this the panel shows no steps, only "Ask a person". */
export const CONFIDENCE_MIN = 60;
/** The turns of the conversation the model reads. */
export const HISTORY_TURNS = 6;
const STEPS_MAX = 8;

// ── The person-topic guard (before the model) ───────────────────────────────

export type PersonTopic = "leaving" | "money" | "data" | "security" | "person";

/** Lower case, accents off (Spanish "suscripción" → "suscripcion", Russian "й" → "и"), one kind of apostrophe. */
function fold(q: string): string {
  return q
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Someone else's account, plan or card — the contractor's clients, their service plans, their team: features. */
const CLIENT_SIDE = /\b(clients?|customers?|homeowners?|clientes?|service plans?|maintenance plans?|their (card|plan|account|subscription|membership)|team ?members?|members?)\b/;
/** Work a contractor cancels every day — a job, a visit, a proposal — and the screens they press Cancel on. */
const WORK_OBJECT =
  /\b(jobs?|appointments?|visits?|bookings?|reservations?|proposals?|invoices?|estimates?|quotes?|meetings?|events?|orders?|calls?|texts?|messages?|sms|emails?|leads?|projects?|reminders?|inspections?|install\w*|shifts?|deliver\w*|requests?|signatures?|schedul\w*|calendar|crew|workers?|deposits?|drafts?|uploads?|imports?|changes?|edits?|reports?|tours?|plan sets?|permits?|downloads?|files?|photos?|videos?|payments?|button|dialog|window|pop-?up|modal|screen|form|estimator|studio|drawing|design|cita|citas|trabajos?|visitas?|reservas?|propuestas?|facturas?|presupuestos?|cotizacion\w*|estimados?|reunion\w*|eventos?|orden\w*|llamadas?|mensajes?|proyectos?|recordatorios?|instalacion\w*|inspeccion\w*)\b/;
const MINE = "(?:my|our|mi|mis|nuestra|nuestro)";
const FILLER = "(?:the|this|a|an|whole|entire|current|free|paid|monthly|yearly|annual|jobflex|jobflex's|pro|professional|starter|advanced|la|el|de|del|una|un)";
/** Their JobFlex plan — never a plan set or a plan sheet (the blueprint and deck plans). */
const PLAN = "plan(?! (?:sets?|sheets?|pages?|views?|drawings?|reviews?|checks?))";
/** The contractor's own JobFlex: the plan, the subscription, an add-on, the account, the trial. */
const OWN_THING = `(?:${PLAN}|subscriptions?|account|membership|trial|billing|renewal|auto-?renew\\w*|add-?ons?|deck studio(?! (?:designs?|drawings?|projects?|proposals?|links?))|jobflex|service(?! (?:calls?|visits?|plans?|appointments?|requests?|tickets?|area|radius|menu|desk))|suscripcion|subscripcion|cuenta|membresia|prueba|servicio)`;
const CANCEL_WORD = /\bcancel\w*/;

/** Leaving said of their own account ("cancel my plan", "close my account") — no client words can make it a feature. */
const LEAVING_MINE: RegExp[] = [
  new RegExp(`\\bcancel\\w*\\s+${MINE}\\s+(?:${FILLER}\\s+){0,2}${OWN_THING}\\b`),
  /\b(close|deactivate|shut down|shutdown|terminate|suspend|pause|freeze|end)\s+(my|our)\s+(jobflex\s+)?(account|subscription|membership|plan)\b/,
  /\bstop (charging|billing) (me|us|my card|our card|my account)\b/,
  /\bcerrar (mi|nuestra) cuenta\b/,
];
/** Leaving said more loosely — read as leaving only when nothing in the question is about a client. */
const LEAVING: RegExp[] = [
  new RegExp(`\\bcancel\\w*\\s+(?:${FILLER}\\s+){0,3}${OWN_THING}\\b`),
  /\bstop (charging|billing|the (charges|billing|subscription|renewal)|my (subscription|plan|membership|payments|billing|renewal)|paying)\b/,
  /\b(don'?t|do not|never) (charge|bill) (me|us|my card)\b/,
  /\b(don'?t|do not) want to (be )?(charged|billed|pay)\b/,
  /\bno more (charges|payments|billing)\b/,
  /\b(turn off|disable|stop|cancel) (the |my )?(auto-?renew\w*|automatic (renewal|billing|payments?|charges?))\b/,
  /\bdowngrad\w*/,
  /\b(switch|move|go|change|put|drop)( me| us)?( back| down)? (to|onto) (the |a )?(free|cheaper|cheapest|lower|smaller|starter) ?(plan|tier|version|one|subscription|$|[.!?,])/,
  /\b(close|deactivate|shut down|shutdown|terminate|suspend|pause|freeze)\s+(the\s+)?(jobflex\s+)?(account|subscription|membership)\b/,
  /\b(quit|quitting|leave|leaving|stop using|done with|get rid of)\s+jobflex\b/,
  /\bi('m| am) (leaving|quitting|done with (jobflex|this))\b/,
  new RegExp(`\\b(don'?t|do not|no longer) (want|need) (jobflex|this (app|software|subscription|${PLAN})|the (subscription|${PLAN})|my (subscription|${PLAN}))\\b`),
  /\bunsubscribe\b(?!.*\b(emails?|notifications?|digests?|newsletters?|texts?|sms|alerts?|reminders?|messages?|mailing)\b)/,
  // Spanish
  /\bdar(me|nos|se)? de baja\b/,
  /\bcerrar (la )?cuenta\b/,
  /\b(dejar|dejen|deje) de (cobrar|pagar)\w*/,
  /\bno (me |nos )?(cobren|cobres|cobre)\b/,
  /\bno quiero (que me cobren|pagar)\b/,
  /\bya no (quiero|queremos|necesito) (pagar|usar|jobflex|la suscripcion|el plan)\b/,
  /\bbajar (de |mi |el )?plan\b/,
  /\bplan (mas barato|gratis|gratuito)\b/,
  // Russian
  /отмен[а-я]*\s+(мо[а-я]*\s+)?подписк/,
  /отписат/,
  /закрыт[а-я]*\s+(мо[а-я]*\s+)?(аккаунт|акк|учетн)/,
  /понизит[а-я]*\s+тариф/,
  /перейти на (бесплатн|дешевл)/,
];

/** Money back, money off, a credit, a disputed charge — never "credit card", never a proposal's discount line. */
const MONEY: RegExp[] = [
  /\brefund\w*/,
  /\breimburs\w*/,
  /\bmoney back\b/,
  /\bcompensat\w*/,
  /\bchargeback\w*/,
  /\bdisput\w* (a |the |this |my )?(charge|payment|bill)/,
  /\b(charged|billed)( me)? (twice|two times|double|again|by mistake|wrongly|without)/,
  /\bdouble[- ]?(charged|billed|charge)\b/,
  /\bover-?charg\w*/,
  /\bunauthori[sz]ed (charge|payment)/,
  /\bfraud\w*/,
  /\baccount credit\b/,
  /\bcredit (me|us)\b/,
  /\bcredits? (to|on|for|back to) (my|our|the) (account|bill|subscription|plan)\b/,
  /\b(free|extra) months?\b/,
  /\b(extend|extension of|longer|more days on) (my |the |our )?(free )?trial\b/,
  /\bdiscounts? (on|for|off|to) (my|our|the) (bill|billing|subscription|plan|membership|renewal|price|payment|account|jobflex)\b/,
  // Spanish
  /\breembols\w*/,
  /\b(devolver(me|nos)?|devuelv\w*|devolucion (de|del)) (mi |el |nuestro )?(dinero|pago|cargo|cobro)\b/,
  /\bdevuelvan(me|nos)\b/,
  /\bme cobraron (dos veces|de mas|doble)\b/,
  /\bcobro (doble|indebido)\b/,
  /\bmes(es)? gratis\b/,
  /\bdescuento (en|para|de) (mi|nuestra|la) (factura|suscripcion|plan|cuenta|membresia|mensualidad)\b/,
  // Russian
  /верн[а-я]*\s+(мне\s+|мои\s+)?деньг/,
  /возврат[а-я]*\s+(денег|средств|оплат)/,
];
/** Asking for a better price or a credit — money only when nothing in the question is a proposal, an invoice or a client's. */
const PRICE_ASK: RegExp[] = [
  /\b(give|get|issue|owe|want|offer)( me| us)? (a |some |any )?credit\b(?! (cards?|scores?|checks?|approvals?|lines?|limits?|reports?))/,
  /\b(can|could|may|would) (i|we|you) (get|have|receive|give|offer)( me| us)? (a |any |some )?(discount|better price|lower price|cheaper price|deal)\b/,
  /\b(give|offer) (me|us) (a |any |some )?(discount|deal|better price)\b/,
  /\b(me|nos) (pueden|puede|podrian|podria|dan|da) (dar |hacer )?(un )?descuento\b/,
];
const FEATURE_DOC =
  /\b(proposals?|estimates?|quotes?|invoices?|lines?|items?|clients?|customers?|jobs?|projects?|propuestas?|presupuestos?|facturas?|cotizacion\w*|clientes?)\b/;

/** Deleting the account, the company or all of it — never one proposal, line or client. */
const DATA: RegExp[] = [
  /\b(delete|erase|wipe|remove|purge|destroy)\s+(all\s+(of\s+)?)?(my|our)\s+(jobflex\s+)?(account|company|business|organi[sz]ation|org|data|information|info|records|history|workspace)\b(?!\s+(logo|photo|picture|pic|name|address|email|phone|number|image|colou?rs?|description|hours|website|page|link|card|line|item))/,
  /\b(delete|erase|wipe|remove|purge)\s+the\s+(jobflex\s+)?(account|company|organi[sz]ation|workspace)\s*($|[.!?,])/,
  /\b(delete|erase|wipe|remove|purge)\s+(it\s+)?(all|everything)(\s+(of\s+)?(my|our)\s+(data|information|info|stuff|records))?(?=\s*($|[.!?,])|\s+(from|in|on|at)\s+(my|our|the)\s+(account|company|jobflex|system|database)|\s+(about|for)\s+(me|us|my company)|\s+(permanently|forever|for good|and close))/,
  /\bgdpr\b|\bccpa\b|\bright to be forgotten\b|\bdata deletion\b/,
  // Spanish
  /\b(borrar|eliminar|suprimir|borra|elimina)\s+(toda\s+|todos\s+)?(mi|mis|nuestra|nuestros|nuestras|la)\s+(cuenta|datos|informacion|empresa|compania|negocio)\b/,
  /\b(borrar|eliminar) todo(?=\s*($|[.!?,])|\s+(de|en) (mi|la) (cuenta|empresa))/,
  // Russian
  /удал[а-я]*\s+(мо[а-я]*\s+|все\s+)?(аккаунт|акк|учетн|данн)/,
];

/** Someone in their account, a stolen login, a secret pasted into the box. */
const SECURITY: RegExp[] = [
  /\bhack\w*/,
  /\bcompromis\w*/,
  /\bbreach\w*/,
  /\bphish\w*/,
  /\bunauthori[sz]ed (access|log ?-?in|sign[- ]?in|user|person|use)\b/,
  /\bsuspicious (log ?-?in|sign[- ]?in|activity|email|access)\b/,
  /\b(stolen|stole)\b.{0,30}\b(account|password|login|card)\b|\b(account|password|login|card)\b.{0,30}\b(stolen|stole)\b/,
  /\b(my|the) (password|passcode|pin|verification code|one-?time code|login code|code) ?(is|:|=) ?["']?(?=\S*[\d!@#$%^&*])\S{4,}/,
  /\b\d{4}([ -]?)\d{4}\1\d{4}\1\d{1,7}\b|\b\d{13,19}\b/,
  // Spanish
  /\b(hackearon|hackeado|hackeada|me robaron)\b/,
  /\balguien (entro|accedio|inicio sesion|esta usando|uso) (a |en )?(mi|nuestra) cuenta\b/,
  // Russian
  /взлом/,
];
/** "Someone got into my account" — but someone on their own team signing in is the team guide. */
const SOMEONE_IN_MY_ACCOUNT = /\b(someone|somebody|a stranger|an? unknown (person|user))\b.{0,40}\b(my|our) (account|login|password|email)\b/;
const TEAM = /\b(team|crew|workers?|employees?|staff|office manager|my manager|partner)\b/;

/** A person asked for, ownership, the law, anger. */
const PERSON: RegExp[] = [
  /\b(a|real|live|actual) human\b|\bhuman being\b|\b(real|live|actual) (person|agent)\b/,
  /\bcustomer (service|support)\b/,
  /\bcontact (support|you|jobflex|your team|the (jobflex )?team)\b/,
  /\b(email|phone number|number) (for|of|to) (support|jobflex)\b/,
  /\btransfer\w*\s+(the\s+|my\s+|our\s+)?(ownership|account|company|business)\b/,
  /\b(change|switch|replace)\s+(the\s+)?(account\s+)?owner(ship)?\b(?!'s)/,
  /\bnew (account )?owner\b/,
  /\badd (an?|another|a second|a new) (co-?)?owners?\b|\bco-?owners?\b/,
  /\bmake\s+(?!sure\b)(\S+\s+){1,3}(the|an?|co-?)\s*owners?\b(?!'s)/,
  /\b(sold|selling|sell)\s+(my|the|our)\s+(business|company)\b/,
  /\b(lawyer|attorney|lawsuit|legal action|legal team|sue (you|jobflex|them)|suing|subpoena|small claims|class action|better business bureau)\b/,
  /\b(scam\w*|rip[- ]?off|ripped off|wtf|f+u+c+k\w*|bullshit)\b/,
  // Spanish
  /\bhablar con (una |un |alguna |algun |el |la )?(persona|humano|agente|representante|asesor|operador|alguien|soporte)\b/,
  /\b(persona real|ser humano|atencion al cliente|servicio al cliente)\b/,
  /\btransferir (la )?(cuenta|propiedad|empresa)\b/,
  /\b(cambiar|nuevo) (el )?(dueno|propietario)\b/,
  /\b(abogad\w*|demandar\w*|estafa\w*)\b|\b(una|poner|presentar) demanda\b/,
  // Russian
  /(поговорить|связаться|соедините)\s+с\s+(живым\s+)?(человеком|оператором|поддержкой|менеджером)/,
  /жив(ой|ого|ым) человек/,
  /юрист|адвокат|мошенни/,
];
/** "Talk to someone" — unless it's how their clients reach someone (the AI desk). */
const TALK_TO_SOMEONE = /\b(talk|speak|chat)\s+(to|with)\s+(an?\s+|some\s+|the\s+)?(real\s+|live\s+|actual\s+)?(human|person|agent|representative|operator|someone|somebody|support)\b/;

/** A question only a person answers, said any way we know (English, Spanish, a little Russian), or null. Features
 *  that sound alike — a discount line, a credit card, deleting a line item, cancelling a job or a visit — are null. */
export function personTopic(question: string): PersonTopic | null {
  const q = fold(question);
  if (!q) return null;
  const any = (rs: RegExp[]) => rs.some((r) => r.test(q));
  const clientSide = CLIENT_SIDE.test(q);
  if (any(SECURITY) || (SOMEONE_IN_MY_ACCOUNT.test(q) && !TEAM.test(q))) return "security";
  const bareCancel = CANCEL_WORD.test(q) && !WORK_OBJECT.test(q);
  if (any(LEAVING_MINE) || (!clientSide && (any(LEAVING) || bareCancel))) return "leaving";
  if (any(MONEY) || (!FEATURE_DOC.test(q) && any(PRICE_ASK))) return "money";
  if (any(DATA)) return "data";
  if (any(PERSON) || (!clientSide && TALK_TO_SOMEONE.test(q))) return "person";
  return null;
}

/** The line a person-topic reply shows (no steps; Ask a person comes first). */
export const PERSON_REPLY: Record<PersonTopic, string> = {
  leaving: "Cancelling or downgrading your plan is something a person on our team helps you with. Press Ask a person — your question goes with it.",
  money: "Refunds, credits and discounts on your bill are answered by a person on our team. Press Ask a person — your question goes with it.",
  data: "Deleting an account or its data is done with a person on our team, so nothing is lost by mistake. Press Ask a person.",
  security: "A person on our team will help with your account's security right away. Press Ask a person — and never share a password, card number or code; we never need them.",
  person: "A person on our team will answer you. Press Ask a person — your question goes with it.",
};

/** The line an answer shows when the model was not sure enough to give steps. */
export const UNKNOWN_REPLY = "I'm not sure about this one — rather than guess, press Ask a person and our team will answer.";

// ── The answer the model returns ─────────────────────────────────────────────

const KINDS = ["steps", "explain", "person", "unknown"] as const;
const text = (max: number) =>
  z
    .string()
    .catch("")
    .transform((s) => s.trim().slice(0, max));
const optText = (max: number) =>
  z
    .string()
    .nullish()
    .catch(null)
    .transform((s) => s?.trim().slice(0, max) || undefined);
const stepSchema = z.object({ text: text(400), open: optText(300), show: optText(120) });

/** Steps as far as they are steps: a bare string is a step's text, anything without text is dropped, at most 8. */
function mendSteps(items: unknown[]): HelpStep[] {
  const out: HelpStep[] = [];
  for (const item of items) {
    const r = stepSchema.safeParse(typeof item === "string" ? { text: item } : item);
    if (!r.success || !r.data.text) continue;
    const { text: words, open, show } = r.data;
    out.push({ text: words, ...(open ? { open } : {}), ...(show ? { show } : {}) });
    if (out.length === STEPS_MAX) break;
  }
  return out;
}

/** Mended, never refused: an unknown kind is "unknown", junk steps are no steps, long text is clipped. */
export const smartHelpAnswerSchema = z.object({
  language: z
    .string()
    .catch("en")
    .transform((s) => s.trim().slice(0, 20) || "en"),
  kind: z.enum(KINDS).catch("unknown"),
  title: text(120),
  steps: z.array(z.unknown()).catch([]).transform(mendSteps),
  note: z
    .string()
    .nullish()
    .catch(null)
    .transform((s) => s?.trim().slice(0, 600) || null),
  confidence: z
    .number()
    .catch(50)
    .transform((n) => Math.max(0, Math.min(100, Math.round(n)))),
});
export type SmartHelpAnswer = z.infer<typeof smartHelpAnswerSchema>;

export type SmartHelpReply = { kind: (typeof KINDS)[number]; title: string; steps: StepView[]; note: string | null };

// ── What the panel may show ──────────────────────────────────────────────────

/** The sidebar rows SmartHelp may light, href → label. Admin-preview rows are drawn for a few accounts only: left out. */
function sidebarRows(): Map<string, string> {
  const rows = new Map<string, string>();
  for (const item of NAV_SECTIONS.flatMap((s) => flattenNavItems(s.items))) {
    if (!item.preview && item.href !== "#" && !rows.has(item.href)) rows.set(item.href, item.label);
  }
  return rows;
}

let targetsMemo: ReadonlySet<string> | null = null;

/** Every Show me an answer may carry: the guides' targets, and `nav:<path>` for each SmartHelp page drawn as a row. */
export function helpTargets(): ReadonlySet<string> {
  if (!targetsMemo) {
    const rows = sidebarRows();
    targetsMemo = new Set([...GUIDE_TARGETS, ...HELP_PAGES.filter((p) => rows.has(p.path)).map((p) => `nav:${p.path}`)]);
  }
  return targetsMemo;
}

/** The buttons that cancel the plan or delete the account — an answer naming them is giving the person-only steps. */
const LEAVING_BUTTONS = /\b(Cancel subscription|Continue to cancel|Request a trial extension|Delete my account|Delete account|Downgrade)\b/;

function cleanStep(s: HelpStep, ctx: HelpContext, targets: ReadonlySet<string>): StepView {
  const open = s.open && isHelpPage(s.open) ? s.open : undefined;
  const show = s.show && targets.has(s.show) ? s.show : undefined;
  // A sidebar row is its page: a row the viewer may not open is blocked like an Open to it.
  const page = open ?? (show?.startsWith("nav:") ? show.slice(4) : undefined);
  const blocked = page ? stepView({ text: s.text, open: page }, ctx).blocked : undefined;
  if (blocked) return { text: s.text, blocked };
  return { text: s.text, ...(open ? { open } : {}), ...(show ? { show } : {}) };
}

/** The model's answer as the panel may show it. `targets` is helpTargets() (a parameter so a check can narrow it). */
export function cleanAnswer(a: SmartHelpAnswer, ctx: HelpContext, targets: ReadonlySet<string>): SmartHelpReply {
  const words = [a.title, a.note ?? "", ...a.steps.map((s) => s.text)].join("\n");
  if (commitsMoneyOrData(words) || LEAVING_BUTTONS.test(words)) return { kind: "person", title: PERSON_REPLY.person, steps: [], note: null };
  if (a.kind === "person") return { kind: "person", title: a.title || PERSON_REPLY.person, steps: [], note: a.note };
  if (a.kind === "unknown") return { kind: "unknown", title: a.title || UNKNOWN_REPLY, steps: [], note: a.note };
  if (a.confidence < CONFIDENCE_MIN) return { kind: "unknown", title: UNKNOWN_REPLY, steps: [], note: null };
  const steps = a.steps.map((s) => cleanStep(s, ctx, targets));
  if (steps.length) return { kind: a.kind, title: a.title, steps, note: a.note };
  if (a.note) return { kind: "explain", title: a.title, steps: [], note: a.note };
  return { kind: "unknown", title: UNKNOWN_REPLY, steps: [], note: null };
}

// ── What the model reads ─────────────────────────────────────────────────────

const RULES = `You are SmartHelp, the help panel inside JobFlex. JobFlex is software for contractors and trades businesses: estimators (roof, fence, deck, HVAC, video walkthroughs, blueprints, Smart Proposal), proposals, clients and leads, projects, jobs and crews, the calendar and online booking, texting and the AI desk, payments, and the subscription that pays for it. Someone at a contractor's company — the owner or one of their team — types a question into the panel. You tell them how to do it in JobFlex, as numbered steps they follow on the screen.

LANGUAGE
- Answer in the language of the question (Spanish in, Spanish out; Russian in, Russian out) and set "language" to its code ("en", "es", "ru" …).
- Keep JobFlex's button, tab and page names exactly as written in English in the GUIDES and the HANDBOOK, capitals and all — the screen prints them in English. In Spanish, for example: "Abre Financials y pulsa New invoice."

TRUTH
- Answer only from the GUIDES, the HANDBOOK and what the message says about the person. Name only pages, buttons, tabs and fields they name. Never invent a feature, a price, a limit, a plan, a date or a policy — a step that names something that isn't there is worse than no answer.
- When they don't cover the question: kind "unknown", no steps, and one line saying you're not sure and that Ask a person reaches our team.
- HVAC sizing in JobFlex is "Manual J-style" — always with the "-style".
- You cannot change anything in their account and never say you did or will: you show them where to do it themselves.
- No mention of AI, models, prompts, the handbook or the guides' ids. No code, no file names, no URLs and no app paths in the words — the Open button carries the page.

THE ANSWER
- kind "steps" — how to do something: 1 to 8 numbered steps, one action each, in the screen's words, each saying what they will see next.
- kind "explain" — how something works, when there is nothing to click through: the answer in "note", steps only if they help.
- A step may carry "open": a page from ALLOWED PAGES, copied exactly — the panel shows an Open button that goes there. And "show": a target from ALLOWED TARGETS, copied exactly — the panel's Show me lights that button, field or sidebar row. A target lives on its page, so give that page as "open" too (a sidebar row needs none). Give them only where they are true for that step; otherwise leave the keys out. Anything not in the lists is removed.
- When a GUIDE covers the question, give that guide's steps with their open and show, in the language of the question, and say in "note" that the guide "<its title, as written>" in SmartHelp has them too.
- Use what the message says about the person: something already set up is not set up again — say it's done and what comes next. A page their role can't open: the step says to ask the account owner. A page their plan doesn't include: say so — the owner can change the plan under Subscription.
- "title": a short heading in the language of the question (at most 120 characters). "note": one to three sentences, or null.
- "confidence": 0-100 — how sure you are that every step is right for JobFlex as the GUIDES and the HANDBOOK describe it. Under ${CONFIDENCE_MIN}, the panel shows no steps and offers a person instead.

ONLY A PERSON ANSWERS THESE — kind "person", "steps" empty. "title" and "note" say kindly that a person on our team will help and to press Ask a person (their question goes with it). Never explain how to do these, never give their steps — even where the HANDBOOK has them — and never promise anything. The owner's rules for support, word for word:
${PERSON_ONLY_TOPICS}
- Leaving: cancelling, pausing or ending the subscription, downgrading or moving to a cheaper plan, stopping the charges, closing or deleting the account — however it is said ("how do I cancel", "stop charging my card", "cancelar mi suscripción"). The owner's team answers these personally.
- Someone who shares a password, a card number or a code: kind "person", and the note tells them kindly not to share it — we never need it.
Showing them where they change a setting themselves is not changing it — that is your job. These are features, not person topics — answer them: updating the card on file, upgrading or switching to annual, a discount line on a proposal or an invoice, deleting a line item or a proposal, cancelling or moving a job, an appointment or a visit, changing their own password, inviting the team or changing a worker's role (not who owns the account).

OUTPUT — JSON only, exactly these keys:
{"language": "en", "kind": "steps"|"explain"|"person"|"unknown", "title": "…", "steps": [{"text": "…", "open": "a page from ALLOWED PAGES, or leave the key out", "show": "a target from ALLOWED TARGETS, or leave the key out"}], "note": "…" or null, "confidence": 0-100}`;

function pagesBlock(): string {
  return `ALLOWED PAGES — the only values "open" may take (page — what it is):\n${HELP_PAGES.map((p) => `- ${p.path} — ${p.name}`).join("\n")}`;
}

function targetsBlock(): string {
  const rows = sidebarRows();
  // Where each guide target lives: the page its guide step opens, or the last page the guide opened before it.
  const where = new Map<string, string>();
  for (const g of GUIDES) {
    let page: string | undefined;
    for (const s of g.steps) {
      page = s.open ?? page;
      if (s.show && !where.has(s.show)) where.set(s.show, page ? `on ${page} (guide "${g.title}")` : `in the guide "${g.title}"`);
    }
  }
  const lines = [...helpTargets()].map((t) =>
    t.startsWith("nav:") ? `- ${t} — the "${rows.get(t.slice(4))}" row in the sidebar` : `- ${t} — ${where.get(t)}`,
  );
  return `ALLOWED TARGETS — the only values "show" may take. A sidebar row is drawn only for people who may open its page:\n${lines.join("\n")}`;
}

function guidesBlock(): string {
  const group = { setup: "Set it up", how: "How it works" } as const;
  const guides = GUIDES.map((g) => {
    const steps = g.steps.map((s, i) => `${i + 1}. ${s.text}${s.open ? ` [open: ${s.open}]` : ""}${s.show ? ` [show: ${s.show}]` : ""}`);
    return `### ${g.title} (${group[g.group]})\n${steps.join("\n")}`;
  });
  return `GUIDES — SmartHelp's ready answers; the panel shows each as a button under "Set it up" or "How it works":\n\n${guides.join("\n\n")}`;
}

let systemMemo: string | null = null;

/** The whole system message — the same bytes for every person and question (prompt caching). */
export function smartHelpSystemPrompt(): string {
  if (systemMemo === null) {
    systemMemo = [
      RULES,
      pagesBlock(),
      targetsBlock(),
      guidesBlock(),
      `HANDBOOK — how JobFlex works, written from its code. The person never sees it; answer from it in your own words, keeping the screen's names:\n\n${customerHandbook()}`,
    ].join("\n\n");
  }
  return systemMemo;
}

const ROLE_WORDS: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MANAGER: "Manager",
  ACCOUNTANT: "Accountant",
  SALES: "Sales",
  ESTIMATOR: "Estimator",
  INSTALLER: "Installer (crew)",
  USER: "Team member",
};

const SETUP_WORDS: ReadonlyArray<[key: SetupKey, label: string, done: string, todo: string]> = [
  ["profile", "Company profile", "complete", "not complete"],
  ["aiDesk", "AI desk", "set up", "not set up"],
  ["texting", "Texting", "number verified", "not set up"],
  ["payments", "Payments", "connected", "not connected"],
  ["booking", "Online booking", "on", "off"],
  ["website", "Website estimators", "on", "off"],
  ["team", "Team", "invited", "nobody invited yet"],
  ["proposalSent", "First proposal", "sent", "not sent yet"],
];

const clip = (s: string, max: number) => s.trim().slice(0, max);

/** One HELP_PAGES entry per route (the first, e.g. "AI desk" for every /dashboard/phone link). */
function helpRoutes(): Array<{ route: string; name: string }> {
  const seen = new Map<string, string>();
  for (const p of HELP_PAGES) if (!seen.has(pathOf(p.path))) seen.set(pathOf(p.path), p.name);
  return [...seen].map(([route, name]) => ({ route, name }));
}

function pageWords(page: string): string {
  const p = page.trim().slice(0, 200);
  const hit = HELP_PAGES.find((x) => x.path === p.split("#")[0]) ?? HELP_PAGES.find((x) => x.path === pathOf(p));
  return hit ? `${hit.name} (${p})` : p || "unknown";
}

/** The pages this person's role or plan keeps them from, in words. Nothing when every page is open to them. */
function accessLines(ctx: HelpContext): string[] {
  const routes = helpRoutes().map((r) => ({ ...r, blocked: stepView({ text: "", open: r.route }, ctx).blocked }));
  const lines: string[] = [];
  const roleOpen = routes.filter((r) => r.blocked !== "role");
  if (roleOpen.length < routes.length) {
    lines.push(`- Pages their role can open: ${roleOpen.map((r) => r.name).join(", ") || "none"} — for any other page, they ask the account owner.`);
  }
  const planOff = routes.filter((r) => r.blocked === "plan");
  if (planOff.length) lines.push(`- Pages their plan doesn't include: ${planOff.map((r) => r.name).join(", ")}`);
  return lines;
}

/** The person, the conversation so far (the last HISTORY_TURNS turns) and the question, as the model reads them. */
export function smartHelpUserPrompt(input: { question: string; history: Array<{ q: string; a: string }>; ctx: HelpContext }): string {
  const { ctx } = input;
  const person = [
    `- On the page: ${pageWords(ctx.page)}`,
    `- Role: ${ctx.role ? (ROLE_WORDS[ctx.role] ?? ctx.role) : "unknown"}`,
    `- Plan: ${ctx.plan?.trim() || "none on file"}`,
    ...accessLines(ctx),
    ...SETUP_WORDS.map(([key, label, done, todo]) =>
      (key === "booking" || key === "website") && !ctx.features[key]
        ? `- ${label}: not open to this account`
        : `- ${label}: ${ctx.setup[key] ? done : todo}`,
    ),
  ];
  const parts = [`THE PERSON (from their account, accurate now):\n${person.join("\n")}`];
  const turns = input.history.slice(-HISTORY_TURNS);
  if (turns.length) {
    parts.push(
      `EARLIER IN THIS CONVERSATION (oldest first — build on it, don't repeat it):\n${turns.map((t) => `Q: ${clip(t.q, 1000)}\nA: ${clip(t.a, 2000)}`).join("\n\n")}`,
    );
  }
  parts.push(`THE QUESTION:\n${input.question.trim().slice(0, 1000)}`);
  return parts.join("\n\n");
}
