// SmartHelp · THE PERSON-TOPIC GUARD — the questions only a person answers, caught before the model so no call is
// made: leaving (cancel, downgrade, stop the charges), money (refunds, credits, discounts on the bill), data (deleting
// the account or all of it), security (someone in the account, a secret pasted in), a person (asked for, ownership,
// the law, anger). English, Spanish and some Russian. Pure regexes; lib/smarthelp/answer re-exports it.
//
// PRECISION FIRST (controller's ruling, 2026-10-30). A false positive here blocks a real how-to with no model call at
// all; a miss still meets the model's own rules, commitsMoneyOrData and the cancel/delete button guard after it
// (cleanAnswer). So a pattern goes in only when no feature question says it the same way: a contractor cancels jobs
// and visits, offers discounts, refunds a homeowner's deposit, forwards calls to a live person, changes a lead's
// owner — none of that is a person topic. Patterns said of their own account ("cancel my plan", "I want my money
// back") always count; looser ones count only when the question names nothing of the contractor's work, clients,
// team or AI desk (featureContext).

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

// ── What makes a question about the contractor's work, not their own account ─

/** Their clients and callers, and anything that is theirs. */
const CLIENT_SIDE =
  /\b(clients?|customers?|homeowners?|clientes?|callers?|service plans?|maintenance plans?|their (card|plan|account|subscription|membership))\b/;
/** Their team. */
const TEAM_SIDE =
  /\b(team|teams|members?|crew|crews|workers?|employees?|staff|subcontractors?|subs|reps?|roles?|users?|technicians?|techs?|installers?|trabajador(es)?|empleados?|equipo|cuadrilla)\b/;
/** The AI desk and the phone. */
const DESK_SIDE = /\b(ai desk|desk|callers?|calls|forward\w*|receptionist|voicemail|after hours|business (number|line)|phone (line|number))\b/;
/** Their work and its documents. */
const WORK_DOC =
  /\b(jobs?|appointments?|visits?|bookings?|reservations?|proposals?|invoices?|estimates?|quotes?|meetings?|events?|orders?|tasks?|contracts?|leads?|projects?|reminders?|inspections?|deposits?|lines?|items?|financ\w*|wisetack|loans?|payment links?|referrals?|depositos?|anticipos?|propuestas?|presupuestos?|facturas?|cotizacion\w*|trabajos?|citas?|visitas?|proyectos?)\b/;
/** Their own people, said so that "the JobFlex team" or "your team" doesn't count ("help from a person on my crew"). */
const CREW = /\b(crews?|workers?|employees?|staff|subcontractors?|installers?|technicians?|techs?|my team|our team)\b/;
const someoneElses = (q: string) => CLIENT_SIDE.test(q) || TEAM_SIDE.test(q);
const featureContext = (q: string) => someoneElses(q) || DESK_SIDE.test(q) || WORK_DOC.test(q);

// ── Leaving ──────────────────────────────────────────────────────────────────

const MINE = "(?:my|our|mi|mis|nuestra|nuestro)";
const FILLER = "(?:the|this|a|an|whole|entire|current|free|paid|monthly|yearly|annual|jobflex|jobflex's|pro|professional|starter|advanced|la|el|de|del|una|un)";
/** Their JobFlex plan — never a plan set or a plan sheet (the blueprint and deck plans). */
const PLAN = "plan(?! (?:sets?|sheets?|pages?|views?|drawings?|reviews?|checks?))";
/** The contractor's own JobFlex: the plan, the subscription, an add-on, the account, the trial. */
const OWN_THING = `(?:${PLAN}|subscriptions?|account|membership(?! plans?)|trial|billing|renewal|auto-?renew\\w*|add-?ons?|deck studio(?! (?:designs?|drawings?|projects?|proposals?|links?))|jobflex|service(?! (?:calls?|visits?|plans?|appointments?|requests?|tickets?|area|radius|menu|desk))|suscripcion|subscripcion|cuenta|membresia|prueba|servicio)`;

