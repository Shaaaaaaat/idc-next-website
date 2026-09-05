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
  retryAfterSeconds?: number;
};

type HandleResult =
  | { status: "sent"; telegram?: SendResult; email?: SendResult }
  | {
    status: "skipped";
    errorCode: string;
    errorMessage: string;
    telegram?: SendResult;
    email?: SendResult;
  }
  | {
    status: "retry";
    errorCode: string;
    errorMessage: string;
    nextAttemptAt: string;
    telegram?: SendResult;
  }
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
const PAYMENT_ADMIN_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";
const IDC_ERRORS_BOT_TOKEN = Deno.env.get("IDC_ERRORS_BOT_TOKEN") ?? "";
const IDC_ERRORS_CHAT_ID = Deno.env.get("IDC_ERRORS_CHAT_ID") ?? "";
const TELEGRAM_COACH_CHAT_ID_MSK =
  Deno.env.get("TELEGRAM_COACH_CHAT_ID_MSK") ?? "";
const TELEGRAM_COACH_CHAT_ID_SPB_SPIRIT =
  Deno.env.get("TELEGRAM_COACH_CHAT_ID_SPB_SPIRIT") ?? "";
const TELEGRAM_COACH_CHAT_ID_SPB_HKC =
  Deno.env.get("TELEGRAM_COACH_CHAT_ID_SPB_HKC") ?? "";

