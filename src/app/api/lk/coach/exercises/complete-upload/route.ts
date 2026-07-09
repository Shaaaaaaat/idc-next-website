import { NextResponse } from "next/server";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import { normalizeCloudflareVideo, verifyCloudflareVideoExists } from "@/lib/cloudflare/stream";
import { createExercise } from "@/lib/supabase/exerciseLibrary";

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

export async function POST(req: Request) {
  const coach = await requireCoach();
  if (!coach.ok) {
    return NextResponse.json({ ok: false, error: coach.error }, { status: coach.status });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const title = String(body.title || "").trim();
  const videoId = String(body.videoId || "").trim();
  const description = typeof body.description === "string" ? body.description : "";
  const tags = typeof body.tags === "string" || Array.isArray(body.tags) ? (body.tags as string | string[]) : "";

  if (!title || !videoId) {
    return NextResponse.json({ ok: false, error: "invalid_upload_metadata" }, { status: 400 });
  }

  const video = normalizeCloudflareVideo(videoId);
  if (!video.ok) {
    return NextResponse.json(
      { ok: false, error: "invalid_cloudflare_video", message: video.message },
      { status: 400 }
    );
  }

  const verified = await verifyCloudflareVideoExists(video.data.uid);
  if (!verified.ok) {
    return NextResponse.json(
      { ok: false, error: "cloudflare_video_verify_failed", message: verified.message },
      { status: 502 }
    );
  }

  const created = await createExercise({
    coachEmail: coach.email,
    title,
    videoAssetId: video.data.uid,
    videoUrl: video.data.videoUrl,
    thumbnailUrl: video.data.thumbnailUrl,
    description,
    tags,
  });

  if (!created.ok) {
    return NextResponse.json(
      { ok: false, error: created.reason, message: created.message },
      { status: created.reason === "forbidden" ? 403 : created.reason === "invalid" ? 400 : 500 }
    );
  }

  return NextResponse.json({ ok: true, exercise: created.data });
}
