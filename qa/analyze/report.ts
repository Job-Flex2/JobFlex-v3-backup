// report.md and report.html — the same content: summary → findings P0 → P3 → speed by page →
// role × page → visual differences. report.html is one self-contained file (styles inline,
// pictures embedded, shrunk), so it can be stored and shown as is (stage 2: the admin).
import fs from "node:fs";
import path from "node:path";
import type { RawRun } from "../lib/raw";
import { dataUri, shrinkPng } from "./images";
import { SEVERITIES, type Analysis, type Finding } from "./types";

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mdEsc = (s: unknown) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const dur = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)} мин ${Math.round((ms % 60_000) / 1000)} с` : `${Math.round(ms / 1000)} с`);
const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
const SEV_NAME = { P0: "P0 — нельзя зарегистрироваться / войти / оплатить", P1: "P1 — ключевая функция не работает", P2: "P2 — работает с дефектом", P3: "P3 — косметика, скорость, предупреждения" };
const loc = (f: Finding) => (f.location ? `${f.location.file}${f.location.line ? ":" + f.location.line : ""}` : "не найдено");
const histBadge = (f: Finding) => (!f.history ? "" : f.history.stale ? `застарелое (${f.history.seenRuns} прогона подряд)` : f.history.status === "new" ? "новое" : f.history.status === "returned" ? "вернулось" : `осталось (${f.history.seenRuns}-й прогон)`);

// ── Markdown ────────────────────────────────────────────────────────────────
export function renderMarkdown(a: Analysis, raw: RawRun): string {
  const s = a.summary;
  const L: string[] = [];
  L.push(`# QA Lab — отчёт прогона ${a.runId}`, "");
  L.push(`Сервер: ${s.baseUrl} (${s.target}) · коммит ${raw.run.git.commit ?? "?"}${raw.run.git.dirty ? " + незакоммиченные правки" : ""} · наборы: ${raw.run.suites.join(", ")}`, "");
  L.push("## Сводка", "");
  L.push(`| Тестов | Прошло | Упало | Пропущено | Нестабильных | Длительность | Стоимость анализа |`, `|---|---|---|---|---|---|---|`);
  L.push(`| ${s.tests.total} | ${s.tests.passed} | ${s.tests.failed} | ${s.tests.skipped} | ${s.tests.flaky} | ${dur(s.durationMs)} | ${usd(a.cost.usd)} (${a.cost.mode === "model" ? `${a.cost.calls} вызов(ов) модели` : "без модели"}) |`, "");
  L.push(`Находки: **P0 ${s.findings.P0}** · **P1 ${s.findings.P1}** · P2 ${s.findings.P2} · P3 ${s.findings.P3} · известные ложные (known-issues.yaml): ${s.known}`, "");
  L.push(s.previousRun ? `С прошлым прогоном (${s.previousRun}): новых ${s.diff.new}, исчезло ${s.diff.gone}, осталось ${s.diff.still}, застарелых ${s.diff.stale}.` : "Прошлого проанализированного прогона нет — все находки новые.", "");
  if (s.gone.length) L.push(`Исчезли: ${s.gone.map((g) => `${g.id} ${g.severity} ${mdEsc(g.title)}`).join("; ")}`, "");
  L.push("| Набор | Тестов | Прошло | Упало | Пропущено |", "|---|---|---|---|---|");
  for (const [k, v] of Object.entries(s.bySuite)) L.push(`| ${k} | ${v.total} | ${v.passed} | ${v.failed} | ${v.skipped} |`);
  L.push("");
  if (a.notes.length) L.push(...a.notes.map((n) => `> ${n}`), "");

  for (const sev of SEVERITIES) {
    const list = a.findings.filter((f) => f.severity === sev);
    if (!list.length) continue;
    L.push(`## ${SEV_NAME[sev]} (${list.length})`, "");
    for (const f of list) {
      L.push(`### ${f.id} · ${mdEsc(f.title)}`, "");
      L.push(`*${f.severity}: ${mdEsc(f.severityWhy)}* · ${histBadge(f)} · тестов: ${f.evidence.tests.length}`, "");
      L.push("| Для человека | Откуда это известно |", "|---|---|");
      const human = [`**Что сломалось.** ${mdEsc(f.human.what)}`, `**Кому мешает.** ${mdEsc(f.human.whoIsAffected)}`, `**Как воспроизвести.** ${f.human.steps.map((x, i) => `${i + 1}) ${mdEsc(x)}`).join(" ")}`, f.human.screenshot ? `**Скриншот:** [${f.human.screenshot}](${f.human.screenshot})` : ""].filter(Boolean).join("<br><br>");
      const ev = [`**Ошибка:** \`${mdEsc(f.evidence.message.slice(0, 400))}\``, f.evidence.stack ? `**Стек:** \`${mdEsc(f.evidence.stack.split("\n").slice(0, 4).join(" ⏎ ").slice(0, 500))}\`` : "", `**Тесты:** ${f.evidence.tests.slice(0, 8).map((t) => `${mdEsc(t.title)} [${t.project}]`).join("; ")}${f.evidence.tests.length > 8 ? ` и ещё ${f.evidence.tests.length - 8}` : ""}`, f.evidence.routes.length ? `**Страницы:** ${f.evidence.routes.slice(0, 10).join(", ")}` : "", `**raw.json:** ${f.evidence.rawRefs.slice(0, 5).join(", ")}`, `**Место в коде:** ${loc(f)}${f.location ? ` — ${mdEsc(f.location.why)} (${f.location.confidence}, ${f.location.source})` : ""}${f.locationNote ? ` · ${mdEsc(f.locationNote)}` : ""}`, f.evidence.alsoSeen.length ? `**Ещё видно:** ${f.evidence.alsoSeen.map(mdEsc).join("; ")}` : "", `**Подпись:** \`${mdEsc(f.signature)}\``].filter(Boolean).join("<br><br>");
      L.push(`| ${human} | ${ev} |`, "");
      if (f.fixPrompt) L.push("<details><summary>Промпт на починку для Claude Code</summary>", "", "```text", f.fixPrompt, "```", "", "</details>", "");
    }
  }
  if (!a.findings.length) L.push("## Находок нет", "");

  L.push("## Скорость по страницам", "");
  const pages = a.perf.filter((p) => p.coldMs !== undefined).sort((x, y) => (y.warmMs ?? 0) - (x.warmMs ?? 0));
  if (pages.length) {
    L.push("| Страница | Роль | Первая загрузка, мс | Прогретая, мс |", "|---|---|---|---|");
    for (const p of pages.slice(0, 60)) L.push(`| ${p.route} | ${p.role} | ${p.coldMs} | ${p.warmMs} |`);
    if (pages.length > 60) L.push(`| … ещё ${pages.length - 60} | | | |`);
    L.push("");
  }
  const lh = a.perf.filter((p) => p.lighthouse);
  if (lh.length) {
    L.push("| Lighthouse | Устройство | Performance | Accessibility | Best practices | LCP, мс | TBT, мс | CLS |", "|---|---|---|---|---|---|---|---|");
    for (const p of lh) L.push(`| ${p.route} | ${p.viewport} | ${p.lighthouse!.performance ?? "—"} | ${p.lighthouse!.accessibility ?? "—"} | ${p.lighthouse!["best-practices"] ?? "—"} | ${Math.round(p.metrics?.lcpMs ?? 0) || "—"} | ${Math.round(p.metrics?.tbtMs ?? 0)} | ${(p.metrics?.cls ?? 0).toFixed?.(3) ?? "—"} |`);
    L.push("");
  }
  if (!pages.length && !lh.length) L.push("В этом прогоне не было наборов pages и perf.", "");

  L.push("## Роль × страница", "");
  if (a.matrix.routes.length) {
    L.push(`Значения: open · login · forbidden · not-found · redirect:… · error:…; ✗ — не совпало с матрицей, ? — клетка помечена для ручной проверки.`, "");
    L.push(`| Страница | ${a.matrix.roles.join(" | ")} |`, `|---|${a.matrix.roles.map(() => "---").join("|")}|`);
    for (const r of a.matrix.routes) L.push(`| ${r} | ${a.matrix.roles.map((role) => { const c = a.matrix.cells[r]?.[role]; return c ? `${c.actual}${c.ok ? "" : c.expected ? ` ✗ (ожидалось ${c.expected})` : " ✗ (нет в матрице)"}${c.review ? " ?" : ""}` : "—"; }).join(" | ")} |`);
    L.push("");
  } else L.push("В этом прогоне не было набора roles.", "");

  L.push("## Визуальные диффы", "");
  if (a.visual.length) {
    L.push("| Страница | Экран | Роль | Изменилось | Вердикт | Почему | Принять эталон |", "|---|---|---|---|---|---|---|");
    for (const v of a.visual) L.push(`| ${v.route} | ${v.viewport} | ${v.role} | ${(v.ratio * 100).toFixed(2)}% | ${v.verdict} (${v.reviewedBy}) | ${mdEsc(v.why)} | \`${v.accept}\` · [было](${v.before}) / [стало](${v.after}) / [дифф](${v.diff}) |`);
    L.push("", "Принять все намеренные: `npm run qa:accept -- --intended`", "");
  } else L.push("Отличий от эталонов сверх порога нет (или набор visual не запускался; первый прогон создаёт эталоны).", "");

  L.push("## Стоимость анализа", "");
  L.push(`${usd(a.cost.usd)} из бюджета ${usd(a.cost.budgetUsd)} · вызовов ${a.cost.calls} · токенов на вход ${a.cost.inputTokens}, на выход ${a.cost.outputTokens}${a.cost.stoppedForBudget ? " · остановлено по бюджету" : ""}`);
  for (const [m, v] of Object.entries(a.cost.byModel)) L.push(`- ${m}: ${v.calls} вызов(ов), ${usd(v.usd)}`);
  if (a.hiddenByKnown.length) L.push("", `Скрыто как известные ложные: ${a.hiddenByKnown.map((h) => `${h.id} (${h.knownId})`).join(", ")}`);
  return L.join("\n") + "\n";
}

