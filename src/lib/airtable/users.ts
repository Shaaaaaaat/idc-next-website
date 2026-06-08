import "server-only";

export type LkUserRole = "admin" | "coach";

export type LkUserRecord = {
  email: string;
  role: LkUserRole | null;
  lkEnabled: boolean;
  coachName: string;
};

function airtableEnv() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const table = process.env.AIRTABLE_USERS_TABLE;
  if (!apiKey || !baseId || !table) {
    return { ok: false as const, apiKey: "", baseId: "", table: "" };
  }
  return { ok: true as const, apiKey, baseId, table };
}

function scalarFromField(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value) && value.length > 0) {
    return scalarFromField(value[0]);
  }
  return "";
}

function boolFromField(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (!s) return null;
    if (["true", "1", "yes", "y", "да", "enabled", "on"].includes(s)) return true;
    if (["false", "0", "no", "n", "нет", "disabled", "off"].includes(s)) return false;
  }
  if (Array.isArray(value) && value.length > 0) {
    return boolFromField(value[0]);
  }
  return null;
}

function pickFieldCaseInsensitive(fields: Record<string, unknown>, alias: string): unknown {
  const key = Object.keys(fields).find((k) => k.toLowerCase() === alias.toLowerCase());
  if (!key) return undefined;
  return fields[key];
}

function escapeFormulaString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function usersEmailColumn(): string {
  const raw = process.env.AIRTABLE_USERS_EMAIL_FIELD?.trim();
  if (raw && !/[{}]/.test(raw)) return raw;
  return "Email";
}

function usersRoleColumn(): string {
  const raw = process.env.AIRTABLE_USERS_ROLE_FIELD?.trim();
  if (raw && !/[{}]/.test(raw)) return raw;
  return "role";
}

function usersLkEnabledColumn(): string {
  const raw = process.env.AIRTABLE_USERS_LK_ENABLED_FIELD?.trim();
  if (raw && !/[{}]/.test(raw)) return raw;
  return "lk_enabled";
}

function usersCoachNameColumn(): string {
  const raw = process.env.AIRTABLE_USERS_COACH_NAME_FIELD?.trim();
  if (raw && !/[{}]/.test(raw)) return raw;
  return "coach_name";
}

function normalizeRole(raw: string): LkUserRole | null {
  const val = raw.trim().toLowerCase();
  if (val === "admin") return "admin";
  if (val === "coach") return "coach";
  return null;
}

export async function getUserByEmail(email: string): Promise<LkUserRecord | null> {
  const env = airtableEnv();
  // Users table is optional for backward compatibility.
  if (!env.ok) return null;

  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;

  const emailCol = usersEmailColumn();
  const filterByFormula = encodeURIComponent(
    `(LOWER({${emailCol}}&"") = "${escapeFormulaString(normalizedEmail)}")`
  );
  const url =
    `https://api.airtable.com/v0/${env.baseId}/${encodeURIComponent(env.table)}` +
    `?pageSize=1&maxRecords=1&filterByFormula=${filterByFormula}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${env.apiKey}` },
      cache: "no-store",
    });
    if (!res.ok) return null;

    const json = (await res.json().catch(() => null)) as
      | { records?: Array<{ fields?: Record<string, unknown> }> }
      | null;
    const fields = json?.records?.[0]?.fields;
    if (!fields) return null;

    const emailFromRecord =
      scalarFromField(pickFieldCaseInsensitive(fields, emailCol)) || normalizedEmail;
    const roleRaw =
      scalarFromField(pickFieldCaseInsensitive(fields, usersRoleColumn())) ||
      scalarFromField(pickFieldCaseInsensitive(fields, "Role"));
    const lkEnabledRaw =
      boolFromField(pickFieldCaseInsensitive(fields, usersLkEnabledColumn())) ??
      boolFromField(pickFieldCaseInsensitive(fields, "lk_enabled"));
    const coachName =
      scalarFromField(pickFieldCaseInsensitive(fields, usersCoachNameColumn())) ||
      scalarFromField(pickFieldCaseInsensitive(fields, "Coach_name")) ||
      scalarFromField(pickFieldCaseInsensitive(fields, "coach_name"));

    return {
      email: emailFromRecord,
      role: normalizeRole(roleRaw),
      // strict for Users table: if flag absent, treat as disabled
      lkEnabled: lkEnabledRaw === true,
      coachName,
    };
  } catch {
    return null;
  }
}

