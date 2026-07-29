import { consumeMagicLink, revokeSession, validateSession } from "@/lib/auth/lkAuth";
import { getActiveStudentIdentityByEmail } from "@/lib/supabase/studentAccess";
import { mobileError, mobileJson } from "@/app/api/mobile/v1/_lib/responses";

export const runtime = "nodejs";

function isSessionTokenPayload(data: unknown): data is { ok: true; session_token: string } {
  if (!data || typeof data !== "object") return false;
  const rec = data as Record<string, unknown>;
  return rec.ok === true && typeof rec.session_token === "string" && rec.session_token.length > 0;
}

async function revokeBestEffort(sessionToken: string) {
  await revokeSession(sessionToken).catch(() => null);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return mobileError("BAD_REQUEST", 400);
  }

  const token = String(body.token || "").trim();
  if (!token) {
    return mobileError("INVALID_INPUT", 422, "Magic token is required");
  }

  const consumed = await consumeMagicLink(token);
  if (!consumed.ok || !isSessionTokenPayload(consumed.data)) {
    return mobileError("UNAUTHORIZED", 401, "Invalid or expired token");
  }

  const sessionToken = consumed.data.session_token;
  const validated = await validateSession(sessionToken);
  if (!validated.ok || !validated.data?.email) {
    await revokeBestEffort(sessionToken);
    return mobileError("UNAUTHORIZED", 401, "Invalid session");
  }

  const student = await getActiveStudentIdentityByEmail(validated.data.email);
  if (!student.ok) {
    await revokeBestEffort(sessionToken);
    if (student.reason === "disabled" || student.reason === "db_error") {
      return mobileError("INTERNAL_ERROR", 500);
    }
    return mobileError("FORBIDDEN", 403);
  }

  return mobileJson({
    sessionToken,
    user: {
      email: student.student.email,
      clientId: student.student.clientId,
      displayName: student.student.displayName ?? null,
      isActive: true,
    },
  });
}
