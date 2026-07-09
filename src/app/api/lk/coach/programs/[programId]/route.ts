import { NextResponse } from "next/server";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import {
  deactivateProgramTemplate,
  duplicateProgramTemplate,
  getProgramTemplate,
  updateProgramTemplate,
} from "@/lib/supabase/programTemplates";

type RouteContext = {
  params: Promise<{ programId: string }>;
};

function statusForReason(reason: string): number {
  if (reason === "invalid") return 400;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  if (reason === "stale") return 409;
  if (reason === "disabled") return 503;
  return 500;
}

async function requireCoach() {
  const email = await getValidatedSessionEmail();
  if (!email) return { ok: false as const, response: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }) };

  const access = await resolveLkAccessByEmail(email);
  if (access.type !== "coach") {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true as const, email: access.email };
}

export async function GET(_req: Request, context: RouteContext) {
  const coach = await requireCoach();
  if (!coach.ok) return coach.response;

  const { programId } = await context.params;
  const result = await getProgramTemplate(coach.email, programId);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason, message: result.message },
      { status: statusForReason(result.reason) }
    );
  }

  return NextResponse.json({ ok: true, program: result.data });
}

export async function PUT(req: Request, context: RouteContext) {
  const coach = await requireCoach();
  if (!coach.ok) return coach.response;

  const { programId } = await context.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });

  const result = await updateProgramTemplate({
    coachEmail: coach.email,
    programId,
    expectedUpdatedAt: typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : body.expectedUpdatedAt === null ? null : undefined,
    title: typeof body.title === "string" ? body.title : undefined,
    description: typeof body.description === "string" ? body.description : body.description === null ? null : undefined,
    durationDays: typeof body.durationDays === "number" || typeof body.durationDays === "string" ? body.durationDays : undefined,
    weeksCount: typeof body.weeksCount === "number" || typeof body.weeksCount === "string" ? body.weeksCount : undefined,
    level: typeof body.level === "string" ? body.level : body.level === null ? null : undefined,
    goal: typeof body.goal === "string" ? body.goal : body.goal === null ? null : undefined,
    tags: Array.isArray(body.tags) || typeof body.tags === "string" || body.tags === null ? body.tags as string[] | string | null : undefined,
    workouts: Array.isArray(body.workouts) ? body.workouts : undefined,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason, message: result.message },
      { status: statusForReason(result.reason) }
    );
  }

  return NextResponse.json({ ok: true, program: result.data });
}

export async function POST(req: Request, context: RouteContext) {
  const coach = await requireCoach();
  if (!coach.ok) return coach.response;

  const { programId } = await context.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.action !== "duplicate") {
    return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
  }

  const result = await duplicateProgramTemplate({ coachEmail: coach.email, programId });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason, message: result.message },
      { status: statusForReason(result.reason) }
    );
  }

  return NextResponse.json({ ok: true, program: result.data });
}

export async function DELETE(_req: Request, context: RouteContext) {
  const coach = await requireCoach();
  if (!coach.ok) return coach.response;

  const { programId } = await context.params;
  const result = await deactivateProgramTemplate({ coachEmail: coach.email, programId });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason, message: result.message },
      { status: statusForReason(result.reason) }
    );
  }

  return NextResponse.json({ ok: true });
}
