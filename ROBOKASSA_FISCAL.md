# Robokassa Fiscalization (`Receipt`)

Этот проект передает `Receipt` в Robokassa на этапе формирования ссылки оплаты в `src/app/api/create-payment/route.ts`.

## Что передается

- Для всех платежей: `gym`, `ds`, `gift`.
- Одна позиция услуги в чеке (`items[0]`), как согласовано.
- Поля чека:
  - `sno: "patent"`
  - `items[0].tax: "none"`
  - `items[0].payment_method: "full_prepayment"`
  - `items[0].payment_object: "service"`
  - `items[0].quantity: 1`
  - `items[0].sum: OutSum`
  - `items[0].name`: берется по приоритету `tariffLabel -> courseName -> studioName -> дефолт`

Пример payload до URL-encoding:

```json
{
  "sno": "patent",
  "items": [
    {
      "name": "12 тренировок — 11 400 ₽",
      "quantity": 1,
      "sum": 11400,
      "tax": "none",
      "payment_method": "full_prepayment",
      "payment_object": "service"
    }
  ]
}
```

## Подпись Robokassa

Для ссылки `Merchant/Index.aspx` используется подпись:

- `MD5(MerchantLogin:OutSum:InvId:ReceiptRawJson:ROBO_SECRET1)`

Где:

- `OutSum` нормализован в формат `0.00`
- `ReceiptRawJson` это исходная JSON-строка чека (`JSON.stringify(receipt)`) и именно она участвует в подписи
- в query параметре передается `Receipt`, закодированный через `encodeURIComponent(ReceiptRawJson)`

## Callback (`ResultURL`)

В `src/app/api/robokassa/result/route.ts` логика подтверждения оплаты не менялась:

- валидация подписи: `MD5(OutSum:InvId:ROBO_SECRET2)`
- обновление статуса в Airtable
- обновление статуса в YDB CF
- Telegram-уведомления

## Environment variables

Обязательные переменные для платежей:

- `ROBO_ID`
- `ROBO_SECRET1`
- `ROBO_SECRET2`

Остальные переменные (`AIRTABLE_*`, `YDB_CF_URL`, `CF_INTERNAL_TOKEN`, `TELEGRAM_*`) продолжают использоваться без изменений в текущем потоке.

## Manual test checklist (prod/stage)

Проверить создание ссылки оплаты и успешную оплату для сценариев:

1. `gym + trial`
2. `gym + non-trial`
3. `ds + online_test`
4. `gift`

Для каждого сценария:

1. Создать платеж на сайте.
2. Убедиться, что `paymentUrl` содержит `Receipt=`.
3. Убедиться, что платежная страница Robokassa открывается без ошибки подписи.
4. Завершить оплату тестовой/боевой картой по окружению.
5. Проверить `ResultURL`:
   - ответ `OK{InvId}`
   - в Airtable статус `Status = paid` в нужной таблице
   - YDB получает статус `paid`
6. Проверить пользовательскую цепочку:
   - `payment-success` подтверждает оплату через `/api/check-payment`
   - Telegram-уведомления отрабатывают по текущей бизнес-логике.

## Короткий чек-лист выката

1. В окружении заданы `ROBO_ID`, `ROBO_SECRET1`, `ROBO_SECRET2`.
2. В Robokassa включена фискализация и используется ваш чековый провайдер.
3. В кабинете Robokassa корректно выставлены:
   - `ResultURL: /api/robokassa/result`
   - `SuccessURL: /payment-success`
   - `FailURL: /payment-fail`
4. Выполнен минимум один тестовый платеж и проверен `OK{InvId}` на callback.
5. В Airtable/YDB/Telegram нет регрессий относительно текущей бизнес-логики.

