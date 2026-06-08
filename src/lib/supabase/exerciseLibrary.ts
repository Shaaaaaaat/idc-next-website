import "server-only";

import { getCoachByEmail } from "@/lib/supabase/coachStudents";
import { getSupabaseAdmin, isSupabaseEnabled } from "@/lib/supabase/server";

export type ExerciseLibraryItem = {
  id: string;
  title: string;
  videoProvider: string;
  videoAssetId?: string;
  videoUrl: string;
  watchUrl: string;
  thumbnailUrl?: string;
  description?: string;
  tags: string[];
  isActive: boolean;
  createdByCoachId?: string;
  createdAt?: string;
  updatedAt?: string;
};

type ExerciseLibraryRow = {
  id: string;
  title?: string | null;
  video_provider?: string | null;
  video_asset_id?: string | null;
  video_url?: string | null;
  thumbnail_url?: string | null;
  description?: string | null;
  tags?: string[] | null;
  is_active?: boolean | null;
  created_by_coach_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type CreateBunnyExerciseInput = {
  coachEmail: string;
  title: string;
  videoAssetId: string;
  videoUrl: string;
  thumbnailUrl?: string | null;
  description?: string | null;
  tags?: string[] | string | null;
};

export type ExerciseLibraryResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "disabled" | "invalid" | "forbidden" | "not_found" | "db_error"; message?: string };

function cleanOptional(raw: unknown): string | null {
  const value = String(raw || "").trim();
  return value || null;
}

export function parseExerciseTags(raw: string | string[] | null | undefined): string[] {
  const parts = Array.isArray(raw) ? raw : String(raw || "").split(/[,\n]/);
  return Array.from(
    new Set(
      parts
        .map((tag) => String(tag || "").trim())
        .filter(Boolean)
    )
  );
}

function mapExercise(row: ExerciseLibraryRow): ExerciseLibraryItem {
  return {
    id: row.id,
    title: String(row.title || "").trim(),
    videoProvider: String(row.video_provider || "bunny").trim(),
    videoAssetId: cleanOptional(row.video_asset_id) || undefined,
    videoUrl: String(row.video_url || "").trim(),
    watchUrl: `/lk/exercises/${row.id}/video`,
    thumbnailUrl: cleanOptional(row.thumbnail_url) || undefined,
    description: cleanOptional(row.description) || undefined,
    tags: Array.isArray(row.tags) ? row.tags.filter(Boolean) : [],
    isActive: row.is_active !== false,
    createdByCoachId: cleanOptional(row.created_by_coach_id) || undefined,
    createdAt: cleanOptional(row.created_at) || undefined,
    updatedAt: cleanOptional(row.updated_at) || undefined,
  };
}

export async function listActiveExercises(): Promise<ExerciseLibraryItem[]> {
  if (!isSupabaseEnabled("read_coach_lk")) return [];
  const sb = getSupabaseAdmin();
  if (!sb) return [];

  const { data, error } = await sb
    .from("exercise_library")
    .select(
      "id, title, video_provider, video_asset_id, video_url, thumbnail_url, description, tags, is_active, created_by_coach_id, created_at, updated_at"
    )
    .eq("is_active", true)
    .order("title", { ascending: true });

  if (error) {
    console.warn("[supabase/exerciseLibrary] listActiveExercises failed", error.message);
    return [];
  }

  return ((Array.isArray(data) ? data : []) as ExerciseLibraryRow[])
    .map(mapExercise)
    .filter((exercise) => exercise.title && exercise.videoUrl);
}

export async function getActiveExerciseById(exerciseId: string): Promise<ExerciseLibraryItem | null> {
  if (!isSupabaseEnabled("read_coach_lk")) return null;
  const sb = getSupabaseAdmin();
  if (!sb) return null;

  const id = String(exerciseId || "").trim();
  if (!id) return null;

  const { data, error } = await sb
    .from("exercise_library")
    .select(
      "id, title, video_provider, video_asset_id, video_url, thumbnail_url, description, tags, is_active, created_by_coach_id, created_at, updated_at"
    )
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.warn("[supabase/exerciseLibrary] getActiveExerciseById failed", error.message);
    return null;
  }
  if (!data) return null;

  const exercise = mapExercise(data as ExerciseLibraryRow);
  if (!exercise.title || !exercise.videoUrl) return null;
  return exercise;
}

