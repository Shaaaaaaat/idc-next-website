import { NextResponse } from "next/server";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import { listActiveExercises } from "@/lib/supabase/exerciseLibrary";

export const runtime = "nodejs";

async function requireCoach() {
  const email = await getValidatedSessionEmail();
  if (!email) return { ok: false as const, status: 401, error: "unauthorized" };

  const access = await resolveLkAccessByEmail(email);
  if (access.type !== "coach") {
    return { ok: false as const, status: 403, error: "forbidden" };
  }

  return { ok: true as const, email: access.email };
}

export async function GET() {
  const coach = await requireCoach();
  if (!coach.ok) {
    return NextResponse.json({ ok: false, error: coach.error }, { status: coach.status });
  }

  const exercises = await listActiveExercises();
  return NextResponse.json({ ok: true, exercises });
}

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "direct_upload_required",
      message: "Use /api/lk/coach/exercises/init-upload and Bunny TUS direct upload.",
    },
    { status: 410 }
  );
}
