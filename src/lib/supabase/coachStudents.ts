import "server-only";

import type { CoachStudent } from "@/lib/airtable/coachStudents";
import { getSupabaseAdmin, isSupabaseEnabled } from "@/lib/supabase/server";

export type CoachProfileRow = {
  id: string;
  email: string;
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
      .select("id, email, is_active")
      .eq("email", normalized)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      console.warn("[supabase/coachStudents] getCoachByEmail failed", error.message);
      return null;
    }
    if (!data || typeof data !== "object") return null;
    const row = data as { id: string; email: string; is_active?: boolean | null };
    return { id: row.id, email: row.email, is_active: row.is_active };
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
