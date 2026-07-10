import "server-only";

import type { CoachStudent } from "@/lib/airtable/coachStudents";
import { getSupabaseAdmin, isSupabaseEnabled } from "@/lib/supabase/server";

export type CoachProfileRow = {
  id: string;
  email: string;
  access_level?: "coach" | "head_coach" | null;
  is_active?: boolean | null;
};

/**
 * Active coach profile by session email (lowercased).
 */
export async function getCoachByEmail(email: string): Promise<CoachProfileRow | null> {
  if (!isSupabaseEnabled("read_coach_lk")) return null;
  const sb = getSupabaseAdmin();
  if (!sb) return null;

  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;

  try {
    const { data, error } = await sb
      .from("coach_profiles")
      .select("id, email, access_level, is_active")
      .eq("email", normalized)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      console.warn("[supabase/coachStudents] getCoachByEmail failed", error.message);
      return null;
    }
    if (!data || typeof data !== "object") return null;
    const row = data as {
      id: string;
      email: string;
      access_level?: "coach" | "head_coach" | null;
      is_active?: boolean | null;
    };
    return { id: row.id, email: row.email, access_level: row.access_level || "coach", is_active: row.is_active };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[supabase/coachStudents] getCoachByEmail crashed", msg);
    return null;
  }
}

type ClientRow = {
  id: string;
  email?: string | null;
  fio?: string | null;
  is_active?: boolean | null;
  final_day?: string | null;
  balance?: string | number | null;
  currency?: string | null;
  gr_price?: string | number | null;
  ds_price?: string | number | null;
  pr_price?: string | number | null;
  sp_price?: string | number | null;
  future_plan?: string | null;
  tag?: string | null;
  coach?: string | null;
};

type ProgramWorkoutRow = {
  client_id?: string | null;
  workout_date?: string | null;
};

function toTime(raw: string): number {
  if (!raw) return Number.NaN;
  const isoLike = raw.includes("T") ? raw : `${raw}T00:00:00`;
  const time = new Date(isoLike).getTime();
  return Number.isFinite(time) ? time : Number.NaN;
}

function findNextWorkoutByClient(rows: ProgramWorkoutRow[]): Map<string, string> {
  const todayKey = new Date().toISOString().slice(0, 10);
  const byClient = new Map<string, { raw: string; time: number }>();

  for (const row of rows) {
    const clientId = String(row.client_id || "").trim();
    const rawDate = String(row.workout_date || "").trim();
    const time = toTime(rawDate);
    if (!clientId || !rawDate || rawDate < todayKey || !Number.isFinite(time)) continue;

    const existing = byClient.get(clientId);
    if (!existing || time < existing.time) {
      byClient.set(clientId, { raw: rawDate, time });
    }
  }

  return new Map(Array.from(byClient.entries()).map(([clientId, item]) => [clientId, item.raw]));
}

