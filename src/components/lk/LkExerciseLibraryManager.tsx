"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ExerciseLibraryItem } from "@/lib/supabase/exerciseLibrary";
import { ExerciseTagPills, LkExerciseEditorModal } from "@/components/lk/LkExerciseEditorModal";

type Props = {
  exercises: ExerciseLibraryItem[];
};

function descriptionPreview(description: string | undefined) {
  const text = String(description || "").trim();
  if (!text) return "—";
  return text.length > 90 ? `${text.slice(0, 90).trim()}...` : text;
}

export function LkExerciseLibraryManager({ exercises }: Props) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [query, setQuery] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredExercises = useMemo(() => {
    if (!normalizedQuery) return exercises;
    return exercises.filter((exercise) => exercise.title.toLowerCase().includes(normalizedQuery));
  }, [exercises, normalizedQuery]);

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Библиотека</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">Активные упражнения</h2>
            <p className="mt-1 text-sm text-slate-500">
              {normalizedQuery ? `${filteredExercises.length} из ${exercises.length}` : `${exercises.length} всего`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setError("");
              setSuccess("");
              setIsAddOpen(true);
            }}
            className="inline-flex items-center justify-center rounded-full bg-brand-primary px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-primary/90"
          >
            Добавить упражнение
          </button>
        </div>

        <label className="mb-4 block space-y-1 text-sm">
          <span className="text-slate-600">Поиск по названию</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 outline-none focus:border-brand-primary"
            placeholder="Например: pull up"
          />
        </label>

        {error ? (
          <p className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {success}
          </p>
        ) : null}

        {exercises.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
            Пока нет активных упражнений. Нажми “Добавить упражнение”, чтобы загрузить первое видео.
          </p>
        ) : filteredExercises.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
            По запросу “{query.trim()}” ничего не найдено.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase tracking-[0.08em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Название</th>
                    <th className="px-4 py-3 font-semibold">Теги</th>
                    <th className="px-4 py-3 font-semibold">Описание</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredExercises.map((exercise) => (
                    <tr
                      key={exercise.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => router.push(exercise.watchUrl)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.push(exercise.watchUrl);
                        }
                      }}
                      className="cursor-pointer transition-colors hover:bg-slate-50"
                      aria-label={`Открыть упражнение ${exercise.title}`}
                    >
                      <td className="px-4 py-4">
                        <p className="font-semibold text-slate-950">{exercise.title}</p>
                      </td>
                      <td className="px-4 py-4 text-slate-600">
                        <ExerciseTagPills tags={exercise.tags} />
                      </td>
                      <td className="max-w-md px-4 py-4 text-slate-500">{descriptionPreview(exercise.description)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 lg:hidden">
              {filteredExercises.map((exercise) => (
                <div key={exercise.id} className="p-4">
                  <button
                    type="button"
                    onClick={() => router.push(exercise.watchUrl)}
                    className="block w-full text-left"
                  >
                    <p className="font-semibold text-slate-950">{exercise.title}</p>
                    <div className="mt-2">
                      <ExerciseTagPills tags={exercise.tags} />
                    </div>
                    <p className="mt-2 text-sm text-slate-500">{descriptionPreview(exercise.description)}</p>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <LkExerciseEditorModal
        open={isAddOpen}
        mode="create"
        onClose={() => setIsAddOpen(false)}
        onSaved={() => {
          setSuccess("Упражнение добавлено в библиотеку.");
          router.refresh();
        }}
      />
    </div>
  );
}
