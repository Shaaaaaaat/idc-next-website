import { mobileError, mobileJson } from "@/app/api/mobile/v1/_lib/responses";
import { getMobileStudentContext } from "@/lib/auth/mobileSession";
import { createCloudflareDirectTusUpload, getCloudflareMaxUploadBytes } from "@/lib/cloudflare/stream";
import { resolveStudentExerciseInstance } from "@/lib/supabase/studentExerciseResults";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ workoutId: string; exerciseInstanceId: string }>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

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

export async function POST(req: Request, context: RouteContext) {
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
  if (!body) {
    return mobileError("BAD_REQUEST", 400);
  }

  const fileType = String(body.fileType || "").trim();
  const fileSize = Number(body.fileSize || 0);
  if (!ALLOWED_VIDEO_TYPES.has(fileType)) {
    return mobileError("INVALID_INPUT", 422, "Video type is not allowed");
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return mobileError("INVALID_INPUT", 422, "Video file size is required");
  }
  if (fileSize > getCloudflareMaxUploadBytes()) {
    return mobileError("INVALID_INPUT", 413, "Video file is too large");
  }

  const upload = await createCloudflareDirectTusUpload({
    title: exercise.data.title,
    fileName: typeof body.fileName === "string" ? body.fileName : undefined,
    fileType,
    fileSize,
  });
  if (!upload.ok) {
    return mobileError("INTERNAL_ERROR", 502, upload.message);
  }

  return mobileJson({
    ok: true,
    provider: "cloudflare",
    endpoint: upload.data.uploadUrl,
    videoId: upload.data.uid,
  });
}
