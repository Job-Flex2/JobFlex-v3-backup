# Почта jobflex.app: DNS, SPF, DKIM, DMARC

Проверено 2026-10-21. Записи читались через публичные резолверы 8.8.8.8 и 1.1.1.1
(`Resolve-DnsName`; `dig` на этой машине не установлен, команды ниже дают тот же ответ).
Зона обслуживается Google Cloud DNS (`ns-cloud-b1…b4.googledomains.com`).

## Откуда уходит почта

- Прод: Gmail SMTP, `smtp.gmail.com:587`, вход как **`app@jobflex.app`** (`SMTP_USER`).
  Это ящик Google Workspace: MX домена — `smtp.google.com`.
- `EMAIL_FROM` в Vercel указывает на адрес `…@resend.dev`, но `lib/sdk/smtp.ts`
  (`alignFrom`) подменяет From на адрес из `SMTP_USER`, если домены разные. Поэтому
  в заголовке From письма стоит `JobFlex <app@jobflex.app>`.
- **Письма уходят с jobflex.app, а не с gmail.com.** Поэтому DMARC для jobflex.app
  на них распространяется, и всё, что написано ниже, на них влияет.
  Перепроверить в Vercel → Settings → Environment Variables: `SMTP_USER` должен
  оставаться адресом на `@jobflex.app`. Если там когда-нибудь окажется `…@gmail.com`,
  DMARC домена jobflex.app на эти письма влиять перестанет. Тогда отправлять нужно
  с ящика Workspace на домене или через «Send mail as» с проверкой по SMTP.
- Resend сейчас не используется (`RESEND_API_KEY` не задан), но его записи остались
  в зоне: `resend._domainkey`, `send.jobflex.app` (SPF для return-path Resend).
  Они не мешают, и если Resend когда-нибудь включат, они понадобятся.
- Суточный лимит: у Workspace 2000 писем в день (у обычного Gmail около 500).
  В середине октября уходило 100–140 писем в день. **В Vercel нужно задать
  `EMAIL_DAILY_LIMIT=2000`**: по умолчанию стоит 500, и алерт на 80% придёт уже
  при 400 письмах. Локальный dev ходит через тот же ящик `app@jobflex.app`, поэтому
  лимит у Gmail общий. Но лог локальных отправок пишется в локальную базу и
  в счётчик прода не попадает.

## Что сейчас в DNS

```
dig TXT jobflex.app +short
"google-site-verification=dWhEwOX_Vq-qGEjl7Obi1tbnnEzuFu8sVuxqGUhai-o"
"google-site-verification=kBYpFMff4zodY2JfoADtB9s6gDPbfpVB5XaloUweknw"
"google-site-verification=_8whq29HyWKuovv4q05BBeowMPdwcUzkV0nTzU0cOiY"
"resend._domainkey p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDC/9h1JhoybJuwVRVE3BSd+QY9NvCBh7AOtAHpUnUaDp0LWg+RSwepWSCvFwiOZI7joH5z361rEisT5yJJVajxtSC50xGVOAdX/8AXM8QQqWn6PjaNNp8kQdghDtPmWhsgTLJy9y+7kzTKLyayEwb/GYIqWi5DKef4sJaNDz7qDwIDAQAB Auto CNAME send se" "nd.forge.rmta.net Auto CNAME rsend rsend.forge.rmta.net Auto TXT _dmarc v=DMARC1; p=none; rua=mailto:dmarc@jobflex.app"
"facebook-domain-verification=nlaa08rz8o4fbzs1olv7ea8djsc920"
"resend-domain-verification=9f5558ec0609c34f76da14a0039f5669"

dig TXT _dmarc.jobflex.app +short
"v=DMARC1; p=none;"

dig TXT google._domainkey.jobflex.app +short
"v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA8U7EGMZqOQiberLeo5587eR+rVmH8jOYe+4F4SZDMBusu6dRcgCjndXWsdaxl9cd8jXi/Ex7gbzdKXHK2Yv9MNqcxRahGtCcVI99g5u7A+artK++YzZMJxqK/rUokTS93eHQvBnbaNCWp07iCsfxRFUPRFzkxl2IPq6lmGXBblpYQo5MyluyewLArfZ+LQI7bbgkCCG7krRwhXvd0JcfrsClFnWRf8yR609wKEEFf8R6Beo6vNK6OUokZ/47tZDEugyJdct4TcAnIn5XuV+y3JTz39eWUKIpDhvjL6tAIIMR7V64bos/DRH5dNJLylaC4am2GOZFZxF2uB/iuG5sHwIDAQAB"

dig TXT selector1._domainkey.jobflex.app +short
(пусто, NXDOMAIN — это селектор Microsoft 365, нам он не нужен)
```

