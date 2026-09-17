import "server-only";

import { randomUUID } from "node:crypto";
import { getSupabaseAdmin, isSupabaseEnabled } from "@/lib/supabase/server";

export const CLIENT_AVATAR_BUCKET = "client-avatars";
export const CLIENT_AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const CLIENT_AVATAR_READ_TTL_SECONDS = 300;

export type ClientAvatarContentType = "image/jpeg" | "image/png" | "image/webp";

export type ClientAvatarStorageReason =
  | "disabled"
  | "invalid"
  | "not_found"
  | "metadata_unavailable"
  | "object_not_allowed"
  | "storage_error";

export type ClientAvatarStorageResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: ClientAvatarStorageReason };

export type ClientAvatarSignedUpload = {
  path: string;
  signedUploadUrl: string;
  token: string;
};

export type ClientAvatarObjectInfo = {
  path: string;
  contentType: ClientAvatarContentType;
  sizeBytes: number;
};

export type ClientAvatarSignedReadInput = {
  clientId: string;
  path: string | null | undefined;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AVATAR_FILENAME_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp)$/i;

const EXTENSION_BY_CONTENT_TYPE: Record<ClientAvatarContentType, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const CONTENT_TYPE_BY_EXTENSION: Record<"jpg" | "png" | "webp", ClientAvatarContentType> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function normalizeUuid(value: unknown): string | null {
  const normalized = String(value || "").trim().toLowerCase();
  return UUID_RE.test(normalized) ? normalized : null;
}

function normalizeContentType(value: unknown): ClientAvatarContentType | null {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized in EXTENSION_BY_CONTENT_TYPE
    ? (normalized as ClientAvatarContentType)
    : null;
}

function parseOwnedAvatarPath(
  clientId: unknown,
  path: unknown
): { clientId: string; path: string; contentType: ClientAvatarContentType } | null {
  const normalizedClientId = normalizeUuid(clientId);
  const normalizedPath = String(path || "").trim();
  if (!normalizedClientId || !normalizedPath) return null;

  const segments = normalizedPath.split("/");
  if (
    segments.length !== 3 ||
    segments[0] !== "clients" ||
    segments[1].toLowerCase() !== normalizedClientId
  ) {
    return null;
  }

  const filenameMatch = AVATAR_FILENAME_RE.exec(segments[2]);
  if (!filenameMatch) return null;

  const extension = filenameMatch[2].toLowerCase() as "jpg" | "png" | "webp";
  return {
    clientId: normalizedClientId,
    path: `clients/${normalizedClientId}/${filenameMatch[1].toLowerCase()}.${extension}`,
    contentType: CONTENT_TYPE_BY_EXTENSION[extension],
  };
}

function storageStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = Number((error as { status?: unknown }).status);
  return Number.isInteger(status) ? status : null;
}

function storageFailure(error: unknown): ClientAvatarStorageResult<never> {
  return {
    ok: false,
    reason: storageStatus(error) === 404 ? "not_found" : "storage_error",
  };
}

function warnStorageFailure(
  operation: "signed_upload" | "signed_read" | "object_info" | "delete"
) {
  console.warn("[supabase/clientAvatarStorage] operation failed", { operation });
}

function getWriteStorage() {
  if (!isSupabaseEnabled("write_student_profile")) return null;
  return getSupabaseAdmin()?.storage.from(CLIENT_AVATAR_BUCKET) ?? null;
}

function getReadStorage() {
  if (
    !isSupabaseEnabled("read_coach_lk") &&
    !isSupabaseEnabled("write_student_profile")
  ) {
    return null;
  }
  return getSupabaseAdmin()?.storage.from(CLIENT_AVATAR_BUCKET) ?? null;
}

export function isClientAvatarContentType(
  value: unknown
): value is ClientAvatarContentType {
  return normalizeContentType(value) !== null;
}

export function isOwnedClientAvatarPath(clientId: unknown, path: unknown): boolean {
  return parseOwnedAvatarPath(clientId, path) !== null;
}

export async function createClientAvatarSignedUpload(
  clientId: string,
  contentType: string
): Promise<ClientAvatarStorageResult<ClientAvatarSignedUpload>> {
  const normalizedClientId = normalizeUuid(clientId);
  const normalizedContentType = normalizeContentType(contentType);
  if (!normalizedClientId || !normalizedContentType) {
    return { ok: false, reason: "invalid" };
  }

  const storage = getWriteStorage();
  if (!storage) return { ok: false, reason: "disabled" };

  const extension = EXTENSION_BY_CONTENT_TYPE[normalizedContentType];
  const path = `clients/${normalizedClientId}/${randomUUID()}.${extension}`;

  try {
    const { data, error } = await storage.createSignedUploadUrl(path, {
      upsert: false,
    });
    if (error) {
      warnStorageFailure("signed_upload");
      return storageFailure(error);
    }
    if (
      !data ||
      data.path !== path ||
      typeof data.signedUrl !== "string" ||
      !data.signedUrl ||
      typeof data.token !== "string" ||
      !data.token
    ) {
      warnStorageFailure("signed_upload");
      return { ok: false, reason: "storage_error" };
    }

    return {
      ok: true,
      data: {
        path,
        signedUploadUrl: data.signedUrl,
        token: data.token,
      },
    };
  } catch {
    warnStorageFailure("signed_upload");
    return { ok: false, reason: "storage_error" };
  }
}

