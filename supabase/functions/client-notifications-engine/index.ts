import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  expectedSenderProfileForCurrency,
  normalizeEmailAddress,
  resolveSenderProfile,
  sendResendEmail,
  validateSenderProfileCurrency,
} from "../_shared/email/resend.ts";
import {
  buildFirstLessonFollowupEmail,
  buildFirstOnlinePurchaseWelcomeEmail,
  buildStrengthTestInstructionEmail,
  buildSubscriptionWrOffClientEmail,
} from "../_shared/email/templates.ts";
import type { EmailPayload } from "../_shared/email/types.ts";

type NotificationEvent = {
  id: string;
  client_id: string | null;
  event_type: string;
  recipient_type: string;
  channel: string;
  status: string;
  payload: Record<string, unknown> | null;
  attempt_count: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_attempt_at?: string | null;
  next_attempt_at?: string | null;
  last_alerted_at?: string | null;
};

type ClientRow = {
  id: string;
  fio: string | null;
  email: string | null;
  tgid: string | number | null;
  coach: string | null;
  balance: number | null;
};

type CoachProfile = {
  coach_name: string;
  display_name: string | null;
  telegram_id?: string | number | null;
};

type ReplyMarkup = Record<string, unknown>;

type SendResult = {
  ok: boolean;
  status: number;
  attempts: number;
  errorCode?: string;
  errorMessage?: string;
  providerMessageId?: string;
};

type HandleResult =
  | { status: "sent"; telegram?: SendResult; email?: SendResult }
  | { status: "skipped"; errorCode: string; errorMessage: string }
  | {
    status: "failed";
    errorCode: string;
    errorMessage: string;
    telegram?: SendResult;
    email?: SendResult;
  };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";
const INTERNAL_SECRET = Deno.env.get("NOTIFICATIONS_INTERNAL_SECRET") ?? "";
const CLIENT_BOT_TOKEN = Deno.env.get("IDCMAIN_BOT_TOKEN") ?? "";
const ADMIN_BOT_TOKEN = Deno.env.get("LOWMAOWS_BOT_TOKEN") ?? "";
const ADMIN_CHAT_ID = Deno.env.get("LOWMAOWS_ADMIN_CHAT_ID") ?? "";
const IDC_ERRORS_BOT_TOKEN = Deno.env.get("IDC_ERRORS_BOT_TOKEN") ?? "";
const IDC_ERRORS_CHAT_ID = Deno.env.get("IDC_ERRORS_CHAT_ID") ?? "";

