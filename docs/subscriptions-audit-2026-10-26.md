# Проверка обзора подписок — 2026-10-26

Только проверка: код не менялся, ничего не закоммичено. Stripe — только тестовый ключ (`STRIPE_SECRET_KEY_TEST`, `sk_test_…`) и test clocks; живой Stripe и прод-база не трогались.

**Что проверялось.** `git pull --ff-only origin main` **не прошёл**: локальный `main` разошёлся с `origin/main` (3 локальных коммита 49e9a0ed, 8b6fb7eb, b6434fe3 не запушены, 16 новых на origin не влиты) — `fatal: Not possible to fast-forward, aborting.` Сливать/ребейзить без разрешения не стал. Проверено рабочее дерево локального `main` (вместе с незакоммиченной правкой Deck Studio $49→$79 из другой сессии). Из 16 коммитов origin в тему попадают только `src/lib/paidApiCosts.ts` (добавлен `fal`, цены GPT-6 — EagleView/Cool Calc не тронуты), `src/actions/roofMeasurement.ts` (лимитов не добавляет) и `src/lib/support/aiReply.ts` / `aiSupport.ts` / `actions/supportAi.ts` (сверено в п. 5).

Локальная база `prisma/dev.db`, только SELECT:

```
free          $0     trialDays=0   limitsJson={"proposalsCreated":5,"estimatorUses":3,…}  (без hvacEstimates)
starter       $45    trialDays=14  limitsJson={"workers":1}
professional  $95    trialDays=14  limitsJson={"workers":3}
enterprise    $199   trialDays=14  limitsJson=null   ("Advanced")
```

---

## 1. Нет месячных лимитов на дорогие вызовы

**Вердикт:** подтверждено.

**Доказательство**
- Единственные потолки на платные вызовы — суточные, на компанию: `src/lib/paidCaps.ts:32-57`:
  - `roofNew` — 30 в `DAY`;
  - `roofReorder` — 5 в `DAY`, входят в те же 30;
  - `hvacReportHour` — 20 в `HOUR`;
  - `hvacReportDay` — 30 в `DAY`.
- Окно фиксированное: счётчик живёт до `resetAt = now + windowMs` от первого вызова (`src/lib/rateLimit.ts:99-106`).
- `LIMIT_DEFS` (`src/lib/planLimits.ts:102-131`): ключа на замеры крыш нет, ключа на Manual J / Cool Calc нет.
  - `hvacEstimates` (`:116`) — это **сохранённые HVAC-сметы** (строки `HvacEstimate`), а не отчёты Manual J. Считаются в `src/lib/limitsEngine.ts:310-316` (`hvacEstimate.count` за цикл).
- **Замер крыши (EagleView).** `measureRoofInstant` → `obtainInstant` (`src/actions/roofMeasurement.ts:1041-1070`, `:464`) проверяет только:
  - `requirePage("roof-estimator")`;
  - `takeTrialCap` — действует лишь для триала без карты: `trialCapScope` = `"none"`, если карта есть (`src/lib/trialMeter.ts:121-126`);
  - `takeRoofOrderCap` (30/сутки).
  - `enforcePlanLimit` / `checkPlanLimit` в `roofMeasurement.ts` не вызываются вообще.
  - `estimatorUses` проверяется в `src/actions/roofEstimator.ts:103` — это запуск AI-сметы, а не заказ замера.
  - Провайдер по умолчанию — EagleView (`src/lib/roofMeasurementProvider.ts:6`); `ROOF_MEASUREMENT_PROVIDER` в `.env.local` не задан.
- **Manual J (Cool Calc).** `requestHvacPermitReport` (`src/actions/hvacEstimator.ts:671-712`) проверяет:
  - `requirePage`;
  - `takeHvacReportCap` (`:691`; 30/сутки, 20/час);
  - `takeTrialCap("hvacReports")` (только для триала без карты).
  - Плановых лимитов нет.
  - Косвенная связь: отчёт делается к сохранённой смете, один на смету (`:684`, идемпотентно), а новые сметы считает `hvacEstimates` (`:606`, `:790`). Но ни у одного плана в базе ключа `hvacEstimates` нет: отсутствующий ключ = безлимит (`planLimits.ts:163-166`). Это касается и строки `free`; `DEFAULT_FREE_LIMITS.hvacEstimates: 3` (`:153`) применяется, только если строки `free` нет.
- **Starter по коду, не упираясь ни во что:**
  - замеры EagleView: 30 за каждые 24 ч → **до 930 за 31-дневный месяц** (900 за 30 дней);
  - отчёты Cool Calc: столько же, **до 930** (по 30 в сутки, внутри — не больше 20 в час).
  - Месячного счётчика нет ни у одного, `limitsJson` у Starter — только `{"workers":1}`.

**Риск:**
- В метре расходов Cool Calc стоит $10 за отчёт (`paidApiCosts.ts:72`) → до ~$9,300 в месяц на одну компанию Starter ($45).
- EagleView: 930 × $2.40 (цифра из обзора) ≈ $2,232. Метр же считает $5 за пакет (заглушка, п. 9), до 7 пакетов на новый адрес (`src/lib/eagleview.ts:803-811`).

**Оценка фикса:** 4–6 ч. Два ключа в `LIMIT_DEFS` со счётчиками по `InstantOrder` и `HvacEstimate.permitJson`, проверка в двух экшенах, поля в /admin/plans; значения — решение владельца.

