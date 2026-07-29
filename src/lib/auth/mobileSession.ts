import "server-only";

import { validateSession } from "@/lib/auth/lkAuth";
import {
  getActiveStudentIdentityByEmail,
  type StudentIdentity,
} from "@/lib/supabase/studentAccess";

export type MobileStudentContext = {
  sessionToken: string;
  email: string;
  clientId: string;
  displayName?: string;
};

export type MobileSessionResult =
  | { ok: true; context: MobileStudentContext }
  | {
      ok: false;
      reason:
        | "missing_authorization"
        | "malformed_authorization"
        | "invalid_session"
        | "forbidden"
        | "server_error";
    };

export type BearerTokenResult =
  | { ok: true; sessionToken: string }
  | {
      ok: false;
      reason: "missing_authorization" | "malformed_authorization";
    };

function contextFromStudent(
  sessionToken: string,
  student: StudentIdentity
): MobileStudentContext {
  return {
    sessionToken,
    email: student.email,
    clientId: student.clientId,
    displayName: student.displayName,
  };
}

export function parseBearerToken(req: Request): BearerTokenResult {
  const header = req.headers.get("authorization");
  if (!header) return { ok: false, reason: "missing_authorization" };

  const trimmed = header.trim();
  if (!trimmed || trimmed.includes(",")) {
    return { ok: false, reason: "malformed_authorization" };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer" || !parts[1]) {
    return { ok: false, reason: "malformed_authorization" };
  }

  return {
    ok: true,
    sessionToken: parts[1],
  };
}

export async function getMobileStudentContext(req: Request): Promise<MobileSessionResult> {
  const parsed = parseBearerToken(req);
  if (!parsed.ok) return parsed;

  const sessionToken = parsed.sessionToken;
  const validated = await validateSession(sessionToken);
  if (!validated.ok || !validated.data?.email) {
    return { ok: false, reason: "invalid_session" };
  }

  const student = await getActiveStudentIdentityByEmail(validated.data.email);
  if (!student.ok) {
    if (student.reason === "disabled" || student.reason === "db_error") {
      return { ok: false, reason: "server_error" };
    }
    return { ok: false, reason: "forbidden" };
  }

  return { ok: true, context: contextFromStudent(sessionToken, student.student) };
}
