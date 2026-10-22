# QA Lab в CI

Что гоняется автоматически, против чего, и что надо включить руками. Сам QA Lab описан в [qa/README.md](../qa/README.md).

> **Сейчас (2026-10-22, решение владельца): работает только ночной прогон.** Smoke на каждый Preview-деплой выключен: в [preview-smoke.yml](../.github/workflows/preview-smoke.yml) триггер `deployment_status` заменён на `workflow_dispatch` (job при ручном запуске пропускается — ему нужен deployment_status). Переменные Vercel для Preview (`QA_TEST_MODE`, `QA_SECRET`), Protection Bypass (`VERCEL_AUTOMATION_BYPASS_SECRET`) и required check `preview-smoke` **не нужны и не ставятся**. Вернуть: одна строка `deployment_status:` вместо `workflow_dispatch:` в preview-smoke.yml, затем секреты и required check из разделов ниже, помеченных «только для preview-smoke».

| Когда | Workflow → job | Против чего | Наборы | Блокирует |
| --- | --- | --- | --- | --- |
| ~~каждый успешный **Preview**-деплой Vercel~~ **выключено** | [preview-smoke.yml](../.github/workflows/preview-smoke.yml) → `preview-smoke` | URL этого деплоя | lint:changed, typecheck, smoke (только Chromium) | — (required check не ставится) |
| каждую ночь, 09:00 UTC (02:00 в Лос-Анджелесе летом, 01:00 зимой) | [qa-lab.yml](../.github/workflows/qa-lab.yml) → `qa` | production, `https://www.jobflex.app`; гостевые страницы + проверки `@readonly` под `qa@acme.test` (QA Co на проде) | smoke, pages, perf | — (алерт команде) |
| каждую ночь, там же | qa-lab.yml → `nightly-billing` | `next dev`, который job поднимает сам на чистой SQLite-базе | signup, billing (Stripe test mode, test clocks) | — |
| руками (Run workflow) | qa-lab.yml → `qa` | любой `base_url` | что впишешь (на production код пустит только smoke, pages, perf) | — |

## Окружение Preview — что выяснено (2026-10-22; нужно только если вернуть preview-smoke)

- **Preview ходит в боевую базу.** В Vercel `DATABASE_URL` (и все `PG*` / `POSTGRES_*`) — одна запись на «Preview, Production», отдельной ветки Neon для превью нет. Поэтому smoke на превью **ничего не создаёт**: тесты с тегом `@writes` (регистрация, переход в Checkout, Smart Proposal, отправка proposal) QA guard пропускает с причиной «skipped against a preview on the production database» ([qa/lib/target.ts](../qa/lib/target.ts)). Они идут на локальном сервере и в ночном `nightly-billing`. Если у превью появится своя база — выставь в preview-smoke.yml `QA_ALLOW_PREVIEW_WRITES: "1"`.
  Что всё-таки пишет на превью: вход `qa@acme.test` (строка тормоза входа в SyncState) и открытие `/dashboard/crm` — страница сама дописывает стартовые правила follow-up в QA-организацию, если их нет (идемпотентно).
- **На Preview стоит живой Stripe.** `STRIPE_SECRET_KEY` и `STRIPE_ALLOW_LIVE_WRITES` заданы на «Preview, Production». Любой Checkout на превью был бы live. Smoke его там не открывает (тег `@writes`), а `cs_live_` в любом тесте прерывается ([qa/config/forbidden.yaml](../qa/config/forbidden.yaml)).
- **Превью закрыто Vercel Authentication** (302 на `vercel.com/sso-api`). Нужен Protection Bypass for Automation (см. ниже).
- **У main не бывает превью.** Push в main сразу деплоится как Production, превью получают только другие ветки (например `jobflex-v3-git-customer-development-…`).
- **Репозиторий `PHILLyaHI/JobFlex-v3-backup` публичный.** Логи Actions и артефакты (report.html, raw.json, скриншоты) видны всем. Секреты в логах маскируются, отчёты прогоняются через [qa/lib/redact.ts](../qa/lib/redact.ts), но на скриншотах — страницы QA-организации и адреса превью.

## Секреты GitHub (Settings → Secrets and variables → Actions)