---

## 2. Upgrade списывает дважды без зачёта неиспользованных дней

**Вердикт:** частично.

Верно для повышения тарифа внутри того же срока (month→month, year→year). Это сделано намеренно, и диалог об этом предупреждает. month→year и year→month работают так, как владелец решил 2026-10-12.

**Доказательство — код**

Маршрут выбирает `changeRoute` (`src/lib/planChangeRoute.ts:29-35`):

| Изменение | Маршрут | Что делает Stripe |
|---|---|---|
| Trial, любое | `trial` | Цена меняется, `proration_behavior: "none"`, `trial_end` сохраняется (`src/lib/planChange.ts:493-498`). |
| year → month | `schedule` | `subscriptionSchedules` — фаза 1 до `end_date` = конец оплаченного года, фаза 2 месячная, обе `proration_behavior: "none"` (`planChange.ts:584-594`). |
| month → year | `charge` | `proration_behavior: "always_invoice"`, `billing_cycle_anchor: "now"`, `payment_behavior: "pending_if_incomplete"` (`planChange.ts:462-467`); неоплата → инвойс аннулируется (`:476-480`). |
| month → month (или year → year) **вверх по тарифу** | `checkout` (`planChangeRoute.ts:33`) | Новая подписка через Stripe Checkout по полной цене, без триала (`src/app/api/checkout/subscription/route.ts:257-266`). Кредита или купона за остаток нет. Старая подписка отменяется с `{ prorate: false, invoice_now: false }` (`src/lib/checkoutReturn.ts:59`). |
| тот же тариф дороже, одна строка | `charge` (без смены якоря, `proration_date`) | Разница с кредитом. |
| дешевле | `free` | Без начислений и без возврата. |

- Пользователю перед `checkout` показывается: «Paid on Stripe now · your current subscription ends the moment payment goes through · **no credit for its unused days**» (`src/components/billing/ConfirmPlanChange.tsx:84`).
- Устаревший комментарий в `src/components/v3/upgrade-blueprint/upgrade-content.tsx:8-12` («up charges the prorated difference now… checkout only when there is no subscription yet») противоречит коду.
- Support-гайд сам это отмечает: «Tier upgrades cancel the old subscription with `prorate: false`» (`src/lib/support/handbook.ts:173`).
- Админский редактор (`src/lib/subscriptionEditor.ts:368, 510`) берёт `proration_behavior` из выбора админа.

**Доказательство — Stripe test mode.** Test clocks, старт 2026-10-01 12:00Z. Скрипт повторяет ровно те вызовы, что делают `planChange` / `checkoutReturn`. Вместо оплаты на странице Checkout — `subscriptions.create` с той же ценой: результат тот же, полный первый инвойс. Скрипт: `C:\Users\ivana\AppData\Local\Temp\claude\c--Projects-JobFlex-v3-copy\1ea4fcff-4aec-4ef7-9f7f-82a1b43f08f6\scratchpad\audit\clock.cjs`.

```
A  Starter $45/mo → Professional $95/mo на 10-й день  (clock_1UUypu3hfHMBJdIEGx4HcQSb, cus_VW0rLSOSzxsKEs)
   old sub_1UUypv3hfHMBJdIEASzeKn4m -> canceled; new sub_1UUyq43hfHMBJdIEcQErzUcx active
   in_1UUypw3hfHMBJdIEb5ODHFE2 paid subscription_create $45.00   line $45.00
   in_1UUyq43hfHMBJdIETLuQzfsc paid subscription_create $95.00   line $95.00
   credit notes: 0 · customer balance: $0.00

B  Professional $95/mo → $855/yr на 10-й день  (clock_1UUyq73hfHMBJdIEV3BQMZM9, cus_VW0r0mSO0xD1bT)
   in_1UUyqG3hfHMBJdIEgcGk2SJR paid subscription_update $790.65
       line $-64.35  Unused time on … after 11 Oct 2026
       line $855.00  1 × … (at $855.00 / year)

C  Professional $855/yr → monthly, заказано на 40-й день  (clock_1UUyqJ3hfHMBJdIEUAAnkJS5, cus_VW0sAGMNQcG760)
   schedule sub_sched_1UUyqQ3hfHMBJdIEvKS9WoeM, switch at 2027-10-01T12:00:00Z
   инвойсов кроме первого $855.00 нет, credit notes: 0
```

**Сверка с решением владельца 2026-10-12:**
- month→year — немедленный инвойс с кредитом остатка месяца: **совпадает** (B: −$64.35 за 20 дней из 30).
- year→month — только в конце оплаченного года: **совпадает** (C).
- Повышение тарифа на том же сроке — Checkout без зачёта (A): $45 за Starter сгорают целиком, хотя использовано 10 дней (~$30 неиспользованного).

**Риск:** клиент, повышающий тариф в середине месяца, теряет остаток (до цены старого плана; на годовом Starter — до $405) и видит два полных списания. Это повод для споров и chargeback, хотя диалог предупреждает.

**Оценка фикса:** 3–5 ч. Перевести tier-up на тот же `charge` (`always_invoice`) или выдавать купон/кредит на остаток при Checkout; тест на test clock.

---

## 3. SMS сверх квоты: «3¢» показывается, но не биллится

**Вердикт:** подтверждено.

