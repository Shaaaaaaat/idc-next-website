import { mobileError, mobileJson } from "@/app/api/mobile/v1/_lib/responses";
import { getMobileStudentContext } from "@/lib/auth/mobileSession";
import {
  cleanupClientAvatarObjectBestEffort,
  createClientAvatarSignedReadUrl,
  getClientAvatarObjectInfo,
  isOwnedClientAvatarPath,
  type ClientAvatarStorageReason,
} from "@/lib/supabase/clientAvatarStorage";
import { replaceStudentAvatarPathByClientId } from "@/lib/supabase/studentProfile";

export const runtime = "nodejs";

function sessionError(reason: string) {
  if (reason === "server_error") return mobileError("INTERNAL_ERROR", 500);
  if (reason === "forbidden") return mobileError("FORBIDDEN", 403);
  return mobileError("UNAUTHORIZED", 401);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function objectValidationError(reason: ClientAvatarStorageReason) {
  if (
    reason === "invalid" ||
    reason === "not_found" ||
    reason === "metadata_unavailable" ||
    reason === "object_not_allowed"
  ) {
    return mobileError("INVALID_INPUT", 422);
  }
  return mobileError("INTERNAL_ERROR", 500);
}

export async function POST(req: Request) {
  const session = await getMobileStudentContext(req);
  if (!session.ok) return sessionError(session.reason);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError("BAD_REQUEST", 400);
  }

  if (
    !isJsonObject(body) ||
    Object.keys(body).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(body, "path") ||
    typeof body.path !== "string" ||
    !isOwnedClientAvatarPath(session.context.clientId, body.path)
  ) {
    return mobileError("INVALID_INPUT", 422);
  }

  const objectInfo = await getClientAvatarObjectInfo(
    session.context.clientId,
    body.path
  );
  if (!objectInfo.ok) {
    await cleanupClientAvatarObjectBestEffort(
      session.context.clientId,
      body.path
    );
    return objectValidationError(objectInfo.reason);
  }

  const replaced = await replaceStudentAvatarPathByClientId(
    session.context.clientId,
    objectInfo.data.path
  );
  if (!replaced.ok) {
    await cleanupClientAvatarObjectBestEffort(
      session.context.clientId,
      objectInfo.data.path
    );
    if (replaced.reason === "invalid") return mobileError("INVALID_INPUT", 422);
    if (replaced.reason === "not_found") return mobileError("NOT_FOUND", 404);
    return mobileError("INTERNAL_ERROR", 500);
  }

  if (
    replaced.previousAvatarPath &&
    replaced.previousAvatarPath !== objectInfo.data.path
  ) {
    await cleanupClientAvatarObjectBestEffort(
      session.context.clientId,
      replaced.previousAvatarPath
    );
  }

  const signedRead = await createClientAvatarSignedReadUrl(
    session.context.clientId,
    objectInfo.data.path
  );
  if (!signedRead.ok) {
    console.warn("[api/mobile/v1/me/avatar/complete-upload] operation failed", {
      operation: "signed_read_after_replace",
    });
    return mobileError("INTERNAL_ERROR", 500);
  }

  return mobileJson({
    avatarUrl: signedRead.data.signedUrl,
    expiresIn: signedRead.data.expiresIn,
  });
}
