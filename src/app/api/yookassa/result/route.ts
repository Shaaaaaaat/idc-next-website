import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseEnabled } from "@/lib/supabase/server";

export const runtime = "nodejs";

const LOG_TAG = "IDC_YOOKASSA_RESULT";
const REQUEST_TIMEOUT_MS = 7000;
const SUPPORTED_EVENTS = new Set(["payment.succeeded", "payment.canceled"]);
const DECIMAL_RE = /^\d+(?:\.\d+)?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonRecord = Record<string, unknown>;

type VerifiedYooKassaPayment = {
  id: string;
  status: "succeeded" | "canceled";
  amountValue: string;
  currency: "RUB";
  shopId: string;
  purchaseId: string;
};

function json(body: JsonRecord, status = 200) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 180) : String(error ?? "").slice(0, 180);
}

function logYooKassaResult(event: string, payload: JsonRecord) {
  try {
    console.log(JSON.stringify({ tag: LOG_TAG, event, ...payload }));
  } catch {
    console.log(`[${LOG_TAG}] ${event}`);
  }
}

function acceptsJson(contentType: string | null) {
  const mime = String(contentType ?? "").split(";")[0]?.trim().toLowerCase();
  return mime === "application/json";
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function expectedStatusForEvent(event: string) {
  if (event === "payment.succeeded") return "succeeded";
  if (event === "payment.canceled") return "canceled";
  return "";
}

async function fetchYooKassaPayment(paymentId: string, shopId: string, secretKey: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = `https://api.yookassa.ru/v3/payments/${encodeURIComponent(paymentId)}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString("base64")}`,
        Accept: "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      return { ok: false as const, reason: "yookassa_non_2xx", status: response.status };
    }

    const data = (await response.json().catch(() => null)) as unknown;
    if (!isRecord(data)) {
      return { ok: false as const, reason: "yookassa_invalid_json" };
    }

    return { ok: true as const, data };
  } catch (error) {
    return {
      ok: false as const,
      reason: error instanceof Error && error.name === "AbortError" ? "yookassa_timeout" : "yookassa_network_error",
      message: safeMessage(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function verifyYooKassaPayment(
  payment: JsonRecord,
  params: { paymentId: string; event: string; expectedShopId: string }
): { ok: true; payment: VerifiedYooKassaPayment } | { ok: false; reason: string } {
  const expectedStatus = expectedStatusForEvent(params.event);
  const paymentId = getString(payment.id);
  if (paymentId !== params.paymentId) return { ok: false, reason: "payment_id_mismatch" };

  const status = getString(payment.status);
  if (status !== expectedStatus) return { ok: false, reason: "status_mismatch" };

  const amount = isRecord(payment.amount) ? payment.amount : null;
  const amountValue = getString(amount?.value);
  if (!DECIMAL_RE.test(amountValue)) return { ok: false, reason: "amount_invalid" };
  const amountNumber = Number(amountValue);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) return { ok: false, reason: "amount_invalid" };

  const currency = getString(amount?.currency).toUpperCase();
  if (currency !== "RUB") return { ok: false, reason: "currency_mismatch" };

  const recipient = isRecord(payment.recipient) ? payment.recipient : null;
  const shopId = getString(recipient?.account_id);
  if (shopId !== params.expectedShopId) return { ok: false, reason: "shop_id_mismatch" };

  const metadata = isRecord(payment.metadata) ? payment.metadata : null;
  const purchaseId = getString(metadata?.orderId);
  if (!UUID_RE.test(purchaseId)) return { ok: false, reason: "order_id_invalid" };

  return {
    ok: true,
    payment: {
      id: paymentId,
      status: status as VerifiedYooKassaPayment["status"],
      amountValue,
      currency: "RUB",
      shopId,
      purchaseId,
    },
  };
}

function validateRpcResult(
  value: unknown,
  params: { event: string; purchaseId: string }
): { ok: true; status: string } | { ok: false; reason: string } {
  if (!isRecord(value)) return { ok: false, reason: "rpc_result_invalid" };
  if (value.ok !== true) return { ok: false, reason: "rpc_not_ok" };
  if (getString(value.purchase_id) !== params.purchaseId) return { ok: false, reason: "rpc_purchase_id_mismatch" };

  const status = getString(value.status);
  if (params.event === "payment.succeeded" && status !== "Paid") {
    return { ok: false, reason: "rpc_status_mismatch" };
  }
  if (params.event === "payment.canceled" && status !== "Canceled" && status !== "Paid") {
    return { ok: false, reason: "rpc_status_mismatch" };
  }

  return { ok: true, status };
}

async function confirmSupabasePurchase(payment: VerifiedYooKassaPayment, event: string, expectedShopId: string) {
  if (!isSupabaseEnabled("write_purchases")) {
    return { ok: false as const, reason: "write_purchases_disabled" };
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false as const, reason: "no_supabase_client" };
  }

  const { data, error } = await supabase.rpc("confirm_yookassa_purchase", {
    p_purchase_id: payment.purchaseId,
    p_payment_id: payment.id,
    p_amount: payment.amountValue,
    p_currency: payment.currency,
    p_shop_id: payment.shopId,
    p_expected_shop_id: expectedShopId,
    p_yookassa_status: payment.status,
  });

  if (error) {
    return {
      ok: false as const,
      reason: "rpc_error",
      error: {
        type: "supabase_rpc_error",
        code: getString(error.code),
        message: safeMessage(error.message),
      },
    };
  }

  const rpcResult = validateRpcResult(data, { event, purchaseId: payment.purchaseId });
  if (!rpcResult.ok) {
    return { ok: false as const, reason: rpcResult.reason };
  }

  return { ok: true as const, status: rpcResult.status };
}

export async function POST(req: NextRequest) {
  if (!acceptsJson(req.headers.get("content-type"))) {
    return json({ ok: false, reason: "unsupported_content_type" }, 415);
  }

  const body = (await req.json().catch(() => null)) as unknown;
  if (!isRecord(body)) {
    return json({ ok: false, reason: "malformed_json" }, 400);
  }

  const event = getString(body.event);
  const object = isRecord(body.object) ? body.object : null;
  const paymentId = getString(object?.id);

  logYooKassaResult("yookassa_webhook_received", {
    event: event || null,
    payment_id: paymentId || null,
  });

  if (!SUPPORTED_EVENTS.has(event)) {
    logYooKassaResult("yookassa_webhook_result", {
      payment_id: paymentId || null,
      purchase_id: null,
      status: null,
      ok: true,
      ignored: true,
      reason: "unsupported_event",
    });
    return json({ ok: true, ignored: true });
  }

  if (!paymentId) {
    logYooKassaResult("yookassa_webhook_result", {
      payment_id: null,
      purchase_id: null,
      status: null,
      ok: false,
      ignored: false,
      reason: "payment_id_missing",
    });
    return json({ ok: false, reason: "payment_id_missing" }, 400);
  }

  const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
  const secretKey = process.env.YOOKASSA_SECRET_KEY?.trim();
  if (!shopId || !secretKey) {
    logYooKassaResult("yookassa_webhook_result", {
      payment_id: paymentId,
      purchase_id: null,
      status: null,
      ok: false,
      ignored: false,
      reason: "yookassa_env_missing",
    });
    return json({ ok: false, reason: "yookassa_env_missing" }, 500);
  }

  const fetched = await fetchYooKassaPayment(paymentId, shopId, secretKey);
  if (!fetched.ok) {
    logYooKassaResult("yookassa_webhook_result", {
      payment_id: paymentId,
      purchase_id: null,
      status: null,
      ok: false,
      ignored: false,
      reason: fetched.reason,
      status_code: "status" in fetched ? fetched.status : undefined,
    });
    return json({ ok: false, reason: fetched.reason }, 500);
  }

  const verified = verifyYooKassaPayment(fetched.data, { paymentId, event, expectedShopId: shopId });
  if (!verified.ok) {
    logYooKassaResult("yookassa_webhook_result", {
      payment_id: paymentId,
      purchase_id: null,
      status: null,
      ok: false,
      ignored: false,
      reason: verified.reason,
    });
    return json({ ok: false, reason: verified.reason }, 500);
  }

  const confirmed = await confirmSupabasePurchase(verified.payment, event, shopId);
  if (!confirmed.ok) {
    logYooKassaResult("yookassa_webhook_result", {
      payment_id: paymentId,
      purchase_id: verified.payment.purchaseId,
      status: verified.payment.status,
      ok: false,
      ignored: false,
      reason: confirmed.reason,
      error: "error" in confirmed ? confirmed.error : undefined,
    });
    return json({ ok: false, reason: confirmed.reason }, 500);
  }

  logYooKassaResult("yookassa_webhook_result", {
    payment_id: verified.payment.id,
    purchase_id: verified.payment.purchaseId,
    status: confirmed.status,
    ok: true,
    ignored: false,
    reason: "processed",
  });

  return json({ ok: true, purchase_id: verified.payment.purchaseId, status: confirmed.status });
}
