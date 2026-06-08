import "server-only";

export type LkClientData = {
  email: string;
  balance: string;
  finalDay: string;
};

export type LkClientRecord = LkClientData & {
  lkEnabled: boolean;
};

function airtableEnv() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const table = process.env.AIRTABLE_CLIENTS_TABLE;
  if (!apiKey || !baseId || !table) {
    return { ok: false as const, apiKey: "", baseId: "", table: "" };
  }
  return { ok: true as const, apiKey, baseId, table };
}

const BALANCE_ALIASES = [
  "Balance",
  "balance",
  "Баланс",
  "баланс",
  "Remainder",
  "Занятий",
  "Credits",
];

const FINAL_DAY_ALIASES = [
  "Final_day",
  "final_day",
  "FinalDay",
  "Final day",
  "Access until",
  "Доступ до",
  "доступ до",
  "End date",
  "Subscription end",
  "Date_end",
];

const EMAIL_ALIASES = ["Email", "email", "E-mail", "Почта", "почта"];

function scalarFromField(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (typeof first === "string" && first.trim()) return first.trim();
    if (typeof first === "number" && Number.isFinite(first)) return String(first);
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

/** Match Airtable column names case-insensitively (UI names must match base). */
function pickFromAliases(fields: Record<string, unknown>, aliases: string[]): string {
  const keys = Object.keys(fields);
  for (const alias of aliases) {
    const match = keys.find((k) => k.toLowerCase() === alias.toLowerCase());
    if (!match) continue;
    const s = scalarFromField(fields[match]);
    if (s) return s;
  }
  return "";
}

function pickBoolFromAliases(fields: Record<string, unknown>, aliases: string[]): boolean | null {
  const keys = Object.keys(fields);
  for (const alias of aliases) {
    const match = keys.find((k) => k.toLowerCase() === alias.toLowerCase());
    if (!match) continue;
    const b = boolFromField(fields[match]);
    if (b !== null) return b;
  }
  return null;
}

function emailColumnForFormula(): string {
  const raw = process.env.AIRTABLE_CLIENTS_EMAIL_FIELD?.trim();
  // Curly braces would break the filter formula; column names are otherwise trusted (env).
  if (raw && !/[{}]/.test(raw)) return raw;
  return "Email";
}

const CLIENT_LK_ENABLED_ALIASES = ["lk_enabled", "LK_Enabled", "lkEnabled", "LkEnabled"];

function clientsLkEnabledColumn(): string {
  const raw = process.env.AIRTABLE_CLIENTS_LK_ENABLED_FIELD?.trim();
  if (raw && !/[{}]/.test(raw)) return raw;
  return "lk_enabled";
}

function escapeFormulaString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function getClientByEmail(email: string): Promise<LkClientData | null> {
  const rec = await getClientRecordByEmail(email);
  if (!rec) return null;
  return {
    email: rec.email,
    balance: rec.balance,
    finalDay: rec.finalDay,
  };
}

export async function getClientRecordByEmail(email: string): Promise<LkClientRecord | null> {
  const env = airtableEnv();
  if (!env.ok) return null;

  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;

  const emailCol = emailColumnForFormula();
  const filterByFormula = encodeURIComponent(
    `(LOWER({${emailCol}}&"") = "${escapeFormulaString(normalizedEmail)}")`
  );
  const url =
    `https://api.airtable.com/v0/${env.baseId}/${encodeURIComponent(env.table)}` +
    `?pageSize=1&maxRecords=1&filterByFormula=${filterByFormula}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.apiKey}`,
      },
      cache: "no-store",
    });

    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as
      | { records?: Array<{ fields?: Record<string, unknown> }> }
      | null;
    const fields = json?.records?.[0]?.fields;
    if (!fields) return null;

    const balance = pickFromAliases(fields, BALANCE_ALIASES);
    const finalDay = pickFromAliases(fields, FINAL_DAY_ALIASES);
    const emailFromRecord = pickFromAliases(fields, EMAIL_ALIASES) || normalizedEmail;
    const lkEnabledEnvKey = clientsLkEnabledColumn();
    const lkEnabledRaw =
      pickBoolFromAliases(fields, [lkEnabledEnvKey, ...CLIENT_LK_ENABLED_ALIASES]);
    // Backward-compatible default: if field is absent, client remains allowed.
    const lkEnabled = lkEnabledRaw ?? true;

    return {
      email: emailFromRecord,
      balance: balance || "—",
      finalDay: finalDay || "—",
      lkEnabled,
    };
  } catch {
    return null;
  }
}