/** Said of their own account — counts whatever else the question says. */
const LEAVING_MINE: RegExp[] = [
  new RegExp(`\\bcancel\\w*\\s+${MINE}\\s+(?:${FILLER}\\s+){0,2}${OWN_THING}\\b`),
  new RegExp(`\\b(close|deactivate|shut down|shutdown|terminate|suspend|pause|freeze|end)\\s+${MINE}\\s+(jobflex\\s+)?(account|subscription|membership(?! plans?)|${PLAN})\\b`),
  /\bstop (charging|billing) (me|us|my card|our card|my account)\b/,
  new RegExp(`\\b(don'?t|do not|never) (auto-?)?renew ${MINE} (subscription|membership|account|${PLAN})\\b`),
  new RegExp(`\\bdowngrad\\w* ${MINE} (subscription|account|${PLAN})\\b`),
  // Spanish
  /\bcerrar (mi|nuestra) cuenta\b/,
  /\b(pausar|suspender|congelar|terminar|finalizar) (mi|nuestra) (suscripcion|subscripcion|cuenta|membresia|plan)\b/,
  /\bno (renovar|renueven|renueve) (mi|nuestra) (suscripcion|subscripcion|membresia|cuenta|plan)\b/,
  /\bdar(me|nos) de baja\b/,
  /\b(dejar|dejo|dejamos|deje) (de usar )?jobflex\b/,
  /\bno quiero seguir (pagando|usando|con jobflex)\b(?! (a|al) )/,
  // Russian
  /отмен[а-я]*\s+(мо[а-я]*\s+)?подписк/,
  /закрыт[а-я]*\s+(мо[а-я]*\s+)?(аккаунт|акк|учетн)/,
];
/** Said more loosely — counts only when nothing in the question is the contractor's work, clients, team or desk. */
const LEAVING: RegExp[] = [
  new RegExp(`\\bcancel\\w*\\s+(?:${FILLER}\\s+){0,3}${OWN_THING}\\b`),
  /\bstop (charging|billing)( me| us)?\s*($|[.?!,;])/,
  new RegExp(`\\bstop (the (charges|billing|subscription|renewal)|my (subscription|membership|payments|billing|renewal|${PLAN})|paying)\\b`),
  /\b(don'?t|do not|never) (charge|bill) (me|us|my card)\b/,
  /\b(don'?t|do not) want to (be )?(charged|billed|pay)\b/,
  /\bno more (charges|payments|billing)\b/,
  /\b(turn off|disable|stop|cancel) (the |my )?(auto-?renew\w*|automatic (renewal|billing|payments?|charges?))\b/,
  /\b(turn off|stop|disable|pause|end) (the |my |all )?billing\b(?! (emails?|reminders?|notifications?|alerts?|texts?|messages?))/,
  /\bdowngrad\w*/,
  /\b(switch|move|go|change|put|drop)( me| us)?( back| down)? (to|onto) (the |a )?(free|cheaper|cheapest|lower|smaller|starter) ?(plan|tier|version|one|subscription|$|[.!?,])/,
  new RegExp(`\\bget off (the |my |our )?(paid |current )?(subscription|${PLAN})\\b`),
  /\b(close|deactivate|shut down|shutdown|terminate|suspend|pause|freeze)\s+(the\s+)?(jobflex\s+)?(account|subscription|membership)\b/,
  /\b(quit|quitting|leave|leaving|stop using|done with|get rid of)\s+jobflex\b(?! (a |an |some )?(reviews?|ratings?|feedback|comments?|notes?|messages?))/,
  /\bi('m| am) (leaving|quitting|done with (jobflex|this))\b/,
  new RegExp(`\\b(don'?t|do not|no longer) (want|need) (jobflex|this (app|software|subscription|${PLAN})|the (subscription|${PLAN})|my (subscription|${PLAN}))\\b`),
  /\bunsubscribe\b(?!.*\b(emails?|notifications?|digests?|newsletters?|texts?|sms|alerts?|reminders?|messages?|mailing)\b)/,
  // Spanish
  /\bdar(se)? de baja\b/,
  /\bcerrar (la )?cuenta\b/,
  /\b(dejar|dejen|deje) de (cobrar|pagar)\w*/,
  /\bno (me |nos )?(cobren|cobres|cobre)\b/,
  /\bno quiero (que me cobren|pagar)\b/,
  /\bya no (quiero|queremos|necesito) (pagar|usar|jobflex|la suscripcion|el plan|el servicio(?=\s*($|[.?!,])| de jobflex))/,
  /\bbajar (de |mi |el )?plan\b/,
  /\bplan (mas barato|gratis|gratuito)\b/,
  // Russian
  /отписат/,
  /понизит[а-я]*\s+тариф/,
  /перейти на (бесплатн|дешевл)/,
];
/** "Cancel" with nothing after it but a word like "now" or "please" before the sentence ends — "How do I cancel? I
 *  don't use the calendar" — and nothing of the contractor's work before it in that sentence ("How do clients cancel?"). */
const BARE_CANCEL =
  /\bcancel\w*(?=(?:\s+(?:now|please|today|anytime|any time|online|right now|immediately|asap|for good|completely|everything|all|ya|ahora|hoy|por favor|todo))*\s*(?:$|[.?!;,]))/g;
function bareCancel(q: string): boolean {
  for (const m of q.matchAll(BARE_CANCEL)) {
    const before = q.slice(0, m.index).split(/[.?!;]/).pop() ?? "";
    if (!featureContext(before)) return true;
  }
  return false;
}

// ── Money ────────────────────────────────────────────────────────────────────

/** Their own money — counts unless the question is about a client's or the team's. */
const MONEY_MINE: RegExp[] = [
  /\brefund (me|us)\b/,
  /\b(my|our) refund\b/,
  /\brefund (my|our) (money|payment|subscription|plan|charge|account|membership|last|latest|month)\b/,
  /\b(i|we) (want|need|would like|'d like|deserve|expect|demand) (a|my|our|some|full) refund\b/,
  /\b(can|could|may) (i|we) (get|have) (a|my|our|full) refund\b/,
  /\b(my|our) money back\b/,
  /\b(get|have|want) (my|our) (last |latest |first |recent )?(payment|money|charge)s? back\b/,
  /\b(can|could|would|will) you (please )?waive\b/,
  /\bcredit (me|us)\b/,
  /\bcredit (my|our) (account|card|bill)\b/,
  /\bcredits? (to|on|for|back to) (my|our) (account|bill|subscription|plan)\b/,
  /\b(extend|extension of|longer|more days on) (my|our|the) (free )?trial\b/,
  /\bdiscounts? (on|for|off|to) (my|our) (bill|billing|subscription|plan|membership|renewal|account)\b/,
  /\b(i|we) (was|were|have been|'ve been|got|am being|'m being) (charged|billed) (twice|two times|double|again|by mistake|wrongly|without)/,
  /\byou (charged|billed) (me|us)\b/,
  /\b(compensate|reimburse) (me|us)\b/,
  // Spanish
  /\b(mi|nuestro) dinero de vuelta\b/,
  /\b(devolver(me|nos)?|devuelv\w*|devolucion (de|del)) (mi |el |nuestro )?(dinero|pago|cargo|cobro)\b/,
  /\bdevuelvan(me|nos)\b/,
  /\bme cobraron (dos veces|de mas|doble|sin autorizacion|sin permiso|sin avisar)\b/,
  /\b(quiero|necesito|quisiera) (un|mi) reembolso\b/,
  /\breembolsen(me|nos)?\b/,
  /\bdescuento (en|para|de) (mi|nuestra) (factura|suscripcion|plan|cuenta|membresia|mensualidad)\b/,
  // Russian
  /верн[а-я]*\s+(мне\s+|мои\s+)?деньг/,
  /возврат[а-я]*\s+(денег|средств|оплат)/,
];
/** Money words said loosely, and asking for a better price — only when nothing in the question is the work. A
 *  request is "can I/we get…" or "can you give/offer…"; "can I offer a discount" is the contractor's feature. */
const MONEY: RegExp[] = [
  /\brefund\w*/,
  /\breimburs\w*/,
  /\bmoney back\b/,
  /\bchargeback\w*/,
  /\bdisput\w* (a |the |this |my )?(charge|payment|bill)/,
  /\b(charged|billed)( me)? (twice|two times|double|again|by mistake|wrongly|without)/,
  /\bdouble[- ]?(charged|billed|charge)\b/,
  /\bover-?charg\w*/,
  /\bunauthori[sz]ed (charge|payment)/,
  /\bfraud\w*/,
  /\b(free|extra) months?\b/,
  /\baccount credit\b/,
  /\bwaive (my|our|this month'?s?|the (monthly |subscription )?(fee|charge|payment|bill))\b/,
  /\bdiscounts? (on|for|off|to) the (bill|billing|subscription|plan|membership|renewal|account|jobflex)\b/,
  /\b(want|deserve|expect|owed?|ask for) (some |a |any )?(compensation|reimbursement)\b/,
  /\b(give|get|issue|owe|want|offer)( me| us)? (a |some |any )?credit\b(?! (cards?|scores?|checks?|approvals?|lines?|limits?|reports?))/,
  /\b(can|could|may|would|will) (i|we) (get|have|receive) (a |any |some )?(discount|better price|lower price|cheaper price|deal)\b/,
  /\b(can|could|would|will) you (give|offer)( me| us)? (a |any |some )?(discount|deal|better price|lower price)\b/,
  /\b(give|offer) (me|us) (a |any |some )?(discount|deal|better price)\b/,
  // Spanish
  /\breembols\w*/,
  /\bcobro (doble|indebido)\b/,
  /\bmes(es)? gratis\b/,
  /\b(me|nos) (pueden|puede|podrian|podria|dan|da) (dar |hacer )?(un )?descuento\b/,
];

// ── Data ─────────────────────────────────────────────────────────────────────

/** What may follow "delete my account": the end, or words that keep it the whole account ("permanently", "and …"). */
const WHOLE =
  "(?=\\s*($|[.?!,;])|\\s+(and|but|so|because|since|for good|forever|permanently|completely|entirely|please|now|today|right away|asap|for me|from (jobflex|your (system|database|platform|servers|records)))\\b)";
/** The account, the company or all of it — never a logo, a profile picture or one line. Not a client's or a worker's. */
const DATA: RegExp[] = [
  new RegExp(`\\b(delete|erase|wipe|remove|purge|destroy)\\s+(all\\s+(of\\s+)?)?(my|our)\\s+(jobflex\\s+)?(account|company|business|organi[sz]ation|org|data|information|info|personal (data|information|info)|records|history|workspace)${WHOLE}`),
  new RegExp(`\\b(delete|erase|wipe|remove|purge)\\s+the\\s+(jobflex\\s+)?(account|company|organi[sz]ation|workspace)${WHOLE}`),
  /\b(delete|erase|wipe|remove|purge)\s+(it\s+)?(all|everything)(\s+(of\s+)?(my|our)\s+(data|information|info|stuff|records))?(?=\s*($|[.!?,])|\s+(from|in|on|at)\s+(my|our|the)\s+(account|company|jobflex|system|database)|\s+(about|for)\s+(me|us|my company)|\s+(permanently|forever|for good|and close))/,
  /\b(want|need|like)\b.{0,10}\b(all\s+)?(of\s+)?(my|our)\s+(data|information|info)\b.{0,15}\b(gone|erased|deleted|wiped|removed)\b/,
  /\bgdpr\b|\bccpa\b|\bright to be forgotten\b|\bdata deletion\b/,
  // Spanish
  /\b(borrar|eliminar|suprimir|borra|elimina|borren|eliminen|borre|elimine)\s+(toda\s+|todos\s+)?(mi|mis|nuestra|nuestros|nuestras|la)\s+(cuenta|datos|informacion|empresa|compania|negocio)\b/,
  /\b(borrar|eliminar|borren|eliminen) todo(?=\s*($|[.!?,])|\s+(de|en) (mi|la) (cuenta|empresa))/,
  // Russian
  /удал[а-я]*\s+(мо[а-я]*\s+|все\s+)?(аккаунт|акк|учетн|данн)/,
];

// ── Security ─────────────────────────────────────────────────────────────────

/** Someone in their account, a stolen login, a secret pasted into the box or asked for. */
const SECURITY: RegExp[] = [
  /\b(hacked|hacker|hackers|hack into|hacking into)\b/,
  /\bcompromised\b/,
  /\b(data breach|security breach|breached)\b/,
  /\bphish\w*/,
  /\bunauthori[sz]ed (access|log ?-?in|sign[- ]?in|user|person|use)\b/,
  /\bsuspicious (log ?-?in|sign[- ]?in|activity|email|access)\b/,
  /\b(stolen|stole)\b.{0,30}\b(account|password|login|card)\b|\b(account|password|login|card)\b.{0,30}\b(stolen|stole)\b/,
  /\b(my|the) (password|passcode|pin|verification code|one-?time code|login code|code) ?(is|:|=) ?["']?(?=\S*[\d!@#$%^&*])\S{4,}/,
  /\b\d{4}([ -]?)\d{4}\1\d{4}\1\d{1,7}\b|\b\d{13,19}\b/,
  /\b(emails?|texts?|messages?|calls?|sms)\b.{0,40}\b(asking|asked|asks|wants|wanted|requesting|requested) (me )?(for )?(my|our) (jobflex )?(password|code|login|card( number)?)\b/,
  // Spanish
  /\b(hackearon|hackeado|hackeada|me robaron)\b/,
  /\balguien (entro|accedio|inicio sesion|esta usando|uso) (a |en )?(mi|nuestra) cuenta\b/,
  // Russian
  /взлом/,
];
/** "Someone got into my account" — but someone on their own team signing in is the team guide. */
const SOMEONE_IN_MY_ACCOUNT = /\b(someone|somebody|a stranger|an? unknown (person|user))\b.{0,40}\b(my|our) (account|login|password|email)\b/;
const OWN_PEOPLE = /\b(team|crew|workers?|employees?|staff|partner|manager|members?)\b/;

// ── A person ─────────────────────────────────────────────────────────────────

/** Asking for a person in words no feature uses. */
const PERSON_MINE: RegExp[] = [
  /^(i want to |i'd like to |let me |can i |i need to |please )?ask a (real |live )?person\b(?! (on|in|from|at) )/,
  /\b(can|could|would|will) (someone|somebody|anyone|a person|you)( from (jobflex|support|your team))? (please )?(call|phone|ring) me( back)?( please| today| now| asap| about (this|it|my (account|plan|bill|subscription)))?\s*($|[.?!,])/,
  /\b(speak|talk) (to|with) (your (manager|supervisor|boss)|a supervisor)\b/,
  /\b(sue|suing) (you|jobflex)\b|\b(subpoena|small claims|class action|better business bureau)\b/,
  // Spanish
  /\balguien (me|nos) (llame|llama|pueda llamar|puede llamar)\b/,
  /\bllamen(me|nos)\b/,
  /\b(una|poner|presentar) demanda\b/,
  // Russian ("живой" folds to "живои", "поддержкой" to "поддержкои")
  /(поговорить|связаться|соедините)\s+с\s+(живым\s+)?(человеком|оператором|поддержко[иы]|менеджером)/,
  /жив(ои|ого|ым)\s+человек/,
];
/** A person asked for in words the AI desk also uses ("a live person", "talk to someone") — not about callers or clients. */
const PERSON_ASKED: RegExp[] = [
  /\b(a|real|live|actual) human\b|\bhuman being\b|\b(real|live|actual) (person|agent)\b/,
  /\bhelp from (a |an )?(real |live |actual )?(person|human)\b/,
  /\bcustomer (service|support)\b(?! (hours?|lines?|numbers?|emails?|pages?|teams?|phone))/,
  /\b(contact|reach|get (hold of|in touch with)) (support|you|jobflex( support)?|your (support|team)|the (support |jobflex )?team|customer support)\b/,
  /\b(email|phone number|number) (for|of|to) (support|jobflex)\b/,
  /\b(talk|speak|chat)\s+(to|with)\s+(an?\s+|some\s+|the\s+)?(real\s+|live\s+|actual\s+)?(human|person|agent|representative|operator|someone|somebody|support)\b/,
  // Spanish
  /\bhablar con (una |un |alguna |algun |el |la )?(persona|humano|agente|representante|asesor|operador|alguien|soporte)\b/,
  /\b(persona real|ser humano|atencion al cliente|servicio al cliente)\b/,
];
/** Who owns the account — never the owner of a lead, a job or the phone number. */
const OWNERSHIP: RegExp[] = [
  /\btransfer\w*\s+(the\s+|my\s+|our\s+)?(ownership|account|company|business)\b(?! (number|phone|line|calls?|leads?|name))/,
  /\b(change|switch|replace|transfer)\s+(the\s+)?(account owner|ownership|owner of (the|my|our) (account|company|business|jobflex))\b/,
  /\b(change|switch|replace)\s+(the\s+)?owner\s*($|[.?!,])/,
  /\bnew (account )?owner\b/,
  /\badd (an?|another|a second|a new) (co-?)?owners?\b|\bco-?owners?\b/,
  /\bmake\s+(?!sure\b)(\S+\s+){1,3}(the|an?|co-?)\s*owners?\b(?!'s)/,
  /\b(sold|selling|sell)\s+(my|the|our)\s+(business|company)\b/,
  // Spanish
  /\btransferir (la )?(cuenta|propiedad|empresa)\b/,
  /\b(cambiar|nuevo) (el )?(dueno|propietario)( de (la|mi) (cuenta|empresa))?\s*($|[.?!,])/,
];
/** The law and anger — unless it's the work talking ("scam calls", "a client's lawyer"). */
const LAW_OR_ANGER: RegExp[] = [
  /\b(lawyer|attorney|lawsuit|legal action|legal team)\b/,
  /\b(scam\w*|rip[- ]?off|ripped off|wtf|f+u+c+k\w*|bullshit)\b/,
  /\b(abogad\w*|demandar\w*|estafa\w*)\b/,
  /юрист|адвокат|мошенни/,
];

/** A question only a person answers, said any way we know (English, Spanish, some Russian), or null. Precision
 *  first: features that sound alike — a discount line, a credit card, cancelling a job, a live person on the AI desk —
 *  are null, and the model's rules catch what this misses. */
export function personTopic(question: string): PersonTopic | null {
  const q = fold(question);
  if (!q) return null;
  const any = (rs: RegExp[]) => rs.some((r) => r.test(q));
  const work = featureContext(q);
  if ((!CLIENT_SIDE.test(q) && any(SECURITY)) || (SOMEONE_IN_MY_ACCOUNT.test(q) && !OWN_PEOPLE.test(q))) return "security";
  if (any(LEAVING_MINE) || (!work && any(LEAVING)) || bareCancel(q)) return "leaving";
  if ((!someoneElses(q) && any(MONEY_MINE)) || (!work && any(MONEY))) return "money";
  if (!someoneElses(q) && any(DATA)) return "data";
  if (any(PERSON_MINE)) return "person";
  if (!CLIENT_SIDE.test(q) && !DESK_SIDE.test(q) && !CREW.test(q) && any(PERSON_ASKED)) return "person";
  if (!DESK_SIDE.test(q) && !WORK_DOC.test(q) && any(OWNERSHIP)) return "person";
  if (!work && any(LAW_OR_ANGER)) return "person";
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
