import "server-only";

import { getCoachByEmail } from "@/lib/supabase/coachStudents";
import { getSupabaseAdmin, isSupabaseEnabled } from "@/lib/supabase/server";

export type ProgramTemplateExercise = {
  id: string;
  exerciseId?: string;
  groupId?: string;
  title: string;
  sets?: string;
  reps?: string;
  rest?: string;
  tempo?: string;
  notes?: string;
  sortOrder: number;
};

export type ProgramTemplateExerciseGroup = {
  id: string;
  title: string;
  sets?: string;
  rest?: string;
  notes?: string;
  sortOrder: number;
  exercises: ProgramTemplateExercise[];
};

export type ProgramTemplateWorkout = {
  id: string;
  dayNumber: number;
  weekNumber: number;
  title: string;
  summary?: string;
  estimatedMinutes?: number;
  workoutType?: string;
  sortOrder: number;
  exercises: ProgramTemplateExercise[];
  groups: ProgramTemplateExerciseGroup[];
};

export type ProgramTemplate = {
  id: string;
  coachId: string;
  title: string;
  description?: string;
  durationDays: number;
  weeksCount: number;
  level?: string;
  goal?: string;
  tags: string[];
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  workoutsCount: number;
  workouts?: ProgramTemplateWorkout[];
};

export type ProgramTemplateWorkoutInput = {
  id?: string;
  dayNumber?: number;
  weekNumber?: number;
  title?: string;
  summary?: string;
  estimatedMinutes?: number | string | null;
  workoutType?: string;
  sortOrder?: number;
  groups?: ProgramTemplateExerciseGroupInput[];
  exercises?: ProgramTemplateExerciseInput[];
};

export type ProgramTemplateExerciseGroupInput = {
  id?: string;
  draftId?: string;
  title?: string;
  sets?: string;
  rest?: string;
  notes?: string;
  sortOrder?: number;
};

export type ProgramTemplateExerciseInput = {
  id?: string;
  exerciseId?: string;
  groupId?: string;
  groupDraftId?: string;
  exerciseTitle?: string;
  sets?: string;
  reps?: string;
  rest?: string;
  tempo?: string;
  notes?: string;
  sortOrder?: number;
};

export type ProgramTemplateResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "disabled" | "invalid" | "forbidden" | "not_found" | "db_error"; message?: string };

