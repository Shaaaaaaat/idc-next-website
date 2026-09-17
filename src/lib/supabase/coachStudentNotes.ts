import "server-only";

import { getCoachStudentAccess } from "@/lib/supabase/coachStudentAccess";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const NOTE_SELECT = "id, body, created_at, updated_at";
const NOTE_BODY_MAX_LENGTH = 4000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type NoteOperation =
  | "access"
  | "author"
  | "list"
  | "create"
  | "update"
  | "delete";

type CoachStudentNoteRow = {
  id?: string | null;
  body?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type CoachNameRow = {
  display_name?: string | null;
  coach_name?: string | null;
};

export type CoachStudentNote = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
};

export type CoachStudentNotesFailureReason =
  | "disabled"
  | "invalid"
  | "forbidden"
  | "not_found"
  | "db_error";

export type CoachStudentNotesResult<T> =
  | ({ ok: true } & T)
  | { ok: false; reason: CoachStudentNotesFailureReason };

function warnNotesFailure(operation: NoteOperation) {
  console.warn("[supabase/coachStudentNotes] operation failed", { operation });
}

function cleanOptional(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  return value || null;
}

function normalizeUuid(value: unknown): string | null {
  const normalized = String(value || "").trim().toLowerCase();
  return UUID_RE.test(normalized) ? normalized : null;
}

function normalizeNoteBody(body: unknown): string | null {
  if (typeof body !== "string") return null;

  const normalized = body.trim();
  if (!normalized || normalized.length > NOTE_BODY_MAX_LENGTH) return null;
  return normalized;
}

function mapNoteRow(row: CoachStudentNoteRow | null, authorName: string): CoachStudentNote | null {
  const id = cleanOptional(row?.id);
  const body = cleanOptional(row?.body);
  const createdAt = cleanOptional(row?.created_at);
  const updatedAt = cleanOptional(row?.updated_at);

  if (!id || !body || !createdAt || !updatedAt) return null;

  return {
    id,
    body,
    authorName,
    createdAt,
    updatedAt,
  };
}

async function getCoachAuthorName(
  coachId: string
): Promise<CoachStudentNotesResult<{ authorName: string }>> {
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  try {
    const { data, error } = await sb
      .from("coach_profiles")
      .select("display_name, coach_name")
      .eq("id", coachId)
      .maybeSingle();

    if (error) {
      warnNotesFailure("author");
      return { ok: false, reason: "db_error" };
    }

    const row = data as CoachNameRow | null;
    return {
      ok: true,
      authorName:
        cleanOptional(row?.display_name) ??
        cleanOptional(row?.coach_name) ??
        "Тренер",
    };
  } catch {
    warnNotesFailure("author");
    return { ok: false, reason: "db_error" };
  }
}

export async function listCoachStudentNotes(
  coachEmail: string,
  clientId: string
): Promise<CoachStudentNotesResult<{ notes: CoachStudentNote[] }>> {
  const access = await getCoachStudentAccess(coachEmail, clientId);
  if (!access.ok) return access;

  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  const author = await getCoachAuthorName(access.coachId);
  if (!author.ok) return author;

  try {
    const { data, error } = await sb
      .from("coach_student_notes")
      .select(NOTE_SELECT)
      .eq("client_id", access.clientId)
      .eq("author_coach_id", access.coachId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (error) {
      warnNotesFailure("list");
      return { ok: false, reason: "db_error" };
    }

    const notes = ((Array.isArray(data) ? data : []) as CoachStudentNoteRow[])
      .map((row) => mapNoteRow(row, author.authorName));

    if (notes.some((note) => note === null)) {
      warnNotesFailure("list");
      return { ok: false, reason: "db_error" };
    }

    return { ok: true, notes: notes as CoachStudentNote[] };
  } catch {
    warnNotesFailure("list");
    return { ok: false, reason: "db_error" };
  }
}

export async function createCoachStudentNote(
  coachEmail: string,
  clientId: string,
  body: unknown
): Promise<CoachStudentNotesResult<{ note: CoachStudentNote }>> {
  const normalizedBody = normalizeNoteBody(body);
  if (!normalizedBody) return { ok: false, reason: "invalid" };

  const access = await getCoachStudentAccess(coachEmail, clientId);
  if (!access.ok) return access;

  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  const author = await getCoachAuthorName(access.coachId);
  if (!author.ok) return author;

  try {
    const { data, error } = await sb
      .from("coach_student_notes")
      .insert({
        client_id: access.clientId,
        author_coach_id: access.coachId,
        body: normalizedBody,
      })
      .select(NOTE_SELECT)
      .maybeSingle();

    if (error) {
      warnNotesFailure("create");
      return { ok: false, reason: "db_error" };
    }

    const note = mapNoteRow(data as CoachStudentNoteRow | null, author.authorName);
    if (!note) {
      warnNotesFailure("create");
      return { ok: false, reason: "db_error" };
    }

    return { ok: true, note };
  } catch {
    warnNotesFailure("create");
    return { ok: false, reason: "db_error" };
  }
}

export async function updateCoachStudentNote(
  coachEmail: string,
  clientId: string,
  noteId: string,
  body: unknown
): Promise<CoachStudentNotesResult<{ note: CoachStudentNote }>> {
  const normalizedNoteId = normalizeUuid(noteId);
  const normalizedBody = normalizeNoteBody(body);
  if (!normalizedNoteId || !normalizedBody) return { ok: false, reason: "invalid" };

  const access = await getCoachStudentAccess(coachEmail, clientId);
  if (!access.ok) return access;

  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  const author = await getCoachAuthorName(access.coachId);
  if (!author.ok) return author;

  try {
    const { data, error } = await sb
      .from("coach_student_notes")
      .update({ body: normalizedBody })
      .eq("id", normalizedNoteId)
      .eq("client_id", access.clientId)
      .eq("author_coach_id", access.coachId)
      .select(NOTE_SELECT)
      .maybeSingle();

    if (error) {
      warnNotesFailure("update");
      return { ok: false, reason: "db_error" };
    }

    const note = mapNoteRow(data as CoachStudentNoteRow | null, author.authorName);
    if (!note) return { ok: false, reason: "not_found" };

    return { ok: true, note };
  } catch {
    warnNotesFailure("update");
    return { ok: false, reason: "db_error" };
  }
}

export async function deleteCoachStudentNote(
  coachEmail: string,
  clientId: string,
  noteId: string
): Promise<{ ok: true } | { ok: false; reason: CoachStudentNotesFailureReason }> {
  const normalizedNoteId = normalizeUuid(noteId);
  if (!normalizedNoteId) return { ok: false, reason: "invalid" };

  const access = await getCoachStudentAccess(coachEmail, clientId);
  if (!access.ok) return access;

  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, reason: "disabled" };

  try {
    const { data, error } = await sb
      .from("coach_student_notes")
      .delete()
      .eq("id", normalizedNoteId)
      .eq("client_id", access.clientId)
      .eq("author_coach_id", access.coachId)
      .select("id")
      .maybeSingle();

    if (error) {
      warnNotesFailure("delete");
      return { ok: false, reason: "db_error" };
    }

    if (!data) return { ok: false, reason: "not_found" };

    return { ok: true };
  } catch {
    warnNotesFailure("delete");
    return { ok: false, reason: "db_error" };
  }
}
