// src/app/api/robokassa/result/route.ts
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { markPurchasePaidAndProcess } from "@/lib/supabase/purchases";
import { sendTelegramWithRetry } from "@/lib/telegram/sendTelegramWithRetry";

/* ---------------- ENV ---------------- */
const ROBO_SECRET2 = process.env.ROBO_SECRET2;

/* ---------------- YDB CF (RU-first) ---------------- */
async function postToYdbCFStatus(payload: { id_payment: number | string; status: "paid" | "created" }) {
  const url = process.env.YDB_CF_URL;
  if (!url) return { ok: false as const, reason: "cf_url_missing" as const };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
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
    try { json = JSON.parse(text); } catch {}
    if (!r.ok || !json?.ok) {
      return { ok: false as const, reason: "cf_failed" as const, status: r.status, text };
    }
    return { ok: true as const };
  } catch (e: any) {
    clearTimeout(timer);
    return { ok: false as const, reason: "cf_crashed" as const, error: e?.message };
  }
}

/* ---------------- AIRTABLE ---------------- */
function airtableCoreEnv() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    return { ok: false as const, apiKey: "", baseId: "" };
  }
  return { ok: true as const, apiKey, baseId };
}
function airtableEnv(tableEnvVar: "AIRTABLE_PURCHASE_WEBSITE_TABLE" | "AIRTABLE_PURCHASES") {
  const core = airtableCoreEnv();
  const table = process.env[tableEnvVar];
  if (!core.ok || !table) {
    return { ok: false as const, apiKey: "", baseId: "", table: "" };
  }
  return { ok: true as const, apiKey: core.apiKey, baseId: core.baseId, table };
}
function airtableBaseUrl(env: { baseId: string; table: string }) {
  return `https://api.airtable.com/v0/${env.baseId}/${encodeURIComponent(env.table)}`;
}
async function airtableFindByField(
  tableEnvVar: "AIRTABLE_PURCHASE_WEBSITE_TABLE" | "AIRTABLE_PURCHASES",
  fieldName: string,
  valueRaw: string
) {
  const env = airtableEnv(tableEnvVar);
  if (!env.ok) return { ok: false as const, reason: "env_missing" as const };
  const value = String(valueRaw);
  const filterByFormula = encodeURIComponent(`(LOWER({${fieldName}}&"") = "${value.toLowerCase()}")`);
  const url = `${airtableBaseUrl(env)}?pageSize=1&maxRecords=1&filterByFormula=${filterByFormula}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${env.apiKey}` },
    cache: "no-store",
  });
  const text = await r.text();
  if (!r.ok) return { ok: false as const, reason: "find_failed" as const, status: r.status, text };
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  const rec = Array.isArray(json?.records) ? json.records[0] : null;
  return { ok: true as const, record: rec ?? null };
}
async function airtableUpdateRecord(
  tableEnvVar: "AIRTABLE_PURCHASE_WEBSITE_TABLE" | "AIRTABLE_PURCHASES",
  recordId: string,
  fields: Record<string, any>
) {
  const env = airtableEnv(tableEnvVar);
  if (!env.ok) return { ok: false as const, reason: "env_missing" as const };
  const url = `${airtableBaseUrl(env)}/${encodeURIComponent(recordId)}`;
  try {
    const r = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${env.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields }),
      cache: "no-store",
    });
    const text = await r.text();
    if (!r.ok) return { ok: false as const, reason: "update_failed" as const, status: r.status, text };
    return { ok: true as const };
  } catch (err) {
    console.error("💥 Airtable UPDATE crashed:", err);
    return { ok: false as const, reason: "update_crashed" as const };
  }
}
async function airtableCreateRecord(fields: Record<string, any>) {
  const env = airtableEnv("AIRTABLE_PURCHASE_WEBSITE_TABLE");
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
    if (!r.ok) return { ok: false as const, reason: "create_failed" as const, status: r.status };
    return { ok: true as const };
  } catch (err) {
    console.error("💥 Airtable CREATE crashed:", err);
    return { ok: false as const, reason: "create_crashed" as const };
  }
}