**Доказательство**
- `SMS_OVERAGE_CENTS = 3` (`src/lib/entitlements.ts:63`) — **ни одного читателя**: `grep -rn SMS_OVERAGE_CENTS src` находит только определение.
- `SMS_ALLOWANCE` (`:57-62`: Free 50 / Starter 250 / Professional 1000 / Advanced 4000) читается только для показа: `smsAllowanceFor` → `src/app/(dashboard)/dashboard/subscription/subscription-load.ts:327` и счётчик на странице текстов.
- `invoiceItems.create` в коде один — `src/lib/payments/feeBilling.ts:43`, это `kind: "platform_fee"` с платежей, не SMS. Других начислений за SMS нет.
- `src/lib/sms/send.ts` при превышении месячной квоты ничего не делает: квоту не проверяет и отправляет. Ограничения только такие:
  - план закончился (`orgMayText`, `:116`);
  - суточные потолки: 25 на номер, **500 на компанию**, 5000 на платформу (`:43-45`, `:131-140`);
  - лимитер недоступен — fail-closed.
- Что видит пользователь (`/dashboard/texting`, и мобильная версия): «N / allowance» и строка **«Beyond the allowance, texts are billed through at 3¢ each.»** (`src/components/v3/settings-blueprint/settings-data.ts:852` → `src/components/v3/texting-page/texting-page.tsx:78,85`, `src/components/v3/mobile-texting/mobile-texting.tsx:85,91`).
- Support-гайд сам признаёт: «SMS 3¢ overage is copy only» (`src/lib/support/handbook.ts:173`), «(verify — nothing bills it)» (`:411`).

**Риск:**
- Starter (квота 250) может отправить до 500 в сутки, ~15,500 в месяц, без доплаты. Это ~$190 себестоимости Twilio по метру (1.25¢, `paidApiCosts.ts:73`) против $45.
- Обещание счёта, которого нет, плохо и для клиента, и для юридической стороны.

**Оценка фикса:** 4–8 ч, если биллить: месячный счётчик `SmsMessage` + `invoiceItems.create` в cron/вебхуке инвойса. 0.5 ч, если убрать строку.

---

## 4. Длина триала в разных местах

**Вердикт:** частично.

Все экраны регистрации, лендинг, /pricing и письма показывают **7**, и в Stripe при регистрации уходит 7. Но **14** живёт в трёх местах:
- в колонке `PricingPlan.trialDays` (seed и локальная база);
- в Terms («1 to 14 days»);
- в рекламных файлах.

Колонку `PricingPlan.trialDays` читает внутренний Checkout `/api/checkout/subscription`.

**Доказательство — откуда 7 при регистрации**
1. `src/app/(auth)/auth/register/checkout/route.ts:87` → `createSignupCheckout`.
2. `src/lib/signupPricing.ts:70`: `const trialDays = storedTrialOffer(opts.trialOffer).days;` — `PricingPlan.trialDays` игнорируется.
3. `src/lib/trialOffer.ts:6`: `LEGACY_TRIAL_OFFER = { variant: "b", days: 7 }`; `:13`: `TRIAL_TEST_ENDED = true`.
4. `src/lib/signupCheckoutSession.ts:115`: `trial_period_days: trialDays` → **7**.

Переменной окружения для длины нет.

| Место | Что показывает | Источник |
|---|---|---|
| Регистрация, шаг 1 (десктоп и мобильный лист) | «{7}-DAY FREE TRIAL», «Start Your 7-Day Free Trial» | `passwordless-step.tsx:557,646,748` ← `trialDays={offer.days}` (`register-content.tsx:1719`) ← `trialOffer.ts` (константа) |
| Регистрация, шаг плана | «Start your 7-day free trial», «Your 7-day free trial renews automatically…» | `register-content.tsx:2199,2402,2609`; `actions/signupPaywall.ts:70,87-88` подменяет `trialDays` всех планов на 7 из оффера |
| Stripe при регистрации | `trial_period_days = 7` | цепочка выше (константа) |
| Триал без карты (выключен) | 7 | `cardlessTrial.ts:111` ← `signupPricing.ts:70` |
| Лендинг (landing-e), FAQ, карточки | «Start my 7-day FREE TRIAL», «What happens after 7 days?» | `landing-e-page.tsx:134,158-160`, `landing-faq.tsx:47,51,70`, `pricing-plans.tsx:79,247` ← `signupTrialOffer()` |
| /pricing | «Included in your 7-day trial» | `deck-addon-plate.tsx:31,58` ← `(marketing)/pricing/page.tsx:42` |
| /dashboard/upgrade, Subscription | Число дней не показывает (`trialDays` передаётся, но не рендерится; `upgrade-content.tsx:65`) | — |
| **Внутренний Checkout** `/api/checkout/subscription` | `trial_period_days = PricingPlan.trialDays` → **14 локально** | `route.ts:266` `trialDaysFor(organizationId, plan.trialDays)`. 0, если у компании уже была любая подписка или триал (`trialEligibility.ts:45-48`): 14 получит только компания, у которой подписки никогда не было (например, созданная не через регистрацию). |
| Settings → Billing | Дата «Trial ends», без числа дней | `loadSettingsData.ts:572,582-583` ← `Subscription.trialEndsAt` (из Stripe) |
| Settings → Billing → Before you go → продление | «7 / 14 days» (дни продления, не длина триала) | `trialExtension.ts:12` `EXTENSION_DAYS = [7, 14]` |
| Terms | «Promotional free trials may last from **1 to 14 days**… The exact duration offered to you is shown before enrollment and confirmed at checkout» | текст, `src/app/(marketing)/terms/page.tsx:39` |
| Письмо приветствия | «Trial: 7 days free» | `email/build/platform.ts:122,127` ← `storedTrialOffer(...).days` |
| Письмо «2 days left» (триал с картой) | «Your first week on JobFlex», «your free week… ends» | текст, `email/build/trial.ts:115,121-122` |
| Admin → Trials | «7-day trial» | текст, `admin-trials/trial-policy-panel.tsx:37-38`, `signup-plan-panel.tsx:40` |
| Admin → Plans | «{trialDays}-day trial» → **14 локально** | колонка, `admin-plans-content.tsx:362,457` |
| Outreach (AI-звонок / SMS) | «a 14-day free trial» локально | `outreach/server.ts:382` (max `PricingPlan.trialDays` планов в продаже, иначе 7) → `outreach/script.ts:148,153,221` |
| Investor pitch deck | «14-day» локально | `pitch-deck.tsx:286` ← `investorPitchData.ts:36` (колонка) |
| Support-гайд | «Length: 7 days for every new sign-up.» | текст, `src/lib/support/handbook.ts:118` |
| Seed | 14 для starter / professional / enterprise, лог «(14-day trial)» | `prisma/seed.ts:757,780,799,833` (create-only) |
| Реклама (не код приложения) | «Free 14 days. No card.» | `marketing/ads/ads.json:5,27,165`, `marketing/ads/README.md:4,100`, `marketing/ads/v2-real-ui/scripts/*.mjs` |
| Мёртвый код | «Starts with a {selected.trialDays}-day free trial» | `settings/account/plan-actions.tsx:88-90` (не импортируется) |

