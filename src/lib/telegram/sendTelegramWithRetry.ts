import "server-only";

export type TelegramSendLogContext = {
  target: string;
  invId?: string;
  source?: string;
  format?: string;
  studioId?: string;
  emailHash?: string;
  chatIdHash?: string;
};

export type TelegramSendWithRetryResult = {
  ok: boolean;
  status?: number;
  telegramOk?: boolean;
  reason?: string;
  errorCode?: string;
  description?: string;
  attempts: number;
};

type SendTelegramWithRetryParams = {
  botToken: string | undefined;
  chatId: number | undefined;
  text: string;
  logContext: TelegramSendLogContext;
  parseMode?: string;
  disableWebPagePreview?: boolean;
  replyMarkup?: Record<string, unknown>;
  timeoutMs?: number;
  maxAttempts?: number;
  throwOnError?: boolean;
};

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_ATTEMPTS = 3;
const ERROR_ALERT_TIMEOUT_MS = 20000;
const ERROR_ALERT_MAX_ATTEMPTS = 2;
const IDC_ERRORS_BOT_TOKEN = process.env.IDC_ERRORS_BOT_TOKEN;
const IDC_ERRORS_CHAT_ID_RAW = process.env.IDC_ERRORS_CHAT_ID;
const IDC_ERRORS_CHAT_ID = IDC_ERRORS_CHAT_ID_RAW ? Number(IDC_ERRORS_CHAT_ID_RAW) : NaN;

function shortDescription(value: unknown) {
  if (typeof value !== "string") return undefined;
  return value.slice(0, 200);
}

function logTelegramAttempt(payload: Record<string, unknown>) {
  try {
    console.log(JSON.stringify({ tag: "IDC_TELEGRAM_SEND", event: "telegram_send_attempt", ...payload }));
  } catch {
    console.log("[IDC_TELEGRAM_SEND] telegram_send_attempt");
  }
}

function logTelegramAlert(payload: Record<string, unknown>) {
  try {
    console.log(JSON.stringify({ tag: "IDC_TELEGRAM_SEND", event: "telegram_error_alert", ...payload }));
  } catch {
    console.log("[IDC_TELEGRAM_SEND] telegram_error_alert");
  }
}

function shouldRetry(result: TelegramSendWithRetryResult) {
  return result.reason === "fetch_timeout" || result.reason === "fetch_failed";
}

async function sendTelegramAttempt(
  params: SendTelegramWithRetryParams,
  attempt: number
): Promise<TelegramSendWithRetryResult> {
  const { botToken, chatId, text, parseMode = "HTML", disableWebPagePreview = true, replyMarkup } = params;

  if (!botToken || !Number.isFinite(chatId)) {
    const result: TelegramSendWithRetryResult = {
      ok: false,
      reason: !botToken ? "bot_token_missing" : "chat_id_invalid",
      attempts: attempt,
    };
    return result;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: disableWebPagePreview,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);

    const responseText = await response.text();
    let json: { ok?: boolean; error_code?: number | string; description?: string } | null = null;
    try {
      json = JSON.parse(responseText) as { ok?: boolean; error_code?: number | string; description?: string };
    } catch {
      json = null;
    }

    const result: TelegramSendWithRetryResult = {
      ok: response.ok && json?.ok === true,
      status: response.status,
      telegramOk: json?.ok === true,
      errorCode: json?.error_code == null ? undefined : String(json.error_code),
      description: shortDescription(json?.description),
      attempts: attempt,
    };

    if (!result.ok) {
      result.reason = json?.ok === false ? "telegram_api_error" : "http_error";
    }

    return result;
  } catch (error) {
    clearTimeout(timeout);
    const isTimeout = error instanceof Error && error.name === "AbortError";
    const result: TelegramSendWithRetryResult = {
      ok: false,
      status: 0,
      telegramOk: false,
      reason: isTimeout ? "fetch_timeout" : "fetch_failed",
      description: shortDescription(error instanceof Error ? error.message : "unknown"),
      attempts: attempt,
    };
    return result;
  }
}

function alertText(context: TelegramSendLogContext, result: TelegramSendWithRetryResult) {
  return [
    "Telegram send failed",
    `target: ${context.target || "unknown"}`,
    context.invId ? `invId: ${context.invId}` : "",
    context.source ? `source: ${context.source}` : "",
    context.format ? `format: ${context.format}` : "",
    context.studioId ? `studioId: ${context.studioId}` : "",
    `reason: ${result.reason || "unknown"}`,
    `status: ${result.status ?? "unknown"}`,
    result.errorCode ? `errorCode: ${result.errorCode}` : "",
    result.description ? `description: ${result.description}` : "",
    `attempts: ${result.attempts}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function sendTelegramErrorAlert(
  context: TelegramSendLogContext,
  result: TelegramSendWithRetryResult
): Promise<void> {
  const alertParams: SendTelegramWithRetryParams = {
    botToken: IDC_ERRORS_BOT_TOKEN,
    chatId: IDC_ERRORS_CHAT_ID,
    text: alertText(context, result),
    logContext: {
      target: "telegram_error_alert",
      invId: context.invId,
      source: context.source,
      format: context.format,
      studioId: context.studioId,
    },
    parseMode: undefined,
    disableWebPagePreview: true,
    timeoutMs: ERROR_ALERT_TIMEOUT_MS,
  };

  let lastAlertResult: TelegramSendWithRetryResult = {
    ok: false,
    reason: "not_sent",
    attempts: 0,
  };

  for (let attempt = 1; attempt <= ERROR_ALERT_MAX_ATTEMPTS; attempt += 1) {
    lastAlertResult = await sendTelegramAttempt(alertParams, attempt);
    const finalAttempt = lastAlertResult.ok || !shouldRetry(lastAlertResult) || attempt === ERROR_ALERT_MAX_ATTEMPTS;
    logTelegramAlert({
      ...alertParams.logContext,
      attempt,
      finalAttempt,
      ...lastAlertResult,
    });
    if (finalAttempt) break;
  }
}

export async function sendTelegramWithRetry(
  params: SendTelegramWithRetryParams
): Promise<TelegramSendWithRetryResult> {
  const maxAttempts = Math.max(1, params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  let lastResult: TelegramSendWithRetryResult = {
    ok: false,
    reason: "not_sent",
    attempts: 0,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastResult = await sendTelegramAttempt(params, attempt);
    const finalAttempt = lastResult.ok || !shouldRetry(lastResult) || attempt === maxAttempts;
    logTelegramAttempt({
      ...params.logContext,
      attempt,
      finalAttempt,
      ...lastResult,
    });
    if (finalAttempt) {
      break;
    }
  }

  if (!lastResult.ok) {
    await sendTelegramErrorAlert(params.logContext, lastResult);
    if (params.throwOnError) {
      throw new Error(lastResult.reason || "telegram_send_failed");
    }
  }

  return lastResult;
}