/* ---------------- TELEGRAM ---------------- */
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID_RAW = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_CHAT_ID = TELEGRAM_CHAT_ID_RAW ? Number(TELEGRAM_CHAT_ID_RAW) : NaN;
// Coach routing (only for offline trial bookings)
const TELEGRAM_COACH_BOT_TOKEN = process.env.TELEGRAM_COACH_BOT_TOKEN;
const TELEGRAM_COACH_CHAT_ID_MSK_RAW = process.env.TELEGRAM_COACH_CHAT_ID_MSK;
const TELEGRAM_COACH_CHAT_ID_SPB_SPIRIT_RAW = process.env.TELEGRAM_COACH_CHAT_ID_SPB_SPIRIT;
const TELEGRAM_COACH_CHAT_ID_SPB_HKC_RAW = process.env.TELEGRAM_COACH_CHAT_ID_SPB_HKC;
const TELEGRAM_COACH_CHAT_ID_MSK = TELEGRAM_COACH_CHAT_ID_MSK_RAW ? Number(TELEGRAM_COACH_CHAT_ID_MSK_RAW) : NaN;
const TELEGRAM_COACH_CHAT_ID_SPB_SPIRIT = TELEGRAM_COACH_CHAT_ID_SPB_SPIRIT_RAW ? Number(TELEGRAM_COACH_CHAT_ID_SPB_SPIRIT_RAW) : NaN;
const TELEGRAM_COACH_CHAT_ID_SPB_HKC = TELEGRAM_COACH_CHAT_ID_SPB_HKC_RAW ? Number(TELEGRAM_COACH_CHAT_ID_SPB_HKC_RAW) : NaN;
function escapeTgHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizePhoneForTelegram(input?: string | null) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("8")) digits = "7" + digits.slice(1);
  if (digits.length === 11 && digits.startsWith("7")) return "+" + digits;
  if (digits.length >= 8 && digits.length <= 15) return "+" + digits;
  return raw;
}

function telegramPhoneLine(input?: string | null) {
  const normalized = normalizePhoneForTelegram(input);
  if (!normalized) return "Тел: —";
  const safePhone = escapeTgHtml(normalized);
  return `Тел: <a href="tel:${safePhone}">${safePhone}</a>`;
}

function telegramPhoneLineOptional(input?: string | null) {
  const normalized = normalizePhoneForTelegram(input);
  if (!normalized) return "";
  const safePhone = escapeTgHtml(normalized);
  return `Тел: <a href="tel:${safePhone}">${safePhone}</a>`;
}

type TelegramSendTarget = "admin" | "user" | "coach" | "user_buttons";

type TelegramSendMeta = {
  target: TelegramSendTarget;
  invId?: string;
  source?: "website" | "purchases" | "none";
  email?: string;
  studioId?: string;
};

type TelegramSendOutcome = {
  ok: boolean;
  target: TelegramSendTarget;
  skipped?: boolean;
  reason?: string;
  status?: number;
  telegramOk?: boolean;
  errorCode?: string;
  description?: string;
  attempts?: number;
};

function hashLogValue(value: unknown): string {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 12);
}

function logTelegramSendResult(payload: Record<string, unknown>) {
  try {
    console.log(JSON.stringify({ tag: "IDC_TELEGRAM_SEND", event: "telegram_send_result", ...payload }));
  } catch {
    console.log("[IDC_TELEGRAM_SEND] telegram_send_result");
  }
}

function logRobokassaResult(event: string, payload: Record<string, unknown>) {
  try {
    console.log(JSON.stringify({ tag: "IDC_ROBOKASSA_RESULT", event, ...payload }));
  } catch {
    console.log(`[IDC_ROBOKASSA_RESULT] ${event}`);
  }
}

function telegramLogContext(meta: TelegramSendMeta, chatId?: number) {
  const email = String(meta.email || "").trim().toLowerCase();
  return {
    target: meta.target,
    invId: meta.invId,
    source: meta.source,
    studioId: meta.studioId,
    emailHash: email ? hashLogValue(email) : undefined,
    chatIdHash: Number.isFinite(chatId) ? hashLogValue(chatId) : undefined,
  };
}

function logTelegramSkip(meta: TelegramSendMeta, reason: string, chatId?: number): TelegramSendOutcome {
  const outcome = { ok: false, target: meta.target, skipped: true, reason };
  logTelegramSendResult({
    ...telegramLogContext(meta, chatId),
    ok: outcome.ok,
    target: outcome.target,
    reason: outcome.reason,
  });
  return outcome;
}

async function settleTelegramNotifications(
  tasks: Array<Promise<TelegramSendOutcome>>,
  context: Record<string, unknown>
) {
  const settled = await Promise.allSettled(tasks);
  settled.forEach((result) => {
    if (result.status === "rejected") {
      logTelegramSendResult({
        ...context,
        target: "unknown",
        ok: false,
        reason: "promise_rejected",
      });
    }
  });
  return settled;
}

