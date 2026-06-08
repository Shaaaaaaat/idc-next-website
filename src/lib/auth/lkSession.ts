import "server-only";

import { cookies } from "next/headers";
import { getAuthCookieName, validateSession } from "@/lib/auth/lkAuth";

function isValidatePayload(data: unknown): data is { ok: true; email: string } {
  if (!data || typeof data !== "object") return false;
  const rec = data as Record<string, unknown>;
  return rec.ok === true && typeof rec.email === "string" && rec.email.length > 0;
}

export async function getValidatedSessionEmail(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(getAuthCookieName())?.value || "";
  if (!sessionToken) return null;

  const validateRes = await validateSession(sessionToken);
  if (!validateRes.ok || !isValidatePayload(validateRes.data)) return null;
  return validateRes.data.email;
}

