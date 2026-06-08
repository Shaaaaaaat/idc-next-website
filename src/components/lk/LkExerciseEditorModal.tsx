"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import * as tus from "tus-js-client";
import type { ExerciseLibraryItem } from "@/lib/supabase/exerciseLibrary";

type UploadState = "idle" | "initializing" | "uploading" | "saving";

type InitUploadResponse = {
  ok: true;
  endpoint: string;
  libraryId: string;
  videoId: string;
  authorizationExpire: number;
  authorizationSignature: string;
  videoUrl: string;
};

type Props = {
  open: boolean;
  mode: "create" | "edit";
  exercise?: ExerciseLibraryItem;
  onClose: () => void;
  onSaved: () => void;
};

function normalizeTag(raw: string) {
  return raw.trim().replace(/\s+/g, " ");
}

function splitTags(raw: string) {
  return raw
    .split(/[,\n]/)
    .map(normalizeTag)
    .filter(Boolean);
}

function mergeTags(current: string[], next: string[]) {
  const seen = new Set(current.map((tag) => tag.toLowerCase()));
  const merged = [...current];
  for (const tag of next) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(tag);
  }
  return merged;
}

export function ExerciseTagPills({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return <span className="text-slate-400">Без тегов</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center rounded-full bg-cyan-50 px-2.5 py-1 text-xs font-medium text-slate-600"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

export function LkExerciseEditorModal({ open, mode, exercise, onClose, onSaved }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");

  const isUploading = uploadState !== "idle";
  const isEdit = mode === "edit";
  const titleText = isEdit ? "Редактировать упражнение" : "Добавить упражнение";
  const submitText = useMemo(() => {
    if (uploadState === "initializing") return "Готовим загрузку...";
    if (uploadState === "uploading") return `Загружаем ${uploadProgress}%`;
    if (uploadState === "saving") return "Сохраняем...";
    return isEdit ? "Сохранить изменения" : "Добавить упражнение";
  }, [isEdit, uploadProgress, uploadState]);

  useEffect(() => {
    if (!open) return;
    setTitle(exercise?.title || "");
    setDescription(exercise?.description || "");
    setTags(exercise?.tags || []);
    setTagInput("");
    setError("");
    setUploadProgress(0);
    setUploadState("idle");
    if (fileRef.current) fileRef.current.value = "";
  }, [exercise, open]);

  if (!open) return null;

  function closeModal() {
    if (isUploading) return;
    onClose();
  }

  function addPendingTags(raw = tagInput) {
    const next = splitTags(raw);
    if (next.length === 0) return;
    setTags((current) => mergeTags(current, next));
    setTagInput("");
  }

  function removeTag(tagToRemove: string) {
    setTags((current) => current.filter((tag) => tag !== tagToRemove));
  }

  async function startTusUpload(params: {
    file: File;
    init: InitUploadResponse;
    title: string;
  }) {
    const authHeaders = {
      AuthorizationSignature: params.init.authorizationSignature,
      AuthorizationExpire: String(params.init.authorizationExpire),
      VideoId: params.init.videoId,
      LibraryId: params.init.libraryId,
    };

    await new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(params.file, {
        endpoint: params.init.endpoint,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: authHeaders,
        metadata: {
          filename: params.file.name || params.title,
          filetype: params.file.type || "application/octet-stream",
          title: params.title,
        },
        onProgress(bytesUploaded, bytesTotal) {
          if (!bytesTotal) return;
          setUploadProgress(Math.max(1, Math.min(99, Math.round((bytesUploaded / bytesTotal) * 100))));
        },
        onSuccess() {
          setUploadProgress(100);
          resolve();
        },
        onError(uploadError) {
          reject(uploadError);
        },
      });

      upload
        .findPreviousUploads()
        .then((previousUploads) => {
          if (previousUploads.length > 0) upload.resumeFromPreviousUpload(previousUploads[0]);
          upload.start();
        })
        .catch(() => {
          upload.start();
        });
    });
  }

  async function initAndUploadVideo(file: File, cleanTitle: string) {
    setUploadState("initializing");
    const initRes = await fetch("/api/lk/coach/exercises/init-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: cleanTitle,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      }),
    });
    const initJson = (await initRes.json().catch(() => null)) as
      | InitUploadResponse
      | { ok?: false; message?: string; error?: string }
      | null;

    if (!initRes.ok || !initJson || initJson.ok !== true) {
      const err = initJson && "message" in initJson ? initJson.message || initJson.error : "";
      throw new Error(err || "Не удалось подготовить загрузку.");
    }

    setUploadState("uploading");
    await startTusUpload({ file, init: initJson, title: cleanTitle });
    return initJson.videoId;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setUploadProgress(0);

    try {
      const cleanTitle = title.trim();
      const cleanDescription = description.trim();
      const video = fileRef.current?.files?.[0] || null;
      const finalTags = mergeTags(tags, splitTags(tagInput));

      if (!cleanTitle) throw new Error("Добавь название упражнения.");
      if (!isEdit && !video) throw new Error("Выбери видеофайл.");
      setTags(finalTags);
      setTagInput("");

      let videoId = "";
      if (video) {
        videoId = await initAndUploadVideo(video, cleanTitle);
      }

      setUploadState("saving");
      const res = isEdit
        ? await fetch(`/api/lk/coach/exercises/${exercise?.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: cleanTitle,
              description: cleanDescription,
              tags: finalTags,
              ...(videoId ? { videoId } : {}),
            }),
          })
        : await fetch("/api/lk/coach/exercises/complete-upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: cleanTitle,
              description: cleanDescription,
              tags: finalTags,
              videoId,
            }),
          });

      const json = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!res.ok) {
        throw new Error(json?.message || json?.error || "Не удалось сохранить упражнение.");
      }

      onSaved();
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Не удалось сохранить упражнение.");
    } finally {
      setUploadState("idle");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-sm sm:py-10">
      <div className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              {isEdit ? "Упражнение" : "Новое упражнение"}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">{titleText}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {isEdit
                ? "Измени данные упражнения или загрузи новый файл, чтобы заменить видео."
                : "Файл загружается напрямую в Bunny, а сервер выдает только временную подпись."}
            </p>
          </div>
          <button
            type="button"
            onClick={closeModal}
            disabled={isUploading}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Закрыть
          </button>
        </div>

        {error ? (
          <p className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-slate-600">Название *</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 outline-none focus:border-brand-primary"
                placeholder="Например: Pull Up"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-slate-600">{isEdit ? "Заменить видео" : "Видео *"}</span>
              <input
                ref={fileRef}
                type="file"
                required={!isEdit}
                accept="video/mp4,video/quicktime,video/webm"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none file:mr-3 file:rounded-full file:border-0 file:bg-brand-primary file:px-3 file:py-1 file:text-sm file:font-semibold file:text-white focus:border-brand-primary"
              />
              {isEdit ? (
                <span className="block text-xs text-slate-400">Оставь пустым, если видео менять не нужно.</span>
              ) : null}
            </label>

            <label className="space-y-1 text-sm lg:col-span-2">
              <span className="text-slate-600">Описание</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-24 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 outline-none focus:border-brand-primary"
                placeholder="Ключевые подсказки по технике"
              />
            </label>

            <div className="space-y-2 text-sm lg:col-span-2">
              <span className="text-slate-600">Теги</span>
              <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 focus-within:border-brand-primary">
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2.5 py-1 text-sm font-medium text-slate-600"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="text-slate-400 transition-colors hover:text-slate-700"
                        aria-label={`Удалить тег ${tag}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagInput}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value.includes(",") || value.includes("\n")) {
                        addPendingTags(value);
                        return;
                      }
                      setTagInput(value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addPendingTags();
                      }
                      if (e.key === "Backspace" && !tagInput) {
                        setTags((current) => current.slice(0, -1));
                      }
                    }}
                    onBlur={() => addPendingTags()}
                    className="min-w-36 flex-1 border-0 bg-transparent px-1 py-1 outline-none"
                    placeholder={tags.length === 0 ? "Например: Gymnastic" : "Добавить тег"}
                  />
                </div>
              </div>
              <p className="text-xs text-slate-400">Нажми Enter или запятую, чтобы создать тег.</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            {uploadState === "uploading" ? (
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-brand-primary transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            ) : null}
            <button
              type="submit"
              disabled={isUploading}
              className="rounded-full bg-brand-primary px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitText}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
