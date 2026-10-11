import "server-only";

import { getCoachByEmail } from "@/lib/supabase/coachStudents";
import { getSupabaseAdmin, isSupabaseEnabled } from "@/lib/supabase/server";

const ITEMS_LIMIT = 50;
const PAGE_SIZE = 1000;
const IN_CHUNK_SIZE = 200;

export type CoachNotificationKind = "awaiting_review" | "unsubmitted_video";

export type CoachNotificationItem = {
  kind: CoachNotificationKind;
  studentId: string;
  studentName: string;
  workoutId: string;
  workoutTitle: string;
  workoutDate: string;
  calendarHref: string;
  isUnread?: boolean;
  submittedAt?: string | null;
  videoCount?: number;
  lastVideoAt?: string | null;
};

export type CoachNotificationSummary = {
  awaitingReviewCount: number;
  unreadCount: number;
  awaitingReviewItems: CoachNotificationItem[];
  unsubmittedVideoItems: CoachNotificationItem[];
  generatedAt: string;
};

export type CoachNotificationSummaryResult =
  | { ok: true; summary: CoachNotificationSummary }
  | { ok: false; reason: "disabled" | "no_supabase_client" | "forbidden" | "db_error"; message?: string };

type SupabaseAdmin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

type ClientRow = {
  id?: string | null;
  fio?: string | null;
  email?: string | null;
};

type WorkoutRow = {
  id?: string | null;
  client_id?: string | null;
  workout_date?: string | null;
  title?: string | null;
  status?: string | null;
  submitted_at?: string | null;
  coach_viewed_at?: string | null;
  updated_at?: string | null;
};

type ExerciseRow = {
  id?: string | null;
  client_program_workout_id?: string | null;
};

type ResultRow = {
  id?: string | null;
  client_program_exercise_id?: string | null;
  submitted_at?: string | null;
  updated_at?: string | null;
};

type VideoRow = {
  student_exercise_result_id?: string | null;
  created_at?: string | null;
};

function cleanOptional(raw: unknown): string | null {
  const value = String(raw || "").trim();
  return value || null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function studentName(row: ClientRow) {
  return cleanOptional(row.fio) || cleanOptional(row.email) || "—";
}

function calendarHref(studentId: string) {
  return `/lk/coach/students/${encodeURIComponent(studentId)}?tab=calendar`;
}

function compareNullableIsoAsc(a?: string | null, b?: string | null) {
  const av = cleanOptional(a);
  const bv = cleanOptional(b);
  if (av && bv && av !== bv) return av.localeCompare(bv);
  if (av && !bv) return -1;
  if (!av && bv) return 1;
  return 0;
}

function compareNullableIsoDesc(a?: string | null, b?: string | null) {
  return compareNullableIsoAsc(b, a);
}

function normalizeAwaitingItem(row: WorkoutRow, clientsById: Map<string, ClientRow>): CoachNotificationItem | null {
  const workoutId = cleanOptional(row.id);
  const studentId = cleanOptional(row.client_id);
  if (!workoutId || !studentId) return null;

  const submittedAt = cleanOptional(row.submitted_at) || cleanOptional(row.updated_at);
  return {
    kind: "awaiting_review",
    studentId,
    studentName: studentName(clientsById.get(studentId) || { id: studentId }),
    workoutId,
    workoutTitle: cleanOptional(row.title) || "Тренировка",
    workoutDate: cleanOptional(row.workout_date) || "",
    calendarHref: calendarHref(studentId),
    isUnread: !cleanOptional(row.coach_viewed_at),
    submittedAt,
  };
}

async function loadActiveClientsForCoach(
  sb: SupabaseAdmin,
  email: string
): Promise<{ ok: true; clients: ClientRow[] } | { ok: false; reason: "forbidden" | "db_error"; message?: string }> {
  const coach = await getCoachByEmail(email);
  if (!coach) return { ok: false, reason: "forbidden" };

  const { data: links, error: linkErr } = await sb
    .from("coach_clients")
    .select("client_id")
    .eq("coach_id", coach.id)
    .eq("is_active", true);

  if (linkErr) return { ok: false, reason: "db_error", message: linkErr.message };

  const clientIds = (Array.isArray(links) ? links : [])
    .map((link) => cleanOptional((link as { client_id?: string | null }).client_id))
    .filter((id): id is string => Boolean(id));

  if (clientIds.length === 0) return { ok: true, clients: [] };

  const clients: ClientRow[] = [];
  for (const ids of chunk(clientIds, IN_CHUNK_SIZE)) {
    const { data, error } = await sb
      .from("clients")
      .select("id, fio, email")
      .in("id", ids)
      .eq("is_active", true);

    if (error) return { ok: false, reason: "db_error", message: error.message };
    clients.push(...((Array.isArray(data) ? data : []) as ClientRow[]));
  }

  return { ok: true, clients };
}

async function countSubmittedWorkouts(sb: SupabaseAdmin, clientIds: string[], unreadOnly: boolean) {
  let total = 0;
  for (const ids of chunk(clientIds, IN_CHUNK_SIZE)) {
    let query = sb
      .from("client_program_workouts")
      .select("id", { count: "exact", head: true })
      .in("client_id", ids)
      .eq("status", "submitted");

    if (unreadOnly) {
      query = query.is("coach_viewed_at", null);
    }

    const { count, error } = await query;
    if (error) throw error;
    total += count ?? 0;
  }
  return total;
}

async function loadAwaitingReviewItems(
  sb: SupabaseAdmin,
  clientIds: string[],
  clientsById: Map<string, ClientRow>
) {
  const rows: WorkoutRow[] = [];
  for (const ids of chunk(clientIds, IN_CHUNK_SIZE)) {
    const { data: unreadData, error: unreadError } = await sb
      .from("client_program_workouts")
      .select("id, client_id, workout_date, title, status, submitted_at, coach_viewed_at, updated_at")
      .in("client_id", ids)
      .eq("status", "submitted")
      .is("coach_viewed_at", null)
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false, nullsFirst: false })
      .order("workout_date", { ascending: false })
      .limit(ITEMS_LIMIT);

    if (unreadError) throw unreadError;
    rows.push(...((Array.isArray(unreadData) ? unreadData : []) as WorkoutRow[]));

    const { data: viewedData, error: viewedError } = await sb
      .from("client_program_workouts")
      .select("id, client_id, workout_date, title, status, submitted_at, coach_viewed_at, updated_at")
      .in("client_id", ids)
      .eq("status", "submitted")
      .not("coach_viewed_at", "is", null)
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false, nullsFirst: false })
      .order("workout_date", { ascending: false })
      .limit(ITEMS_LIMIT);

    if (viewedError) throw viewedError;
    rows.push(...((Array.isArray(viewedData) ? viewedData : []) as WorkoutRow[]));
  }

  return rows
    .map((row) => normalizeAwaitingItem(row, clientsById))
    .filter((item): item is CoachNotificationItem => Boolean(item))
    .sort(
      (a, b) =>
        Number(b.isUnread === true) - Number(a.isUnread === true) ||
        compareNullableIsoDesc(a.submittedAt, b.submittedAt) ||
        b.workoutDate.localeCompare(a.workoutDate) ||
        a.studentName.localeCompare(b.studentName, "ru") ||
        a.workoutTitle.localeCompare(b.workoutTitle, "ru") ||
        a.workoutId.localeCompare(b.workoutId)
    )
    .slice(0, ITEMS_LIMIT);
}

