// src/app/api/create-payment/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";

function generatePaymentLink(paymentId: number | string, sum: number, email: string) {
  const shopId = process.env.ROBO_ID;      // MerchantLogin
  const secretKey1 = process.env.ROBO_SECRET1; // Secret Key 1

  if (!shopId || !secretKey1) {
    throw new Error("ROBO_ID или ROBO_SECRET1 не заданы в .env");
  }

  // Робокасса ожидает строку с точкой как разделителем, лучше фиксировать 2 знака
  const sumString = Number(sum).toFixed(2);

  const signature = crypto
    .createHash("md5")
    .update(`${shopId}:${sumString}:${paymentId}:${secretKey1}`)
    .digest("hex");

  const url =
    `https://auth.robokassa.ru/Merchant/Index.aspx` +
    `?MerchantLogin=${shopId}` +
    `&OutSum=${encodeURIComponent(sumString)}` +
    `&InvId=${encodeURIComponent(String(paymentId))}` +
    `&SignatureValue=${signature}` +
    `&Email=${encodeURIComponent(email)}` +
    `&IsTest=0`;

  return url;
}

/* ---------------- TELEGRAM HELPERS ---------------- */
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID_RAW = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_CHAT_ID = TELEGRAM_CHAT_ID_RAW ? Number(TELEGRAM_CHAT_ID_RAW) : NaN;

function escapeTgHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendTelegramMessage(text: string) {
  if (!TELEGRAM_BOT_TOKEN || !Number.isFinite(TELEGRAM_CHAT_ID)) {
    // нет конфигурации — тихо пропускаем
    return { ok: false as const, reason: "env_missing" as const };
  }

  const r = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      cache: "no-store",
    }
  );

  if (!r.ok) {
    const msg = await r.text();
    console.error("Telegram error", msg);
    return { ok: false as const, reason: "send_failed" as const, msg };
  }

  return { ok: true as const };
}

/* ---------------- AIRTABLE HELPERS ---------------- */
function airtableEnv() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const table = process.env.AIRTABLE_PURCHASE_WEBSITE_TABLE;
  if (!apiKey || !baseId || !table) {
    return { ok: false as const, apiKey: "", baseId: "", table: "" };
  }
  return { ok: true as const, apiKey, baseId, table };
}

function airtableBaseUrl(env: { baseId: string; table: string }) {
  return `https://api.airtable.com/v0/${env.baseId}/${encodeURIComponent(env.table)}`;
}

async function airtableCreateRecord(fields: Record<string, any>) {
  const env = airtableEnv();
  if (!env.ok) return { ok: false as const, reason: "env_missing" as const };
  const url = airtableBaseUrl(env);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
      cache: "no-store",
    });
    const text = await r.text();
    if (!r.ok) {
      return { ok: false as const, reason: "create_failed" as const, status: r.status, text };
    }
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { ok: true as const, record: json ?? text };
  } catch (err) {
    console.error("💥 Airtable CREATE crashed:", err);
    return { ok: false as const, reason: "create_crashed" as const };
  }
}