const TELEGRAM_TIMEOUT_MS = 20_000;
const TELEGRAM_MAX_ATTEMPTS = 2;
const TELEGRAM_RETRY_DELAY_MS = 1_500;
const EMAIL_INSTRUCTION_DELAY_MS = 60 * 1000;
const MAX_NOT_READY_WAIT_MS = EMAIL_INSTRUCTION_DELAY_MS + 5_000;
const STALE_THRESHOLD_MS = 3 * 60 * 1000;
const STALE_ALERT_THROTTLE_MS = 30 * 60 * 1000;
const FINAL_STATUSES = new Set(["sent", "skipped", "failed"]);
const SKIPPED_CODES = new Set([
  "client_telegram_missing",
  "trainer_telegram_missing",
  "admin_chat_missing",
  "unsupported_channel",
  "unsupported_recipient_type",
  "client_not_found",
  "trainer_not_found",
]);
const EMAIL_NON_RETRYABLE_CODES = new Set([
  "client_email_missing",
  "template_data_missing",
  "missing_sender_profile",
  "unsupported_sender_profile",
  "sender_profile_currency_mismatch",
  "resend_request_rejected",
  "resend_response_missing_id",
]);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function asString(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function pickValue(
  row: Record<string, unknown> | null | undefined,
  keys: string[],
) {
  if (!row) return "";

  for (const key of keys) {
    const value = row[key];
    const text = asString(value).trim();
    if (text) return text;
  }

  return "";
}

function currencySymbol(currency: unknown) {
  const value = asString(currency).toUpperCase() || "RUB";
  if (value === "RUB") return "₽";
  if (value === "EUR") return "€";
  if (value === "USD") return "$";
  return value;
}

function formatBalance(balance: unknown, currency: unknown) {
  return `${asString(balance)}${currencySymbol(currency)}`;
}

function formatBalanceChange(
  payload: Record<string, unknown>,
  fallbackBalance: unknown,
  currency: unknown,
) {
  const before = payload.balance_before;
  const after = payload.balance_after ?? fallbackBalance ?? "";
  const beforeText = asString(before).trim();

  if (before !== null && before !== undefined && beforeText) {
    return `${formatBalance(before, currency)} → ${
      formatBalance(after, currency)
    }`;
  }

  return formatBalance(after, currency);
}

function clientName(
  client: ClientRow | null,
  payload?: Record<string, unknown>,
) {
  return pickValue(payload, ["client_name", "fio", "name", "full_name"]) ||
    client?.fio || "Клиент";
}

function trainerName(
  client: ClientRow | null,
  payload?: Record<string, unknown>,
  coach?: CoachProfile | null,
) {
  return pickValue(payload, [
    "trainer_name",
    "coach_name",
    "coach",
    "trainer",
  ]) ||
    client?.coach ||
    coach?.coach_name ||
    coach?.display_name ||
    "не определён";
}

function trainerTelegramId(payload: Record<string, unknown>) {
  return pickValue(payload, [
    "trainer_telegram_id",
    "trainer_chat_id",
    "coach_telegram_id",
    "coach_chat_id",
  ]);
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "unknown_error";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function telegramUrl(botToken: string) {
  return `https://api.telegram.org/bot${botToken}/sendMessage`;
}

async function sendTelegramWithRetry(params: {
  botToken: string;
  chatId: string | number;
  text: string;
  replyMarkup?: Record<string, unknown>;
  target: string;
}): Promise<SendResult> {
  if (!params.botToken || !params.chatId) {
    return {
      ok: false,
      status: 0,
      attempts: 0,
      errorCode: "telegram_config_missing",
      errorMessage: `${params.target} Telegram config missing`,
    };
  }

  let lastStatus = 0;
  let lastErrorCode = "telegram_send_failed";
  let lastErrorMessage = "telegram_send_failed";

  for (let attempt = 1; attempt <= TELEGRAM_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);

    try {
      const response = await fetch(telegramUrl(params.botToken), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: params.chatId,
          text: params.text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          ...(params.replyMarkup ? { reply_markup: params.replyMarkup } : {}),
        }),
        signal: controller.signal,
      });

      lastStatus = response.status;
      const payload = await response.json().catch(() => ({}));

      if (response.ok && payload?.ok !== false) {
        return { ok: true, status: response.status, attempts: attempt };
      }

      lastErrorCode = "telegram_api_error";
      lastErrorMessage = `Telegram API returned status ${response.status}`;
      console.warn("telegram_send_failed", {
        target: params.target,
        attempt,
        status: response.status,
        telegramOk: payload?.ok === true,
      });
    } catch (error) {
      lastErrorCode =
        error instanceof DOMException && error.name === "AbortError"
          ? "telegram_timeout"
          : "telegram_fetch_error";
      lastErrorMessage = safeErrorMessage(error);
      console.warn("telegram_send_exception", {
        target: params.target,
        attempt,
        errorCode: lastErrorCode,
        errorMessage: lastErrorMessage,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < TELEGRAM_MAX_ATTEMPTS) {
      await sleep(TELEGRAM_RETRY_DELAY_MS);
    }
  }

  return {
    ok: false,
    status: lastStatus,
    attempts: TELEGRAM_MAX_ATTEMPTS,
    errorCode: lastErrorCode,
    errorMessage: lastErrorMessage,
  };
}

async function sendErrorAlert(text: string) {
  if (!IDC_ERRORS_BOT_TOKEN || !IDC_ERRORS_CHAT_ID) {
    console.warn("notification_alert_config_missing", {
      hasToken: Boolean(IDC_ERRORS_BOT_TOKEN),
      hasChatId: Boolean(IDC_ERRORS_CHAT_ID),
    });
    return false;
  }

  const result = await sendTelegramWithRetry({
    botToken: IDC_ERRORS_BOT_TOKEN,
    chatId: IDC_ERRORS_CHAT_ID,
    text,
    target: "notification_error_alert",
  });

  if (!result.ok) {
    console.warn("notification_alert_failed", {
      status: result.status,
      attempts: result.attempts,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
    });
    return false;
  }

  return true;
}

