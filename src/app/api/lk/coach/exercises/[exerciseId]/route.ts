import { NextResponse } from "next/server";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import { buildBunnyEmbedUrlForVideo } from "@/lib/bunny/stream";
import { updateExerciseMetadata } from "@/lib/supabase/exerciseLibrary";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ exerciseId: string }>;
};

async function requireCoach() {
  const email = await getValidatedSessionEmail();
  if (!email) return { ok: false as const, status: 401, error: "unauthorized" };

  const access = await resolveLkAccessByEmail(email);
  if (access.type !== "coach") {
    return { ok: false as const, status: 403, error: "forbidden" };
  }

  return { ok: true as const, email: access.email };
}

function statusForReason(reason: string): number {
  if (reason === "invalid") return 400;
  if (reason === "forbidden") return 403;
  if (reason === "not_found") return 404;
  if (reason === "disabled") return 503;
  return 500;
}

export async function PATCH(req: Request, context: RouteContext) {
  const coach = await requireCoach();
  if (!coach.ok) {
    return NextResponse.json({ ok: false, error: coach.error }, { status: coach.status });
  }

  const { exerciseId } = await context.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const videoId = typeof body.videoId === "string" ? body.videoId.trim() : "";
  const embed = videoId ? buildBunnyEmbedUrlForVideo(videoId) : null;
  if (embed && !embed.ok) {
    return NextResponse.json(
      { ok: false, error: "bunny_embed_url_failed", message: embed.message },
      { status: 500 }
    );
  }

  const result = await updateExerciseMetadata({
    coachEmail: coach.email,
    exerciseId,
    title: typeof body.title === "string" ? body.title : undefined,
    description: typeof body.description === "string" || body.description === null ? body.description : undefined,
    tags: typeof body.tags === "string" || Array.isArray(body.tags) ? (body.tags as string | string[]) : undefined,
    videoAssetId: videoId || undefined,
    videoUrl: embed?.ok ? embed.videoUrl : undefined,
    isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason, message: result.message },
      { status: statusForReason(result.reason) }
    );
  }

  return NextResponse.json({ ok: true, exercise: result.data });
}
