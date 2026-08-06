import type { CoachWorkout } from "@/lib/supabase/coachWorkouts";

const MOBILE_WORKOUT_STATUSES = new Set([
  "planned",
  "in_progress",
  "submitted",
  "reviewed",
]);

function nullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function mobileStatus(value: unknown): string {
  const status = nullableString(value);
  return status && MOBILE_WORKOUT_STATUSES.has(status) ? status : "planned";
}

export function mobileWorkoutSummary(workout: CoachWorkout) {
  return {
    id: workout.id,
    workout_date: workout.date,
    title: workout.title,
    status: mobileStatus(workout.status),
    coach_comment: nullableString(workout.coachComment),
    exercise_count: workout.exercises.length,
    completed_exercise_count: 0,
    updated_at: nullableString(workout.updatedAt),
  };
}

export function mobileWorkoutDetail(workout: CoachWorkout) {
  return {
    ...mobileWorkoutSummary(workout),
    groups: (workout.groups || []).map((group) => ({
      id: group.id,
      title: nullableString(group.title),
      sort_order: group.sortOrder,
    })),
    exercises: workout.exercises.map((exercise) => ({
      id: nullableString(exercise.id) || "",
      exercise_id: nullableString(exercise.exerciseId),
      group_id: nullableString(exercise.groupId),
      title: exercise.title,
      sets: nullableString(exercise.sets),
      reps: nullableString(exercise.reps),
      rest: nullableString(exercise.rest),
      tempo: nullableString(exercise.tempo),
      notes: nullableString(exercise.notes),
      sort_order: exercise.sortOrder ?? 0,
      video_url: nullableString(exercise.videoUrl),
      thumbnail_url: nullableString(exercise.thumbnailUrl),
    })),
  };
}
