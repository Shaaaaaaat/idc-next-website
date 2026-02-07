### ТЗ: вернуть “вчерашнюю” базу и добавить улучшения (Robokassa + UI)

#### 1) Интеграция Robokassa
- ResultURL (серверный webhook)
  - Путь: `src/app/api/robokassa/result/route.ts`
  - Метод: POST (допустим GET для отладки)
  - Подпись: `MD5(OutSum:InvId:ROBO_SECRET2)` (сравнивать в верхнем регистре)
  - Действия при валидной подписи:
    - Найти/создать запись в Airtable по `id_payment = InvId`
    - `Status = "paid"`
    - TG‑уведомление
    - Ответить `OK{InvId}` (text/plain)

- Создание платежа
  - Путь: `src/app/api/create-payment/route.ts`
  - Сумма: строка с 2 знаками (`toFixed(2)`)
  - Ссылка Robokassa (как было): `MD5(MerchantLogin:OutSum:InvId:ROBO_SECRET1)`
  - В Airtable создавать запись со `Status="created"` и полями:
    - `id_payment`: InvId (`Date.now()` или другой генератор)
    - `email`, `FIO`, `Phone`
    - `Sum`: number
    - `Currency`: всегда `"RUB"`
    - `Tag`: см. маппинг ниже
    - `tariff_label`: из UI (человеко‑читаемое)
    - `course_name`: см. нормализацию ниже
    - `studio_name`: если покупка из “Залов”, иначе `null`
    - `Lessons`: см. маппинг ниже
    - `tg_link_token`: `crypto.randomBytes(16).toString("hex")`
  - Отправить TG‑сообщение о создании счёта (по желанию)

- Check‑payment (статус из нашей БД)
  - Путь: `src/app/api/check-payment/route.ts` (POST)
  - Вход: `{ paymentId }`
  - По `id_payment` читает запись из Airtable и возвращает:
    - `{ ok: true, paid: boolean, status: "paid"|"pending", tgToken, purchasePayload }`

#### 2) Нормализация полей для Airtable
- `course_name` (строго из списка):
  - `calisthenics_light`
  - `calisthenics_classic`
  - `handstand`
  - `pullups`
  - `calisthenics_for_crossfit`
  - `gift_certificate` (для сертификата)

- `Lessons`:
  - `short1` → 1
  - `short12` → 12
  - `long12` → 12
  - `long36` → 36
  - сертификат → 0

- `Tag` (маппинг из `tariffId` и контекста):
  - `review` → `short1`
  - `month` → `short12`
  - `slow12` → `long12`
  - `long36` → `long36`
  - если `tariff_label` содержит “тест” → `test`
  - сертификат → `gift`

#### 3) Success‑страница
- Путь: `src/app/payment-success/page.tsx`
- Логика:
  - Читает `InvId` из query (GET)
  - Дёргает `/api/check-payment`
  - При `paid`:
    - Заголовок: “Оплата прошла успешно”
    - Кнопка: “Открыть Telegram‑бот” → `https://t.me/IDCMAIN_bot?start={tg_link_token}`
    - Текст под кнопкой (продающий): “В боте ты увидишь баланс оставшихся тренировок, сможешь заморозить абонемент, докупить новый тариф и быстро связаться с поддержкой.”
    - Кнопка: “Вернуться на сайт” → `/`
  - Убрать показ `InvId` и кнопку “На главную”

#### 4) Настройки в кабинете Robokassa
- SuccessURL (GET): `https://<ВАШ_ДОМЕН>/payment-success`
- FailURL (GET): `https://<ВАШ_ДОМЕН>/payment-fail`
- ResultURL (POST): `https://<ВАШ_ДОМЕН>/api/robokassa/result`
- Включить автопереадресацию на сайт (если опция доступна; иначе запрос в поддержку)
- В тестовом режиме прогнать оплату

#### 5) FAQ (если в “вчерашней” версии ещё не было)
- Путь: `src/components/FAQ.tsx`
- Группы: “Онлайн / В зале / Совмещать”
- Обновить/добавить вопросы и CTA (как в текущей версии)

#### 6) Якорный скролл (опционально, если нужно)
- На секциях: `#how`, `#courses`, `#pricing`, `#locations`, `#about`, `#reviews`, `#faq`
- Класс: `scroll-mt-[calc(var(--header-h)+var(--anchor-extra))]`
- В `globals.css`: 
  - `:root { --header-h: 96px; --anchor-extra: 20px; }`
- (Опционально) добавить клиентский скрипт для измерения высоты хедера

#### 7) Шапка (оставить из “вчерашней”, но стабилизировать)
- Не использовать переключение flex→grid на первом кадре
- Рекомендации:
  - Лого‑блок: `shrink-0`
  - Название: `whitespace-nowrap leading-none` и текст `I&nbsp;Do&nbsp;Calisthenics`
  - Фикс высоты контейнера шапки: `min-h-[56px] sm:min-h-[64px]`
  - Центр. навигация: при необходимости `flex-1 min-w-0 justify-center`

#### 8) ENV (Vercel)
- `ROBO_ID`, `ROBO_SECRET1`, `ROBO_SECRET2`
- `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `AIRTABLE_PURCHASE_WEBSITE_TABLE`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

#### 9) Приёмка
- Создание счёта → запись `created` в Airtable + TG‑уведомление
- Успешная оплата → Robokassa вызывает ResultURL → `paid` в Airtable + TG‑уведомление → редирект на `/payment-success`
- Сертификат: `course_name = gift_certificate`, `Tag = gift`, `Lessons = 0`
- Тест силы: `Tag = test`
- Якоря — опускаются на заголовок + 20px (если включили этот блок)