function alertText(params: {
  title: string;
  event?: NotificationEvent;
  client?: ClientRow | null;
  errorCode?: string;
  errorMessage?: string;
  attemptCount?: number | null;
  staleCount?: number;
  staleIds?: string[];
}) {
  const lines = [
    params.title,
    params.event ? `event_id: ${params.event.id}` : null,
    params.event ? `event_type: ${params.event.event_type}` : null,
    params.event ? `recipient_type: ${params.event.recipient_type}` : null,
    params.event ? `channel: ${params.event.channel}` : null,
    params.client?.id ? `client_id: ${params.client.id}` : null,
    params.client?.fio ? `client_name: ${params.client.fio}` : null,
    params.errorCode ? `error_code: ${params.errorCode}` : null,
    params.errorMessage
      ? `error_message: ${params.errorMessage.slice(0, 500)}`
      : null,
    typeof params.attemptCount === "number"
      ? `attempt_count: ${params.attemptCount}`
      : null,
    typeof params.staleCount === "number"
      ? `stale_count: ${params.staleCount}`
      : null,
    params.staleIds?.length ? `event_ids: ${params.staleIds.join(", ")}` : null,
  ].filter(Boolean);

  return lines.join("\n");
}

async function getClient(clientId: string | null): Promise<ClientRow | null> {
  if (!clientId) return null;

  const { data, error } = await supabase
    .from("clients")
    .select("id, fio, email, tgid, coach, balance")
    .eq("id", clientId)
    .maybeSingle();

  if (error) throw error;
  return data as ClientRow | null;
}

async function getCoachProfile(
  coachHandle: string | null,
): Promise<CoachProfile | null> {
  if (!coachHandle) return null;

  const { data, error } = await supabase
    .from("coach_profiles")
    .select("coach_name, display_name, telegram_id")
    .eq("coach_name", coachHandle)
    .maybeSingle();

  if (error) throw error;
  return data as CoachProfile | null;
}

async function getCoachTelegramId(coachHandle: string) {
  const coach = await getCoachProfile(coachHandle);
  return asString(coach?.telegram_id).trim();
}

function resultFromTelegram(telegram: SendResult): HandleResult {
  if (telegram.ok) return { status: "sent", telegram };

  return {
    status: SKIPPED_CODES.has(telegram.errorCode ?? "") ? "skipped" : "failed",
    errorCode: telegram.errorCode ?? "telegram_send_failed",
    errorMessage: telegram.errorMessage ?? "Telegram send failed",
    telegram,
  };
}

function resultFromEmail(email: SendResult): HandleResult {
  if (email.ok) return { status: "sent", email };

  const errorCode = email.errorCode ?? "resend_send_failed";
  const status = EMAIL_NON_RETRYABLE_CODES.has(errorCode) ||
      (email.status >= 400 && email.status < 500 && email.status !== 401 &&
        email.status !== 403 && email.status !== 429)
    ? "skipped"
    : "failed";

  return {
    status,
    errorCode,
    errorMessage: email.errorMessage ?? "Resend send failed",
    email,
  };
}

function skipped(errorCode: string, errorMessage: string): HandleResult {
  return { status: "skipped", errorCode, errorMessage };
}

function unsupportedChannel(event: NotificationEvent): HandleResult {
  return skipped(
    "unsupported_channel",
    `Unsupported channel for ${event.event_type}: ${event.channel}`,
  );
}

function templateVersion(payload: Record<string, unknown>) {
  const value = payload.template_version;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = asString(value).trim();
  if (!text) return 0;
  return Number(text);
}

function numericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = asString(value).trim();
  if (!text) return 0;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function defaultTelegramUrl(payload: Record<string, unknown>) {
  const explicit = pickValue(payload, ["telegram_url"]);
  if (explicit) return explicit;

  const token = pickValue(payload, ["tg_link_token"]);
  if (token) {
    return `https://t.me/IDCMAIN_bot?start=${encodeURIComponent(token)}`;
  }

  return "https://t.me/IDCMAIN_bot";
}

function resolveEmailContext(event: NotificationEvent, client: ClientRow) {
  const payload = event.payload ?? {};
  const recipientEmail = normalizeEmailAddress(
    pickValue(payload, ["recipient_email"]) || asString(client.email),
  );

  if (!recipientEmail) {
    return {
      ok: false as const,
      result: skipped("client_email_missing", "Client email is missing"),
    };
  }

  if (templateVersion(payload) !== 1) {
    return {
      ok: false as const,
      result: skipped(
        "template_data_missing",
        "Template version is missing or unsupported",
      ),
    };
  }

  const senderProfile = resolveSenderProfile(payload.sender_profile);

  if (!senderProfile.ok) {
    return {
      ok: false as const,
      result: skipped(senderProfile.errorCode, senderProfile.errorMessage),
    };
  }

  const currencyProfile = validateSenderProfileCurrency(
    payload.currency,
    senderProfile.profile,
  );

  if (!currencyProfile.ok) {
    return {
      ok: false as const,
      result: skipped(currencyProfile.errorCode, currencyProfile.errorMessage),
    };
  }

  return {
    ok: true as const,
    payload,
    recipientEmail,
    senderProfile: senderProfile.profile,
  };
}

