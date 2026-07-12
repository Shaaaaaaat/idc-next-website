import "server-only";

import { getCoachByEmail } from "@/lib/supabase/coachStudents";
import {
  actorFromCoach,
  canArchiveProgram,
  canEditProgram,
  canReadProgram,
  getOwnerType,
  isPrivilegedActor,
  type LkOwnerType,
  type LkResourceActor,
} from "@/lib/supabase/lkAccessControl";
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
  isGlobal: boolean;
  title: string;
  description?: string;
  durationDays: number;
  weeksCount: number;
  level?: string;
  goal?: string;
  tags: string[];
  isActive: boolean;
  ownerType: LkOwnerType;
  canEdit: boolean;
  canArchive: boolean;
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
  | { ok: false; reason: "disabled" | "invalid" | "forbidden" | "not_found" | "stale" | "db_error"; message?: string };

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

type CoachClientProgramPreference = {
  programTemplateId: string | null;
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

function isDateKey(raw: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw);
}

function countProgramTemplateStructure(program: ProgramTemplate) {
  const workouts = program.workouts || [];
  return {
    workouts: workouts.length,
    exercises: workouts.reduce((total, workout) => total + workout.exercises.length, 0),
    groups: workouts.reduce((total, workout) => total + workout.groups.length, 0),
    groupedExercises: workouts.reduce(
      (total, workout) => total + workout.exercises.filter((exercise) => Boolean(exercise.groupId)).length,
      0
    ),
  };
}