export async function createClientAvatarSignedReadUrl(
  clientId: string,
  path: string
): Promise<ClientAvatarStorageResult<{ signedUrl: string; expiresIn: number }>> {
  const ownedPath = parseOwnedAvatarPath(clientId, path);
  if (!ownedPath) return { ok: false, reason: "invalid" };

  const storage = getReadStorage();
  if (!storage) return { ok: false, reason: "disabled" };

  try {
    const { data, error } = await storage.createSignedUrl(
      ownedPath.path,
      CLIENT_AVATAR_READ_TTL_SECONDS
    );
    if (error) {
      warnStorageFailure("signed_read");
      return storageFailure(error);
    }
    if (!data || typeof data.signedUrl !== "string" || !data.signedUrl) {
      warnStorageFailure("signed_read");
      return { ok: false, reason: "storage_error" };
    }

    return {
      ok: true,
      data: {
        signedUrl: data.signedUrl,
        expiresIn: CLIENT_AVATAR_READ_TTL_SECONDS,
      },
    };
  } catch {
    warnStorageFailure("signed_read");
    return { ok: false, reason: "storage_error" };
  }
}

export async function createClientAvatarSignedReadUrls(
  inputs: ClientAvatarSignedReadInput[]
): Promise<ClientAvatarStorageResult<Map<string, string>>> {
  const pathToClientId = new Map<string, string>();
  const validPaths: string[] = [];

  for (const input of inputs) {
    const ownedPath = parseOwnedAvatarPath(input.clientId, input.path);
    if (!ownedPath || pathToClientId.has(ownedPath.path)) continue;

    pathToClientId.set(ownedPath.path, ownedPath.clientId);
    validPaths.push(ownedPath.path);
  }

  if (validPaths.length === 0) {
    return { ok: true, data: new Map() };
  }

  const storage = getReadStorage();
  if (!storage) return { ok: false, reason: "disabled" };

  try {
    const { data, error } = await storage.createSignedUrls(
      validPaths,
      CLIENT_AVATAR_READ_TTL_SECONDS
    );
    if (error) {
      warnStorageFailure("signed_read");
      return storageFailure(error);
    }
    if (!Array.isArray(data)) {
      warnStorageFailure("signed_read");
      return { ok: false, reason: "storage_error" };
    }

    const signedUrlsByClientId = new Map<string, string>();
    let hasPerPathFailure = false;

    for (const item of data) {
      const path = typeof item?.path === "string" ? item.path : "";
      const clientId = pathToClientId.get(path);
      const signedUrl = typeof item?.signedUrl === "string" ? item.signedUrl : "";

      if (!clientId || item?.error || !signedUrl) {
        hasPerPathFailure = true;
        continue;
      }

      signedUrlsByClientId.set(clientId, signedUrl);
    }

    if (hasPerPathFailure) warnStorageFailure("signed_read");

    return { ok: true, data: signedUrlsByClientId };
  } catch {
    warnStorageFailure("signed_read");
    return { ok: false, reason: "storage_error" };
  }
}

export async function getClientAvatarObjectInfo(
  clientId: string,
  path: string
): Promise<ClientAvatarStorageResult<ClientAvatarObjectInfo>> {
  const ownedPath = parseOwnedAvatarPath(clientId, path);
  if (!ownedPath) return { ok: false, reason: "invalid" };

  const storage = getWriteStorage();
  if (!storage) return { ok: false, reason: "disabled" };

  try {
    const { data, error } = await storage.info(ownedPath.path);
    if (error) {
      warnStorageFailure("object_info");
      return storageFailure(error);
    }

    const sizeBytes = data?.size;
    const contentType = normalizeContentType(data?.contentType);
    if (
      typeof sizeBytes !== "number" ||
      !Number.isFinite(sizeBytes) ||
      !contentType
    ) {
      return { ok: false, reason: "metadata_unavailable" };
    }
    if (
      sizeBytes <= 0 ||
      sizeBytes > CLIENT_AVATAR_MAX_BYTES ||
      contentType !== ownedPath.contentType
    ) {
      return { ok: false, reason: "object_not_allowed" };
    }

    return {
      ok: true,
      data: {
        path: ownedPath.path,
        contentType,
        sizeBytes,
      },
    };
  } catch {
    warnStorageFailure("object_info");
    return { ok: false, reason: "storage_error" };
  }
}

export async function deleteClientAvatarObject(
  clientId: string,
  path: string
): Promise<ClientAvatarStorageResult<{ deleted: true }>> {
  const ownedPath = parseOwnedAvatarPath(clientId, path);
  if (!ownedPath) return { ok: false, reason: "invalid" };

  const storage = getWriteStorage();
  if (!storage) return { ok: false, reason: "disabled" };

  try {
    const { error } = await storage.remove([ownedPath.path]);
    if (error) {
      warnStorageFailure("delete");
      return storageFailure(error);
    }
    return { ok: true, data: { deleted: true } };
  } catch {
    warnStorageFailure("delete");
    return { ok: false, reason: "storage_error" };
  }
}

export async function cleanupClientAvatarObjectBestEffort(
  clientId: string,
  path: string
): Promise<void> {
  await deleteClientAvatarObject(clientId, path);
}
