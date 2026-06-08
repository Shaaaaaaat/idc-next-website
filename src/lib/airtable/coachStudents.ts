import "server-only";

export type CoachStudent = {
  id: string;
  name: string;
  email?: string;
  finalDay: string;
  balance: string;
  nextWorkoutAt?: string;
  grPrice?: string;
  dsPrice?: string;
  prPrice?: string;
  spPrice?: string;
  futurePlan?: string;
  tag?: string;
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

function scalarFromField(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value) && value.length > 0) {
    return scalarFromField(value[0]);
  }
  return "";
}

function pickFromAliases(fields: Record<string, unknown>, aliases: string[]): string {
  const keys = Object.keys(fields);
  for (const alias of aliases) {
    const key = keys.find((k) => k.toLowerCase() === alias.toLowerCase());
    if (!key) continue;
    const v = scalarFromField(fields[key]);
    if (v) return v;
  }
  return "";
}

function coachFieldColumn(): string {
  const raw = process.env.AIRTABLE_CLIENTS_COACH_FIELD?.trim();
  if (raw && !/[{}]/.test(raw)) return raw;
  return "Coach";
}

const NAME_ALIASES = ["FIO3", "fio3", "FIO", "fio", "Name", "name"];
const FINAL_DAY_ALIASES = [
  "Final_day",
  "final_day",
  "FinalDay",
  "Final day",
  "Доступ до",
  "Access until",
];
const BALANCE_ALIASES = ["Balance", "balance", "Баланс", "Remainder", "Credits"];
const CURRENCY_ALIASES = ["Currency", "currency", "Валюта", "валюта"];
const GR_PRICE_ALIASES = ["GR_price", "gr_price", "GR Price", "gr price"];
const DS_PRICE_ALIASES = ["DS_price", "ds_price", "DS Price", "ds price"];
const PR_PRICE_ALIASES = ["PR_price", "pr_price", "PR Price", "pr price"];
const SP_PRICE_ALIASES = ["SP_price", "sp_price", "SP Price", "sp price"];
const FUTURE_PLAN_ALIASES = ["Future_plan", "future_plan", "Future plan"];
const TAG_ALIASES = ["Tag", "tag", "Тэг", "Тег"];

function currencySymbolFromCode(raw: string) {
  const code = raw.trim().toUpperCase();
  if (code === "RUB") return "₽";
  if (code === "USD") return "$";
  if (code === "EUR") return "€";
  return "";
}

function formatBalance(balanceRaw: string, currencyRaw: string) {
  const balance = balanceRaw.trim();
  if (!balance) return "—";
  if (/[₽$€]/.test(balance)) return balance;
  const symbol = currencySymbolFromCode(currencyRaw);
  return symbol ? `${balance} ${symbol}` : balance;
}

type AirtableRecord = { id?: string; fields?: Record<string, unknown> };

async function loadAllClientRecords(): Promise<AirtableRecord[]> {
  const env = airtableEnv();
  if (!env.ok) return [];

  const baseUrl = `https://api.airtable.com/v0/${env.baseId}/${encodeURIComponent(env.table)}`;
  try {
    let offset = "";
    const allRecords: AirtableRecord[] = [];
    let guard = 0;

    // Fetch all records via offset pagination (bounded loop for safety).
    while (guard < 100) {
      guard += 1;
      const pageUrl =
        `${baseUrl}?pageSize=100` + (offset ? `&offset=${encodeURIComponent(offset)}` : "");
      const res = await fetch(pageUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${env.apiKey}` },
        cache: "no-store",
      });
      if (!res.ok) return [];

      const json = (await res.json().catch(() => null)) as
        | { records?: AirtableRecord[]; offset?: string }
        | null;
      const pageRecords = Array.isArray(json?.records) ? json.records : [];
      allRecords.push(...pageRecords);
      offset = typeof json?.offset === "string" ? json.offset : "";
      if (!offset) break;
    }

    return allRecords;
  } catch {
    return [];
  }
}

function normalizeCoachValues(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((v) => String(v || "").trim().toLowerCase())
      .filter(Boolean);
  }
  const one = String(raw || "").trim().toLowerCase();
  return one ? [one] : [];
}

function mapStudents(records: AirtableRecord[]): CoachStudent[] {
  return records
    .map((rec, idx) => {
      const fields = rec.fields || {};
      return {
        id: rec.id || String(idx),
        name: pickFromAliases(fields, NAME_ALIASES) || "—",
        finalDay: pickFromAliases(fields, FINAL_DAY_ALIASES) || "—",
        balance: formatBalance(
          pickFromAliases(fields, BALANCE_ALIASES),
          pickFromAliases(fields, CURRENCY_ALIASES)
        ),
        grPrice: pickFromAliases(fields, GR_PRICE_ALIASES) || "—",
        dsPrice: pickFromAliases(fields, DS_PRICE_ALIASES) || "—",
        prPrice: pickFromAliases(fields, PR_PRICE_ALIASES) || "—",
        spPrice: pickFromAliases(fields, SP_PRICE_ALIASES) || "—",
        futurePlan: pickFromAliases(fields, FUTURE_PLAN_ALIASES) || "—",
        tag: pickFromAliases(fields, TAG_ALIASES) || "—",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export async function getCoachStudents(coachNameRaw: string): Promise<CoachStudent[]> {
  const coachName = String(coachNameRaw || "").trim().toLowerCase();
  if (!coachName) return [];

  const coachCol = coachFieldColumn();
  const allRecords = await loadAllClientRecords();
  const filtered = allRecords.filter((rec) => {
    const fields = rec.fields || {};
    const coachRaw = fields[coachCol] ?? fields.Coach;
    const values = normalizeCoachValues(coachRaw);
    if (values.length === 0) return false;
    return values.some((v) => v === coachName);
  });

  return mapStudents(filtered);
}

export async function getAdminActiveStudents(): Promise<CoachStudent[]> {
  const coachCol = coachFieldColumn();
  const allRecords = await loadAllClientRecords();
  const filtered = allRecords.filter((rec) => {
    const fields = rec.fields || {};
    const coachRaw = fields[coachCol] ?? fields.Coach;
    const values = normalizeCoachValues(coachRaw);
    if (values.length === 0) return false;
    return !values.includes("wr_off");
  });

  return mapStudents(filtered);
}

