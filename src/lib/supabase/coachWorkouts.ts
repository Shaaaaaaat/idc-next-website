import "server-only";

import { getSupabaseAdmin, isSupabaseEnabled } from "@/lib/supabase/server";
import { getCoachByEmail } from "@/lib/supabase/coachStudents";

export type CoachWorkoutExercise = {
  id?: string;
  exerciseId?: string;
  groupId?: string;
  title: string;
  details?: string;
  sets?: string;
  reps?: string;
  rest?: string;
  tempo?: string;
  notes?: string;
  sortOrder?: number;
};

export type CoachWorkoutExerciseGroup = {
  id: string;
  title: string;
  sets?: string;
  rest?: string;
  notes?: string;
  sortOrder: number;
  exercises: CoachWorkoutExercise[];
};

export type CoachWorkout = {
  id: string;
  clientId: string;
  date: string;
  title: string;
  exercises: CoachWorkoutExercise[];
  groups?: CoachWorkoutExerciseGroup[];
  coachComment?: string;
  updatedAt?: string;
};

export type CoachWorkoutExerciseGroupInput = {
  id?: string;
  draftId?: string;
  title?: string;
  sets?: string;
  rest?: string;
  notes?: string;
  sortOrder?: number;
};

export type CoachWorkoutExerciseInput = {
  id?: string;
  exerciseId?: string;
  groupId?: string;
  groupDraftId?: string;
  exerciseTitle: string;
  sets?: string;
  reps?: string;
  rest?: string;
  tempo?: string;
  notes?: string;
  sortOrder?: number;
};

export type SaveCoachWorkoutInput = {
  coachEmail: string;
  studentId: string;
  workoutId?: string;
  workoutDate: string;
  title: string;
  coachComment?: string;
  expectedUpdatedAt?: string | null;
  groups?: CoachWorkoutExerciseGroupInput[];
  exercises: CoachWorkoutExerciseInput[];
};

export type SaveCoachWorkoutResult =
  | { ok: true; workoutId: string }
  | {
      ok: false;
      reason: "disabled" | "invalid" | "forbidden" | "not_found" | "stale" | "db_error";
      message?: string;
    };

export type DeleteCoachWorkoutResult =
  | { ok: true }
  | {
      ok: false;
      reason: "disabled" | "invalid" | "forbidden" | "not_found" | "db_error";
      message?: string;
    };

type ProgramWorkoutRow = {
  id: string;
  client_id?: string | null;
  workout_date?: string | null;
  title?: string | null;
  coach_comment?: string | null;
  status?: string | null;
  updated_at?: string | null;
};

type ProgramExerciseRow = {
  id?: string | null;
  client_program_workout_id?: string | null;
  exercise_group_id?: string | null;
  exercise_id?: string | null;
  exercise_title?: string | null;
  sets?: string | null;
  reps?: string | null;
  rest?: string | null;
  tempo?: string | null;
  notes?: string | null;
  sort_order?: number | null;
};

type ProgramExerciseGroupRow = {
  id: string;
  client_program_workout_id?: string | null;
  title?: string | null;
  sets?: string | null;
  rest?: string | null;
  notes?: string | null;
  sort_order?: number | null;
};

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const raw = String(value || "").trim();
    if (raw) return raw;
  }
  return "";
}

function toDateKey(raw: string): string {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toISOString().slice(0, 10);
}

function isDateKey(raw: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw);
}

function cleanOptional(raw: unknown): string | null {
  const value = String(raw || "").trim();
  return value || null;
}

