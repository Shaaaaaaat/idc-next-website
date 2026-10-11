import { NextResponse } from "next/server";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import { getCoachNotificationSummary } from "@/lib/supabase/coachNotifications";

export const dynamic = "force-dynamic";

function statusForReason(reason: string): number {
  if (reason === "forbidden") return 403;
  if (reason === "disabled" || reason === "no_supabase_client") return 503;
  return 500;
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(body, { ...init, headers });
}

export async function GET() {
  const email = await getValidatedSessionEmail();
  if (!email) {
    return noStoreJson({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const access = await resolveLkAccessByEmail(email);
  if (access.type !== "coach") {
    return noStoreJson({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const result = await getCoachNotificationSummary(access.email);
  if (!result.ok) {
    return noStoreJson(
      { ok: false, error: result.reason, message: result.message },
      { status: statusForReason(result.reason) }
    );
  }

  return noStoreJson({ ok: true, summary: result.summary });
}