type ProgramTemplateRow = {
  id: string;
  coach_id?: string | null;
  title?: string | null;
  description?: string | null;
  duration_days?: number | null;
  weeks_count?: number | null;
  level?: string | null;
  goal?: string | null;
  tags?: string[] | null;
  is_active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ProgramTemplateWorkoutRow = {
  id: string;
  program_template_id?: string | null;
  day_number?: number | null;
  week_number?: number | null;
  title?: string | null;
  summary?: string | null;
  estimated_minutes?: number | null;
  workout_type?: string | null;
  sort_order?: number | null;
};

type ProgramTemplateExerciseGroupRow = {
  id: string;
  program_template_workout_id?: string | null;
  title?: string | null;
  sets?: string | null;
  rest?: string | null;
  notes?: string | null;
  sort_order?: number | null;
};

type ProgramTemplateExerciseRow = {
  id: string;
  program_template_workout_id?: string | null;
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

function cleanOptional(raw: unknown): string | null {
  const value = String(raw || "").trim();
  return value || null;
}

function cleanTags(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw : String(raw || "").split(/[,\n]/);
  return Array.from(new Set(parts.map((tag) => String(tag || "").trim()).filter(Boolean)));
}

function toPositiveInt(raw: unknown, fallback: number): number {
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isDateKey(raw: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw);
}

function mapTemplate(row: ProgramTemplateRow, workoutsCount = 0): ProgramTemplate {
  return {
    id: row.id,
    coachId: String(row.coach_id || "").trim(),
    title: String(row.title || "").trim() || "Программа",
    description: cleanOptional(row.description) || undefined,
    durationDays: toPositiveInt(row.duration_days, 1),
    weeksCount: toPositiveInt(row.weeks_count, Math.max(1, Math.ceil(toPositiveInt(row.duration_days, 1) / 7))),
    level: cleanOptional(row.level) || undefined,
    goal: cleanOptional(row.goal) || undefined,
    tags: cleanTags(row.tags),
    isActive: row.is_active !== false,
    createdAt: cleanOptional(row.created_at) || undefined,
    updatedAt: cleanOptional(row.updated_at) || undefined,
    workoutsCount,
  };
}

function groupExercisesByWorkout(rows: ProgramTemplateExerciseRow[]): Map<string, ProgramTemplateExercise[]> {
  const map = new Map<string, ProgramTemplateExercise[]>();
  for (const row of rows) {
    const workoutId = String(row.program_template_workout_id || "").trim();
    const title = String(row.exercise_title || "").trim();
    if (!workoutId || !title) continue;

    const list = map.get(workoutId) || [];
    list.push({
      id: row.id,
      exerciseId: cleanOptional(row.exercise_id) || undefined,
      groupId: cleanOptional(row.exercise_group_id) || undefined,
      title,
      sets: cleanOptional(row.sets) || undefined,
      reps: cleanOptional(row.reps) || undefined,
      rest: cleanOptional(row.rest) || undefined,
      tempo: cleanOptional(row.tempo) || undefined,
      notes: cleanOptional(row.notes) || undefined,
      sortOrder: row.sort_order ?? 0,
    });
    map.set(workoutId, list);
  }
  return map;
}

function groupGroupsByWorkout(
  rows: ProgramTemplateExerciseGroupRow[],
  exercisesByWorkout: Map<string, ProgramTemplateExercise[]>
): Map<string, ProgramTemplateExerciseGroup[]> {
  const map = new Map<string, ProgramTemplateExerciseGroup[]>();
  for (const row of rows) {
    const workoutId = String(row.program_template_workout_id || "").trim();
    const groupId = String(row.id || "").trim();
    if (!workoutId || !groupId) continue;

    const exercises = (exercisesByWorkout.get(workoutId) || [])
      .filter((exercise) => exercise.groupId === groupId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "ru"));

    const list = map.get(workoutId) || [];
    list.push({
      id: groupId,
      title: cleanOptional(row.title) || "Комбо",
      sets: cleanOptional(row.sets) || undefined,
      rest: cleanOptional(row.rest) || undefined,
      notes: cleanOptional(row.notes) || undefined,
      sortOrder: row.sort_order ?? 0,
      exercises,
    });
    map.set(workoutId, list);
  }

  for (const [workoutId, groups] of map.entries()) {
    map.set(workoutId, groups.sort((a, b) => a.sortOrder - b.sortOrder));
  }
  return map;
}

function mapWorkout(
  row: ProgramTemplateWorkoutRow,
  exercisesByWorkout: Map<string, ProgramTemplateExercise[]>,
  groupsByWorkout: Map<string, ProgramTemplateExerciseGroup[]>
): ProgramTemplateWorkout {
  const groups = groupsByWorkout.get(row.id) || [];
  const rawExercises = exercisesByWorkout.get(row.id) || [];
  const orderedExercises = [
    ...groups.map((group) => ({ sortOrder: group.sortOrder, exercises: group.exercises })),
    ...rawExercises
      .filter((exercise) => !exercise.groupId)
      .map((exercise) => ({ sortOrder: exercise.sortOrder, exercises: [exercise] })),
  ]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((block) => block.exercises);

  return {
    id: row.id,
    dayNumber: toPositiveInt(row.day_number, 1),
    weekNumber: toPositiveInt(row.week_number, 1),
    title: String(row.title || "").trim() || "Тренировка",
    summary: cleanOptional(row.summary) || undefined,
    estimatedMinutes: row.estimated_minutes ?? undefined,
    workoutType: cleanOptional(row.workout_type) || undefined,
    sortOrder: row.sort_order ?? 0,
    exercises: orderedExercises,
    groups,
  };
}

async function assertCoachOwnsStudent(coachId: string, studentId: string) {
  const sb = getSupabaseAdmin();
  if (!sb || !coachId || !studentId) return false;

  const { data, error } = await sb
    .from("coach_clients")
    .select("client_id")
    .eq("coach_id", coachId)
    .eq("client_id", studentId)
    .eq("is_active", true)
    .maybeSingle();

  return !error && Boolean(data);
}

async function ensureActiveClientProgram(params: {
  clientId: string;
  coachId: string;
  startDate: string;
  title: string;
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
  if (existing && typeof existing.id === "string") return { ok: true, programId: existing.id };

  const { data: created, error: createErr } = await sb
    .from("client_programs")
    .insert({
      client_id: params.clientId,
      coach_id: params.coachId,
      title: params.title || "Индивидуальная программа",
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

async function getCoachForProgram(coachEmail: string) {
  if (!isSupabaseEnabled("read_coach_lk")) return null;
  const normalized = String(coachEmail || "").trim().toLowerCase();
  if (!normalized) return null;
  return getCoachByEmail(normalized);
}

export async function verifyProgramTemplateSchema(
  coachEmail: string
): Promise<ProgramTemplateResult<{ checked: true }>> {
  const sb = getSupabaseAdmin();
  if (!isSupabaseEnabled("read_coach_lk") || !sb) return { ok: false, reason: "disabled" };
  const coach = await getCoachForProgram(coachEmail);
  if (!coach) return { ok: false, reason: "forbidden" };

  const checks = [
    sb.from("program_templates").select("id").eq("coach_id", coach.id).limit(1),
    sb.from("program_template_workouts").select("id").limit(1),
    sb.from("program_template_exercises").select("id").limit(1),
    sb.from("program_template_exercise_groups").select("id").limit(1),
    sb.from("program_assignments").select("id").limit(1),
    sb.from("client_program_exercise_groups").select("id").limit(1),
  ];

  const results = await Promise.all(checks);
  const failed = results.find((result) => result.error);
  if (failed?.error) return { ok: false, reason: "db_error", message: failed.error.message };
  return { ok: true, data: { checked: true } };
}

export async function listProgramTemplates(coachEmail: string): Promise<ProgramTemplate[]> {
  const sb = getSupabaseAdmin();
  if (!isSupabaseEnabled("read_coach_lk") || !sb) return [];
  const coach = await getCoachForProgram(coachEmail);
  if (!coach) return [];

  const { data, error } = await sb
    .from("program_templates")
    .select("id, coach_id, title, description, duration_days, weeks_count, level, goal, tags, is_active, created_at, updated_at")
    .eq("coach_id", coach.id)
    .eq("is_active", true)
    .order("updated_at", { ascending: false });

  if (error) {
    console.warn("[supabase/programTemplates] list failed", error.message);
    return [];
  }

  const rows = (Array.isArray(data) ? data : []) as ProgramTemplateRow[];
  const ids = rows.map((row) => row.id).filter(Boolean);
  const countByTemplate = new Map<string, number>();
  if (ids.length > 0) {
    const { data: workouts, error: workoutsErr } = await sb
      .from("program_template_workouts")
      .select("program_template_id")
      .in("program_template_id", ids);
    if (!workoutsErr) {
      for (const row of (Array.isArray(workouts) ? workouts : []) as { program_template_id?: string | null }[]) {
        const id = String(row.program_template_id || "");
        if (id) countByTemplate.set(id, (countByTemplate.get(id) || 0) + 1);
      }
    }
  }

  return rows.map((row) => mapTemplate(row, countByTemplate.get(row.id) || 0));
}

export async function getProgramTemplate(
  coachEmail: string,
  programId: string
): Promise<ProgramTemplateResult<ProgramTemplate>> {
  const sb = getSupabaseAdmin();
  if (!isSupabaseEnabled("read_coach_lk") || !sb) return { ok: false, reason: "disabled" };
  const coach = await getCoachForProgram(coachEmail);
  if (!coach) return { ok: false, reason: "forbidden" };

  const id = String(programId || "").trim();
  if (!id) return { ok: false, reason: "invalid" };

  const { data: template, error: templateErr } = await sb
    .from("program_templates")
    .select("id, coach_id, title, description, duration_days, weeks_count, level, goal, tags, is_active, created_at, updated_at")
    .eq("id", id)
    .eq("coach_id", coach.id)
    .eq("is_active", true)
    .maybeSingle();

  if (templateErr) return { ok: false, reason: "db_error", message: templateErr.message };
  if (!template) return { ok: false, reason: "not_found" };

  const { data: workouts, error: workoutsErr } = await sb
    .from("program_template_workouts")
    .select("id, program_template_id, day_number, week_number, title, summary, estimated_minutes, workout_type, sort_order")
    .eq("program_template_id", id)
    .order("sort_order", { ascending: true });

  if (workoutsErr) return { ok: false, reason: "db_error", message: workoutsErr.message };

  const workoutRows = (Array.isArray(workouts) ? workouts : []) as ProgramTemplateWorkoutRow[];
  const workoutIds = workoutRows.map((workout) => workout.id).filter(Boolean);
  let exerciseRows: ProgramTemplateExerciseRow[] = [];
  let groupRows: ProgramTemplateExerciseGroupRow[] = [];

  if (workoutIds.length > 0) {
    const { data: exercises, error: exercisesErr } = await sb
      .from("program_template_exercises")
      .select("id, program_template_workout_id, exercise_group_id, exercise_id, exercise_title, sets, reps, rest, tempo, notes, sort_order")
      .in("program_template_workout_id", workoutIds)
      .order("sort_order", { ascending: true });
    if (exercisesErr) return { ok: false, reason: "db_error", message: exercisesErr.message };
    exerciseRows = (Array.isArray(exercises) ? exercises : []) as ProgramTemplateExerciseRow[];

    const { data: groups, error: groupsErr } = await sb
      .from("program_template_exercise_groups")
      .select("id, program_template_workout_id, title, sets, rest, notes, sort_order")
      .in("program_template_workout_id", workoutIds)
      .order("sort_order", { ascending: true });
    if (groupsErr) return { ok: false, reason: "db_error", message: groupsErr.message };
    groupRows = (Array.isArray(groups) ? groups : []) as ProgramTemplateExerciseGroupRow[];
  }

  const exercisesByWorkout = groupExercisesByWorkout(exerciseRows);
  const groupsByWorkout = groupGroupsByWorkout(groupRows, exercisesByWorkout);
  return {
    ok: true,
    data: {
      ...mapTemplate(template as ProgramTemplateRow, workoutRows.length),
      workouts: workoutRows
        .map((workout) => mapWorkout(workout, exercisesByWorkout, groupsByWorkout))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    },
  };
}

export async function createProgramTemplate(params: {
  coachEmail: string;
  title: string;
}): Promise<ProgramTemplateResult<ProgramTemplate>> {
  const sb = getSupabaseAdmin();
  if (!isSupabaseEnabled("read_coach_lk") || !sb) return { ok: false, reason: "disabled" };
  const coach = await getCoachForProgram(params.coachEmail);
  if (!coach) return { ok: false, reason: "forbidden" };

  const title = String(params.title || "").trim();
  if (!title) return { ok: false, reason: "invalid", message: "Program title is required" };

  const { data, error } = await sb
    .from("program_templates")
    .insert({
      coach_id: coach.id,
      title,
      duration_days: 7,
      weeks_count: 1,
      tags: [],
      is_active: true,
    })
    .select("id, coach_id, title, description, duration_days, weeks_count, level, goal, tags, is_active, created_at, updated_at")
    .single();

  if (error || !data) return { ok: false, reason: "db_error", message: error?.message || "Program was not created" };
  return { ok: true, data: mapTemplate(data as ProgramTemplateRow, 0) };
}

function normalizeWorkoutInputs(workouts: ProgramTemplateWorkoutInput[]) {
  return workouts.map((workout, index) => {
    const dayNumber = toPositiveInt(workout.dayNumber, index + 1);
    return {
      ref: cleanOptional(workout.id) || `workout-${index}`,
      day_number: dayNumber,
      week_number: toPositiveInt(workout.weekNumber, Math.ceil(dayNumber / 7)),
      title: cleanOptional(workout.title) || `Day ${dayNumber}`,
      summary: cleanOptional(workout.summary),
      estimated_minutes: workout.estimatedMinutes ? toPositiveInt(workout.estimatedMinutes, 0) : null,
      workout_type: cleanOptional(workout.workoutType),
      sort_order: Number.isFinite(Number(workout.sortOrder)) ? Number(workout.sortOrder) : index,
      groups: Array.isArray(workout.groups) ? workout.groups : [],
      exercises: Array.isArray(workout.exercises) ? workout.exercises : [],
    };
  });
}

export async function updateProgramTemplate(params: {
  coachEmail: string;
  programId: string;
  title?: string;
  description?: string | null;
  durationDays?: number | string;
  weeksCount?: number | string;
  level?: string | null;
  goal?: string | null;
  tags?: string[] | string | null;
  workouts?: ProgramTemplateWorkoutInput[];
}): Promise<ProgramTemplateResult<ProgramTemplate>> {
  const sb = getSupabaseAdmin();
  if (!isSupabaseEnabled("read_coach_lk") || !sb) return { ok: false, reason: "disabled" };
  const coach = await getCoachForProgram(params.coachEmail);
  if (!coach) return { ok: false, reason: "forbidden" };

  const programId = String(params.programId || "").trim();
  if (!programId) return { ok: false, reason: "invalid" };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (params.title !== undefined) {
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, reason: "invalid", message: "Program title is required" };
    patch.title = title;
  }
  if (params.description !== undefined) patch.description = cleanOptional(params.description);
  if (params.durationDays !== undefined) patch.duration_days = toPositiveInt(params.durationDays, 1);
  if (params.weeksCount !== undefined) patch.weeks_count = toPositiveInt(params.weeksCount, 1);
  if (params.level !== undefined) patch.level = cleanOptional(params.level);
  if (params.goal !== undefined) patch.goal = cleanOptional(params.goal);
  if (params.tags !== undefined) patch.tags = cleanTags(params.tags);

  const { data: updated, error: updateErr } = await sb
    .from("program_templates")
    .update(patch)
    .eq("id", programId)
    .eq("coach_id", coach.id)
    .eq("is_active", true)
    .select("id")
    .maybeSingle();

  if (updateErr) return { ok: false, reason: "db_error", message: updateErr.message };
  if (!updated) return { ok: false, reason: "not_found" };

  if (Array.isArray(params.workouts)) {
    const current = await getProgramTemplate(params.coachEmail, programId);
    if (!current.ok) return current;
    const oldWorkoutIds = (current.data.workouts || []).map((workout) => workout.id);
    if (oldWorkoutIds.length > 0) {
      await sb.from("program_template_exercises").delete().in("program_template_workout_id", oldWorkoutIds);
      await sb.from("program_template_exercise_groups").delete().in("program_template_workout_id", oldWorkoutIds);
      await sb.from("program_template_workouts").delete().in("id", oldWorkoutIds);
    }

    const workouts = normalizeWorkoutInputs(params.workouts);
    if (workouts.length > 0) {
      const { data: createdWorkouts, error: workoutErr } = await sb
        .from("program_template_workouts")
        .insert(
          workouts.map((workout) => ({
            program_template_id: programId,
            day_number: workout.day_number,
            week_number: workout.week_number,
            title: workout.title,
            summary: workout.summary,
            estimated_minutes: workout.estimated_minutes,
            workout_type: workout.workout_type,
            sort_order: workout.sort_order,
          }))
        )
        .select("id, sort_order");
      if (workoutErr) return { ok: false, reason: "db_error", message: workoutErr.message };

      const created = ((Array.isArray(createdWorkouts) ? createdWorkouts : []) as { id?: string; sort_order?: number | null }[])
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

      for (let index = 0; index < workouts.length; index += 1) {
        const workout = workouts[index];
        const workoutId = created[index]?.id;
        if (!workoutId) return { ok: false, reason: "db_error", message: "Template workout was not created" };

        const groups = workout.groups.map((group, groupIndex) => ({
          ref: cleanOptional(group.draftId || group.id) || `group-${groupIndex}`,
          title: cleanOptional(group.title) || `Комбо ${groupIndex + 1}`,
          sets: cleanOptional(group.sets),
          rest: cleanOptional(group.rest),
          notes: cleanOptional(group.notes),
          sort_order: Number.isFinite(Number(group.sortOrder)) ? Number(group.sortOrder) : groupIndex,
        }));
        const groupRefs = new Set(groups.map((group) => group.ref));
        const exercises = workout.exercises
          .map((exercise, exerciseIndex) => ({
            group_ref: cleanOptional(exercise.groupDraftId || exercise.groupId),
            exercise_id: cleanOptional(exercise.exerciseId),
            exercise_title: cleanOptional(exercise.exerciseTitle),
            sets: cleanOptional(exercise.sets),
            reps: cleanOptional(exercise.reps),
            rest: cleanOptional(exercise.rest),
            tempo: cleanOptional(exercise.tempo),
            notes: cleanOptional(exercise.notes),
            sort_order: Number.isFinite(Number(exercise.sortOrder)) ? Number(exercise.sortOrder) : exerciseIndex,
          }))
          .filter((exercise) => exercise.exercise_id && exercise.exercise_title);

        const missingGroup = exercises.find((exercise) => exercise.group_ref && !groupRefs.has(exercise.group_ref));
        if (missingGroup) return { ok: false, reason: "invalid", message: "Exercise group does not belong to workout" };

        const groupIdByRef = new Map<string, string>();
        if (groups.length > 0) {
          const { data: createdGroups, error: groupErr } = await sb
            .from("program_template_exercise_groups")
            .insert(
              groups.map((group) => ({
                program_template_workout_id: workoutId,
                title: group.title,
                sets: group.sets,
                rest: group.rest,
                notes: group.notes,
                sort_order: group.sort_order,
              }))
            )
            .select("id, sort_order");
          if (groupErr) return { ok: false, reason: "db_error", message: groupErr.message };

          const createdGroupsSorted = ((Array.isArray(createdGroups) ? createdGroups : []) as { id?: string; sort_order?: number | null }[])
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
          groups.forEach((group, groupIndex) => {
            const id = createdGroupsSorted[groupIndex]?.id;
            if (id) groupIdByRef.set(group.ref, id);
          });
          if (groupIdByRef.size !== groups.length) {
            return { ok: false, reason: "db_error", message: "Template exercise groups were not created" };
          }
        }

        if (exercises.length > 0) {
          const { error: exerciseErr } = await sb.from("program_template_exercises").insert(
            exercises.map((exercise) => ({
              program_template_workout_id: workoutId,
              exercise_group_id: exercise.group_ref ? groupIdByRef.get(exercise.group_ref) || null : null,
              exercise_id: exercise.exercise_id,
              exercise_title: exercise.exercise_title,
              sets: exercise.group_ref ? null : exercise.sets,
              reps: exercise.reps,
              rest: exercise.group_ref ? null : exercise.rest,
              tempo: exercise.tempo,
              notes: exercise.notes,
              sort_order: exercise.sort_order,
            }))
          );
          if (exerciseErr) return { ok: false, reason: "db_error", message: exerciseErr.message };
        }
      }
    }
  }

  return getProgramTemplate(params.coachEmail, programId);
}

export async function deactivateProgramTemplate(params: {
  coachEmail: string;
  programId: string;
}): Promise<ProgramTemplateResult<{ id: string }>> {
  const sb = getSupabaseAdmin();
  if (!isSupabaseEnabled("read_coach_lk") || !sb) return { ok: false, reason: "disabled" };
  const coach = await getCoachForProgram(params.coachEmail);
  if (!coach) return { ok: false, reason: "forbidden" };

  const programId = String(params.programId || "").trim();
  const { data, error } = await sb
    .from("program_templates")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", programId)
    .eq("coach_id", coach.id)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, reason: "db_error", message: error.message };
  if (!data) return { ok: false, reason: "not_found" };
  return { ok: true, data: { id: programId } };
}

export async function duplicateProgramTemplate(params: {
  coachEmail: string;
  programId: string;
}): Promise<ProgramTemplateResult<ProgramTemplate>> {
  const source = await getProgramTemplate(params.coachEmail, params.programId);
  if (!source.ok) return source;

  const created = await createProgramTemplate({
    coachEmail: params.coachEmail,
    title: `${source.data.title} копия`,
  });
  if (!created.ok) return created;

  return updateProgramTemplate({
    coachEmail: params.coachEmail,
    programId: created.data.id,
    description: source.data.description || null,
    durationDays: source.data.durationDays,
    weeksCount: source.data.weeksCount,
    level: source.data.level || null,
    goal: source.data.goal || null,
    tags: source.data.tags,
    workouts: (source.data.workouts || []).map((workout) => ({
      dayNumber: workout.dayNumber,
      weekNumber: workout.weekNumber,
      title: workout.title,
      summary: workout.summary,
      estimatedMinutes: workout.estimatedMinutes,
      workoutType: workout.workoutType,
      sortOrder: workout.sortOrder,
      groups: workout.groups.map((group) => ({
        id: group.id,
        title: group.title,
        sets: group.sets,
        rest: group.rest,
        notes: group.notes,
        sortOrder: group.sortOrder,
      })),
      exercises: workout.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        groupId: exercise.groupId,
        exerciseTitle: exercise.title,
        sets: exercise.sets,
        reps: exercise.reps,
        rest: exercise.rest,
        tempo: exercise.tempo,
        notes: exercise.notes,
        sortOrder: exercise.sortOrder,
      })),
    })),
  });
}

