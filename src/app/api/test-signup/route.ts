// src/app/api/test-signup/route.ts
import { NextRequest } from "next/server";
import { createLeadInSupabase } from "@/lib/supabase/leads";
import { sendTelegramWithRetry } from "@/lib/telegram/sendTelegramWithRetry";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID_RAW = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_CHAT_ID = TELEGRAM_CHAT_ID_RAW ? Number(TELEGRAM_CHAT_ID_RAW) : NaN;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const fullName = body.fullName ?? "";
  const email = String(body.email || "").trim().toLowerCase();
  const context = body.context ?? "";

  await createLeadInSupabase({
    fio: String(fullName || "").trim(),
    phone: "",
    email: email || undefined,
    product: "power_test",
    source: String(context || "site").trim() || "site",
    raw_payload: body,
  });

  const text =
    `📝 Новая заявка на тест силы\n\n` +
    `👤 Имя: ${fullName || "-"}\n` +
    `📧 Email: ${email || "-"}\n` +
    (context ? `📌 Источник: ${context}\n` : "");

  await sendTelegramWithRetry({
    botToken: TELEGRAM_BOT_TOKEN,
    chatId: TELEGRAM_CHAT_ID,
    text,
    disableWebPagePreview: false,
    logContext: {
      target: "admin",
      source: "test-signup",
    },
  });

  return new Response("ok");
}
