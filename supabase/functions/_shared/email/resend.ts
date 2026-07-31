import type { EmailPayload, EmailSendResult, SenderProfile } from "./types.ts";

const RESEND_URL = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 20_000;

type SenderProfileConfig = {
  profile: SenderProfile;
  apiKey: string;
  from: string;
  replyTo?: string;
};

type SenderProfileResult =
  | { ok: true; profile: SenderProfile }
  | {
    ok: false;
    errorCode: "missing_sender_profile" | "unsupported_sender_profile";
    errorMessage: string;
  };

type SenderProfileCurrencyResult =
  | { ok: true }
  | {
    ok: false;
    errorCode: "sender_profile_currency_mismatch";
    errorMessage: string;
  };

const ALLOWED_SENDER_PROFILES = new Set<SenderProfile>([
  "international",
  "rub",
]);

function envSuffix(profile: SenderProfile) {
  return profile.toUpperCase();
}

function cleanHeaderValue(value: string) {
  return value.replace(/[\r\n]/g, "").trim();
}

function profileEnv(profile: SenderProfile, name: string) {
  return cleanHeaderValue(
    Deno.env.get(`${name}_${envSuffix(profile)}`) ?? "",
  );
}

export function normalizeEmailAddress(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

export function resolveSenderProfile(value: unknown): SenderProfileResult {
  if (typeof value !== "string" || !value.trim()) {
    return {
      ok: false,
      errorCode: "missing_sender_profile",
      errorMessage: "Sender profile is missing",
    };
  }

  const profile = value.trim().toLowerCase() as SenderProfile;

  if (!ALLOWED_SENDER_PROFILES.has(profile)) {
    return {
      ok: false,
      errorCode: "unsupported_sender_profile",
      errorMessage: "Unsupported sender profile",
    };
  }

  return { ok: true, profile };
}

export function expectedSenderProfileForCurrency(
  currency: unknown,
): SenderProfile | "" {
  if (typeof currency !== "string") return "";
  const normalized = currency.trim().toUpperCase();
  if (normalized === "USD" || normalized === "EUR") return "international";
  if (normalized === "RUB") return "rub";
  return "";
}

export function validateSenderProfileCurrency(
  currency: unknown,
  profile: SenderProfile,
): SenderProfileCurrencyResult {
  const expected = expectedSenderProfileForCurrency(currency);

  if (!expected) return { ok: true };
  if (expected === profile) return { ok: true };

  return {
    ok: false,
    errorCode: "sender_profile_currency_mismatch",
    errorMessage: "Sender profile does not match currency",
  };
}

function senderProfileConfig(
  profile: SenderProfile,
): SenderProfileConfig | null {
  const apiKey = profileEnv(profile, "RESEND_API_KEY");
  const fromAddress = profileEnv(profile, "RESEND_FROM");
  const fromName = profileEnv(profile, "RESEND_FROM_NAME");
  const replyTo = profileEnv(profile, "RESEND_REPLY_TO");

  if (!apiKey || !fromAddress) return null;

  return {
    profile,
    apiKey,
    from: fromName ? `${fromName} <${fromAddress}>` : fromAddress,
    ...(replyTo ? { replyTo } : {}),
  };
}

function resendErrorCode(status: number) {
  if (status === 401) return "resend_unauthorized";
  if (status === 403) return "resend_forbidden";
  if (status === 429) return "resend_rate_limited";
  if (status >= 500) return "resend_server_error";
  return "resend_request_rejected";
}

function safeProviderMessage(status: number) {
  return `Resend API returned status ${status}`;
}

export async function sendResendEmail(params: {
  profile: SenderProfile;
  idempotencyKey: string;
  email: EmailPayload;
}): Promise<EmailSendResult> {
  const config = senderProfileConfig(params.profile);

  if (!config) {
    return {
      ok: false,
      status: 0,
      attempts: 0,
      errorCode: "resend_sender_profile_config_missing",
      errorMessage: "Resend sender profile configuration is missing",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);

  try {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": params.idempotencyKey,
      },
      body: JSON.stringify({
        from: config.from,
        to: params.email.to,
        subject: params.email.subject,
        html: params.email.html,
        text: params.email.text,
        ...(config.replyTo ? { reply_to: config.replyTo } : {}),
      }),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({})) as { id?: unknown };

    if (response.ok && typeof body.id === "string" && body.id.trim()) {
      return {
        ok: true,
        status: response.status,
        attempts: 1,
        providerMessageId: body.id.trim(),
      };
    }

    return {
      ok: false,
      status: response.status,
      attempts: 1,
      errorCode: response.ok
        ? "resend_response_missing_id"
        : resendErrorCode(response.status),
      errorMessage: response.ok
        ? "Resend response id is missing"
        : safeProviderMessage(response.status),
    };
  } catch (error) {
    const isTimeout = error instanceof DOMException &&
      error.name === "AbortError";

    return {
      ok: false,
      status: 0,
      attempts: 1,
      errorCode: isTimeout ? "resend_timeout" : "resend_fetch_error",
      errorMessage: isTimeout
        ? "Resend request timed out"
        : "Resend request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}
