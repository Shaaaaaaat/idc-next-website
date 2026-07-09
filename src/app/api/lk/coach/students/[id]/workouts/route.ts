import { NextResponse } from "next/server";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import { saveCoachWorkout } from "@/lib/supabase/coachWorkouts";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function statusForReason(reason: string): number {
  if (reason === "invalid") return 400;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  if (reason === "stale") return 409;
  if (reason === "disabled") return 503;
  return 500;
}

function messageForReason(reason: string, message?: string): string | undefined {
  if (message) return message;
  if (reason === "stale") return "Тренировка была изменена в другом окне. Обновите страницу.";
  return undefined;
}

export async function POST(req: Request, context: RouteContext) {
  const email = await getValidatedSessionEmail();
  if (!email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const access = await resolveLkAccessByEmail(email);
  if (access.type !== "coach") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const result = await saveCoachWorkout({
    coachEmail: access.email,
    studentId: id,
    workoutDate: String(body.workoutDate || ""),
    title: String(body.title || ""),
    coachComment: typeof body.coachComment === "string" ? body.coachComment : undefined,
    groups: Array.isArray(body.groups) ? body.groups : [],
    exercises: Array.isArray(body.exercises) ? body.exercises : [],
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason, message: messageForReason(result.reason, result.message) },
      { status: statusForReason(result.reason) }
    );
  }

  return NextResponse.json({ ok: true, workoutId: result.workoutId });
}