Значения на проде не проверены. По комментарию в `register-content.tsx:1662-1664`, в /admin/plans на 2026-09-26 стояло 7.

**Риск:**
- На проде, если там как локально (14), outreach обещает 14 дней, а регистрация даёт 7.
- Компания без подписки, купившая через внутренний Checkout, получит 14 дней и письмо про «first week».
- Реклама «14 days, no card» противоречит продукту (7 дней, карта обязательна).

**Оценка фикса:** 2–3 ч. Одна точка правды (оффер) для `/api/checkout/subscription`, outreach и pitch deck; выровнять seed. Реклама и Terms — решение владельца.

---

## 5. Support-гайд обещает возвраты, которые Terms запрещают

**Вердикт:** подтверждено.

**Доказательство.** Terms, `handbook.ts` и правила возвратов в промптах одинаковы на локальном `main` и `origin/main`. Незакоммиченная правка `handbook.ts` касается только цены Deck.

| Support-гайд (идёт в контекст AI целиком через `supportSystemPrompt()`) | Terms (`src/app/(marketing)/terms/page.tsx`) |
|---|---|
| `src/lib/support/handbook.ts:166-167`: «### Refunds (terms §2)» «"You can request a full refund within 14 days of your first subscription charge. Otherwise, charges are non-refundable except as required by law or expressly offered by us."» | `:51`: «JobFlex is a subscription, and charges are non-refundable.» |
| `handbook.ts:491`: «…full refund on request within 14 days of the first subscription charge; cancel in Settings → Billing…» | `:53-55`: «…a charge made because the subscription was not canceled beforehand is not refunded, in whole or in part, and unused time is not credited. The only exceptions are where the law requires a refund or where we expressly offer one in writing.» |
| `handbook.ts:271` (Deck Studio): «removes it on Subscription (the unused part comes back as a credit on the next bill)» — так и в коде: `src/lib/deckAddonBilling.ts:247` `proration_behavior: "create_prorations"`, UI `src/components/v3/deck-addon/deck-addon.tsx:197,238` | `:54`: «unused time is not credited» |

- Фраза про 14-дневный возврат **была** в Terms. Её удалил коммит `e45748c8` (2026-10-19, «terms: no refunds — a subscription you cancel before the next charge»). Строки гайда написаны раньше, в `b9f737c8` (2026-10-15), и с тех пор не обновлялись. Гайд по-прежнему подписывает их как цитату Terms («terms §2»).
- Тот же гайд в других местах с Terms согласен:
  - `:133` «No credit for the old plan's unused days — don't promise one»;
  - `:135`, `:143` «Nothing is refunded for the days you don't use»;
  - `:167` (продолжение) «**Never promise a refund, credit, discount or free minutes**».
- Что сдерживает AI:
  - `src/lib/support/aiReply.ts:208` (на origin `:209`): «NEVER: Promise or discuss refunds, credits, compensation…»;
  - регулярка `COMMITS` (`:97`) с `refund\w*|…|chargeback\w*|…|account credit` не даёт автоматически отправить ответ, где упоминается возврат, — он уходит человеку;
  - на `origin/main` добавлен блок CANCELLATIONS (`:219-226`) «Never refunds, credits or discounts».
  - Но черновик, который команда отправляет вручную, и сама модель опираются на устаревший факт «14 days refund».
