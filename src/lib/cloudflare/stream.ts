import "server-only";

const CLOUDFLARE_STREAM_API_BASE = "https://api.cloudflare.com/client/v4";
const DEFAULT_CUSTOMER_DOMAIN = "customer-mzjp8mklh35mmlo3.cloudflarestream.com";
const DEFAULT_MAX_UPLOAD_MB = 500;
const TUS_VERSION = "1.0.0";

type CloudflareStreamEnv =
  | {
      ok: true;
      accountId: string;
      apiToken: string;
      customerDomain: string;
      maxUploadBytes: number;
    }
  | { ok: false; message: string };

export type CloudflareVideoUrls = {
  uid: string;
  videoUrl: string;
  thumbnailUrl: string;
};

export type CloudflareDirectUpload = CloudflareVideoUrls & {
  uploadUrl: string;
};

function readCloudflareStreamEnv(): CloudflareStreamEnv {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const apiToken = String(process.env.CLOUDFLARE_STREAM_API_TOKEN || "").trim();
  const customerDomain =
    normalizeHostname(process.env.CLOUDFLARE_STREAM_CUSTOMER_DOMAIN) || DEFAULT_CUSTOMER_DOMAIN;
  const rawMaxMb = Number(process.env.CLOUDFLARE_STREAM_MAX_UPLOAD_MB || DEFAULT_MAX_UPLOAD_MB);
  const maxUploadMb = Number.isFinite(rawMaxMb) && rawMaxMb > 0 ? rawMaxMb : DEFAULT_MAX_UPLOAD_MB;

  if (!accountId || !apiToken) {
    return { ok: false, message: "Cloudflare Stream env is not configured" };
  }

  return {
    ok: true,
    accountId,
    apiToken,
    customerDomain,
    maxUploadBytes: maxUploadMb * 1024 * 1024,
  };
}

function normalizeHostname(raw: unknown): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  return value.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
}

function isAllowedCloudflareVideoHost(hostname: string) {
  const host = normalizeHostname(hostname);
  const configuredHost = normalizeHostname(process.env.CLOUDFLARE_STREAM_CUSTOMER_DOMAIN) || DEFAULT_CUSTOMER_DOMAIN;

  return (
    host === configuredHost ||
    host === "videodelivery.net" ||
    host === "iframe.videodelivery.net" ||
    (host.startsWith("customer-") && host.endsWith(".cloudflarestream.com"))
  );
}

function base64Encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

async function readError(res: Response) {
  const text = await res.text().catch(() => "");
  return text || `${res.status} ${res.statusText}`;
}

export function getCloudflareMaxUploadBytes() {
  const env = readCloudflareStreamEnv();
  if (env.ok) return env.maxUploadBytes;

  const rawMaxMb = Number(process.env.CLOUDFLARE_STREAM_MAX_UPLOAD_MB || DEFAULT_MAX_UPLOAD_MB);
  const maxUploadMb = Number.isFinite(rawMaxMb) && rawMaxMb > 0 ? rawMaxMb : DEFAULT_MAX_UPLOAD_MB;
  return maxUploadMb * 1024 * 1024;
}

export function isCloudflareStreamUid(raw: unknown): raw is string {
  const value = String(raw || "").trim();
  return /^[a-zA-Z0-9_-]{20,64}$/.test(value);
}

export function parseCloudflareStreamUid(raw: unknown): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (isCloudflareStreamUid(value)) return value;

  try {
    const url = new URL(value);
    if (!isAllowedCloudflareVideoHost(url.hostname)) return "";
    const pathParts = url.pathname.split("/").filter(Boolean);
    const candidate = pathParts.find((part) => isCloudflareStreamUid(part));
    return candidate || "";
  } catch {
    return "";
  }
}

export function buildCloudflareIframeUrl(uid: string, customerDomain?: string) {
  const cleanUid = String(uid || "").trim();
  const host =
    normalizeHostname(customerDomain) ||
    normalizeHostname(process.env.CLOUDFLARE_STREAM_CUSTOMER_DOMAIN) ||
    DEFAULT_CUSTOMER_DOMAIN;
  return `https://${host}/${encodeURIComponent(cleanUid)}/iframe`;
}

