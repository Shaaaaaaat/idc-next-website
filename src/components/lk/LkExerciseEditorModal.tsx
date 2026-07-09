"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import * as tus from "tus-js-client";
import type { ExerciseLibraryItem } from "@/lib/supabase/exerciseLibrary";

type UploadState = "idle" | "initializing" | "uploading" | "saving" | "deleting";

type InitUploadResponse = {
  ok: true;
  provider: "cloudflare";
  endpoint: string;
  videoId: string;
  videoUrl: string;
  thumbnailUrl: string;
};

type Props = {
  open: boolean;
  mode: "create" | "edit";
  exercise?: ExerciseLibraryItem;
  initialTitle?: string;
  onClose: () => void;
  onSaved: (exercise?: ExerciseLibraryItem) => void;
  onDeleted?: (result: { warning?: string }) => void;
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

export function LkExerciseEditorModal({ open, mode, exercise, initialTitle, onClose, onSaved, onDeleted }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [selectedVideoName, setSelectedVideoName] = useState("");
  const [uploadedVideoId, setUploadedVideoId] = useState("");

  const isUploading = uploadState !== "idle";
  const isEdit = mode === "edit";
  const hasExistingVideo = Boolean(exercise?.videoAssetId || exercise?.videoUrl);
  const hasSelectedVideo = Boolean(selectedVideoName);
  const hasUploadedVideo = Boolean(uploadedVideoId);
  const videoButtonText = hasExistingVideo || hasSelectedVideo || hasUploadedVideo ? "Заменить видео" : "Загрузить видео";
  const titleText = isEdit ? "Редактировать упражнение" : "Добавить упражнение";
  const submitText = useMemo(() => {
    if (uploadState === "initializing") return "Готовим загрузку...";
    if (uploadState === "uploading") return `Загружаем ${uploadProgress}%`;
    if (uploadState === "saving") return "Сохраняем...";
    if (uploadState === "deleting") return "Архивируем...";
    return isEdit ? "Сохранить изменения" : "Добавить упражнение";
  }, [isEdit, uploadProgress, uploadState]);

  useEffect(() => {
    if (!open) return;
    setTitle(exercise?.title || initialTitle || "");
    setDescription(exercise?.description || "");
    setTags(exercise?.tags || []);
    setTagInput("");
    setError("");
    setUploadProgress(0);
    setUploadState("idle");
    setSelectedVideoName("");
    setUploadedVideoId("");
    if (fileRef.current) fileRef.current.value = "";
  }, [exercise, initialTitle, open]);

  if (!open || typeof document === "undefined") return null;

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
    await new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(params.file, {
        uploadUrl: params.init.endpoint,
        uploadSize: params.file.size,
        chunkSize: 50 * 1024 * 1024,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        metadata: {
          name: params.file.name || params.title,
          filetype: params.file.type || "application/octet-stream",
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

      upload.start();
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
    setUploadedVideoId(initJson.videoId);
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

      const json = (await res.json().catch(() => null)) as
        | { exercise?: ExerciseLibraryItem; message?: string; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(json?.message || json?.error || "Не удалось сохранить упражнение.");
      }

      onSaved(json?.exercise);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Не удалось сохранить упражнение.");
    } finally {
      setUploadState("idle");
    }
  }

  async function handleDelete() {
    if (!isEdit || !exercise?.id || !exercise.canArchive) return;
    const confirmed = window.confirm(`Скрыть упражнение "${exercise.title}" из библиотеки? Видео в Cloudflare останется сохранено.`);
    if (!confirmed) return;

    setError("");
    setUploadState("deleting");

    try {
      const res = await fetch(`/api/lk/coach/exercises/${exercise.id}`, {
        method: "DELETE",
      });
      const json = (await res.json().catch(() => null)) as { message?: string; error?: string; warning?: string } | null;
      if (!res.ok) {
        throw new Error(json?.message || json?.error || "Не удалось скрыть упражнение.");
      }

      onDeleted?.({ warning: json?.warning });
      onClose();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Не удалось скрыть упражнение.");
    } finally {
      setUploadState("idle");
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-sm sm:py-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div
        className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              {isEdit ? "Упражнение" : "Новое упражнение"}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">{titleText}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {isEdit
                ? "Измени данные упражнения или загрузи новый файл, чтобы заменить видео."
                : "Файл загружается напрямую в Cloudflare Stream, а сервер выдает только одноразовый upload URL."}
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
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-primary"
                placeholder="Например: Pull Up"
              />
            </label>

            <div className="space-y-1 text-sm">
              <span className="text-slate-600">Видео{!isEdit ? " *" : ""}</span>
              <input
                ref={fileRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  setSelectedVideoName(file?.name || "");
                  setUploadedVideoId("");
                }}
              />
              <div className="rounded-2xl border border-slate-200 bg-white p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    {hasSelectedVideo ? (
                      <>
                        <p className="text-sm font-semibold text-slate-700">Файл выбран</p>
                        <p className="truncate text-xs text-slate-500">{selectedVideoName}</p>
                      </>
                    ) : hasUploadedVideo || hasExistingVideo ? (
                      <>
                        <p className="text-sm font-semibold text-emerald-700">Видео добавлено</p>
                        <p className="text-xs text-slate-500">
                          {hasUploadedVideo ? "Загрузка завершена, сохраняем упражнение." : "Текущее видео сохранено в упражнении."}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-slate-700">Видео не выбрано</p>
                        <p className="text-xs text-slate-500">MP4, MOV или WebM.</p>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={isUploading}
                    className="shrink-0 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {videoButtonText}
                  </button>
                </div>
                {isEdit ? (
                  <span className="mt-2 block text-xs text-slate-400">Оставь пустым, если видео менять не нужно.</span>
                ) : null}
              </div>
            </div>

            <label className="space-y-1 text-sm lg:col-span-2">
              <span className="text-slate-600">Описание</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-24 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-700 outline-none placeholder:text-slate-400 focus:border-brand-primary"
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
                    className="min-w-36 flex-1 border-0 bg-transparent px-1 py-1 text-slate-700 outline-none placeholder:text-slate-400"
                    placeholder={tags.length === 0 ? "Например: Gymnastic" : "Добавить тег"}
                  />
                </div>
              </div>
              <p className="text-xs text-slate-400">Нажми Enter или запятую, чтобы создать тег.</p>
            </div>
          </div>

          <div
            className={`flex flex-col gap-3 sm:flex-row sm:items-center ${
              isEdit ? "sm:justify-between" : "sm:justify-end"
            }`}
          >
            {isEdit && exercise?.canArchive ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isUploading}
                className="rounded-full border border-red-200 px-5 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploadState === "deleting" ? "Архивируем..." : "Скрыть упражнение"}
              </button>
            ) : null}
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
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
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
