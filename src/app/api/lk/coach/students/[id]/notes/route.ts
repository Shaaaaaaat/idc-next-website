import { NextResponse } from "next/server";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import {
  createCoachStudentNote,
  listCoachStudentNotes,
} from "@/lib/supabase/coachStudentNotes";

const NOTE_BODY_MAX_LENGTH = 4000;

type RouteContext = {
  params: Promise<{ id: string }>;
};

type ParsedNoteBody =
  | { ok: true; body: string }
  | { ok: false; error: "invalid_json" | "invalid" };

function statusForReason(reason: string): number {
  if (reason === "invalid") return 400;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  if (reason === "disabled") return 503;
  return 500;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function parseNoteBody(req: Request): Promise<ParsedNoteBody> {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return { ok: false, error: "invalid_json" };
  }

  if (
    !isPlainObject(body) ||
    Object.keys(body).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(body, "body") ||
    typeof body.body !== "string"
  ) {
    return { ok: false, error: "invalid" };
  }

  const noteBody = body.body.trim();
  if (!noteBody || noteBody.length > NOTE_BODY_MAX_LENGTH) {
    return { ok: false, error: "invalid" };
  }

  return { ok: true, body: noteBody };
}

async function getCoachEmail() {
  const email = await getValidatedSessionEmail();
  if (!email) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }),
    };
  }

  const access = await resolveLkAccessByEmail(email);
  if (access.type !== "coach") {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }),
    };
  }

  return { ok: true as const, email: access.email };
}

export async function GET(_req: Request, context: RouteContext) {
  const coach = await getCoachEmail();
  if (!coach.ok) return coach.response;

  const { id } = await context.params;
  const result = await listCoachStudentNotes(coach.email, id);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason }, { status: statusForReason(result.reason) });
  }

  return NextResponse.json({ ok: true, notes: result.notes });
}

export async function POST(req: Request, context: RouteContext) {
  const coach = await getCoachEmail();
  if (!coach.ok) return coach.response;

  const parsedBody = await parseNoteBody(req);
  if (!parsedBody.ok) {
    return NextResponse.json({ ok: false, error: parsedBody.error }, { status: 400 });
  }

  const { id } = await context.params;
  const result = await createCoachStudentNote(coach.email, id, parsedBody.body);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason }, { status: statusForReason(result.reason) });
  }

  return NextResponse.json({ ok: true, note: result.note });
}