function resolveLifecycleEmailContext(
  event: NotificationEvent,
  client: ClientRow,
) {
  const payload = event.payload ?? {};
  const recipientEmail = normalizeEmailAddress(asString(client.email));

  if (!recipientEmail) {
    return {
      ok: false as const,
      result: skipped("client_email_missing", "Client email is missing"),
    };
  }

  const profile = expectedSenderProfileForCurrency(payload.currency) || "rub";
  const senderProfile = resolveSenderProfile(profile);

  if (!senderProfile.ok) {
    return {
      ok: false as const,
      result: {
        status: "failed" as const,
        errorCode: senderProfile.errorCode,
        errorMessage: senderProfile.errorMessage,
      },
    };
  }

  const currencyProfile = validateSenderProfileCurrency(
    payload.currency,
    senderProfile.profile,
  );

  if (!currencyProfile.ok) {
    return {
      ok: false as const,
      result: skipped(currencyProfile.errorCode, currencyProfile.errorMessage),
    };
  }

  return {
    ok: true as const,
    payload,
    recipientEmail,
    senderProfile: senderProfile.profile,
  };
}

async function sendLifecycleEmail(params: {
  event: NotificationEvent;
  client: ClientRow;
  template: Omit<EmailPayload, "to">;
}) {
  const context = resolveLifecycleEmailContext(params.event, params.client);
  if (!context.ok) return context.result;

  return resultFromEmail(
    await sendResendEmail({
      profile: context.senderProfile,
      idempotencyKey: `client-notification-event/${params.event.id}`,
      email: {
        ...params.template,
        to: context.recipientEmail,
      },
    }),
  );
}

function yesNoKeyboard(): ReplyMarkup {
  return {
    inline_keyboard: [
      [{ text: "Да", callback_data: "a_da" }],
      [{ text: "Нет", callback_data: "a_net" }],
    ],
  };
}

async function sendClientText(
  client: ClientRow,
  text: string,
  target: string,
  replyMarkup?: ReplyMarkup,
) {
  const chatId = asString(client.tgid);
  if (!chatId) {
    return {
      ok: false,
      status: 0,
      attempts: 0,
      errorCode: "client_telegram_missing",
      errorMessage: "Client tgid is missing",
    };
  }

  return await sendTelegramWithRetry({
    botToken: CLIENT_BOT_TOKEN,
    chatId,
    text,
    replyMarkup,
    target,
  });
}

async function sendAdminText(text: string, target: string) {
  if (!ADMIN_CHAT_ID) {
    return {
      ok: false,
      status: 0,
      attempts: 0,
      errorCode: "admin_chat_missing",
      errorMessage: "Admin Telegram chat id is missing",
    };
  }

  return await sendTelegramWithRetry({
    botToken: ADMIN_BOT_TOKEN,
    chatId: ADMIN_CHAT_ID,
    text,
    target,
  });
}

async function handleFirstLessonTelegram(
  event: NotificationEvent,
  client: ClientRow,
) {
  const chatId = asString(client.tgid);

  if (!chatId) {
    const result = await sendAdminText(
      [
        "Не удалось связаться с клиентом после первого пробного занятия.",
        `Имя: ${clientName(client, event.payload ?? {})}`,
        "Причина: нет Telegram / email",
      ].join("\n"),
      "admin:first_lesson_followup_missing_client_contact",
    );

    if (!result.ok) {
      console.warn("first_lesson_admin_fallback_failed", {
        eventId: event.id,
        clientId: client.id,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      });
    }

    return skipped("client_telegram_missing", "Client tgid is missing");
  }

  const first = await sendTelegramWithRetry({
    botToken: CLIENT_BOT_TOKEN,
    chatId,
    text: [
      "Ура! Начало пути в калистенике положено 🎉",
      "Надеюсь, тебе все понравилось 😊",
    ].join("\n"),
    target: "client:first_lesson_followup:first",
  });

  if (!first.ok) return resultFromTelegram(first);

  const second = await sendTelegramWithRetry({
    botToken: CLIENT_BOT_TOKEN,
    chatId,
    text: "Подскажи, пожалуйста, ты планируешь продолжить занятия с нами?",
    replyMarkup: yesNoKeyboard(),
    target: "client:first_lesson_followup:question",
  });

  return resultFromTelegram(second);
}

