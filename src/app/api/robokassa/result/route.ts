import crypto from "crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { markPurchasePaidAndProcess } from "@/lib/supabase/purchases";

const ROBO_SECRET2 = process.env.ROBO_SECRET2;
const IDC_ERRORS_BOT_TOKEN = process.env.IDC_ERRORS_BOT_TOKEN;
const IDC_ERRORS_CHAT_ID_RAW = process.env.IDC_ERRORS_CHAT_ID;
const IDC_ERRORS_CHAT_ID = IDC_ERRORS_CHAT_ID_RAW ? Number(IDC_ERRORS_CHAT_ID_RAW) : NaN;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function postToYdbCFStatus(payload: { id_payment: number | string; status: "paid" | "created" }) {
  const url = process.env.YDB_CF_URL;
  if (!url) return { ok: false as const, reason: "cf_url_missing" as const };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
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
    const text = await r.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {}
    if (!r.ok || !isRecord(json) || json.ok !== true) {
      return { ok: false as const, reason: "cf_failed" as const, status: r.status, text };
    }
    return { ok: true as const };
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false as const, reason: "cf_timeout" as const };
    }
    return { ok: false as const, reason: "cf_crashed" as const, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function okText(invId: string) {
  return `OK${invId}`;
}

function logRobokassaResult(event: string, payload: Record<string, unknown>) {
  try {
    console.log(JSON.stringify({ tag: "IDC_ROBOKASSA_RESULT", event, ...payload }));
  } catch {
    console.log(`[IDC_ROBOKASSA_RESULT] ${event}`);
  }
}

function safeAlertValue(value: unknown, maxLength = 120) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength) || "-";
}

async function sendPurchaseNotFoundAlert(params: {
  invId: string;
  foundSource: "none";
  outSum: string;
}) {
  if (!IDC_ERRORS_BOT_TOKEN || !Number.isFinite(IDC_ERRORS_CHAT_ID)) {
    logRobokassaResult("purchase_not_found_alert_unavailable", {
      operation: "robokassa_purchase_not_found_alert",
      invId: params.invId,
    });
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const res = await fetch(`https://api.telegram.org/bot${IDC_ERRORS_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: IDC_ERRORS_CHAT_ID,
        text: [
          "IDC Robokassa paid purchase not found after retry",
          "Payment is confirmed, but client access may not have been issued.",
          `invId: ${safeAlertValue(params.invId)}`,
          `foundSource: ${safeAlertValue(params.foundSource)}`,
          `outSum: ${safeAlertValue(params.outSum)}`,
          "Check public.purchases.id_payment for this InvId.",
        ].join("\n"),
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      logRobokassaResult("purchase_not_found_alert_failed", {
        operation: "robokassa_purchase_not_found_alert",
        invId: params.invId,
      });
    }
  } catch {
    logRobokassaResult("purchase_not_found_alert_failed", {
      operation: "robokassa_purchase_not_found_alert",
      invId: params.invId,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function verifySignature(outSum: string, invId: string, signature: string | null | undefined) {
  if (!ROBO_SECRET2) return false;
  if (!signature) return false;
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

  after(async () => {
    try {
      const result = await postToYdbCFStatus({ id_payment: Number(invId), status: "paid" });
      if (!result.ok) {
        logRobokassaResult("ydb_paid_status_mirror_failed", {
          operation: "robokassa_ydb_paid_status_mirror",
          invId: String(invId),
          reason: result.reason,
          status: "status" in result ? result.status : undefined,
        });
      }
    } catch {
      logRobokassaResult("ydb_paid_status_mirror_crashed", {
        operation: "robokassa_ydb_paid_status_mirror",
        invId: String(invId),
        reason: "cf_crashed",
      });
    }
  });

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
  if (!markPaidRes.ok && markPaidRes.reason === "purchase_not_found") {
    await sendPurchaseNotFoundAlert({
      invId: String(invId),
      foundSource: "none",
      outSum,
    });
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
  return GET(req);
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  return handle(params);
}
