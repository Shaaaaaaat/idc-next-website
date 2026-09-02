import { NextResponse } from "next/server";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import {
  deleteCoachWorkout,
  getCoachWorkoutForStudentById,
  saveCoachWorkout,
} from "@/lib/supabase/coachWorkouts";

type RouteContext = {
  params: Promise<{ id: string; workoutId: string }>;
};

function statusForReason(reason: string): number {
  if (reason === "invalid") return 400;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  if (reason === "stale" || reason === "locked") return 409;
  if (reason === "disabled") return 503;
  return 500;
}

function messageForReason(
  reason: string,
  action: "save" | "delete",
  message?: string
): string | undefined {
  if (reason === "locked") {
    return action === "delete"
      ? "Пройденную тренировку нельзя удалить."
      : "Пройденную тренировку нельзя изменять.";
  }
  if (message) return message;
  if (reason === "stale") return "Тренировка была изменена в другом окне. Обновите страницу.";
  return undefined;
}

export async function GET(_req: Request, context: RouteContext) {
  const email = await getValidatedSessionEmail();
  if (!email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const access = await resolveLkAccessByEmail(email);
  if (access.type !== "coach") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { id, workoutId } = await context.params;
  try {
    const workout = await getCoachWorkoutForStudentById({
      coachEmail: access.email,
      studentId: id,
      workoutId,
    });

    if (!workout) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, workout });
  } catch (error) {
    console.warn(
      "[api/lk/coach/students/workouts] detail read failed",
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

export async function PUT(req: Request, context: RouteContext) {
  const email = await getValidatedSessionEmail();
  if (!email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const access = await resolveLkAccessByEmail(email);
  if (access.type !== "coach") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { id, workoutId } = await context.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const result = await saveCoachWorkout({
    coachEmail: access.email,
    studentId: id,
    workoutId,
    workoutDate: String(body.workoutDate || ""),
    title: String(body.title || ""),
    coachComment: typeof body.coachComment === "string" ? body.coachComment : undefined,
    expectedUpdatedAt: typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : null,
    groups: Array.isArray(body.groups) ? body.groups : [],
    exercises: Array.isArray(body.exercises) ? body.exercises : [],
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason, message: messageForReason(result.reason, "save", result.message) },
      { status: statusForReason(result.reason) }
    );
  }

  return NextResponse.json({ ok: true, workoutId: result.workoutId });
}

export async function DELETE(_req: Request, context: RouteContext) {
  const email = await getValidatedSessionEmail();
  if (!email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const access = await resolveLkAccessByEmail(email);
  if (access.type !== "coach") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { id, workoutId } = await context.params;
  const result = await deleteCoachWorkout({
    coachEmail: access.email,
    studentId: id,
    workoutId,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason, message: messageForReason(result.reason, "delete", result.message) },
      { status: statusForReason(result.reason) }
    );
  }

  return NextResponse.json({ ok: true });
}