async function handleFirstLessonEmail(
  event: NotificationEvent,
  client: ClientRow,
) {
  return await sendLifecycleEmail({
    event,
    client,
    template: buildFirstLessonFollowupEmail(),
  });
}

async function handleAttendanceBalance(
  event: NotificationEvent,
  client: ClientRow,
) {
  const payload = event.payload ?? {};
  const trainingFormat =
    (asString(payload.training_format) || asString(payload.format))
      .toLowerCase();
  const trainingDate = asString(payload.training_date) ||
    asString(payload.workout_date) || asString(payload.date);
  const balance = payload.balance_after ?? client.balance ?? "";
  const currency = payload.currency ?? "RUB";
  let text: string;

  if (trainingFormat === "ds") {
    text = [
      "Ваш тренер поставил вам новую тренировку.",
      `Ваш текущий баланс: ${formatBalance(balance, currency)}.`,
    ].join("\n");
  } else if (trainingFormat === "group") {
    text = [
      `Вы были на групповой тренировке: ${trainingDate}.`,
      `Ваш текущий баланс: ${formatBalance(balance, currency)}.`,
    ].join("\n");
  } else {
    text = [
      `Вы были на персональной тренировке: ${trainingDate}.`,
      `Ваш текущий баланс: ${formatBalance(balance, currency)}.`,
    ].join("\n");
  }

  return resultFromTelegram(
    await sendClientText(client, text, "client:attendance_balance_client"),
  );
}

async function handleBalanceZero(event: NotificationEvent, client: ClientRow) {
  const text = [
    "Поздравляем! Все тренировки успешно пройдены 🎉",
    "Хочешь продолжить? Просто нажми «Купить тренировки» и пополни баланс — и ты снова в деле! 💪",
  ].join("\n");

  return resultFromTelegram(
    await sendClientText(client, text, `client:${event.event_type}`),
  );
}

async function handleBalanceNegative(
  event: NotificationEvent,
  client: ClientRow,
) {
  const text = [
    "Небольшое напоминание 💬",
    "У тебя отрицательный баланс, необходимо его пополнить ❤️",
    "Просто нажми «Купить тренировки» и пополни баланс — и ты снова в деле! 💪",
  ].join("\n");

  return resultFromTelegram(
    await sendClientText(client, text, `client:${event.event_type}`),
  );
}

async function handleWrOffClientTelegram(
  _event: NotificationEvent,
  client: ClientRow,
) {
  const first = await sendClientText(
    client,
    [
      "Привет!",
      "Твой абонемент закончился 💔",
      "Как тебе наши тренировки? Мы будем рады видеть тебя снова!",
    ].join("\n"),
    "client:subscription_wr_off_client:first",
  );

  if (!first.ok) return resultFromTelegram(first);

  const second = await sendClientText(
    client,
    "Продолжаем? 😉",
    "client:subscription_wr_off_client:question",
    yesNoKeyboard(),
  );

  return resultFromTelegram(second);
}

async function handleWrOffClientEmail(
  event: NotificationEvent,
  client: ClientRow,
) {
  return await sendLifecycleEmail({
    event,
    client,
    template: buildSubscriptionWrOffClientEmail(),
  });
}

async function handleBalanceThresholdAdmin(
  event: NotificationEvent,
  client: ClientRow,
  coach: CoachProfile | null,
) {
  const payload = event.payload ?? {};
  const currency = payload.currency ?? "RUB";
  const text = [
    `Имя: ${clientName(client, payload)}`,
    `Баланс: ${formatBalanceChange(payload, client.balance, currency)}`,
    `Тренер: ${trainerName(client, payload, coach)}`,
  ].join("\n");

  return resultFromTelegram(
    await sendAdminText(text, "admin:balance_threshold_admin"),
  );
}

async function handleWrOffAdmin(
  event: NotificationEvent,
  client: ClientRow,
  coach: CoachProfile | null,
) {
  const payload = event.payload ?? {};
  const currency = payload.currency ?? "RUB";
  const text = [
    `Имя: ${clientName(client, payload)}`,
    `Баланс: ${formatBalanceChange(payload, client.balance, currency)}`,
    `Тренер: ${trainerName(client, payload, coach)}`,
    "Событие: wr_off",
  ].join("\n");

  return resultFromTelegram(
    await sendAdminText(text, "admin:subscription_wr_off_admin"),
  );
}