const TELEGRAM_TIMEOUT_MS = 20_000;
const TELEGRAM_MAX_ATTEMPTS = 2;
const TELEGRAM_RETRY_DELAY_MS = 1_500;
const DURABLE_TELEGRAM_MAX_ATTEMPTS = 5;
const DURABLE_TELEGRAM_RETRY_DELAYS_MS = [
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
];
const EMAIL_INSTRUCTION_DELAY_MS = 60 * 1000;
const MAX_NOT_READY_WAIT_MS = EMAIL_INSTRUCTION_DELAY_MS + 5_000;
const STALE_THRESHOLD_MS = 3 * 60 * 1000;
const STALE_ALERT_THROTTLE_MS = 30 * 60 * 1000;
const FINAL_STATUSES = new Set(["sent", "skipped", "failed"]);
const DURABLE_TELEGRAM_EVENT_TYPES = new Set([
  "purchase_paid_admin",
  "purchase_paid_client",
  "purchase_paid_coach",
  "studio_monthly_report",
]);
const SKIPPED_CODES = new Set([
  "client_telegram_missing",
  "trainer_telegram_missing",
  "studio_telegram_missing",
  "studio_report_payload_missing",
  "studio_report_too_large",
  "studio_meta_missing",
  "telegram_config_missing",
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
  let lastRetryAfterSeconds: number | undefined;

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
      const retryAfter = Number(payload?.parameters?.retry_after);
      lastRetryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter
        : undefined;

      if (response.ok && payload?.ok !== false) {
        return { ok: true, status: response.status, attempts: attempt };
      }

      lastErrorCode = response.status === 429 || payload?.error_code === 429
        ? "telegram_rate_limited"
        : "telegram_api_error";
      lastErrorMessage = `Telegram API returned status ${response.status}`;
      console.warn("telegram_send_failed", {
        target: params.target,
        attempt,
        status: response.status,
        telegramOk: payload?.ok === true,
        retryAfterSeconds: lastRetryAfterSeconds,
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
    retryAfterSeconds: lastRetryAfterSeconds,
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

function isTransientTelegramFailure(telegram: SendResult) {
  const code = telegram.errorCode ?? "";
  if (code === "telegram_timeout" || code === "telegram_fetch_error") {
    return true;
  }
  if (code === "telegram_rate_limited") return true;
  if (telegram.status === 0 && !SKIPPED_CODES.has(code)) return true;
  if (telegram.status === 429) return true;
  return telegram.status >= 500;
}

function durableRetryDelayMs(attemptCount: number) {
  return DURABLE_TELEGRAM_RETRY_DELAYS_MS[
    Math.min(
      Math.max(attemptCount - 1, 0),
      DURABLE_TELEGRAM_RETRY_DELAYS_MS.length - 1,
    )
  ];
}

function resultFromDurableTelegram(
  event: NotificationEvent,
  telegram: SendResult,
): HandleResult {
  if (!DURABLE_TELEGRAM_EVENT_TYPES.has(event.event_type)) {
    return resultFromTelegram(telegram);
  }

  if (telegram.ok) return { status: "sent", telegram };

  const errorCode = telegram.errorCode ?? "telegram_send_failed";
  const errorMessage = telegram.errorMessage ?? "Telegram send failed";

  if (SKIPPED_CODES.has(errorCode)) {
    return { status: "skipped", errorCode, errorMessage, telegram };
  }

  const attemptCount = event.attempt_count ?? 0;
  if (
    isTransientTelegramFailure(telegram) &&
    attemptCount < DURABLE_TELEGRAM_MAX_ATTEMPTS
  ) {
    return {
      status: "retry",
      errorCode,
      errorMessage,
      nextAttemptAt: new Date(
        Date.now() + durableRetryDelayMs(attemptCount),
      ).toISOString(),
      telegram,
    };
  }

  return {
    status: "failed",
    errorCode,
    errorMessage,
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

function escapeTgHtml(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizePhoneForTelegram(input?: unknown) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("8")) {
    digits = `7${digits.slice(1)}`;
  }
  if (digits.length === 11 && digits.startsWith("7")) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return raw;
}

function telegramPhoneLine(input?: unknown) {
  const normalized = normalizePhoneForTelegram(input);
  if (!normalized) return "Тел: —";
  const safePhone = escapeTgHtml(normalized);
  return `Тел: <a href="tel:${safePhone}">${safePhone}</a>`;
}

function telegramPhoneLineOptional(input?: unknown) {
  const normalized = normalizePhoneForTelegram(input);
  if (!normalized) return "";
  const safePhone = escapeTgHtml(normalized);
  return `Тел: <a href="tel:${safePhone}">${safePhone}</a>`;
}

function formatMoscow(input?: string | null, withTime = true) {
  const date = input ? new Date(input) : new Date();
  const value = Number.isNaN(date.getTime()) ? new Date() : date;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(value).replace(",", "");
}

function formatDdMmTime(input?: unknown) {
  const raw = asString(input).trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const ddmm = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const hm = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date).replace(",", "");
  return `${ddmm} в ${hm}`;
}

function normalizeTrialDateLabel(input: string) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (/\sв\s/i.test(raw)) return raw;
  const withDot = raw.match(/^(\d{1,2}\.\d{1,2})\s+(\d{1,2}:\d{2})$/);
  if (withDot) return `${withDot[1]} в ${withDot[2]}`;
  const withSlash = raw.match(/^(\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2})$/);
  if (withSlash) return `${withSlash[1]} в ${withSlash[2]}`;
  return raw;
}

type TrialStudioMeta = {
  gymName: string;
  address: string;
  coach: string;
  directionsUrl?: string;
  chatUrl?: string;
};

const TRIAL_STUDIO_META: Record<string, TrialStudioMeta> = {
  msk_youcan: {
    gymName: "You Can",
    address: "м. Улица 1905 года",
    coach: "Женя",
    directionsUrl: "https://storage.yandexcloud.net/idc-website-app/ycg.jpeg",
    chatUrl: "https://t.me/+ofJDca2V3y9kNDVi",
  },
  msk_elfit: {
    gymName: "El-Fit",
    address: "Калужская площадь, 1к2, 3 этаж",
    coach: "Женя",
    directionsUrl: "https://storage.yandexcloud.net/idc-website-app/elfit.MP4",
    chatUrl: "https://t.me/+lk7Pdjp3AP81NmNi",
  },
  spb_hkc: {
    gymName: "Hells Kitchen",
    address: "м. Выборгская, Малый Сампсониевский пр., дом 2",
    coach: "Дима",
    chatUrl: "https://t.me/+dXJCxBPP9whkZjEy",
  },
  spb_spirit: {
    gymName: "Spirit",
    address: "м. Московские Ворота, ул. Заставская, 33П",
    coach: "Иван",
    directionsUrl: "https://storage.yandexcloud.net/idc-website-app/spirit.jpg",
    chatUrl: "https://t.me/+R9feJDYgxJtJCSbI",
  },
};

function paymentSource(payload: Record<string, unknown>) {
  return asString(payload.source_channel).trim().toLowerCase() === "website"
    ? "website"
    : "purchases";
}

function studioSlug(payload: Record<string, unknown>) {
  return pickValue(payload, ["studio_slug", "studio_id", "studio"]);
}

function studioDisplayName(slug: string) {
  return TRIAL_STUDIO_META[slug]?.gymName || slug || "—";
}

function cityFromStudioId(id: string) {
  if (id.startsWith("msk")) return "Москва";
  if (id.startsWith("spb")) return "Санкт-Петербург";
  return "";
}

function coachChatForStudio(id: string) {
  if (id === "msk_youcan" || id === "msk_elfit") {
    return TELEGRAM_COACH_CHAT_ID_MSK;
  }
  if (id === "spb_spirit") return TELEGRAM_COACH_CHAT_ID_SPB_SPIRIT;
  if (id === "spb_hkc") return TELEGRAM_COACH_CHAT_ID_SPB_HKC;
  return "";
}

function purchaseInvId(payload: Record<string, unknown>) {
  return pickValue(payload, ["transaction_id", "id_payment", "purchase_id"]) ||
    "—";
}

function purchaseMoney(payload: Record<string, unknown>) {
  return asString(payload.sum).trim() || "0";
}

function purchaseIsGymTrial(payload: Record<string, unknown>) {
  const format = asString(payload.format).trim().toLowerCase();
  const tariffLabel = asString(payload.tariff_label).trim().toLowerCase();
  return format === "gym" &&
    (tariffLabel === "trial" || Boolean(asString(payload.slot_start_at).trim()));
}

async function sendPurchaseTelegram(
  event: NotificationEvent,
  params: {
    botToken: string;
    chatId: string | number;
    text: string;
    replyMarkup?: ReplyMarkup;
    target: string;
  },
) {
  return resultFromDurableTelegram(
    event,
    await sendTelegramWithRetry(params),
  );
}

function parseAmount(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value: unknown) {
  const amount = parseAmount(value);
  return `${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount)} ₽`;
}

function formatReportMonth(value: unknown) {
  const raw = asString(value);
  const date = raw ? new Date(`${raw.slice(0, 10)}T00:00:00.000Z`) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;

  return new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(safeDate);
}

function formatReportDate(value: unknown) {
  const raw = asString(value);
  const date = raw ? new Date(`${raw.slice(0, 10)}T00:00:00.000Z`) : null;
  if (!date || Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function studioReportBreakdown(payload: Record<string, unknown>) {
  const rows = Array.isArray(payload.breakdown) ? payload.breakdown : [];

  return rows
    .flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const item = row as Record<string, unknown>;
      const format = asString(item.format).trim();
      const date = formatReportDate(item.workout_date);
      const amount = formatMoney(item.amount);
      const count = Math.max(0, Math.round(parseAmount(item.count)));
      const peopleSuffix = format === "Групповая тренировка" && count > 0
        ? ` — ${count} чел.`
        : "";

      return [`${date} — ${format || "—"}${peopleSuffix}: ${amount}`];
    });
}

function buildStudioMonthlyReportMessages(payload: Record<string, unknown>) {
  const studioTitle = pickValue(payload, ["studio_title", "studio_title_snapshot"]) || "Студия";
  const reportMonth = formatReportMonth(payload.report_month);
  const totalAmount = formatMoney(payload.total_amount);
  const lines = studioReportBreakdown(payload);
  const header = [
    `<b>Отчёт по студии за ${escapeTgHtml(reportMonth)}</b>`,
    "",
    `Студия: ${escapeTgHtml(studioTitle)}`,
    `Итого к оплате: ${escapeTgHtml(totalAmount)}`,
  ].join("\n");
  const maxMessageLength = 3500;

  if (lines.length === 0) {
    return [`${header}\n\nДетализация: нет строк для отчёта.`];
  }

  const messages: string[] = [];
  let part = 1;
  let current = `${header}\n\nДетализация:`;

  for (const line of lines) {
    const safeLine = escapeTgHtml(line);
    const next = `${current}\n${safeLine}`;

    if (next.length <= maxMessageLength) {
      current = next;
      continue;
    }

    messages.push(current);
    part += 1;
    current = [
      `<b>Отчёт по студии за ${escapeTgHtml(reportMonth)}</b>`,
      `Студия: ${escapeTgHtml(studioTitle)}`,
      "",
      `Детализация, часть ${part}:`,
      safeLine,
    ].join("\n");
  }

  messages.push(current);
  return messages;
}

async function handleStudioMonthlyReport(
  event: NotificationEvent,
): Promise<HandleResult> {
  const payload = event.payload ?? {};
  const chatId = pickValue(payload, ["recipient_tgid", "tgid", "chat_id"]);

  if (!chatId) {
    return {
      status: "skipped",
      errorCode: "studio_telegram_missing",
      errorMessage: "Studio monthly report recipient tgid is missing",
    };
  }

  if (!payload.report_month || parseAmount(payload.total_amount) <= 0) {
    return {
      status: "skipped",
      errorCode: "studio_report_payload_missing",
      errorMessage: "Studio monthly report payload is missing report_month or positive total_amount",
    };
  }

  const messages = buildStudioMonthlyReportMessages(payload);
  if (messages.length !== 1) {
    return {
      status: "skipped",
      errorCode: "studio_report_too_large",
      errorMessage: "Studio monthly report requires chunked outbox events before delivery",
    };
  }

  return resultFromDurableTelegram(
    event,
    await sendTelegramWithRetry({
      botToken: CLIENT_BOT_TOKEN,
      chatId,
      text: messages[0],
      target: "studio:monthly_report",
    }),
  );
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

async function handleStudentWorkoutSubmittedTrainer(
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

  const workoutTitle = pickValue(payload, ["workout_title"]) || "Тренировка";
  const workoutDate = pickValue(payload, ["workout_date"]);
  const exerciseResultCount = pickValue(payload, ["exercise_result_count"]);
  const videoCount = pickValue(payload, ["video_count"]);
  const resultLine = exerciseResultCount || videoCount
    ? `Результаты: ${exerciseResultCount || "0"} упражнений, ${videoCount || "0"} видео.`
    : null;

  const text = [
    `${clientName(null, payload)} завершил тренировку.`,
    `Тренировка: ${workoutTitle}${workoutDate ? ` (${workoutDate})` : ""}`,
    resultLine,
  ].filter(Boolean).join("\n");

  return resultFromTelegram(
    await sendTelegramWithRetry({
      botToken: CLIENT_BOT_TOKEN,
      chatId,
      text,
      target: "trainer:student_workout_submitted",
    }),
  );
}

async function handlePurchasePaidAdmin(
  event: NotificationEvent,
  client: ClientRow,
): Promise<HandleResult> {
  const payload = event.payload ?? {};
  const source = paymentSource(payload);
  const format = asString(payload.format).trim().toLowerCase();
  const courseName = pickValue(payload, ["course_name", "tag"]);
  const purchaseTag = pickValue(payload, ["tag", "course_name"]);
  const tariffLabel = pickValue(payload, ["tariff_label"]);
  const slug = studioSlug(payload);
  const displayStudio = studioDisplayName(slug);
  const invId = purchaseInvId(payload);
  const fio = clientName(client, payload);
  const phone = payload.phone;
  const phoneLine = telegramPhoneLine(phone);
  const phoneOptional = telegramPhoneLineOptional(phone);
  const email = pickValue(payload, ["email"]) || asString(client.email);
  const sum = purchaseMoney(payload);
  const lessons = numericValue(payload.lessons);
  const pricePerLesson = lessons > 0
    ? Math.round(numericValue(payload.sum) / lessons)
    : numericValue(payload.price_per_lesson);
  const paidAt = formatMoscow(event.created_at);
  let text = "";

  if (source === "purchases") {
    text =
      `<b>✅ Оплата подтверждена (bot)</b>\n` +
      `InvId: <code>${escapeTgHtml(invId)}</code>\n` +
      `Дата: ${escapeTgHtml(paidAt)}\n` +
      `Имя: ${escapeTgHtml(fio || "—")}\n` +
      `${phoneOptional ? `${phoneOptional}\n` : ""}` +
      `Почта: ${escapeTgHtml(email || "—")}\n` +
      `Сумма: ${escapeTgHtml(sum)} ₽\n` +
      `Курс: ${escapeTgHtml(purchaseTag || "—")}\n` +
      `Тариф: ${escapeTgHtml(tariffLabel || "—")}`;
  } else if (format === "ds") {
    text =
      `<b>✅ Новая покупка ${escapeTgHtml(courseName)}</b>\n` +
      `${escapeTgHtml(tariffLabel)}\n` +
      `Дата: ${escapeTgHtml(paidAt)}\n` +
      `Имя: ${escapeTgHtml(fio)}\n` +
      `${phoneLine}\n` +
      `Email: ${escapeTgHtml(email)}\n` +
      `Сумма: ${escapeTgHtml(sum)} ₽\n` +
      `Кол-во тренировок: ${escapeTgHtml(String(lessons || 0))}\n` +
      `Стоимость за тренировку: ${escapeTgHtml(String(pricePerLesson || 0))} ₽`;
  } else if (purchaseIsGymTrial(payload)) {
    const city = cityFromStudioId(slug);
    const header =
      `<b>🟡 Новая запись в ${escapeTgHtml(displayStudio)}${
        city ? ` (${escapeTgHtml(city)})` : ""
      }</b>\n`;
    text =
      header +
      `Формат: пробная тренировка\n` +
      `Когда: ${escapeTgHtml(formatDdMmTime(payload.slot_start_at))}\n` +
      `Имя: ${escapeTgHtml(fio)}\n` +
      `${phoneLine}\n` +
      `Почта: ${escapeTgHtml(email)}\n` +
      `Сумма: ${escapeTgHtml(sum)} ₽\n\n` +
      `Оплата: ${escapeTgHtml(paidAt)}\n` +
      `Тэг: ${escapeTgHtml(courseName)}`;
  } else if (
    format === "gym" &&
    (courseName.includes("_personal_") || courseName.includes("_split_"))
  ) {
    const city = cityFromStudioId(slug);
    const header =
      `<b>🔵 Новая запись в ${escapeTgHtml(displayStudio)}${
        city ? ` (${escapeTgHtml(city)})` : ""
      }</b>\n`;
    const formatLabel = courseName.includes("_split_") ? "сплит" : "персоналка";
    text =
      header +
      `Формат: ${escapeTgHtml(formatLabel)}\n` +
      `Имя: ${escapeTgHtml(fio)}\n` +
      `${phoneLine}\n` +
      `Почта: ${escapeTgHtml(email)}\n` +
      `Сумма: ${escapeTgHtml(sum)} ₽\n\n` +
      `Оплата: ${escapeTgHtml(paidAt)}\n` +
      `Тэг: ${escapeTgHtml(courseName)}`;
  } else if (format === "gym") {
    text =
      `<b>✅ Новая покупка ${escapeTgHtml(courseName)}</b>\n` +
      `Когда: ${escapeTgHtml(paidAt)}\n` +
      `Имя: ${escapeTgHtml(fio)}\n` +
      `${phoneLine}\n` +
      `Почта: ${escapeTgHtml(email)}\n` +
      `Сумма: ${escapeTgHtml(sum)} ₽`;
  } else {
    text =
      `<b>✅ Оплата успешна</b>\n` +
      `<b>InvId:</b> <code>${escapeTgHtml(invId)}</code>\n` +
      `<b>OutSum:</b> ${escapeTgHtml(sum)}`;
  }

  return await sendPurchaseTelegram(event, {
    botToken: CLIENT_BOT_TOKEN,
    chatId: PAYMENT_ADMIN_CHAT_ID,
    text,
    target: "admin:purchase_paid_admin",
  });
}

async function handlePurchasePaidCoach(
  event: NotificationEvent,
  client: ClientRow,
): Promise<HandleResult> {
  const payload = event.payload ?? {};
  const slug = studioSlug(payload);
  const trialMeta = TRIAL_STUDIO_META[slug];

  if (!purchaseIsGymTrial(payload)) {
    return skipped("unsupported_event_type", "Purchase is not a gym trial");
  }
  if (!trialMeta) {
    return skipped("studio_meta_missing", "Studio routing metadata is missing");
  }

  const chatId = coachChatForStudio(slug);
  if (!chatId) {
    return skipped("trainer_telegram_missing", "Coach Telegram chat id is missing");
  }

  const city = cityFromStudioId(slug);
  const trialDateLabel = normalizeTrialDateLabel(
    formatDdMmTime(payload.slot_start_at) || asString(payload.slot_start_at),
  );
  const email = pickValue(payload, ["email"]) || asString(client.email);
  const phoneOptional = telegramPhoneLineOptional(payload.phone);
  const header =
    `<b>🟡 Новая запись в ${escapeTgHtml(trialMeta.gymName)}${
      city ? ` (${escapeTgHtml(city)})` : ""
    }</b>\n`;
  const text =
    header +
    `Когда: ${escapeTgHtml(trialDateLabel || "—")}\n` +
    `Имя: ${escapeTgHtml(clientName(client, payload) || "—")}\n` +
    `${phoneOptional ? `${phoneOptional}\n` : ""}` +
    `Почта: ${escapeTgHtml(email || "—")}`;

  return await sendPurchaseTelegram(event, {
    botToken: CLIENT_BOT_TOKEN,
    chatId,
    text,
    target: "coach:purchase_paid_coach",
  });
}

async function handlePurchasePaidClient(
  event: NotificationEvent,
  client: ClientRow,
): Promise<HandleResult> {
  const payload = event.payload ?? {};
  const chatId = asString(client.tgid);

  if (!chatId) {
    return skipped("client_telegram_missing", "Client tgid is missing");
  }

  const format = asString(payload.format).trim().toLowerCase();
  const tariffLabel = asString(payload.tariff_label).trim().toLowerCase();
  const slug = studioSlug(payload);
  const trialMeta = TRIAL_STUDIO_META[slug];
  const sum = purchaseMoney(payload);

  if (purchaseIsGymTrial(payload)) {
    if (!trialMeta) {
      return skipped("studio_meta_missing", "Studio routing metadata is missing");
    }

    const trialDateLabel = normalizeTrialDateLabel(
      formatDdMmTime(payload.slot_start_at) || asString(payload.slot_start_at),
    );
    const first = await sendPurchaseTelegram(event, {
      botToken: CLIENT_BOT_TOKEN,
      chatId,
      text:
        `Отлично, запись подтверждена!\n\n` +
        `Дата и время: ${escapeTgHtml(trialDateLabel || "—")}\n` +
        `Зал: ${escapeTgHtml(trialMeta.gymName)}\n` +
        `Адрес: ${escapeTgHtml(trialMeta.address)}\n` +
        `Тренер: ${escapeTgHtml(trialMeta.coach)}`,
      target: "client:purchase_paid_client:gym_trial_details",
    });

    if (first.status !== "sent") return first;

    const second = await sendPurchaseTelegram(event, {
      botToken: CLIENT_BOT_TOKEN,
      chatId,
      text:
        `Важно:\n` +
        `- Если нужно перенести тренировку, используй команду /reschedule.\n` +
        `- Абонемент активен 4 недели с даты первой тренировки.`,
      target: "client:purchase_paid_client:gym_trial_notes",
    });

    if (second.status !== "sent") return second;

    const inlineButtons: Array<{ text: string; url: string }> = [];
    if (trialMeta.directionsUrl) {
      inlineButtons.push({ text: "📍 Как добраться", url: trialMeta.directionsUrl });
    }
    if (trialMeta.chatUrl) {
      inlineButtons.push({ text: "💬 Присоединиться к чату", url: trialMeta.chatUrl });
    }

    if (!inlineButtons.length) return second;

    return await sendPurchaseTelegram(event, {
      botToken: CLIENT_BOT_TOKEN,
      chatId,
      text: "Полезные ссылки:",
      replyMarkup: {
        inline_keyboard: [
          inlineButtons.map((button) => ({
            text: button.text,
            url: button.url,
          })),
        ],
      },
      target: "client:purchase_paid_client:gym_trial_links",
    });
  }

  if (format === "ds" && tariffLabel === "online_test") {
    const first = await sendPurchaseTelegram(event, {
      botToken: CLIENT_BOT_TOKEN,
      chatId,
      text:
        `Ура, оплата прошла успешно!\n` +
        `Вскоре на вашу почту придет письмо с темой [TrueCoach] Invitation, содержащее приглашение для доступа к нашему приложению, где будет стоять первая тренировка.\n` +
        `После прохождения первой тренировки наш тренер свяжется с вами и предоставит подробную обратную связь. Для удобства рекомендуем скачать мобильную версию приложения 👇🏻`,
      target: "client:purchase_paid_client:online_test_intro",
    });

    if (first.status !== "sent") return first;

    const second = await sendPurchaseTelegram(event, {
      botToken: CLIENT_BOT_TOKEN,
      chatId,
      text: "Ссылки для установки приложения:",
      replyMarkup: {
        inline_keyboard: [[
          {
            text: "🍎 Скачать для iOS",
            url: "https://apps.apple.com/am/app/truecoach-for-clients/id1439127794",
          },
          {
            text: "🤖 Скачать для Android",
            url: "https://play.google.com/store/apps/details?id=co.truecoach.client",
          },
        ]],
      },
      target: "client:purchase_paid_client:online_test_links",
    });

    if (second.status !== "sent") return second;

    return await sendPurchaseTelegram(event, {
      botToken: CLIENT_BOT_TOKEN,
      chatId,
      text:
        `<b>Краткая инструкция как выполнять тест силы от I Do Calisthenics:</b>\n` +
        `Всего 5-7 упражнений (в зависимости от выбранного курса). Для каждого упражнения в приложении указано возможное количество вариаций (от 1 до 3): вам надо выбрать и выполнить только одну вариацию и один подход в каждом упражнении — ту, которая для вас не самая простая, но с которой вы уверенно справитесь.\n` +
        `Важно: все упражнения необходимо снять на видео и загрузить в приложение — это поможет нам определить ваш текущий уровень и составить последующие тренировки эффективно.`,
      target: "client:purchase_paid_client:online_test_instruction",
    });
  }

  return await sendPurchaseTelegram(event, {
    botToken: CLIENT_BOT_TOKEN,
    chatId,
    text:
      `Ура! Оплата прошла успешно ✅\n` +
      `Ваш баланс пополнен на: ${escapeTgHtml(sum)} ₽.\n\n` +
      `Дата окончания вашего тарифа обновлена. Посмотреть её можно, нажав кнопку «Дата окончания».`,
    target: "client:purchase_paid_client:balance",
  });
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

  if (event.event_type === "studio_monthly_report") {
    if (event.channel !== "telegram") return unsupportedChannel(event);
    if (event.recipient_type !== "studio") {
      return {
        status: "skipped",
        errorCode: "unsupported_recipient_type",
        errorMessage: `Unsupported recipient_type: ${event.recipient_type}`,
      };
    }
    return await handleStudioMonthlyReport(event);
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
    event.recipient_type !== "coach" && event.recipient_type !== "admin" &&
    event.recipient_type !== "studio"
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
    case "student_workout_submitted":
      if (event.channel !== "telegram") return unsupportedChannel(event);
      return await handleStudentWorkoutSubmittedTrainer(event);
    case "purchase_paid_admin":
      if (event.channel !== "admin_telegram") return unsupportedChannel(event);
      return await handlePurchasePaidAdmin(event, client);
    case "purchase_paid_client":
      if (event.channel !== "telegram") return unsupportedChannel(event);
      return await handlePurchasePaidClient(event, client);
    case "purchase_paid_coach":
      if (event.channel !== "telegram") return unsupportedChannel(event);
      return await handlePurchasePaidCoach(event, client);
    default:
      return {
        status: "skipped",
        errorCode: "unsupported_event_type",
        errorMessage: `Unsupported event_type: ${event.event_type}`,
      };
  }
}

async function updateEventFinal(eventId: string, result: HandleResult) {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = result.status === "retry"
    ? {
      status: "pending",
      updated_at: now,
      next_attempt_at: result.nextAttemptAt,
      error_code: result.errorCode,
      error_message: result.errorMessage.slice(0, 500),
    }
    : {
      status: result.status,
      updated_at: now,
      next_attempt_at: null,
    };

  if (result.status === "sent") {
    patch.sent_at = now;
    patch.error_code = null;
    patch.error_message = null;

    if (result.email?.providerMessageId) {
      patch.provider = "resend";
      patch.provider_message_id = result.email.providerMessageId;
    }
  } else if (result.status !== "retry") {
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
    : DURABLE_TELEGRAM_EVENT_TYPES.has(event.event_type)
    ? event.next_attempt_at ?? event.created_at
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