| Секрет | Кто читает | Что это |
| --- | --- | --- |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | только preview-smoke — **сейчас не нужен** | Vercel → проект jobflex-v3 → Settings → **Deployment Protection** → **Protection Bypass for Automation** → Add/Generate secret. QA Lab шлёт его в заголовке `x-vercel-protection-bypass` только на сам деплой ([qa/lib/vercel.ts](../qa/lib/vercel.ts)) |
| `QA_PASS_OWNER` | qa (ночной), preview-smoke | пароль `qa@acme.test` **в боевой базе** — тот, с которым запускали `scripts/seed-qa-prod.ts`. **Нужен ночному прогону** для проверок `@readonly` (см. ниже). Без него они пропускаются, прогон остаётся зелёным, но дашборд не проверяется |
| `QA_USER_ADMIN`, `QA_PASS_ADMIN` | preview-smoke; qa — только не против production (**ночью не нужны**) | QA-аккаунт с `isPlatformAdmin` в боевой базе, для `/admin/health`. Без него тест пропускается. Такой аккаунт видит всю платформу, так что заводи его осознанно |
| `QA_SECRET` | qa (алерт), preview-smoke | **нужен ночному прогону**: им подписывается `POST /api/qa/alert`, значение = `QA_SECRET` в Vercel **Production** |
| `QA_ALERT_SECRET` | qa | необязательно: вместо `QA_SECRET`, если для алерта нужен отдельный |
| `STRIPE_TEST_SECRET_KEY` | nightly-billing | тестовый ключ Stripe `sk_test_…` / `rk_test_…`. Любой другой отклоняется (в workflow и в [qa/lib/stripeTest.ts](../qa/lib/stripeTest.ts)). Без него nightly-billing пропускается |
| `ANTHROPIC_API_KEY` | qa, nightly-billing | необязательно: анализ отчёта моделью. В preview-smoke отчёт строится только правилами (`--offline`) |
| `QA_PASS_MANAGER`, `QA_PASS_WORKER` | qa (руками) | как было: роли для не-production целей |

## Переменные Vercel (Project → Settings → Environment Variables)

| Переменная | Окружение | Значение | Зачем |
| --- | --- | --- | --- |
| `QA_TEST_MODE` | **только Preview** — сейчас **не нужен** | `1` | тестовый режим: коды для `@qa.jobflex.test` не уходят письмом, их отдаёт `GET /api/qa/otp`. На Production код его игнорирует (`VERCEL_ENV=production`), но ставить туда не нужно |
| `QA_SECRET` | Preview — сейчас **не нужен** | длинная случайная строка (как `QA_SECRET` в GitHub) | заголовок `x-qa-secret` для `/api/qa/otp` |
| `QA_SECRET` | Production — **нужен ночному алерту** | то же значение, что `QA_SECRET` в GitHub (или своё — тогда это `QA_ALERT_SECRET` в GitHub) | открывает только `POST /api/qa/alert`. `/api/qa/otp` на production остаётся 404 |

После добавления переменных нужен новый деплой, чтобы он их подхватил.

## Required check «preview-smoke» — не ставится

Пока preview-smoke выключен, required check **не ставится**: проверка не запускается, и правило с ней заблокировало бы каждый PR. Ниже — как включить, если preview-smoke вернут.

Имя проверки — имя job: `preview-smoke` (поле `name:` в preview-smoke.yml).

1. Дождаться, чтобы preview-smoke прошёл хотя бы раз: GitHub предлагает в списке только проверки, которые уже запускались.
2. GitHub → репозиторий → **Settings → Branches → Add branch protection rule** (или **Rules → Rulesets → New branch ruleset**), шаблон ветки `main`.
3. Включить **Require status checks to pass before merging**, найти в поиске `preview-smoke`, добавить.
4. Сохранить.

Что из этого следует:
- PR в main мержится только с зелёным `preview-smoke` на последнем коммите ветки.
- Production-деплои job пропускает (условие `environment` начинается с `Preview`). Пропущенный job GitHub считает успехом.
- Если деплой Vercel упал, smoke не запустится, и проверка будет висеть «Expected». Так и задумано: несобранная ветка не мержится.
- Прямой push в main правило тоже затронет. Чтобы и дальше пушить в main напрямую, не включай «Do not allow bypassing the above settings», или добавь себя в bypass list у ruleset.

## Ночной прогон: какой адрес и почему

- **A. Последнее превью ветки main** (`vercel ls`, свежий Preview-деплой с веткой main). На этом проекте не работает: у main превью не бывает (см. выше), есть только Production-деплои.
- **B. Production, smoke + pages + perf.** **Выбрано.** Это то, что код разрешает против production (`productionSuites` в [qa.config.yaml](../qa/config/qa.config.yaml)). Адрес `https://www.jobflex.app` (голый `jobflex.app` отвечает 308 на www).

