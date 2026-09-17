import { mobileError, mobileJson } from "@/app/api/mobile/v1/_lib/responses";
import { getMobileStudentContext } from "@/lib/auth/mobileSession";
import { cleanupClientAvatarObjectBestEffort } from "@/lib/supabase/clientAvatarStorage";
import { clearStudentAvatarPathByClientId } from "@/lib/supabase/studentProfile";

export const runtime = "nodejs";

function sessionError(reason: string) {
  if (reason === "server_error") return mobileError("INTERNAL_ERROR", 500);
  if (reason === "forbidden") return mobileError("FORBIDDEN", 403);
  return mobileError("UNAUTHORIZED", 401);
}

export async function DELETE(req: Request) {
  const session = await getMobileStudentContext(req);
  if (!session.ok) return sessionError(session.reason);

  const cleared = await clearStudentAvatarPathByClientId(
    session.context.clientId
  );
  if (!cleared.ok) {
    if (cleared.reason === "invalid") return mobileError("INVALID_INPUT", 422);
    if (cleared.reason === "not_found") return mobileError("NOT_FOUND", 404);
    return mobileError("INTERNAL_ERROR", 500);
  }

  if (cleared.previousAvatarPath) {
    await cleanupClientAvatarObjectBestEffort(
      session.context.clientId,
      cleared.previousAvatarPath
    );
  }

  return mobileJson({ ok: true });
}
