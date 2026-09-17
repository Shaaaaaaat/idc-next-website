"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const NOTE_BODY_MAX_LENGTH = 4000;

type CoachStudentNote = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
};

type NotesListResponse = {
  ok?: boolean;
  notes?: unknown;
};

type NoteMutationResponse = {
  ok?: boolean;
  note?: unknown;
};

type Props = {
  studentId: string;
};

function isNote(value: unknown): value is CoachStudentNote {
  if (!value || typeof value !== "object") return false;

  const note = value as Partial<CoachStudentNote>;
  return (
    typeof note.id === "string" &&
    typeof note.body === "string" &&
    typeof note.authorName === "string" &&
    typeof note.createdAt === "string" &&
    typeof note.updatedAt === "string"
  );
}

function normalizeNotes(value: unknown): CoachStudentNote[] | null {
  if (!Array.isArray(value)) return null;

  const notes: CoachStudentNote[] = [];
  for (const note of value) {
    if (!isNote(note)) return null;
    notes.push(note);
  }

  return notes;
}

function validateNoteBody(value: string) {
  const normalized = value.trim();
  if (!normalized) return { ok: false as const, message: "Добавьте текст заметки." };
  if (normalized.length > NOTE_BODY_MAX_LENGTH) {
    return { ok: false as const, message: "Заметка не должна быть длиннее 4000 символов." };
  }
  return { ok: true as const, body: normalized };
}