function exerciseDetails(row: ProgramExerciseRow): string {
  return [
    row.sets ? `${row.sets} sets` : "",
    row.reps ? `${row.reps} reps` : "",
    row.rest ? `rest ${row.rest}` : "",
    row.tempo ? `tempo ${row.tempo}` : "",
    row.notes || "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function groupExercisesByWorkout(rows: ProgramExerciseRow[]): Map<string, CoachWorkoutExercise[]> {
  const map = new Map<string, CoachWorkoutExercise[]>();
  for (const row of rows) {
    const workoutId = String(row.client_program_workout_id || "").trim();
    const title = String(row.exercise_title || "").trim();
    if (!workoutId || !title) continue;

    const list = map.get(workoutId) || [];
    list.push({
      id: cleanOptional(row.id) || undefined,
      groupId: row.exercise_group_id || undefined,
      exerciseId: row.exercise_id || undefined,
      title,
      details: exerciseDetails(row) || undefined,
      sets: row.sets || undefined,
      reps: row.reps || undefined,
      rest: row.rest || undefined,
      tempo: row.tempo || undefined,
      notes: row.notes || undefined,
      sortOrder: row.sort_order ?? undefined,
    });
    map.set(workoutId, list);
  }
  return map;
}

function groupExerciseGroupsByWorkout(
  groupRows: ProgramExerciseGroupRow[],
  exercisesByWorkout: Map<string, CoachWorkoutExercise[]>
): Map<string, CoachWorkoutExerciseGroup[]> {
  const map = new Map<string, CoachWorkoutExerciseGroup[]>();
  for (const row of groupRows) {
    const workoutId = String(row.client_program_workout_id || "").trim();
    if (!workoutId) continue;
    const groupId = String(row.id || "").trim();
    const exercises = (exercisesByWorkout.get(workoutId) || [])
      .filter((exercise) => exercise.groupId === groupId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    const list = map.get(workoutId) || [];
    list.push({
      id: groupId,
      title: firstString(row.title, "Комбо"),
      sets: firstString(row.sets) || undefined,
      rest: firstString(row.rest) || undefined,
      notes: firstString(row.notes) || undefined,
      sortOrder: row.sort_order ?? 0,
      exercises,
    });
    map.set(workoutId, list);
  }

  for (const [workoutId, groups] of map.entries()) {
    map.set(
      workoutId,
      groups.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "ru"))
    );
  }
  return map;
}

function normalizeWorkout(
  row: ProgramWorkoutRow,
  exercisesByWorkout: Map<string, CoachWorkoutExercise[]>,
  groupsByWorkout: Map<string, CoachWorkoutExerciseGroup[]>
): CoachWorkout | null {
  const clientId = String(row.client_id || "").trim();
  const dateRaw = String(row.workout_date || "").trim();
  const date = toDateKey(dateRaw);
  if (!clientId || !date) return null;
  const groups = groupsByWorkout.get(row.id) || [];
  const rawExercises = exercisesByWorkout.get(row.id) || [];
  const orderedExercises = [
    ...groups.map((group) => ({
      sortOrder: group.sortOrder,
      exercises: group.exercises,
    })),
    ...rawExercises
      .filter((exercise) => !exercise.groupId)
      .map((exercise) => ({
        sortOrder: exercise.sortOrder ?? 0,
        exercises: [exercise],
      })),
  ]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((block) => block.exercises);

  return {
    id: row.id,
    clientId,
    date,
    title: firstString(row.title, "Тренировка"),
    exercises: orderedExercises,
    groups,
    coachComment: firstString(row.coach_comment) || undefined,
    updatedAt: cleanOptional(row.updated_at) || undefined,
  };
}

async function assertCoachOwnsStudent(coachEmail: string, studentId: string) {
  const sb = getSupabaseAdmin();
  if (!sb) return null;

  const coach = await getCoachByEmail(coachEmail);
  if (!coach) return null;

  const { data, error } = await sb
    .from("coach_clients")
    .select("client_id")
    .eq("coach_id", coach.id)
    .eq("client_id", studentId)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) return null;
  return coach;
}

