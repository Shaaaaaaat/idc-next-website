import "server-only";

import { getSupabaseAdmin, isSupabaseEnabled } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CoachStudentAccessResult =
  | { ok: true; coachId: string; clientId: string }
  | {
      ok: false;
      reason: "disabled" | "invalid" | "forbidden" | "not_found" | "db_error";
    };

function normalizeCoachEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeClientId(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function warnAccessLookup(operation: "coach" | "client" | "ownership") {
  console.warn("[supabase/coachStudentAccess] lookup failed", { operation });
}

export async function getCoachStudentAccess(
  coachEmail: string,
  clientId: string
): Promise<CoachStudentAccessResult> {
  if (!isSupabaseEnabled("read_coach_lk")) {
    return { ok: false, reason: "disabled" };
  }

  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  const normalizedCoachEmail = normalizeCoachEmail(coachEmail);
  const normalizedClientId = normalizeClientId(clientId);
  if (!EMAIL_RE.test(normalizedCoachEmail) || !UUID_RE.test(normalizedClientId)) {
    return { ok: false, reason: "invalid" };
  }

  try {
    const { data: coach, error: coachError } = await sb
      .from("coach_profiles")
      .select("id")
      .eq("email", normalizedCoachEmail)
      .eq("is_active", true)
      .maybeSingle();

    if (coachError) {
      warnAccessLookup("coach");
      return { ok: false, reason: "db_error" };
    }
    if (!coach?.id) return { ok: false, reason: "not_found" };

    const { data: client, error: clientError } = await sb
      .from("clients")
      .select("id")
      .eq("id", normalizedClientId)
      .eq("is_active", true)
      .maybeSingle();

    if (clientError) {
      warnAccessLookup("client");
      return { ok: false, reason: "db_error" };
    }
    if (!client?.id) return { ok: false, reason: "not_found" };

    const { data: link, error: linkError } = await sb
      .from("coach_clients")
      .select("client_id")
      .eq("coach_id", coach.id)
      .eq("client_id", normalizedClientId)
      .eq("is_active", true)
      .maybeSingle();

    if (linkError) {
      warnAccessLookup("ownership");
      return { ok: false, reason: "db_error" };
    }
    if (!link) return { ok: false, reason: "forbidden" };

    return {
      ok: true,
      coachId: String(coach.id),
      clientId: normalizedClientId,
    };
  } catch {
    warnAccessLookup("ownership");
    return { ok: false, reason: "db_error" };
  }
}
