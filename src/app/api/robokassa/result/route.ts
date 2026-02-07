// src/app/api/robokassa/result/route.ts
import { NextRequest, NextResponse } from "next/server";

/* ---------------- ENV ---------------- */
const ROBO_SECRET2 = process.env.ROBO_SECRET2;

/* ---------------- AIRTABLE ---------------- */
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
async function airtableFindByPaymentId(paymentIdRaw: string) {
  const env = airtableEnv();
  if (!env.ok) return { ok: false as const, reason: "env_missing" as const };
  const paymentId = String(paymentIdRaw);
  const filterByFormula = encodeURIComponent(`(LOWER({id_payment}&"") = "${paymentId.toLowerCase()}")`);
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
async function airtableUpdateRecord(recordId: string, fields: Record<string, any>) {
  const env = airtableEnv();
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
function escapeTgHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
async function sendTelegramMessage(text: string) {
  if (!TELEGRAM_BOT_TOKEN || !Number.isFinite(TELEGRAM_CHAT_ID)) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
    cache: "no-store",
  }).catch(() => {});
}

function okText(invId: string) {
  return `OK${invId}`;
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

  // Обновляем Airtable: Status -> paid
  const found = await airtableFindByPaymentId(invId);
  if (found.ok && found.record?.id) {
    await airtableUpdateRecord(found.record.id, {
      Status: "paid",
      // Paid_time: new Date().toISOString(),
    });
  } else {
    // на всякий случай — создадим запись, чтобы не потерять оплату
    await airtableCreateRecord({
      id_payment: String(invId),
      Status: "paid",
    });
  }

  await sendTelegramMessage(
    `<b>✅ Оплата успешна</b>\n` +
      `<b>InvId:</b> <code>${escapeTgHtml(String(invId))}</code>\n` +
      `<b>OutSum:</b> ${escapeTgHtml(outSum)}`
  );

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

