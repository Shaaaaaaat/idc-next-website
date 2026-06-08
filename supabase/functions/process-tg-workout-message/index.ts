import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("EDGE_SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("EDGE_SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

function parseClients(value: string) {
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

function parseMessage(rawText: string) {
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

  if (placeCode === "park" || placeCode === "парк") {
    return {
      deliveryType: "park",
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

    const results = [];

    for (const item of parsed.clients) {
      const client = await findClientByFio(item.fio);

      const rpc = await supabase.rpc("create_scheduled_workout", {
        p_client_id: client.id,
        p_coach_handle: parsed.coachHandle,
        p_workout_date: parsed.workoutDate,
        p_training_format_slug: parsed.formatSlug,
        p_delivery_type: deliveryType,
        p_studio_slug: studioSlug,
        p_title: `TG quick charge: ${rawText.slice(0, 80)}`,
        p_people_count: 1,
        p_auto_charge: true,
      });

      if (rpc.error) throw rpc.error;

      results.push({
        fio: item.fio,
        client_id: client.id,
        result: rpc.data,
      });
    }

    await supabase
      .from("tg_workout_messages")
      .update({
        status: "processed",
        parsed_payload: parsed,
        result_payload: { results },
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