export async function saveCoachWorkout(
  input: SaveCoachWorkoutInput
): Promise<SaveCoachWorkoutResult> {
  if (!isSupabaseEnabled("read_coach_lk")) return { ok: false, reason: "disabled" };
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  const coachEmail = String(input.coachEmail || "").trim().toLowerCase();
  const studentId = String(input.studentId || "").trim();
  const workoutId = String(input.workoutId || "").trim();
  const workoutDate = toDateKey(String(input.workoutDate || "").trim());
  const title = String(input.title || "").trim();

  if (!coachEmail || !studentId || !isDateKey(workoutDate) || !title) {
    return { ok: false, reason: "invalid", message: "Missing required workout fields" };
  }

  try {
    const payload = {
      workoutDate,
      title,
      coachComment: cleanOptional(input.coachComment),
      groups: (input.groups || []).map((group, index) => ({
        id: cleanOptional(group.id),
        draftId: cleanOptional(group.draftId || group.id) || `group-${index}`,
        title: cleanOptional(group.title) || `Комбо ${index + 1}`,
        sets: cleanOptional(group.sets),
        rest: cleanOptional(group.rest),
        notes: cleanOptional(group.notes),
        sortOrder: Number.isFinite(Number(group.sortOrder)) ? Number(group.sortOrder) : index,
      })),
      exercises: (input.exercises || []).map((exercise, index) => ({
        id: cleanOptional(exercise.id),
        exerciseId: cleanOptional(exercise.exerciseId),
        groupId: cleanOptional(exercise.groupId),
        groupDraftId: cleanOptional(exercise.groupDraftId || exercise.groupId),
        exerciseTitle: String(exercise.exerciseTitle || "").trim(),
        sets: cleanOptional(exercise.sets),
        reps: cleanOptional(exercise.reps),
        rest: cleanOptional(exercise.rest),
        tempo: cleanOptional(exercise.tempo),
        notes: cleanOptional(exercise.notes),
        sortOrder: Number.isFinite(Number(exercise.sortOrder)) ? Number(exercise.sortOrder) : index,
      })),
    };

    const { data: rpcData, error: rpcError } = workoutId
      ? await sb.rpc("save_client_workout_diff", {
          p_workout_id: workoutId,
          p_coach_email: coachEmail,
          p_client_id: studentId,
          p_expected_updated_at: cleanOptional(input.expectedUpdatedAt),
          p_payload: payload,
        })
      : await sb.rpc("create_client_workout_diff", {
          p_coach_email: coachEmail,
          p_client_id: studentId,
          p_payload: payload,
        });

    if (rpcError) return { ok: false, reason: "db_error", message: rpcError.message };

    const rpcResult = (rpcData || {}) as { ok?: boolean; error?: string; message?: string; workoutId?: string };
    if (rpcResult.ok === false) {
      const reason = rpcResult.error;
      if (reason === "invalid" || reason === "forbidden" || reason === "not_found" || reason === "stale") {
        return { ok: false, reason, message: rpcResult.message };
      }
      return { ok: false, reason: "db_error", message: rpcResult.message || reason || "Workout was not saved" };
    }

    if (typeof rpcResult.workoutId !== "string" || !rpcResult.workoutId) {
      return { ok: false, reason: "db_error", message: "Workout was not saved" };
    }

    return { ok: true, workoutId: rpcResult.workoutId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[supabase/coachWorkouts] saveCoachWorkout crashed", msg);
    return { ok: false, reason: "db_error", message: msg };
  }
}

export async function deleteCoachWorkout(input: {
  coachEmail: string;
  studentId: string;
  workoutId: string;
}): Promise<DeleteCoachWorkoutResult> {
  if (!isSupabaseEnabled("read_coach_lk")) return { ok: false, reason: "disabled" };
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  const coachEmail = String(input.coachEmail || "").trim().toLowerCase();
  const studentId = String(input.studentId || "").trim();
  const workoutId = String(input.workoutId || "").trim();
  if (!coachEmail || !studentId || !workoutId) {
    return { ok: false, reason: "invalid", message: "Missing required workout fields" };
  }

  try {
    const coach = await assertCoachOwnsStudent(coachEmail, studentId);
    if (!coach) return { ok: false, reason: "forbidden" };

    const { data: existing, error: existingErr } = await sb
      .from("client_program_workouts")
      .select("id")
      .eq("id", workoutId)
      .eq("client_id", studentId)
      .eq("coach_id", coach.id)
      .maybeSingle();

    if (existingErr) return { ok: false, reason: "db_error", message: existingErr.message };
    if (!existing) return { ok: false, reason: "not_found" };

    const { error: exercisesErr } = await sb
      .from("client_program_exercises")
      .delete()
      .eq("client_program_workout_id", workoutId);

    if (exercisesErr) return { ok: false, reason: "db_error", message: exercisesErr.message };

    const { data, error } = await sb
      .from("client_program_workouts")
      .delete()
      .eq("id", workoutId)
      .eq("client_id", studentId)
      .eq("coach_id", coach.id)
      .select("id")
      .maybeSingle();

    if (error) return { ok: false, reason: "db_error", message: error.message };
    if (!data) return { ok: false, reason: "not_found" };

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[supabase/coachWorkouts] deleteCoachWorkout crashed", msg);
    return { ok: false, reason: "db_error", message: msg };
  }
}

export async function getCoachWorkoutsForStudent(params: {
  studentId: string;
  fromDate: string;
  toDate: string;
}): Promise<CoachWorkout[]> {
  if (!isSupabaseEnabled("read_coach_lk")) return [];
  const sb = getSupabaseAdmin();
  if (!sb) return [];

  const studentId = String(params.studentId || "").trim();
  if (!studentId) return [];

  try {
    const { data: workouts, error: workoutsErr } = await sb
      .from("client_program_workouts")
      .select("id, client_id, workout_date, title, coach_comment, status, updated_at")
      .eq("client_id", studentId)
      .gte("workout_date", params.fromDate)
      .lte("workout_date", params.toDate)
      .order("workout_date", { ascending: true });

    if (workoutsErr) {
      console.warn("[supabase/coachWorkouts] client_program_workouts query failed", workoutsErr.message);
      return [];
    }

    const workoutRows = (Array.isArray(workouts) ? workouts : []) as ProgramWorkoutRow[];
    const workoutIds = workoutRows.map((workout) => workout.id).filter(Boolean);
    if (workoutIds.length === 0) return [];

    const { data: exercises, error: exercisesErr } = await sb
      .from("client_program_exercises")
      .select("id, client_program_workout_id, exercise_group_id, exercise_id, exercise_title, sets, reps, rest, tempo, notes, sort_order")
      .in("client_program_workout_id", workoutIds)
      .order("sort_order", { ascending: true });

    if (exercisesErr) {
      console.warn("[supabase/coachWorkouts] client_program_exercises query failed", exercisesErr.message);
    }

    const exercisesByWorkout = groupExercisesByWorkout((Array.isArray(exercises) ? exercises : []) as ProgramExerciseRow[]);

    const { data: groups, error: groupsErr } = await sb
      .from("client_program_exercise_groups")
      .select("id, client_program_workout_id, title, sets, rest, notes, sort_order")
      .in("client_program_workout_id", workoutIds)
      .order("sort_order", { ascending: true });

    if (groupsErr) {
      console.warn("[supabase/coachWorkouts] client_program_exercise_groups query failed", groupsErr.message);
    }

    const groupsByWorkout = groupExerciseGroupsByWorkout(
      (Array.isArray(groups) ? groups : []) as ProgramExerciseGroupRow[],
      exercisesByWorkout
    );

    return workoutRows
      .map((workout) => normalizeWorkout(workout, exercisesByWorkout, groupsByWorkout))
      .filter((workout): workout is CoachWorkout => Boolean(workout))
      .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "ru"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[supabase/coachWorkouts] getCoachWorkoutsForStudent crashed", msg);
    return [];
  }
}