/* ---------------- YDB CF (RU-first) ---------------- */
async function postToYdbCF(payload: {
  name: string;
  phone: string;
  email?: string;
  notes?: string;
}) {
  const url = process.env.YDB_CF_URL;
  if (!url) {
    return { ok: false as const, reason: "cf_url_missing" as const };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000); // 7s
  try {
    const internalToken = process.env.CF_INTERNAL_TOKEN;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const bodyWithToken = internalToken ? { ...payload, token: internalToken } : payload;
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(bodyWithToken),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    const text = await r.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    if (!r.ok || !json?.ok) {
      return {
        ok: false as const,
        reason: "cf_failed" as const,
        status: r.status,
        text,
      };
    }
    return { ok: true as const, ydb_id: json?.ydb_id ?? null };
  } catch (e: any) {
    clearTimeout(timer);
    return { ok: false as const, reason: "cf_crashed" as const, error: e?.message };
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      amount,
      currency,
      email,
      fullName,
      courseName,
      tariffId,
      tariffLabel,
      // studioName — опционально
      studioName,
      // trial booking extras
      slotStartAt,
      studioId,
    } = body as {
      amount: number;
      currency: "RUB" | "EUR";
      email: string;
      fullName: string;
      courseName: string;
      tariffId: string;
      tariffLabel: string;
      studioName?: string | null;
      slotStartAt?: string | null; // ISO, e.g. "2026-02-08T12:00:00+03:00"
      studioId?: string | null; // e.g. "msk_oktyabrskaya"
    };

    if (!amount || !email || !fullName || !tariffId) {
      return NextResponse.json(
        { error: "Не хватает данных для оплаты" },
        { status: 400 }
      );
    }

    // paymentId — можно заменить на id из базы, если будешь сохранять заказы
    const paymentId = Date.now();

    const paymentUrl = generatePaymentLink(paymentId, amount, email);

    // RU-first: Cloud Function (покупка)
    const cfRes = await postToYdbCF({
      name: fullName,
      phone: body?.phone ?? "",
      email,
      notes: "покупка",
    });

    // Сохраняем заказ в Airtable (status=created) и генерим tg-токен для success-страницы
    const tgToken = crypto.randomBytes(16).toString("hex");
    // Helpers for studio Tag mapping
    function mapStudioToCityCode(id?: string | null) {
      if (!id) return null;
      if (id.startsWith("msk")) return "MSC";
      if (id.startsWith("spb")) return "SPB";
      return null;
    }
    function mapStudioToGymCode(id?: string | null) {
      switch (id) {
        case "msk_youcan":
          return "YCG";
        case "msk_elfit":
          return "ELF";
        case "spb_spirit":
          return "SPI";
        case "spb_hkc":
          return "HKC";
        default:
          return null;
      }
    }
    function detectGroupOrPersonal(label?: string | null) {
      const l = String(label || "");
      return /персонал/i.test(l) ? "personal" : "group";
    }
    // If studio purchase, build specific Tag; else fallback to tariffId
    let finalTag: string = tariffId;
    const cityCode = mapStudioToCityCode(studioId);
    const gymCode = mapStudioToGymCode(studioId);
    if (cityCode && gymCode) {
      const kind = detectGroupOrPersonal(tariffLabel);
      finalTag = `${cityCode}_${kind}_${gymCode}`;
    }

    // Lessons for trial (studio probation): 1
    const isTrialStudio =
      !!studioId && (/пробн/i.test(String(tariffLabel)) || tariffId === "review");
    const lessonsField = isTrialStudio ? 1 : undefined;
    const formatField = isTrialStudio ? "gym" : "ds";

    const createRes = await airtableCreateRecord({
      id_payment: String(paymentId),
      Status: "created",
      email: email,
      FIO: fullName,
      Phone: body?.phone ?? "",
      Sum: Number(amount),
      Currency: currency,
      Tag: finalTag,
      tariff_label: tariffLabel,
      course_name: courseName ?? "",
      studio_name: studioName ?? "",
      studio_id: studioId ?? "",
      slot_start_at: slotStartAt ?? "",
      ...(typeof lessonsField === "number" ? { Lessons: lessonsField } : {}),
      // RU-first flags
      ru_first_ok: (cfRes as any)?.ok === true,
      ydb_id: (cfRes as any)?.ydb_id ?? "",
      ydb_error:
        (cfRes as any)?.ok === true
          ? ""
          : `${(cfRes as any)?.reason ?? "unknown"}${(cfRes as any)?.status ? `:${(cfRes as any).status}` : ""}`,
      format: formatField,
      tg_link_token: tgToken,
    });
    if (!(createRes as any)?.ok) {
      console.warn("⚠️ Airtable create failed or disabled", createRes);
    }

    // Уведомление в TG о создании счета (необязательно)
    await sendTelegramMessage(
      `<b>🧾 Создан счёт</b>\n` +
        `<b>InvId:</b> <code>${escapeTgHtml(String(paymentId))}</code>\n` +
        `<b>Плательщик:</b> ${escapeTgHtml(fullName)}\n` +
        `<b>Сумма:</b> ${escapeTgHtml(Number(amount).toFixed(2))} ${currency}\n` +
        `<b>Тариф:</b> ${escapeTgHtml(tariffLabel)}`
    ).catch(() => {});

    return NextResponse.json({ paymentUrl });
  } catch (error) {
    console.error("Ошибка в create-payment:", error);
    return NextResponse.json(
      { error: "Ошибка на сервере при создании оплаты" },
      { status: 500 }
    );
  }
}