function mapTemplate(row: ProgramTemplateRow, workoutsCount = 0, actor?: LkResourceActor | null): ProgramTemplate {
  const coachId = String(row.coach_id || "").trim();
  const resource = { coachId };
  return {
    id: row.id,
    coachId,
    isGlobal: !coachId,
    title: String(row.title || "").trim() || "Программа",
    description: cleanOptional(row.description) || undefined,
    durationDays: toPositiveInt(row.duration_days, 1),
    weeksCount: toPositiveInt(row.weeks_count, Math.max(1, Math.ceil(toPositiveInt(row.duration_days, 1) / 7))),
    level: cleanOptional(row.level) || undefined,
    goal: cleanOptional(row.goal) || undefined,
    tags: cleanTags(row.tags),
    isActive: row.is_active !== false,
    ownerType: getOwnerType(actor || null, resource),
    canEdit: actor ? canEditProgram(actor, resource) : false,
    canArchive: actor ? canArchiveProgram(actor, resource) : false,
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

async function getCoachForProgram(coachEmail: string) {
  if (!isSupabaseEnabled("read_coach_lk")) return null;
  const normalized = String(coachEmail || "").trim().toLowerCase();
  if (!normalized) return null;
  return getCoachByEmail(normalized);
}

async function getReadableProgramTemplateRow(
  coachEmail: string,
  programId: string
): Promise<ProgramTemplateResult<{ id: string }>> {
  const sb = getSupabaseAdmin();
  if (!isSupabaseEnabled("read_coach_lk") || !sb) return { ok: false, reason: "disabled" };
  const coach = await getCoachForProgram(coachEmail);
  if (!coach) return { ok: false, reason: "forbidden" };
  const actor = actorFromCoach(coach);
  const id = String(programId || "").trim();
  if (!id) return { ok: false, reason: "invalid" };

  let query = sb
    .from("program_templates")
    .select("id, coach_id")
    .eq("id", id)
    .eq("is_active", true);

  if (!isPrivilegedActor(actor)) {
    query = query.or(`coach_id.eq.${coach.id},coach_id.is.null`);
  }

  const { data, error } = await query.maybeSingle();
  if (error) return { ok: false, reason: "db_error", message: error.message };
  if (!data) return { ok: false, reason: "not_found" };
  if (!canReadProgram(actor, { coachId: (data as { coach_id?: string | null }).coach_id })) {
    return { ok: false, reason: "not_found" };
  }
  return { ok: true, data: { id } };
}

export async function getLastProgramTemplatePreference(params: {
  coachEmail: string;
  clientId: string;
}): Promise<ProgramTemplateResult<CoachClientProgramPreference>> {
  const sb = getSupabaseAdmin();
  if (!isSupabaseEnabled("read_coach_lk") || !sb) return { ok: false, reason: "disabled" };
  const coach = await getCoachForProgram(params.coachEmail);
  if (!coach) return { ok: false, reason: "forbidden" };
  const clientId = String(params.clientId || "").trim();
  if (!clientId) return { ok: false, reason: "invalid" };

  const { data: link, error: linkErr } = await sb
    .from("coach_clients")
    .select("last_program_template_id")
    .eq("coach_id", coach.id)
    .eq("client_id", clientId)
    .eq("is_active", true)
    .maybeSingle();

  if (linkErr) return { ok: false, reason: "db_error", message: linkErr.message };
  if (!link) return { ok: false, reason: "forbidden" };

  const programTemplateId = cleanOptional((link as { last_program_template_id?: string | null }).last_program_template_id);
  if (!programTemplateId) return { ok: true, data: { programTemplateId: null } };

  const readable = await getReadableProgramTemplateRow(params.coachEmail, programTemplateId);
  if (readable.ok) return { ok: true, data: { programTemplateId } };
  if (readable.reason === "not_found" || readable.reason === "forbidden") {
    return { ok: true, data: { programTemplateId: null } };
  }
  return readable;
}

export async function saveLastProgramTemplatePreference(params: {
  coachEmail: string;
  clientId: string;
  programTemplateId: string;
}): Promise<ProgramTemplateResult<{ preferenceSaved: boolean }>> {
  const sb = getSupabaseAdmin();
  if (!isSupabaseEnabled("read_coach_lk") || !sb) return { ok: false, reason: "disabled" };
  const coach = await getCoachForProgram(params.coachEmail);
  if (!coach) return { ok: false, reason: "forbidden" };
  const clientId = String(params.clientId || "").trim();
  const programTemplateId = String(params.programTemplateId || "").trim();
  if (!clientId || !programTemplateId) return { ok: false, reason: "invalid" };

  const readable = await getReadableProgramTemplateRow(params.coachEmail, programTemplateId);
  if (!readable.ok) return readable;

  const { data, error } = await sb
    .from("coach_clients")
    .update({
      last_program_template_id: programTemplateId,
      updated_at: new Date().toISOString(),
    })
    .eq("coach_id", coach.id)
    .eq("client_id", clientId)
    .eq("is_active", true)
    .select("client_id")
    .maybeSingle();

  if (error) return { ok: false, reason: "db_error", message: error.message };
  return { ok: true, data: { preferenceSaved: Boolean(data) } };
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
  const actor = actorFromCoach(coach);

  let query = sb
    .from("program_templates")
    .select("id, coach_id, title, description, duration_days, weeks_count, level, goal, tags, is_active, created_at, updated_at")
    .eq("is_active", true)
    .order("updated_at", { ascending: false });

  if (!isPrivilegedActor(actor)) {
    query = query.or(`coach_id.eq.${coach.id},coach_id.is.null`);
  }

  const { data, error } = await query;

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

  return rows.map((row) => mapTemplate(row, countByTemplate.get(row.id) || 0, actor));
}

export async function getProgramTemplate(
  coachEmail: string,
  programId: string
): Promise<ProgramTemplateResult<ProgramTemplate>> {
  const sb = getSupabaseAdmin();
  if (!isSupabaseEnabled("read_coach_lk") || !sb) return { ok: false, reason: "disabled" };
  const coach = await getCoachForProgram(coachEmail);
  if (!coach) return { ok: false, reason: "forbidden" };
  const actor = actorFromCoach(coach);

  const id = String(programId || "").trim();
  if (!id) return { ok: false, reason: "invalid" };

  let templateQuery = sb
    .from("program_templates")
    .select("id, coach_id, title, description, duration_days, weeks_count, level, goal, tags, is_active, created_at, updated_at")
    .eq("id", id)
    .eq("is_active", true);

  if (!isPrivilegedActor(actor)) {
    templateQuery = templateQuery.or(`coach_id.eq.${coach.id},coach_id.is.null`);
  }

  const { data: template, error: templateErr } = await templateQuery.maybeSingle();

  if (templateErr) return { ok: false, reason: "db_error", message: templateErr.message };
  if (!template) return { ok: false, reason: "not_found" };
  if (!canReadProgram(actor, { coachId: (template as ProgramTemplateRow).coach_id })) {
    return { ok: false, reason: "not_found" };
  }

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
      ...mapTemplate(template as ProgramTemplateRow, workoutRows.length, actor),
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
  return { ok: true, data: mapTemplate(data as ProgramTemplateRow, 0, actorFromCoach(coach)) };
}

export async function updateProgramTemplate(params: {
  coachEmail: string;
  programId: string;
  expectedUpdatedAt?: string | null;
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
  const actor = actorFromCoach(coach);

  const programId = String(params.programId || "").trim();
  if (!programId) return { ok: false, reason: "invalid" };

  const { data: existingTemplate, error: existingTemplateErr } = await sb
    .from("program_templates")
    .select("coach_id")
    .eq("id", programId)
    .eq("is_active", true)
    .maybeSingle();

  if (existingTemplateErr) return { ok: false, reason: "db_error", message: existingTemplateErr.message };
  if (!existingTemplate) return { ok: false, reason: "not_found" };
  const existingCoachId = cleanOptional((existingTemplate as { coach_id?: string | null }).coach_id);
  if (existingCoachId && existingCoachId !== coach.id && !isPrivilegedActor(actor)) {
    return { ok: false, reason: "not_found" };
  }
  if (!canEditProgram(actor, { coachId: existingCoachId })) {
    return { ok: false, reason: "forbidden" };
  }

  const payload: Record<string, unknown> = {};
  if (params.title !== undefined) {
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, reason: "invalid", message: "Program title is required" };
    payload.title = title;
  }
  if (params.description !== undefined) payload.description = cleanOptional(params.description);
  if (params.durationDays !== undefined) payload.durationDays = toPositiveInt(params.durationDays, 1);
  if (params.weeksCount !== undefined) payload.weeksCount = toPositiveInt(params.weeksCount, 1);
  if (params.level !== undefined) payload.level = cleanOptional(params.level);
  if (params.goal !== undefined) payload.goal = cleanOptional(params.goal);
  if (params.tags !== undefined) payload.tags = cleanTags(params.tags);
  if (Array.isArray(params.workouts)) {
    payload.workouts = params.workouts;
  }

  const { data: rpcData, error: rpcError } = await sb.rpc("save_program_template_diff", {
    p_program_id: programId,
    p_coach_email: params.coachEmail,
    p_expected_updated_at: cleanOptional(params.expectedUpdatedAt),
    p_payload: payload,
  });

  if (rpcError) {
    console.warn("[supabase/programTemplates] save_program_template_diff failed", {
      message: rpcError.message,
      code: rpcError.code,
      details: rpcError.details,
      hint: rpcError.hint,
    });
    return { ok: false, reason: "db_error", message: rpcError.message };
  }

  const rpcResult = (rpcData || {}) as { ok?: boolean; error?: string; message?: string };
  if (rpcResult.ok === false) {
    const reason = rpcResult.error;
    if (reason === "invalid" || reason === "forbidden" || reason === "not_found" || reason === "stale") {
      return { ok: false, reason, message: rpcResult.message };
    }
    return { ok: false, reason: "db_error", message: rpcResult.message || reason || "Program was not saved" };
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
  const actor = actorFromCoach(coach);

  const programId = String(params.programId || "").trim();
  if (!programId) return { ok: false, reason: "invalid" };

  const { data: existingTemplate, error: existingTemplateErr } = await sb
    .from("program_templates")
    .select("coach_id")
    .eq("id", programId)
    .eq("is_active", true)
    .maybeSingle();

  if (existingTemplateErr) return { ok: false, reason: "db_error", message: existingTemplateErr.message };
  if (!existingTemplate) return { ok: false, reason: "not_found" };
  const existingCoachId = cleanOptional((existingTemplate as { coach_id?: string | null }).coach_id);
  if (existingCoachId && existingCoachId !== coach.id && !isPrivilegedActor(actor)) {
    return { ok: false, reason: "not_found" };
  }
  if (!canArchiveProgram(actor, { coachId: existingCoachId })) {
    return { ok: false, reason: "forbidden" };
  }

  let updateQuery = sb
    .from("program_templates")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", programId)
    .eq("is_active", true);

  if (existingCoachId && !isPrivilegedActor(actor)) {
    updateQuery = updateQuery.eq("coach_id", coach.id);
  }

  const { data, error } = await updateQuery.select("id").maybeSingle();

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
  const sourceCounts = countProgramTemplateStructure(source.data);

  const created = await createProgramTemplate({
    coachEmail: params.coachEmail,
    title: `${source.data.title} копия`,
  });
  if (!created.ok) return created;

  const copiedWorkouts: ProgramTemplateWorkoutInput[] = (source.data.workouts || []).map((workout, workoutIndex) => {
    const groupDraftIdBySourceId = new Map<string, string>();
    const groups = workout.groups.map((group, groupIndex) => {
      const draftId = `copy-w${workoutIndex}-g${groupIndex}`;
      groupDraftIdBySourceId.set(group.id, draftId);
      return {
        draftId,
        title: group.title,
        sets: group.sets,
        rest: group.rest,
        notes: group.notes,
        sortOrder: group.sortOrder,
      };
    });

    return {
      dayNumber: workout.dayNumber,
      weekNumber: workout.weekNumber,
      title: workout.title,
      summary: workout.summary,
      estimatedMinutes: workout.estimatedMinutes,
      workoutType: workout.workoutType,
      sortOrder: workout.sortOrder,
      groups,
      exercises: workout.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        groupDraftId: exercise.groupId ? groupDraftIdBySourceId.get(exercise.groupId) : undefined,
        exerciseTitle: exercise.title,
        sets: exercise.sets,
        reps: exercise.reps,
        rest: exercise.rest,
        tempo: exercise.tempo,
        notes: exercise.notes,
        sortOrder: exercise.sortOrder,
      })),
    };
  });

  const copied = await updateProgramTemplate({
    coachEmail: params.coachEmail,
    programId: created.data.id,
    description: source.data.description || null,
    durationDays: source.data.durationDays,
    weeksCount: source.data.weeksCount,
    level: source.data.level || null,
    goal: source.data.goal || null,
    tags: source.data.tags,
    workouts: copiedWorkouts,
  });

  if (!copied.ok) return copied;

  const copyCounts = countProgramTemplateStructure(copied.data);
  if (
    copyCounts.workouts < sourceCounts.workouts ||
    copyCounts.exercises < sourceCounts.exercises ||
    copyCounts.groups < sourceCounts.groups ||
    copyCounts.groupedExercises < sourceCounts.groupedExercises
  ) {
    return {
      ok: false,
      reason: "db_error",
      message: `Program duplicate is incomplete: source ${sourceCounts.workouts} workouts, ${sourceCounts.exercises} exercises, ${sourceCounts.groups} groups; copy ${copyCounts.workouts} workouts, ${copyCounts.exercises} exercises, ${copyCounts.groups} groups`,
    };
  }

  return copied;
}