export async function createBunnyExercise(
  input: CreateBunnyExerciseInput
): Promise<ExerciseLibraryResult<ExerciseLibraryItem>> {
  if (!isSupabaseEnabled("read_coach_lk")) return { ok: false, reason: "disabled" };
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  const coachEmail = String(input.coachEmail || "").trim().toLowerCase();
  const title = String(input.title || "").trim();
  const videoAssetId = String(input.videoAssetId || "").trim();
  const videoUrl = String(input.videoUrl || "").trim();

  if (!coachEmail || !title || !videoAssetId || !videoUrl) {
    return { ok: false, reason: "invalid", message: "Missing required exercise fields" };
  }

  const coach = await getCoachByEmail(coachEmail);
  if (!coach) return { ok: false, reason: "forbidden" };

  const { data, error } = await sb
    .from("exercise_library")
    .insert({
      title,
      video_provider: "bunny",
      video_asset_id: videoAssetId,
      video_url: videoUrl,
      thumbnail_url: cleanOptional(input.thumbnailUrl),
      description: cleanOptional(input.description),
      tags: parseExerciseTags(input.tags),
      is_active: true,
      created_by_coach_id: coach.id,
    })
    .select(
      "id, title, video_provider, video_asset_id, video_url, thumbnail_url, description, tags, is_active, created_by_coach_id, created_at, updated_at"
    )
    .single();

  if (error || !data) {
    return { ok: false, reason: "db_error", message: error?.message || "Exercise was not created" };
  }

  return { ok: true, data: mapExercise(data as ExerciseLibraryRow) };
}

export async function deactivateExercise(params: {
  coachEmail: string;
  exerciseId: string;
}): Promise<ExerciseLibraryResult<ExerciseLibraryItem>> {
  return updateExerciseMetadata({
    coachEmail: params.coachEmail,
    exerciseId: params.exerciseId,
    isActive: false,
  });
}

export async function updateExerciseMetadata(params: {
  coachEmail: string;
  exerciseId: string;
  title?: string;
  description?: string | null;
  tags?: string[] | string | null;
  videoAssetId?: string;
  videoUrl?: string;
  thumbnailUrl?: string | null;
  isActive?: boolean;
}): Promise<ExerciseLibraryResult<ExerciseLibraryItem>> {
  if (!isSupabaseEnabled("read_coach_lk")) return { ok: false, reason: "disabled" };
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  const coachEmail = String(params.coachEmail || "").trim().toLowerCase();
  const exerciseId = String(params.exerciseId || "").trim();
  if (!coachEmail || !exerciseId) return { ok: false, reason: "invalid" };

  const coach = await getCoachByEmail(coachEmail);
  if (!coach) return { ok: false, reason: "forbidden" };

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (params.title !== undefined) {
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, reason: "invalid", message: "Title cannot be empty" };
    patch.title = title;
  }
  if (params.description !== undefined) patch.description = cleanOptional(params.description);
  if (params.tags !== undefined) patch.tags = parseExerciseTags(params.tags);
  if (params.videoAssetId !== undefined) {
    const videoAssetId = String(params.videoAssetId || "").trim();
    if (!videoAssetId) return { ok: false, reason: "invalid", message: "Video asset cannot be empty" };
    patch.video_provider = "bunny";
    patch.video_asset_id = videoAssetId;
  }
  if (params.videoUrl !== undefined) {
    const videoUrl = String(params.videoUrl || "").trim();
    if (!videoUrl) return { ok: false, reason: "invalid", message: "Video URL cannot be empty" };
    patch.video_url = videoUrl;
  }
  if (params.thumbnailUrl !== undefined) patch.thumbnail_url = cleanOptional(params.thumbnailUrl);
  if (params.isActive !== undefined) patch.is_active = params.isActive;

  const { data, error } = await sb
    .from("exercise_library")
    .update(patch)
    .eq("id", exerciseId)
    .select(
      "id, title, video_provider, video_asset_id, video_url, thumbnail_url, description, tags, is_active, created_by_coach_id, created_at, updated_at"
    )
    .maybeSingle();

  if (error) return { ok: false, reason: "db_error", message: error.message };
  if (!data) return { ok: false, reason: "not_found" };

  return { ok: true, data: mapExercise(data as ExerciseLibraryRow) };
}
