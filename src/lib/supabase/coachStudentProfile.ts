import "server-only";

import { getCoachStudentAccess } from "@/lib/supabase/coachStudentAccess";
import { createClientAvatarSignedReadUrl } from "@/lib/supabase/clientAvatarStorage";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const PROFILE_SELECT = [
  "id",
  "fio",
  "email",
  "balance",
  "currency",
  "final_day",
  "city",
  "birth_date",
  "weight_kg",
  "height_cm",
  "avatar_path",
].join(", ");

type CoachStudentProfileRow = {
  id?: string | null;
  fio?: string | null;
  email?: string | null;
  balance?: number | string | null;
  currency?: string | null;
  final_day?: string | null;
  city?: string | null;
  birth_date?: string | null;
  weight_kg?: number | string | null;
  height_cm?: number | string | null;
  avatar_path?: string | null;
};

export type CoachStudentProfile = {
  clientId: string;
  fio: string | null;
  email: string | null;
  balance: number | null;
  currency: string | null;
  finalDay: string | null;
  city: string | null;
  birthDate: string | null;
  weightKg: number | null;
  heightCm: number | null;
  avatarUrl: string | null;
};

export type CoachStudentProfileResult =
  | { ok: true; student: CoachStudentProfile }
  | {
      ok: false;
      reason: "disabled" | "invalid" | "forbidden" | "not_found" | "db_error";
    };

type MappedCoachStudentProfile = Omit<CoachStudentProfile, "avatarUrl"> & {
  avatarPath: string | null;
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

function mapCoachStudentProfileRow(
  row: CoachStudentProfileRow | null
): MappedCoachStudentProfile | null {
  const clientId = cleanOptional(row?.id);
  if (!clientId) return null;

  return {
    clientId,
    fio: cleanOptional(row?.fio),
    email: cleanOptional(row?.email),
    balance: finiteNumberOrNull(row?.balance),
    currency: cleanOptional(row?.currency),
    finalDay: cleanOptional(row?.final_day),
    city: cleanOptional(row?.city),
    birthDate: cleanOptional(row?.birth_date),
    weightKg: finiteNumberOrNull(row?.weight_kg),
    heightCm: finiteNumberOrNull(row?.height_cm),
    avatarPath: cleanOptional(row?.avatar_path),
  };
}

async function getAvatarUrl(clientId: string, avatarPath: string | null): Promise<string | null> {
  if (!avatarPath) return null;

  try {
    const signedRead = await createClientAvatarSignedReadUrl(clientId, avatarPath);
    if (signedRead.ok) return signedRead.data.signedUrl;
  } catch {
    // Avatar preview is best-effort for coach profile reads.
  }

  console.warn("[supabase/coachStudentProfile] avatar signed read failed", {
    operation: "signed_read",
  });
  return null;
}

function warnProfileLookup() {
  console.warn("[supabase/coachStudentProfile] profile lookup failed", {
    operation: "profile",
  });
}

export async function getCoachStudentProfileForCoach(
  coachEmail: string,
  clientId: string
): Promise<CoachStudentProfileResult> {
  const access = await getCoachStudentAccess(coachEmail, clientId);
  if (!access.ok) return access;

  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  try {
    const { data, error } = await sb
      .from("clients")
      .select(PROFILE_SELECT)
      .eq("id", access.clientId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      warnProfileLookup();
      return { ok: false, reason: "db_error" };
    }

    const profile = mapCoachStudentProfileRow(data as CoachStudentProfileRow | null);
    if (!profile) return { ok: false, reason: "not_found" };

    const avatarUrl = await getAvatarUrl(profile.clientId, profile.avatarPath);

    return {
      ok: true,
      student: {
        clientId: profile.clientId,
        fio: profile.fio,
        email: profile.email,
        balance: profile.balance,
        currency: profile.currency,
        finalDay: profile.finalDay,
        city: profile.city,
        birthDate: profile.birthDate,
        weightKg: profile.weightKg,
        heightCm: profile.heightCm,
        avatarUrl,
      },
    };
  } catch {
    warnProfileLookup();
    return { ok: false, reason: "db_error" };
  }
}
