# QA Lab

Прогон проверок JobFlex и ИИ-анализ результатов для человека. Этап 1: локальный запуск и отчёт.
Этап 2 (кнопка и отчёты в админке) опирается на `.github/workflows/qa-lab.yml` и на то, что
`raw.json` и `report.html` — самодостаточные файлы.

```
qa/
  bin/        qa.ts (запуск) · analyze.ts · accept.ts · selftest.ts · seed-roles.ts
  lib/        фикстуры, фоновый сбор, защита, роли, матрица, репортер → raw.json
  analyze/    анализ: группировка, важность, место в коде, визуальные пары, история, отчёты
  config/     qa.config.yaml · access-matrix.yaml · forbidden.yaml · known-issues.yaml · legacy.yaml
  tests/      <набор>/*.spec.ts · legacy.spec.ts (старые скрипты) · _lib (их общие помощники) · _archive
  tools/      legacy/ — старые утилиты без проверок (скриншоты, отладка)
  baselines/  эталоны набора visual (создаются первым прогоном; в git не кладутся — размер)
  auth/       сохранённые входы ролей (в git не кладутся)
  runs/       прогоны: <дата-время>/raw.json, report.*, screenshots/, traces/, … (в git не кладутся)
```

## Установка (один раз)

```bash
npm install            # корень: tsx, Prisma-клиент
npm run qa:install     # qa/: Playwright, Lighthouse, axe-core, SDK Anthropic + браузеры Chromium и WebKit
npm run qa:seed-roles  # локальные учётки manager / worker / admin в QA Co (пароли — из .env.local)
```

В `.env.local` (он в .gitignore; имена — в `.env.example`):

```
QA_TEST_MODE=1                 # тестовый режим приложения (коды для @qa.jobflex.test — эндпоинту)
QA_SECRET=<случайная строка>   # заголовок x-qa-secret для GET /api/qa/otp
QA_USER_OWNER=qa@acme.test     QA_PASS_OWNER=…
QA_USER_MANAGER=…  QA_PASS_MANAGER=…   QA_USER_WORKER=…  QA_PASS_WORKER=…   QA_USER_ADMIN=…  QA_PASS_ADMIN=…
ANTHROPIC_API_KEY=…            # необязательно: без него анализ идёт по правилам, без модели
```

## Запуск

Сначала dev-сервер (он читает `QA_TEST_MODE` и `QA_SECRET` из `.env.local`):

```bash
npm run dev                                  # в отдельном терминале
```

Потом:

```bash
npm run qa:smoke                             # 15 главных проверок, ~1–3 минуты
npm run qa                                   # всё: все наборы + старые скрипты (около часа)
npm run qa -- --suite signup                 # один набор (или несколько: --suite signup,billing)
npm run qa -- --suite pages --grep /dashboard/jobs   # часть набора
npm run qa:analyze                           # анализ последнего прогона → report.html / report.md
```

Сервер берётся из `QA_BASE_URL`, иначе — первый локальный порт из `devPorts` (qa.config.yaml),
который отвечает как JobFlex. Сервер QA Lab не запускает: если его нет, скажет, как запустить.

На `next dev` наборы perf (Lighthouse) и старый mobile-sweep (сравнение dev ↔ prod) пропускаются —
отчёт говорит об этом одной строкой. Полный прогон на прод-сборке, без падений dev-сервера:

```bash
npm run qa:build-run                          # next build → next start на свободном порту → npm run qa → стоп
npm run qa:build-run -- --suite smoke,pages   # те же аргументы, что у npm run qa
```

Сборка — в `.cache/next-qa-build`; порты 3000/3001/3005/3008 не занимаются; у поднятого сервера
обнулены живой Stripe, почта, Twilio и Meta CAPI (остаются тестовый Stripe и `stripe:mode=test`).
Если `next build` падает на чужих незакоммиченных правках, прогон не начинается и `src/` не трогается.
Журнал сервера — `runs/<прогон>/server.log`; сервер, который минуту не отвечает, перезапускается
на том же порту, и отчёт говорит об этом строкой. Ошибку сервера прод-сборка показывает браузеру
только digest'ом — анализ находит её имя по `server.log`, а функцию — по месту `throw new …` в `src/`
(та же находка, что на dev: `NoOrgError в resolveOrg`). Страницы только для dev (`devOnlyRoutes` в
qa.config.yaml, сейчас `/dev/*`) на прод-сборке обязаны отвечать 404. Эталоны visual для прод-сборки —
отдельно, в `qa/baselines/prod/` (первый прод-прогон их создаёт).

Тест, который ждёт ошибочный ответ (например, 404 на несуществующей странице), объявляет его:
`qa.expectStatus(404)` или тег `@expects-404` — такие ответы и строки консоли о них не становятся находками.

**Наборы** (теги): `@smoke` `@signup` `@billing` `@roles` `@pages` `@forms` `@visual` `@perf`
и `@logic` — перенесённые проверки движков и правил без браузера. Всё, что пришло из
`scripts/qa`, дополнительно помечено `@legacy`. WebKit запускает только тесты с тегом `@webkit`.

Billing: смена года на месяц **во время триала** происходит сразу (ничего не оплачено) — так задумано; оплаченный год переходит на месяц в конце периода.

**Против production** работают только smoke, pages (гостевые страницы) и perf; signup, billing,
forms, roles отказываются в коде (`lib/target.ts`): и в `bin/qa.ts` до старта, и в фикстуре
каждого теста. Production — это `VERCEL_ENV=production`, хосты из `productionHosts` и любой
нелокальный хост без `QA_TARGET_ENV=preview`. Тесты с тегом `@writes` против production пропускаются.

## Тестовый режим приложения

