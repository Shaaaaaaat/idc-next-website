import { mobileError, mobileJson } from "@/app/api/mobile/v1/_lib/responses";
import { getMobileStudentContext } from "@/lib/auth/mobileSession";
import { getStudentWorkoutsReadOnly } from "@/lib/supabase/coachWorkouts";
import { mobileWorkoutSummary } from "./_dto";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sessionError(reason: string) {
  if (reason === "server_error") return mobileError("INTERNAL_ERROR", 500);
  if (reason === "forbidden") return mobileError("FORBIDDEN", 403);
  return mobileError("UNAUTHORIZED", 401);
}

function validDate(value: string | null): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function GET(req: Request) {
  const session = await getMobileStudentContext(req);
  if (!session.ok) return sessionError(session.reason);

  const url = new URL(req.url);
  const fromDate = url.searchParams.get("from_date");
  const toDate = url.searchParams.get("to_date");

  if (!validDate(fromDate) || !validDate(toDate) || fromDate > toDate) {
    return mobileError("BAD_REQUEST", 400, "Invalid date range");
  }

  try {
    const workouts = await getStudentWorkoutsReadOnly({
      studentId: session.context.clientId,
      fromDate,
      toDate,
    });

    return mobileJson({
      workouts: workouts.map(mobileWorkoutSummary),
    });
  } catch (error) {
    console.warn("[mobile/workouts] list query failed", error instanceof Error ? error.message : "unknown_error");
    return mobileError("INTERNAL_ERROR", 500);
  }
}
