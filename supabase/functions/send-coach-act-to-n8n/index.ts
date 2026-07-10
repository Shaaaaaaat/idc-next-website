import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("EDGE_SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("EDGE_SUPABASE_SERVICE_ROLE_KEY")!;
const IDC_ERRORS_BOT_TOKEN = Deno.env.get("IDC_ERRORS_BOT_TOKEN") ?? "";
const IDC_ERRORS_CHAT_ID = Deno.env.get("IDC_ERRORS_CHAT_ID") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const WEBHOOK_TIMEOUT_MS = 20_000;
const ALERT_TIMEOUT_MS = 5_000;
const MAX_SAFE_TEXT = 1_000;

const WEBHOOKS = {
  open: "https://ivish.app.n8n.cloud/webhook/16ba1bc4-9c57-4ad1-833f-db640c7bbc91",
  close: "https://ivish.app.n8n.cloud/webhook/81bc14a0-6d4d-41ba-a8e4-53ecff7657d5",
};

type WebhookType = "open" | "close";
type DeliveryStatus = "confirmed_success" | "confirmed_failure" | "delivery_unknown";

type CoachAct = {
  id: string;
  act_number: string | null;
  coach_handle: string | null;
  period_start: string | null;
  period_end: string | null;
  day_signed: string | null;
  personal_people: number | null;
  personal_hours: number | null;
  group_people: number | null;
  group_hours: number | null;
  video_hours: number | null;
  video_hours_voice: number | null;
  master_people: number | null;
  smm_hours: number | null;
  total_hours: number | null;
  total_people: number | null;
  total_sum: number | null;
};

type DeliveryResult = {
  deliveryStatus: DeliveryStatus;
  responseStatus: number | null;
  responseBody: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "";

  const d = new Date(value);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();

  return `${dd}.${mm}.${yyyy}`;
}

function safeText(value: unknown, maxLength = MAX_SAFE_TEXT) {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function classifyHttpError(status: number) {
  if (status >= 500) return "n8n_http_5xx";
  if (status >= 400) return "n8n_http_4xx";
  return "n8n_http_error";
}

function classifyNetworkError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const message = safeText(error).toLowerCase();

  if (name === "AbortError" || message.includes("aborted") || message.includes("timeout")) {
    return "n8n_timeout_unconfirmed";
  }

  if (message.includes("connection reset") || message.includes("econnreset")) {
    return "n8n_connection_reset_unconfirmed";
  }

  return "n8n_network_unconfirmed";
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sendErrorAlert(lines: string[]) {
  if (!IDC_ERRORS_BOT_TOKEN || !IDC_ERRORS_CHAT_ID) return;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ALERT_TIMEOUT_MS);

  try {
    await fetch(`https://api.telegram.org/bot${IDC_ERRORS_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: IDC_ERRORS_CHAT_ID,
        text: lines.filter(Boolean).join("\n"),
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    console.warn("IDC alert delivery failed", safeText(error));
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildPayload(act: CoachAct, webhookType: WebhookType): Record<string, string> {
  const payload: Record<string, string> = {
    act_number: String(act.act_number || ""),
    coach: String(act.coach_handle || ""),
    period_start: formatDate(act.period_start),
    period_end: formatDate(act.period_end),
    personal_people: String(act.personal_people ?? 0),
    personal_hours: String(act.personal_hours ?? 0),
    group_people: String(act.group_people ?? 0),
    group_hours: String(act.group_hours ?? 0),
    video_hoursNo: String(act.video_hours ?? 0),
    video_hoursVoice: String(act.video_hours_voice ?? 0),
    master_people: String(act.master_people ?? 0),
    smm_hours: String(act.smm_hours ?? 0),
    total_hours: String(act.total_hours ?? 0),
    total_people: String(act.total_people ?? 0),
    total_sum: String(act.total_sum ?? 0),
  };

  if (webhookType === "close") {
    payload.day_signed = formatDate(act.day_signed);
  }

  return payload;
}

async function sendWebhookOnce(
  webhookUrl: string,
  payload: Record<string, string>,
): Promise<DeliveryResult> {
  try {
    const res = await fetchWithTimeout(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, WEBHOOK_TIMEOUT_MS);

    const responseBody = safeText(await res.text(), 2_000);

    if (res.ok) {
      return {
        deliveryStatus: "confirmed_success",
        responseStatus: res.status,
        responseBody,
        errorCode: null,
        errorMessage: null,
      };
    }

    return {
      deliveryStatus: "confirmed_failure",
      responseStatus: res.status,
      responseBody,
      errorCode: classifyHttpError(res.status),
      errorMessage: responseBody || `HTTP ${res.status}`,
    };
  } catch (error) {
    return {
      deliveryStatus: "delivery_unknown",
      responseStatus: null,
      responseBody: null,
      errorCode: classifyNetworkError(error),
      errorMessage: safeText(error),
    };
  }
}

async function writeWebhookLog(
  act: CoachAct,
  webhookType: WebhookType,
  webhookUrl: string,
  payload: Record<string, string>,
  result: DeliveryResult,
) {
  await supabase.from("n8n_webhook_logs").insert({
    coach_act_id: act.id,
    webhook_type: webhookType,
    webhook_url: webhookUrl,
    payload,
    response_status: result.responseStatus,
    response_body: result.responseBody,
    error_message: result.errorMessage,
    attempt_count: 1,
    delivery_status: result.deliveryStatus,
    error_code: result.errorCode,
  });
}

async function markSent(actId: string, webhookType: WebhookType) {
  const updatePayload = webhookType === "open"
    ? { n8n_open_sent_at: new Date().toISOString() }
    : { n8n_close_sent_at: new Date().toISOString() };

  const { error } = await supabase
    .from("coach_acts")
    .update(updatePayload)
    .eq("id", actId);

  if (error) throw error;
}

Deno.serve(async (req) => {
  let act: CoachAct | null = null;
  let webhookType: WebhookType | null = null;

  try {
    const body = await req.json();

    const coachActId = String(body.coach_act_id || "").trim();
    const rawWebhookType = String(body.webhook_type || "").trim().toLowerCase();

    if (!coachActId) {
      return new Response(JSON.stringify({ ok: false, error: "missing_coach_act_id" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    if (rawWebhookType !== "open" && rawWebhookType !== "close") {
      return new Response(JSON.stringify({ ok: false, error: "invalid_webhook_type" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    webhookType = rawWebhookType;
    const webhookUrl = WEBHOOKS[webhookType];

    const { data, error: actError } = await supabase
      .from("coach_acts")
      .select("*")
      .eq("id", coachActId)
      .single();

    if (actError) throw actError;
    if (!data) throw new Error("coach_act_not_found");

    act = data as CoachAct;
    const payload = buildPayload(act, webhookType);
    const result = await sendWebhookOnce(webhookUrl, payload);

    await writeWebhookLog(act, webhookType, webhookUrl, payload, result);

    if (result.deliveryStatus === "confirmed_success") {
      await markSent(act.id, webhookType);
    } else {
      await sendErrorAlert([
        "IDC n8n webhook delivery issue",
        `stage: send_coach_act_to_n8n`,
        `coach_act_id: ${act.id}`,
        `act_number: ${act.act_number || "-"}`,
        `coach_handle: ${act.coach_handle || "-"}`,
        `webhook_type: ${webhookType}`,
        `delivery_status: ${result.deliveryStatus}`,
        `response_status: ${result.responseStatus ?? "unknown"}`,
        `error_code: ${result.errorCode || "-"}`,
        `error_message: ${safeText(result.errorMessage) || "-"}`,
        "Do not retry before checking n8n execution history",
      ]);
    }

    return new Response(JSON.stringify({
      ok: result.deliveryStatus === "confirmed_success",
      webhook_type: webhookType,
      delivery_status: result.deliveryStatus,
      response_status: result.responseStatus,
      error_code: result.errorCode,
      error_message: result.errorMessage,
    }), {
      status: result.deliveryStatus === "confirmed_success" ? 200 : 502,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    const errorMessage = safeText(error);

    await sendErrorAlert([
      "IDC n8n webhook function error",
      `stage: send_coach_act_to_n8n`,
      `coach_act_id: ${act?.id || "unknown"}`,
      `act_number: ${act?.act_number || "-"}`,
      `coach_handle: ${act?.coach_handle || "-"}`,
      `webhook_type: ${webhookType || "unknown"}`,
      `delivery_status: delivery_unknown`,
      `error_message: ${errorMessage}`,
      "Do not retry before checking n8n execution history",
    ]);

    return new Response(JSON.stringify({
      ok: false,
      error: errorMessage,
    }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
