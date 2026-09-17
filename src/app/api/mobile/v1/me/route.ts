import { getMobileStudentContext } from "@/lib/auth/mobileSession";
import { mobileError, mobileJson } from "@/app/api/mobile/v1/_lib/responses";
import { createClientAvatarSignedReadUrl } from "@/lib/supabase/clientAvatarStorage";
import {
  getStudentMobileProfileByClientId,
  type StudentMobileProfile,
  type StudentProfileResult,
  type StudentProfileUpdateInput,
  updateStudentMobileProfileByClientId,
} from "@/lib/supabase/studentProfile";

export const runtime = "nodejs";

type MobileSessionContext = {
  email: string;
  clientId: string;
  displayName?: string;
};

const ALLOWED_PATCH_KEYS = new Set(["city", "birthDate", "weightKg", "heightCm"]);
const MIN_BIRTH_DATE = "1950-01-01";

function profileError(result: Exclude<StudentProfileResult, { ok: true }>) {
  if (result.reason === "invalid") return mobileError("BAD_REQUEST", 400);
  if (result.reason === "not_found") return mobileError("NOT_FOUND", 404);
  if (result.reason === "disabled") return mobileError("INTERNAL_ERROR", 503);
  return mobileError("INTERNAL_ERROR", 500);
}

function profileToUser(
  profile: StudentMobileProfile,
  session: MobileSessionContext,
  avatarUrl: string | null
) {
  const fio = profile.fio;

  return {
    clientId: profile.clientId,
    email: profile.email ?? session.email,
    displayName: fio ?? session.displayName ?? null,
    isActive: profile.isActive === false ? false : true,
    fio,
    balance: profile.balance,
    currency: profile.currency,
    finalDay: profile.finalDay,
    city: profile.city,
    birthDate: profile.birthDate,
    weightKg: profile.weightKg,
    heightCm: profile.heightCm,
    avatarUrl,
  };
}

async function avatarUrlForProfile(profile: StudentMobileProfile): Promise<string | null> {
  if (!profile.avatarPath) return null;

  const result = await createClientAvatarSignedReadUrl(
    profile.clientId,
    profile.avatarPath
  );
  if (!result.ok) {
    console.warn("[api/mobile/v1/me] avatar signed read failed", {
      operation: "signed_read",
    });
    return null;
  }

  return result.data.signedUrl;
}

async function requireMobileSession(req: Request) {
  const session = await getMobileStudentContext(req);
  if (!session.ok) {
    if (session.reason === "server_error") {
      return { ok: false as const, response: mobileError("INTERNAL_ERROR", 500) };
    }
    if (session.reason === "forbidden") {
      return { ok: false as const, response: mobileError("FORBIDDEN", 403) };
    }
    return { ok: false as const, response: mobileError("UNAUTHORIZED", 401) };
  }

  return { ok: true as const, context: session.context };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function todayDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function isRealDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function validateCity(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;

  const city = value.trim();
  if (city.length < 1 || city.length > 50) return undefined;
  return city;
}

function validateBirthDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;

  const birthDate = value.trim();
  if (!isRealDateKey(birthDate)) return undefined;
  if (birthDate < MIN_BIRTH_DATE || birthDate > todayDateKey()) return undefined;
  return birthDate;
}

function validateRangeNumber(
  value: unknown,
  min: number,
  max: number
): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < min || value > max) return undefined;
  return value;
}

function validatePatch(body: Record<string, unknown>):
  | { ok: true; patch: StudentProfileUpdateInput }
  | { ok: false } {
  const keys = Object.keys(body);
  if (keys.length === 0) return { ok: false };
  if (keys.some((key) => !ALLOWED_PATCH_KEYS.has(key))) return { ok: false };

  const patch: StudentProfileUpdateInput = {};

  if (Object.prototype.hasOwnProperty.call(body, "city")) {
    const city = validateCity(body.city);
    if (city === undefined) return { ok: false };
    patch.city = city;
  }

  if (Object.prototype.hasOwnProperty.call(body, "birthDate")) {
    const birthDate = validateBirthDate(body.birthDate);
    if (birthDate === undefined) return { ok: false };
    patch.birthDate = birthDate;
  }

  if (Object.prototype.hasOwnProperty.call(body, "weightKg")) {
    const weightKg = validateRangeNumber(body.weightKg, 20, 500);
    if (weightKg === undefined) return { ok: false };
    patch.weightKg = weightKg;
  }

  if (Object.prototype.hasOwnProperty.call(body, "heightCm")) {
    const heightCm = validateRangeNumber(body.heightCm, 50, 250);
    if (heightCm === undefined) return { ok: false };
    patch.heightCm = heightCm;
  }

  return Object.keys(patch).length > 0 ? { ok: true, patch } : { ok: false };
}

export async function GET(req: Request) {
  const session = await requireMobileSession(req);
  if (!session.ok) return session.response;

  const result = await getStudentMobileProfileByClientId(session.context.clientId);
  if (!result.ok) return profileError(result);
  const avatarUrl = await avatarUrlForProfile(result.profile);

  return mobileJson({
    user: profileToUser(result.profile, session.context, avatarUrl),
  });
}

export async function PATCH(req: Request) {
  const session = await requireMobileSession(req);
  if (!session.ok) return session.response;

  const body = (await req.json().catch(() => null)) as unknown;
  if (!isJsonObject(body)) return mobileError("BAD_REQUEST", 400);

  const validated = validatePatch(body);
  if (!validated.ok) return mobileError("BAD_REQUEST", 400);

  const result = await updateStudentMobileProfileByClientId(
    session.context.clientId,
    validated.patch
  );
  if (!result.ok) return profileError(result);
  const avatarUrl = await avatarUrlForProfile(result.profile);

  return mobileJson({
    user: profileToUser(result.profile, session.context, avatarUrl),
  });
}
