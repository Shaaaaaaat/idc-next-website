import "server-only";

import type { CreateLeadInSupabaseInput } from "@/lib/supabase/types";
import { getSupabaseAdmin, isSupabaseEnabled } from "@/lib/supabase/server";

export async function createLeadInSupabase(input: CreateLeadInSupabaseInput): Promise<void> {
  if (!isSupabaseEnabled("write_leads")) return;
  const sb = getSupabaseAdmin();
  if (!sb) return;

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
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[supabase/leads] insert crashed", msg);
  }
}
