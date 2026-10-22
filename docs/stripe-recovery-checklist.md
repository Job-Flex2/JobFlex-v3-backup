# Stripe: как возвращать упавшие списания — чеклист настроек

Для владельца JobFlex, 2026-10-21. Только проверка и чтение — **в Stripe ничего
не меняется без вашего решения**. Всё делается в live-режиме дашборда
(переключатель «Test mode» в правом верхнем углу выключен).

Что уже делает приложение (без настроек Stripe): каждое неудачное списание
записывается с причиной и типом карты — `/admin/revenue/failed-payments`;
владелец получает письмо и SMS со ссылкой на `/dashboard/subscription`, где
баннер меняет карту и сразу оплачивает открытый счёт.

> Названия пунктов меню Stripe меняются. Если пункта нет там, где указано, —
> поиск по дашборду (клавиша `/`) по названию функции, либо вопрос в
> поддержку Stripe (ссылки внизу).

---

## 1. Card Account Updater (автообновление карт)

**Что это.** Когда банк перевыпускает карту (новый срок или номер), сеть
сообщает Stripe новые данные, и сохранённая карта обновляется сама. Это прямо
бьёт по `expired_card` и части `card_declined` в нашей статистике.

**Где.** Stripe пишет, что для большинства аккаунтов это работает
автоматически, отдельного включения нет (Visa, Mastercard, Amex, Discover).
Если в вашем дашборде есть раздел **Settings → Payments → Card updates** (или
похожий), — проверьте, что он не выключен.

**Как проверить, что работает на live.**
1. **Developers → Events**, фильтр по типу события
   `payment_method.automatically_updated`. Если за последние месяцы такие
   события есть — обновление работает.
2. Открыть любого клиента с давней картой → карточка способа оплаты: у
   обновлённой карты будет новый срок действия, хотя клиент его не вводил.
3. Если событий нет совсем, а клиентов с картами больше пары десятков, —
   написать в поддержку Stripe: «Is Card Account Updater active on our live
   account acct_…?»

## 2. Network tokens (сетевые токены)

**Что это.** Вместо номера карты Stripe хранит токен платёжной сети; токен
живёт дольше карты и даёт банку больше доверия к повторным списаниям — меньше
`do_not_honor` / `generic_decline` на подписках.

**Где.** По словам Stripe, токены запрашиваются автоматически, без интеграции.
Если в дашборде есть **Settings → Payments → Network tokens** (или
«Card network tokens»), — проверьте, что он включён/не отключён.

**Как проверить на live.**
1. **Payments** → открыть недавнее успешное продление подписки → блок
   **Payment method**: у списания по сетевому токену там отмечено
   использование network token (формулировка может отличаться).
2. Если такой отметки нет ни на одном списании Visa/Mastercard — вопрос в
   поддержку: «Are network tokens enabled for subscription renewals on our
   live account?»

## 3. Увидеть эффект: Billing → Revenue recovery

**Где.** **Billing → Revenue recovery** — там настройки повторов и писем, и
отчёт **Recovery analytics**.

**Что смотреть (только смотреть):**
- **Recovery rate** — доля упавших сумм, которые в итоге оплачены.
- Разбивка **Recovered**: повторы (retries), письма Stripe, прочее (в прочее
  попадает и наша кнопка смены карты в баннере).
- **In recovery** — свежие падения, по которым ещё идут повторы; за текущий и
  прошлый месяц цифра «дозревает».
- Отчёт считается раз в сутки, не в реальном времени.

**Retries.** Там же — расписание повторов: рекомендованный Smart Retries
(8 попыток за 2 недели) или своё. Сейчас приложение рассчитывает на то, что
Stripe делает повторы сам: второе SMS владельцу уходит на повторе не раньше
чем через 3 дня после первого. Менять расписание — отдельное решение.

**Сверка с нашей админкой.** `/admin/revenue/failed-payments` считает по
счетам (invoice), Stripe — по суммам; цифры будут близки, но не равны. Наша
отдельная колонка — «At trial end» (первое списание после 7-дневного триала).

## 4. Radar: доля prepaid-карт среди триалов — без включения правил

Цель — увидеть масштаб, ничего не блокируя.

**Вариант А — проверка правила без включения.**
1. **Radar → Rules** → добавить правило, тип **Review** (не Block).
2. Условие: `:card_funding: = 'prepaid'`
   (значения атрибута: `credit`, `debit`, `prepaid`, `unknown`).
3. Нажать **Test rule** — Stripe покажет, сколько прошлых платежей подошло бы.
4. **Не нажимать «Add and enable».** Закрыть окно — правило не сохраняется.

Тест покажет все платежи с prepaid-картой; триалы — это в основном нулевые
счета с привязкой карты, поэтому смотрите и на список платежей ниже.

**Вариант Б — выгрузка.**
**Payments** → фильтр по дате (последние 90 дней) → **Export** → в CSV есть
колонка типа карты (Card Funding). В Excel: отфильтровать
`prepaid` и сравнить с общим числом — особенно у первых списаний после
триала (описание платежа «Subscription update»/«Subscription cycle»).

**Вариант В — наша админка.** `/admin/revenue/failed-payments` → карточка
**By card type**: строка **Prepaid** всегда отдельной строкой, с колонкой
«Trial end». Это доля prepaid среди *упавших* списаний (не среди всех триалов).

**Не делать без решения:** правило Block на prepaid, включение Review-правила,
изменение порогов риска (Radar → Risk settings). Блок prepaid на входе
отрежет и честных клиентов с дебетовыми prepaid-картами.

---

## 5. Порядок

1. Убедиться, что Card Account Updater и network tokens активны (п. 1–2).
2. Посмотреть Recovery analytics за 90 дней (п. 3), записать recovery rate.
3. Сравнить с нашей разбивкой причин и prepaid в `/admin/revenue/failed-payments`
   (она копит данные с момента выкладки). Скрипт
   `scripts/backfill-payment-failures.ts` работает только с тестовым ключом
   (`STRIPE_TEST_SECRET_KEY`, `sk_test_…`); бэкфилл по живому аккаунту —
   отдельное решение владельца.
4. Решение по Radar и расписанию повторов — отдельно, по цифрам.

Источники Stripe:
- [How cards work (Card Account Updater, сетевые токены)](https://docs.stripe.com/billing/revenue-recovery/smarter-saved-cards)
- [Network tokens and card account updater — объявление](https://stripe.com/newsroom/news/network-tokens-card-account-updater)
- [Revenue recovery](https://docs.stripe.com/billing/revenue-recovery) ·
  [Recovery analytics](https://docs.stripe.com/billing/revenue-recovery/recovery-analytics) ·
  [Smart Retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries)
- [Radar rules](https://docs.stripe.com/radar/rules) ·
  [Supported attributes (`card_funding`)](https://docs.stripe.com/radar/rules/supported-attributes)
