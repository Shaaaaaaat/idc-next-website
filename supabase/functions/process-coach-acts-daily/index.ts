import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("EDGE_SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("EDGE_SUPABASE_SERVICE_ROLE_KEY")!;
const IDC_ERRORS_BOT_TOKEN = Deno.env.get("IDC_ERRORS_BOT_TOKEN") ?? "";
const IDC_ERRORS_CHAT_ID = Deno.env.get("IDC_ERRORS_CHAT_ID") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const SEND_ACT_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/send-coach-act-to-n8n`;
const ALERT_TIMEOUT_MS = 5_000;

type WebhookType = "open" | "close";
type CurrentStage =
  | "close_rpc_done"
  | "close_n8n_sent"
  | "next_act_created"
  | "open_n8n_sent"
  | "finished_marked";

type CoachAct = {
  id: string;
  act_number: string | null;
  coach_handle: string | null;
  day_signed: string | null;
  period_end: string | null;
  status: string | null;
  n8n_open_sent_at: string | null;
  n8n_close_sent_at: string | null;
};

type WebhookLog = {
  delivery_status?: string | null;
  response_status?: number | null;
  error_code?: string | null;
  error_message?: string | null;
  created_at?: string | null;
};

class HaltActError extends Error {
  constructor(
    message: string,
    public readonly details: {
      act: CoachAct;
      webhookType?: WebhookType;
      currentStage?: CurrentStage;
      deliveryStatus?: string | null;
      responseStatus?: number | null;
      errorCode?: string | null;
    },
  ) {
    super(message);
    this.name = "HaltActError";
  }
}

function safeText(value: unknown, maxLength = 1_000) {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function logStage(currentStage: CurrentStage, act: CoachAct, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    current_stage: currentStage,
    act_id: act.id,
    act_number: act.act_number,
    coach_handle: act.coach_handle,
    ...extra,
  }));
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

async function alertActFailure(params: {
  currentStage?: CurrentStage;
  act: CoachAct;
  webhookType?: WebhookType;
  deliveryStatus?: string | null;
  responseStatus?: number | null;
  errorCode?: string | null;
  errorMessage: string;
}) {
  await sendErrorAlert([
    "IDC process coach acts daily error",
    `current_stage: ${params.currentStage || "unknown"}`,
    `act_id: ${params.act.id}`,
    `act_number: ${params.act.act_number || "-"}`,
    `coach_handle: ${params.act.coach_handle || "-"}`,
    `webhook_type: ${params.webhookType || "-"}`,
    `delivery_status: ${params.deliveryStatus || "-"}`,
    `response_status: ${params.responseStatus ?? "unknown"}`,
    `error_code: ${params.errorCode || "-"}`,
    `error_message: ${safeText(params.errorMessage)}`,
    "Do not retry before checking n8n execution history",
  ]);
}

async function latestWebhookLog(coachActId: string, webhookType: WebhookType): Promise<WebhookLog | null> {
  const { data, error } = await supabase
    .from("n8n_webhook_logs")
    .select("delivery_status, response_status, error_code, error_message, created_at")
    .eq("coach_act_id", coachActId)
    .eq("webhook_type", webhookType)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as WebhookLog | null) ?? null;
}

async function assertNoBlockedDelivery(
  act: CoachAct,
  webhookType: WebhookType,
  currentStage: CurrentStage,
) {
  const log = await latestWebhookLog(act.id, webhookType);

  if (log?.delivery_status === "delivery_unknown" || log?.delivery_status === "confirmed_failure") {
    throw new HaltActError(
      `n8n ${webhookType} delivery requires manual review: ${log.delivery_status}`,
      {
        act,
        webhookType,
        currentStage,
        deliveryStatus: log.delivery_status,
        responseStatus: log.response_status,
        errorCode: log.error_code,
      },
    );
  }
}

async function sendActToN8n(act: CoachAct, webhookType: WebhookType, currentStage: CurrentStage) {
  await assertNoBlockedDelivery(act, webhookType, currentStage);

  const res = await fetch(SEND_ACT_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      coach_act_id: act.id,
      webhook_type: webhookType,
    }),
  });

  const text = await res.text();
  let parsed: Record<string, unknown> = {};

  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }

  if (!res.ok) {
    throw new HaltActError(`send ${webhookType} failed: ${res.status} ${safeText(text)}`, {
      act,
      webhookType,
      currentStage,
      deliveryStatus: typeof parsed.delivery_status === "string" ? parsed.delivery_status : null,
      responseStatus: res.status,
      errorCode: typeof parsed.error_code === "string" ? parsed.error_code : null,
    });
  }

  return parsed;
}

async function findNextAct(previousAct: CoachAct): Promise<CoachAct | null> {
  if (!previousAct.period_end || !previousAct.coach_handle) return null;

  const nextStart = new Date(previousAct.period_end);
  nextStart.setUTCDate(nextStart.getUTCDate() + 1);
  const nextStartDate = nextStart.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("coach_acts")
    .select("id, act_number, coach_handle, day_signed, period_end, status, n8n_open_sent_at, n8n_close_sent_at")
    .eq("coach_handle", previousAct.coach_handle)
    .eq("period_start", nextStartDate)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as CoachAct | null) ?? null;
}

async function processAct(act: CoachAct) {
  let currentStage: CurrentStage | undefined;

  if (act.status !== "doc_act_created") {
    const closeResult = await supabase.rpc("close_coach_act", { p_act_id: act.id });
    if (closeResult.error) throw closeResult.error;
  }

  currentStage = "close_rpc_done";
  logStage(currentStage, act);

  if (!act.n8n_close_sent_at) {
    await sendActToN8n(act, "close", currentStage);
  }

  currentStage = "close_n8n_sent";
  logStage(currentStage, act, { webhook_type: "close" });

  let nextAct = await findNextAct(act);

  if (!nextAct) {
    const nextResult = await supabase.rpc("create_next_coach_act", {
      p_previous_act_id: act.id,
    });

    if (nextResult.error) throw nextResult.error;

    const newActId = nextResult.data?.new_act_id;
    if (!newActId) throw new Error(`new_act_id missing for ${act.act_number}`);

    const { data, error } = await supabase
      .from("coach_acts")
      .select("id, act_number, coach_handle, day_signed, period_end, status, n8n_open_sent_at, n8n_close_sent_at")
      .eq("id", newActId)
      .single();

    if (error) throw error;
    nextAct = data as CoachAct;
  }

  currentStage = "next_act_created";
  logStage(currentStage, act, { new_act_id: nextAct.id });

  if (!nextAct.n8n_open_sent_at) {
    await sendActToN8n(nextAct, "open", currentStage);
  }

  currentStage = "open_n8n_sent";
  logStage(currentStage, act, { webhook_type: "open", new_act_id: nextAct.id });

  const finishResult = await supabase
    .from("coach_acts")
    .update({
      status: "finished",
      updated_at: new Date().toISOString(),
    })
    .eq("id", act.id);

  if (finishResult.error) throw finishResult.error;

  currentStage = "finished_marked";
  logStage(currentStage, act, { new_act_id: nextAct.id });

  return {
    act_id: act.id,
    act_number: act.act_number,
    coach_handle: act.coach_handle,
    new_act_id: nextAct.id,
    current_stage: currentStage,
  };
}

Deno.serve(async () => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const { data: acts, error } = await supabase
      .from("coach_acts")
      .select("id, act_number, coach_handle, day_signed, period_end, status, n8n_open_sent_at, n8n_close_sent_at")
      .in("status", ["work", "doc_act_created"])
      .lte("day_signed", today)
      .order("day_signed", { ascending: true });

    if (error) throw error;

    const results = [];

    for (const act of (acts || []) as CoachAct[]) {
      try {
        results.push(await processAct(act));
      } catch (error) {
        if (error instanceof HaltActError) {
          await alertActFailure({
            currentStage: error.details.currentStage,
            act: error.details.act,
            webhookType: error.details.webhookType,
            deliveryStatus: error.details.deliveryStatus,
            responseStatus: error.details.responseStatus,
            errorCode: error.details.errorCode,
            errorMessage: error.message,
          });
        } else {
          await alertActFailure({
            act,
            errorMessage: safeText(error),
          });
        }

        throw error;
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      processed: results.length,
      results,
    }), {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: safeText(error),
    }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