- Остальной пользовательский текст возвратов не обещает: `FreeSwitch.tsx:310`, `email/build/billing.ts:174`, `ConfirmPlanChange.tsx:84,87`, `LeadPurchase.tsx:234`. Код возвратов по подпискам нет: `stripe.refunds.create` только в `src/lib/leadCenter/purchase.ts:535` (лиды), credit notes нет.

**Риск:** Terms делают исключение для возврата, «expressly offered in writing». Письмо поддержки по черновику с «full refund within 14 days» и есть такое письменное предложение: компания будет обязана вернуть деньги.

**Оценка фикса:** 0.5–1 ч (строки 166-167, 271, 491 гайда; проверить `qa/tests/logic/support-ai.check.ts`).

---

## 6. «$49/mo» вбито текстом

**Вердикт:** частично.

Верно для закоммиченного кода (`HEAD` и `origin/main`): в четырёх сообщениях об ошибке и в support-гайде цена записана текстом. В незакоммиченном рабочем дереве (переход на $79 из другой сессии) сообщения уже собираются из констант; литералы остались только в гайде — намеренно, для старых покупателей.

**Доказательство**
- Константы: `src/lib/deckAddon.ts`:
  - `:18` `DECK_ADDON_CENTS = 7900` (в `HEAD` 4900);
  - `:26-38` `deckAddonCents` / `deckAddonPriceWords` / `deckAddonShortWords`;
  - `:53-60` `deckAddonHeldWords` («$49/mo (your price)» из центов самой строки подписки);
  - `:63-65` `isDeckAddonLine` по `price.metadata.jfKind`.
- **Литералы в `origin/main` / `HEAD`** (`git show origin/main:<file> | grep -n '$49'`):

  | Файл | Строка на origin/main |
  |---|---|
  | `src/actions/deckClientDesign.ts` | 67 |
  | `src/actions/deckEstimator.ts` | 65 |
  | `src/actions/deckVoice.ts` | 32 |
  | `src/app/api/deck/voice/transcribe/route.ts` | 34 |
  | `src/lib/support/handbook.ts` | 113, 182, 271 |

  Пример (`HEAD:src/actions/deckEstimator.ts:64`): «Saving, sending and printing are part of Deck Studio — add it to your plan ($49/mo) from the Deck estimator.»
- **Рабочее дерево:** те же четыре строки строятся как `${deckAddonShortWords()}`. Цену читают из констант:
  - `src/actions/deckClientDesign.ts:67`, `src/actions/deckEstimator.ts:65`, `src/actions/deckVoice.ts:33`, `src/app/api/deck/voice/transcribe/route.ts:35`;
  - `src/app/dashboard/upgrade/page.tsx:129`;
  - `src/components/v3/deck-estimator-blueprint/deck-coming-soon.tsx:29,44`;
  - `src/components/v3/landing-e/pricing-plans.tsx:242`;
  - `src/components/v3/deck-addon/deck-addon.tsx:58,102,121,214`;
  - `src/lib/settings/loadSettingsData.ts:502`;
  - `src/lib/planSpotlight.ts:96`.
- Литералы цены Deck в рабочем дереве — только в гайде (`handbook.ts:113,182,271`): «$79/mo ($790/yr…); $49/mo ($490/yr) for shops that bought it before 2026-10-26».
- Логики по сумме нет: `=== 4900` / `unit_amount ===` не найдены. Строку add-on везде ищут по `isDeckAddonLine` (jfKind): `deckAddonBilling.ts:374,393`, `planChange.ts:216`. Сравнения сумм есть только для показа (`deckAddon.ts:59`) и для решения, переписать ли запись (`deckAddonBilling.ts:402`).
- Мелочи рабочего дерева — показывают прайсовую цену там, где у старого покупателя действует его $49:
  - `deckAddonBilling.ts:185`: возвращаемое значение `termCents`, в UI не показывается;
  - `planChange.ts:304`: превью маршрута checkout, на практике недостижимо — галочка скрыта, если строка уже есть.

**Риск:**
- Пока правка $79 не закоммичена, на проде всё согласовано на $49.
- Если закоммитить только `deckAddon.ts`, сообщения об ошибке в `HEAD` продолжат говорить «$49/mo» новым покупателям при цене $79.

**Оценка фикса:** 0 ч дополнительно: уже сделано в незакоммиченной правке, её нужно закоммитить целиком.

---

## 7. «Not in this plan» / «included» читаются из текста карточки

**Вердикт:** подтверждено.

**Доказательство — откуда метки.** Все карточки строятся из `PricingPlan.features` — свободного текста, который вводится в /admin/plans (`src/actions/admin.ts:36,66`):
- общий источник:
  - `getPlanCatalog()` (`src/lib/planCatalogServer.ts:65-71`) разбирает `features`;
  - `withoutDeckRows` (`:76-78`) убирает строки по регулярке `DECK_ROW` (`src/lib/planRowUsage.ts:42`);
  - `expandPlanFeatures` (`src/lib/planCatalog.ts:119-144`) строит наборы «included» из текста и строк «Everything in X»;
  - `spotlightRow` ищет инструмент по регулярке в тексте (`src/lib/planSpotlight.ts:43-51,81-85`), `SPOTLIGHT_MISSING = "Not in this plan"` (`:111`).