// ── HTML ────────────────────────────────────────────────────────────────────
function img(runDir: string, rel: string | undefined, w = 420, h = 900): string {
  if (!rel) return "";
  const file = path.isAbsolute(rel) ? rel : path.join(runDir, rel);
  try { return `<img src="${dataUri(shrinkPng(fs.readFileSync(file), w, h))}" alt="">`; } catch { return ""; }
}

const CSS = `:root{--paper:#f6f3ec;--card:#fff;--ink:#14161a;--muted:#5b6170;--line:#d9d4c7;--p0:#b3261e;--p1:#c25e00;--p2:#8a6d00;--p3:#3b6e8f;--ok:#2e7d4f;--mono-bg:#f1eee6;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);line-height:1.45;font-size:15px}
main{max-width:1180px;margin:0 auto;padding:24px 16px 64px}h1{font-size:24px;margin:0 0 4px}h2{font-size:19px;margin:36px 0 12px;border-bottom:2px solid var(--ink);padding-bottom:6px}h3{font-size:16px;margin:0}
.meta{color:var(--muted);font-size:13px}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:16px 0}.kpi{background:var(--card);border:1.5px solid var(--ink);padding:10px 12px}.kpi b{display:block;font-size:22px}.kpi span{font-size:12px;color:var(--muted)}
.sev{display:inline-block;font-weight:700;font-size:12px;padding:2px 7px;color:#fff;border-radius:2px}.P0{background:var(--p0)}.P1{background:var(--p1)}.P2{background:var(--p2)}.P3{background:var(--p3)}
.finding{background:var(--card);border:1.5px solid var(--ink);margin:14px 0;padding:14px}.finding header{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin-bottom:10px}.badge{font-size:12px;color:var(--muted);border:1px solid var(--line);padding:1px 6px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media (max-width:760px){.cols{grid-template-columns:1fr}}.col h4{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
pre,code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px}pre{background:var(--mono-bg);padding:10px;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:6px 0;max-height:320px}
.col img{max-width:100%;border:1px solid var(--line);margin-top:6px}ol{margin:4px 0 0;padding-left:20px}details{margin-top:10px}summary{cursor:pointer;font-weight:600}
table{border-collapse:collapse;width:100%;background:var(--card);font-size:13px}th,td{border:1px solid var(--line);padding:5px 7px;text-align:left;vertical-align:top}th{background:#ece8dd;position:sticky;top:0}
.wrap{overflow:auto;max-height:640px;border:1.5px solid var(--ink)}.bad{background:#fbe3e1}.rev{background:#fff4d6}.cell-open{color:var(--ok)}
.vis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.vis img{width:100%;border:1px solid var(--line)}.note{background:#fff4d6;border-left:4px solid var(--p2);padding:8px 12px;margin:6px 0}`;

