import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  last_alerted_at?: string | null;
};

type ClientRow = {
  id: string;
  fio: string | null;
  tgid: string | number | null;
  coach: string | null;
  balance: number | null;
  balance_until: string | null;
};

type CoachProfile = {
  coach_name: string;
  display_name: string | null;
};

type SendResult = {
  ok: boolean;
  status: number;
  attempts: number;
  errorCode?: string;
  errorMessage?: string;
};

type HandleResult =
  | { status: "sent"; telegram?: SendResult }
  | { status: "skipped"; errorCode: string; errorMessage: string }
  | { status: "failed"; errorCode: string; errorMessage: string; telegram?: SendResult };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_SECRET = Deno.env.get("NOTIFICATIONS_INTERNAL_SECRET") ?? "";
const MAIN_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? Deno.env.get("BOT_TOKEN") ?? "";
const ADMIN_CHAT_ID = Deno.env.get("ADMIN_TELEGRAM_CHAT_ID") ??
  Deno.env.get("TELEGRAM_ADMIN_CHAT_ID") ??
  Deno.env.get("TELEGRAM_CHAT_ID") ??
  "";
const IDC_ERRORS_BOT_TOKEN = Deno.env.get("IDC_ERRORS_BOT_TOKEN") ?? "";
const IDC_ERRORS_CHAT_ID = Deno.env.get("IDC_ERRORS_CHAT_ID") ?? "";

const TELEGRAM_TIMEOUT_MS = 20_000;
const TELEGRAM_MAX_ATTEMPTS = 2;
const TELEGRAM_RETRY_DELAY_MS = 1_500;
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
      lastErrorCode = error instanceof DOMException && error.name === "AbortError"
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
    params.errorMessage ? `error_message: ${params.errorMessage.slice(0, 500)}` : null,
    typeof params.attemptCount === "number" ? `attempt_count: ${params.attemptCount}` : null,
    typeof params.staleCount === "number" ? `stale_count: ${params.staleCount}` : null,
    params.staleIds?.length ? `event_ids: ${params.staleIds.join(", ")}` : null,
  ].filter(Boolean);

  return lines.join("\n");
}

async function getClient(clientId: string | null): Promise<ClientRow | null> {
  if (!clientId) return null;

  const { data, error } = await supabase
    .from("clients")
    .select("id, fio, tgid, coach, balance, balance_until")
    .eq("id", clientId)
    .maybeSingle();

  if (error) throw error;
  return data as ClientRow | null;
}

async function getCoachProfile(coachHandle: string | null): Promise<CoachProfile | null> {
  if (!coachHandle) return null;

  const { data, error } = await supabase
    .from("coach_profiles")
    .select("coach_name, display_name")
    .eq("coach_name", coachHandle)
    .maybeSingle();

  if (error) throw error;
  return data as CoachProfile | null;
}

function eventTitle(event: NotificationEvent) {
  switch (event.event_type) {
    case "subscription_wr_off_client":
    case "subscription_wr_off_admin":
      return "Списание абонемента";
    case "attendance_balance_client":
      return "Баланс после тренировки";
    case "low_balance":
    case "balance_zero_client":
    case "balance_negative_client":
    case "balance_threshold_admin":
    case "balance_threshold_trainer":
      return "Низкий баланс";
    case "first_lesson_followup":
      return "Первая тренировка";
    case "workout_assigned":
      return "Назначена тренировка";
    default:
      return "Уведомление IDC";
  }
}

