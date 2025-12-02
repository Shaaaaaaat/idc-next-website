// src/app/api/support-chat/route.ts
import { NextRequest, NextResponse } from "next/server";

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

export async function POST(req: NextRequest) {
  if (!N8N_WEBHOOK_URL) {
    return NextResponse.json(
      { error: "N8N_WEBHOOK_URL не настроен" },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const { message, history } = body as {
      message: string;
      history?: { role: "user" | "bot"; text: string }[];
    };

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Поле message обязательно" },
        { status: 400 }
      );
    }

    const n8nRes = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history: history ?? [],
      }),
    });

    if (!n8nRes.ok) {
      const text = await n8nRes.text();
      console.error("Ошибка от n8n:", n8nRes.status, text);
      return NextResponse.json(
        { error: "Ошибка на стороне бота поддержки" },
        { status: 502 }
      );
    }

    const data = await n8nRes.json();

    return NextResponse.json({
      reply:
        (data &&
          (data.reply ||
            data.answer ||
            data.text ||
            data.output)) ??
        "Бот не прислал ответа. Попробуй ещё раз.",
    });
  } catch (error) {
    console.error("Ошибка в /api/support-chat:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
