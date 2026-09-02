"use client";

import { useEffect, useRef } from "react";
import type {
  CoachWorkout,
  CoachWorkoutExercise,
  CoachWorkoutExerciseGroup,
} from "@/lib/supabase/coachWorkouts";

type Props = {
  workout: CoachWorkout;
  onClose: () => void;
};

type ReviewBlock =
  | { type: "exercise"; exercise: CoachWorkoutExercise }
  | { type: "group"; group: CoachWorkoutExerciseGroup };

export function isWorkoutReadOnly(status: unknown) {
  return status === "submitted" || status === "reviewed";
}

function isSafeCloudflareEmbedUrl(raw: unknown, videoAssetId: string): raw is string {
  if (typeof raw !== "string" || !raw.trim()) return false;
  if (!/^[a-zA-Z0-9_-]{20,64}$/.test(videoAssetId)) return false;

  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const isCloudflareStreamHost =
      hostname === "videodelivery.net" ||
      hostname === "iframe.videodelivery.net" ||
      (hostname.startsWith("customer-") && hostname.endsWith(".cloudflarestream.com"));

    return (
      url.protocol === "https:" &&
      isCloudflareStreamHost &&
      url.pathname === `/${encodeURIComponent(videoAssetId)}/iframe`
    );
  } catch {
    return false;
  }
}

