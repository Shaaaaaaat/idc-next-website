import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("EDGE_SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("EDGE_SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_BEARER_TOKEN = Deno.env.get("CRON_EDGE_FUNCTION_BEARER") ?? SUPABASE_SERVICE_ROLE_KEY;
const IDC_METRICS_BOT_TOKEN = Deno.env.get("IDC_METRICS_BOT_TOKEN") ?? "";
const IDC_METRICS_CHAT_ID = Deno.env.get("IDC_METRICS_CHAT_ID") ?? "";
const IDC_ERRORS_BOT_TOKEN = Deno.env.get("IDC_ERRORS_BOT_TOKEN") ?? "";
const IDC_ERRORS_CHAT_ID = Deno.env.get("IDC_ERRORS_CHAT_ID") ?? "";

const TELEGRAM_TIMEOUT_MS = 20_000;
const ALERT_TIMEOUT_MS = 5_000;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type MetricsReport = {
  active_total?: number | string | null;
  active_online?: number | string | null;
  active_offline?: number | string | null;
  classic?: number | string | null;
  light?: number | string | null;
  pullups?: number | string | null;
  handstand?: number | string | null;
  trial_passed?: number | string | null;
  trial_bought?: number | string | null;
  trial_bought_online?: number | string | null;
  trial_bought_offline?: number | string | null;
};

type TelegramPayload = {
  ok?: boolean;
  error_code?: number;
  description?: string;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function safeText(value: unknown, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function metricNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function bearerToken(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function isAuthorized(req: Request) {
  const provided = bearerToken(req);
  return Boolean(CRON_BEARER_TOKEN && provided && provided === CRON_BEARER_TOKEN);
}

function reportDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "Europe/Moscow",
  }).format(now);
}

function formatReport(metrics: MetricsReport, now = new Date()) {
  return [
    `Дата: ${reportDate(now)},`,
    `Количество учеников: ${metricNumber(metrics.active_total)},`,
    `- Offline: ${metricNumber(metrics.active_offline)}`,
    `- Online: ${metricNumber(metrics.active_online)}`,
    `          • classic: ${metricNumber(metrics.classic)}`,
    `          • light: ${metricNumber(metrics.light)}`,
    `          • pullups: ${metricNumber(metrics.pullups)}`,
    `          • handstand: ${metricNumber(metrics.handstand)}`,
    "",
    `Прошли пробное: ${metricNumber(metrics.trial_passed)},`,
    "",
    `Купили пробное: ${metricNumber(metrics.trial_bought)},`,
    `- Offline: ${metricNumber(metrics.trial_bought_offline)}`,
    `- Online: ${metricNumber(metrics.trial_bought_online)}`,
  ].join("\n");
}

function telegramErrorMessage(status: number, payload: TelegramPayload) {
  return [
    `Telegram send failed with status ${status}`,
    payload.error_code == null ? "" : `error_code=${payload.error_code}`,
    payload.description ? `description=${safeText(payload.description, 300)}` : "",
  ].filter(Boolean).join(", ");
}

async function sendTelegramMessage(params: {
  botToken: string;
  chatId: string;
  text: string;
  timeoutMs: number;
}) {
  if (!params.botToken || !params.chatId) {
    throw new Error("metrics_telegram_config_missing");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    let response: Response;

    try {
      response = await fetch(`https://api.telegram.org/bot${params.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: params.chatId,
          text: params.text,
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === "AbortError";
      throw new Error(isTimeout ? "telegram_send_timeout" : "telegram_fetch_failed");
    }

    const body = await response.json().catch(() => ({})) as TelegramPayload;

    if (!response.ok || body.ok !== true) {
      throw new Error(telegramErrorMessage(response.status, body));
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sendErrorAlert(text: string) {
  if (!IDC_ERRORS_BOT_TOKEN || !IDC_ERRORS_CHAT_ID) return;

  try {
    await sendTelegramMessage({
      botToken: IDC_ERRORS_BOT_TOKEN,
      chatId: IDC_ERRORS_CHAT_ID,
      text,
      timeoutMs: ALERT_TIMEOUT_MS,
    });
  } catch (error) {
    console.warn("daily_metrics_error_alert_failed", {
      errorMessage: safeText(error),
    });
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  if (!isAuthorized(req)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  try {
    const { data, error } = await supabase.rpc("get_daily_student_metrics_report");

    if (error) {
      throw new Error(`metrics_rpc_failed: ${safeText(error.message)}`);
    }

    const metrics = (data ?? {}) as MetricsReport;
    const text = formatReport(metrics);

    await sendTelegramMessage({
      botToken: IDC_METRICS_BOT_TOKEN,
      chatId: IDC_METRICS_CHAT_ID,
      text,
      timeoutMs: TELEGRAM_TIMEOUT_MS,
    });

    return jsonResponse({ ok: true, metrics });
  } catch (error) {
    const errorMessage = safeText(error);
    console.error("daily_metrics_report_failed", { errorMessage });

    await sendErrorAlert([
      "IDC daily metrics report failed",
      `error_message: ${errorMessage}`,
    ].join("\n"));

    return jsonResponse({ ok: false, error: "daily_metrics_report_failed", errorMessage }, 500);
  }
});
