import "server-only";

import {
  getStudentWorkoutsReadOnly,
  type CoachWorkout,
} from "@/lib/supabase/coachWorkouts";

const UNFINISHED_STATUSES = ["planned", "in_progress"];
const COMPLETED_STATUSES = ["submitted", "reviewed"];
const COMPLETED_LIMIT = 20;

export async function getStudentUnfinishedWorkoutsForMobile(params: {
  studentId: string;
  toDate: string;
}): Promise<CoachWorkout[]> {
  return getStudentWorkoutsReadOnly({
    studentId: params.studentId,
    toDate: params.toDate,
    statuses: UNFINISHED_STATUSES,
    orderBy: "workout_date_asc",
  });
}

export async function getStudentCompletedWorkoutsForMobile(params: {
  studentId: string;
}): Promise<CoachWorkout[]> {
  return getStudentWorkoutsReadOnly({
    studentId: params.studentId,
    statuses: COMPLETED_STATUSES,
    orderBy: "submitted_at_desc",
    limit: COMPLETED_LIMIT,
  });
}
