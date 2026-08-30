import "server-only";

import { getSupabaseAdmin, isSupabaseEnabled } from "@/lib/supabase/server";

export type SubmitStudentWorkoutResult =
  | {
      ok: true;
      workout: {
        id: string;
        status: "submitted" | "reviewed";
        submittedAt: string | null;
      };
      firstSubmitted: boolean;
    }
  | {
      ok: false;
      reason: "disabled" | "invalid" | "not_found" | "unsupported_status" | "db_error";
      message?: string;
    };

function cleanOptional(raw: unknown): string | null {
  const value = String(raw || "").trim();
  return value || null;
}

export async function submitStudentWorkout(params: {
  clientId: string;
  workoutId: string;
}): Promise<SubmitStudentWorkoutResult> {
  if (!isSupabaseEnabled("read_coach_lk")) return { ok: false, reason: "disabled" };
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  const clientId = cleanOptional(params.clientId);
  const workoutId = cleanOptional(params.workoutId);
  if (!clientId || !workoutId) return { ok: false, reason: "invalid" };

  const { data, error } = await sb.rpc("submit_student_workout", {
    p_client_id: clientId,
    p_workout_id: workoutId,
  });

  if (error) return { ok: false, reason: "db_error", message: error.message };

  const result = (data || {}) as {
    ok?: boolean;
    error?: string;
    message?: string;
    workoutId?: string;
    status?: string;
    submittedAt?: string | null;
    firstSubmitted?: boolean;
  };

  if (result.ok === false) {
    if (result.error === "not_found") return { ok: false, reason: "not_found" };
    if (result.error === "invalid") return { ok: false, reason: "invalid", message: result.message };
    if (result.error === "unsupported_status") {
      return { ok: false, reason: "unsupported_status", message: result.message };
    }
    return { ok: false, reason: "db_error", message: result.message || result.error || "Workout was not submitted" };
  }

  const id = cleanOptional(result.workoutId);
  const status = cleanOptional(result.status);
  if (!id || (status !== "submitted" && status !== "reviewed")) {
    return { ok: false, reason: "db_error", message: "Workout was not submitted" };
  }

  return {
    ok: true,
    workout: {
      id,
      status,
      submittedAt: cleanOptional(result.submittedAt),
    },
    firstSubmitted: Boolean(result.firstSubmitted),
  };
}
