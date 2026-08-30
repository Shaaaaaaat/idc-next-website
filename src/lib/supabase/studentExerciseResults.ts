import "server-only";

import { getSupabaseAdmin, isSupabaseEnabled } from "@/lib/supabase/server";

export type StudentExerciseResultVideo = {
  videoAssetId: string;
  thumbnailUrl?: string;
  sortOrder: number;
};

export type StudentExerciseResult = {
  id: string;
  exerciseInstanceId: string;
  comment?: string;
  status: string;
  submittedAt: string;
  videos: StudentExerciseResultVideo[];
};

export type StudentExerciseInstance = {
  workoutId: string;
  exerciseInstanceId: string;
  title: string;
};

export type StudentExerciseResultInputVideo = {
  videoAssetId: string;
  thumbnailUrl?: string;
};

export type StudentExerciseResultUpsertInput = {
  exerciseInstanceId: string;
  comment?: string | null;
  updateComment: boolean;
  replaceVideos: boolean;
  videos: StudentExerciseResultInputVideo[];
};

export type StudentExerciseResultOperationResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason: "disabled" | "invalid" | "not_found" | "too_many_videos" | "duplicate_video" | "db_error";
      message?: string;
    };

type WorkoutOwnershipRow = {
  id?: string | null;
};

type ExerciseInstanceRow = {
  id?: string | null;
  exercise_title?: string | null;
};

type ResultRow = {
  id?: string | null;
  client_program_exercise_id?: string | null;
  student_comment?: string | null;
  status?: string | null;
  submitted_at?: string | null;
};

type ResultVideoRow = {
  student_exercise_result_id?: string | null;
  video_asset_id?: string | null;
  thumbnail_url?: string | null;
  sort_order?: number | null;
};

function cleanOptional(raw: unknown): string | null {
  const value = String(raw || "").trim();
  return value || null;
}

function mapResult(row: ResultRow, videos: StudentExerciseResultVideo[]): StudentExerciseResult | null {
  const id = cleanOptional(row.id);
  const exerciseInstanceId = cleanOptional(row.client_program_exercise_id);
  const submittedAt = cleanOptional(row.submitted_at);
  if (!id || !exerciseInstanceId || !submittedAt) return null;

  return {
    id,
    exerciseInstanceId,
    comment: cleanOptional(row.student_comment) || undefined,
    status: cleanOptional(row.status) || "submitted",
    submittedAt,
    videos,
  };
}

function mapVideosByResultId(rows: ResultVideoRow[]): Map<string, StudentExerciseResultVideo[]> {
  const map = new Map<string, StudentExerciseResultVideo[]>();
  for (const row of rows) {
    const resultId = cleanOptional(row.student_exercise_result_id);
    const videoAssetId = cleanOptional(row.video_asset_id);
    if (!resultId || !videoAssetId) continue;

    const list = map.get(resultId) || [];
    list.push({
      videoAssetId,
      thumbnailUrl: cleanOptional(row.thumbnail_url) || undefined,
      sortOrder: row.sort_order ?? list.length + 1,
    });
    map.set(resultId, list);
  }

  for (const [resultId, videos] of map.entries()) {
    map.set(resultId, videos.sort((a, b) => a.sortOrder - b.sortOrder));
  }
  return map;
}

