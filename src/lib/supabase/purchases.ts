import "server-only";

import type { MarkPurchasePaidResult, UpsertPurchaseCreatedInput } from "@/lib/supabase/types";
import { getSupabaseAdmin, getSupabasePurchasesEnvDiag, isSupabaseEnabled } from "@/lib/supabase/server";

const LOG = "IDC_SUPABASE_PURCHASES";
const MARK_PAID_LOOKUP_RETRY_DELAYS_MS = [300, 800, 1500] as const;

type PurchaseLookupClient = NonNullable<ReturnType<typeof getSupabaseAdmin>>;
type PurchaseLookupRow = { id?: string | null; status?: string | null };
type PurchaseLookupResult =
  | { ok: true; purchase: PurchaseLookupRow | null }
  | { ok: false; reason: "db_error"; message: string };

function normalizeIdPayment(id: number | string): string {
  return String(id).trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logLine(event: string, payload: Record<string, unknown>) {
  try {
    console.log(JSON.stringify({ tag: LOG, event, ...payload }));
  } catch {
    console.log(`[${LOG}] ${event}`);
  }
}

function formatPostgrestError(err: {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}): Record<string, string | undefined> {
  return {
    message: err.message,
    code: err.code,
    details: err.details,
    hint: err.hint,
  };
}

function isTerminalPurchaseStatus(status: string): boolean {
  const s = status.trim();
  return s === "Paid" || s === "Matched" || s === "paid" || s === "matched";
}

async function lookupPurchaseByIdPayment(
  sb: PurchaseLookupClient,
  idPayment: string
): Promise<PurchaseLookupResult> {
  const { data, error } = await sb
    .from("purchases")
    .select("id, status")
    .eq("id_payment", idPayment)
    .maybeSingle();

  if (error) {
    return { ok: false, reason: "db_error", message: error.message };
  }

  return { ok: true, purchase: (data as PurchaseLookupRow | null) ?? null };
}

async function lookupPurchaseByIdPaymentWithRetry(
  sb: PurchaseLookupClient,
  idPayment: string
): Promise<PurchaseLookupResult> {
  let attempt = 1;

  while (attempt <= MARK_PAID_LOOKUP_RETRY_DELAYS_MS.length + 1) {
    const result = await lookupPurchaseByIdPayment(sb, idPayment);
    if (!result.ok) return result;
    if (result.purchase?.id) {
      if (attempt > 1) {
        logLine("mark_paid_lookup_recovered", {
          id_payment: idPayment,
          attempt,
        });
      }
      return result;
    }

    const retryDelayMs = MARK_PAID_LOOKUP_RETRY_DELAYS_MS[attempt - 1];
    logLine("mark_paid_lookup_not_found", {
      id_payment: idPayment,
      attempt,
      retryDelayMs: retryDelayMs ?? null,
    });

    if (retryDelayMs == null) return result;
    await sleep(retryDelayMs);
    attempt += 1;
  }

  return { ok: true, purchase: null };
}

export type UpsertPurchaseCreatedResult =
  | { ok: true; persisted: true }
  | { ok: false; persisted: false; reason: string; message?: string };

export async function upsertPurchaseCreated(input: UpsertPurchaseCreatedInput): Promise<UpsertPurchaseCreatedResult> {
  const idPayment = normalizeIdPayment(input.id_payment);
  const diag = getSupabasePurchasesEnvDiag();

  if (!isSupabaseEnabled("write_purchases")) {
    logLine("upsert_created_skipped", {
      step: "flag_or_env",
      id_payment: idPayment,
      reason: "write_purchases_disabled",
      env: diag,
    });
    return { ok: false, persisted: false, reason: "write_purchases_disabled" };
  }
  const sb = getSupabaseAdmin();
  if (!sb) {
    logLine("upsert_created_skipped", {
      step: "no_client",
      id_payment: idPayment,
      reason: "no_supabase_client",
      env: diag,
    });
    return { ok: false, persisted: false, reason: "no_supabase_client" };
  }

  logLine("upsert_created_start", {
    id_payment: idPayment,
    email: String(input.email || "").trim().toLowerCase() || undefined,
    purchaseSum: input.purchaseSum,
    currency: input.currency,
  });

  try {
    const { data: existing, error: readErr } = await sb
      .from("purchases")
      .select("id, status")
      .eq("id_payment", idPayment)
      .maybeSingle();

    if (readErr) {
      logLine("upsert_created_read_existing_error", {
        id_payment: idPayment,
        error: formatPostgrestError(readErr),
      });
      return { ok: false, persisted: false, reason: "read_existing_error", message: readErr.message };
    } else if (existing && isTerminalPurchaseStatus(String((existing as { status?: string }).status || ""))) {
      logLine("upsert_created_skipped", {
        step: "terminal_status",
        id_payment: idPayment,
        existingStatus: String((existing as { status?: string }).status || ""),
        reason: "terminal_status",
      });
      return { ok: false, persisted: false, reason: "terminal_status" };
    }

    const createdTime = (() => {
      const raw = String(input.created_time || "").trim();
      if (raw) {
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
      }
      return new Date().toISOString();
    })();

    const row: Record<string, unknown> = {
      source_channel: input.source_channel,
      email: String(input.email || "").trim().toLowerCase(),
      fi: String(input.fi || "").trim(),
      tgid: input.tgid ?? null,
      gift_recipient: input.gift_recipient ?? null,
      tg_link_token: input.tg_link_token ?? null,
      created_time: createdTime,
      sum: Number(input.purchaseSum),
      currency: String(input.currency || "").trim(),
      lessons: Number(input.lessons) || 0,
      price_per_lesson:
        input.price_per_lesson == null || !Number.isFinite(Number(input.price_per_lesson))
          ? null
          : Number(input.price_per_lesson),
      id_payment: idPayment,
      status: "Created",
      course_name: input.course_name,
      tag: input.tag,
      nickname: input.nickname ?? null,
      phone: String(input.phone || "").trim(),
      locale: input.locale ?? null,
      tariff_label: input.tariff_label,
      studio_slug: String(input.studio_slug || "").trim() || null,
      slot_start_at: input.slot_start_at ?? null,
      format: input.format,
    };

    const { error } = await sb.from("purchases").upsert(row, { onConflict: "id_payment" });
    if (error) {
      logLine("upsert_created_upsert_error", {
        id_payment: idPayment,
        error: formatPostgrestError(error),
      });
      return { ok: false, persisted: false, reason: "upsert_error", message: error.message };
    }
    logLine("upsert_created_ok", { id_payment: idPayment });
    return { ok: true, persisted: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logLine("upsert_created_exception", { id_payment: idPayment, message: msg });
    return { ok: false, persisted: false, reason: "exception", message: msg };
  }
}

export async function markPurchasePaidAndProcess(id_payment: number | string): Promise<MarkPurchasePaidResult> {
  const idPayment = normalizeIdPayment(id_payment);
  const diag = getSupabasePurchasesEnvDiag();

  if (!isSupabaseEnabled("write_purchases")) {
    logLine("mark_paid_skipped", {
      id_payment: idPayment,
      reason: "write_purchases_disabled",
      env: diag,
    });
    return { ok: true, skipped: true, reason: "write_purchases_disabled" };
  }
  const sb = getSupabaseAdmin();
  if (!sb) {
    logLine("mark_paid_skipped", {
      id_payment: idPayment,
      reason: "no_supabase_client",
      env: diag,
    });
    return { ok: true, skipped: true, reason: "no_supabase_client" };
  }

  logLine("mark_paid_start", { id_payment: idPayment });

  try {
    const found = await lookupPurchaseByIdPaymentWithRetry(sb, idPayment);
    if (!found.ok) {
      logLine("mark_paid_find_error", {
        id_payment: idPayment,
        error: { message: found.message },
      });
      return { ok: false, reason: "rpc_failed", message: found.message };
    }

    const purchaseRow = found.purchase;
    if (!purchaseRow?.id) {
      logLine("mark_paid_not_found", { id_payment: idPayment });
      return { ok: false, reason: "purchase_not_found" };
    }

    const purchaseId = String(purchaseRow.id);

    const { error: paidAtErr } = await sb
      .from("purchases")
      .update({ paid_at: new Date().toISOString() })
      .eq("id", purchaseId)
      .is("paid_at", null);
    if (paidAtErr) {
      logLine("mark_paid_paid_at_update_error", {
        id_payment: idPayment,
        purchaseId,
        error: formatPostgrestError(paidAtErr),
      });
      return { ok: false, reason: "update_failed", message: paidAtErr.message };
    }

    const { error: updErr } = await sb.from("purchases").update({ status: "Paid" }).eq("id", purchaseId);
    if (updErr) {
      logLine("mark_paid_update_error", {
        id_payment: idPayment,
        purchaseId,
        error: formatPostgrestError(updErr),
      });
      return { ok: false, reason: "update_failed", message: updErr.message };
    }

    const { data: rpcData, error: rpcErr } = await sb.rpc("process_paid_purchase", {
      p_purchase_id: purchaseId,
    });

    if (rpcErr) {
      logLine("mark_paid_rpc_error", {
        id_payment: idPayment,
        purchaseId,
        error: formatPostgrestError(rpcErr),
      });
      return { ok: false, reason: "rpc_failed", message: rpcErr.message };
    }

    logLine("mark_paid_ok", {
      id_payment: idPayment,
      purchaseId,
      rpcReturned: rpcData != null,
    });
    return { ok: true, purchaseId, rpcData };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logLine("mark_paid_exception", { id_payment: idPayment, message: msg });
    return { ok: false, reason: "rpc_failed", message: msg };
  }
}
