import "server-only";

import type { LkClientRecord } from "@/lib/airtable/clients";
import { getSupabaseAdmin } from "@/lib/supabase/server";

type ClientRow = {
  email?: string | null;
  is_active?: boolean | null;
  final_day?: string | null;
  balance?: string | number | null;
};

export type SupabaseLkClientResult =
  | { ok: true; client: LkClientRecord }
  | { ok: false; reason: "not_found" | "client_disabled" };

function normalizeEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

function displayValue(value: unknown) {
  const raw = String(value ?? "").trim();
  return raw || "—";
}

export async function getClientForLkByEmail(email: string): Promise<SupabaseLkClientResult> {
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "not_found" };

  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: "not_found" };

  try {
    const { data, error } = await sb
      .from("clients")
      .select("email, is_active, final_day, balance")
      .ilike("email", normalized)
      .maybeSingle();

    if (error) {
      console.warn("[supabase/lkClients] getClientForLkByEmail failed", error.message);
      return { ok: false, reason: "not_found" };
    }
    if (!data) return { ok: false, reason: "not_found" };

    const row = data as ClientRow;
    if (row.is_active === false) return { ok: false, reason: "client_disabled" };

    return {
      ok: true,
      client: {
        email: normalizeEmail(row.email || normalized),
        balance: displayValue(row.balance),
        finalDay: displayValue(row.final_day),
        lkEnabled: true,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[supabase/lkClients] getClientForLkByEmail crashed", msg);
    return { ok: false, reason: "not_found" };
  }
}