async function handleBalanceThresholdTrainer(
  event: NotificationEvent,
): Promise<HandleResult> {
  const payload = event.payload ?? {};
  const chatId = trainerTelegramId(payload);

  if (!chatId) {
    return {
      status: "skipped",
      errorCode: "trainer_telegram_missing",
      errorMessage: "Trainer telegram_id is missing",
    };
  }

  const currency = payload.currency ?? "RUB";
  const text = [
    `Имя: ${clientName(null, payload)}`,
    `Баланс: ${formatBalanceChange(payload, "", currency)}`,
    `Тренер: ${trainerName(null, payload)}`,
  ].join("\n");

  return resultFromTelegram(
    await sendTelegramWithRetry({
      botToken: CLIENT_BOT_TOKEN,
      chatId,
      text,
      target: "trainer:balance_threshold_trainer",
    }),
  );
}

async function handleSubscriptionPurchaseTrainer(
  event: NotificationEvent,
): Promise<HandleResult> {
  const payload = event.payload ?? {};
  const coachHandle = pickValue(payload, ["coach"]);

  if (!coachHandle) {
    return {
      status: "skipped",
      errorCode: "trainer_not_found",
      errorMessage: "Trainer coach handle is missing",
    };
  }

  const chatId = await getCoachTelegramId(coachHandle);

  if (!chatId) {
    return {
      status: "skipped",
      errorCode: "trainer_telegram_id_missing",
      errorMessage: "Trainer telegram_id is missing",
    };
  }

  const text = [
    "🟢 Покупка нового абонемента",
    "",
    `👤 Имя: ${clientName(null, payload)}`,
    `📚 Кол-во занятий: ${asString(payload.lessons).trim() || "—"}`,
    `💰 Текущий баланс: ${
      formatBalance(payload.balance_after, payload.currency ?? "RUB")
    }`,
  ].join("\n");

  return resultFromTelegram(
    await sendTelegramWithRetry({
      botToken: CLIENT_BOT_TOKEN,
      chatId,
      text,
      target: "trainer:subscription_purchase_trainer",
    }),
  );
}

async function handleFirstOnlinePurchaseWelcomeEmail(
  event: NotificationEvent,
  client: ClientRow,
) {
  const context = resolveEmailContext(event, client);
  if (!context.ok) return context.result;

  const courseName = pickValue(context.payload, ["course_name"]);
  const tariffLabel = pickValue(context.payload, ["tariff_label"]) ||
    courseName;
  const validWeeks = numericValue(context.payload.valid_weeks);

  if (!courseName && !tariffLabel) {
    return skipped(
      "template_data_missing",
      "Course or tariff label is missing",
    );
  }

  if (!validWeeks || validWeeks <= 0) {
    return skipped("duration_mapping_missing", "Valid weeks is missing");
  }

  const email = buildFirstOnlinePurchaseWelcomeEmail({
    clientName: clientName(client, context.payload),
    courseName: courseName || tariffLabel,
    tariffLabel,
    validWeeks,
    telegramUrl: defaultTelegramUrl(context.payload),
  });

  return resultFromEmail(
    await sendResendEmail({
      profile: context.senderProfile,
      idempotencyKey: `client-notification-event/${event.id}`,
      email: {
        ...email,
        to: context.recipientEmail,
      },
    }),
  );
}

async function handleStrengthTestInstructionEmail(
  event: NotificationEvent,
  client: ClientRow,
) {
  const context = resolveEmailContext(event, client);
  if (!context.ok) return context.result;

  const template = buildStrengthTestInstructionEmail();

  return resultFromEmail(
    await sendResendEmail({
      profile: context.senderProfile,
      idempotencyKey: `client-notification-event/${event.id}`,
      email: {
        ...template,
        to: context.recipientEmail,
      },
    }),
  );
}

