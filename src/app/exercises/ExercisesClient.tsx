"use client";

import { useMemo, useState } from "react";

import { Footer } from "@/components/Footer";
import { PageNavButton } from "@/components/PageNavButton";
import {
  directionLabels,
  equipmentLabels,
  exercises,
  levelLabels,
  type ExerciseDirection,
  type ExerciseEquipment,
  type ExerciseLevel,
} from "@/data/exercises";

function isDirectVideoUrl(url: string) {
  const normalized = String(url || "").toLowerCase().split("?")[0];
  return normalized.endsWith(".mp4") || normalized.endsWith(".mov") || normalized.endsWith(".webm");
}

function FilterPill({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs sm:text-sm transition-colors ${
        active
          ? "border-brand-primary/30 bg-brand-primary/10 text-brand-primary font-semibold"
          : "border-black/10 bg-white text-brand-muted hover:bg-black/[0.03]"
      }`}
    >
      {label}
    </button>
  );
}

export default function ExercisesClient() {
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<ExerciseDirection | "all">("all");
  const [equipment, setEquipment] = useState<ExerciseEquipment | "all">("all");
  const [level, setLevel] = useState<ExerciseLevel | "all">("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exercises.filter((item) => {
      if (!item.isActive) return false;
      if (direction !== "all" && item.direction !== direction) return false;
      if (equipment !== "all" && item.equipment !== equipment) return false;
      if (level !== "all" && item.level !== level) return false;
      if (!q) return true;
      return [item.title, ...item.tags].join(" ").toLowerCase().includes(q);
    });
  }, [direction, equipment, level, query]);

  const hasFilters =
    query.trim().length > 0 ||
    direction !== "all" ||
    equipment !== "all" ||
    level !== "all";

  function resetFilters() {
    setQuery("");
    setDirection("all");
    setEquipment("all");
    setLevel("all");
  }

  return (
    <main className="min-h-screen bg-[#F7F8FC] text-brand-dark">
      <section className="mx-auto max-w-container px-4 sm:px-6 lg:px-8 py-14 sm:py-16 lg:py-20">
        <div className="rounded-4xl border border-black/10 bg-white p-6 sm:p-8 lg:p-10 shadow-soft">
          <div className="mb-4">
            <PageNavButton href="/">На главную</PageNavButton>
          </div>
          <p className="inline-flex rounded-full border border-brand-primary/20 bg-brand-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-brand-primary mb-4">
            База упражнений
          </p>
          <h1 className="text-[30px] sm:text-4xl lg:text-5xl font-semibold tracking-tight leading-tight mb-4">
            Упражнения по калистенике
          </h1>
          <p className="text-[16px] sm:text-lg text-brand-muted leading-relaxed max-w-3xl">
            Каталог упражнений по калистенике: подтягивания, стойка на руках, выходы силой <br /> и другие направления.
          </p>
        </div>
      </section>

      <section className="border-t border-black/5">
        <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
          <div className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5">
            <div className="mb-4">
              <label htmlFor="exercise-search" className="mb-1 block text-sm font-medium text-brand-dark">
                Поиск по названию и тегам
              </label>
              <input
                id="exercise-search"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Например: выход силой, турник, баланс"
                className="w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-primary"
              />
            </div>

            <div className="space-y-3">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand-muted">Направление</p>
                <div className="flex flex-wrap gap-2">
                  <FilterPill active={direction === "all"} label="Все" onClick={() => setDirection("all")} />
                  {Object.entries(directionLabels).map(([value, label]) => (
                    <FilterPill
                      key={value}
                      active={direction === value}
                      label={label}
                      onClick={() => setDirection(value as ExerciseDirection)}
                    />
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand-muted">Оборудование</p>
                <div className="flex flex-wrap gap-2">
                  <FilterPill active={equipment === "all"} label="Все" onClick={() => setEquipment("all")} />
                  {Object.entries(equipmentLabels).map(([value, label]) => (
                    <FilterPill
                      key={value}
                      active={equipment === value}
                      label={label}
                      onClick={() => setEquipment(value as ExerciseEquipment)}
                    />
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand-muted">Уровень</p>
                <div className="flex flex-wrap gap-2">
                  <FilterPill active={level === "all"} label="Все" onClick={() => setLevel("all")} />
                  {Object.entries(levelLabels).map(([value, label]) => (
                    <FilterPill
                      key={value}
                      active={level === value}
                      label={label}
                      onClick={() => setLevel(value as ExerciseLevel)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-black/5">
        <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
          {filtered.length === 0 ? (
            <div className="rounded-3xl border border-black/10 bg-white p-6 sm:p-8 text-center">
              <p className="text-base sm:text-lg font-semibold mb-2">Ничего не найдено</p>
              <p className="text-sm text-brand-muted mb-5">Сбросьте фильтры или измените запрос.</p>
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center justify-center rounded-full bg-brand-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-primary/90 transition-colors"
              >
                Сбросить фильтры
              </button>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between gap-4">
                <p className="text-sm text-brand-muted">
                  Найдено упражнений: <span className="font-semibold text-brand-dark">{filtered.length}</span>
                </p>
                {hasFilters && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="text-sm font-medium text-brand-primary hover:underline"
                  >
                    Сбросить все
                  </button>
                )}
              </div>

              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((exercise) => (
                  <article key={exercise.id} className="rounded-3xl border border-black/10 bg-white p-4 sm:p-5 shadow-soft">
                    <h3 className="text-lg font-semibold mb-3">{exercise.title}</h3>

                    <div className="mb-3 aspect-[9/16] w-full overflow-hidden rounded-2xl border border-black/10 bg-[#F2F4FA]">
                      {isDirectVideoUrl(exercise.videoUrl) ? (
                        <video
                          className="h-full w-full object-cover"
                          src={`${exercise.videoUrl}#t=0.1`}
                          controls
                          muted
                          playsInline
                          preload="auto"
                        >
                          Ваш браузер не поддерживает видео.
                        </video>
                      ) : (
                        <div className="grid h-full place-items-center px-4 text-center text-sm text-brand-muted">
                          Видео по ссылке из Яндекса недоступно для встроенного просмотра.
                        </div>
                      )}
                    </div>

                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}
