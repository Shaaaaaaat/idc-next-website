import "server-only";

import { getSupabaseAdmin, isSupabaseEnabled } from "@/lib/supabase/server";

const PROFILE_SELECT = [
  "id",
  "fio",
  "email",
  "balance",
  "currency",
  "final_day",
  "is_active",
  "city",
  "birth_date",
  "weight_kg",
  "height_cm",
].join(", ");

type StudentProfileRow = {
  id?: string | null;
  fio?: string | null;
  email?: string | null;
  balance?: number | string | null;
  currency?: string | null;
  final_day?: string | null;
  is_active?: boolean | null;
  city?: string | null;
  birth_date?: string | null;
  weight_kg?: number | string | null;
  height_cm?: number | string | null;
};

export type StudentMobileProfile = {
  clientId: string;
  fio: string | null;
  email: string | null;
  balance: number | null;
  currency: string | null;
  finalDay: string | null;
  isActive: boolean | null;
  city: string | null;
  birthDate: string | null;
  weightKg: number | null;
  heightCm: number | null;
};

export type StudentProfileUpdateInput = {
  city?: string | null;
  birthDate?: string | null;
  weightKg?: number | null;
  heightCm?: number | null;
};

export type StudentProfileResult =
  | { ok: true; profile: StudentMobileProfile }
  | {
      ok: false;
      reason: "disabled" | "invalid" | "not_found" | "db_error";
      message?: string;
    };

export type StudentProfileReadResult = StudentProfileResult;
export type StudentProfileUpdateResult = StudentProfileResult;

type StudentProfileUpdateObject = {
  city?: string | null;
  birth_date?: string | null;
  weight_kg?: number | null;
  height_cm?: number | null;
};

function cleanOptional(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  return value || null;
}

function finiteNumberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;

  const value = raw.trim();
  if (!value) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapStudentProfile(row: StudentProfileRow | null): StudentMobileProfile | null {
  const clientId = cleanOptional(row?.id);
  if (!clientId) return null;

  return {
    clientId,
    fio: cleanOptional(row?.fio),
    email: cleanOptional(row?.email),
    balance: finiteNumberOrNull(row?.balance),
    currency: cleanOptional(row?.currency),
    finalDay: cleanOptional(row?.final_day),
    isActive: typeof row?.is_active === "boolean" ? row.is_active : null,
    city: cleanOptional(row?.city),
    birthDate: cleanOptional(row?.birth_date),
    weightKg: finiteNumberOrNull(row?.weight_kg),
    heightCm: finiteNumberOrNull(row?.height_cm),
  };
}

function buildUpdateObject(input: StudentProfileUpdateInput): StudentProfileUpdateObject {
  const updateObject: StudentProfileUpdateObject = {};

  if (input.city !== undefined) updateObject.city = input.city;
  if (input.birthDate !== undefined) updateObject.birth_date = input.birthDate;
  if (input.weightKg !== undefined) updateObject.weight_kg = input.weightKg;
  if (input.heightCm !== undefined) updateObject.height_cm = input.heightCm;

  return updateObject;
}

export async function getStudentMobileProfileByClientId(
  clientId: string
): Promise<StudentProfileReadResult> {
  if (!isSupabaseEnabled("read_coach_lk")) return { ok: false, reason: "disabled" };
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  const normalizedClientId = cleanOptional(clientId);
  if (!normalizedClientId) return { ok: false, reason: "invalid" };

  const { data, error } = await sb
    .from("clients")
    .select(PROFILE_SELECT)
    .eq("id", normalizedClientId)
    .maybeSingle();

  if (error) return { ok: false, reason: "db_error", message: error.message };

  const profile = mapStudentProfile(data as StudentProfileRow | null);
  if (!profile) return { ok: false, reason: "not_found" };

  return { ok: true, profile };
}

export async function updateStudentMobileProfileByClientId(
  clientId: string,
  input: StudentProfileUpdateInput
): Promise<StudentProfileUpdateResult> {
  if (!isSupabaseEnabled("write_student_profile")) return { ok: false, reason: "disabled" };
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  const normalizedClientId = cleanOptional(clientId);
  if (!normalizedClientId) return { ok: false, reason: "invalid" };

  const updateObject = buildUpdateObject(input);
  if (Object.keys(updateObject).length === 0) {
    return { ok: false, reason: "invalid" };
  }

  const { data, error } = await sb
    .from("clients")
    .update(updateObject)
    .eq("id", normalizedClientId)
    .select(PROFILE_SELECT)
    .maybeSingle();

  if (error) return { ok: false, reason: "db_error", message: error.message };

  const profile = mapStudentProfile(data as StudentProfileRow | null);
  if (!profile) return { ok: false, reason: "not_found" };

  return { ok: true, profile };
}