`QA_TEST_MODE=1` + `QA_SECRET`, и не Vercel production:
- коды подтверждения для адресов `*@qa.jobflex.test` не уходят письмом, а хранятся 10 минут
  (SyncState `qa-otp:<email>`) и отдаются `GET /api/qa/otp?email=…` с заголовком `x-qa-secret`;
- никакие письма на `*@qa.jobflex.test` не отправляются.

Выключен (или `VERCEL_ENV=production`) — эндпоинт отвечает 404 и ничего не хранится.
Независимо от режима аккаунты `*@qa.jobflex.test` не попадают в статистику админки
(`lib/statsHidden`), в PostHog и в Meta (сервер — `lib/qaTestMode`, браузер — `lib/qaEmail`).

## Что собирается на каждом тесте

Без отдельных тестов, через фикстуры (`lib/fixtures.ts`, `lib/collect.ts`): ошибки и
предупреждения консоли, необработанные исключения, ответы 4xx/5xx, упавшие и зависшие запросы,
время загрузки, скриншот при падении (поля паролей и кодов замазаны), trace при падении
(кроме signup/billing — там trace выключен: в нём был бы код). Всё — в `raw.json` с
привязкой к тесту и шагу. Пароли, токены, cookie и коды маскируются (`lib/redact.ts`).

## Как добавить тест в набор

```ts
// qa/tests/<набор>/<что>.spec.ts
import { test, expect, open } from "../../lib/fixtures";
test.use({ role: "owner" });                       // guest · owner · manager · worker · admin · homeowner
test("что проверяем @pages", async ({ page, qa }) => {
  await open(page, "/dashboard/jobs");
  await expect(page.locator("h1")).toBeVisible();
  qa.meta({ route: "/dashboard/jobs" });            // попадёт в raw.json
});
```

Тег набора в названии обязателен. Пишет в базу — добавь `@writes`. Действие, которое нельзя
выполнять никогда, — в `config/forbidden.yaml`, а не в тест.

## Как добавить роль

1. Имя роли — в `lib/roles.ts` (`ROLES`, `DEFAULT_USERS`).
2. Учётка: `QA_USER_<ROLE>` / `QA_PASS_<ROLE>` в `.env.local` и место в `bin/seed-roles.ts`
   (или готовый вход: `qa/auth/<role>.<host>.json`).
3. `npm run qa -- --suite roles --update-matrix` — в матрицу добавится столбец; проверь клетки
   из `review`.

## Матрица доступа

`config/access-matrix.yaml` — что каждая роль получает на каждой странице (`open`, `login`,
`forbidden`, `not-found`, `redirect:<путь>`, `error:<код>`; варианты через `|`). Список страниц
строится из `src/app/**/page.tsx` при каждом прогоне: новой страницы нет в матрице — находка
«неизвестный доступ». Первую матрицу сгенерировал прогон по текущему поведению; клетки в
`review` требуют решения человека — впиши его в `why` (не начиная с `auto:`) и убери `review`.

## Эталоны (visual)

Первый прогон набора visual создаёт `qa/baselines/<экран>/<роль>/<страница>.png`. Дальше разница
больше `visual.maxDiffRatio` — падение, а в `runs/<прогон>/baselines-diff/<id>/` лежат
`before.png / after.png / diff.png`. Принять новый эталон:

```bash
npm run qa:accept -- 390--owner--dashboard-jobs        # id — в отчёте рядом с диффом
npm run qa:accept -- --intended                        # все, что анализ счёл намеренными
```

## Ложные срабатывания

Подтверждённую ложную находку впиши в `config/known-issues.yaml` (по `signature` / `message` /
`test` / `route`, регулярки). Анализ её не показывает, а считает строкой «известные ложные».

## Анализ

`npm run qa:analyze [-- --run <папка>] [--offline] [--budget 2]` → `analysis.json`, `report.md`,
`report.html` в папке прогона. Дешёвая модель (`analysis.cheapModel`) пишет тексты и объединяет
находки с одной причиной, сильная (`analysis.strongModel`) — ищет место в коде для P0–P2 и
решает спорные визуальные пары. Бюджет — `analysis.budgetUsd`; при превышении анализ
дописывает остальное по правилам. Стоимость — в отчёте. `npm run qa:selftest` проверяет анализ
на трёх заготовленных прогонах (`analyze/fixtures`, пересоздаются `npx tsx qa/analyze/fixtures/make.ts`).

## Где отчёты

`qa/runs/<дата-время>/report.html` (один файл, картинки внутри) и `report.md` рядом с `raw.json`.

## Старые скрипты (scripts/qa)

Перенесены сюда 2026-10-14, таблица — `config/legacy.yaml`. Живые запускаются
`tests/legacy.spec.ts` по одному (они делят QA Co), их вывод — в `runs/<прогон>/outputs/`.
`node qa/tests/_lib/run-all.js` работает как раньше. В `scripts/qa` остались переходники для
`scripts/billing` и локальных скриптов, которые подключают `scripts/qa/_qa` и т. п.

SMS не уходят ни из одного старого скрипта: пакет `twilio` подменён записывающей заглушкой
(`tests/_lib/_no-sms.js`, подключается раннером; ключи Twilio не обнуляются). В проверках через
`_actionHarness` код подтверждения пишется в `sentSms()` (`_stubs/sms-verify.js`) — тест проверяет,
что отправка была и с каким текстом, а не что SMS дошла.

## Этап 2

`.github/workflows/qa-lab.yml` — ручной запуск (workflow_dispatch, вход `base_url`), ставит
зависимости, гоняет наборы и анализ, выкладывает `report.html` и `raw.json` артефактом.
Триггеров на push нет.
