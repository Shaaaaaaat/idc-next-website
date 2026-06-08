import "server-only";

import { getSupabaseAdmin, isSupabaseEnabled } from "@/lib/supabase/server";
import { getCoachByEmail } from "@/lib/supabase/coachStudents";

export type CoachWorkoutExercise = {
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
  groups?: CoachWorkoutExerciseGroupInput[];
  exercises: CoachWorkoutExerciseInput[];
};

export type SaveCoachWorkoutResult =
  | { ok: true; workoutId: string }
  | {
      ok: false;
      reason: "disabled" | "invalid" | "forbidden" | "not_found" | "db_error";
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
};

type ProgramExerciseRow = {
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

function normalizeExerciseInputs(rows: CoachWorkoutExerciseInput[]) {
  return rows
    .map((row, index) => ({
      group_ref: cleanOptional(row.groupDraftId || row.groupId),
      exercise_id: cleanOptional(row.exerciseId),
      exercise_title: String(row.exerciseTitle || "").trim(),
      sets: cleanOptional(row.sets),
      reps: cleanOptional(row.reps),
      rest: cleanOptional(row.rest),
      tempo: cleanOptional(row.tempo),
      notes: cleanOptional(row.notes),
      sort_order: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : index,
    }))
    .filter((row) => row.exercise_id && row.exercise_title);
}

function normalizeGroupInputs(rows: CoachWorkoutExerciseGroupInput[]) {
  return rows.map((row, index) => {
    const ref = cleanOptional(row.draftId || row.id) || `group-${index}`;
    return {
      ref,
      title: cleanOptional(row.title) || `Комбо ${index + 1}`,
      sets: cleanOptional(row.sets),
      rest: cleanOptional(row.rest),
      notes: cleanOptional(row.notes),
      sort_order: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : index,
    };
  });
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

async function ensureActiveClientProgram(params: {
  clientId: string;
  coachId: string;
  startDate: string;
}): Promise<{ ok: true; programId: string } | { ok: false; message: string }> {
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, message: "Supabase client is not configured" };

  const { data: existing, error: existingErr } = await sb
    .from("client_programs")
    .select("id")
    .eq("client_id", params.clientId)
    .eq("coach_id", params.coachId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingErr) return { ok: false, message: existingErr.message };
  if (existing && typeof existing.id === "string") {
    return { ok: true, programId: existing.id };
  }

  const { data: created, error: createErr } = await sb
    .from("client_programs")
    .insert({
      client_id: params.clientId,
      coach_id: params.coachId,
      title: "Индивидуальная программа",
      status: "active",
      start_date: params.startDate,
    })
    .select("id")
    .single();

  if (createErr || !created || typeof created.id !== "string") {
    return { ok: false, message: createErr?.message || "Program was not created" };
  }

  return { ok: true, programId: created.id };
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
  const coachComment = cleanOptional(input.coachComment);
  const groups = normalizeGroupInputs(input.groups || []);
  const exercises = normalizeExerciseInputs(input.exercises || []);

  if (!coachEmail || !studentId || !isDateKey(workoutDate) || !title) {
    return { ok: false, reason: "invalid", message: "Missing required workout fields" };
  }

  try {
    const coach = await assertCoachOwnsStudent(coachEmail, studentId);
    if (!coach) return { ok: false, reason: "forbidden" };

    const program = await ensureActiveClientProgram({
      clientId: studentId,
      coachId: coach.id,
      startDate: workoutDate,
    });
    if (!program.ok) return { ok: false, reason: "db_error", message: program.message };

    let savedWorkoutId = workoutId;
    if (savedWorkoutId) {
      const { data, error } = await sb
        .from("client_program_workouts")
        .update({
          client_program_id: program.programId,
          coach_id: coach.id,
          workout_date: workoutDate,
          title,
          coach_comment: coachComment,
          updated_at: new Date().toISOString(),
        })
        .eq("id", savedWorkoutId)
        .eq("client_id", studentId)
        .select("id")
        .maybeSingle();

      if (error) return { ok: false, reason: "db_error", message: error.message };
      if (!data) return { ok: false, reason: "not_found" };
    } else {
      const { data, error } = await sb
        .from("client_program_workouts")
        .insert({
          client_program_id: program.programId,
          client_id: studentId,
          coach_id: coach.id,
          workout_date: workoutDate,
          title,
          coach_comment: coachComment,
          status: "planned",
        })
        .select("id")
        .single();

      if (error || !data || typeof data.id !== "string") {
        return { ok: false, reason: "db_error", message: error?.message || "Workout was not created" };
      }
      savedWorkoutId = data.id;
    }

    const groupRefs = new Set(groups.map((group) => group.ref));
    const missingGroupRef = exercises.find((exercise) => exercise.group_ref && !groupRefs.has(exercise.group_ref));
    if (missingGroupRef) {
      return { ok: false, reason: "invalid", message: "Exercise group does not belong to this workout payload" };
    }

    const { error: deleteErr } = await sb
      .from("client_program_exercises")
      .delete()
      .eq("client_program_workout_id", savedWorkoutId);

    if (deleteErr) return { ok: false, reason: "db_error", message: deleteErr.message };

    const { error: deleteGroupsErr } = await sb
      .from("client_program_exercise_groups")
      .delete()
      .eq("client_program_workout_id", savedWorkoutId);

    if (deleteGroupsErr) return { ok: false, reason: "db_error", message: deleteGroupsErr.message };

    const groupIdByRef = new Map<string, string>();
    if (groups.length > 0) {
      const { data: createdGroups, error: groupInsertErr } = await sb
        .from("client_program_exercise_groups")
        .insert(
          groups.map((group) => ({
            client_program_workout_id: savedWorkoutId,
            title: group.title,
            sets: group.sets,
            rest: group.rest,
            notes: group.notes,
            sort_order: group.sort_order,
          }))
        )
        .select("id, sort_order");

      if (groupInsertErr) return { ok: false, reason: "db_error", message: groupInsertErr.message };

      const created = (Array.isArray(createdGroups) ? createdGroups : []) as { id?: string; sort_order?: number | null }[];
      const sortedCreated = [...created].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      groups.forEach((group, index) => {
        const id = sortedCreated[index]?.id;
        if (id) groupIdByRef.set(group.ref, id);
      });
      if (groupIdByRef.size !== groups.length) {
        return { ok: false, reason: "db_error", message: "Exercise groups were not created" };
      }
    }

    if (exercises.length > 0) {
      const { error: insertErr } = await sb.from("client_program_exercises").insert(
        exercises.map((exercise) => ({
          exercise_id: exercise.exercise_id,
          exercise_title: exercise.exercise_title,
          sets: exercise.group_ref ? null : exercise.sets,
          reps: exercise.reps,
          rest: exercise.group_ref ? null : exercise.rest,
          tempo: exercise.tempo,
          notes: exercise.notes,
          sort_order: exercise.sort_order,
          client_program_workout_id: savedWorkoutId,
          exercise_group_id: exercise.group_ref ? groupIdByRef.get(exercise.group_ref) || null : null,
        }))
      );

      if (insertErr) return { ok: false, reason: "db_error", message: insertErr.message };
    }

    return { ok: true, workoutId: savedWorkoutId };
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
      .select("id, client_id, workout_date, title, coach_comment, status")
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
      .select("client_program_workout_id, exercise_group_id, exercise_id, exercise_title, sets, reps, rest, tempo, notes, sort_order")
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
