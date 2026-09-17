import { mobileError, mobileJson } from "@/app/api/mobile/v1/_lib/responses";
import { getMobileStudentContext } from "@/lib/auth/mobileSession";
import {
  CLIENT_AVATAR_MAX_BYTES,
  createClientAvatarSignedUpload,
  isClientAvatarContentType,
} from "@/lib/supabase/clientAvatarStorage";

export const runtime = "nodejs";

const ALLOWED_KEYS = new Set(["contentType", "fileSize"]);

function sessionError(reason: string) {
  if (reason === "server_error") return mobileError("INTERNAL_ERROR", 500);
  if (reason === "forbidden") return mobileError("FORBIDDEN", 403);
  return mobileError("UNAUTHORIZED", 401);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

  if (!isJsonObject(body)) return mobileError("INVALID_INPUT", 422);
  const keys = Object.keys(body);
  if (
    keys.length !== 2 ||
    keys.some((key) => !ALLOWED_KEYS.has(key)) ||
    !isClientAvatarContentType(body.contentType) ||
    typeof body.fileSize !== "number" ||
    !Number.isFinite(body.fileSize) ||
    !Number.isInteger(body.fileSize) ||
    body.fileSize <= 0 ||
    body.fileSize > CLIENT_AVATAR_MAX_BYTES
  ) {
    return mobileError("INVALID_INPUT", 422);
  }

  const result = await createClientAvatarSignedUpload(
    session.context.clientId,
    body.contentType
  );
  if (!result.ok) {
    if (result.reason === "invalid" || result.reason === "object_not_allowed") {
      return mobileError("INVALID_INPUT", 422);
    }
    return mobileError("INTERNAL_ERROR", 500);
  }

  return mobileJson({
    path: result.data.path,
    signedUploadUrl: result.data.signedUploadUrl,
    token: result.data.token,
  });
}