async function deliverEvent(event: NotificationEvent): Promise<HandleResult> {
  if (
    event.channel !== "telegram" && event.channel !== "admin_telegram" &&
    event.channel !== "email"
  ) {
    return {
      status: "skipped",
      errorCode: "unsupported_channel",
      errorMessage: `Unsupported channel: ${event.channel}`,
    };
  }

  const client = await getClient(event.client_id);
  if (!client) {
    return {
      status: "skipped",
      errorCode: "client_not_found",
      errorMessage: "Client not found for notification event",
    };
  }

  const coach = await getCoachProfile(client.coach);

  if (
    event.recipient_type !== "client" && event.recipient_type !== "trainer" &&
    event.recipient_type !== "coach" && event.recipient_type !== "admin"
  ) {
    return {
      status: "skipped",
      errorCode: "unsupported_recipient_type",
      errorMessage: `Unsupported recipient_type: ${event.recipient_type}`,
    };
  }

  switch (event.event_type) {
    case "first_online_purchase_welcome_email":
      if (event.channel !== "email") {
        return unsupportedChannel(event);
      }
      return await handleFirstOnlinePurchaseWelcomeEmail(event, client);
    case "strength_test_instruction_email":
      if (event.channel !== "email") {
        return unsupportedChannel(event);
      }
      return await handleStrengthTestInstructionEmail(event, client);
    case "first_lesson_followup":
      if (event.channel === "telegram") {
        return await handleFirstLessonTelegram(event, client);
      }
      if (event.channel === "email") {
        return await handleFirstLessonEmail(event, client);
      }
      return unsupportedChannel(event);
    case "attendance_balance_client":
      if (event.channel !== "telegram") return unsupportedChannel(event);
      return await handleAttendanceBalance(event, client);
    case "balance_zero_client":
      if (event.channel !== "telegram") return unsupportedChannel(event);
      return await handleBalanceZero(event, client);
    case "balance_negative_client":
      if (event.channel !== "telegram") return unsupportedChannel(event);
      return await handleBalanceNegative(event, client);
    case "subscription_wr_off_client":
      if (event.channel === "telegram") {
        return await handleWrOffClientTelegram(event, client);
      }
      if (event.channel === "email") {
        return await handleWrOffClientEmail(event, client);
      }
      return unsupportedChannel(event);
    case "subscription_wr_off_admin":
      if (event.channel !== "admin_telegram") return unsupportedChannel(event);
      return await handleWrOffAdmin(event, client, coach);
    case "balance_threshold_admin":
      if (event.channel !== "admin_telegram") return unsupportedChannel(event);
      return await handleBalanceThresholdAdmin(event, client, coach);
    case "balance_threshold_trainer":
      if (event.channel !== "telegram") return unsupportedChannel(event);
      return await handleBalanceThresholdTrainer(event);
    case "subscription_purchase_trainer":
      if (event.channel !== "telegram") return unsupportedChannel(event);
      return await handleSubscriptionPurchaseTrainer(event);
    default:
      return {
        status: "skipped",
        errorCode: "unsupported_event_type",
        errorMessage: `Unsupported event_type: ${event.event_type}`,
      };
  }
}

async function updateEventFinal(eventId: string, result: HandleResult) {
  const patch: Record<string, unknown> = {
    status: result.status,
    updated_at: new Date().toISOString(),
    next_attempt_at: null,
  };

  if (result.status === "sent") {
    patch.sent_at = new Date().toISOString();
    patch.error_code = null;
    patch.error_message = null;

    if (result.email?.providerMessageId) {
      patch.provider = "resend";
      patch.provider_message_id = result.email.providerMessageId;
    }
  } else {
    patch.error_code = result.errorCode;
    patch.error_message = result.errorMessage.slice(0, 500);
  }

  const { error } = await supabase
    .from("client_notification_events")
    .update(patch)
    .eq("id", eventId)
    .not("status", "in", "(sent,skipped,failed)");

  if (error) throw error;
}