### Вход на production — только QA-владелец, только чтение (2026-10-22)

- **Кто.** Единственный, кто входит против production, — `qa@acme.test`, OWNER организации **QA Co** (`qa-co`) в боевой базе. Её создал [scripts/seed-qa-prod.ts](../scripts/seed-qa-prod.ts): Free, без подписки и Stripe-клиента. billingEmail `qa-co@qa.jobflex.test` ставит QA-метку (`lib/qaOrg`): организация не попадает в статистику, PostHog и `ApiSpendDaily`. Другие роли (manager, worker, admin) и любой другой адрес на production не входят — это проверяет код ([qa/lib/target.ts](../qa/lib/target.ts) `PROD_QA_OWNER`, `prodSignInAllowed`; [global-setup](../qa/lib/global-setup.ts) входит только им).
- **Что.** Только тесты с тегом **`@readonly`**: открыть страницу и прочитать. Сейчас это:
  - вход паролем (его делает сам setup, тест проверяет результат);
  - `/dashboard`, `/dashboard/proposals`, `/dashboard/subscription`, `/dashboard/settings`;
  - `/dashboard/crm` → правила. Страница сама дописывает стартовые правила follow-up в QA Co, если их нет (идемпотентно).
- **Чего никогда.** Тест с `@writes` (регистрация, proposals, Checkout, Smart Proposal, отправка) на production пропускается кодом, даже с `@readonly`. Тест под ролью без `@readonly` (наборы pages, perf и всё остальное) тоже пропускается.
- **Как добавить проверку.** Поставить тесту `@readonly`, только если он ничего не создаёт, не отправляет, не платит и не зовёт платные API (estimators, карты). Иначе он пойдёт только локально.
- **Чем платим.** Одна попытка тормоза входа за ночь (8 на адрес за 15 минут).
- Регистрация, Checkout и billing (сценарий «день 8» с test clock) ночью идут в отдельном job **nightly-billing**. Он поднимает `next dev` на свежей SQLite-базе (`prisma db push` + seed — только внутри одноразовой машины CI), со Stripe в test mode (`STRIPE_TEST_CLOCKS=1`) и вебхуками через Stripe CLI (`stripe listen`). Боевая база и live-ключи там не участвуют. В Actions этот job ещё ни разу не запускался: первый прогон покажет, хватает ли сида и окружения.

## Алерт при красном прогоне на production

- Шаг «Alert the team when production went red» есть в обоих workflow. Он запускает `npm run qa:alert` ([qa/bin/alert.ts](../qa/bin/alert.ts)). Тот смотрит цель прогона и ничего не шлёт, если это не production (превью — никогда) или прогон зелёный.
- Если production красный: `POST https://www.jobflex.app/api/qa/alert` с заголовком `x-qa-secret`, тело `{ text, run }` → [route](../src/app/api/qa/alert/route.ts) → `fireAdminAlert("qa", …)`.
- Текст получают те, у кого в **/admin/tasks → Team** стоит галочка **«QA failures»**, в свои часы. Не чаще 6 в час, повтор того же запуска CI не дублируется.
- Без секрета route отвечает 404, как `/api/qa/otp`.

## Отчёты

- Каждый job выкладывает артефакт: report.html, report.md, raw.json, скриншоты падений; nightly-billing добавляет журналы `next dev` и `stripe listen`.
- На странице job (Summary) — таблица тест / браузер / статус / время, со ссылкой на деплой ([qa/bin/summary.ts](../qa/bin/summary.ts)).
- Ночной job пишет ту же таблицу в `qa/runs/latest-nightly.md` (и `latest-nightly-billing.md`). Файл лежит в артефакте.

## Lint в CI

`npm run lint` проходит дерево до конца (`.cache`, `.next-*`, `qa/runs`, `qa/baselines`, `voice`, `old-design-pages`, `undefined` исключены), но в старом коде остаются сотни ошибок. CI запускает `npm run lint:changed` ([scripts/lint-changed.mjs](../scripts/lint-changed.mjs)): eslint только по `.ts` / `.tsx`, изменённым относительно `origin/main`. Падает на ошибках, предупреждения только печатает.

## Локально

```bash
npm run dev                          # QA_TEST_MODE=1 и QA_SECRET в .env.local
npm run qa -- --suite smoke          # все тесты, включая @writes (локальная база)
npm run qa:summary                   # та же таблица, что в CI
```
