import "server-only";

import { getSupabaseAdmin, isSupabaseEnabled } from "@/lib/supabase/server";

export type StudentIdentity = {
  clientId: string;
  email: string;
  displayName?: string;
};

export type StudentIdentityResult =
  | { ok: true; student: StudentIdentity }
  | {
      ok: false;
      reason:
        | "disabled"
        | "invalid"
        | "not_found"
        | "duplicate"
        | "student_disabled"
        | "db_error";
    };

type ClientIdentityRow = {
  id?: string | null;
  email?: string | null;
  fio?: string | null;
  lk_enabled?: boolean | null;
};

function normalizeEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

function cleanOptional(raw: unknown): string | undefined {
  const value = String(raw || "").trim();
  return value || undefined;
}

export async function getActiveStudentIdentityByEmail(
  email: string
): Promise<StudentIdentityResult> {
  if (!isSupabaseEnabled("read_coach_lk")) return { ok: false, reason: "disabled" };
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: "invalid" };

  try {
    const { data, error } = await sb
      .from("clients")
      .select("id, email, fio, lk_enabled")
      .ilike("email", normalized)
      .limit(2);

    if (error) {
      console.warn("[supabase/studentAccess] client identity lookup failed", error.message);
      return { ok: false, reason: "db_error" };
    }

    const rows = (Array.isArray(data) ? data : []) as ClientIdentityRow[];
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length > 1) return { ok: false, reason: "duplicate" };

    const row = rows[0];
    const clientId = String(row.id || "").trim();
    if (!clientId) return { ok: false, reason: "not_found" };
    if (row.lk_enabled !== true) return { ok: false, reason: "student_disabled" };

    return {
      ok: true,
      student: {
        clientId,
        email: normalizeEmail(row.email || normalized),
        displayName: cleanOptional(row.fio),
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[supabase/studentAccess] client identity lookup crashed", msg);
    return { ok: false, reason: "db_error" };
  }
}
