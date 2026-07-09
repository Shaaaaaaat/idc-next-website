import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("EDGE_SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("EDGE_SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const ERROR_ALERT_TIMEOUT_MS = 20_000;
const ERROR_ALERT_MAX_ATTEMPTS = 2;
const CLIENT_PROCESSING_MAX_ATTEMPTS = 3;
const CLIENT_PROCESSING_RETRY_DELAYS_MS = [750, 1_500];

type ParsedClient = {
  fio: string;
  count: number;
};

type ProcessingError = {
  fio: string;
  error: string;
};

type ProcessingResult = {
  fio: string;
  client_id: string;
  include_expenses: boolean;
  attempts?: number;
  recovered_from_existing?: boolean;
  result: unknown;
};

type ParsedMessage = {
  coachHandle: string;
  workoutDate: string;
  formatSlug: string;
  placeCode: string | null;
  clients: ParsedClient[];
};

type ResolvedDeliveryAndStudio = {
  deliveryType: string;
  studioSlug: string | null;
};

type ClientRow = {
  id: string;
  fio: string;
  email?: string | null;
};

type ExistingWorkoutMatch = {
  scheduled_workout_id: string;
  charge_status: string | null;
  transaction_count: number;
  earning_count: number;
};

const STUDIO_MAP: Record<string, string> = {
  elfit: "msk-oktyabrskaya",
  october: "msk-oktyabrskaya",

  ycg: "msk-ulitsa-1905-goda",
  youcan: "msk-ulitsa-1905-goda",

  spi: "spb-moskovskie-vorota",
  spirit: "spb-moskovskie-vorota",

  hkc: "spb-vyborgskaya",
  hellskitchen: "spb-vyborgskaya",
};

function parseDate(value: string): string {
  const [dd, mm] = value.trim().split(".");
  const year = new Date().getFullYear();
  return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function parseClients(value: string): ParsedClient[] {
  return value
    .split(",")
    .map((raw) => raw.trim())
    .filter(Boolean)
    .flatMap((raw) => {
      const match = raw.match(/^(\d+)x\s+(.+)$/i);
      if (!match) return [{ fio: raw, count: 1 }];

      const count = Number(match[1]);
      const fio = match[2].trim();

      return Array.from({ length: count }, () => ({ fio, count: 1 }));
    });
}

function parseMessage(rawText: string): ParsedMessage {
  const normalized = rawText.replace(/\s+/g, " ").trim();

  const parts = normalized.includes("//")
    ? normalized.split("//")
    : normalized.split("/");

  if (normalized.includes("//")) {
    const left = parts[0].split("/").map((p) => p.trim()).filter(Boolean);
    const clientsText = parts.slice(1).join("//").trim();

    if (left.length < 3) {
      throw new Error("Invalid message format");
    }

    return {
      coachHandle: left[0],
      workoutDate: parseDate(left[1]),
      formatSlug: left[2].toLowerCase(),
      placeCode: null,
      clients: parseClients(clientsText),
    };
  }

  const cleanParts = normalized.split("/").map((p) => p.trim()).filter(Boolean);

  if (cleanParts.length < 4) {
    throw new Error("Invalid message format");
  }

  const [coachHandle, dateRaw, formatRaw, placeRaw, clientsRaw] = cleanParts;

  return {
    coachHandle,
    workoutDate: parseDate(dateRaw),
    formatSlug: formatRaw.toLowerCase(),
    placeCode: placeRaw?.toLowerCase() || null,
    clients: parseClients(clientsRaw || ""),
  };
}

function resolveDeliveryAndStudio(formatSlug: string, placeCode: string | null) {
  if (formatSlug === "ds") {
    return {
      deliveryType: "online",
      studioSlug: null,
    };
  }

  if (
    placeCode === "open" ||
    placeCode === "опен" ||
    placeCode === "park" ||
    placeCode === "парк"
  ) {
    return {
      deliveryType: "open",
      studioSlug: null,
    };
  }

  const studioSlug = placeCode ? STUDIO_MAP[placeCode] : null;

  if (!studioSlug) {
    throw new Error(`Unknown studio/place: ${placeCode}`);
  }

  return {
    deliveryType: "gym",
    studioSlug,
  };
}

async function findClientByFio(fio: string) {
  const exact = await supabase
    .from("clients")
    .select("id, fio, email")
    .ilike("fio", fio)
    .limit(2);

  if (exact.error) throw exact.error;

  if ((exact.data || []).length === 1) {
    return exact.data![0];
  }

  if ((exact.data || []).length > 1) {
    throw new Error(`Multiple clients found for: ${fio}`);
  }

  const partial = await supabase
    .from("clients")
    .select("id, fio, email")
    .ilike("fio", `%${fio}%`)
    .limit(2);

  if (partial.error) throw partial.error;

  if ((partial.data || []).length === 1) {
    return partial.data![0];
  }

  if ((partial.data || []).length > 1) {
    throw new Error(`Multiple partial clients found for: ${fio}`);
  }

  throw new Error(`Client not found: ${fio}`);
}

function isNonRetryableProcessingError(message: string) {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("client not found") ||
    normalized.includes("multiple clients found") ||
    normalized.includes("multiple partial clients found") ||
    normalized.includes("studio_not_found") ||
    normalized.includes("training_format_not_found")
  );
}

function isTransientProcessingError(message: string) {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("522") ||
    normalized.includes("connection timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("fetch failed") ||
    normalized.includes("cloudflare") ||
    normalized.includes("aborterror") ||
    normalized.includes("network")
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : JSON.stringify(error);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recoveryTitle(rawText: string) {
  return `TG quick charge: ${rawText.slice(0, 80)}`;
}

async function findMatchingWorkout(
  params: {
    clientId: string;
    parsed: ParsedMessage;
    resolved: ResolvedDeliveryAndStudio;
    title: string;
  },
): Promise<ExistingWorkoutMatch | null> {
  const coach = await supabase
    .from("coach_profiles")
    .select("id")
    .eq("coach_name", params.parsed.coachHandle)
    .limit(1)
    .maybeSingle();

  if (coach.error || !coach.data?.id) return null;

  const format = await supabase
    .from("training_formats")
    .select("id")
    .eq("slug", params.parsed.formatSlug)
    .limit(1)
    .maybeSingle();

  if (format.error || !format.data?.id) return null;

  let studioId: string | null = null;
  if (params.resolved.studioSlug) {
    const studio = await supabase
      .from("studios")
      .select("id")
      .eq("slug", params.resolved.studioSlug)
      .limit(1)
      .maybeSingle();

    if (studio.error || !studio.data?.id) return null;
    studioId = studio.data.id;
  }

  const start = `${params.parsed.workoutDate}T00:00:00.000Z`;
  const nextDate = new Date(`${params.parsed.workoutDate}T00:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const end = nextDate.toISOString();

  let query = supabase
    .from("scheduled_workouts")
    .select("id, charge_status")
    .eq("client_id", params.clientId)
    .eq("coach_id", coach.data.id)
    .eq("training_format_id", format.data.id)
    .eq("delivery_type", params.resolved.deliveryType)
    .eq("title", params.title)
    .gte("scheduled_at", start)
    .lt("scheduled_at", end)
    .limit(1);

  query = studioId
    ? query.eq("studio_id", studioId)
    : query.is("studio_id", null);

  const workout = await query.maybeSingle();

  if (workout.error || !workout.data?.id) return null;

  const transactions = await supabase
    .from("client_transactions")
    .select("id", { count: "exact", head: true })
    .eq("source_type", "scheduled_workout")
    .eq("source_id", workout.data.id);

  const earnings = await supabase
    .from("coach_earnings")
    .select("id", { count: "exact", head: true })
    .eq("scheduled_workout_id", workout.data.id);

  return {
    scheduled_workout_id: workout.data.id,
    charge_status: workout.data.charge_status,
    transaction_count: transactions.count ?? 0,
    earning_count: earnings.count ?? 0,
  };
}

async function processClientWithRetry(
  params: {
    item: ParsedClient;
    parsed: ParsedMessage;
    resolved: ResolvedDeliveryAndStudio;
    rawText: string;
    accountingOnly: boolean;
    includeExpenses: boolean;
  },
): Promise<ProcessingResult> {
  const client = await findClientByFio(params.item.fio) as ClientRow;
  const title = recoveryTitle(params.rawText);
  let lastError = "not_sent";

  for (let attempt = 1; attempt <= CLIENT_PROCESSING_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      const existing = await findMatchingWorkout({
        clientId: client.id,
        parsed: params.parsed,
        resolved: params.resolved,
        title,
      });

      if (existing) {
        return {
          fio: params.item.fio,
          client_id: client.id,
          include_expenses: params.includeExpenses,
          attempts: attempt - 1,
          recovered_from_existing: true,
          result: {
            ok: true,
            status: "already_created_after_transient_error",
            scheduled_workout_id: existing.scheduled_workout_id,
            charge_status: existing.charge_status,
            transaction_count: existing.transaction_count,
            earning_count: existing.earning_count,
          },
        };
      }
    }

    try {
      const rpc = await supabase.rpc("create_scheduled_workout", {
        p_client_id: client.id,
        p_coach_handle: params.parsed.coachHandle,
        p_workout_date: params.parsed.workoutDate,
        p_training_format_slug: params.parsed.formatSlug,
        p_delivery_type: params.resolved.deliveryType,
        p_studio_slug: params.resolved.studioSlug,
        p_title: title,
        p_people_count: 1,
        p_auto_charge: !params.accountingOnly,
        p_include_expenses: params.includeExpenses,
      });

      if (rpc.error) throw rpc.error;

      if (params.accountingOnly && rpc.data?.scheduled_workout_id) {
        const accountingRpc = await supabase.rpc("create_workout_accounting_only", {
          p_scheduled_workout_id: rpc.data.scheduled_workout_id,
        });

        if (accountingRpc.error) throw accountingRpc.error;
      }

      return {
        fio: params.item.fio,
        client_id: client.id,
        include_expenses: params.includeExpenses,
        attempts: attempt,
        result: rpc.data,
      };
    } catch (error) {
      lastError = errorMessage(error);

      if (
        isNonRetryableProcessingError(lastError) ||
        !isTransientProcessingError(lastError) ||
        attempt === CLIENT_PROCESSING_MAX_ATTEMPTS
      ) {
        break;
      }

      await sleep(CLIENT_PROCESSING_RETRY_DELAYS_MS[attempt - 1] ?? 1_500);
    }
  }

  throw new Error(lastError);
}

async function sendErrorToTelegram(text: string) {
  const token = Deno.env.get("IDC_ERRORS_BOT_TOKEN");
  const chatId = Deno.env.get("IDC_ERRORS_CHAT_ID");

  if (!token || !chatId) {
    console.warn("IDC error bot env is not configured");
    return;
  }

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= ERROR_ALERT_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ERROR_ALERT_TIMEOUT_MS);

    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text,
        }),
        signal: controller.signal,
      });

      if (response.ok) return;

      lastError = `Telegram alert failed with status ${response.status}`;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  console.warn("IDC error alert delivery failed", lastError);
}

Deno.serve(async (req) => {
  let messageId: string | null = null;

  try {
    const expectedSecret = Deno.env.get("TG_WORKOUT_BOT_SECRET");
    const providedSecret = req.headers.get("x-bot-secret");

    if (!expectedSecret || providedSecret !== expectedSecret) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "unauthorized",
        }),
        {
          status: 401,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }

    const body = await req.json();

    const rawText = String(body.raw_text || "").trim();

    if (!rawText) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "missing_raw_text",
        }),
        {
          status: 400,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }

    const insertMessage = await supabase
      .from("tg_workout_messages")
      .insert({
        raw_text: rawText,
        telegram_message_id: body.telegram_message_id ? String(body.telegram_message_id) : null,
        telegram_chat_id: body.telegram_chat_id ? String(body.telegram_chat_id) : null,
        telegram_user_id: body.telegram_user_id ? String(body.telegram_user_id) : null,
        telegram_username: body.telegram_username ? String(body.telegram_username) : null,
        status: "processing",
      })
      .select("id")
      .single();

    if (insertMessage.error) throw insertMessage.error;

    messageId = insertMessage.data.id;

    const parsed = parseMessage(rawText);
    const { deliveryType, studioSlug } = resolveDeliveryAndStudio(
      parsed.formatSlug,
      parsed.placeCode,
    );

    const results: ProcessingResult[] = [];
    const unmatched: ProcessingError[] = [];
    const errors: ProcessingError[] = [];
    const isSplitMultiClient = parsed.formatSlug === "split" && parsed.clients.length > 1;

    for (const [index, item] of parsed.clients.entries()) {
      const includeExpenses = !isSplitMultiClient || index === 0;

      try {
        const result = await processClientWithRetry({
          item,
          parsed,
          resolved: { deliveryType, studioSlug },
          rawText,
          accountingOnly: Boolean(body.accounting_only),
          includeExpenses,
        });

        results.push(result);
      } catch (error) {
        const message = errorMessage(error);

        const errorItem = {
          fio: item.fio,
          error: message,
        };

        if (message.toLowerCase().includes("client not found")) {
          unmatched.push(errorItem);
        } else {
          errors.push(errorItem);
        }
      }
    }

    if (unmatched.length || errors.length) {
      await sendErrorToTelegram(
        [
          "⚠️ Ошибки списания тренировки",
          "",
          `Тренер: ${parsed.coachHandle}`,
          `Дата: ${parsed.workoutDate}`,
          `Формат: ${parsed.formatSlug}`,
          `Место: ${parsed.placeCode || "-"}`,
          "",
          unmatched.length
            ? [
                "Не найдены клиенты:",
                ...unmatched.map((x) => `• ${x.fio} — ${x.error}`),
              ].join("\n")
            : "",
          errors.length
            ? [
                "Ошибки обработки:",
                ...errors.map((x) => `• ${x.fio} — ${x.error}`),
              ].join("\n")
            : "",
          "",
          "Исходное сообщение:",
          rawText,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    await supabase
      .from("tg_workout_messages")
      .update({
        status: "processed",
        parsed_payload: parsed,
        result_payload: { results, unmatched, errors },
        processed_at: new Date().toISOString(),
      })
      .eq("id", messageId);

    return new Response(
      JSON.stringify({
        ok: true,
        processed: results.length,
        results,
      }),
      { headers: { "content-type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : JSON.stringify(error, null, 2);

    if (messageId) {
      await supabase
        .from("tg_workout_messages")
        .update({
          status: "error",
          error_message: message,
          processed_at: new Date().toISOString(),
        })
        .eq("id", messageId);
    }

    return new Response(
      JSON.stringify({
        ok: false,
        error: message,
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
});
