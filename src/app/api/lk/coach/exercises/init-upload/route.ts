import { NextResponse } from "next/server";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import { createCloudflareDirectTusUpload, getCloudflareMaxUploadBytes } from "@/lib/cloudflare/stream";

export const runtime = "nodejs";

const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

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
  const fileType = String(body.fileType || "").trim();
  const fileSize = Number(body.fileSize || 0);

  if (!title) {
    return NextResponse.json({ ok: false, error: "title_required" }, { status: 400 });
  }
  if (!ALLOWED_VIDEO_TYPES.has(fileType)) {
    return NextResponse.json({ ok: false, error: "video_type_not_allowed" }, { status: 400 });
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return NextResponse.json({ ok: false, error: "video_required" }, { status: 400 });
  }
  if (fileSize > getCloudflareMaxUploadBytes()) {
    return NextResponse.json({ ok: false, error: "video_too_large" }, { status: 413 });
  }

  const upload = await createCloudflareDirectTusUpload({
    title,
    fileName: typeof body.fileName === "string" ? body.fileName : undefined,
    fileType,
    fileSize,
  });
  if (!upload.ok) {
    return NextResponse.json(
      { ok: false, error: "cloudflare_upload_init_failed", message: upload.message },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    provider: "cloudflare",
    endpoint: upload.data.uploadUrl,
    videoId: upload.data.uid,
    videoUrl: upload.data.videoUrl,
    thumbnailUrl: upload.data.thumbnailUrl,
  });
}