- Где это рендерится:
  - лендинг и /pricing: `src/components/v3/landing-e/pricing-plans.tsx:218` `const on = has.has(f.toLowerCase())` → галочка или прочерк, «Included: » / «Not included: », тег `SPOTLIGHT_TAG : SPOTLIGHT_MISSING` (`:231`);
  - регистрация: `register-content.tsx:589-625,2360-2375`, планы из `actions/signupPaywall.ts:89` (`features: p.features`);
  - Upgrade: `upgrade-content.tsx:281-284,668-682`;
  - мобильный Upgrade: `mobile-upgrade.tsx:225,641-650`;
  - Subscription переиспользует эти же компоненты (`subscription-content.tsx:326`, `mobile-subscription.tsx:536`);
  - диалог смены плана: `ConfirmPlanChange.tsx:92-94` → `planDiff` (`src/lib/planDiff.ts:3-6`, «the features an admin typed on /admin/plans»).
- Из реальных данных на карточках только две вещи:
  - числа «20/mo» / «Unlimited» перед уже отмеченной строкой (`rowUsage` из `limitsJson`, `planRowUsage.ts:52-62`);
  - блок выбора Deck (рабочее дерево).

**Доказательство — откуда доступ.** Гейты `PricingPlan.features` не читают:
- страницы: `requirePage` → `lockReason` (`src/lib/customPageAccess.ts:124-163`); `readCustomPages` возвращает `null` для любого плана, кроме `CUSTOM` (`:89`) → **на Starter / Professional / Advanced открыты все страницы**;
- функции: `MINIMUM_PLAN_FOR` = `"FREE"` для всех (`src/lib/entitlements.ts:41-53`);
- квоты: `limitsJson` (`src/lib/limitsEngine.ts:224-258`);
- Deck Studio: `hasEdition` (`src/lib/editions.ts:130-137`).

**Пример расхождения** (локальная `dev.db`):
- Starter: `features = ['Client & lead management','Manual proposals & invoices','Online payments…','Branded PDF export','1 user']`, `limitsJson = {"workers":1}`.
- Professional добавляет «AI proposal generation», «AI estimating», «Job scheduling & calendar», «Lead management & follow-up automation», «Up to 3 users».

Что из этого следует:
1. **Карточка Starter** ставит прочерк («Not included») у «AI proposal generation», «AI estimating», «Job scheduling & calendar». С `?tool=smart` она пишет **«Not in this plan»**.
   Реальный доступ STARTER:
   - `requirePage(org, ["smart-proposal","video-estimator"])` (`src/actions/advancedEstimator.ts:211`) проходит;
   - `requireFeatureOrThrow(plan, "advanced_estimator")` (`:216`) проходит;
   - `estimatorUses` безлимитный.

   Гайд поддержки говорит то же, что код, а не карточка: «every standard plan has every estimator but Deck Studio» (`handbook.ts:182`).
2. **Диалог понижения** Professional → Starter показывает замок у этих четырёх строк. На деле меняется только `workers` 3 → 1.
3. **«1 user» / «Up to 3 users»** — это лимит `workers` (монтажники). Офисных мест (`teamSeats`) ключа нет, то есть они безлимитны (`src/actions/team.ts:91`).
4. **Seed:** у Starter нет «Roof estimator», а с `?industry=roofing` регулярка `/\broof(ing)?\b/` находит строку у других планов → Starter: «Not in this plan». При этом страница `roof-estimator` для Starter открыта.
5. **Рабочее дерево, мелочь:** `deckAddonPick` / `deckAddonOffer` (`src/lib/deckAddonBilling.ts:281-346`) не проверяют `hasFullAccess`. Платформенному админу без add-on предлагается «Add Deck Studio · +$79/mo», хотя студия у него открыта (`editions.ts:132`).

**Риск:**
- Карточки занижают Starter: часть людей переплачивает за Professional ради того, что у них уже есть.
- Диалог понижения обещает заблокировать функции, которые не блокируются.
- Обратный случай тоже возможен: админ впишет в текст функцию, которой у плана нет.

**Оценка фикса:**
- 1 ч — выровнять текст `features` в /admin/plans на проде (данные, без кода);
- 6–10 ч — выводить метки из реального доступа (`customPageAccess` / `limitsJson`).

---

## 8. Люди на старом плане deck-studio / $89

**Вердикт:** не подтверждено. По коду такие подписки маловероятны; прод не проверен: `C:\Users\ivana\Downloads\prod-db-url.txt` нет.

**Доказательство — история slug `deck-studio`** (`git log -S "deck-studio" -- src prisma` и т. п.)

| Коммит | Дата | Что сделал |
|---|---|---|
| `5a126293` | 2026-10-11 01:50 | «Deck Studio edition»: «$89 a month, $890 a year». В `lib/editions` добавлены `planSlugs: ["deck-studio", "deck"]` и QA-фикстура `priceCents: 8900`. **Ни seed, ни `prisma/` не менялись** — строку плана можно было создать только руками в /admin/plans. |
| `87bfc201` | 2026-10-11 14:48 (через ~13 ч) | «Deck Studio is coming soon — nothing sells it»: план снят с продажи, Checkout отвечает 409. |
| `f4d72d6a`, `936f3950` | 2026-10-19 / 20 | Модель add-on $49, ни один план его не включает. |
| `c4313f26` | 2026-10-20 | `DECK_PLAN_SLUG "deck-studio"` за $45/мес (строку плана — в /admin/plans). |
| `7a852d0f` | 2026-10-21 | Ветки deck-studio удалены, «the plan row itself is deleted in /admin/plans». |
| `d0f48b23` | 2026-10-22 | Возврат к add-on $49 (сейчас незакоммиченная правка переводит его на $79). |