async function executeTelegramSend(
  botToken: string | undefined,
  chatId: number | undefined,
  body: Record<string, unknown>,
  meta: TelegramSendMeta
): Promise<TelegramSendOutcome> {
  const result = await sendTelegramWithRetry({
    botToken,
    chatId,
    text: String(body.text ?? ""),
    parseMode: typeof body.parse_mode === "string" ? body.parse_mode : "HTML",
    disableWebPagePreview: body.disable_web_page_preview !== false,
    replyMarkup: typeof body.reply_markup === "object" && body.reply_markup !== null
      ? (body.reply_markup as Record<string, unknown>)
      : undefined,
    logContext: telegramLogContext(meta, chatId),
  });

  return { target: meta.target, ...result };
}

async function sendTelegramMessage(text: string, meta: TelegramSendMeta = { target: "admin" }) {
  return executeTelegramSend(
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    },
    meta
  );
}

async function sendTelegramMessageCustom(
  botToken: string | undefined,
  chatId: number | undefined,
  text: string,
  meta: TelegramSendMeta
) {
  return executeTelegramSend(
    botToken,
    chatId,
    {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    },
    meta
  );
}

async function sendTelegramMessageCustomWithInlineButtons(
  botToken: string | undefined,
  chatId: number | undefined,
  text: string,
  buttons: Array<{ text: string; url: string }>,
  meta: TelegramSendMeta
) {
  if (!Array.isArray(buttons) || buttons.length === 0) {
    return logTelegramSkip(meta, "no_buttons", chatId);
  }
  return executeTelegramSend(
    botToken,
    chatId,
    {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [buttons.map((btn) => ({ text: btn.text, url: btn.url }))],
      },
    },
    meta
  );
}

function okText(invId: string) {
  return `OK${invId}`;
}

type TrialStudioMeta = {
  gymName: string;
  address: string;
  coach: string;
  directionsUrl?: string;
  chatUrl?: string;
};

const TRIAL_STUDIO_META: Record<string, TrialStudioMeta> = {
  msk_youcan: {
    gymName: "You Can",
    address: "м. Улица 1905 года",
    coach: "Женя",
    directionsUrl: "https://storage.yandexcloud.net/idc-website-app/ycg.jpeg",
    chatUrl: "https://t.me/+ofJDca2V3y9kNDVi",
  },
  msk_elfit: {
    gymName: "El-Fit",
    address: "Калужская площадь, 1к2, 3 этаж",
    coach: "Женя",
    directionsUrl: "https://storage.yandexcloud.net/idc-website-app/elfit.MP4",
    chatUrl: "https://t.me/+lk7Pdjp3AP81NmNi",
  },
  spb_hkc: {
    gymName: "Hells Kitchen",
    address: "м. Выборгская, Малый Сампсониевский пр., дом 2",
    coach: "Дима",
    chatUrl: "https://t.me/+dXJCxBPP9whkZjEy",
  },
  spb_spirit: {
    gymName: "Spirit",
    address: "м. Московские Ворота, ул. Заставская, 33П",
    coach: "Иван",
    directionsUrl: "https://storage.yandexcloud.net/idc-website-app/spirit.jpg",
    chatUrl: "https://t.me/+R9feJDYgxJtJCSbI",
  },
};

function pickFirstStringField(fields: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const val = fields?.[key];
    if (typeof val === "string" && val.trim()) return val.trim();
    if (typeof val === "number" && Number.isFinite(val)) return String(val);
  }
  return "";
}

function parseTelegramChatId(raw: string) {
  const normalized = raw.replace(/\s+/g, "");
  if (!normalized) return NaN;
  if (!/^-?\d+$/.test(normalized)) return NaN;
  const id = Number(normalized);
  if (!Number.isFinite(id)) return NaN;
  return id;
}

function normalizeTrialDateLabel(input: string) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (/\sв\s/i.test(raw)) return raw;
  const withDot = raw.match(/^(\d{1,2}\.\d{1,2})\s+(\d{1,2}:\d{2})$/);
  if (withDot) return `${withDot[1]} в ${withDot[2]}`;
  const withSlash = raw.match(/^(\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2})$/);
  if (withSlash) return `${withSlash[1]} в ${withSlash[2]}`;
  return raw;
}