async function getNextWorkoutsByClientIds(clientIds: string[]): Promise<Map<string, string>> {
  if (clientIds.length === 0) return new Map();
  const sb = getSupabaseAdmin();
  if (!sb) return new Map();

  try {
    const { data, error } = await sb
      .from("client_program_workouts")
      .select("client_id, workout_date")
      .in("client_id", clientIds)
      .gte("workout_date", new Date().toISOString().slice(0, 10));

    if (error) {
      console.warn("[supabase/coachStudents] client_program_workouts query failed", error.message);
      return new Map();
    }

    return findNextWorkoutByClient((Array.isArray(data) ? data : []) as ProgramWorkoutRow[]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[supabase/coachStudents] client_program_workouts query crashed", msg);
    return new Map();
  }
}

function mapClientToCoachStudent(row: ClientRow, nextWorkoutAt?: string): CoachStudent {
  const name =
    String(row.fio || "").trim() ||
    String(row.email || "").trim() ||
    "—";
  let finalDay = "—";
  if (row.final_day != null && String(row.final_day).trim()) {
    finalDay = String(row.final_day).trim();
  }
  let balance = "—";
  if (row.balance != null && String(row.balance).trim()) {
    balance = String(row.balance).trim();
  }
  return {
    id: row.id,
    name,
    email: row.email?.trim() || undefined,
    finalDay,
    balance,
    nextWorkoutAt,
  };
}

function currencySymbolFromCode(raw: string) {
  const code = raw.trim().toUpperCase();
  if (code === "RUB") return "₽";
  if (code === "USD") return "$";
  if (code === "EUR") return "€";
  return "";
}

function formatBalanceWithCurrency(balanceRaw: string | number | null | undefined, currencyRaw: string | null | undefined) {
  const balance = String(balanceRaw ?? "").trim();
  if (!balance) return "—";
  if (/[₽$€]/.test(balance)) return balance;
  const symbol = currencySymbolFromCode(String(currencyRaw || ""));
  return symbol ? `${balance} ${symbol}` : balance;
}

function displayValue(value: unknown) {
  const raw = String(value ?? "").trim();
  return raw || "—";
}

function mapClientToAdminStudent(row: ClientRow): CoachStudent {
  const name =
    String(row.fio || "").trim() ||
    String(row.email || "").trim() ||
    "—";

  return {
    id: row.id,
    name,
    email: row.email?.trim() || undefined,
    finalDay: displayValue(row.final_day),
    balance: formatBalanceWithCurrency(row.balance, row.currency),
    grPrice: displayValue(row.gr_price),
    dsPrice: displayValue(row.ds_price),
    prPrice: displayValue(row.pr_price),
    spPrice: displayValue(row.sp_price),
    futurePlan: displayValue(row.future_plan),
    tag: displayValue(row.tag),
  };
}

function isAdminActiveClient(row: ClientRow) {
  return row.is_active === true && !String(row.coach || "").includes("wr_off");
}

async function loadAllAdminClientRows(sb: NonNullable<ReturnType<typeof getSupabaseAdmin>>): Promise<ClientRow[]> {
  const pageSize = 1000;
  const rows: ClientRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await sb
      .from("clients")
      .select("id, email, fio, is_active, final_day, balance, currency, gr_price, ds_price, pr_price, sp_price, future_plan, tag, coach")
      .order("fio", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(error.message);
    }

    const page = (Array.isArray(data) ? data : []) as ClientRow[];
    rows.push(...page);

    if (page.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

/**
 * Active students for coach linked to session email.
 */
export async function getCoachStudentsByEmail(email: string): Promise<CoachStudent[]> {
  if (!isSupabaseEnabled("read_coach_lk")) return [];
  const sb = getSupabaseAdmin();
  if (!sb) return [];

  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return [];

  try {
    const coach = await getCoachByEmail(normalized);
    if (!coach) return [];

    const { data: links, error: linkErr } = await sb
      .from("coach_clients")
      .select("client_id")
      .eq("coach_id", coach.id)
      .eq("is_active", true);

    if (linkErr) {
      console.warn("[supabase/coachStudents] coach_clients query failed", linkErr.message);
      return [];
    }

    const clientIds = (Array.isArray(links) ? links : [])
      .map((l) => (l as { client_id?: string }).client_id)
      .filter((id): id is string => Boolean(id));

    if (clientIds.length === 0) return [];

    const { data: clients, error: clientsErr } = await sb
      .from("clients")
      .select("id, email, fio, is_active, final_day, balance")
      .in("id", clientIds)
      .eq("is_active", true);

    if (clientsErr) {
      console.warn("[supabase/coachStudents] clients query failed", clientsErr.message);
      return [];
    }

    const list = (Array.isArray(clients) ? clients : []) as ClientRow[];
    const nextWorkouts = await getNextWorkoutsByClientIds(clientIds);
    return list
      .map((client) => mapClientToCoachStudent(client, nextWorkouts.get(client.id)))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[supabase/coachStudents] getCoachStudentsByEmail crashed", msg);
    return [];
  }
}

export async function getCoachStudentByIdForCoach(
  email: string,
  studentId: string
): Promise<CoachStudent | null> {
  if (!isSupabaseEnabled("read_coach_lk")) return null;
  const sb = getSupabaseAdmin();
  if (!sb) return null;

  const normalized = String(email || "").trim().toLowerCase();
  const id = String(studentId || "").trim();
  if (!normalized || !id) return null;

  try {
    const coach = await getCoachByEmail(normalized);
    if (!coach) return null;

    const { data: link, error: linkErr } = await sb
      .from("coach_clients")
      .select("client_id")
      .eq("coach_id", coach.id)
      .eq("client_id", id)
      .eq("is_active", true)
      .maybeSingle();

    if (linkErr || !link) return null;

    const { data: client, error: clientErr } = await sb
      .from("clients")
      .select("id, email, fio, is_active, final_day, balance")
      .eq("id", id)
      .eq("is_active", true)
      .maybeSingle();

    if (clientErr || !client) return null;

    const nextWorkouts = await getNextWorkoutsByClientIds([id]);
    return mapClientToCoachStudent(client as ClientRow, nextWorkouts.get(id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[supabase/coachStudents] getCoachStudentByIdForCoach crashed", msg);
    return null;
  }
}

export async function getCoachStudentsForCoachLkByEmail(
  email: string
): Promise<{ ok: true; students: CoachStudent[] } | { ok: false }> {
  try {
    const students = await getCoachStudentsByEmail(email);
    return { ok: true, students };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[supabase/coachStudents] getCoachStudentsForCoachLkByEmail failed", msg);
    return { ok: false };
  }
}

export async function getAdminStudentsForAdminLk(): Promise<
  { ok: true; activeStudents: CoachStudent[]; allStudents: CoachStudent[] } | { ok: false }
> {
  if (!isSupabaseEnabled("read_coach_lk")) return { ok: false };
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false };

  try {
    const rows = await loadAllAdminClientRows(sb);
    const allStudents = rows
      .map(mapClientToAdminStudent)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
    const activeStudents = rows
      .filter(isAdminActiveClient)
      .map(mapClientToAdminStudent)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));

    return { ok: true, activeStudents, allStudents };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[supabase/coachStudents] getAdminStudentsForAdminLk crashed", msg);
    return { ok: false };
  }
}