- В seed были только `free`, `starter`, `professional`, `enterprise` (`prisma/seed.ts:717,752,775,794`, с `671de403`, 2026-07-07). Плюс `custom` в коде (`lib/customPlan`, строки каталога нет).
- В текущем дереве на slug `deck-studio` ссылаются только имена CSS-файлов.
- Косвенный аргумент «нет»: `deletePlan` (`src/actions/admin.ts:124-133`) отказывает удалять план, если на нём есть **любая** строка `Subscription`: «Subscribers are on this plan — deactivate it instead of deleting.» Если строку deck-studio действительно удалили 2026-10-21, подписчиков на ней в тот момент не было. Это не доказательство: она могла быть деактивирована, а не удалена.

**Доказательство — что будет с подпиской, чей slug не в каталоге**
- План подписки — строка `Subscription.plan` (slug в верхнем регистре). Вебхук находит её по `PlanPrice.stripePriceId` (активной или архивной), затем по `price.metadata.jfKind` (`src/lib/stripeSync.ts:51-66`). Если не нашёл: при обновлении сохраняется старый план (`:379`), при создании ставится `"FREE"` (`:388`).
- Уровень функций — `src/lib/orgPlan.ts:25-44`:
  - lapsed → `FREE`;
  - встроенный уровень → он сам;
  - `CUSTOM` → `PROFESSIONAL`;
  - иначе: есть строка `PricingPlan` с этим slug (**даже неактивная**, «grandfathered») → `ENTERPRISE`;
  - строки нет → **`FREE`**.
  - То же в `getOrgPlanContext` (`src/lib/planCatalogServer.ts:146-172`).
- Последствия для slug без строки в каталоге:
  - квота SMS 50 (`entitlements.ts:64-69`);
  - **Deck Studio считается lapsed**: `src/lib/editionAccess.ts:23` `lapsed = ctx.tier === "FREE"` → `hasEdition` отдаёт только превью, хотя add-on куплен (`src/lib/editions.ts:134-136`);
  - лимиты при этом **безлимитные**: `parsePlanLimits(null)` (`src/lib/limitsEngine.ts:243-257`); страницы открыты (`customPageAccess.ts:68-72,89`). Ничего не падает.
- Локально (`dev.db`, только SELECT): подписок с неизвестным slug — 0, с deck/$89 — 0, строк плана deck/$89 — 0.

**Запросы для прода (Postgres; не выполнялись):**
```sql
-- подписки на slug, которого нет в каталоге (CUSTOM строки не имеет по замыслу)
SELECT s."plan", s."status", s."provider", count(*) AS n
FROM "Subscription" s
LEFT JOIN "PricingPlan" p ON lower(p."slug") = lower(s."plan")
WHERE p."id" IS NULL AND upper(s."plan") <> 'CUSTOM'
GROUP BY 1,2,3 ORDER BY n DESC;

-- подписки на деактивированном плане
SELECT p."slug", p."name", p."priceCents", s."status", count(s."id") AS n
FROM "PricingPlan" p JOIN "Subscription" s ON lower(s."plan") = lower(p."slug")
WHERE p."active" = false
GROUP BY 1,2,3,4 ORDER BY n DESC;

-- всё, что похоже на deck-studio / $89
SELECT s."organizationId", o."name", s."plan", s."status", s."provider", s."stripePriceId",
       pp."planSlug", pp."unitAmountCents", s."createdAt", s."canceledAt"
FROM "Subscription" s
JOIN "Organization" o ON o."id" = s."organizationId"
LEFT JOIN "PlanPrice" pp ON pp."stripePriceId" = s."stripePriceId"
WHERE lower(s."plan") LIKE '%deck%'
   OR lower(coalesce(pp."planSlug", '')) LIKE '%deck%'
   OR pp."unitAmountCents" IN (8900, 89000);

SELECT "slug","name","priceCents","yearlyPriceCents","active","createdAt" FROM "PricingPlan"
 WHERE lower("slug") LIKE '%deck%' OR lower("name") LIKE '%deck%' OR "priceCents" = 8900 OR "yearlyPriceCents" = 89000;
```
Фильтровать по 4500 не нужно: это цена Starter, она совпадает с ценой deck-studio от 2026-10-20.

**Риск:** если такие подписчики есть и строки плана нет:
- они платят $89 или $45, а Deck Studio у них в превью;
- лимиты при этом безлимитные;
- если строка есть (неактивная), уровень у них `ENTERPRISE`.

**Оценка фикса:** 0.25 ч — выполнить запросы. 1–2 ч — перевести найденных вручную, если они есть.

---

## 9. Placeholder цены EagleView в paidApiCosts.ts

**Вердикт:** подтверждено.

**Доказательство**
- `src/lib/paidApiCosts.ts:69-70` (одинаково на локальном `main` и `origin/main`):
  ```ts
  // PLACEHOLDER — the contract price per Instant pack is not public.
  eagleview: { pack: 500, report: 4500 },
  ```