function verifySignature(outSum: string, invId: string, signature: string | null | undefined) {
  if (!ROBO_SECRET2) return false;
  if (!signature) return false;
  const crypto = require("crypto") as typeof import("crypto");
  const raw = `${outSum}:${invId}:${ROBO_SECRET2}`;
  const md5 = crypto.createHash("md5").update(raw).digest("hex");
  return md5.toUpperCase() === String(signature).trim().toUpperCase();
}

async function handle(params: URLSearchParams) {
  const outSum = params.get("OutSum") || params.get("outsum") || "";
  const invId = params.get("InvId") || params.get("invId") || params.get("invoiceId") || "";
  const signature = params.get("SignatureValue") || params.get("signature") || params.get("signatureValue");

  if (!outSum || !invId) {
    return new NextResponse("bad args", { status: 400 });
  }
  if (!verifySignature(outSum, invId, signature)) {
    return new NextResponse("bad signature", { status: 400 });
  }

  // RU-first: обновляем статус лида в YDB по id_payment (перед Airtable)
  await postToYdbCFStatus({ id_payment: Number(invId), status: "paid" }).catch(() => {});

  // Airtable: Status -> paid
  const foundWebsite = await airtableFindByField("AIRTABLE_PURCHASE_WEBSITE_TABLE", "id_payment", invId);
  const foundPurchases = (!foundWebsite.ok || !foundWebsite.record?.id)
    ? await airtableFindByField("AIRTABLE_PURCHASES", "inv_id", invId)
    : { ok: true as const, record: null };

  const found = (foundWebsite.ok && foundWebsite.record?.id)
    ? foundWebsite
    : ((foundPurchases as any)?.ok && (foundPurchases as any)?.record?.id ? (foundPurchases as any) : foundWebsite);

  const foundSource: "website" | "purchases" | "none" =
    (foundWebsite.ok && foundWebsite.record?.id)
      ? "website"
      : (((foundPurchases as any)?.ok && (foundPurchases as any)?.record?.id) ? "purchases" : "none");

  if (foundSource === "website" && foundWebsite.record?.id) {
    await airtableUpdateRecord("AIRTABLE_PURCHASE_WEBSITE_TABLE", foundWebsite.record.id, { Status: "paid" });
  } else if (foundSource === "purchases" && (foundPurchases as any)?.record?.id) {
    await airtableUpdateRecord("AIRTABLE_PURCHASES", (foundPurchases as any).record.id, { Status: "paid" });
  } else {
    await airtableCreateRecord({ id_payment: String(invId), Status: "paid" });
  }

  const markPaidRes = await markPurchasePaidAndProcess(invId);
  try {
    console.log(
      JSON.stringify({
        tag: "IDC_ROBOKASSA_RESULT",
        event: "supabase_mark_paid_result",
        invId: String(invId),
        supabase: markPaidRes,
      })
    );
  } catch {
    /* ignore */
  }

  // ---------- Build rich Telegram message ----------
  const fields: any = (found.ok && found.record?.fields) ? found.record.fields : {};
  const format = String(fields?.format || "").toLowerCase(); // 'ds' | 'gym'
  const fio = String(fields?.FIO || fields?.fio || fields?.name || fields?.Name || fields?.full_name || "");
  const phone = String(fields?.Phone || fields?.phone || fields?.mobile || "");
  const email = String(fields?.email || fields?.Email || "").toLowerCase();
  const lessons = Number(fields?.Lessons || 0);
  const sumNum = Number(fields?.Sum || fields?.sum || outSum || 0);
  const tariffLabel = String(fields?.tariff_label || fields?.Tariff || fields?.tariff || "");
  const courseName = String(fields?.course_name || fields?.Course || fields?.course || "");
  const studioName = String(fields?.studio_name || fields?.studio || "");
  const studioId = String(fields?.studio_id || "");
  const slotStartAt = String(fields?.slot_start_at || fields?.slot || "");

  function formatMoscow(dt: Date, withTime = true) {
    const d = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    }).format(dt);
    return d.replace(",", "");
  }
  function formatDdMm(iso?: string) {
    if (!iso) return "";
    const d = new Date(iso);
    const s = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    return s;
  }
  function formatDdMmTime(iso?: string) {
    if (!iso) return "";
    const d = new Date(iso);
    const ddmm = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    const hm = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d).replace(",", "");
    return `${ddmm} в ${hm}`;
  }
  function cityFromStudioId(id: string) {
    if (id.startsWith("msk")) return "Москва";
    if (id.startsWith("spb")) return "Санкт‑Петербург";
    return "";
  }
  function coachChatForStudio(id: string): number | undefined {
    if (id === "msk_youcan" || id === "msk_elfit") return TELEGRAM_COACH_CHAT_ID_MSK;
    if (id === "spb_spirit") return TELEGRAM_COACH_CHAT_ID_SPB_SPIRIT;
    if (id === "spb_hkc") return TELEGRAM_COACH_CHAT_ID_SPB_HKC;
    return undefined;
  }
  const now = new Date();
  const pricePerLesson =
    lessons > 0 ? Math.round(sumNum / lessons) : 0;

  const isOnline = format === "ds";
  const isGym = format === "gym";
  const isGymTrial = isGym && (/^trial$/i.test(tariffLabel) || Boolean(slotStartAt));
  const phoneLine = telegramPhoneLine(phone);
  const purchasesFields: Record<string, any> = (foundPurchases as any)?.record?.fields || {};
  const purchaseFormat = pickFirstStringField(purchasesFields, ["format", "Format"]).toLowerCase();
  const purchaseTariffLabel = pickFirstStringField(purchasesFields, ["tariff_label", "Tariff", "tariff"]).toLowerCase();
  const purchaseTgIdRaw = pickFirstStringField(purchasesFields, ["tgId", "tg_id", "telegram_id", "telegramId", "tgid"]);
  const purchaseDateRaw = pickFirstStringField(purchasesFields, ["Date", "date", "slot_start_at", "slot"]);
  const purchaseStudioId = pickFirstStringField(purchasesFields, ["studio_id", "studioId", "studio"]);
  const purchaseFio = pickFirstStringField(purchasesFields, ["FIO", "fio", "name", "Name", "full_name"]) || fio;
  const purchasePhone = pickFirstStringField(purchasesFields, ["Phone", "phone", "mobile"]) || phone;
  const purchaseEmail = pickFirstStringField(purchasesFields, ["email", "Email"]).toLowerCase() || email;
  const purchaseSumRaw = pickFirstStringField(purchasesFields, ["Sum", "sum"]);
  const purchaseTgId = parseTelegramChatId(purchaseTgIdRaw);
  const isPurchaseGymTrial = purchaseFormat === "gym" && purchaseTariffLabel === "trial";
  const isPurchaseGymNonTrial = purchaseFormat === "gym" && purchaseTariffLabel !== "trial";
  const isPurchaseDsOnlineTest = purchaseFormat === "ds" && purchaseTariffLabel === "online_test";
  const isPurchaseDsNonOnlineTest = purchaseFormat === "ds" && purchaseTariffLabel !== "online_test";
  const purchaseSum = Number(purchaseSumRaw || outSum || 0);
  const trialMeta = TRIAL_STUDIO_META[purchaseStudioId];
  const websiteCoachChat = coachChatForStudio(studioId);
  const purchaseCoachChat = coachChatForStudio(purchaseStudioId);
  const willNotifyAdmin = true;
  const willNotifyCoach =
    foundSource === "purchases"
      ? isPurchaseGymTrial && Number.isFinite(purchaseTgId) && Boolean(trialMeta)
      : isGymTrial;
  const willNotifyUser = foundSource === "purchases" && Number.isFinite(purchaseTgId);

  logRobokassaResult("notification_branch_selected", {
    invId: String(invId),
    source: foundSource,
    format: foundSource === "purchases" ? purchaseFormat : format,
    studioId: foundSource === "purchases" ? purchaseStudioId : studioId,
    hasAdminChat: Boolean(TELEGRAM_BOT_TOKEN && Number.isFinite(TELEGRAM_CHAT_ID)),
    hasCoachChat: Boolean(
      TELEGRAM_COACH_BOT_TOKEN &&
        Number.isFinite(foundSource === "purchases" ? purchaseCoachChat : websiteCoachChat)
    ),
    hasUserChat: Number.isFinite(purchaseTgId),
    willNotifyAdmin,
    willNotifyCoach,
    willNotifyUser,
  });

  if (!willNotifyAdmin && !willNotifyCoach && !willNotifyUser) {
    logRobokassaResult("notification_skipped", {
      invId: String(invId),
      source: foundSource,
      format: foundSource === "purchases" ? purchaseFormat : format,
      studioId: foundSource === "purchases" ? purchaseStudioId : studioId,
      reason: "unsupported_source_or_format",
    });
  }

  let text = "";
  if (foundSource === "purchases") {
    const purchaseTagForAdmin = pickFirstStringField(purchasesFields, ["Tag", "tag"]) || "—";

    text =
      `<b>✅ Оплата подтверждена (bot)</b>\n` +
      `InvId: <code>${escapeTgHtml(String(invId))}</code>\n` +
      `Дата: ${escapeTgHtml(formatMoscow(now))}\n` +
      `Имя: ${escapeTgHtml(fio || "—")}\n` +
      `${telegramPhoneLineOptional(phone) ? telegramPhoneLineOptional(phone) + "\n" : ""}` +
      `Почта: ${escapeTgHtml(email || "—")}\n` +
      `Сумма: ${escapeTgHtml(String(sumNum || Number(outSum) || 0))} ₽\n` +
      `Курс: ${escapeTgHtml(purchaseTagForAdmin)}\n` +
      `Тариф: ${escapeTgHtml(tariffLabel || "—")}`;
    await sendTelegramMessage(text, { target: "admin", invId: String(invId), source: "purchases", email });
    if (isPurchaseGymTrial && Number.isFinite(purchaseTgId) && trialMeta) {
      const trialDateLabel = normalizeTrialDateLabel(purchaseDateRaw);
      const msg1 =
        `Отлично, запись подтверждена!\n\n` +
        `Дата и время: ${escapeTgHtml(trialDateLabel || "—")}\n` +
        `Зал: ${escapeTgHtml(trialMeta.gymName)}\n` +
        `Адрес: ${escapeTgHtml(trialMeta.address)}\n` +
        `Тренер: ${escapeTgHtml(trialMeta.coach)}`;
      const msg2 =
        `Важно:\n` +
        `- Если нужно перенести тренировку, используй команду /reschedule.\n` +
        `- Абонемент активен 4 недели с даты первой тренировки.`;

      const inlineButtons: Array<{ text: string; url: string }> = [];
      if (trialMeta.directionsUrl) {
        inlineButtons.push({ text: "📍 Как добраться", url: trialMeta.directionsUrl });
      }
      if (trialMeta.chatUrl) {
        inlineButtons.push({ text: "💬 Присоединиться к чату", url: trialMeta.chatUrl });
      }

      await sendTelegramMessageCustom(TELEGRAM_COACH_BOT_TOKEN, purchaseTgId, msg1, {
        target: "user",
        invId: String(invId),
        source: "purchases",
        email: purchaseEmail,
        studioId: purchaseStudioId,
      });
      await sendTelegramMessageCustom(TELEGRAM_COACH_BOT_TOKEN, purchaseTgId, msg2, {
        target: "user",
        invId: String(invId),
        source: "purchases",
        email: purchaseEmail,
        studioId: purchaseStudioId,
      });
      if (inlineButtons.length > 0) {
        await sendTelegramMessageCustomWithInlineButtons(
          TELEGRAM_COACH_BOT_TOKEN,
          purchaseTgId,
          "Полезные ссылки:",
          inlineButtons,
          { target: "user_buttons", invId: String(invId), source: "purchases", email: purchaseEmail, studioId: purchaseStudioId }
        );
      }

      const city = cityFromStudioId(purchaseStudioId);
      const header =
        `<b>🟡 Новая запись в ${escapeTgHtml(trialMeta.gymName)}${city ? " (" + escapeTgHtml(city) + ")" : ""}</b>\n`;
      const textCoach =
        header +
        `Когда: ${escapeTgHtml(trialDateLabel || "—")}\n` +
        `Имя: ${escapeTgHtml(purchaseFio || "—")}\n` +
        `${telegramPhoneLineOptional(purchasePhone) ? telegramPhoneLineOptional(purchasePhone) + "\n" : ""}` +
        `Почта: ${escapeTgHtml(purchaseEmail || "—")}`;
      if (trialMeta) {
        await sendTelegramMessageCustom(TELEGRAM_COACH_BOT_TOKEN, purchaseCoachChat as number | undefined, textCoach, {
          target: "coach",
          invId: String(invId),
          source: "purchases",
          email: purchaseEmail,
          studioId: purchaseStudioId,
        });
      } else {
        logTelegramSkip({ target: "coach", invId: String(invId), source: "purchases", email: purchaseEmail, studioId: purchaseStudioId }, "studio_meta_missing");
      }
    } else if (isPurchaseGymNonTrial && Number.isFinite(purchaseTgId)) {
      const userMsg =
        `Ура! Оплата прошла успешно ✅\n` +
        `Ваш баланс пополнен на: ${escapeTgHtml(String(purchaseSum))} ₽.\n\n` +
        `Дата окончания вашего тарифа обновлена. Посмотреть её можно, нажав кнопку «Дата окончания».`;
      await sendTelegramMessageCustom(TELEGRAM_COACH_BOT_TOKEN, purchaseTgId, userMsg, {
        target: "user",
        invId: String(invId),
        source: "purchases",
        email: purchaseEmail,
      });
    } else if (isPurchaseDsOnlineTest && Number.isFinite(purchaseTgId)) {
      const onlineTestMsg1 =
        `Ура, оплата прошла успешно!\n` +
        `Вскоре на вашу почту придет письмо с темой [TrueCoach] Invitation, содержащее приглашение для доступа к нашему приложению, где будет стоять первая тренировка.\n` +
        `После прохождения первой тренировки наш тренер свяжется с вами и предоставит подробную обратную связь. Для удобства рекомендуем скачать мобильную версию приложения 👇🏻`;
      await sendTelegramMessageCustom(TELEGRAM_COACH_BOT_TOKEN, purchaseTgId, onlineTestMsg1, {
        target: "user",
        invId: String(invId),
        source: "purchases",
        email: purchaseEmail,
      });
      await sendTelegramMessageCustomWithInlineButtons(
        TELEGRAM_COACH_BOT_TOKEN,
        purchaseTgId,
        "Ссылки для установки приложения:",
        [
          { text: "🍎 Скачать для iOS", url: "https://apps.apple.com/am/app/truecoach-for-clients/id1439127794" },
          { text: "🤖 Скачать для Android", url: "https://play.google.com/store/apps/details?id=co.truecoach.client" },
        ],
        { target: "user_buttons", invId: String(invId), source: "purchases", email: purchaseEmail }
      );

      const onlineTestMsg2 =
        `<b>Краткая инструкция как выполнять тест силы от I Do Calisthenics:</b>\n` +
        `Всего 5-7 упражнений (в зависимости от выбранного курса). Для каждого упражнения в приложении указано возможное количество вариаций (от 1 до 3): вам надо выбрать и выполнить только одну вариацию и один подход в каждом упражнении — ту, которая для вас не самая простая, но с которой вы уверенно справитесь.\n` +
        `Важно: все упражнения необходимо снять на видео и загрузить в приложение — это поможет нам определить ваш текущий уровень и составить последующие тренировки эффективно.`;
      await sendTelegramMessageCustom(TELEGRAM_COACH_BOT_TOKEN, purchaseTgId, onlineTestMsg2, {
        target: "user",
        invId: String(invId),
        source: "purchases",
        email: purchaseEmail,
      });
    } else if (isPurchaseDsNonOnlineTest && Number.isFinite(purchaseTgId)) {
      const userMsg =
        `Ура! Оплата прошла успешно ✅\n` +
        `Ваш баланс пополнен на: ${escapeTgHtml(String(purchaseSum))} ₽.\n\n` +
        `Дата окончания вашего тарифа обновлена. Посмотреть её можно, нажав кнопку «Дата окончания».`;
      await sendTelegramMessageCustom(TELEGRAM_COACH_BOT_TOKEN, purchaseTgId, userMsg, {
        target: "user",
        invId: String(invId),
        source: "purchases",
        email: purchaseEmail,
      });
    } else if (Number.isFinite(purchaseTgId)) {
      const userMsg =
        `Ура! Оплата прошла успешно ✅\n` +
        `Ваш баланс пополнен на: ${escapeTgHtml(String(purchaseSum))} ₽.\n\n` +
        `Дата окончания вашего тарифа обновлена. Посмотреть её можно, нажав кнопку «Дата окончания».`;
      await sendTelegramMessageCustom(TELEGRAM_COACH_BOT_TOKEN, purchaseTgId, userMsg, {
        target: "user",
        invId: String(invId),
        source: "purchases",
        email: purchaseEmail,
      });
    } else {
      logTelegramSkip({ target: "user", invId: String(invId), source: "purchases", email: purchaseEmail }, "user_chat_id_missing");
    }
  } else if (isOnline) {
    text =
      `<b>✅ Новая покупка ${escapeTgHtml(courseName)}</b>\n` +
      `${escapeTgHtml(tariffLabel)}\n` +
      `Дата: ${escapeTgHtml(formatMoscow(now))}\n` +
      `Имя: ${escapeTgHtml(fio)}\n` +
      `${phoneLine}\n` +
      `Email: ${escapeTgHtml(email)}\n` +
      `Сумма: ${escapeTgHtml(String(sumNum))} ₽\n` +
      `Кол-во тренировок: ${escapeTgHtml(String(lessons))}\n` +
      `Стоимость за тренировку: ${escapeTgHtml(String(pricePerLesson))} ₽`;
    // admin chat
    await sendTelegramMessage(text, { target: "admin", invId: String(invId), source: "website", email });
  } else if (isGymTrial) {
    const city = cityFromStudioId(studioId);
    const header =
      `<b>🟡 Новая запись в ${escapeTgHtml(studioName)}${city ? " (" + escapeTgHtml(city) + ")" : ""}</b>\n`;
    const textAdmin =
      header +
      `Формат: пробная тренировка\n` +
      `Когда: ${escapeTgHtml(formatDdMmTime(slotStartAt))}\n` +
      `Имя: ${escapeTgHtml(fio)}\n` +
      `${phoneLine}\n` +
      `Почта: ${escapeTgHtml(email)}\n` +
      `Сумма: ${escapeTgHtml(String(sumNum))} ₽\n\n` +
      `Оплата: ${escapeTgHtml(formatMoscow(now))}\n` +
      `Тэг: ${escapeTgHtml(courseName)}`;
    const textCoach =
      header +
      `Когда: ${escapeTgHtml(formatDdMmTime(slotStartAt))}\n` +
      `Имя: ${escapeTgHtml(fio)}\n` +
      `${phoneLine}\n` +
      `Почта: ${escapeTgHtml(email)}`;
    await settleTelegramNotifications(
      [
        sendTelegramMessage(textAdmin, { target: "admin", invId: String(invId), source: "website", email, studioId }),
        sendTelegramMessageCustom(TELEGRAM_COACH_BOT_TOKEN, websiteCoachChat as number | undefined, textCoach, {
          target: "coach",
          invId: String(invId),
          source: "website",
          email,
          studioId,
        }),
      ],
      { invId: String(invId), source: "website", emailHash: email ? hashLogValue(email) : undefined, studioId }
    );
  } else if (isGym && (courseName.includes("_personal_") || courseName.includes("_split_"))) {
    const city = cityFromStudioId(studioId);
    const header =
      `<b>🔵 Новая запись в ${escapeTgHtml(studioName)}${city ? " (" + escapeTgHtml(city) + ")" : ""}</b>\n`;
    const formatLabel = courseName.includes("_split_") ? "сплит" : "персоналка";
    const textAdmin =
      header +
      `Формат: ${escapeTgHtml(formatLabel)}\n` +
      `Имя: ${escapeTgHtml(fio)}\n` +
      `${phoneLine}\n` +
      `Почта: ${escapeTgHtml(email)}\n` +
      `Сумма: ${escapeTgHtml(String(sumNum))} ₽\n\n` +
      `Оплата: ${escapeTgHtml(formatMoscow(now))}\n` +
      `Тэг: ${escapeTgHtml(courseName)}`;
    // admin chat only
    await sendTelegramMessage(textAdmin, { target: "admin", invId: String(invId), source: "website", email, studioId });
  } else if (isGym) {
    text =
      `<b>✅ Новая покупка ${escapeTgHtml(courseName)}</b>\n` +
      `Когда: ${escapeTgHtml(formatMoscow(now))}\n` +
      `Имя: ${escapeTgHtml(fio)}\n` +
      `${phoneLine}\n` +
      `Почта: ${escapeTgHtml(email)}\n` +
      `Сумма: ${escapeTgHtml(String(sumNum))} ₽`;
    await sendTelegramMessage(text, { target: "admin", invId: String(invId), source: "website", email, studioId });
  } else {
    // Fallback minimal
    await sendTelegramMessage(
      `<b>✅ Оплата успешна</b>\n` +
        `<b>InvId:</b> <code>${escapeTgHtml(String(invId))}</code>\n` +
        `<b>OutSum:</b> ${escapeTgHtml(outSum)}`,
      { target: "admin", invId: String(invId), source: foundSource, email }
    );
  }

  return new NextResponse(okText(String(invId)), {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    const params = new URLSearchParams(text);
    return handle(params);
  }
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body || {})) {
      params.set(k, String(v));
    }
    return handle(params);
  }
  // fallback: пробуем query
  return GET(req);
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  return handle(params);
}

