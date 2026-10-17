// The words for people: what broke, whom it gets in the way of, how to see it again. Written by
// rules (Russian, the owner's language); the cheap model rewrites them when it is available and
// may merge two findings that are one cause (index.ts applies that).
import type { Finding, Signal } from "./types";
import { pathOf } from "./signals";
import type { Llm } from "./llm";

const WHO: Record<string, string> = {
  signup: "новым клиентам — они не могут зарегистрироваться или оплатить",
  billing: "владельцам компаний — оплата, смена тарифа",
  smoke: "всем пользователям",
  roles: "пользователям с этой ролью",
  pages: "тем, кто открывает эти страницы",
  forms: "тем, кто заполняет эти формы",
  visual: "всем, кто видит эти страницы",
  perf: "всем на медленном телефоне или сети",
  logic: "тем, кто пользуется этой функцией (расчёты, правила)",
};

function steps(f: Omit<Finding, "human" | "title">, s: Signal): string[] {
  const route = f.evidence.routes[0] ?? (s.url ? pathOf(s.url) : null);
  const role = s.role ?? (s.suite === "pages" || s.suite === "visual" ? "owner" : null);
  const out: string[] = [];
  if (s.suite === "logic" || f.kind === "legacy") return [`Запустить: npm run qa -- --suite ${s.suite} --grep "${s.file.split("/").pop()}"`, "Прочитать вывод скрипта (outputs/ в папке прогона)."];
  if (role && role !== "guest") out.push(`Войти как ${role} (учётка QA_USER_${role.toUpperCase()}).`);
  if (route) out.push(`Открыть ${route}${s.project === "webkit" ? " в Safari/WebKit" : ""} на экране 390 px.`);
  if (s.step) out.push(`Шаг теста: «${s.step}».`);
  out.push(f.kind === "api-error" ? `Смотреть ответ сервера: ${s.method ?? "GET"} ${s.url ? pathOf(s.url) : ""} → ${s.status}.` : `Ожидать: ${s.message.slice(0, 140)}`);
  out.push(`Тот же тест: npm run qa -- --suite ${s.suite} --grep "${s.testTitle.replace(/@\w+/g, "").trim().slice(0, 60)}"`);
  return out;
}

export function ruleWords(f: Omit<Finding, "human" | "title">, list: Signal[]): Pick<Finding, "title" | "human"> {
  const s = list.find((x) => x.primary) ?? list[0];
  const n = f.evidence.tests.length;
  const where = f.evidence.routes.length ? ` (${f.evidence.routes.slice(0, 3).join(", ")}${f.evidence.routes.length > 3 ? ` и ещё ${f.evidence.routes.length - 3}` : ""})` : "";
  const many = n > 1 ? ` — роняет ${n} тестов` : "";
  const T: Record<string, string> = {
    "api-error": f.signature.startsWith("root ")
      ? `${f.signature.slice(5).replace(" @ ", " в ")} — сервер отвечает ${s.status} на ${f.evidence.routes.length || 1} стр.${many}`
      : `Сервер отвечает ${s.status} на ${s.method ?? "GET"} ${s.url ? pathOf(s.url) : ""}${many}`,
    "page-error": `Ошибка JavaScript на странице: ${s.message.slice(0, 90)}${many}`,
    network: `Запрос не доходит до ответа: ${s.message.slice(0, 90)}`,
    "console-error": `Ошибка в консоли браузера${where}: ${s.message.slice(0, 80)}`,
    timeout: `${s.extra?.testSide ? "Вероятно, ошибка теста — " : ""}Тест не дождался шага: ${s.message.slice(0, 90)}`,
    assertion: s.extra?.money ? `Деньги: ${s.message.replace(/^Error:\s*/, "").slice(0, 100)}` : `Проверка не прошла: ${s.testTitle.replace(/@\w+/g, "").trim().slice(0, 90)}`,
    access: f.severity === "P1" ? `Утечка доступа: страница открывается роли, которой нельзя${where}` : `Доступ к странице не такой, как в матрице${where}`,
    coverage: `QA потерял покрытие (${s.suite}): ${n} тест(ов) больше не проверяют то, что проверяли${where}`,
    "unknown-access": `Страницы, для которых не решено, кому они открыты (${n})`,
    layout: `Страница не помещается в экран 390 px${where}`,
    "broken-link": `Ссылка ведёт на несуществующую страницу: ${s.message.replace(/^link on the page leads to /, "").slice(0, 80)}${f.evidence.routes.length > 1 ? ` — видна на ${f.evidence.routes.length} страницах` : ""}`,
    slow: `Медленные страницы (${n})`,
    forms: `Форма${where}: ${s.message.slice(0, 90)}`,
    legacy: `Старая проверка ${s.file.split("/").pop()} падает: ${s.message.slice(0, 80)}`,
    visual: `Изменился внешний вид${where}`,
    a11y: `Доступность: ${s.message.slice(0, 90)} — на ${f.evidence.routes.length || n} страницах`,
    perf: `Lighthouse ниже порога${where}: ${s.message.replace(/^Lighthouse \w+: /, "")}`,
    forbidden: `Тест попытался нажать запрещённое действие: ${s.message.slice(0, 80)}`,
    environment: `Сервер под тестом пропадал во время прогона — ${n} тест(ов) упали из-за этого`,
  };
  const WHAT: Record<string, string> = {
    "api-error": "Запрос к серверу заканчивается ошибкой — страница или действие, которые на него опираются, не работают.",
    "page-error": "В браузере выброшено необработанное исключение: часть страницы может не отрисоваться или не реагировать.",
    network: "Браузер не получил ответа на запрос.",
    "console-error": "Страница работает, но пишет ошибку в консоль — признак сломанной части (картинка, скрипт, запрос).",
    timeout: "Ожидаемый элемент или переход не появился вовремя.",
    assertion: "То, что видит человек, не совпало с ожидаемым.",
    access: "Роль получает не тот ответ (открыто / вход / запрет / перенаправление), что записан в qa/config/access-matrix.yaml.",
    coverage: "QA Lab сам перестал проверять то, что проверял в прошлом прогоне: форма больше не находится или тест пропущен. Зелёный отчёт здесь ничего не значит, пока причина не найдена (обычно — поиск формы в qa/lib/forms.ts или условие пропуска теста).",
    "unknown-access": "Этих страниц нет в матрице доступа: нужно решить и вписать, кому они открыты.",
    layout: "На телефоне появляется горизонтальная прокрутка или элементы обрезаны краем экрана.",
    "broken-link": "Ссылка на странице ведёт на 404 или ошибку.",
    slow: "Страница грузится дольше порога из qa/config/qa.config.yaml даже на прогретом сервере.",
    forms: "Форма принимает неверные данные или не говорит человеку, что не так.",
    legacy: "Одна из перенесённых старых проверок (логика, расчёты) не проходит.",
    visual: "Скриншот отличается от эталона больше порога.",
    a11y: "axe-core нашёл серьёзную проблему доступности (экранные дикторы, контраст, подписи).",
    perf: "Оценка Lighthouse ниже порога. На dev-сервере performance всегда ниже, чем в production.",
    forbidden: "Защита остановила действие из forbidden.yaml; нужно поправить тест или подпись кнопки.",
    environment: "Соединение с сервером отказано или оборвано (или упал браузер теста) — это не дефект продукта. Эти тесты нужно перепрогнать на стабильном сервере.",
  };
  return {
    title: T[f.kind] ?? s.message.slice(0, 100),
    human: { what: WHAT[f.kind] ?? s.message, whoIsAffected: WHO[s.suite] ?? "пользователям", steps: steps(f, s) },
  };
}

