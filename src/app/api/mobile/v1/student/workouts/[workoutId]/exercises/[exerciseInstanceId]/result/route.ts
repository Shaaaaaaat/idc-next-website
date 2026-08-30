import { mobileError, mobileJson } from "@/app/api/mobile/v1/_lib/responses";
import { getMobileStudentContext } from "@/lib/auth/mobileSession";
import {
  buildCloudflareThumbnailUrl,
  deleteCloudflareStreamVideo,
  isCloudflareStreamUid,
  verifyCloudflareVideoExists,
} from "@/lib/cloudflare/stream";
import {
  countStudentExerciseResultVideoReferences,
  getStudentExerciseResultForExerciseId,
  resolveStudentExerciseInstance,
  upsertStudentExerciseResult,
} from "@/lib/supabase/studentExerciseResults";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ workoutId: string; exerciseInstanceId: string }>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sessionError(reason: string) {
  if (reason === "server_error") return mobileError("INTERNAL_ERROR", 500);
  if (reason === "forbidden") return mobileError("FORBIDDEN", 403);
  return mobileError("UNAUTHORIZED", 401);
}

function ownershipError(reason: string) {
  if (reason === "disabled" || reason === "db_error") return mobileError("INTERNAL_ERROR", 500);
  if (reason === "not_found") return mobileError("NOT_FOUND", 404, "Workout exercise not found");
  return mobileError("BAD_REQUEST", 400);
}

function cleanOptional(raw: unknown): string | null {
  const value = String(raw || "").trim();
  return value || null;
}

function hasOwn(obj: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeVideoIds(raw: unknown): { ok: true; videoIds: string[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) return { ok: false, message: "videoIds must be an array" };
  if (raw.length > 5) return { ok: false, message: "A result can include at most 5 videos" };

  const videoIds: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") return { ok: false, message: "Every video id must be a string" };
    const videoId = value.trim();
    if (!videoId) return { ok: false, message: "Every video id must be non-empty" };
    if (!isCloudflareStreamUid(videoId)) return { ok: false, message: "Every video id must be a valid Cloudflare UID" };
    videoIds.push(videoId);
  }

  if (new Set(videoIds).size !== videoIds.length) {
    return { ok: false, message: "Video ids must be unique" };
  }

  return { ok: true, videoIds };
}

function upsertError(reason: string, message?: string) {
  if (reason === "disabled" || reason === "db_error") {
    return mobileError("INTERNAL_ERROR", 500, message || "Result was not saved");
  }
  if (reason === "too_many_videos" || reason === "duplicate_video" || reason === "invalid") {
    return mobileError("INVALID_INPUT", 422, message || "Invalid result");
  }
  return mobileError("INTERNAL_ERROR", 500);
}

async function cleanupRemovedCloudflareVideos(params: {
  videoIds: string[];
  workoutId: string;
  exerciseInstanceId: string;
  resultId: string;
}) {
  for (const videoId of params.videoIds) {
    const references = await countStudentExerciseResultVideoReferences(videoId);
    if (!references.ok) {
      console.warn("[student exercise result] skipped Cloudflare cleanup reference check failed", {
        videoId,
        workoutId: params.workoutId,
        exerciseInstanceId: params.exerciseInstanceId,
        resultId: params.resultId,
        reason: references.reason,
        message: references.message,
      });
      continue;
    }

    if (references.data.count > 0) {
      continue;
    }

    const deleted = await deleteCloudflareStreamVideo(videoId);
    if (!deleted.ok) {
      console.warn("[student exercise result] Cloudflare cleanup failed", {
        videoId,
        workoutId: params.workoutId,
        exerciseInstanceId: params.exerciseInstanceId,
        resultId: params.resultId,
        message: deleted.message,
      });
    }
  }
}

export async function PUT(req: Request, context: RouteContext) {
  const session = await getMobileStudentContext(req);
  if (!session.ok) return sessionError(session.reason);

  const { workoutId, exerciseInstanceId } = await context.params;
  const normalizedWorkoutId = String(workoutId || "").trim();
  const normalizedExerciseInstanceId = String(exerciseInstanceId || "").trim();
  if (!UUID_RE.test(normalizedWorkoutId) || !UUID_RE.test(normalizedExerciseInstanceId)) {
    return mobileError("BAD_REQUEST", 400, "Invalid workout or exercise id");
  }

  const exercise = await resolveStudentExerciseInstance({
    clientId: session.context.clientId,
    workoutId: normalizedWorkoutId,
    exerciseInstanceId: normalizedExerciseInstanceId,
  });
  if (!exercise.ok) return ownershipError(exercise.reason);

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return mobileError("BAD_REQUEST", 400);
  }

  const hasComment = hasOwn(body, "comment");
  if (hasComment && body.comment !== null && typeof body.comment !== "string") {
    return mobileError("INVALID_INPUT", 422, "comment must be a string or null");
  }

  const comment = cleanOptional(body.comment);
  const hasVideoIds = hasOwn(body, "videoIds");
  const existingResult = await getStudentExerciseResultForExerciseId(normalizedExerciseInstanceId);

  let videoIds: string[] = [];
  let removedVideoIds: string[] = [];
  if (hasVideoIds) {
    const normalized = normalizeVideoIds(body.videoIds);
    if (!normalized.ok) return mobileError("INVALID_INPUT", 422, normalized.message);
    videoIds = normalized.videoIds;
    const submittedVideoIds = new Set(videoIds);
    removedVideoIds = (existingResult?.videos || [])
      .map((video) => video.videoAssetId)
      .filter((videoId) => !submittedVideoIds.has(videoId));
  } else if (!comment && (!existingResult || existingResult.videos.length === 0)) {
    return mobileError("INVALID_INPUT", 422, "Comment or video is required");
  }

  const videos = [];
  for (const videoId of videoIds) {
    const verified = await verifyCloudflareVideoExists(videoId);
    if (!verified.ok) {
      return mobileError("INTERNAL_ERROR", 502, verified.message);
    }
    videos.push({
      videoAssetId: videoId,
      thumbnailUrl: buildCloudflareThumbnailUrl(videoId),
    });
  }

  const saved = await upsertStudentExerciseResult({
    exerciseInstanceId: normalizedExerciseInstanceId,
    comment,
    updateComment: hasComment,
    replaceVideos: hasVideoIds,
    videos,
  });
  if (!saved.ok) return upsertError(saved.reason, saved.message);

  if (removedVideoIds.length > 0) {
    await cleanupRemovedCloudflareVideos({
      videoIds: removedVideoIds,
      workoutId: normalizedWorkoutId,
      exerciseInstanceId: normalizedExerciseInstanceId,
      resultId: saved.data.resultId,
    });
  }

  return mobileJson({
    ok: true,
    result: {
      id: saved.data.resultId,
    },
  });
}
