import "server-only";

import { getCoachByEmail } from "@/lib/supabase/coachStudents";
import {
  canArchiveExercise,
  canEditExercise,
  canReadExercise,
  getCoachResourceActor,
  getOwnerType,
  type LkResourceActor,
  type LkOwnerType,
} from "@/lib/supabase/lkAccessControl";
import { getSupabaseAdmin, isSupabaseEnabled } from "@/lib/supabase/server";

export type ExerciseLibraryItem = {
  id: string;
  title: string;
  videoProvider: string;
  videoAssetId?: string;
  videoUrl: string;
  watchUrl: string;
  thumbnailUrl?: string;
  techniqueVideoProvider?: string;
  techniqueVideoAssetId?: string;
  techniqueVideoUrl?: string;
  techniqueThumbnailUrl?: string;
  description?: string;
  tags: string[];
  isActive: boolean;
  createdByCoachId?: string;
  ownerType: LkOwnerType;
  canEdit: boolean;
  canArchive: boolean;
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
  technique_video_provider?: string | null;
  technique_video_asset_id?: string | null;
  technique_video_url?: string | null;
  technique_thumbnail_url?: string | null;
  description?: string | null;
  tags?: string[] | null;
  is_active?: boolean | null;
  created_by_coach_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type CreateExerciseInput = {
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

const EXERCISE_SELECT_COLUMNS =
  "id, title, video_provider, video_asset_id, video_url, thumbnail_url, technique_video_provider, technique_video_asset_id, technique_video_url, technique_thumbnail_url, description, tags, is_active, created_by_coach_id, created_at, updated_at";

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

function withExercisePermissions(exercise: Omit<ExerciseLibraryItem, "ownerType" | "canEdit" | "canArchive">, actor?: LkResourceActor | null): ExerciseLibraryItem {
  return {
    ...exercise,
    ownerType: getOwnerType(actor || null, exercise),
    canEdit: actor ? canEditExercise(actor, exercise) : false,
    canArchive: actor ? canArchiveExercise(actor, exercise) : false,
  };
}

function mapExercise(row: ExerciseLibraryRow, actor?: LkResourceActor | null): ExerciseLibraryItem {
  return withExercisePermissions({
    id: row.id,
    title: String(row.title || "").trim(),
    videoProvider: String(row.video_provider || "").trim(),
    videoAssetId: cleanOptional(row.video_asset_id) || undefined,
    videoUrl: String(row.video_url || "").trim(),
    watchUrl: `/lk/exercises/${row.id}/video`,
    thumbnailUrl: cleanOptional(row.thumbnail_url) || undefined,
    techniqueVideoProvider: cleanOptional(row.technique_video_provider) || undefined,
    techniqueVideoAssetId: cleanOptional(row.technique_video_asset_id) || undefined,
    techniqueVideoUrl: cleanOptional(row.technique_video_url) || undefined,
    techniqueThumbnailUrl: cleanOptional(row.technique_thumbnail_url) || undefined,
    description: cleanOptional(row.description) || undefined,
    tags: Array.isArray(row.tags) ? row.tags.filter(Boolean) : [],
    isActive: row.is_active !== false,
    createdByCoachId: cleanOptional(row.created_by_coach_id) || undefined,
    createdAt: cleanOptional(row.created_at) || undefined,
    updatedAt: cleanOptional(row.updated_at) || undefined,
  }, actor);
}

async function getEditableExerciseActor(
  coachEmail: string,
  exerciseId: string,
  options: { archive?: boolean } = {}
): Promise<ExerciseLibraryResult<{ actor: LkResourceActor }>> {
  if (!isSupabaseEnabled("read_coach_lk")) return { ok: false, reason: "disabled" };
  const coach = await getCoachByEmail(coachEmail);
  if (!coach) return { ok: false, reason: "forbidden" };
  const actor = await getCoachResourceActor(coachEmail);
  if (!actor) return { ok: false, reason: "forbidden" };

  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  const { data: existing, error: existingError } = await sb
    .from("exercise_library")
    .select(EXERCISE_SELECT_COLUMNS)
    .eq("id", exerciseId)
    .maybeSingle();

  if (existingError) return { ok: false, reason: "db_error", message: existingError.message };
  if (!existing) return { ok: false, reason: "not_found" };

  const currentExercise = mapExercise(existing as ExerciseLibraryRow, actor);
  const allowed = options.archive
    ? canArchiveExercise(actor, currentExercise)
    : canEditExercise(actor, currentExercise);
  if (!allowed) return { ok: false, reason: "forbidden" };

  return { ok: true, data: { actor } };
}

export async function listActiveExercises(coachEmail?: string): Promise<ExerciseLibraryItem[]> {
  if (!isSupabaseEnabled("read_coach_lk")) return [];
  const sb = getSupabaseAdmin();
  if (!sb) return [];

  const actor = coachEmail ? await getCoachResourceActor(coachEmail) : null;
  if (coachEmail && !actor) return [];

  const { data, error } = await sb
    .from("exercise_library")
    .select(EXERCISE_SELECT_COLUMNS)
    .eq("is_active", true)
    .order("title", { ascending: true });

  if (error) {
    console.warn("[supabase/exerciseLibrary] listActiveExercises failed", error.message);
    return [];
  }

  return ((Array.isArray(data) ? data : []) as ExerciseLibraryRow[])
    .map((row) => mapExercise(row, actor))
    .filter((exercise) => exercise.title && exercise.videoUrl)
    .filter((exercise) => !actor || canReadExercise(actor, exercise));
}

export async function getActiveExerciseById(
  exerciseId: string,
  options: { coachEmail?: string; isAdmin?: boolean } = {}
): Promise<ExerciseLibraryItem | null> {
  if (!isSupabaseEnabled("read_coach_lk")) return null;
  const sb = getSupabaseAdmin();
  if (!sb) return null;

  const id = String(exerciseId || "").trim();
  if (!id) return null;

  const { data, error } = await sb
    .from("exercise_library")
    .select(EXERCISE_SELECT_COLUMNS)
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.warn("[supabase/exerciseLibrary] getActiveExerciseById failed", error.message);
    return null;
  }
  if (!data) return null;

  const actor = options.isAdmin !== true && options.coachEmail ? await getCoachResourceActor(options.coachEmail) : null;
  const exercise = mapExercise(data as ExerciseLibraryRow, actor);
  if (!exercise.title || !exercise.videoUrl) return null;
  if (options.isAdmin !== true) {
    if (!actor || !canReadExercise(actor, exercise)) return null;
  }
  return exercise;
}

export async function createExercise(
  input: CreateExerciseInput
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
      video_provider: "cloudflare",
      video_asset_id: videoAssetId,
      video_url: videoUrl,
      thumbnail_url: cleanOptional(input.thumbnailUrl),
      description: cleanOptional(input.description),
      tags: parseExerciseTags(input.tags),
      is_active: true,
      created_by_coach_id: coach.id,
    })
    .select(EXERCISE_SELECT_COLUMNS)
    .single();

  if (error || !data) {
    return { ok: false, reason: "db_error", message: error?.message || "Exercise was not created" };
  }

  const actor = await getCoachResourceActor(coachEmail);
  return { ok: true, data: mapExercise(data as ExerciseLibraryRow, actor) };
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

