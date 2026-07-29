import { requestMagicLink } from "@/lib/auth/lkAuth";
import { mobileError, mobileJson } from "@/app/api/mobile/v1/_lib/responses";

export const runtime = "nodejs";

function normalizeEmail(raw: unknown) {
  return String(raw || "").trim().toLowerCase();
}

function isEmailLike(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return mobileError("BAD_REQUEST", 400);
  }

  const email = normalizeEmail(body.email);
  if (!isEmailLike(email)) {
    return mobileError("INVALID_INPUT", 422, "Valid email is required");
  }

  const result = await requestMagicLink(email, { client: "student_mobile" });
  if (!result.ok) {
    if (result.reason === "auth_failed") {
      return mobileJson({ ok: true });
    }

    console.warn("[mobile/auth/request] magic-link request failed", {
      reason: result.reason,
    });
    return mobileError("INTERNAL_ERROR", 500);
  }

  return mobileJson({ ok: true });
}
