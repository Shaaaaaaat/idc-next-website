// src/app/api/create-payment/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { upsertPurchaseCreated } from "@/lib/supabase/purchases";
import { sendTelegramWithRetry } from "@/lib/telegram/sendTelegramWithRetry";

type RobokassaTax = "none";
type RobokassaPaymentMethod = "full_prepayment";
type RobokassaPaymentObject = "service";
type RobokassaSno = "patent";

type RobokassaReceiptItem = {
  name: string;
  quantity: number;
  sum: number;
  tax: RobokassaTax;
  payment_method: RobokassaPaymentMethod;
  payment_object: RobokassaPaymentObject;
};

type RobokassaReceipt = {
  sno: RobokassaSno;
  items: RobokassaReceiptItem[];
};

function normalizeOutSum(sum: number) {
  const normalized = Number(sum);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error("Некорректная сумма для Robokassa");
  }
  return normalized.toFixed(2);
}

function sanitizeReceiptName(input: string) {
  const compact = String(input || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const capped = compact.slice(0, 128);
  return capped || "Оплата тренировки";
}

function buildRobokassaReceipt(params: {
  amount: number;
  tariffLabel?: string | null;
  courseName?: string | null;
  studioName?: string | null;
}) {
  const outSum = normalizeOutSum(params.amount);
  const baseName =
    (params.tariffLabel && String(params.tariffLabel).trim()) ||
    (params.courseName && String(params.courseName).trim()) ||
    (params.studioName && String(params.studioName).trim()) ||
    "Тренировка по калистенике";

  const receipt: RobokassaReceipt = {
    sno: "patent",
    items: [
      {
        name: sanitizeReceiptName(baseName),
        quantity: 1,
        sum: Number(outSum),
        tax: "none",
        payment_method: "full_prepayment",
        payment_object: "service",
      },
    ],
  };
  return receipt;
}

function generatePaymentLink(
  paymentId: number | string,
  sum: number,
  email: string,
  receiptJsonForSignature: string,
  receiptEncodedForUrl: string
) {
  const shopId = process.env.ROBO_ID;      // MerchantLogin
  const secretKey1 = process.env.ROBO_SECRET1; // Secret Key 1

  if (!shopId || !secretKey1) {
    throw new Error("ROBO_ID или ROBO_SECRET1 не заданы в .env");
  }

  const sumString = normalizeOutSum(sum);

  const signatureRaw = `${shopId}:${sumString}:${paymentId}:${receiptJsonForSignature}:${secretKey1}`;
  const signature = crypto
    .createHash("md5")
    .update(signatureRaw)
    .digest("hex");

  const url =
    `https://auth.robokassa.ru/Merchant/Index.aspx` +
    `?MerchantLogin=${shopId}` +
    `&OutSum=${encodeURIComponent(sumString)}` +
    `&InvId=${encodeURIComponent(String(paymentId))}` +
    `&SignatureValue=${signature}` +
    `&Receipt=${receiptEncodedForUrl}` +
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

async function sendTelegramMessage(text: string, invId: string) {
  return sendTelegramWithRetry({
    botToken: TELEGRAM_BOT_TOKEN,
    chatId: TELEGRAM_CHAT_ID,
    text,
    logContext: {
      target: "admin",
      invId,
      source: "website",
    },
  });
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
  studio?: string;
  tg_link?: string;
  course_name?: string;
  lessons?: number;
  slot_start_at?: string;
  id_payment?: number | string;
  status?: string;
  amount?: number;
  tg_link_token?: string;
  valid_weeks?: number;
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
      phone,
      fullName,
      courseName,
      tariffId,
      tariffLabel,
      // studioName — опционально
      studioName,
      // trial booking extras
      slotStartAt,
      studioId,
      giftRecipient,
    } = body as {
      amount: number;
      currency: "RUB" | "EUR";
      email: string;
      phone: string;
      fullName: string;
      courseName: string;
      tariffId: string;
      tariffLabel: string;
      studioName?: string | null;
      slotStartAt?: string | null; // ISO, e.g. "2026-02-08T12:00:00+03:00"
      studioId?: string | null; // e.g. "msk_oktyabrskaya"
      giftRecipient?: string | null;
    };

    const phoneNorm = String(phone || "").trim();
    if (!amount || !email || !fullName || !tariffId || !phoneNorm) {
      return NextResponse.json(
        { error: "Не хватает данных для оплаты" },
        { status: 400 }
      );
    }

    const emailNorm = String(email || "").trim().toLowerCase();

    // paymentId — можно заменить на id из базы, если будешь сохранять заказы
    const paymentId = Date.now();

    const receipt = buildRobokassaReceipt({
      amount,
      tariffLabel,
      courseName,
      studioName,
    });
    const receiptJsonForSignature = JSON.stringify(receipt);
    const receiptEncodedForUrl = encodeURIComponent(receiptJsonForSignature);
    const paymentUrl = generatePaymentLink(
      paymentId,
      amount,
      emailNorm,
      receiptJsonForSignature,
      receiptEncodedForUrl
    );

    // Сохраняем заказ в Airtable (status=created) и генерим tg-токен для success-страницы
    const tgToken = crypto.randomBytes(16).toString("hex");
    const botUrl = tgToken
      ? `https://t.me/IDCMAIN_bot?start=${encodeURIComponent(tgToken)}`
      : "https://t.me/IDCMAIN_bot";

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
    // Общая проверка: покупка в зале
    const isGym = Boolean(studioId);
    const isTrialGym = isGym
      ? /пробн/i.test(String(tariffLabel))
      : String(tariffId).toLowerCase() === "review" || /пробн/i.test(String(tariffLabel));

    // Распознавание количества занятий
    function detectLessonsGym(tLabel?: string | null, tId?: string | null): number {
      const label = String(tLabel || "").toLowerCase();
      const id = String(tId || "").toLowerCase();
      if (id === "review" || /пробн/i.test(label)) return 1;
      if (/12\s*трен/i.test(label)) return 12;
      if (/(^|\D)1\s*трен/i.test(label)) return 1;
      return 1;
    }
    function detectLessonsOnline(tLabel?: string | null, tId?: string | null, cName?: string | null): number {
      const label = String(tLabel || "").toLowerCase();
      const id = String(tId || "").toLowerCase();
      const cname = String(cName || "").toLowerCase();
      if (/сертификат|gift/.test(label) || /сертификат|gift/.test(cname)) return 0;
      if (/36\s*трен/i.test(label) || /long36/.test(id)) return 36;
      if (/12\s*трен/i.test(label) || /(month12|fast12|long12)/.test(id)) return 12;
      if (/review|пробн/.test(label) || /review/.test(id)) return 1;
      return 1;
    }
    // valid_weeks helpers (used for Tag selection and YDB)
    function computeValidWeeksOnline(tLabel?: string | null, tId?: string | null, cName?: string | null): number {
      const id = String(tId || "").toLowerCase();
      const label = String(tLabel || "").toLowerCase();
      const cname = String(cName || "").toLowerCase();
      if (cname === "gift_certificate" || /gift|сертификат/.test(label)) return 4;
      if (id.includes("long36") || /36\s*трен/i.test(label)) return 18;
      if (id.includes("fast12") || id.includes("long12")) return 8;
      if (id.includes("short12") || id.includes("month")) return 4;
      if (id.includes("review") || /review|пробн/.test(label)) return 4;
      return 4;
    }
    function computeValidWeeksGym(isTrial: boolean, tLabel?: string | null, tId?: string | null): number {
      if (isTrial) return 4; // trial
      const id = String(tId || "").toLowerCase();
      // Для залов: спец-тариф 12 тренировок на 4 недели
      if (id === "fast12") return 4;
      const isGroup = detectGroupOrPersonal(tLabel) === "group";
      return isGroup ? 8 : 4; // group -> 8, personal -> 4
    }
    // ONLINE mappings
    function normalizeOnlineCourseKey(name?: string | null): "light" | "classic" | "pullups" | "handstand" | "crossfit" | "gift" | undefined {
      const s = String(name || "").toLowerCase();
      if (/light|лайт/.test(s)) return "light";
      if (/classic|классик/.test(s)) return "classic";
      if (/pullup|подтяг/.test(s)) return "pullups";
      if (/handstand|стойка/.test(s)) return "handstand";
      if (/crossfit|кроссфит/.test(s)) return "crossfit";
      if (/gift|сертификат/.test(s)) return "gift";
      return undefined;
    }
    function determineOnlineTariffLabel(tLabel?: string | null, tId?: string | null, cName?: string | null): "online_test" | "package_12_short" | "package_12_long" | "package_36" | "gift_certificate" {
      const label = String(tLabel || "").toLowerCase();
      const id = String(tId || "").toLowerCase();
      const cname = String(cName || "").toLowerCase();
      if (/gift|сертификат/.test(label) || /gift|сертификат/.test(cname)) return "gift_certificate";
      if (/review|power|test|пробн/.test(label) || /review|power|test/.test(id)) return "online_test";
      if (/36/.test(label) || /long36|36/.test(id)) return "package_36";
      const weeks = computeValidWeeksOnline(tLabel, tId, cName);
      return weeks >= 8 ? "package_12_long" : "package_12_short";
    }
    function mapOnlineTag(tariff: "online_test" | "package_12_short" | "package_12_long" | "package_36" | "gift_certificate"): "short1" | "short12" | "long12" | "long36" | "gift_certificate" {
      switch (tariff) {
        case "online_test":
          return "short1";
        case "package_12_short":
          return "short12";
        case "package_12_long":
          return "long12";
        case "package_36":
          return "long36";
        case "gift_certificate":
        default:
          return "gift_certificate";
      }
    }
    // GYM mappings
    function deriveGymKindForCourseName(tLabel?: string | null): "group" | "personal" | "split" {
      const l = String(tLabel || "").toLowerCase();
      if (/персонал/.test(l)) {
        if (/2-3|2\s*-\s*3/.test(l)) return "split";
        if (/\b2\b|\b2\s*чел/.test(l)) return "split";
        if (/\b3\b|\b3\s*чел/.test(l)) return "split";
        return "personal";
      }
      return "group";
    }
    function getGymTariffLabel(tLabel?: string | null, isTrial?: boolean): "trial" | "group_12" | "personal_1" | "personal_2" | "personal_3" {
      if (isTrial) return "trial";
      const l = String(tLabel || "").toLowerCase();
      if (/групп/.test(l) || /12\s*трен/.test(l)) return "group_12";
      if (/персонал/.test(l)) {
        if (/2-3|2\s*-\s*3/.test(l)) return "personal_2"; // объединённый тариф 2-3 чел.
        if (/\b3\b|\b3\s*чел/.test(l)) return "personal_3";
        if (/\b2\b|\b2\s*чел/.test(l)) return "personal_2";
        return "personal_1";
      }
      return "personal_1";
    }
    // Mapping студии для YDB (по требуемым названиям)
    function mapStudioForYdb(id?: string | null): string | undefined {
      switch (id) {
        case "msk_youcan":
          return "you can";
        case "spb_spirit":
          return "spirit";
        case "spb_hkc":
          return "hells kitchen";
        case "msk_elfit":
          return "elfit";
        default:
          return undefined;
      }
    }
    // Compute Tag / tariff_label / course_name for Airtable
    const cityCode = mapStudioToCityCode(studioId);
    const gymCode = mapStudioToGymCode(studioId);
    const lessons = isGym
      ? detectLessonsGym(tariffLabel, tariffId)
      : detectLessonsOnline(tariffLabel, tariffId, courseName);
    const formatField = isGym ? "gym" : "ds";
    let tagForAirtable: string = "";
    let tariffLabelForAirtable: string = "";
    let courseNameForAirtable: string = "";

    if (isGym) {
      // Tag
      if (isTrialGym || lessons === 1) {
        tagForAirtable = "short1";
      } else {
        const weeks = computeValidWeeksGym(isTrialGym, tariffLabel, tariffId);
        tagForAirtable = weeks >= 8 ? "long12" : "short12";
      }
      // tariff_label
      tariffLabelForAirtable = getGymTariffLabel(tariffLabel, isTrialGym);
      // course_name as city_kind_gym
      const kind = deriveGymKindForCourseName(tariffLabel);
      const kindForCourse = kind; // group | personal | split
      courseNameForAirtable = `${cityCode || ""}_${kindForCourse}_${gymCode || ""}`.replace(/^_+|_+$/g, "");
    } else {
      // ONLINE
      const onlineTariff = determineOnlineTariffLabel(tariffLabel, tariffId, courseName);
      tariffLabelForAirtable = onlineTariff;
      tagForAirtable = mapOnlineTag(onlineTariff);
      const key = normalizeOnlineCourseKey(courseName);
      if (onlineTariff === "gift_certificate" || key === "gift") {
        courseNameForAirtable = "gift_certificate";
      } else {
        // default ds_rub_{key}
        const c = key || "classic";
        courseNameForAirtable = `ds_rub_${c}`;
      }
    }

    // YDB course_name: human-readable names for gym purchases
    const courseNameForYdb = (() => {
      if (!isGym) return courseName ?? "";
      if (isTrialGym) return "Пробная тренировка";

      const kind = deriveGymKindForCourseName(tariffLabel);
      switch (kind) {
        case "split":
          return "Персональная тренировка (2-3 чел.)";
        case "personal":
          return "Персональная тренировка (1 чел.)";
        case "group":
        default:
          return lessons === 12 ? "12 тренировок" : "1 тренировка";
      }
    })();

    const validWeeks = isGym
      ? computeValidWeeksGym(isTrialGym, tariffLabel, tariffId)
      : computeValidWeeksOnline(tariffLabel, tariffId, courseName);

    // RU-first: Cloud Function (lead with id_payment) — перед записью в Airtable
    const cfRes = await postToYdbCF({
      name: fullName,
      phone: phoneNorm,
      email: emailNorm,
      notes: "лид",
      studio: mapStudioForYdb(studioId),
      tg_link: botUrl,
      course_name: courseNameForYdb,
      lessons,
      slot_start_at: isGym && slotStartAt ? String(slotStartAt) : undefined,
      id_payment: paymentId,
      status: "created",
      amount: Number(amount),
      tg_link_token: tgToken,
      valid_weeks: validWeeks,
    });

    const createRes = await airtableCreateRecord({
      id_payment: String(paymentId),
      Status: "created",
      email: emailNorm,
      FIO: fullName,
      Phone: phoneNorm,
      Sum: Number(amount),
      Currency: currency,
      Tag: tagForAirtable,
      tariff_label: tariffLabelForAirtable,
      course_name: courseNameForAirtable,
      studio_name: studioName ?? "",
      studio_id: studioId ?? "",
      slot_start_at: slotStartAt ?? "",
      Lessons: lessons,
      GiftRecipient: giftRecipient ?? "",
      // RU-first flags
      ru_first_ok: (cfRes as any)?.ok === true,
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
        `<b>Тариф:</b> ${escapeTgHtml(tariffLabel)}`,
      String(paymentId)
    ).catch(() => {});

    const pricePerLesson =
      lessons > 0 && Number.isFinite(Number(amount))
        ? Math.round((Number(amount) / lessons) * 100) / 100
        : null;
    const acceptLang = String(req.headers.get("accept-language") || "").split(",")[0]?.trim() || null;

    const purchaseSbRes = await upsertPurchaseCreated({
      source_channel: "website",
      email: emailNorm,
      fi: fullName,
      tgid: null,
      gift_recipient: giftRecipient ?? null,
      tg_link_token: tgToken,
      purchaseSum: Number(amount),
      currency,
      lessons,
      price_per_lesson: pricePerLesson,
      id_payment: paymentId,
      course_name: courseNameForAirtable,
      tag: tagForAirtable,
      nickname: null,
      phone: phoneNorm,
      locale: acceptLang,
      tariff_label: tariffLabelForAirtable,
      studio_slug: studioId ?? "",
      slot_start_at: slotStartAt ?? null,
      format: formatField,
    });
    try {
      console.log(
        JSON.stringify({
          tag: "IDC_CREATE_PAYMENT",
          event: "supabase_upsert_purchase_result",
          paymentId: String(paymentId),
          supabase: purchaseSbRes,
        })
      );
    } catch {
      /* ignore */
    }

    return NextResponse.json({ paymentUrl });
  } catch (error) {
    console.error("Ошибка в create-payment:", error);
    return NextResponse.json(
      { error: "Ошибка на сервере при создании оплаты" },
      { status: 500 }
    );
  }
}