export async function deleteExercise(params: {
  coachEmail: string;
  exerciseId: string;
}): Promise<ExerciseLibraryResult<ExerciseLibraryItem>> {
  return deactivateExercise(params);
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

  const editable = await getEditableExerciseActor(coachEmail, exerciseId, { archive: params.isActive === false });
  if (!editable.ok) return editable;
  const actor = editable.data.actor;

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
    patch.video_provider = "cloudflare";
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
    .select(EXERCISE_SELECT_COLUMNS)
    .maybeSingle();

  if (error) return { ok: false, reason: "db_error", message: error.message };
  if (!data) return { ok: false, reason: "not_found" };

  return { ok: true, data: mapExercise(data as ExerciseLibraryRow, actor) };
}

export type ExerciseUploadPurpose = "exercise_demo" | "technique_breakdown";

export async function recordExerciseVideoUploadClaim(params: {
  coachEmail: string;
  videoAssetId: string;
  purpose: ExerciseUploadPurpose;
}): Promise<ExerciseLibraryResult<{ videoAssetId: string }>> {
  if (!isSupabaseEnabled("read_coach_lk")) return { ok: false, reason: "disabled" };
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  const coachEmail = String(params.coachEmail || "").trim().toLowerCase();
  const videoAssetId = String(params.videoAssetId || "").trim();
  if (!coachEmail || !videoAssetId) return { ok: false, reason: "invalid" };

  const { error } = await sb
    .from("exercise_video_upload_claims")
    .insert({
      coach_email: coachEmail,
      video_asset_id: videoAssetId,
      purpose: params.purpose,
    });

  if (error) return { ok: false, reason: "db_error", message: error.message };
  return { ok: true, data: { videoAssetId } };
}