| | Статус | Что это значит |
| --- | --- | --- |
| SPF (`v=spf1` на `jobflex.app`) | **нет** | Получатель не может проверить, что Google имеет право слать от jobflex.app. SPF = none |
| DKIM `google._domainkey` | есть, RSA 2048 | Ключ опубликован. Подпись `d=jobflex.app; s=google` видна в оригиналах писем, которые вернулись с отказом (DSN), — проверено 2026-10-18 |
| DMARC `_dmarc` | `p=none`, без `rua` | Политики нет, и отчёты никуда не приходят |
| Сломанная TXT на корне | **мусор** | В одно поле TXT вставили целый блок записей из панели Resend (`resend._domainkey … Auto CNAME send … Auto TXT _dmarc …`). Как запись она ничего не значит. В частности, `rua=mailto:dmarc@jobflex.app` из неё **никогда не действовал** |

## Что добавить и поменять

Порядок такой: шаги 1–3 сегодня, шаг 4 — через 2–4 недели после того, как пойдут отчёты.

### 1. SPF — добавить

Одна TXT-запись на корне домена. **На одном имени может быть только одна запись `v=spf1`.**

| Тип | Имя | Значение |
| --- | --- | --- |
| TXT | `jobflex.app` (корень, `@`) | `v=spf1 include:_spf.google.com ~all` |

- `include:_spf.google.com` разрешает серверы Google Workspace (через них уходит наш SMTP).
- `~all` (softfail) нужен на первое время. Когда в отчётах DMARC станет ясно, что
  других отправителей нет, можно перейти на `-all`. **Никогда не ставить `+all`**:
  это разрешение слать от нашего имени кому угодно.
- Resend сюда добавлять не нужно. Его return-path — `send.jobflex.app`, и у этого
  имени уже есть свой SPF (`v=spf1 ip4:… ~all`).
- Если почту от имени домена начнёт отправлять ещё какой-то сервис (рассылки,
  CRM), его `include:` дописывается в эту же запись, а вторая запись не создаётся.

### 2. DKIM — проверить, что подпись включена

Ключ уже опубликован. В админке Workspace осталось убедиться, что Google подписывает им письма:

1. admin.google.com → Apps → Google Workspace → Gmail → **Authenticate email**.
2. Домен `jobflex.app`, селектор `google`.
3. Статус должен быть **«Authenticating email»**. Если там «Not authenticating»,
   нажмите **Start authentication**.
4. Если ключ когда-нибудь перевыпустят (**Generate new record**, 2048 бит), Google
   покажет новое значение. Его нужно заменить в DNS:

| Тип | Имя | Значение |
| --- | --- | --- |
| TXT | `google._domainkey.jobflex.app` | `v=DKIM1; k=rsa; p=<ключ из админки целиком>` |

В Cloud DNS длинное значение режется на строки по 255 символов в кавычках
(`"v=DKIM1; k=rsa; p=MIIB…" "…IDAQAB"`), и это нормально. После замены в DNS нужно
ещё раз нажать Start authentication.

Как проверить: открыть любое письмо от `app@jobflex.app` в стороннем ящике →
«Показать оригинал». Должно быть `DKIM: PASS with domain jobflex.app`,
`SPF: PASS` (после шага 1) и `DMARC: PASS`.

### 3. DMARC — заменить запись на p=none с отчётами

| Тип | Имя | Значение |
| --- | --- | --- |
| TXT | `_dmarc.jobflex.app` | `v=DMARC1; p=none; rua=mailto:dmarc@jobflex.app; adkim=r; aspf=r; pct=100` |

- Запись заменяет нынешнюю `v=DMARC1; p=none;`, а не добавляется к ней: на `_dmarc`
  может быть только одна запись.