export function renderHtml(a: Analysis, raw: RawRun, runDir: string): string {
  const s = a.summary;
  const h: string[] = [];
  h.push(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA Lab ${esc(a.runId)}</title><style>${CSS}</style></head><body><main>`);
  h.push(`<h1>QA Lab — отчёт прогона ${esc(a.runId)}</h1><div class="meta">${esc(s.baseUrl)} (${esc(s.target)}) · коммит ${esc(raw.run.git.commit ?? "?")}${raw.run.git.dirty ? " + незакоммиченные правки" : ""} · наборы: ${esc(raw.run.suites.join(", "))} · анализ ${esc(a.analyzedAt.slice(0, 16).replace("T", " "))} UTC</div>`);
  h.push(`<h2>Сводка</h2><div class="kpis">`);
  const k = (v: unknown, l: string) => h.push(`<div class="kpi"><b>${esc(v)}</b><span>${esc(l)}</span></div>`);
  k(s.tests.total, "тестов"); k(s.tests.passed, "прошло"); k(s.tests.failed, "упало"); k(s.tests.skipped, "пропущено"); k(s.tests.flaky, "нестабильных"); k(dur(s.durationMs), "длительность");
  k(`${s.findings.P0} / ${s.findings.P1} / ${s.findings.P2} / ${s.findings.P3}`, "находки P0 / P1 / P2 / P3"); k(s.known, "известные ложные"); k(usd(a.cost.usd), a.cost.mode === "model" ? `анализ, ${a.cost.calls} вызовов` : "анализ без модели");
  h.push(`</div><p>${s.previousRun ? `С прошлым прогоном (${esc(s.previousRun)}): новых <b>${s.diff.new}</b>, исчезло <b>${s.diff.gone}</b>, осталось <b>${s.diff.still}</b>, застарелых <b>${s.diff.stale}</b>.` : "Прошлого проанализированного прогона нет — все находки новые."}</p>`);
  if (s.gone.length) h.push(`<p class="meta">Исчезли: ${s.gone.map((g) => `${esc(g.id)} ${esc(g.severity)} ${esc(g.title)}`).join("; ")}</p>`);
  h.push(`<table><tr><th>Набор</th><th>Тестов</th><th>Прошло</th><th>Упало</th><th>Пропущено</th></tr>${Object.entries(s.bySuite).map(([n, v]) => `<tr><td>${esc(n)}</td><td>${v.total}</td><td>${v.passed}</td><td${v.failed ? ' class="bad"' : ""}>${v.failed}</td><td>${v.skipped}</td></tr>`).join("")}</table>`);
  for (const n of a.notes) h.push(`<div class="note">${esc(n)}</div>`);

  for (const sev of SEVERITIES) {
    const list = a.findings.filter((f) => f.severity === sev);
    if (!list.length) continue;
    h.push(`<h2>${esc(SEV_NAME[sev])} · ${list.length}</h2>`);
    for (const f of list) {
      h.push(`<section class="finding" id="${esc(f.id)}"><header><span class="sev ${f.severity}">${f.severity}</span><h3>${esc(f.title)}</h3><span class="badge">${esc(f.id)}</span><span class="badge">${esc(histBadge(f))}</span><span class="badge">тестов: ${f.evidence.tests.length}</span></header>`);
      h.push(`<div class="cols"><div class="col"><h4>Для человека</h4><p><b>Что сломалось.</b> ${esc(f.human.what)}</p><p><b>Кому мешает.</b> ${esc(f.human.whoIsAffected)}</p><p><b>Как воспроизвести</b></p><ol>${f.human.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>${img(runDir, f.human.screenshot)}</div>`);
      h.push(`<div class="col"><h4>Откуда это известно</h4><p class="meta">${esc(f.severity)}: ${esc(f.severityWhy)}</p><pre>${esc(f.evidence.message.slice(0, 1500))}</pre>${f.evidence.stack ? `<details><summary>Стек</summary><pre>${esc(f.evidence.stack.slice(0, 4000))}</pre></details>` : ""}`);
      h.push(`<p><b>Тесты:</b> ${f.evidence.tests.slice(0, 12).map((t) => `${esc(t.title)} <span class="meta">[${esc(t.project)}]</span>`).join("; ")}${f.evidence.tests.length > 12 ? ` и ещё ${f.evidence.tests.length - 12}` : ""}</p>`);
      if (f.evidence.routes.length) h.push(`<p><b>Страницы:</b> ${f.evidence.routes.slice(0, 16).map(esc).join(", ")}</p>`);
      h.push(`<p><b>Место в коде:</b> <code>${esc(loc(f))}</code>${f.location ? ` — ${esc(f.location.why)} <span class="meta">(${esc(f.location.confidence)}, ${esc(f.location.source)})</span>` : ""}${f.locationNote ? ` <span class="meta">${esc(f.locationNote)}</span>` : ""}</p>`);
      if (f.evidence.alsoSeen.length) h.push(`<p><b>Ещё видно в этих тестах:</b> ${f.evidence.alsoSeen.map(esc).join("; ")}</p>`);
      h.push(`<p class="meta">raw.json: ${f.evidence.rawRefs.slice(0, 6).map(esc).join(", ")} · подпись: <code>${esc(f.signature)}</code></p></div></div>`);
      if (f.fixPrompt) h.push(`<details><summary>Промпт на починку для Claude Code</summary><pre>${esc(f.fixPrompt)}</pre></details>`);
      h.push(`</section>`);
    }
  }
  if (!a.findings.length) h.push(`<h2>Находок нет</h2>`);

  h.push(`<h2>Скорость по страницам</h2>`);
  const pages = a.perf.filter((p) => p.coldMs !== undefined).sort((x, y) => (y.warmMs ?? 0) - (x.warmMs ?? 0));
  if (pages.length) h.push(`<div class="wrap"><table><tr><th>Страница</th><th>Роль</th><th>Первая загрузка, мс</th><th>Прогретая, мс</th></tr>${pages.map((p) => `<tr><td>${esc(p.route)}</td><td>${esc(p.role)}</td><td>${p.coldMs}</td><td${(p.warmMs ?? 0) > 8000 ? ' class="bad"' : ""}>${p.warmMs}</td></tr>`).join("")}</table></div>`);
  const lh = a.perf.filter((p) => p.lighthouse);
  if (lh.length) h.push(`<p></p><table><tr><th>Lighthouse</th><th>Устройство</th><th>Performance</th><th>Accessibility</th><th>Best practices</th><th>LCP, мс</th><th>TBT, мс</th><th>CLS</th></tr>${lh.map((p) => `<tr><td>${esc(p.route)}</td><td>${esc(p.viewport)}</td><td>${p.lighthouse!.performance ?? "—"}</td><td>${p.lighthouse!.accessibility ?? "—"}</td><td>${p.lighthouse!["best-practices"] ?? "—"}</td><td>${Math.round(p.metrics?.lcpMs ?? 0) || "—"}</td><td>${Math.round(p.metrics?.tbtMs ?? 0)}</td><td>${(p.metrics?.cls ?? 0).toFixed(3)}</td></tr>`).join("")}</table><p class="meta">На dev-сервере performance заметно ниже production (без минификации, компиляция по запросу).</p>`);
  if (!pages.length && !lh.length) h.push(`<p class="meta">В этом прогоне не было наборов pages и perf.</p>`);

  h.push(`<h2>Роль × страница</h2>`);
  if (a.matrix.routes.length) {
    h.push(`<p class="meta">open · login · forbidden · not-found · redirect:… · error:… — <span class="bad">&nbsp;красным&nbsp;</span> не совпало с qa/config/access-matrix.yaml, <span class="rev">&nbsp;жёлтым&nbsp;</span> клетка помечена для ручной проверки.</p><div class="wrap"><table><tr><th>Страница</th>${a.matrix.roles.map((r) => `<th>${esc(r)}</th>`).join("")}</tr>`);
    for (const r of a.matrix.routes) h.push(`<tr><td>${esc(r)}</td>${a.matrix.roles.map((role) => { const c = a.matrix.cells[r]?.[role]; if (!c) return "<td>—</td>"; return `<td class="${!c.ok ? "bad" : c.review ? "rev" : ""}" title="${esc(c.expected ? "ожидалось " + c.expected : "нет в матрице")}">${esc(c.actual)}${!c.ok ? `<br><span class="meta">≠ ${esc(c.expected ?? "нет в матрице")}</span>` : ""}</td>`; }).join("")}</tr>`);
    h.push(`</table></div>`);
  } else h.push(`<p class="meta">В этом прогоне не было набора roles.</p>`);

  h.push(`<h2>Визуальные диффы</h2>`);
  if (a.visual.length) {
    for (const v of a.visual) h.push(`<section class="finding"><header><h3>${esc(v.route)} · ${esc(v.viewport)} px · ${esc(v.role)}</h3><span class="badge">${(v.ratio * 100).toFixed(2)}%</span><span class="sev ${v.verdict === "bug" ? "P1" : v.verdict === "intended" ? "P3" : "P2"}">${esc(v.verdict)}</span><span class="meta">${esc(v.reviewedBy)}</span></header><p>${esc(v.why)}</p><div class="vis"><div>было${img(runDir, v.before, 360, 1400)}</div><div>стало${img(runDir, v.after, 360, 1400)}</div><div>дифф${img(runDir, v.diff, 360, 1400)}</div></div><p>Принять новый эталон: <code>${esc(v.accept)}</code></p></section>`);
    h.push(`<p>Принять все намеренные: <code>npm run qa:accept -- --intended</code></p>`);
  } else h.push(`<p class="meta">Отличий от эталонов сверх порога нет (или набор visual не запускался; первый прогон создаёт эталоны).</p>`);

  h.push(`<h2>Стоимость анализа</h2><p>${usd(a.cost.usd)} из бюджета ${usd(a.cost.budgetUsd)} · вызовов ${a.cost.calls} · токенов: ${a.cost.inputTokens} на вход, ${a.cost.outputTokens} на выход${a.cost.stoppedForBudget ? " · <b>остановлено по бюджету</b>" : ""}</p>`);
  if (Object.keys(a.cost.byModel).length) h.push(`<ul>${Object.entries(a.cost.byModel).map(([m, v]) => `<li>${esc(m)}: ${v.calls} вызовов, ${usd(v.usd)}</li>`).join("")}</ul>`);
  if (a.hiddenByKnown.length) h.push(`<p class="meta">Скрыто как известные ложные: ${a.hiddenByKnown.map((x) => `${esc(x.id)} (${esc(x.knownId)})`).join(", ")}</p>`);
  h.push(`</main></body></html>`);
  return h.join("\n");
}