async function processEvent(eventId: string) {
  const { data: eventData, error: loadError } = await supabase
    .from("client_notification_events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();

  if (loadError) throw loadError;
  if (!eventData) return { ok: false, reason: "event_not_found" };

  const event = eventData as NotificationEvent;

  if (FINAL_STATUSES.has(event.status)) {
    console.log("notification_already_finalized", {
      eventId: event.id,
      status: event.status,
    });
    return { ok: true, status: event.status, reason: "already_finalized" };
  }

  if (event.next_attempt_at) {
    const waitMs = new Date(event.next_attempt_at).getTime() - Date.now();

    if (waitMs > MAX_NOT_READY_WAIT_MS) {
      return {
        ok: true,
        status: event.status,
        reason: "not_ready",
        nextAttemptAt: event.next_attempt_at,
      };
    }

    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }

  if (event.status === "processing") {
    console.log("notification_already_processing", { eventId: event.id });
    return { ok: true, status: event.status, reason: "already_processed" };
  }

  const { data: processingData, error: processingError } = await supabase
    .from("client_notification_events")
    .update({
      status: "processing",
      attempt_count: (event.attempt_count ?? 0) + 1,
      last_attempt_at: new Date().toISOString(),
      next_attempt_at: null,
      error_code: null,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", event.id)
    .not("status", "in", "(sent,skipped,failed,processing)")
    .select("*")
    .maybeSingle();

  if (processingError) throw processingError;
  if (!processingData) return { ok: true, reason: "already_processed" };

  const processingEvent = processingData as NotificationEvent;
  const client = await getClient(processingEvent.client_id).catch(() => null);

  try {
    const result = await deliverEvent(processingEvent);
    await updateEventFinal(processingEvent.id, result);

    if (result.status === "failed") {
      await sendErrorAlert(alertText({
        title: "IDC notification failed",
        event: processingEvent,
        client,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        attemptCount: (processingEvent.attempt_count ?? 0),
      }));
    }

    return { ok: true, status: result.status, result };
  } catch (error) {
    const errorMessage = safeErrorMessage(error);
    const failure: HandleResult = {
      status: "failed",
      errorCode: "notification_engine_error",
      errorMessage,
    };

    await updateEventFinal(processingEvent.id, failure);
    await sendErrorAlert(alertText({
      title: "IDC notification engine error",
      event: processingEvent,
      client,
      errorCode: failure.errorCode,
      errorMessage,
      attemptCount: (processingEvent.attempt_count ?? 0),
    }));

    return {
      ok: false,
      status: "failed",
      errorCode: failure.errorCode,
      errorMessage,
    };
  }
}

function isStale(event: NotificationEvent) {
  const timestamp = event.status === "processing"
    ? event.updated_at ?? event.last_attempt_at ?? event.created_at
    : event.created_at;

  if (!timestamp) return false;
  return Date.now() - new Date(timestamp).getTime() >= STALE_THRESHOLD_MS;
}

function isAlertThrottleOpen(event: NotificationEvent) {
  if (!event.last_alerted_at) return true;
  return Date.now() - new Date(event.last_alerted_at).getTime() >=
    STALE_ALERT_THROTTLE_MS;
}

async function finalizeStaleEvents() {
  const { data, error } = await supabase
    .from("client_notification_events")
    .select("*")
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) throw error;

  const candidates = ((data ?? []) as NotificationEvent[])
    .filter(isStale)
    .filter(isAlertThrottleOpen);

  if (!candidates.length) {
    return { ok: true, staleCount: 0 };
  }

  const now = new Date().toISOString();
  const ids = candidates.map((event) => event.id);

  for (const event of candidates) {
    const code = event.status === "processing"
      ? "stale_processing_unconfirmed"
      : "stale_pending_unconfirmed";

    const { error: updateError } = await supabase
      .from("client_notification_events")
      .update({
        status: "failed",
        error_code: code,
        error_message:
          "Notification event became stale without confirmed Edge Function completion",
        updated_at: now,
        next_attempt_at: null,
      })
      .eq("id", event.id)
      .eq("status", event.status);

    if (updateError) throw updateError;
  }

  const alertSent = await sendErrorAlert(alertText({
    title: "IDC stale notification events finalized",
    staleCount: ids.length,
    staleIds: ids,
    errorCode: "stale_notification_events_finalized",
    errorMessage:
      "Pending/processing notification events were marked failed without sending client notifications",
  }));

  if (alertSent) {
    const { error: alertUpdateError } = await supabase
      .from("client_notification_events")
      .update({ last_alerted_at: now })
      .in("id", ids);

    if (alertUpdateError) {
      console.warn("notification_stale_alert_timestamp_update_failed", {
        errorMessage: alertUpdateError.message,
      });
    }
  }

  return { ok: true, staleCount: ids.length, eventIds: ids, alertSent };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  const providedSecret = req.headers.get("x-notifications-secret") ?? "";
  if (!INTERNAL_SECRET || providedSecret !== INTERNAL_SECRET) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));

    if (body?.mode === "finalize_stale") {
      const result = await finalizeStaleEvents();
      return jsonResponse(result);
    }

    const eventId = asString(body?.eventId);
    if (!eventId) {
      return jsonResponse({ ok: false, error: "event_id_required" }, 400);
    }

    const result = await processEvent(eventId);
    return jsonResponse(result);
  } catch (error) {
    const errorMessage = safeErrorMessage(error);
    console.error("client_notifications_engine_unhandled_error", {
      errorMessage,
    });
    await sendErrorAlert([
      "IDC notification engine unhandled error",
      `error_message: ${errorMessage.slice(0, 500)}`,
    ].join("\n"));

    return jsonResponse(
      { ok: false, error: "internal_error", errorMessage },
      500,
    );
  }
});