- Адрес `dmarc@jobflex.app` должен существовать. Проще всего сделать его алиасом
  или группой Workspace, которая пересылает почту на `app@jobflex.app`. Отчёты
  приходят раз в сутки в виде XML-вложений от Google, Yahoo, Microsoft и других.
  Читать их удобнее через бесплатный разборщик (Postmark DMARC Digests, dmarcian и подобные).
- `adkim=r; aspf=r` — мягкое выравнивание: подпись и SPF засчитываются и для поддоменов.
  Это значения по умолчанию, в записи они стоят для наглядности.

**Заодно удалить сломанную TXT-запись на корне** — ту, что начинается
с `resend._domainkey p=MIGfMA0…`. Правильные записи Resend уже стоят отдельно
(`resend._domainkey.jobflex.app` TXT, `send.jobflex.app`), так что ничего не потеряется.

### 4. Через 2–4 недели — p=quarantine

Когда в отчётах DMARC всё легитимное (Google и, если включён, Resend) проходит
DKIM или SPF с выравниванием, а остальное оказывается чужими подделками:

| Тип | Имя | Значение |
| --- | --- | --- |
| TXT | `_dmarc.jobflex.app` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@jobflex.app; adkim=r; aspf=r; pct=100` |

Если хочется осторожнее, сначала можно поставить `pct=25`, потом 100.
`p=reject` — следующий шаг, ещё через месяц спокойных отчётов.

## Содержимое писем (п. 11): plain-text и List-Unsubscribe

Здесь только отмечено, что есть, — в коде по этому пункту ничего не менялось.

**Plain-text часть.** `renderEmail()` (`lib/email/renderEmail.ts`) всегда возвращает
`{ subject, html, text }`, но `text` передают в `sendEmail` не все отправители.
Nodemailer сам текстовую часть из HTML не делает, поэтому без `text` письмо уходит
только HTML-версией, а это немного хуже для спам-фильтров.

| Есть `text` | Нет `text` (только HTML) |
| --- | --- |
| коды входа и регистрации (`lib/signupOtp`), сброс пароля (`actions/accountPassword`), поддержка (`lib/supportThread`, `lib/support/aiSupport`), письма админа подрядчику (`lib/adminMail/server`), win-back (`lib/trialWinback`), дизайн-ссылки клиенту (`actions/deckClientDesign`, `actions/designClientLink`), `lib/adminTasks/mail`, `lib/aiDesk/minutes` | welcome (`lib/email/welcome`), dunning и смена карты (`lib/cardUpdate`), конец триала (`lib/trialEndingMail`, `lib/cardlessTrial`), предложения клиентам и принятие (`lib/notify` → `sendOrgEmail`), follow-ups (`lib/followUps/engine` → `sendOrgEmail`), напоминания о настройке лидов (`lib/leadSetupReminders`), напоминания домовладельцу (`lib/home/reminders`), уведомления команде и офису в `lib/notify` |

Почти во всех случаях из правой колонки исправление — передать `text` из того же
`renderEmail()`. У `sendOrgEmail` для этого нужно новое необязательное поле `text`.

**List-Unsubscribe.** `lib/adminMail/optout` выдаёт `List-Unsubscribe: <url>` и
`List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058; приёмник —
`/api/email/unsubscribe`). Эти заголовки ставят два маркетинговых отправителя:
`lib/adminMail/server` (письма админа подрядчику) и `lib/trialWinback`. Транзакционным
письмам (коды, счета, предложения клиентам) List-Unsubscribe не нужен. Под вопросом
два ежедневных напоминания — `lib/leadSetupReminders` (до 14 писем владельцу) и
`lib/home/reminders`. Они ближе к рассылке, чем к транзакции, но заголовка у них нет.
Gmail и Yahoo требуют one-click отписку от массовых отправителей (больше 5000 писем
в день). Нас это требование пока не касается, но для этих двух писем заголовок
стоит добавить.

## Как перепроверить

```
dig TXT jobflex.app +short | grep spf1
dig TXT _dmarc.jobflex.app +short
dig TXT google._domainkey.jobflex.app +short
```

В PowerShell: `Resolve-DnsName -Type TXT -Server 8.8.8.8 jobflex.app`.
После изменения в Cloud DNS новые значения появляются у резолверов в течение TTL
(сейчас 3600 с).