export async function resolveStudentExerciseInstance(params: {
  clientId: string;
  workoutId: string;
  exerciseInstanceId: string;
}): Promise<StudentExerciseResultOperationResult<StudentExerciseInstance>> {
  if (!isSupabaseEnabled("read_coach_lk")) return { ok: false, reason: "disabled" };
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  const clientId = cleanOptional(params.clientId);
  const workoutId = cleanOptional(params.workoutId);
  const exerciseInstanceId = cleanOptional(params.exerciseInstanceId);
  if (!clientId || !workoutId || !exerciseInstanceId) return { ok: false, reason: "invalid" };

  const { data: workout, error: workoutError } = await sb
    .from("client_program_workouts")
    .select("id")
    .eq("id", workoutId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (workoutError) return { ok: false, reason: "db_error", message: workoutError.message };
  if (!(workout as WorkoutOwnershipRow | null)?.id) return { ok: false, reason: "not_found" };

  const { data: exercise, error: exerciseError } = await sb
    .from("client_program_exercises")
    .select("id, exercise_title")
    .eq("id", exerciseInstanceId)
    .eq("client_program_workout_id", workoutId)
    .maybeSingle();

  if (exerciseError) return { ok: false, reason: "db_error", message: exerciseError.message };
  const exerciseRow = exercise as ExerciseInstanceRow | null;
  if (!exerciseRow?.id) return { ok: false, reason: "not_found" };

  return {
    ok: true,
    data: {
      workoutId,
      exerciseInstanceId: exerciseRow.id,
      title: cleanOptional(exerciseRow.exercise_title) || "Student result video",
    },
  };
}

export async function getStudentExerciseResultForExerciseId(
  exerciseInstanceId: string
): Promise<StudentExerciseResult | null> {
  const resultsByExerciseId = await getStudentExerciseResultsForExerciseIds([exerciseInstanceId]);
  return resultsByExerciseId.get(exerciseInstanceId) || null;
}

export async function getStudentExerciseResultsForExerciseIds(
  exerciseInstanceIds: string[]
): Promise<Map<string, StudentExerciseResult>> {
  const map = new Map<string, StudentExerciseResult>();
  if (!isSupabaseEnabled("read_coach_lk")) return map;
  const sb = getSupabaseAdmin();
  if (!sb) return map;

  const ids = Array.from(new Set(exerciseInstanceIds.map(cleanOptional).filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return map;

  const { data: resultRows, error: resultError } = await sb
    .from("student_exercise_results")
    .select("id, client_program_exercise_id, student_comment, status, submitted_at")
    .in("client_program_exercise_id", ids);

  if (resultError) throw resultError;

  const rows = (Array.isArray(resultRows) ? resultRows : []) as ResultRow[];
  const resultIds = rows.map((row) => cleanOptional(row.id)).filter((id): id is string => Boolean(id));
  const videosByResultId = new Map<string, StudentExerciseResultVideo[]>();

  if (resultIds.length > 0) {
    const { data: videoRows, error: videoError } = await sb
      .from("student_exercise_result_videos")
      .select("student_exercise_result_id, video_asset_id, thumbnail_url, sort_order")
      .in("student_exercise_result_id", resultIds)
      .order("sort_order", { ascending: true });

    if (videoError) throw videoError;
    for (const [resultId, videos] of mapVideosByResultId(
      (Array.isArray(videoRows) ? videoRows : []) as ResultVideoRow[]
    )) {
      videosByResultId.set(resultId, videos);
    }
  }

  for (const row of rows) {
    const resultId = cleanOptional(row.id);
    const result = mapResult(row, resultId ? videosByResultId.get(resultId) || [] : []);
    if (result) map.set(result.exerciseInstanceId, result);
  }

  return map;
}

export async function countStudentExerciseResultVideoReferences(
  videoAssetId: string
): Promise<StudentExerciseResultOperationResult<{ count: number }>> {
  if (!isSupabaseEnabled("read_coach_lk")) return { ok: false, reason: "disabled" };
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  const cleanVideoAssetId = cleanOptional(videoAssetId);
  if (!cleanVideoAssetId) return { ok: false, reason: "invalid" };

  const { count, error } = await sb
    .from("student_exercise_result_videos")
    .select("id", { count: "exact", head: true })
    .eq("video_asset_id", cleanVideoAssetId);

  if (error) return { ok: false, reason: "db_error", message: error.message };
  return { ok: true, data: { count: count ?? 0 } };
}

export async function upsertStudentExerciseResult(
  input: StudentExerciseResultUpsertInput
): Promise<StudentExerciseResultOperationResult<{ resultId: string }>> {
  if (!isSupabaseEnabled("read_coach_lk")) return { ok: false, reason: "disabled" };
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  const exerciseInstanceId = cleanOptional(input.exerciseInstanceId);
  if (!exerciseInstanceId) return { ok: false, reason: "invalid" };
  if (input.videos.length > 5) return { ok: false, reason: "too_many_videos" };

  const videoIds = input.videos.map((video) => cleanOptional(video.videoAssetId)).filter(Boolean);
  if (new Set(videoIds).size !== videoIds.length) return { ok: false, reason: "duplicate_video" };

  const videos = input.videos.map((video) => ({
    videoAssetId: cleanOptional(video.videoAssetId),
    thumbnailUrl: cleanOptional(video.thumbnailUrl),
  }));

  const { data, error } = await sb.rpc("upsert_student_exercise_result", {
    p_client_program_exercise_id: exerciseInstanceId,
    p_student_comment: cleanOptional(input.comment),
    p_update_comment: input.updateComment,
    p_replace_videos: input.replaceVideos,
    p_videos: videos,
  });

  if (error) return { ok: false, reason: "db_error", message: error.message };

  const result = (data || {}) as { ok?: boolean; error?: string; message?: string; resultId?: string };
  if (result.ok === false) {
    if (result.error === "too_many_videos") return { ok: false, reason: "too_many_videos", message: result.message };
    if (result.error === "duplicate_video") return { ok: false, reason: "duplicate_video", message: result.message };
    if (result.error === "invalid") return { ok: false, reason: "invalid", message: result.message };
    return { ok: false, reason: "db_error", message: result.message || result.error || "Result was not saved" };
  }

  const resultId = cleanOptional(result.resultId);
  if (!resultId) return { ok: false, reason: "db_error", message: "Result was not saved" };
  return { ok: true, data: { resultId } };
}
