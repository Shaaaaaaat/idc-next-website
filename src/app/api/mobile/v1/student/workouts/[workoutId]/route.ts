import { mobileError, mobileJson } from "@/app/api/mobile/v1/_lib/responses";
import { getMobileStudentContext } from "@/lib/auth/mobileSession";
import { getStudentWorkoutReadOnlyById } from "@/lib/supabase/coachWorkouts";
import { mobileWorkoutDetail } from "../_dto";

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

export async function GET(req: Request, context: RouteContext) {
  const session = await getMobileStudentContext(req);
  if (!session.ok) return sessionError(session.reason);

  const { workoutId } = await context.params;
  const normalizedWorkoutId = String(workoutId || "").trim();
  if (!UUID_RE.test(normalizedWorkoutId)) {
    return mobileError("BAD_REQUEST", 400, "Invalid workout id");
  }

  try {
    const workout = await getStudentWorkoutReadOnlyById({
      studentId: session.context.clientId,
      workoutId: normalizedWorkoutId,
    });

    if (!workout) {
      return mobileError("NOT_FOUND", 404, "Workout not found");
    }

    return mobileJson({
      workout: mobileWorkoutDetail(workout),
    });
  } catch (error) {
    console.warn("[mobile/workouts] detail query failed", error instanceof Error ? error.message : "unknown_error");
    return mobileError("INTERNAL_ERROR", 500);
  }
}
