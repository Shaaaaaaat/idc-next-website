import { parseBearerToken } from "@/lib/auth/mobileSession";
import { revokeSession } from "@/lib/auth/lkAuth";
import { mobileError, mobileJson } from "@/app/api/mobile/v1/_lib/responses";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const parsed = parseBearerToken(req);
  if (!parsed.ok) {
    return mobileError("UNAUTHORIZED", 401);
  }

  const revoked = await revokeSession(parsed.sessionToken);
  if (!revoked.ok && revoked.reason !== "auth_failed") {
    console.warn("[mobile/auth/logout] session revoke failed", {
      reason: revoked.reason,
    });
    return mobileError("INTERNAL_ERROR", 500);
  }

  return mobileJson({ ok: true });
}