export async function updateExerciseTechniqueVideo(params: {
  coachEmail: string;
  exerciseId: string;
  videoAssetId: string;
  videoUrl: string;
  thumbnailUrl?: string | null;
}): Promise<ExerciseLibraryResult<ExerciseLibraryItem>> {
  if (!isSupabaseEnabled("read_coach_lk")) return { ok: false, reason: "disabled" };
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  const coachEmail = String(params.coachEmail || "").trim().toLowerCase();
  const exerciseId = String(params.exerciseId || "").trim();
  const videoAssetId = String(params.videoAssetId || "").trim();
  const videoUrl = String(params.videoUrl || "").trim();
  if (!coachEmail || !exerciseId || !videoAssetId || !videoUrl) {
    return { ok: false, reason: "invalid" };
  }

  const { data, error } = await sb.rpc("set_exercise_technique_video", {
    p_coach_email: coachEmail,
    p_exercise_id: exerciseId,
    p_video_asset_id: videoAssetId,
    p_video_url: videoUrl,
    p_thumbnail_url: cleanOptional(params.thumbnailUrl),
  });

  if (error) return { ok: false, reason: "db_error", message: error.message };

  const rpcResult = (data || {}) as {
    ok?: boolean;
    error?: string;
    message?: string;
    exercise?: ExerciseLibraryRow;
  };
  if (rpcResult.ok !== true) {
    const reason = rpcResult.error;
    if (reason === "invalid" || reason === "forbidden" || reason === "not_found") {
      return { ok: false, reason, message: rpcResult.message };
    }
    return { ok: false, reason: "db_error", message: rpcResult.message || reason || "Technique video was not saved" };
  }
  if (!rpcResult.exercise) {
    return { ok: false, reason: "db_error", message: "Technique video was not saved" };
  }

  const actor = await getCoachResourceActor(coachEmail);
  return { ok: true, data: mapExercise(rpcResult.exercise, actor) };
}

export async function removeExerciseTechniqueVideo(params: {
  coachEmail: string;
  exerciseId: string;
}): Promise<ExerciseLibraryResult<ExerciseLibraryItem>> {
  const editable = await getEditableExerciseActor(
    String(params.coachEmail || "").trim().toLowerCase(),
    params.exerciseId
  );
  if (!editable.ok) return editable;

  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  const { data, error } = await sb
    .from("exercise_library")
    .update({
      technique_video_provider: null,
      technique_video_asset_id: null,
      technique_video_url: null,
      technique_thumbnail_url: null,
    })
    .eq("id", params.exerciseId)
    .select(EXERCISE_SELECT_COLUMNS)
    .maybeSingle();

  if (error) return { ok: false, reason: "db_error", message: error.message };
  if (!data) return { ok: false, reason: "not_found" };

  return { ok: true, data: mapExercise(data as ExerciseLibraryRow, editable.data.actor) };
}