export async function assignProgramTemplate(params: {
  coachEmail: string;
  programId: string;
  clientId: string;
  startDate: string;
}): Promise<
  ProgramTemplateResult<{
    assignmentId: string;
    clientProgramId: string;
    createdWorkouts: number;
    reusedWorkouts: number;
    importedWorkouts: Array<{
      workoutDate: string;
      sourceTemplateWorkoutId: string;
      clientWorkoutId: string;
      status: "created" | "reused";
    }>;
  }>
> {
  const sb = getSupabaseAdmin();
  if (!isSupabaseEnabled("read_coach_lk") || !sb) return { ok: false, reason: "disabled" };

  const programId = String(params.programId || "").trim();
  const clientId = String(params.clientId || "").trim();
  const startDate = String(params.startDate || "").trim();
  if (!programId || !clientId || !isDateKey(startDate)) {
    return { ok: false, reason: "invalid", message: "Missing assignment fields" };
  }

  const { data: rpcData, error: rpcError } = await sb.rpc("import_program_template_workouts_to_client_calendar", {
    p_coach_email: params.coachEmail,
    p_client_id: clientId,
    p_program_template_id: programId,
    p_start_date: startDate,
    p_template_workout_ids: null,
    p_workout_dates: null,
  });

  if (rpcError) {
    console.warn("[supabase/programTemplates] import_program_template_workouts_to_client_calendar failed", {
      message: rpcError.message,
      code: rpcError.code,
      details: rpcError.details,
      hint: rpcError.hint,
    });
    return { ok: false, reason: "db_error", message: rpcError.message };
  }

  const rpcResult = (rpcData || {}) as {
    ok?: boolean;
    error?: string;
    message?: string;
    clientProgramId?: string;
    createdWorkouts?: number;
    reusedWorkouts?: number;
    importedWorkouts?: Array<{
      workoutDate?: string;
      sourceTemplateWorkoutId?: string;
      clientWorkoutId?: string;
      status?: string;
    }>;
  };

  if (rpcResult.ok === false) {
    const reason = rpcResult.error;
    if (reason === "invalid" || reason === "forbidden" || reason === "not_found" || reason === "stale") {
      return { ok: false, reason, message: rpcResult.message };
    }
    return { ok: false, reason: "db_error", message: rpcResult.message || reason || "Program was not imported" };
  }

  if (typeof rpcResult.clientProgramId !== "string" || !rpcResult.clientProgramId) {
    return { ok: false, reason: "db_error", message: "Program was not imported" };
  }

  const importedWorkouts = (Array.isArray(rpcResult.importedWorkouts) ? rpcResult.importedWorkouts : []).map(
    (item) => ({
      workoutDate: String(item.workoutDate || ""),
      sourceTemplateWorkoutId: String(item.sourceTemplateWorkoutId || ""),
      clientWorkoutId: String(item.clientWorkoutId || ""),
      status: item.status === "reused" ? ("reused" as const) : ("created" as const),
    })
  );

  return {
    ok: true,
    data: {
      assignmentId: rpcResult.clientProgramId,
      clientProgramId: rpcResult.clientProgramId,
      createdWorkouts: Number(rpcResult.createdWorkouts || 0),
      reusedWorkouts: Number(rpcResult.reusedWorkouts || 0),
      importedWorkouts,
    },
  };
}

