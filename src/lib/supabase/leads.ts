import "server-only";

import type { CreateLeadInSupabaseInput } from "@/lib/supabase/types";
import { getSupabaseAdmin, isSupabaseEnabled } from "@/lib/supabase/server";

export type CreateLeadInSupabaseResult =
  | { ok: true }
  | { ok: false; reason: "write_leads_disabled" | "no_supabase_client" | "insert_failed" | "exception"; message?: string };

export async function createLeadInSupabase(input: CreateLeadInSupabaseInput): Promise<CreateLeadInSupabaseResult> {
  if (!isSupabaseEnabled("write_leads")) return { ok: false, reason: "write_leads_disabled" };
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "no_supabase_client" };

  try {
    const email = String(input.email || "").trim().toLowerCase() || null;
    const row = {
      fio: String(input.fio || "").trim() || null,
      phone: String(input.phone || "").trim() || null,
      email,
      city: input.city?.trim() || null,
      studio: input.studio?.trim() || null,
      product: String(input.product || "").trim() || null,
      source: String(input.source || "site").trim() || "site",
      tgid: input.tgid?.trim() || null,
      raw_payload: input.raw_payload ?? null,
    };

    const { error } = await sb.from("leads_raw").insert(row);
    if (error) {
      console.warn("[supabase/leads] insert failed", error.message);
      return { ok: false, reason: "insert_failed", message: error.message };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[supabase/leads] insert crashed", msg);
    return { ok: false, reason: "exception", message: msg };
  }
}
