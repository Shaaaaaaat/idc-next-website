import { NextResponse } from "next/server";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import {
  createProgramTemplate,
  listProgramTemplates,
  verifyProgramTemplateSchema,
} from "@/lib/supabase/programTemplates";

function statusForReason(reason: string): number {
  if (reason === "invalid") return 400;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
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

export async function GET() {
  const coach = await requireCoach();
  if (!coach.ok) return coach.response;

  const schema = await verifyProgramTemplateSchema(coach.email);
  if (!schema.ok) {
    return NextResponse.json(
      { ok: false, error: schema.reason, message: schema.message },
      { status: statusForReason(schema.reason) }
    );
  }

  const programs = await listProgramTemplates(coach.email);
  return NextResponse.json({ ok: true, programs });
}

export async function POST(req: Request) {
  const coach = await requireCoach();
  if (!coach.ok) return coach.response;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const result = await createProgramTemplate({
    coachEmail: coach.email,
    title: String(body?.title || ""),
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason, message: result.message },
      { status: statusForReason(result.reason) }
    );
  }

  return NextResponse.json({ ok: true, program: result.data });
}
