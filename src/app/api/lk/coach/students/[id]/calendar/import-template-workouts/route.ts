import { NextResponse } from "next/server";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import {
  importProgramTemplateWorkoutsToCalendar,
  saveLastProgramTemplatePreference,
} from "@/lib/supabase/programTemplates";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function statusForReason(reason: string): number {
  if (reason === "invalid") return 400;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  if (reason === "disabled") return 503;
  return 500;
}

function messageForReason(reason: string, message?: string): string | undefined {
  if (reason === "invalid") return message || "Проверь выбранную программу и тренировки.";
  if (reason === "forbidden") return "Нет доступа к ученику или программе.";
  if (reason === "not_found") return "Программа или выбранные тренировки не найдены.";
  if (reason === "disabled") return "Импорт временно недоступен.";
  return "Не удалось импортировать тренировки.";
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

  const programTemplateId = String(body.programTemplateId || "");
  const result = await importProgramTemplateWorkoutsToCalendar({
    coachEmail: access.email,
    clientId: id,
    programTemplateId,
    startDate: String(body.startDate || ""),
    templateWorkoutIds: Array.isArray(body.templateWorkoutIds) ? body.templateWorkoutIds.map(String) : [],
    workoutDates:
      body.workoutDates && typeof body.workoutDates === "object" && !Array.isArray(body.workoutDates)
        ? (body.workoutDates as Record<string, string>)
        : undefined,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason, message: messageForReason(result.reason, result.message) },
      { status: statusForReason(result.reason) }
    );
  }

  let preferenceSaved = false;
  const preferenceResult = await saveLastProgramTemplatePreference({
    coachEmail: access.email,
    clientId: id,
    programTemplateId,
  });
  if (preferenceResult.ok) {
    preferenceSaved = preferenceResult.data.preferenceSaved;
  } else {
    console.warn("[calendar/import-template-workouts] preference save failed", {
      reason: preferenceResult.reason,
      message: preferenceResult.message,
    });
  }

  return NextResponse.json({
    ok: true,
    createdWorkouts: result.data.createdWorkouts,
    reusedWorkouts: result.data.reusedWorkouts,
    workoutIds: result.data.workoutIds,
    importedWorkouts: result.data.importedWorkouts,
    preferenceSaved,
  });
}
