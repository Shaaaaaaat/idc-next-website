import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("EDGE_SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("EDGE_SUPABASE_SERVICE_ROLE_KEY")!;
const IDC_ERRORS_BOT_TOKEN = Deno.env.get("IDC_ERRORS_BOT_TOKEN") ?? "";
const IDC_ERRORS_CHAT_ID = Deno.env.get("IDC_ERRORS_CHAT_ID") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ALERT_TIMEOUT_MS = 5_000;
const SAMPLE_LIMIT = 10;

type QueryResult<T> = {
  rows: T[];
  count: number;
};

type ClientNotificationRow = {
  id: string;
  event_type: string | null;
  recipient_type: string | null;
  status: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string | null;
  last_attempt_at: string | null;
};

type TgWorkoutRow = {
  id: string;
  status: string | null;
  error_message: string | null;
  created_at: string | null;
  processed_at: string | null;
  raw_text?: string | null;
};

type N8nLogRow = {
  coach_act_id: string | null;
  webhook_type: string | null;
  response_status: number | null;
  delivery_status: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string | null;
};

type PgNetSummary = {
  failure_count: number | string | null;
  sample_ids: Array<number | string> | null;
  sample_status_codes: Array<number | null> | null;
  sample_errors: Array<string | null> | null;
};

type CronStatus = {
  jobname: string;
  schedule: string | null;
  active: boolean | null;
  job_exists: boolean | null;
};

function safeText(value: unknown, maxLength = 400) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function previewRawText(value: unknown) {
  return safeText(value, 160);
}

async function sendGroupedAlert(text: string) {
  if (!IDC_ERRORS_BOT_TOKEN || !IDC_ERRORS_CHAT_ID) {
    console.warn("IDC error bot env is not configured");
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ALERT_TIMEOUT_MS);

  try {
    await fetch(`https://api.telegram.org/bot${IDC_ERRORS_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: IDC_ERRORS_CHAT_ID,
        text,
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    console.warn("Hourly reliability alert delivery failed", safeText(error));
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchRows<T>(query: PromiseLike<{ data: unknown; error: unknown; count?: number | null }>): Promise<QueryResult<T>> {
  const { data, error, count } = await query;
  if (error) throw error;

  return {
    rows: (Array.isArray(data) ? data : []) as T[],
    count: count ?? (Array.isArray(data) ? data.length : 0),
  };
}

function sampleIds(rows: Array<{ id?: string | null }>) {
  return rows.map((row) => row.id).filter(Boolean).slice(0, SAMPLE_LIMIT).join(", ");
}

function sampleN8n(rows: N8nLogRow[]) {
  return rows
    .slice(0, SAMPLE_LIMIT)
    .map((row) => [
      row.coach_act_id || "unknown",
      row.webhook_type || "-",
      row.delivery_status || "-",
      row.response_status ?? "unknown",
      safeText(row.error_code || row.error_message || "-", 120),
    ].join(" | "))
    .join("; ");
}

function sampleTg(rows: TgWorkoutRow[]) {
  return rows
    .slice(0, SAMPLE_LIMIT)
    .map((row) => `${row.id}: ${safeText(row.error_message || previewRawText(row.raw_text), 120)}`)
    .join("; ");
}

function samplePgNet(summary: PgNetSummary | null) {
  if (!summary?.sample_ids?.length) return "";

  return summary.sample_ids
    .slice(0, SAMPLE_LIMIT)
    .map((id, index) => {
      const status = summary.sample_status_codes?.[index] ?? "unknown";
      const error = safeText(summary.sample_errors?.[index] || "", 120);
      return `${id}: ${status}${error ? ` ${error}` : ""}`;
    })
    .join("; ");
}

Deno.serve(async () => {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const recentCutoff = new Date(now.getTime() - 65 * 60 * 1000).toISOString();

  try {
    const [
      clientStale,
      clientFailed,
      tgStale,
      tgErrors,
      n8nConfirmedFailures,
      n8nDeliveryUnknown,
      pgNetSummaryResult,
      cronStatusResult,
    ] = await Promise.all([
      fetchRows<ClientNotificationRow>(
        supabase
          .from("client_notification_events")
          .select("id, event_type, recipient_type, status, error_code, error_message, created_at, last_attempt_at", { count: "exact" })
          .in("status", ["pending", "processing"])
          .lt("created_at", staleCutoff)
          .order("created_at", { ascending: true })
          .range(0, SAMPLE_LIMIT - 1),
      ),
      fetchRows<ClientNotificationRow>(
        supabase
          .from("client_notification_events")
          .select("id, event_type, recipient_type, status, error_code, error_message, created_at, last_attempt_at", { count: "exact" })
          .eq("status", "failed")
          .gte("created_at", recentCutoff)
          .order("created_at", { ascending: false })
          .range(0, SAMPLE_LIMIT - 1),
      ),
      fetchRows<TgWorkoutRow>(
        supabase
          .from("tg_workout_messages")
          .select("id, status, error_message, created_at, processed_at, raw_text", { count: "exact" })
          .eq("status", "processing")
          .lt("created_at", staleCutoff)
          .order("created_at", { ascending: true })
          .range(0, SAMPLE_LIMIT - 1),
      ),
      fetchRows<TgWorkoutRow>(
        supabase
          .from("tg_workout_messages")
          .select("id, status, error_message, created_at, processed_at, raw_text", { count: "exact" })
          .eq("status", "error")
          .gte("created_at", recentCutoff)
          .order("created_at", { ascending: false })
          .range(0, SAMPLE_LIMIT - 1),
      ),
      fetchRows<N8nLogRow>(
        supabase
          .from("n8n_webhook_logs")
          .select("coach_act_id, webhook_type, response_status, delivery_status, error_code, error_message, created_at", { count: "exact" })
          .eq("delivery_status", "confirmed_failure")
          .gte("created_at", recentCutoff)
          .order("created_at", { ascending: false })
          .range(0, SAMPLE_LIMIT - 1),
      ),
      fetchRows<N8nLogRow>(
        supabase
          .from("n8n_webhook_logs")
          .select("coach_act_id, webhook_type, response_status, delivery_status, error_code, error_message, created_at", { count: "exact" })
          .eq("delivery_status", "delivery_unknown")
          .gte("created_at", recentCutoff)
          .order("created_at", { ascending: false })
          .range(0, SAMPLE_LIMIT - 1),
      ),
      supabase.rpc("reliability_monitor_pg_net_failure_summary", {
        p_since: recentCutoff,
        p_limit: SAMPLE_LIMIT,
      }),
      supabase.rpc("reliability_monitor_cron_job_status"),
    ]);

    if (pgNetSummaryResult.error) throw pgNetSummaryResult.error;
    if (cronStatusResult.error) throw cronStatusResult.error;

    const pgNetSummary = Array.isArray(pgNetSummaryResult.data) && pgNetSummaryResult.data.length
      ? pgNetSummaryResult.data[0] as PgNetSummary
      : null;
    const cronRows = (Array.isArray(cronStatusResult.data) ? cronStatusResult.data : []) as CronStatus[];
    const cronProblems = cronRows.filter((row) => row.job_exists !== true || row.active !== true);

    const pgNetFailureCount = Number(pgNetSummary?.failure_count ?? 0);
    const hasProblems = [
      clientStale.count,
      clientFailed.count,
      tgStale.count,
      tgErrors.count,
      n8nConfirmedFailures.count,
      n8nDeliveryUnknown.count,
      pgNetFailureCount,
      cronProblems.length,
    ].some((count) => count > 0);

    if (!hasProblems) {
      return new Response(JSON.stringify({ ok: true, problems: false }), {
        headers: { "content-type": "application/json" },
      });
    }

    const lines = [
      "IDC Hourly Reliability Alert",
      "",
      "client_notification_events:",
      `- stale: ${clientStale.count}`,
      `- failed last hour: ${clientFailed.count}`,
      clientStale.rows.length ? `  stale ids: ${sampleIds(clientStale.rows)}` : "",
      clientFailed.rows.length ? `  failed ids: ${sampleIds(clientFailed.rows)}` : "",
      "",
      "tg_workout_messages:",
      `- stale processing: ${tgStale.count}`,
      `- errors last hour: ${tgErrors.count}`,
      tgStale.rows.length ? `  stale ids: ${sampleIds(tgStale.rows)}` : "",
      tgErrors.rows.length ? `  error samples: ${sampleTg(tgErrors.rows)}` : "",
      "",
      "n8n:",
      `- confirmed failures last hour: ${n8nConfirmedFailures.count}`,
      `- delivery unknown last hour: ${n8nDeliveryUnknown.count}`,
      n8nConfirmedFailures.rows.length ? `  confirmed failure samples: ${sampleN8n(n8nConfirmedFailures.rows)}` : "",
      n8nDeliveryUnknown.rows.length ? `  delivery unknown samples: ${sampleN8n(n8nDeliveryUnknown.rows)}` : "",
      "",
      "pg_net:",
      `- HTTP/network failures last hour: ${pgNetFailureCount}`,
      pgNetFailureCount > 0 ? `  samples: ${samplePgNet(pgNetSummary)}` : "",
      "",
      "cron:",
      `- missing/disabled jobs: ${cronProblems.length}`,
      cronProblems.length
        ? `  jobs: ${cronProblems.map((row) => `${row.jobname}:${row.job_exists ? "disabled" : "missing"}`).slice(0, SAMPLE_LIMIT).join(", ")}`
        : "",
    ].filter(Boolean);

    await sendGroupedAlert(lines.join("\n"));

    return new Response(JSON.stringify({
      ok: true,
      problems: true,
      counts: {
        client_notification_stale: clientStale.count,
        client_notification_failed_last_hour: clientFailed.count,
        tg_workout_stale_processing: tgStale.count,
        tg_workout_errors_last_hour: tgErrors.count,
        n8n_confirmed_failures_last_hour: n8nConfirmedFailures.count,
        n8n_delivery_unknown_last_hour: n8nDeliveryUnknown.count,
        pg_net_failures_last_hour: pgNetFailureCount,
        cron_missing_disabled: cronProblems.length,
      },
    }), {
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    await sendGroupedAlert([
      "IDC Hourly Reliability Alert",
      "",
      "monitor_error:",
      safeText(error, 1000),
    ].join("\n"));

    return new Response(JSON.stringify({
      ok: false,
      error: safeText(error),
    }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
