import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

export type LkUserRole = "admin" | "coach" | "client";

export type LkUserRow = {
  email: string;
  role: string;
  lkEnabled: boolean;
};

type RawLkUserRow = {
  email?: string | null;
  role?: string | null;
  lk_enabled?: boolean | null;
};

function normalizeEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

export function isLkUserRole(role: string): role is LkUserRole {
  return role === "admin" || role === "coach" || role === "client";
}

export async function getLkUserByEmail(email: string): Promise<LkUserRow | null> {
  const sb = getSupabaseAdmin();
  if (!sb) return null;

  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  try {
    const { data, error } = await sb
      .from("lk_users")
      .select("email, role, lk_enabled")
      .ilike("email", normalized)
      .maybeSingle();

    if (error) {
      console.warn("[supabase/lkUsers] getLkUserByEmail failed", error.message);
      return null;
    }
    if (!data) return null;

    const row = data as RawLkUserRow;
    return {
      email: normalizeEmail(row.email || normalized),
      role: String(row.role || "").trim().toLowerCase(),
      lkEnabled: row.lk_enabled === true,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[supabase/lkUsers] getLkUserByEmail crashed", msg);
    return null;
  }
}
