# Лендинг и /pricing: ISR вместо force-dynamic и лёгкий бандл — анализ

Дата: 2026-10-22. Код: `36b33688` (HEAD = прод, деплой `dpl_mbQ4RRPuUEmviLhmq7JSb3VeunLX`). Это только анализ: код проекта не менялся. Прототипы собраны во временной копии `.cache/isr/snap`.

## Резюме

1. **Порядок: C, затем A за флагом `LANDING_ISR`. B делать только если A не принимается. /pricing оставить динамическим.**
2. **C (бандл) проверен прототипом.** На 19 из 21 варианта лендинга (все, кроме `hvac`) JS первой загрузки падает с 455 до 248 KB gzip (−45%), а блокирующий рендер CSS — со 103 до 35 KB gzip (−66%). При Slow 4G и CPU ×4 FCP улучшается на 0,5 с, LCP на 0,45–0,7 с. Текст HTML и первый экран не меняются: скриншоты на 390 px совпали побайтно. Работы на 0,5–1 день.
3. **Причина лишнего веса.** `hero-visual.tsx` статически импортирует все «шоты», включая HVAC-демо: форму на 132 KB, `lib/hvac/*`, framer-motion через `ui/Toast` и CSS-модули дашборда. При этом в hero ни одного лендинга этот шот не показывается: у hvac, roofing, fencing и decking там видео, у остальных Smart.
4. **A (ISR через rewrite).** Медианный TTFB у клиента падает примерно на 150 мс (сейчас 236–258 мс, у пререндеренной страницы в проде 85–93 мс). Исчезает хвост: 4,4% запросов от людей сейчас попадают на cold или prewarmed старт с TTFB 0,9–1,6 с. 65% вызовов `/` — краулер Meta `facebookexternalhit`, они уйдут в кэш.
5. **Деньги не аргумент.** Весь лендинг стоит около $0,30 за 30 дней и укладывается в кредит Pro. Довод за A — скорость и устойчивость к холодным стартам и к Neon.
6. **Что ломается, если сделать A «в лоб»** (проверено прототипом): из ссылок регистрации и из `landing_view` пропадают utm, fbclid и tool. Кнопка Google видна в Instagram и Facebook webview (это 69% просмотров) до гидратации. `?hook=` перестаёт работать. Пропадает редирект залогиненных. Цены и тумблер карты устаревают до revalidate. `/l/*` открывается напрямую.
7. **B (кэш данных при динамике)** экономит один запрос к Neon (оценка 5–30 мс из 112 мс p50). Холодные старты и краулер он не трогает. Полдня работы, но выигрыш мал.
8. **Редизайн hero.** Отдельной ветки и незакоммиченных правок в `landing-e` нет. Последняя правка hero — `7a852d0f` от 21.10 («landing hero back»), она уже в проде. Старая ветка `logo-refresh` от 03.10 трогает `app/page.tsx` и 5 файлов `landing-e`.
9. **Пересечение с редизайном** — `hero-visual.tsx`, `hero.tsx`, `landing-e-page.tsx`. C маленький: его лучше влить до редизайна или сразу после.
10. **В прототипе A всё, что заявлено, работает.** Собираются 21 SSG-страница, ответ из кэша (`x-nextjs-cache: HIT`). `usePathname()` на клиенте равен `/`, query в браузере не меняется, canonical `/?industry=hvac` сохраняется, cookie `jf_region` ставится.

---

## 0. Как мерил

| Что | Как |
|---|---|
| Прод | `curl` из США (запад), edge `pdx1` → функция `iad1`. По 6 запросов на URL, берётся медиана. |
| Локально | Чистый экспорт HEAD в `.cache/isr/snap`. В рабочем дереве main лежат незакоммиченные правки других сессий (`lib/apiSpend.ts` → `server-only` в клиентском графе), и сборка main падала. Сборка `next build --experimental-build-mode compile` + `generate`, свой `JOBFLEX_DIST_DIR`, копия `dev.db` (SQLite), `next start` на :3761. |
| Прототип C | В той же копии `hero-visual.tsx` переведён на `next/dynamic` для 5 шотов, `estimators-showcase.tsx` — для HVAC-шота. Сервер :3762. |
| Прототип A | В копии: маршрут `app/l/[variant]` (SSG, `revalidate 3600`), rewrite в middleware под `LANDING_ISR=1`, cookie триала заменён константой. Сервер :3763. |
| Браузер | Chrome, playwright-core, 390×844, PostHog, Meta и Google заблокированы, чтобы не слать события. |
| Vercel | `vercel metrics` (Observability) за 30 дней, `vercel usage`. |
| Аналитика | PostHog HogQL, только чтение: 30 дней, web vitals — 14 дней. |

---

## Часть 1. Инвентаризация

### 1.1 Что `/` и `/pricing` читают из запроса и из базы на сервере

Пройден весь серверный граф: `app/page.tsx` → `landing-variant-server.ts` → `landing-e-page.tsx` → `hero.tsx` и секции; `pricing/page.tsx` → `pricing-d`; root layout; middleware. Других обращений к `cookies()`, `headers()`, `auth()` или Prisma в дереве нет. `hero.tsx`, `nav`, `faq`, `pricing-plans` и прочие секции получают всё через props и ничего не читают сами.

