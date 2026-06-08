import "server-only";

export type LkAuthResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "bad_response" | "request_failed" | "env_missing" | "auth_failed" };

type RequestPayload = {
  action: "request";
  token: string;
  email: string;
};

type ConsumePayload = {
  action: "consume";
  token: string;
  magic_token: string;
};

type ValidatePayload = {
  action: "validate_session";
  token: string;
  session_token: string;
};

type RevokePayload = {
  action: "revoke_session";
  token: string;
  session_token: string;
};

type ConsumeSuccess = {
  ok: true;
  session_token: string;
  email?: string;
};

type ValidateSuccess = {
  ok: true;
  email: string;
};

const AUTH_CF_URL = process.env.AUTH_CF_URL;
const AUTH_INTERNAL_TOKEN = process.env.AUTH_INTERNAL_TOKEN;

function envReady() {
  return Boolean(AUTH_CF_URL && AUTH_INTERNAL_TOKEN);
}

async function postAuth<TSuccess>(
  payload: RequestPayload | ConsumePayload | ValidatePayload | RevokePayload
): Promise<LkAuthResult<TSuccess>> {
  if (!envReady()) return { ok: false, reason: "env_missing" };

  try {
    const res = await fetch(String(AUTH_CF_URL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { ok: false, reason: "auth_failed" };
      }
      return { ok: false, reason: "request_failed" };
    }

    const json = (await res.json().catch(() => null)) as TSuccess | null;
    if (!json || typeof json !== "object") {
      return { ok: false, reason: "bad_response" };
    }

    return { ok: true, data: json };
  } catch {
    return { ok: false, reason: "request_failed" };
  }
}

export async function requestMagicLink(email: string): Promise<LkAuthResult<{ ok?: boolean }>> {
  const payload: RequestPayload = {
    action: "request",
    token: String(AUTH_INTERNAL_TOKEN || ""),
    email: String(email || "").trim().toLowerCase(),
  };
  return postAuth(payload);
}

export async function consumeMagicLink(magicToken: string): Promise<LkAuthResult<ConsumeSuccess>> {
  const payload: ConsumePayload = {
    action: "consume",
    token: String(AUTH_INTERNAL_TOKEN || ""),
    magic_token: String(magicToken || "").trim(),
  };
  return postAuth(payload);
}

export async function validateSession(
  sessionToken: string
): Promise<LkAuthResult<ValidateSuccess>> {
  const payload: ValidatePayload = {
    action: "validate_session",
    token: String(AUTH_INTERNAL_TOKEN || ""),
    session_token: String(sessionToken || "").trim(),
  };
  return postAuth(payload);
}

export async function revokeSession(
  sessionToken: string
): Promise<LkAuthResult<{ ok?: boolean }>> {
  const payload: RevokePayload = {
    action: "revoke_session",
    token: String(AUTH_INTERNAL_TOKEN || ""),
    session_token: String(sessionToken || "").trim(),
  };
  return postAuth(payload);
}

export function getAuthCookieName() {
  return process.env.AUTH_COOKIE_NAME || "idc_lk_session";
}

type AuthCookieSameSite = "lax" | "strict" | "none";

function readSameSite(raw: string | undefined): AuthCookieSameSite {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "strict") return "strict";
  if (value === "none") return "none";
  return "lax";
}

export function getAuthCookieConfig() {
  const secureFromEnv = String(process.env.AUTH_COOKIE_SECURE || "")
    .trim()
    .toLowerCase();
  const secure =
    secureFromEnv === "1" || secureFromEnv === "true"
      ? true
      : secureFromEnv === "0" || secureFromEnv === "false"
      ? false
      : process.env.NODE_ENV === "production";

  const maxAgeRaw = Number(process.env.AUTH_COOKIE_MAX_AGE || 60 * 60 * 24 * 90);
  const maxAge = Number.isFinite(maxAgeRaw) && maxAgeRaw > 0 ? Math.floor(maxAgeRaw) : 60 * 60 * 24 * 90;

  const domain = String(process.env.AUTH_COOKIE_DOMAIN || "").trim() || undefined;

  return {
    name: getAuthCookieName(),
    secure,
    sameSite: readSameSite(process.env.AUTH_COOKIE_SAMESITE),
    maxAge,
    domain,
    httpOnly: true as const,
    path: "/" as const,
  };
}