async function loadPlannedWorkouts(sb: SupabaseAdmin, clientIds: string[]) {
  const rows: WorkoutRow[] = [];

  for (const ids of chunk(clientIds, IN_CHUNK_SIZE)) {
    let from = 0;
    while (true) {
      const { data, error } = await sb
        .from("client_program_workouts")
        .select("id, client_id, workout_date, title, status, updated_at")
        .in("client_id", ids)
        .eq("status", "planned")
        .order("updated_at", { ascending: false, nullsFirst: false })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      const page = (Array.isArray(data) ? data : []) as WorkoutRow[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }

  return rows;
}

async function loadExercisesForWorkouts(sb: SupabaseAdmin, workoutIds: string[]) {
  const rows: ExerciseRow[] = [];
  for (const ids of chunk(workoutIds, IN_CHUNK_SIZE)) {
    const { data, error } = await sb
      .from("client_program_exercises")
      .select("id, client_program_workout_id")
      .in("client_program_workout_id", ids);

    if (error) throw error;
    rows.push(...((Array.isArray(data) ? data : []) as ExerciseRow[]));
  }
  return rows;
}

async function loadResultsForExercises(sb: SupabaseAdmin, exerciseIds: string[]) {
  const rows: ResultRow[] = [];
  for (const ids of chunk(exerciseIds, IN_CHUNK_SIZE)) {
    const { data, error } = await sb
      .from("student_exercise_results")
      .select("id, client_program_exercise_id, submitted_at, updated_at")
      .in("client_program_exercise_id", ids);

    if (error) throw error;
    rows.push(...((Array.isArray(data) ? data : []) as ResultRow[]));
  }
  return rows;
}

async function loadVideosForResults(sb: SupabaseAdmin, resultIds: string[]) {
  const rows: VideoRow[] = [];
  for (const ids of chunk(resultIds, IN_CHUNK_SIZE)) {
    const { data, error } = await sb
      .from("student_exercise_result_videos")
      .select("student_exercise_result_id, created_at")
      .in("student_exercise_result_id", ids);

    if (error) throw error;
    rows.push(...((Array.isArray(data) ? data : []) as VideoRow[]));
  }
  return rows;
}

async function loadUnsubmittedVideoItems(
  sb: SupabaseAdmin,
  clientIds: string[],
  clientsById: Map<string, ClientRow>
) {
  const workouts = await loadPlannedWorkouts(sb, clientIds);
  const workoutsById = new Map<string, WorkoutRow>();
  for (const row of workouts) {
    const id = cleanOptional(row.id);
    if (id) workoutsById.set(id, row);
  }

  const workoutIds = Array.from(workoutsById.keys());
  if (workoutIds.length === 0) return [];

  const exercises = await loadExercisesForWorkouts(sb, workoutIds);
  const workoutIdByExerciseId = new Map<string, string>();
  for (const row of exercises) {
    const exerciseId = cleanOptional(row.id);
    const workoutId = cleanOptional(row.client_program_workout_id);
    if (exerciseId && workoutId) workoutIdByExerciseId.set(exerciseId, workoutId);
  }

  const exerciseIds = Array.from(workoutIdByExerciseId.keys());
  if (exerciseIds.length === 0) return [];

  const results = await loadResultsForExercises(sb, exerciseIds);
  const workoutIdByResultId = new Map<string, string>();
  const resultSubmittedAtById = new Map<string, string>();
  for (const row of results) {
    const resultId = cleanOptional(row.id);
    const exerciseId = cleanOptional(row.client_program_exercise_id);
    const workoutId = exerciseId ? workoutIdByExerciseId.get(exerciseId) : undefined;
    if (resultId && workoutId) {
      workoutIdByResultId.set(resultId, workoutId);
      resultSubmittedAtById.set(resultId, cleanOptional(row.submitted_at) || cleanOptional(row.updated_at) || "");
    }
  }

  const resultIds = Array.from(workoutIdByResultId.keys());
  if (resultIds.length === 0) return [];

  const videos = await loadVideosForResults(sb, resultIds);
  const grouped = new Map<string, { videoCount: number; lastVideoAt: string | null }>();

  for (const row of videos) {
    const resultId = cleanOptional(row.student_exercise_result_id);
    const workoutId = resultId ? workoutIdByResultId.get(resultId) : undefined;
    if (!workoutId) continue;

    const timestamp = cleanOptional(row.created_at) || (resultId ? resultSubmittedAtById.get(resultId) || null : null);
    const current = grouped.get(workoutId) || { videoCount: 0, lastVideoAt: null };
    current.videoCount += 1;
    if (compareNullableIsoDesc(timestamp, current.lastVideoAt) < 0) {
      current.lastVideoAt = timestamp;
    }
    grouped.set(workoutId, current);
  }

  return Array.from(grouped.entries())
    .flatMap(([workoutId, meta]) => {
      const workout = workoutsById.get(workoutId);
      const studentId = cleanOptional(workout?.client_id);
      if (!workout || !studentId || meta.videoCount <= 0) return [];

      return [
        {
          kind: "unsubmitted_video" as const,
          studentId,
          studentName: studentName(clientsById.get(studentId) || { id: studentId }),
          workoutId,
          workoutTitle: cleanOptional(workout.title) || "Тренировка",
          workoutDate: cleanOptional(workout.workout_date) || "",
          calendarHref: calendarHref(studentId),
          videoCount: meta.videoCount,
          lastVideoAt: meta.lastVideoAt,
        },
      ];
    })
    .sort(
      (a, b) =>
        compareNullableIsoDesc(a.lastVideoAt, b.lastVideoAt) ||
        a.studentName.localeCompare(b.studentName, "ru") ||
        a.workoutDate.localeCompare(b.workoutDate) ||
        a.workoutTitle.localeCompare(b.workoutTitle, "ru") ||
        a.workoutId.localeCompare(b.workoutId)
    )
    .slice(0, ITEMS_LIMIT);
}

export async function getCoachNotificationSummary(email: string): Promise<CoachNotificationSummaryResult> {
  if (!isSupabaseEnabled("read_coach_lk")) return { ok: false, reason: "disabled" };
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "no_supabase_client" };

  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return { ok: false, reason: "forbidden" };

  try {
    const clientsResult = await loadActiveClientsForCoach(sb, normalized);
    if (!clientsResult.ok) return clientsResult;

    const clients = clientsResult.clients;
    const clientIds = clients.map((client) => cleanOptional(client.id)).filter((id): id is string => Boolean(id));
    const clientsById = new Map(clients.flatMap((client) => {
      const id = cleanOptional(client.id);
      return id ? [[id, client] as const] : [];
    }));

    if (clientIds.length === 0) {
      return {
        ok: true,
        summary: {
          awaitingReviewCount: 0,
          unreadCount: 0,
          awaitingReviewItems: [],
          unsubmittedVideoItems: [],
          generatedAt: new Date().toISOString(),
        },
      };
    }

    const [awaitingReviewCount, unreadCount, awaitingReviewItems, unsubmittedVideoItems] = await Promise.all([
      countSubmittedWorkouts(sb, clientIds, false),
      countSubmittedWorkouts(sb, clientIds, true),
      loadAwaitingReviewItems(sb, clientIds, clientsById),
      loadUnsubmittedVideoItems(sb, clientIds, clientsById),
    ]);

    return {
      ok: true,
      summary: {
        awaitingReviewCount,
        unreadCount,
        awaitingReviewItems,
        unsubmittedVideoItems,
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[supabase/coachNotifications] summary failed", message);
    return { ok: false, reason: "db_error", message };
  }
}
