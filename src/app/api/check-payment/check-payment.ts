import { NextResponse } from "next/server";

export type PurchaseStatusRow = {
  status?: string | null;
  tg_link_token?: string | null;
  tariff_label?: string | null;
  tag?: string | null;
  currency?: string | null;
  sum?: number | string | null;
  course_name?: string | null;
  payment_provider?: string | null;
  source_channel?: string | null;
};

export type SupabaseLookupError = {
  code?: string;
  message?: string;
};

export type PurchaseLookupResult = {
  data: PurchaseStatusRow | null;
  error: SupabaseLookupError | null;
};

export type PurchaseQueryBuilder = {
  eq(column: string, value: string): PurchaseQueryBuilder;
  or(filter: string): PurchaseQueryBuilder;
  maybeSingle(): Promise<PurchaseLookupResult>;
};

export type PurchaseQuerySource = {
  select(columns: string): PurchaseQueryBuilder;
};

export type CheckPaymentSupabaseClient = {
  from(table: string): PurchaseQuerySource;
};

export const CHECK_PAYMENT_SELECT =
  "status, tg_link_token, tariff_label, tag, currency, sum, course_name, payment_provider, source_channel";
export const CHECK_PAYMENT_PROVIDER_FILTER =
  "payment_provider.eq.robokassa,payment_provider.is.null,payment_provider.eq.";

function jsonNoStore(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function trimmedString(value: unknown) {
  return String(value ?? "").trim();
}

function pendingResponse(paymentId: string) {
  return {
    ok: true,
    paid: false,
    status: "pending",
    tgToken: null,
    purchasePayload: {
      transaction_id: paymentId,
      tariff_label: undefined,
      tag: undefined,
      currency: undefined,
      value: 0,
      course_name: undefined,
    },
  };
}

export function buildCheckPaymentResponse(paymentId: string, row: PurchaseStatusRow | null) {
  if (!row) return pendingResponse(paymentId);

  const statusRaw = trimmedString(row.status).toLowerCase();
  const paid = statusRaw === "paid";

  return {
    ok: true,
    paid,
    status: paid ? "paid" : "pending",
    tgToken: trimmedString(row.tg_link_token) || null,
    purchasePayload: {
      transaction_id: paymentId,
      tariff_label: trimmedString(row.tariff_label) || undefined,
      tag: trimmedString(row.tag) || undefined,
      currency: trimmedString(row.currency) || undefined,
      value: Number(row.sum ?? 0) || 0,
      course_name: trimmedString(row.course_name) || undefined,
    },
  };
}

async function lookupPurchaseByPaymentId(
  supabase: CheckPaymentSupabaseClient,
  paymentId: string
): Promise<PurchaseLookupResult> {
  return supabase
    .from("purchases")
    .select(CHECK_PAYMENT_SELECT)
    .eq("id_payment", paymentId)
    .eq("source_channel", "website")
    .or(CHECK_PAYMENT_PROVIDER_FILTER)
    .maybeSingle();
}

export async function handleCheckPaymentRequest(
  req: Request,
  supabase: CheckPaymentSupabaseClient | null
) {
  try {
    const body = await req.json().catch(() => ({}));
    const paymentId = String(body?.paymentId ?? "").trim();
    if (!paymentId) {
      return jsonNoStore({ error: "paymentId required" }, 400);
    }

    if (!supabase) {
      return jsonNoStore({ ok: false, status: "error", reason: "supabase_config_missing" }, 500);
    }

    const { data, error } = await lookupPurchaseByPaymentId(supabase, paymentId);

    if (error) {
      console.warn("[/api/check-payment] supabase purchase lookup failed", {
        code: error.code,
        message: error.message,
      });
      return jsonNoStore({ ok: false, status: "error", reason: "supabase_lookup_failed" }, 500);
    }

    return jsonNoStore(buildCheckPaymentResponse(paymentId, data));
  } catch {
    return jsonNoStore({ ok: false, status: "error", error: "Server error" }, 500);
  }
}
