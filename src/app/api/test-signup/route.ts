// src/app/api/test-signup/route.ts
import { NextRequest } from "next/server";
import { createLeadInSupabase } from "@/lib/supabase/leads";

// const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const TELEGRAM_BOT_TOKEN = "8296311202:AAF3AxSnjJKuCu4d5bE0VrShlvq1kJRnKAo";
const TELEGRAM_CHAT_ID = -5033595956;

export async function POST(req: NextRequest) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return new Response("Telegram config is missing", { status: 500 });
  }

  const body = await req.json();
  const fullName = body.fullName ?? "";
  const email = String(body.email || "").trim().toLowerCase();
  const context = body.context ?? "";

  const text =
    `📝 Новая заявка на тест силы\n\n` +
    `👤 Имя: ${fullName || "-"}\n` +
    `📧 Email: ${email || "-"}\n` +
    (context ? `📌 Источник: ${context}\n` : "");

  const tgRes = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
      }),
    }
  );

  if (!tgRes.ok) {
    const msg = await tgRes.text();
    console.error("Telegram error", msg);
    return new Response("Telegram error", { status: 500 });
  }

  await createLeadInSupabase({
    fio: String(fullName || "").trim(),
    phone: "",
    email: email || undefined,
    product: "power_test",
    source: String(context || "site").trim() || "site",
    raw_payload: body,
  });

  return new Response("ok");
}
