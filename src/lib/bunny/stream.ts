import "server-only";

import { createHash } from "crypto";

const BUNNY_API_BASE = "https://video.bunnycdn.com";
const BUNNY_TUS_ENDPOINT = "https://video.bunnycdn.com/tusupload";
const DEFAULT_EMBED_HOST = "iframe.mediadelivery.net";

export type BunnyUploadResult = {
  videoId: string;
  videoUrl: string;
};

type BunnyCreateVideoResponse = {
  guid?: string;
  id?: string;
};

function readBunnyEnv() {
  const libraryId = String(process.env.BUNNY_STREAM_LIBRARY_ID || "").trim();
  const apiKey = String(process.env.BUNNY_STREAM_API_KEY || "").trim();
  const embedHost = String(process.env.BUNNY_STREAM_CDN_HOST || DEFAULT_EMBED_HOST).trim() || DEFAULT_EMBED_HOST;

  if (!libraryId || !apiKey) {
    return { ok: false as const, message: "Bunny Stream env is not configured" };
  }

  return { ok: true as const, libraryId, apiKey, embedHost };
}

async function readError(res: Response) {
  const text = await res.text().catch(() => "");
  return text || `${res.status} ${res.statusText}`;
}

export function getBunnyMaxUploadBytes() {
  const rawMb = Number(process.env.BUNNY_STREAM_MAX_UPLOAD_MB || 500);
  const mb = Number.isFinite(rawMb) && rawMb > 0 ? rawMb : 500;
  return mb * 1024 * 1024;
}

export function buildBunnyEmbedUrl(params: { libraryId: string; videoId: string; embedHost?: string }) {
  const host = String(params.embedHost || DEFAULT_EMBED_HOST).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return `https://${host}/embed/${encodeURIComponent(params.libraryId)}/${encodeURIComponent(params.videoId)}`;
}

export function buildBunnyEmbedUrlForVideo(videoId: string): { ok: true; videoUrl: string } | { ok: false; message: string } {
  const env = readBunnyEnv();
  if (!env.ok) return { ok: false, message: env.message };

  const cleanVideoId = String(videoId || "").trim();
  if (!cleanVideoId) return { ok: false, message: "Video id is required" };

  return {
    ok: true,
    videoUrl: buildBunnyEmbedUrl({
      libraryId: env.libraryId,
      videoId: cleanVideoId,
      embedHost: env.embedHost,
    }),
  };
}

export async function createBunnyVideo(
  title: string
): Promise<{ ok: true; videoId: string; videoUrl: string } | { ok: false; message: string }> {
  const env = readBunnyEnv();
  if (!env.ok) return { ok: false, message: env.message };

  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return { ok: false, message: "Video title is required" };

  const createRes = await fetch(`${BUNNY_API_BASE}/library/${encodeURIComponent(env.libraryId)}/videos`, {
    method: "POST",
    headers: {
      AccessKey: env.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ title: cleanTitle }),
    cache: "no-store",
  });

  if (!createRes.ok) {
    return { ok: false, message: `Bunny video create failed: ${await readError(createRes)}` };
  }

  const created = (await createRes.json().catch(() => null)) as BunnyCreateVideoResponse | null;
  const videoId = String(created?.guid || created?.id || "").trim();
  if (!videoId) {
    return { ok: false, message: "Bunny video create response did not include a video id" };
  }

  return {
    ok: true,
    videoId,
    videoUrl: buildBunnyEmbedUrl({
      libraryId: env.libraryId,
      videoId,
      embedHost: env.embedHost,
    }),
  };
}

export function createBunnyTusUploadAuth(videoId: string) {
  const env = readBunnyEnv();
  if (!env.ok) return { ok: false as const, message: env.message };

  const cleanVideoId = String(videoId || "").trim();
  if (!cleanVideoId) return { ok: false as const, message: "Video id is required" };

  const authorizationExpire = Math.floor(Date.now() / 1000) + 60 * 60;
  const authorizationSignature = createHash("sha256")
    .update(`${env.libraryId}${env.apiKey}${authorizationExpire}${cleanVideoId}`)
    .digest("hex");

  return {
    ok: true as const,
    endpoint: BUNNY_TUS_ENDPOINT,
    libraryId: env.libraryId,
    videoId: cleanVideoId,
    authorizationExpire,
    authorizationSignature,
    videoUrl: buildBunnyEmbedUrl({
      libraryId: env.libraryId,
      videoId: cleanVideoId,
      embedHost: env.embedHost,
    }),
  };
}

export async function uploadVideoToBunnyStream(params: {
  title: string;
  file: File;
}): Promise<{ ok: true; result: BunnyUploadResult } | { ok: false; message: string }> {
  const env = readBunnyEnv();
  if (!env.ok) return { ok: false, message: env.message };

  const title = String(params.title || "").trim();
  if (!title) return { ok: false, message: "Video title is required" };

  const createRes = await fetch(`${BUNNY_API_BASE}/library/${encodeURIComponent(env.libraryId)}/videos`, {
    method: "POST",
    headers: {
      AccessKey: env.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ title }),
    cache: "no-store",
  });

  if (!createRes.ok) {
    return { ok: false, message: `Bunny video create failed: ${await readError(createRes)}` };
  }

  const created = (await createRes.json().catch(() => null)) as BunnyCreateVideoResponse | null;
  const videoId = String(created?.guid || created?.id || "").trim();
  if (!videoId) {
    return { ok: false, message: "Bunny video create response did not include a video id" };
  }

  const uploadRes = await fetch(
    `${BUNNY_API_BASE}/library/${encodeURIComponent(env.libraryId)}/videos/${encodeURIComponent(videoId)}`,
    {
      method: "PUT",
      headers: {
        AccessKey: env.apiKey,
        Accept: "application/json",
        "Content-Type": params.file.type || "application/octet-stream",
      },
      body: Buffer.from(await params.file.arrayBuffer()),
      cache: "no-store",
    }
  );

  if (!uploadRes.ok) {
    return { ok: false, message: `Bunny video upload failed: ${await readError(uploadRes)}` };
  }

  return {
    ok: true,
    result: {
      videoId,
      videoUrl: buildBunnyEmbedUrl({
        libraryId: env.libraryId,
        videoId,
        embedHost: env.embedHost,
      }),
    },
  };
}