export async function importProgramTemplateWorkoutsToCalendar(params: {
  coachEmail: string;
  programTemplateId: string;
  clientId: string;
  startDate: string;
  templateWorkoutIds: string[];
  workoutDates?: Record<string, string>;
}): Promise<
  ProgramTemplateResult<{
    clientProgramId: string;
    createdWorkouts: number;
    reusedWorkouts: number;
    workoutIds: string[];
    importedWorkouts: Array<{
      workoutDate: string;
      sourceTemplateWorkoutId: string;
      clientWorkoutId: string;
      status: "created" | "reused";
    }>;
  }>
> {
  const sb = getSupabaseAdmin();
  if (!isSupabaseEnabled("read_coach_lk") || !sb) return { ok: false, reason: "disabled" };

  const programTemplateId = String(params.programTemplateId || "").trim();
  const clientId = String(params.clientId || "").trim();
  const startDate = String(params.startDate || "").trim();
  const templateWorkoutIds = Array.from(
    new Set((params.templateWorkoutIds || []).map((id) => String(id || "").trim()).filter(Boolean))
  );

  if (!programTemplateId || !clientId || !isDateKey(startDate) || templateWorkoutIds.length === 0) {
    return { ok: false, reason: "invalid", message: "Missing calendar import fields" };
  }

  const workoutDates =
    params.workoutDates && Object.keys(params.workoutDates).length > 0
      ? Object.fromEntries(
          Object.entries(params.workoutDates)
            .map(([id, date]) => [String(id || "").trim(), String(date || "").trim()])
            .filter(([id, date]) => id && isDateKey(date))
        )
      : null;

  const { data: rpcData, error: rpcError } = await sb.rpc("import_program_template_workouts_to_client_calendar", {
    p_coach_email: params.coachEmail,
    p_client_id: clientId,
    p_program_template_id: programTemplateId,
    p_start_date: startDate,
    p_template_workout_ids: templateWorkoutIds,
    p_workout_dates: workoutDates,
  });

  if (rpcError) {
    console.warn("[supabase/programTemplates] selected template workout import failed", {
      message: rpcError.message,
      code: rpcError.code,
      details: rpcError.details,
      hint: rpcError.hint,
    });
    return { ok: false, reason: "db_error", message: rpcError.message };
  }

  const rpcResult = (rpcData || {}) as {
    ok?: boolean;
    error?: string;
    message?: string;
    clientProgramId?: string;
    createdWorkouts?: number;
    reusedWorkouts?: number;
    importedWorkouts?: Array<{
      workoutDate?: string;
      sourceTemplateWorkoutId?: string;
      clientWorkoutId?: string;
      status?: string;
    }>;
  };

  if (rpcResult.ok === false) {
    const reason = rpcResult.error;
    if (reason === "invalid" || reason === "forbidden" || reason === "not_found" || reason === "stale") {
      return { ok: false, reason, message: rpcResult.message };
    }
    return { ok: false, reason: "db_error", message: rpcResult.message || reason || "Workouts were not imported" };
  }

  if (typeof rpcResult.clientProgramId !== "string" || !rpcResult.clientProgramId) {
    return { ok: false, reason: "db_error", message: "Workouts were not imported" };
  }

  const importedWorkouts = (Array.isArray(rpcResult.importedWorkouts) ? rpcResult.importedWorkouts : []).map(
    (item) => ({
      workoutDate: String(item.workoutDate || ""),
      sourceTemplateWorkoutId: String(item.sourceTemplateWorkoutId || ""),
      clientWorkoutId: String(item.clientWorkoutId || ""),
      status: item.status === "reused" ? ("reused" as const) : ("created" as const),
    })
  );

  return {
    ok: true,
    data: {
      clientProgramId: rpcResult.clientProgramId,
      createdWorkouts: Number(rpcResult.createdWorkouts || 0),
      reusedWorkouts: Number(rpcResult.reusedWorkouts || 0),
      workoutIds: importedWorkouts.map((item) => item.clientWorkoutId).filter(Boolean),
      importedWorkouts,
    },
  };
}