function formatDateTime(raw: string) {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function orderedNewestFirst(notes: CoachStudentNote[]) {
  return [...notes].sort((a, b) => {
    const byCreatedAt = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (Number.isFinite(byCreatedAt) && byCreatedAt !== 0) return byCreatedAt;
    return b.id.localeCompare(a.id);
  });
}

export function LkCoachStudentNotesPanel({ studentId }: Props) {
  const [notes, setNotes] = useState<CoachStudentNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [draft, setDraft] = useState("");
  const [createError, setCreateError] = useState("");
  const [editId, setEditId] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editError, setEditError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const requestRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    async function loadNotes() {
      setLoading(true);
      setLoadError("");

      try {
        const response = await fetch(`/api/lk/coach/students/${studentId}/notes`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = (await response.json().catch(() => null)) as NotesListResponse | null;
        const nextNotes = normalizeNotes(json?.notes);

        if (!response.ok || json?.ok !== true || !nextNotes) {
          throw new Error("notes_load_failed");
        }

        if (controller.signal.aborted || requestRef.current !== requestId) return;
        setNotes(orderedNewestFirst(nextNotes));
      } catch {
        if (controller.signal.aborted || requestRef.current !== requestId) return;
        setLoadError("Не удалось загрузить заметки.");
      } finally {
        if (!controller.signal.aborted && requestRef.current === requestId) {
          setLoading(false);
        }
      }
    }

    loadNotes();

    return () => {
      controller.abort();
    };
  }, [studentId, retryKey]);

  const orderedNotes = useMemo(() => orderedNewestFirst(notes), [notes]);
  const createLength = draft.length;
  const editLength = editBody.length;

  async function createNote() {
    if (busyKey) return;

    const validation = validateNoteBody(draft);
    if (!validation.ok) {
      setCreateError(validation.message);
      return;
    }

    setBusyKey("create");
    setCreateError("");
    setMutationError("");

    try {
      const response = await fetch(`/api/lk/coach/students/${studentId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: validation.body }),
      });
      const json = (await response.json().catch(() => null)) as NoteMutationResponse | null;

      if (!response.ok || json?.ok !== true || !isNote(json.note)) {
        throw new Error("note_create_failed");
      }

      if (!mountedRef.current) return;
      const createdNote = json.note;
      setNotes((current) => orderedNewestFirst([createdNote, ...current]));
      setDraft("");
    } catch {
      if (!mountedRef.current) return;
      setCreateError("Не удалось сохранить заметку. Попробуйте ещё раз.");
    } finally {
      if (mountedRef.current) setBusyKey("");
    }
  }

  async function updateNote(noteId: string) {
    if (busyKey) return;

    const validation = validateNoteBody(editBody);
    if (!validation.ok) {
      setEditError(validation.message);
      return;
    }

    setBusyKey(`update:${noteId}`);
    setEditError("");
    setMutationError("");

    try {
      const response = await fetch(`/api/lk/coach/students/${studentId}/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: validation.body }),
      });
      const json = (await response.json().catch(() => null)) as NoteMutationResponse | null;

      if (!response.ok || json?.ok !== true || !isNote(json.note)) {
        throw new Error("note_update_failed");
      }

      if (!mountedRef.current) return;
      const updatedNote = json.note;
      setNotes((current) =>
        orderedNewestFirst(current.map((note) => (note.id === noteId ? updatedNote : note)))
      );
      setEditId("");
      setEditBody("");
    } catch {
      if (!mountedRef.current) return;
      setEditError("Не удалось обновить заметку. Попробуйте ещё раз.");
    } finally {
      if (mountedRef.current) setBusyKey("");
    }
  }

  async function deleteNote(noteId: string) {
    if (busyKey) return;
    if (!window.confirm("Удалить заметку?")) return;

    setBusyKey(`delete:${noteId}`);
    setMutationError("");

    try {
      const response = await fetch(`/api/lk/coach/students/${studentId}/notes/${noteId}`, {
        method: "DELETE",
      });
      const json = (await response.json().catch(() => null)) as { ok?: boolean } | null;

      if (!response.ok || json?.ok !== true) {
        throw new Error("note_delete_failed");
      }

      if (!mountedRef.current) return;
      setNotes((current) => current.filter((note) => note.id !== noteId));
      if (editId === noteId) {
        setEditId("");
        setEditBody("");
        setEditError("");
      }
    } catch {
      if (!mountedRef.current) return;
      setMutationError("Не удалось удалить заметку. Попробуйте ещё раз.");
    } finally {
      if (mountedRef.current) setBusyKey("");
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-xl font-semibold text-slate-950">Заметки</h3>
            <p className="mt-1 text-sm text-slate-500">Видно только вам</p>
          </div>
          <button
            type="button"
            onClick={() => setRetryKey((value) => value + 1)}
            disabled={loading}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Обновляем..." : "Повторить"}
          </button>
        </div>

        <div className="mt-4 space-y-2">
          <label htmlFor="student-note-body" className="text-sm font-medium text-slate-700">
            Новая заметка
          </label>
          <textarea
            id="student-note-body"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setCreateError("");
            }}
            disabled={Boolean(busyKey)}
            maxLength={NOTE_BODY_MAX_LENGTH + 500}
            className="min-h-28 w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-primary disabled:cursor-not-allowed disabled:bg-slate-50"
            placeholder="Напишите личную заметку по ученику..."
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className={createLength > NOTE_BODY_MAX_LENGTH ? "text-sm text-red-600" : "text-sm text-slate-500"}>
              {createLength} / {NOTE_BODY_MAX_LENGTH}
            </span>
            <button
              type="button"
              onClick={createNote}
              disabled={Boolean(busyKey)}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand-primary px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busyKey === "create" ? "Сохраняем..." : "Добавить заметку"}
            </button>
          </div>
          {createError ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {createError}
            </p>
          ) : null}
        </div>
      </div>

      {loadError ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </p>
      ) : null}
      {mutationError ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {mutationError}
        </p>
      ) : null}

      {loading && orderedNotes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
          Загружаем заметки...
        </div>
      ) : orderedNotes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
          Пока нет заметок.
        </div>
      ) : (
        <div className="space-y-3">
          {orderedNotes.map((note) => {
            const isEditing = editId === note.id;
            const isBusy = busyKey === `update:${note.id}` || busyKey === `delete:${note.id}`;

            return (
              <article key={note.id} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-semibold text-slate-950">{note.authorName}</p>
                  <time className="text-xs text-slate-500" dateTime={note.createdAt}>
                    {formatDateTime(note.createdAt)}
                  </time>
                </div>

                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={editBody}
                      onChange={(event) => {
                        setEditBody(event.target.value);
                        setEditError("");
                      }}
                      disabled={Boolean(busyKey)}
                      maxLength={NOTE_BODY_MAX_LENGTH + 500}
                      className="min-h-28 w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition-colors focus:border-brand-primary disabled:cursor-not-allowed disabled:bg-slate-50"
                    />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <span className={editLength > NOTE_BODY_MAX_LENGTH ? "text-sm text-red-600" : "text-sm text-slate-500"}>
                        {editLength} / {NOTE_BODY_MAX_LENGTH}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => updateNote(note.id)}
                          disabled={Boolean(busyKey)}
                          className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isBusy ? "Сохраняем..." : "Сохранить"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditId("");
                            setEditBody("");
                            setEditError("");
                          }}
                          disabled={Boolean(busyKey)}
                          className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Отмена
                        </button>
                      </div>
                    </div>
                    {editError ? (
                      <p className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {editError}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{note.body}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditId(note.id);
                          setEditBody(note.body);
                          setEditError("");
                          setMutationError("");
                        }}
                        disabled={Boolean(busyKey)}
                        className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Редактировать
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteNote(note.id)}
                        disabled={Boolean(busyKey)}
                        className="inline-flex min-h-11 items-center justify-center rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isBusy ? "Удаляем..." : "Удалить"}
                      </button>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
