import { mobileError, mobileJson } from "@/app/api/mobile/v1/_lib/responses";
import { getMobileStudentContext } from "@/lib/auth/mobileSession";
import { submitStudentWorkout } from "@/lib/supabase/studentWorkoutCompletion";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ workoutId: string }>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sessionError(reason: string) {
  if (reason === "server_error") return mobileError("INTERNAL_ERROR", 500);
  if (reason === "forbidden") return mobileError("FORBIDDEN", 403);
  return mobileError("UNAUTHORIZED", 401);
}

function submitError(reason: string, message?: string) {
  if (reason === "not_found") return mobileError("NOT_FOUND", 404, "Workout not found");
  if (reason === "unsupported_status") {
    return mobileError("INVALID_INPUT", 409, message || "Workout cannot be submitted from its current status");
  }
  if (reason === "invalid") return mobileError("BAD_REQUEST", 400, message);
  return mobileError("INTERNAL_ERROR", 500);
}

export async function POST(req: Request, context: RouteContext) {
  const session = await getMobileStudentContext(req);
  if (!session.ok) return sessionError(session.reason);

  const { workoutId } = await context.params;
  const normalizedWorkoutId = String(workoutId || "").trim();
  if (!UUID_RE.test(normalizedWorkoutId)) {
    return mobileError("BAD_REQUEST", 400, "Invalid workout id");
  }

  const submitted = await submitStudentWorkout({
    clientId: session.context.clientId,
    workoutId: normalizedWorkoutId,
  });
  if (!submitted.ok) return submitError(submitted.reason, submitted.message);

  return mobileJson({
    ok: true,
    workout: {
      id: submitted.workout.id,
      status: submitted.workout.status,
      submitted_at: submitted.workout.submittedAt,
    },
    first_submitted: submitted.firstSubmitted,
  });
}
