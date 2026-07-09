import { NextResponse } from "next/server";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import { assignProgramTemplate } from "@/lib/supabase/programTemplates";

type RouteContext = {
  params: Promise<{ programId: string }>;
};

function statusForReason(reason: string): number {
  if (reason === "invalid") return 400;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  if (reason === "disabled") return 503;
  return 500;
}

const IMPORT_TO_CALENDAR_ACTION = "import_template_workouts_to_calendar";

export async function POST(req: Request, context: RouteContext) {
  const email = await getValidatedSessionEmail();
  if (!email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const access = await resolveLkAccessByEmail(email);
  if (access.type !== "coach") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { programId } = await context.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (body.action !== IMPORT_TO_CALENDAR_ACTION) {
    return NextResponse.json(
      {
        ok: false,
        error: "legacy_assign_deprecated",
        message: "Legacy full-program assignment is deprecated. Import template workouts to the client calendar instead.",
        requiredAction: IMPORT_TO_CALENDAR_ACTION,
      },
      { status: 410 }
    );
  }

  const result = await assignProgramTemplate({
    coachEmail: access.email,
    programId,
    clientId: String(body.clientId || ""),
    startDate: String(body.startDate || ""),
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason, message: result.message },
      { status: statusForReason(result.reason) }
    );
  }

  return NextResponse.json({ ok: true, ...result.data });
}