type ModelWords = { findings: { id: string; title: string; what: string; whoIsAffected: string; steps: string[]; severity: string; severityWhy: string; sameCauseAs: string | null }[] };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "what", "whoIsAffected", "steps", "severity", "severityWhy", "sameCauseAs"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          what: { type: "string" },
          whoIsAffected: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
          severity: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
          severityWhy: { type: "string" },
          sameCauseAs: { type: ["string", "null"] },
        },
      },
    },
  },
};

const SYSTEM = `You turn automated test findings for JobFlex (a SaaS for contractors: proposals, estimators, jobs, billing) into a QA report for the product owner.
Write in Russian, plainly, for a non-programmer: what broke, who it gets in the way of, and how to see it again in 2–5 steps.
Severity: P0 — a person cannot sign up, sign in or pay; P1 — a key function does not work; P2 — works with a defect; P3 — cosmetic, speed, warnings.
Keep the given severity unless the evidence clearly says otherwise; say why in severityWhy (Russian, one sentence).
If two findings are clearly the SAME root cause (e.g. a 500 from an API and the page error it causes on the same pages), set sameCauseAs of the lesser one to the id of the other; otherwise null.
Never invent facts that are not in the evidence. Keep titles under 90 characters.`;

/** The cheap model rewrites the words of up to 40 findings at a time (P0 first). */
export async function modelWords(llm: Llm, findings: Finding[]): Promise<Map<string, ModelWords["findings"][number]>> {
  const out = new Map<string, ModelWords["findings"][number]>();
  if (!llm.available) return out;
  for (let i = 0; i < findings.length; i += 40) {
    const chunk = findings.slice(i, i + 40).map((f) => ({
      id: f.id, kind: f.kind, severity: f.severity, severityWhy: f.severityWhy, title: f.title,
      evidence: { message: f.evidence.message.slice(0, 600), tests: f.evidence.tests.slice(0, 8).map((t) => t.title), testCount: f.evidence.tests.length, routes: f.evidence.routes.slice(0, 8), alsoSeen: f.evidence.alsoSeen.slice(0, 4) },
      draftSteps: f.human.steps,
    }));
    const res = await llm.json<ModelWords>({ model: "cheap", system: SYSTEM, text: JSON.stringify({ findings: chunk }, null, 1), schema: SCHEMA, maxTokens: 12000 });
    for (const w of res?.findings ?? []) out.set(w.id, w);
  }
  return out;
}