export async function assignProgramTemplate(params: {
  coachEmail: string;
  programId: string;
  clientId: string;
  startDate: string;
}): Promise<ProgramTemplateResult<{ assignmentId: string; createdWorkouts: number }>> {
  const sb = getSupabaseAdmin();
  if (!isSupabaseEnabled("read_coach_lk") || !sb) return { ok: false, reason: "disabled" };
  const coach = await getCoachForProgram(params.coachEmail);
  if (!coach) return { ok: false, reason: "forbidden" };

  const clientId = String(params.clientId || "").trim();
  const startDate = String(params.startDate || "").trim();
  if (!clientId || !isDateKey(startDate)) return { ok: false, reason: "invalid", message: "Missing assignment fields" };

  const ownsStudent = await assertCoachOwnsStudent(coach.id, clientId);
  if (!ownsStudent) return { ok: false, reason: "forbidden" };

  const template = await getProgramTemplate(params.coachEmail, params.programId);
  if (!template.ok) return template;
  const workouts = template.data.workouts || [];

  const program = await ensureActiveClientProgram({
    clientId,
    coachId: coach.id,
    startDate,
    title: template.data.title,
  });
  if (!program.ok) return { ok: false, reason: "db_error", message: program.message };

  for (const workout of workouts) {
    const workoutDate = addDays(startDate, Math.max(0, workout.dayNumber - 1));
    const { data: createdWorkout, error: workoutErr } = await sb
      .from("client_program_workouts")
      .insert({
        client_program_id: program.programId,
        client_id: clientId,
        coach_id: coach.id,
        workout_date: workoutDate,
        title: workout.title,
        coach_comment: cleanOptional(workout.summary),
        status: "planned",
      })
      .select("id")
      .single();

    if (workoutErr || !createdWorkout || typeof createdWorkout.id !== "string") {
      return { ok: false, reason: "db_error", message: workoutErr?.message || "Runtime workout was not created" };
    }

    const groupIdByTemplateId = new Map<string, string>();
    if (workout.groups.length > 0) {
      const { data: createdGroups, error: groupErr } = await sb
        .from("client_program_exercise_groups")
        .insert(
          workout.groups.map((group) => ({
            client_program_workout_id: createdWorkout.id,
            title: group.title,
            sets: group.sets || null,
            rest: group.rest || null,
            notes: group.notes || null,
            sort_order: group.sortOrder,
          }))
        )
        .select("id, sort_order");
      if (groupErr) return { ok: false, reason: "db_error", message: groupErr.message };

      const createdGroupsSorted = ((Array.isArray(createdGroups) ? createdGroups : []) as { id?: string; sort_order?: number | null }[])
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      workout.groups.forEach((group, index) => {
        const id = createdGroupsSorted[index]?.id;
        if (id) groupIdByTemplateId.set(group.id, id);
      });
    }

    if (workout.exercises.length > 0) {
      const { error: exerciseErr } = await sb.from("client_program_exercises").insert(
        workout.exercises.map((exercise) => ({
          client_program_workout_id: createdWorkout.id,
          exercise_group_id: exercise.groupId ? groupIdByTemplateId.get(exercise.groupId) || null : null,
          exercise_id: exercise.exerciseId || null,
          exercise_title: exercise.title,
          sets: exercise.groupId ? null : exercise.sets || null,
          reps: exercise.reps || null,
          rest: exercise.groupId ? null : exercise.rest || null,
          tempo: exercise.tempo || null,
          notes: exercise.notes || null,
          sort_order: exercise.sortOrder,
        }))
      );
      if (exerciseErr) return { ok: false, reason: "db_error", message: exerciseErr.message };
    }
  }

  const { data: assignment, error: assignmentErr } = await sb
    .from("program_assignments")
    .insert({
      program_template_id: template.data.id,
      client_id: clientId,
      assigned_by_coach_id: coach.id,
      start_date: startDate,
      status: "active",
    })
    .select("id")
    .single();

  if (assignmentErr || !assignment || typeof assignment.id !== "string") {
    return { ok: false, reason: "db_error", message: assignmentErr?.message || "Assignment was not created" };
  }

  return { ok: true, data: { assignmentId: assignment.id, createdWorkouts: workouts.length } };
}