| # | Источник | Где читается | Зачем | Куда при ISR (вариант A) | Риск |
|---|---|---|---|---|---|
| 1 | `searchParams.industry` / `trade` | [page.tsx:74](../src/app/page.tsx#L74) → [landing-variant-server.ts:20](../src/components/v3/landing-e/landing-variant-server.ts#L20) (`resolveLandingVariant`) | Выбор hero, секций, порядка секций (`lib/landing-sections`), `industry=` во всех ссылках регистрации | Путь: middleware нормализует (алиасы, регистр) → `/l/<key>` | Низкий. Алиасы реально встречаются: в рефереррах Vercel есть `?industry=fence`, в старых ссылках — `hvac2`. Нормализовать только через `resolveLandingVariant`. |
| 2 | `searchParams` в `generateMetadata` | [page.tsx:52-53](../src/app/page.tsx#L52-L53) | Title, OG и canonical для HVAC | `params` сегмента | Низкий. Canonical — литерал `/?industry=hvac`, в прототипе он сохранился. |
| 3 | `searchParams.hook` | [landing-variant-server.ts:21](../src/components/v3/landing-e/landing-variant-server.ts#L21) → `withHook` в [landing-e-page.tsx:122](../src/components/v3/landing-e/landing-e-page.tsx#L122) | Заголовок h1 и подзаголовок первого экрана берутся из строки рекламы | Путь `/l/<trade>--<hook>`: 23 ключа (roofing 12, fencing 3, hvac 8) | Средний. Если унести на клиент, заголовок подменится после отрисовки, а аналитик просил продолжать фразу рекламы с первого кадра. |
| 4 | `searchParams.tool` | [landing-variant-server.ts:21](../src/components/v3/landing-e/landing-variant-server.ts#L21) → `spotlightFor` ([landing-e-page.tsx:119](../src/components/v3/landing-e/landing-e-page.tsx#L119)), `signupHref` (:136, :140), cookie `jf_tool` | Выделенная строка на карточках цен (секция ниже сгиба), `&tool=` в ссылках | Клиент: spotlight считается в клиентском `PricingPlans`, ссылки дописываются скриптом | Низкий: секция цен далеко ниже первого экрана. |
| 5 | `searchParams.utm_*` | `pickUtm` → `signupHref` во всех ссылках регистрации и Pricing, props `landing_view`, cookie `jf_utm` | Атрибуция рекламы | Клиент: inline-скрипт дописывает ссылки до гидратации, `LandingVariantEffects` читает `location` | **Высокий.** В прототипе ссылка героя была `/auth/register?industry=fencing` без utm и fbclid, cookie `jf_utm` не записался, `landing_view` ушёл без utm. |
| 6 | `searchParams.fbclid` | `pickFbclid` → ссылки, callback кнопки Google | Атрибуция Meta | Как utm | Высокий — по той же причине. |
| 7 | `auth()` | [page.tsx:72-73](../src/app/page.tsx#L72-L73) | Залогиненного отправить на `/dashboard` (307: 344 раза за 30 дней) | Middleware: при наличии cookie сессии не переписывать, запрос уходит в сегодняшнюю динамическую страницу | Низкий. Прототип: запрос с cookie дошёл до динамической страницы. |
| 8 | `headers().user-agent` → `detectInAppBrowser` | [page.tsx:80](../src/app/page.tsx#L80) → hero → [google-signup-button.tsx:54](../src/components/v3/landing-e/google-signup-button.tsx#L54) | Не показывать «Sign up with Google» в Instagram, Facebook, LINE и TikTok webview: Google там отвечает 403 | Middleware добавляет к сегменту признак webview (`/l/roofing~app`, тот же `lib/inAppBrowser`) или inline-скрипт в `<head>` с CSS | **Высокий.** 69% просмотров `/` — webview (Facebook 2 624, Instagram 1 065, браузер 1 629 за 30 дней). В прототипе кнопка была в HTML у Instagram и исчезала только после гидратации. |
| 9 | cookie `jf_trial_offer_v1` | [trialOfferServer.ts:6](../src/lib/trialOfferServer.ts#L6) ← [landing-e-page.tsx:134](../src/components/v3/landing-e/landing-e-page.tsx#L134), [pricing/page.tsx:42](../src/app/(marketing)/pricing/page.tsx#L42) | Сколько дней триала писать на кнопках | Константа: `TRIAL_TEST_ENDED = true` ([trialOffer.ts:13](../src/lib/trialOffer.ts#L13)), cookie уже ни на что не влияет | Низкий. Если вернётся A/B по длине триала, ему понадобится сегмент пути. |
| 10 | БД: `pricingPlan.findMany` | `getPlanCatalog` ← [landing-e-page.tsx:144](../src/components/v3/landing-e/landing-e-page.tsx#L144), [pricing/page.tsx:31](../src/app/(marketing)/pricing/page.tsx#L31) | Цены и строки тарифов | Кэш ISR. В `revalidatePlanSurfaces` ([planCatalogServer.ts:114](../src/lib/planCatalogServer.ts#L114)) добавить `/` и `/l/[slug]` | Средний: если забыть, старые цены будут видны до `revalidate`. |
| 11 | БД: `syncState trialPolicy` (+ подсчёт card-less за сутки) | [trialPolicyServer.ts:111,118](../src/lib/trialPolicyServer.ts#L111) ← [landing-e-page.tsx:133](../src/components/v3/landing-e/landing-e-page.tsx#L133), кэш 10 с на инстанс | FAQ: нужна ли карта | Кэш ISR + `revalidatePath` в `actions/trialPolicy.ts` при переключении | Средний. Суточный потолок card-less меняет ответ без всякого события, поэтому его догонит только `revalidate`. Сейчас режим «card», и потолок не читается. |
| 12 | env `CUSTOM_PLAN_ENABLED` | `customPlanOffered()` ← [landing-e-page.tsx:215](../src/components/v3/landing-e/landing-e-page.tsx#L215), [pricing/page.tsx:46](../src/app/(marketing)/pricing/page.tsx#L46) | Блок «Build your plan» | Статично: меняется вместе с деплоем, как и любой env на Vercel | Низкий. Повод, по которому /pricing 07.10 ушёл с ISR (`e53841cb`), снимается тем, что смена env и так требует редеплоя. |
| 13 | `EDITION_OPEN` (константа) | [landing-e-page.tsx:126](../src/components/v3/landing-e/landing-e-page.tsx#L126) | Deck «coming soon» | Без изменений | — |
| 14 | `searchParams` `tool` / `industry` / `trade` на /pricing | [pricing/page.tsx:39](../src/app/(marketing)/pricing/page.tsx#L39) | Spotlight на карточках | Только при ISR для /pricing: клиент (как уже делает `pricing-visit.tsx`) | Средний: карточки — основное содержимое /pricing, строка мигнёт. |
| 15 | cookies `jf_tool`, `jf_industry` на /pricing | [pricing/page.tsx:35-40](../src/app/(marketing)/pricing/page.tsx#L35-L40) | Spotlight «по памяти» на 30 дней | То же | Низкий. Правило «cookie не выбирает вариант» касается лендинга, а это /pricing. |
| 16 | middleware: `x-vercel-ip-country` → `jf_region` | [middleware.ts:107-108](../src/middleware.ts#L107-L108) | Режим консента: notice или opt-in | Остаётся. Middleware работает до кэша | Низкий. Проверено: в проде на пререндере `/terms` (`X-Vercel-Cache: HIT`) есть `Set-Cookie: jf_region`, в прототипе A тоже. |
| 17 | middleware: host `deck.*` → `?industry=decking` | [middleware.ts:121](../src/middleware.ts#L121) | Отдельный домен Deck | Rewrite сразу на `/l/decking` | Низкий. |
| 18 | middleware: назначение `jf_trial_offer_v1` | [middleware.ts:94-98](../src/middleware.ts#L94-L98) | A/B длины триала | Выключено (`TRIAL_TEST_ENDED`) | — |
| 19 | Клиент, без серверного эффекта: `useSearchParams` в `AttributionCapture` (`?promo`, `?ref`) и `PostHogCapture` ([layout.tsx:100,105](../src/app/layout.tsx#L100)), `window.location` в `pricing-visit.tsx`, флаг PostHog в `HeroExperiment` ([hero.tsx:96](../src/components/v3/landing-e/hero.tsx#L96)) | — | — | Без изменений. В прототипе `useSearchParams()` вернул полный query браузера, `usePathname()` вернул `/` | Низкий. |

A/B на сервере сейчас трафик не делят. В `lib/traffic-experiments.ts:15,20`:
- `signup_trial_length_v1` выключен. Его последние экспозиции в PostHog — 2026-10-11 19:07Z: a 267, b 296.
- `landing_hero_v1` — неактивная клиентская заготовка.

### 1.2 Что лендинг пишет и откуда

| Что | Кто пишет | Сервер или клиент |
|---|---|---|
| cookie `jf_region` | middleware, при первом запросе без cookie | сервер (edge) |
| cookie `jf_trial_offer_v1` | middleware (выключено) | сервер |
| cookie `jf_door` | middleware на deck-хостах | сервер |
| cookies `jf_industry` (только при явном `?industry=`), `jf_tool`, `jf_utm` | `LandingVariantEffects` после paint ([landing-variant-effects.tsx:80](../src/components/v3/landing-e/landing-variant-effects.tsx#L80)); синхронно — кнопка Google перед уходом | клиент |
| cookie `jf_fbclid` (1 час, только с маркетинговым согласием) | кнопка Google | клиент |
| cookie `jf_attr` и `localStorage`, `POST /api/promo/visit` | `AttributionCapture` (`?promo` / `?ref`) | клиент |
| cookie `jf_consent` | `CookieBanner` | клиент |
| PostHog за 30 дней на `/` и `/pricing`: `landing_section` 11 213, `$pageview` 5 745, `hvac_demo_step` 5 490, `$web_vitals` 5 414, `landing_view` 4 996, `$pageleave` 4 488, `landing_timing` 4 099, `cta_click` 1 136, `demo_*` 564, `$opt_in` 300 | `posthog-js` грузится лениво после idle ([posthog-capture.tsx](../src/components/providers/posthog-capture.tsx)) | клиент |
| Meta Pixel `PageView` | сниппет в [layout.tsx:62](../src/app/layout.tsx#L62), только прод | клиент. CAPI удалён 17.10, поэтому дедупликации сервер↔браузер нет и ISR на неё не влияет. `Lead` шлётся на регистрации, `StartTrial` — в дашборде. |
| Google One Tap → `POST /api/auth/google-onetap` | `GoogleOneTap` | клиент |
| Сам рендер страницы | ничего не пишет: ни в БД, ни в server events. `traffic-capture-server` вызывается только в регистрации и checkout | — |

### 1.3 Реальные URL: тест-матрица

**Что реально приходило за 30 дней** (PostHog `landing_view`, прод):

| `industry` | Просмотров | Комментарий |
|---|---|---|
| default | 1 561 | 663 из них с utm |
| hvac | 1 384 | — |
| roofing | 1 337 | — |
| fencing | 678 | hook: `drive-out` 4, `money` 2 |
| decking | 26 | — |
| kitchen-bath | 4 | — |
| landscaping | 4 | — |
| painting | 2 | — |

utm за тот же период:
- `fb/paid` — 2 483, `ig/paid` — 957, `an/paid` (Audience Network) — 236, `ig/social` — 46, `th/paid` — 7, без utm — 1 259.
- 21 `utm_campaign` (числовые id Meta) и 46 `utm_content`.

**Полная матрица для проверки:**

| Группа | URL |
|---|---|
| Default | `/`, `/?industry=nonsense` (должен быть default), `/?industry=` (пусто) |
| 20 трейдов | `/?industry=` + `flooring`, `tile`, `countertops`, `plumbing`, `electrical`, `carpentry`, `painting`, `roofing`, `fencing`, `decking`, `siding`, `kitchen-bath`, `hvac`, `landscaping`, `concrete`, `demolition`, `drywall`, `insulation`, `windows`, `general-contractor` |
| Алиасы и регистр | `?industry=fence`, `?industry=hvac2`, `?industry=hvac-v2`, `?industry=Roofing`, `?trade=roof`, `?trade=Kitchen%20%26%20Bath`, `?industry=gc`, `?industry=ac` |
| Hooks: roofing | `no-report`, `hours`, `all-in-one`, `one-address`, `your-price`, `line-by-line`, `coffee`, `signature`, `deposit`, `two-prices`, `first-bid`, `win-more` |
| Hooks: fencing | `drive-out`, `slope`, `money` |
| Hooks: hvac | `tonnage`, `every-call`, `math`, `nine-jobs`, `address`, `code`, `repair-replace`, `inventory` |
| Hooks: отказы | Hook на чужом трейде (`?industry=painting&hook=no-report` → hero трейда), `?hook=No_Report` (нормализуется) |
| Tool | `?tool=` + `roof`, `hvac`, `fence`, `smart`, `blueprint`, `aidesk`, `deck` и алиасы (`smart-proposal`, `ai-desk`, `receptionist`…); вместе с `industry` |
| utm-пресеты из `admin-traffic/ad-links.tsx` | Meta: `utm_source={{site_source_name}}&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}` (реально приходят `fb`/`ig`/`an`/`th`). TikTok: `utm_source=tiktok&utm_medium=paid&…`. Google: `utm_source=google&utm_medium=cpc&…&utm_term=…` (+ `gclid` от автотегов). X: `utm_source=x&utm_medium=paid`. Organic: `utm_medium=social` |
| Click id | `&fbclid=IwAR…`, а также `?promo=CODE` и `?ref=ABC-12345` (`AttributionCapture`) |
| Шорткаты (middleware, 308) | `/hvac` → `/?industry=hvac`, `/deck` → `/?industry=decking`. Query сохраняется |
| Снятые лендинги (308 → `/`, query сохраняется) | `/landing`, `/landing-a`, `/landing-b`, `/landing-c`, `/landing-aerial`, `/mobile-landing-v2`; `/landing-e` (`permanentRedirect` в маршруте) |
| Хосты | `deck.jobflex.app/`, `deckstudio.jobflex.app/` (rewrite на decking), `jobflex-v3.vercel.app/*` → `www.jobflex.app` (`next.config` redirects) |
| /pricing | `/pricing`, `/pricing?industry=roofing&utm_source=fb&fbclid=…`, `/pricing?tool=aidesk`, с cookie `jf_tool` и без |
| Сессия | Любой из URL выше с cookie сессии → 307 `/dashboard` |
| Webview | Любой из URL выше с UA Instagram или Facebook (`FBAN`/`FBAV`) — без кнопки Google с первого байта |
| Краулеры | UA `facebookexternalhit/1.1` на `/?industry=hvac&utm_…` — HVAC-метаданные |

`vercel.json` редиректов лендинга не содержит, там только cron. `next.config.ts` содержит один host-redirect.

### 1.4 Какая динамика реально нужна

| Что | Нужна ли | Факт |
|---|---|---|
| `detectInAppBrowser` | **Да.** Кнопка «Sign up with Google» вернулась в hero 21.10 (`7a852d0f`, «the pre-2026-10-19 hero again … trial + Google buttons») — решение от 19.10 отменено | 69% просмотров — webview |
| Серверный A/B (traffic-experiments) | Нет | Оба эксперимента выключены |
| Cookie триала | Нет | Константа |
| `auth()` | Да, но редко | 344 редиректа за 30 дней (1,2% вызовов `/`) |
| `?hook=` | Да: механизм и 23 рекламные строки есть | Реально 6 просмотров за 30 дней |
| `?tool=` | Механизм есть в конструкторе ссылок | В `landing_view` tool не пишется, данных нет |
| utm и fbclid в ссылках | Да | 75% просмотров приходят с utm |

---

## Часть 2. Измерения «как есть»

### 2.1 TTFB

| URL | Прод, медиана TTFB (6 запросов) | Локально `next start`, полный ответ (5 запросов, тёплый) | Прототип A, локально |
|---|---|---|---|
| `/` | **258 мс** | 15 мс | 6 мс |
| `/?industry=hvac` | **241 мс** | 14 мс | 5 мс |
| `/?industry=fencing` | **236 мс** | 14 мс | 5 мс |
| `/pricing` | **188 мс** | 7 мс | — |
| `/terms` (пререндер, `X-Vercel-Cache: HIT`) | 85 мс | 3 мс | — |
| `/privacy` (пререндер) | 93 мс | — | — |

TLS-рукопожатие из этой точки занимает 35–55 мс. Локально разница мала, потому что SQLite и быстрый CPU. В проде основное время — функция в `iad1` и Neon. Ответ `/` без кэша отдаёт `Cache-Control: private, no-cache, no-store` и `X-Vercel-Cache: MISS`.

TTFB функции `/` в Vercel Observability за 30 дней:

| | Доля запросов от людей | p50 | p75 | p95 |
|---|---|---|---|---|
| Все запросы (включая краулер) | — | 125 мс | 275 мс | 772 мс |
| Люди, hot-старт | 95,6% | 112 мс | 200 мс | 622 мс |
| Люди, prewarmed | 2,3% | 890 мс | 1 043 мс | 1 223 мс |
| Люди, cold-старт | 2,1% | 1 564 мс | 1 666 мс | 1 753 мс |

«Люди» здесь — все запросы, кроме `facebookexternalhit`.

Реальные пользователи, PostHog `$web_vitals`, 14 дней, `/`:
- Mobile (n=2 394): FCP p50 815 / p75 1 188 мс, LCP p50 932 / p75 1 273 мс.
- Desktop: FCP p50 707 мс.

### 2.2 Клиентский бандл

В Next 16 `next build` больше не печатает First Load JS, поэтому вес снимался тремя способами:
1. Скрипты, которые запрашивает HTML прода.
2. Байты на проводе в Chrome.
3. `next experimental-analyze -o` по модулям.

| | `/` (любой вариант) | `/pricing` |
|---|---|---|
| HTML прода, сжатый на проводе | 40 KB (hvac 49 KB). Без сжатия 367 KB, из них 109 KB — inline RSC | 9 KB (57 KB без сжатия) |
| JS из HTML прода | 20 скриптов + 1 `nomodule`-полифилл (110 KB, современные браузеры его не качают): **1 338 KB raw / ≈410 KB gzip** | 15 + полифилл: ≈541 KB raw / ≈167 KB gzip |
| JS на проводе в Chrome до `load` | **455 KB** (hvac, fencing, painting — одинаково) | 201 KB |
| + по idle | +90 KB (`posthog-js`, лениво) | +87 KB |
| CSS, блокирующий рендер | **15 файлов: 738 KB raw / 103 KB gzip** | 4 файла: 170 / 32 KB |

**Тяжёлые пакеты и через какие импорты они попадают на лендинг:**

| Пакет или модуль | Размер (raw / gzip) | Попадает на первую загрузку? | Цепочка импортов |
|---|---|---|---|
| HVAC-демо: `hvac-estimator-demo/hvac-estimator-form.tsx` + `lib/hvac/*` (`designTemps` 55, `ledger` 51, `usFamilies` 46, `serviceMenu` 27, `intake` 20, `rules` 18, `checks` 16, `engine` 14…) | ≈420 / ≈120 KB. В проде это 2 чанка по 167 KB raw | **Да, на всех 21 варианте** | `hero.tsx` → `hero-visual.tsx:20` → `hvac-estimator-shot.tsx` → `hvac-estimator-form.tsx`. Ещё `estimators-showcase.tsx:51` |
| framer-motion | 108 / 34 KB (чанк прода `43_mucnabk7e5`) | **Да** | … → `hvac-estimator-form.tsx:48` → `components/ui/Toast.tsx` → `framer-motion`. Тем же путём попадает `zustand` (`toast-store`) |
| CSS-модули дашборда: `hvac-estimator`, `advanced-ai`, `lines-v2`, `bp-money`, `bp-markup`, `proposals`, `mobile-workers`, `mobile-financials`, `crew-board`, `mobile-roof-estimator`, `inventory-link-choice` | ≈550 / ≈70 KB | **Да, блокируют рендер** | Через те же импорты HVAC-шота и формы; Turbopack сливает CSS-модули в общие чанки |
| gsap (+ ScrollTrigger и плагины) | 125 / 51 KB | Нет, лениво | `gsap-lazy.ts`: `import()` после первого скролла или через 8 с |
| posthog-js | 262 / 85 KB | Нет, лениво | `posthog-capture.tsx`: `import()` по idle |
| lucide-react | иконка `Play` | Да (несколько KB) | `demo-film.tsx:42` |
| next-auth/react (`signIn`) | ≈5 KB | Да | `google-signup-button.tsx`, `google-one-tap.tsx` |
| three, recharts, reactflow/xyflow, pdfjs, @react-pdf | — | В графе лендинга отсутствуют | — |

`next/dynamic` в `landing-e-page.tsx` не выносит JS секций из первой загрузки. Секции рендерятся на сервере, и их чанки нужны для гидратации: `estimators-showcase`, `proposals-section`, `portal-section` есть среди 20 начальных скриптов. Они только разбиты на отдельные чанки.

### 2.3 Вызовы и деньги (Vercel, прод, 22.09–22.10)

| Маршрут | Вызовов за 30 дней | В день | Active CPU | GB-h | Fast Origin Transfer |
|---|---|---|---|---|---|
| `/` | 29 611: `facebookexternalhit` **19 232 (65%)**, 307 — 344, 404 — 53, POST — 67, HEAD — 117 | ≈955 | 3 078 с (p50 97 мс на вызов) | 2,2 | 1,95 GB |
| `/index` (это `/index.rsc` — prefetch `<Link href="/">` со страниц `/auth/login`, `/auth/register`, `/pricing`, `/homeowner` и самого лендинга) | 14 361 | ≈463 | 333 с (p50 10 мс) | 0,2 | 21 MB |
| `/pricing` | 987 (66 — фоновые ISR-вызовы до 07.10) | ≈32 | 42 с | 0,04 | 10 MB |

Для сравнения, люди по PostHog (нижняя оценка, только те, у кого загрузился posthog): `$pageview` `/` 5 316, `/pricing` 429. Холодные старты `/`: cold 423 и prewarmed 356 (2,6% всех вызовов).

**Стоимость.** Расчёт по прайсу Pro для `iad1` (Active CPU $0,128 за час, память $0,0106 за GB-h, вызовы $0,60 за 1 млн, FOT ≈$0,06 за GB):

| Статья | Расчёт | Сумма |
|---|---|---|
| CPU | 0,96 ч | $0,12 |
| Память | 2,44 GB-h | $0,03 |
| Вызовы | 45 тыс. | $0,03 |
| FOT | 1,98 GB | $0,12 |
| **Итого за 30 дней** | | **≈$0,30** |

Для масштаба, вся команда `phillyahis-projects` с 1 по 22 октября: Fluid CPU $1,47, память $0,88, вызовы $0,65, FOT $0,56. Всё это внутри кредита Pro: к оплате $0,90.

**Экономия от A — около $0,25 в месяц.** Деньги не аргумент.

---

## Часть 3. Варианты

### Вариант C — «только бандл» (рекомендую первым)

**Что делать:**

| Файл | Изменение |
|---|---|
| [hero-visual.tsx](../src/components/v3/landing-e/hero-visual.tsx) | `FenceShot`, `RoofShot`, `HvacEstimatorShot`, `DeckShot`, `SmartProposalShot` перевести на `next/dynamic`. `DemoFilm` оставить статическим: он в hero четырёх трейдов. |
| [estimators-showcase.tsx](../src/components/v3/landing-e/estimators-showcase.tsx) | `HvacEstimatorShot` через `next/dynamic`. `HVAC_TIMELINE` вынести в маленький файл без зависимостей (например `hvac-timeline.ts`), иначе статический импорт константы снова тянет весь модуль. |
| Опционально, только для hvac | В `hvac-estimator-form.tsx` `toast` подгружать лениво — framer-motion уйдёт и с HVAC-страницы. HVAC-слайд витрины грузить по in-view — уйдёт 68 KB CSS на hvac. |

**Результат прототипа** (те же исходники, правка только этих двух файлов):

| | База | Прототип C | Δ |
|---|---|---|---|
| JS до `load`: `/`, `?industry=painting` | 455 KB | 248 KB | **−207 KB (−45%)** |
| JS до `load`: `?industry=fencing` | 455 KB | 251 KB | −204 KB |
| JS до `load`: `?industry=hvac` | 455 KB | 465 KB | +10 KB (HVAC-демо там нужно для витрины) |
| CSS (без hvac) | 15 файлов, 103 KB gzip | 9 файлов, 35 KB gzip | **−68 KB (−66%)** |
| framer-motion в первой загрузке | да | нет | — |
| FCP, Slow 4G + CPU ×4, медиана из 3: `/` | 2 216 мс | 1 708 мс | **−508 мс** |
| FCP, то же: `?industry=roofing` | 2 096 мс | 1 536 мс | **−560 мс** |
| LCP: `/` | 2 652 мс | 2 200 мс | −452 мс |
| LCP: `?industry=roofing` | 2 744 мс | 2 040 мс | −704 мс |
| Текст HTML (md5 без скриптов) | — | — | совпадает на всех 4 URL |
| Скриншоты 390 px, JS вкл/выкл (`/`, painting, fencing) | — | — | 5 из 6 побайтно равны. Fencing без JS отличается только кадром видео-постера |

**Оценка.** −200 KB JS и −68 KB блокирующего CSS на 19 вариантах из 21 (на них 72% просмотров). Это −0,5 с FCP на медленной сети. Реальная медиана FCP 815 мс снизится меньше: на быстрой сети выигрыш в первую очередь в CPU телефона.

**Риски и проверка:**

| Риск | Как проверить |
|---|---|
| Видимое «доезжание» шота в hero 16 трейдов со Smart | Скриншоты 390×844 и 1440 до и после на `?industry=painting` и `?industry=kitchen-bath` с выключенным JS. Должен быть тот же кадр: в прототипе он совпал. |
| Слайды витрины стартуют позже | `/?industry=hvac`: прокрутить до витрины, HVAC-слайд проигрывается. Событие `hvac_demo_step` продолжает приходить (в PostHog 5 490 за 30 дней). |
| Длина HVAC-слайда | Совпадает с `HVAC_TIMELINE.slide`: в прототипе захардкожено 22 420 мс, в коде — из общего файла. |
| CSS пропал у шота, отрисованного на сервере | Скрин без JS на painting, fencing, roofing, decking. |
| Регрессия на hvac | `?industry=hvac` — JS не больше базы (465 против 455 KB — допустимо). |

**Трудоёмкость:** 0,5 дня + 0,5 дня проверки. Рендеринг не трогается, откат — один revert.

### Вариант B — «частичная статика»

**Что делать:** страница остаётся `force-dynamic`.

| Изменение | Файл |
|---|---|
| `getPlanCatalog` обернуть в `unstable_cache(…, ["plan-catalog"], { tags: ["plans"], revalidate: 3600 })` | `lib/planCatalogServer.ts` |
| В `revalidatePlanSurfaces` добавить `revalidateTag("plans")` | `lib/planCatalogServer.ts` |
| Чтение cookie триала заменить константой | `landing-e-page.tsx` |

`"use cache"` не подходит: в Next 16 он требует `cacheComponents: true` на всё приложение. Это включает PPR и `<Activity>` при навигации во всём дашборде — смена поведения всего приложения ради лендинга.

**Сколько это снимет:**

| Что | Оценка |
|---|---|
| Запросы к Neon на вызов `/` | Один `pricingPlan.findMany` уходит. `trialPolicy` и так кэшируется на 10 с в инстансе. `auth()` для анонима в БД не ходит. |
| Выигрыш по TTFB | Около 5–30 мс из hot p50 112 мс (5–25%). Точнее без трассировки Neon сказать нельзя: Observability не разделяет время функции. |
| Реконнект Neon | Уходит и риск реконнекта на первом запросе после паузы (`lib/db.ts`: «NEON DROPS IDLE CONNECTIONS»). Для страницы цен это заметнее медианы. |
| Не трогает | Cold и prewarmed старты (4,4% запросов людей, 0,9–1,6 с), 19 тыс. вызовов краулера, рендер самого RSC-дерева (CPU p50 97 мс). |

**Риски:**
- Цены устаревают, если забыть тег. Проверка: поменять цену в `/admin/plans` и сразу открыть `/` — новая цена должна появиться.
- `unstable_cache` в Next 16 помечен как заменённый на `use cache`, но работает без `cacheComponents`.

**Трудоёмкость:** 0,5 дня. Если делать A, то B для лендинга не нужен: каталог читается только при регенерации.

### Вариант A — «ISR через путь» (за флагом)

#### Устройство

**1. Маршрут** `src/app/l/[slug]/page.tsx`:

| Параметр | Значение |
|---|---|
| `slug` | `default`, `<trade>` или `<trade>--<hook>` (21 + 23 = 44 значения). С сегментом webview — ×2 = 88 |
| `generateStaticParams` | Все 44 (88) значения |
| `dynamicParams` | `false` |
| `revalidate` | 300. Цена копеечная, а суточный потолок card-less догоняется за 5 минут |
| Тело | Тот же `<LandingE>`, параметры берутся из slug. `auth()`, `headers()`, `cookies()` не вызываются |

**2. Middleware** — в начале `route()`, если выполнено всё сразу: путь `/`, `LANDING_ISR === "1"`, нет cookie `authjs.session-token` / `__Secure-authjs.session-token`. Тогда:
- `resolveLandingVariant(industry ?? trade)`, `resolveLandingHook`, `detectInAppBrowser(UA)`;
- `rewrite` на `/l/<slug>` с **пустым query**. Ключ кэша — только путь; браузер видит прежний URL.

**3. Сессия.** С cookie сессии rewrite не делается: запрос идёт в сегодняшнюю динамическую `/`, где остаются `auth()` и редирект.

**4. Прямой заход на `/l/*` извне** — 308 на `/?industry=…` (rewrite middleware повторно не запускает, так что внешний запрос отличим).

**5. Клиентская часть:**
- `utm_*`, `fbclid`, `tool` дописываются в `a[href^="/auth/register"]` и `a[href^="/pricing"]` inline-скриптом в конце HTML, до гидратации. Правила — те же `pickUtm`, `pickFbclid`, `parseSpotlightTool`, одна копия логики.
- `LandingVariantEffects` и кнопка Google берут их из `location`.
- Spotlight по `?tool=` считается в `PricingPlans` на клиенте; spotlight трейда приходит из пути.

**6. Инвалидация:** в `revalidatePlanSurfaces` добавить `revalidatePath("/l/[slug]", "page")`; в `actions/trialPolicy.ts` после переключения — то же самое.

**7. /pricing** не трогать: 32 вызова в день, а spotlight — основное содержимое страницы.

#### Куда переезжает каждый пункт из части 1 и что может сломаться

| Пункт | Куда | Что может сломаться | Как проверить |
|---|---|---|---|
| `industry`/`trade` + алиасы | slug | Алиас не распознан → default | Матрица 1.3: h1 каждого трейда. `?industry=fence` показывает fencing (в прототипе показал) |
| `hook` | slug `--hook` | Заголовок без хука; хук на чужом трейде | URL хуков: h1 = строка рекламы. `?industry=painting&hook=no-report` показывает hero painting |
| utm и fbclid | inline-скрипт + `location` | Клик до гидратации без utm; `landing_view` без utm; нет cookie `jf_utm` (в прототипе все три сломались) | `/?industry=roofing&utm_source=fb&utm_campaign=x&fbclid=AbC`: `href` кнопки hero содержит все параметры **сразу после DOMContentLoaded**. В PostHog у `landing_view` есть `utm_source`. Cookie `jf_utm` записан. После регистрации `landingIndustry` и utm на организации |
| `tool` | клиент | Нет `&tool=` в ссылке; карточка не выделена | `?tool=aidesk`: ссылка и выделенная строка в секции цен |
| `auth()`-редирект | наличие cookie → динамическая страница | Пользователь с протухшей cookie получает динамическую страницу — как сегодня | С cookie сессии: 307 `/dashboard`. С мусорной cookie: 200 и лендинг (в прототипе 200) |
| UA / webview | сегмент `~app` из middleware (рекомендую) или inline-скрипт с CSS | Кнопка Google видна в Instagram до гидратации (в прототипе так и было) | UA Instagram и `FBAN`: в **сыром HTML** (`curl -A …`) нет `data-cta="google"`. В Safari кнопка есть |
| Cookie триала | константа | При новом A/B длины триала дни в кнопке будут неверны | Отметить в `lib/trialOffer`: тест требует сегмента пути |
| Каталог цен | ISR + revalidatePath | Старые цены | Поменять цену в `/admin/plans`: на `/?industry=roofing` она новая после первого же запроса |
| `trialPolicy` | ISR + revalidate 300 + revalidatePath при переключении | FAQ говорит «карта не нужна», хотя потолок уже включил карту | Переключить в Admin → Trials: FAQ меняется. Потолок — в пределах 5 минут |
| `CUSTOM_PLAN_ENABLED` | build / регенерация | — | Env меняется только с редеплоем |
| Метаданные и OG | `generateMetadata({ params })` | OG-карточка HVAC пропала в превью Meta | `curl -A "facebookexternalhit/1.1" "/?industry=hvac&utm_source=fb"`: `<title>JobFlex for HVAC…`, `og:url` и canonical = `/?industry=hvac` (в прототипе совпал) |
| Canonical и sitemap | без изменений | — | `sitemap.xml` — те же `/?industry=<key>` |
| Consent (`jf_region`) | middleware, без изменений | — | Первый запрос без cookie: `Set-Cookie: jf_region` на ответе с `x-vercel-cache: HIT` |
| traffic-capture, PostHog | клиент | `$pathname` станет `/l/hvac`, и тогда `/admin/traffic` и аналитик секций потеряют лендинг | В прототипе `usePathname()` равен `/`, `$current_url` — URL браузера. На превью проверить, что у `$pageview` `$pathname` = `/` |
| Experiments | неактивны | `landing_hero_v1` при включении остаётся клиентским — совместим. Серверное деление только через сегмент | — |
| Meta Pixel | без изменений | Дедупликации нет (нет CAPI); `_fbc` берётся из URL браузера | После клика по `fbclid` cookie `_fbc` на месте |
| Soft-навигация на `/` (`/index.rsc`, 14 тыс. за 30 дней) | rewrite применяется и к RSC | — | Со страницы `/pricing` клик по логотипу: ответ `/index.rsc` с `x-vercel-cache: HIT` |
| Кэш при разных utm | query отрезан | Каждая комбинация utm становится отдельным MISS | Два запроса `/?industry=hvac&utm_source=a` и `…=b`: второй отдаёт `x-vercel-cache: HIT` |
| Прямой `/l/hvac` | 308 | Дубль страницы в поиске | `curl -I /l/hvac` возвращает 308 на `/?industry=hvac` (в прототипе отдал 200 — редирект ещё не сделан) |
| deck-хосты | rewrite → `/l/decking` | — | `curl -H "Host: deck.jobflex.app" /` показывает deck-hero и cookie `jf_door` |

#### Флаг `LANDING_ISR=1` и откат

| Шаг | Что |
|---|---|
| Как устроено | Middleware переписывает `/` только при `process.env.LANDING_ISR === "1"`. Иначе ничего не меняется и работает сегодняшняя динамическая `/`. Обе страницы живут рядом. |
| Проверка на превью до прода | В middleware можно (только при `VERCEL_ENV !== "production"`) включать ветку cookie `jf_isr=1`, чтобы проверять превью без смены env. |
| Откат: env | `LANDING_ISR=0` и Redeploy (несколько минут сборки). |
| Откат: мгновенный | Instant Rollback в Vercel на прошлый деплой (секунды). |

#### Оценка A

| Что | Значение |
|---|---|
| TTFB | ≈−150 мс медианы у клиента (сейчас 236–258 мс, пререндер в проде 85–93 мс) |
| Хвост | Уходят p95 (622 мс у hot) и холодные старты (4,4% запросов людей, 0,9–1,6 с) |
| Краулер | 19 тыс. вызовов `facebookexternalhit` в месяц перестают будить функцию |
| JS и CSS | Не меняются, это задача C |
| Деньги | ≈$0,25 в месяц |
| Трудоёмкость | 2–3 дня + 1 день прогона матрицы на превью |

### Сводка и рекомендация

| | C (бандл) | B (кэш данных) | A (ISR) |
|---|---|---|---|
| TTFB | 0 | −5…30 мс (оценка) | **≈−150 мс медиана, хвост 0,9–1,6 с → нет** |
| JS первой загрузки | **−207 KB gzip** (19/21 вариантов) | 0 | 0 |
| CSS, блокирующий рендер | **−68 KB gzip** | 0 | 0 |
| FCP, Slow 4G | **−0,5 с** (измерено) | ≈0 | ≈−0,15 с (TTFB) |
| $ в месяц | 0 | ≈0 | ≈−$0,25 |
| Дни | 0,5–1 + 0,5 | 0,5 | 2–3 + 1 |
| Риск | Низкий: рендер не трогается | Низкий | Средний: атрибуция, webview, хуки, инвалидация |

**Рекомендую порядок C → A (за флагом); B — только если от A откажутся.**
- C даёт самый большой измеренный выигрыш для 69% аудитории — это телефоны в webview на мобильной сети — и почти без риска.
- A лечит то, чего C не касается: TTFB, холодные старты, краулер.
- B — часть выигрыша A за меньшие деньги, но на фоне A он лишний. Если A откладывается надолго, B можно сделать как дешёвый шаг.
- /pricing не переводить: 3% трафика лендинга, а spotlight пришлось бы рисовать на клиенте прямо на основном контенте.

---

## Часть 4. Конфликт с редизайном hero

**Состояние на 2026-10-22:**

| Что смотрел | Результат |
|---|---|
| Ветки | `git log --all --since=2026-10-15 -- src/components/v3/landing-e`: только коммиты main. Ветки с правками `landing-e` поверх main нет. |
| Main и прод | `main` = `origin/main` = прод. |
| Незакоммиченные правки | В рабочем дереве в `landing-e`, `app/page.tsx`, `(marketing)` и `middleware.ts` их нет. |
| Второй worktree | `JobFlex-v3-copy-sub` (ветка `admin-subscription-editor`, 22.09) лендинг не трогает. |
| Последняя правка hero | `7a852d0f` от 2026-10-21 18:54 −0700: вернул первый экран «как до 19.10» — заголовок, строка, кнопки trial + Google, шот под ними; `hero-proof.tsx` и `hero-fit.css` оставлены, но не смонтированы. Это в main и в проде. |
| Старая ветка `logo-refresh` | 2026-10-03, 8 коммитов, не влита. Трогает `app/page.tsx` (OG-картинка `/api/og` в HVAC-метаданных), `app/layout.tsx`, `landing-e/blueprint-phone.tsx`, `dashboard-mock.tsx`, `landing-e.css`, `logo.tsx`, `showcase-kit.tsx`. |

Если редизайн идёт в другой сессии без коммитов в этом checkout, его не видно. Это стоит уточнить у владельца.

**Какие файлы трогает каждая работа:**

| Файл | Редизайн hero (ожидаемо) | C | A | B |
|---|---|---|---|---|
| `landing-e/hero.tsx` | ✔ | — | ✔ (webview: без `inAppBrowser` с сервера или с ним из slug) | — |
| `landing-e/hero-visual.tsx` | ✔ (визуал первого экрана) | ✔ (`next/dynamic`) | — | — |
| `landing-e/hero-proof.tsx`, `hero-fit.css`, `landing-e.css`, `demo-film.tsx` | ✔ | — | — | — |
| `landing-e/landing-e-page.tsx` | ✔ (`heroLine`, `blocks.hero`) | — | ✔ (cookie триала → константа, utm и tool из props убрать) | ✔ (константа триала) |
| `landing-e/estimators-showcase.tsx`, новый `hvac-timeline.ts` | — | ✔ | — | — |
| `landing-e/landing-variant-server.ts`, `landing-variant-effects.tsx`, `google-signup-button.tsx` | — | — | ✔ | — |
| `landing-e/landing-variants.ts` | ✔ (копирайт) | — | только чтение | — |
| `app/page.tsx`, новый `app/l/[slug]/page.tsx` | — (`logo-refresh`: метаданные) | — | ✔ | — |
| `middleware.ts` | — | — | ✔ | — |
| `lib/planCatalogServer.ts`, `actions/trialPolicy.ts` | — | — | ✔ | ✔ |

**Что делать первым:**
1. **C** — сразу, если редизайна сейчас нет в работе. Пересечение — одна строка импортов в `hero-visual.tsx`, редизайну её легко принять. Если редизайн идёт, C влить сразу после него: правка механическая и переносится за минуты.
2. **A** — после редизайна. Он меняет контракт `<Hero>` (откуда берутся `inAppBrowser`, utm, fbclid), и делать это параллельно с переписыванием hero — гарантированный конфликт.
3. `logo-refresh` при вливании конфликтует с A в `app/page.tsx` (HVAC-метаданные переедут в `app/l/[slug]/page.tsx`). Перенести `images: [{ url: "/api/og" … }]` руками.

---

## Приложение: инструменты замеров (`.cache/isr/`, вне git)

| Файл | Назначение |
|---|---|
| `html-js.cjs`, `dl-chunks.cjs` | Скрипты из HTML прода, их размеры и содержимое чанков |
| `trace.cjs` | Граф статических импортов от `app/page.tsx`: eager- и lazy-цепочки тяжёлых пакетов |
| `analyze-read.cjs`, `eager-check.cjs` | Чтение `next experimental-analyze -o` (`.next-analyze/diagnostics/analyze/data/analyze.data`) по модулям |
| `js-load.cjs`, `css-load.cjs`, `fcp.cjs`, `shots.cjs`, `probe-a.cjs` | Chrome 390×844: байты JS и CSS, FCP и LCP при троттлинге, скриншоты, проверка прототипа A |
| `build-snap*.sh`, `serve-snap*.sh` | Сборка и запуск чистого HEAD-экспорта `snap/` (`.next-isr` — база, `.next-isr-c` — C, `.next-isr-a` — A) |

**Осторожно:** не удалять `snap/` через `rm -rf`, не убрав сначала junction-ы в `.next*` (memory: landing-polish-transfer).
