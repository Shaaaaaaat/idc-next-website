"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ExerciseLibraryItem } from "@/lib/supabase/exerciseLibrary";
import { ExerciseTagPills, LkExerciseEditorModal } from "@/components/lk/LkExerciseEditorModal";
import { LkShell } from "@/components/lk/LkShell";

type Props = {
  exercise: ExerciseLibraryItem;
  role: "admin" | "coach";
  backHref: string;
  canEdit: boolean;
};

export function LkExerciseVideoClient({ exercise, role, backHref, canEdit }: Props) {
  const router = useRouter();
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  return (
    <LkShell
      role={role}
      title={exercise.title}
      subtitle="Просмотр видео упражнения"
      activeHref={role === "coach" ? "/lk/coach/exercises" : undefined}
    >
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Упражнение</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">{exercise.title}</h2>
            <div className="mt-3">
              <ExerciseTagPills tags={exercise.tags} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit ? (
              <button
                type="button"
                onClick={() => setIsEditorOpen(true)}
                className="inline-flex items-center justify-center rounded-full bg-brand-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-primary/90"
              >
                Редактировать
              </button>
            ) : null}
            <Link
              href={backHref}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100"
            >
              Назад
            </Link>
          </div>
        </div>

        <div className="mx-auto max-w-3xl overflow-hidden rounded-3xl border border-slate-200 bg-slate-100 shadow-sm">
          <div className="aspect-video">
            <iframe
              src={exercise.videoUrl}
              title={exercise.title}
              loading="lazy"
              allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
              allowFullScreen
              className="h-full w-full"
            />
          </div>
        </div>

        {exercise.description ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Описание</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">{exercise.description}</p>
          </div>
        ) : null}
      </div>

      <LkExerciseEditorModal
        open={isEditorOpen}
        mode="edit"
        exercise={exercise}
        onClose={() => setIsEditorOpen(false)}
        onSaved={() => router.refresh()}
      />
    </LkShell>
  );
}