function buildMessage(event: NotificationEvent, client: ClientRow | null, coach: CoachProfile | null) {
  const payload = event.payload ?? {};
  const clientName = asString(payload.client_name) || client?.fio || "клиент";
  const amount = asString(payload.amount) || asString(payload.delta) || "";
  const balance = asString(payload.balance_after) || asString(client?.balance) || "";
  const balanceBefore = asString(payload.balance_before);
  const currency = asString(payload.currency) || "RUB";
  const date = asString(payload.date) || asString(payload.training_date) || asString(payload.workout_date) || asString(payload.write_off_date) || "";
  const format = asString(payload.format) || asString(payload.training_format) || "";
  const coachName = asString(payload.coach_name) || asString(payload.trainer_name) || coach?.display_name || coach?.coach_name || "";
  const writeOffAmount = asString(payload.amount_client_currency) || amount;

  if (event.event_type === "attendance_balance_client") {
    return [
      "Тренировка учтена",
      `Клиент: ${clientName}`,
      date ? `Дата: ${date}` : null,
      format ? `Формат: ${format}` : null,
      balanceBefore ? `Баланс до: ${balanceBefore} ${currency}` : null,
      balance ? `Баланс после: ${balance} ${currency}` : null,
      coachName ? `Тренер: ${coachName}` : null,
    ].filter(Boolean).join("\n");
  }

  if (event.event_type === "balance_zero_client" || event.event_type === "balance_negative_client") {
    return [
      event.event_type === "balance_zero_client" ? "Баланс закончился" : "Баланс стал отрицательным",
      `Клиент: ${clientName}`,
      balance ? `Баланс: ${balance} ${currency}` : null,
      date ? `Дата тренировки: ${date}` : null,
    ].filter(Boolean).join("\n");
  }

  if (event.event_type === "balance_threshold_admin" || event.event_type === "balance_threshold_trainer") {
    return [
      "Баланс клиента требует внимания",
      `Клиент: ${clientName}`,
      balance ? `Баланс: ${balance} ${currency}` : null,
      date ? `Дата тренировки: ${date}` : null,
      format ? `Формат: ${format}` : null,
      coachName ? `Тренер: ${coachName}` : null,
    ].filter(Boolean).join("\n");
  }

  if (event.event_type === "subscription_wr_off_client" || event.event_type === "subscription_wr_off_admin") {
    return [
      "Абонемент списан",
      `Клиент: ${clientName}`,
      writeOffAmount ? `Сумма списания: ${writeOffAmount} ${currency}` : null,
      balance ? `Баланс после: ${balance} ${currency}` : null,
      date ? `Дата списания: ${date}` : null,
    ].filter(Boolean).join("\n");
  }

  if (event.event_type === "first_lesson_followup") {
    return [
      "Спасибо за первую тренировку!",
      `Клиент: ${clientName}`,
      coachName ? `Тренер: ${coachName}` : null,
    ].filter(Boolean).join("\n");
  }

  if (event.event_type === "subscription_wr_off") {
    return [
      "Списание по абонементу",
      `Клиент: ${clientName}`,
      amount ? `Сумма: ${amount}` : null,
      balance ? `Баланс после: ${balance}` : null,
      date ? `Дата: ${date}` : null,
    ].filter(Boolean).join("\n");
  }

  if (event.event_type === "low_balance") {
    return [
      "Низкий баланс клиента",
      `Клиент: ${clientName}`,
      balance ? `Баланс: ${balance}` : null,
    ].filter(Boolean).join("\n");
  }

  if (event.event_type === "workout_assigned") {
    return [
      "Назначена тренировка",
      `Клиент: ${clientName}`,
      date ? `Дата: ${date}` : null,
      format ? `Формат: ${format}` : null,
      coachName ? `Тренер: ${coachName}` : null,
    ].filter(Boolean).join("\n");
  }

  return [
    eventTitle(event),
    `Клиент: ${clientName}`,
    amount ? `Сумма: ${amount}` : null,
    balance ? `Баланс: ${balance}` : null,
  ].filter(Boolean).join("\n");
}

async function deliverEvent(event: NotificationEvent): Promise<HandleResult> {
  if (event.channel !== "telegram" && event.channel !== "admin_telegram") {
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
  const payload = event.payload ?? {};
  const text = buildMessage(event, client, coach);
  let chatId = "";

  if (event.recipient_type === "client") {
    chatId = asString(client.tgid);
    if (!chatId) {
      return {
        status: "skipped",
        errorCode: "client_telegram_missing",
        errorMessage: "Client tgid is missing",
      };
    }
  } else if (event.recipient_type === "trainer" || event.recipient_type === "coach") {
    chatId = asString(payload.trainer_telegram_id);
    if (!chatId) {
      return {
        status: "skipped",
        errorCode: "trainer_telegram_missing",
        errorMessage: "Trainer telegram_id is missing",
      };
    }
  } else if (event.recipient_type === "admin") {
    chatId = ADMIN_CHAT_ID;
    if (!chatId) {
      return {
        status: "skipped",
        errorCode: "admin_chat_missing",
        errorMessage: "Admin Telegram chat id is missing",
      };
    }
  } else {
    return {
      status: "skipped",
      errorCode: "unsupported_recipient_type",
      errorMessage: `Unsupported recipient_type: ${event.recipient_type}`,
    };
  }

  const telegram = await sendTelegramWithRetry({
    botToken: MAIN_BOT_TOKEN,
    chatId,
    text,
    target: `${event.recipient_type}:${event.event_type}`,
  });

  if (telegram.ok) return { status: "sent", telegram };

  return {
    status: SKIPPED_CODES.has(telegram.errorCode ?? "") ? "skipped" : "failed",
    errorCode: telegram.errorCode ?? "telegram_send_failed",
    errorMessage: telegram.errorMessage ?? "Telegram send failed",
    telegram,
  };
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

    return { ok: false, status: "failed", errorCode: failure.errorCode, errorMessage };
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
  return Date.now() - new Date(event.last_alerted_at).getTime() >= STALE_ALERT_THROTTLE_MS;
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
        error_message: "Notification event became stale without confirmed Edge Function completion",
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
    errorMessage: "Pending/processing notification events were marked failed without sending client notifications",
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
    console.error("client_notifications_engine_unhandled_error", { errorMessage });
    await sendErrorAlert([
      "IDC notification engine unhandled error",
      `error_message: ${errorMessage.slice(0, 500)}`,
    ].join("\n"));

    return jsonResponse({ ok: false, error: "internal_error", errorMessage }, 500);
  }
});