export function buildCloudflareThumbnailUrl(uid: string, customerDomain?: string) {
  const cleanUid = String(uid || "").trim();
  const host =
    normalizeHostname(customerDomain) ||
    normalizeHostname(process.env.CLOUDFLARE_STREAM_CUSTOMER_DOMAIN) ||
    DEFAULT_CUSTOMER_DOMAIN;
  return `https://${host}/${encodeURIComponent(cleanUid)}/thumbnails/thumbnail.jpg`;
}

export function normalizeCloudflareVideo(
  raw: unknown
): { ok: true; data: CloudflareVideoUrls } | { ok: false; message: string } {
  const uid = parseCloudflareStreamUid(raw);
  if (!isCloudflareStreamUid(uid)) {
    return { ok: false, message: "Invalid Cloudflare Stream UID" };
  }

  return {
    ok: true,
    data: {
      uid,
      videoUrl: buildCloudflareIframeUrl(uid),
      thumbnailUrl: buildCloudflareThumbnailUrl(uid),
    },
  };
}

export async function verifyCloudflareVideoExists(uid: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const env = readCloudflareStreamEnv();
  if (!env.ok) return { ok: false, message: env.message };
  if (!isCloudflareStreamUid(uid)) return { ok: false, message: "Invalid Cloudflare Stream UID" };

  const res = await fetch(
    `${CLOUDFLARE_STREAM_API_BASE}/accounts/${encodeURIComponent(env.accountId)}/stream/${encodeURIComponent(uid)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.apiToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  if (!res.ok) {
    return { ok: false, message: `Cloudflare Stream video lookup failed: ${await readError(res)}` };
  }

  return { ok: true };
}

export async function deleteCloudflareStreamVideo(uid: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const env = readCloudflareStreamEnv();
  if (!env.ok) return { ok: false, message: env.message };
  if (!isCloudflareStreamUid(uid)) return { ok: false, message: "Invalid Cloudflare Stream UID" };

  const res = await fetch(
    `${CLOUDFLARE_STREAM_API_BASE}/accounts/${encodeURIComponent(env.accountId)}/stream/${encodeURIComponent(uid)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${env.apiToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  if (!res.ok) {
    return { ok: false, message: `Cloudflare Stream video delete failed: ${await readError(res)}` };
  }

  return { ok: true };
}

export async function createCloudflareDirectTusUpload(params: {
  title: string;
  fileName?: string;
  fileType?: string;
  fileSize: number;
}): Promise<{ ok: true; data: CloudflareDirectUpload } | { ok: false; message: string }> {
  const env = readCloudflareStreamEnv();
  if (!env.ok) return { ok: false, message: env.message };

  const title = String(params.title || "").trim();
  const fileSize = Number(params.fileSize || 0);
  if (!title) return { ok: false, message: "Video title is required" };
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return { ok: false, message: "Video file size is required" };
  }

  const metadata = [
    `name ${base64Encode(params.fileName || title)}`,
    `maxdurationseconds ${base64Encode("3600")}`,
  ];
  if (params.fileType) {
    metadata.push(`filetype ${base64Encode(params.fileType)}`);
  }

  const res = await fetch(
    `${CLOUDFLARE_STREAM_API_BASE}/accounts/${encodeURIComponent(env.accountId)}/stream?direct_user=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.apiToken}`,
        "Tus-Resumable": TUS_VERSION,
        "Upload-Length": String(fileSize),
        "Upload-Metadata": metadata.join(","),
      },
      cache: "no-store",
    }
  );

  const uploadUrl = res.headers.get("Location") || "";
  const uid = res.headers.get("stream-media-id") || "";

  if (res.status !== 201 || !uploadUrl || !isCloudflareStreamUid(uid)) {
    const message = res.ok
      ? "Cloudflare Stream upload response did not include Location and stream-media-id"
      : await readError(res);
    return { ok: false, message };
  }

  return {
    ok: true,
    data: {
      uid,
      uploadUrl,
      videoUrl: buildCloudflareIframeUrl(uid, env.customerDomain),
      thumbnailUrl: buildCloudflareThumbnailUrl(uid, env.customerDomain),
    },
  };
}