function formatWorkoutDate(raw: string) {
  const date = new Date(raw.includes("T") ? raw : `${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function buildReviewBlocks(workout: CoachWorkout): ReviewBlock[] {
  const groupsById = new Map((workout.groups || []).map((group) => [group.id, group]));
  const renderedGroupIds = new Set<string>();
  const blocks: ReviewBlock[] = [];

  for (const exercise of workout.exercises) {
    const groupId = String(exercise.groupId || "").trim();
    const group = groupId ? groupsById.get(groupId) : undefined;

    if (!group) {
      blocks.push({ type: "exercise", exercise });
      continue;
    }

    if (!renderedGroupIds.has(groupId)) {
      renderedGroupIds.add(groupId);
      blocks.push({ type: "group", group });
    }
  }

  for (const group of (workout.groups || []).slice().sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (!renderedGroupIds.has(group.id)) {
      blocks.push({ type: "group", group });
    }
  }

  return blocks;
}

function PrescriptionMetrics({
  exercise,
}: {
  exercise: CoachWorkoutExercise;
}) {
  const metrics = [
    exercise.sets ? `Подходы: ${exercise.sets}` : "",
    exercise.reps ? `Повторения: ${exercise.reps}` : "",
    exercise.rest ? `Отдых: ${exercise.rest}` : "",
    exercise.tempo ? `Темп: ${exercise.tempo}` : "",
  ].filter(Boolean);

  if (metrics.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {metrics.map((metric) => (
        <span
          key={metric}
          className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
        >
          {metric}
        </span>
      ))}
    </div>
  );
}

function StudentResult({ exercise }: { exercise: CoachWorkoutExercise }) {
  const result = exercise.result;
  if (!result) return null;

  const comment = String(result.comment || "").trim();
  const videos = result.videos
    .flatMap((video) =>
      isSafeCloudflareEmbedUrl(video.videoUrl, video.videoAssetId)
        ? [{ ...video, videoUrl: video.videoUrl }]
        : []
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (!comment && videos.length === 0) return null;

  return (
    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800">
        Результат ученика
      </p>

      {comment ? (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{comment}</p>
      ) : null}

      {videos.length > 0 ? (
        <div className={`mt-3 grid gap-3 ${videos.length > 1 ? "md:grid-cols-2" : ""}`}>
          {videos.map((video, index) => {
            const title =
              videos.length > 1
                ? `Результат ученика — ${exercise.title} — видео ${index + 1}`
                : `Результат ученика — ${exercise.title}`;

            return (
              <div
                key={`${video.videoAssetId}-${video.sortOrder}`}
                className="overflow-hidden rounded-2xl border border-amber-200 bg-slate-950"
              >
                <div className="aspect-video">
                  <iframe
                    src={video.videoUrl}
                    title={title}
                    loading="lazy"
                    allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                    allowFullScreen
                    className="h-full w-full"
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ExerciseReview({
  exercise,
  indexLabel,
}: {
  exercise: CoachWorkoutExercise;
  indexLabel?: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        {indexLabel ? (
          <span className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 px-2 text-xs font-semibold text-slate-500">
            {indexLabel}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h5 className="text-base font-semibold text-slate-950">{exercise.title}</h5>
          <PrescriptionMetrics exercise={exercise} />
          {exercise.notes ? (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">
              {exercise.notes}
            </p>
          ) : null}
          <StudentResult exercise={exercise} />
        </div>
      </div>
    </article>
  );
}

function GroupReview({ group }: { group: CoachWorkoutExerciseGroup }) {
  const metrics = [
    group.sets ? `Подходы: ${group.sets}` : "",
    group.rest ? `Отдых: ${group.rest}` : "",
  ].filter(Boolean);
  const exercises = group.exercises
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return (
    <section className="rounded-3xl border border-emerald-200 bg-emerald-50/45 p-3 sm:p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Комбо</p>
        <h4 className="mt-1 text-lg font-semibold text-slate-950">{group.title}</h4>
        {metrics.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {metrics.map((metric) => (
              <span
                key={metric}
                className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600"
              >
                {metric}
              </span>
            ))}
          </div>
        ) : null}
        {group.notes ? (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{group.notes}</p>
        ) : null}
      </div>

      <div className="mt-3 space-y-2 border-l-2 border-emerald-300/60 pl-3">
        {exercises.map((exercise, index) => (
          <ExerciseReview
            key={exercise.id || `${group.id}-${index}`}
            exercise={exercise}
            indexLabel={String.fromCharCode(65 + index)}
          />
        ))}
      </div>
    </section>
  );
}

export function LkStudentWorkoutReview({ workout, onClose }: Props) {
  const isReviewed = workout.status === "reviewed";
  const blocks = buildReviewBlocks(workout);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([data-focus-sentinel]), a[href], iframe, [tabindex]:not([tabindex="-1"]):not([data-focus-sentinel])'
        ) || []
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-slate-950/40 px-3 py-4 sm:items-center sm:justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="student-workout-review-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white p-4 text-slate-950 shadow-2xl sm:p-5"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  isReviewed
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                {isReviewed ? "Проверено" : "Ждёт обратной связи"}
              </span>
              <span className="text-sm text-slate-500">{formatWorkoutDate(workout.date)}</span>
            </div>
            <h3 id="student-workout-review-title" className="mt-2 text-2xl font-semibold">
              {workout.title}
            </h3>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100"
          >
            Закрыть
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
          {isReviewed
            ? "Тренировка завершена и доступна только для просмотра."
            : "Тренировка пройдена учеником. Редактирование недоступно."}
        </div>

        {workout.coachComment ? (
          <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Комментарий тренера
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {workout.coachComment}
            </p>
          </section>
        ) : null}

        <div className="mt-4 space-y-3">
          {blocks.length > 0 ? (
            blocks.map((block, index) =>
              block.type === "group" ? (
                <GroupReview key={`group-${block.group.id}`} group={block.group} />
              ) : (
                <ExerciseReview
                  key={block.exercise.id || `exercise-${index}`}
                  exercise={block.exercise}
                  indexLabel={String(index + 1)}
                />
              )
            )
          ) : (
            <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
              Упражнения не указаны.
            </p>
          )}
        </div>
        <button
          type="button"
          data-focus-sentinel
          className="sr-only"
          onFocus={() => closeButtonRef.current?.focus()}
        >
          Вернуться к началу окна
        </button>
      </div>
    </div>
  );
}