- Шапка `:15-18`: «EagleView — the published report price runs $24.25–$87; the Property Data (Instant) price per pack is the contract's and is NOT public — the figure below is a placeholder until the owner puts the contract price in.»
- Цифры $2.40 из обзора в коде нет: grep по `2.40` по `src` ничего не находит.
- Списывается пакетами: `notePaidCall("eagleview", "pack", { units: packs.length })` (`src/lib/eagleview.ts:1366`), до 7 пакетов на новый адрес (`PD_DIAGRAM_PACKS`, `:803-811`) → по заглушке до $35 за один замер.
- Явно помеченных placeholder в таблице больше нет: grep `PLACEHOLDER|placeholder` находит только EagleView. Но остальные цифры тоже оценки:
  - шапка: «Estimates at list price, first volume tier», источники прочитаны 2026-10-02;
  - Cool Calc `report: 1000` ($10) при источнике «$3 to $15 a Manual J report credit (pack size)» (`:13`, `:72`) — точку внутри вилки никто не подтвердил;
  - на `origin/main` добавлен `fal: { depth: 1 }` с пометкой «a cent or so at list price».

**Риск:** `/admin/usage`, метр триала и `ApiSpendDaily` показывают расход EagleView по выдуманной цене: решения о лимитах (п. 1) принимаются по неверной себестоимости.

**Оценка фикса:** 0.25 ч, когда владелец даст контрактную цену (одна строка). Старые записи сохраняют свои центы (`:3-5`).

---

## 10. Реальная длина триала и напоминание «48 hours before»

**Вердикт:** совпадает (не подтверждено как проблема), с оговоркой про текст письма.

**Доказательство**
- Регистрация: `trialDays` берётся не из плана, а из оффера — константа 7 (`src/lib/signupPricing.ts:70` ← `src/lib/trialOffer.ts:6,13`) → `trial_period_days: 7` (`src/lib/signupCheckoutSession.ts:115`). `PricingPlan.trialDays` (14 локально) здесь не участвует.
- Напоминание:
  - `TRIAL_ENDING_WINDOW_MS = 48 * HOUR_MS` (`src/lib/trialEndingMail.ts:11`); письмо уходит, когда до конца ≤ 48 ч, один раз на подписку и дату конца (`:27-28`, `:67`);
  - вызывается из `/api/cron/trials` (`src/app/api/cron/trials/route.ts:4,11`) по расписанию `"20 * * * *"` (`vercel.json:19`) → фактически за 47–48 ч;
  - в письме: «Free trial · 2 days left», «Cancel in Settings → Billing before ${day} and nothing is charged.» (`src/lib/email/build/trial.ts:117,128`) — с таймингом совпадает;
  - вебхук Stripe `customer.subscription.trial_will_end` (за 3 дня) письма не шлёт, только синхронизирует (`src/app/api/webhooks/stripe/route.ts:136-144`).
- Ни лендинг, ни регистрация, ни Terms не обещают напоминания за конкретный срок, так что противоречия нет.
- Оговорки:
  - тема и текст письма — «Your first week» / «your free week» (`trial.ts:115,121-122`): верно только для 7-дневного триала, для 14-дневного (внутренний Checkout, п. 4) — неверно;
  - support-гайд утверждает: «The app sends no reminder before a card trial's first charge» (`src/lib/support/handbook.ts:173`) — это **устарело** с 2026-10-16, AI-поддержка ответит клиенту неверно.

**Риск:** малый: неверный ответ поддержки про напоминание; «first week» в 14-дневном случае.

**Оценка фикса:** 0.5 ч (строка гайда + текст письма от `trialDays`).

---

## Таблица вердиктов

| # | Утверждение | Вердикт | Риск (одна строка) | Фикс, ч |
|---|---|---|---|---|
| 1 | Нет месячных лимитов на EagleView / Manual J | Подтверждено | Starter: до 930 замеров и 930 отчётов Cool Calc в месяц | 4–6 |
| 2 | Upgrade без зачёта неиспользованных дней | Частично | Tier-up на том же сроке сжигает остаток старого плана (диалог предупреждает); month↔year по решению 2026-10-12 | 3–5 |
| 3 | SMS 3¢ сверх квоты не биллится | Подтверждено | Обещан счёт, которого нет; до ~15.5k SMS/мес на Starter без доплаты | 4–8 (или 0.5 убрать текст) |
| 4 | Длина триала расходится | Частично | Регистрация 7; колонка плана / outreach / Terms / реклама — 14 | 2–3 |
| 5 | Гайд обещает возвраты против Terms | Подтверждено | Черновик поддержки с «full refund within 14 days» — письменное обещание, которое Terms потом обязывают выполнить | 0.5–1 |
| 6 | «$49/mo» вбито текстом | Частично | Верно для `HEAD` / `origin/main` (4 сообщения + гайд); в незакоммиченной правке $79 уже из констант | 0 (закоммитить правку целиком) |
| 7 | Метки «included» из текста карточки | Подтверждено | Starter помечен «Not in this plan» для того, что у него открыто; диалог понижения обещает несуществующие блокировки | 1 (текст) / 6–10 (из доступа) |
| 8 | Подписчики на старом deck-studio / $89 | Не подтверждено (прод не проверен) | Если есть без строки плана: платят, а Deck Studio в превью | 0.25 запрос + 1–2 |
| 9 | Placeholder цены EagleView | Подтверждено | Расход EagleView в админке по заглушке $5/пакет | 0.25 после цены |
| 10 | Реальный триал и «48 hours» | Совпадает | Гайд поддержки ошибочно говорит, что напоминания нет | 0.5 |
