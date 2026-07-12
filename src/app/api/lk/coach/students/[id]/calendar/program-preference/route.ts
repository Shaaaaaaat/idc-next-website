import { NextResponse } from "next/server";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import { getLastProgramTemplatePreference } from "@/lib/supabase/programTemplates";

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

export async function GET(_req: Request, context: RouteContext) {
  const email = await getValidatedSessionEmail();
  if (!email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const access = await resolveLkAccessByEmail(email);
  if (access.type !== "coach") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const result = await getLastProgramTemplatePreference({
    coachEmail: access.email,
    clientId: id,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason }, { status: statusForReason(result.reason) });
  }

  return NextResponse.json({
    ok: true,
    programTemplateId: result.data.programTemplateId,
  });
}
