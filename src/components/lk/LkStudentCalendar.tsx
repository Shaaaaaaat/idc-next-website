"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CoachWorkout } from "@/lib/supabase/coachWorkouts";
import type { ExerciseLibraryItem } from "@/lib/supabase/exerciseLibrary";

type Props = {
  studentId: string;
  workouts: CoachWorkout[];
  exerciseLibrary: ExerciseLibraryItem[];
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type DraftExercise = {
  id?: string;
  draftId: string;
  groupDraftId?: string;
  exerciseId: string;
  exerciseTitle: string;
  sets: string;
  reps: string;
  rest: string;
  tempo: string;
  notes: string;
};

type DraftExerciseGroup = {
  id?: string;
  draftId: string;
  title: string;
  sets: string;
  rest: string;
  notes: string;
  sortOrder: number;
};

type EditingState = {
  mode: "create" | "edit";
  workoutId?: string;
  expectedUpdatedAt?: string | null;
  workoutDate: string;
  title: string;
  coachComment: string;
  groups: DraftExerciseGroup[];
  exercises: DraftExercise[];
};

type PreviewExercise = {
  title: string;
  videoUrl: string;
};

type ProgramTemplateWorkoutPreview = {
  id: string;
  dayNumber: number;
  weekNumber: number;
  title: string;
  summary?: string;
  exercises: Array<{ id?: string; groupId?: string; title?: string; exerciseTitle?: string }>;
  groups: Array<{
    id: string;
    title: string;
    exercises?: Array<{ id?: string; title?: string; exerciseTitle?: string }>;
  }>;
};

type ProgramTemplatePreview = {
  id: string;
  title: string;
  description?: string;
  level?: string;
  goal?: string;
  tags: string[];
  workoutsCount: number;
  ownerType?: "own" | "global" | "other";
  workouts?: ProgramTemplateWorkoutPreview[];
};

type ImportWorkoutItem = {
  workoutDate: string;
  sourceTemplateWorkoutId: string;
  clientWorkoutId: string;
  status: "created" | "reused";
};

const PROGRAM_WORKOUT_PREVIEW_LIMIT = 5;

function createDraftId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const emptyExercise = (): DraftExercise => ({
  draftId: createDraftId(),
  groupDraftId: undefined,
  exerciseId: "",
  exerciseTitle: "",
  sets: "",
  reps: "",
  rest: "",
  tempo: "",
  notes: "",
});

function startOfWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function addWeeks(date: Date, weeks: number) {
  return addDays(date, weeks * 7);
}

function calendarRangeLabel(start: Date, daysCount: number) {
  const end = addDays(start, daysCount - 1);
  const startLabel = start.toLocaleDateString("ru-RU", { day: "2-digit", month: "long" });
  const endLabel = end.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
  return `${startLabel} — ${endLabel}`;
}

function dayLabel(date: Date) {
  return date.toLocaleDateString("ru-RU", { weekday: "short" });
}

function dateLabel(date: Date) {
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function formatDateHuman(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function workoutSummary(workout: CoachWorkout) {
  if (workout.exercises.length === 0) return "Без упражнений";
  const names = workout.exercises.slice(0, 3).map((exercise) => exercise.title);
  const suffix = workout.exercises.length > names.length ? ` +${workout.exercises.length - names.length}` : "";
  return `${names.join(" · ")}${suffix}`;
}

// Keep visual primitives reusable for future week/month/agenda views.
function workoutTone(workout: CoachWorkout) {
  const title = workout.title.toLowerCase();
  if (/skill|стойк|навык|техник/.test(title)) {
    return "border-violet-200/90 bg-violet-50/75 hover:border-violet-300 hover:bg-violet-50";
  }
  if (/mobility|мобил|растяж|stretch|гибк/.test(title)) {
    return "border-sky-200/90 bg-sky-50/75 hover:border-sky-300 hover:bg-sky-50";
  }
  if (/recovery|восстанов|легк|easy|rest/.test(title)) {
    return "border-emerald-200/90 bg-emerald-50/75 hover:border-emerald-300 hover:bg-emerald-50";
  }
  if (/strength|силов|сила/.test(title)) {
    return "border-slate-300/90 bg-slate-50/90 hover:border-slate-400 hover:bg-white";
  }
  return "border-slate-200/90 bg-white/95 hover:border-slate-300 hover:bg-white";
}

function workoutDensity(workout: CoachWorkout) {
  if (workout.exercises.length >= 4) {
    return {
      card: "p-4",
      summary: "line-clamp-2",
      meta: `${workout.exercises.length} упражнений · плотная тренировка`,
    };
  }
  if (workout.exercises.length === 1) {
    return {
      card: "p-2",
      summary: "line-clamp-1",
      meta: "1 упр.",
    };
  }
  if (workout.exercises.length === 0) {
    return {
      card: "p-2",
      summary: "line-clamp-1",
      meta: "без упражнений",
    };
  }
  return {
    card: "p-3",
    summary: "line-clamp-2",
    meta: `${workout.exercises.length} упр.`,
  };
}

function loadDots(count: number) {
  const dots = Math.min(count, 3);
  if (dots <= 0) return null;
  return (
    <span className="flex gap-0.5" aria-label={`${count} тренировок`}>
      {Array.from({ length: dots }).map((_, index) => (
        <span key={index} className="h-1.5 w-1.5 rounded-full bg-brand-primary/70" />
      ))}
    </span>
  );
}

function exerciseToDraft(exercise: CoachWorkout["exercises"][number]): DraftExercise {
  return {
    id: exercise.id,
    draftId: createDraftId(),
    groupDraftId: exercise.groupId || undefined,
    exerciseId: exercise.exerciseId || "",
    exerciseTitle: exercise.title,
    sets: exercise.sets || "",
    reps: exercise.reps || "",
    rest: exercise.rest || "",
    tempo: exercise.tempo || "",
    notes: exercise.notes || "",
  };
}

function workoutGroupsToDraft(workout: CoachWorkout): DraftExerciseGroup[] {
  return (workout.groups || []).map((group) => ({
    id: group.id,
    draftId: group.id,
    title: group.title || "Комбо",
    sets: group.sets || "",
    rest: group.rest || "",
    notes: group.notes || "",
    sortOrder: group.sortOrder,
  }));
}

function ExerciseSearchPicker({
  exercise,
  exerciseLibrary,
  autoFocus = false,
  onSearchChange,
  onSelect,
}: {
  exercise: DraftExercise;
  exerciseLibrary: ExerciseLibraryItem[];
  autoFocus?: boolean;
  onSearchChange: (query: string) => void;
  onSelect: (exerciseId: string) => void;
}) {
  const selectedTitle = exercise.exerciseTitle || "";
  const [query, setQuery] = useState(selectedTitle);
  const [isOpen, setIsOpen] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();

  useEffect(() => {
    setQuery(selectedTitle);
  }, [selectedTitle]);

  const matches = useMemo(() => {
    const list = normalizedQuery
      ? exerciseLibrary.filter((libraryExercise) =>
          libraryExercise.title.toLowerCase().includes(normalizedQuery)
        )
      : exerciseLibrary;
    return list.slice(0, 10);
  }, [exerciseLibrary, normalizedQuery]);

  return (
    <div className="relative sm:col-span-6">
      <input
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => {
          const value = e.target.value;
          setQuery(value);
          onSearchChange(value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-primary"
        placeholder="Найти упражнение в библиотеке"
      />
      {isOpen ? (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl">
          {matches.length > 0 ? (
            matches.map((libraryExercise) => (
              <button
                key={libraryExercise.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(libraryExercise.id);
                  setQuery(libraryExercise.title);
                  setIsOpen(false);
                }}
                className={`block w-full rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-slate-100 ${
                  exercise.exerciseId === libraryExercise.id ? "bg-brand-primary/10 text-brand-primary" : "text-slate-700"
                }`}
              >
                {libraryExercise.title}
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-sm text-slate-400">Ничего не найдено</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function pluralRu(value: string, one: string, few: string, many: string) {
  const matches = value.match(/\d+/g);
  const number = Number.parseInt(matches ? matches[matches.length - 1] : value, 10);
  if (!Number.isFinite(number)) return many;
  const mod10 = number % 10;
  const mod100 = number % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function hasTextUnit(value: string) {
  return /[a-zа-яё]/i.test(value);
}

function formatSetsLabel(value: string) {
  const clean = value.trim();
  if (!clean) return "+ подходы";
  if (hasTextUnit(clean)) return clean;
  if (/[–-]/.test(clean)) return `${clean} подхода`;
  return `${clean} ${pluralRu(clean, "подход", "подхода", "подходов")}`;
}

function formatRepsLabel(value: string) {
  const clean = value.trim();
  if (!clean) return "+ разы";
  if (hasTextUnit(clean)) return clean;
  if (/[–-]/.test(clean)) return `${clean} раза`;
  return `${clean} ${pluralRu(clean, "раз", "раза", "разов")}`;
}

function formatRestLabel(value: string) {
  const clean = value.trim();
  if (!clean) return "+ отдых";
  if (hasTextUnit(clean)) return clean;
  return `отдых ${clean}`;
}

function InlineMetric({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const hasValue = Boolean(value.trim());

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            e.currentTarget.blur();
          }
        }}
        className="w-24 rounded-xl border border-brand-primary/40 bg-white px-2 py-1 text-sm font-medium text-slate-900 outline-none"
        placeholder={placeholder}
      />
    );
  }

  if (!hasValue) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-full bg-slate-100 px-2.5 py-1 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
      >
        {label}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center overflow-hidden rounded-full bg-slate-100 text-sm font-medium text-slate-700">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="px-2.5 py-1 transition-colors hover:bg-slate-200"
      >
        {label}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onChange("");
        }}
        className="border-l border-slate-200 px-2 py-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
        aria-label={`Очистить ${label}`}
      >
        ×
      </button>
    </span>
  );
}

function WorkoutCard({
  workout,
  isMoving,
  onEdit,
  onCopy,
  onDelete,
}: {
  workout: CoachWorkout;
  isMoving: boolean;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, isDragging } = useDraggable({
    id: `workout:${workout.id}`,
    data: { type: "workout", workout },
  });
  const translate = CSS.Translate.toString(transform);
  const style = {
    transform: isDragging ? `${translate || ""} rotate(0.5deg) scale(1.02)` : translate,
  };
  const tone = workoutTone(workout);
  const density = workoutDensity(workout);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(e: PointerEvent) {
      const target = e.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setMenuOpen(false);
      setConfirmDelete(false);
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <div
      ref={setNodeRef}
      data-workout-card="true"
      style={style}
      className={`group cursor-grab rounded-2xl border shadow-[0_8px_22px_rgba(15,23,42,0.055)] transition-all duration-150 hover:-translate-y-px hover:shadow-[0_16px_34px_rgba(15,23,42,0.11)] active:scale-[0.985] active:cursor-grabbing ${density.card} ${tone} ${
        isDragging ? "relative z-30 opacity-95 shadow-[0_24px_52px_rgba(15,23,42,0.18)] ring-2 ring-brand-primary/20" : ""
      } ${isMoving ? "pointer-events-none opacity-60" : ""}`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-base font-semibold leading-snug text-slate-950">{workout.title}</p>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onCopy}
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 opacity-100 transition-all duration-150 hover:bg-slate-100 hover:text-brand-primary sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            title="Скопировать тренировку"
          >
            ⧉
          </button>
          <button
            type="button"
            ref={setActivatorNodeRef}
            className="flex h-7 w-7 cursor-grab items-center justify-center rounded-full text-slate-400 opacity-100 transition-all duration-150 hover:bg-slate-100 hover:text-brand-primary active:cursor-grabbing sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            title="Перенести тренировку"
            {...attributes}
            {...listeners}
          >
            ☰
          </button>
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setMenuOpen((current) => !current);
                setConfirmDelete(false);
              }}
              className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 opacity-100 transition-all duration-150 hover:bg-slate-100 hover:text-slate-700 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
              aria-label={`Действия для тренировки ${workout.title}`}
            >
              ⋯
            </button>
            {menuOpen ? (
              <div className="absolute right-0 z-20 mt-1 w-56 rounded-2xl border border-slate-200 bg-white p-1 text-sm shadow-xl">
                {confirmDelete ? (
                  <div className="space-y-2 p-2">
                    <p className="text-sm font-medium text-slate-900">Удалить тренировку?</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="flex-1 rounded-xl bg-slate-100 px-3 py-2 text-slate-600 transition-colors hover:bg-slate-200"
                      >
                        Отмена
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          setConfirmDelete(false);
                          onDelete();
                        }}
                        className="flex-1 rounded-xl bg-red-50 px-3 py-2 font-semibold text-red-600 transition-colors hover:bg-red-100"
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onEdit();
                      }}
                      className="block w-full rounded-xl px-3 py-2 text-left text-slate-700 hover:bg-slate-100"
                    >
                      Открыть
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onCopy();
                      }}
                      className="block w-full rounded-xl px-3 py-2 text-left text-slate-700 hover:bg-slate-100"
                    >
                      Дублировать
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="block w-full rounded-xl px-3 py-2 text-left text-red-600 hover:bg-red-50"
                    >
                      Удалить
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <button type="button" onClick={onEdit} className="block w-full text-left">
        <p className={`${density.summary} text-xs leading-5 text-slate-500/80`}>{workoutSummary(workout)}</p>
        <p className="mt-1.5 text-[11px] font-medium text-slate-400/80">{density.meta}</p>
        {workout.coachComment ? (
          <p className="mt-2 line-clamp-1 rounded-lg bg-white/55 px-2 py-1 text-xs text-slate-500/80">
            {workout.coachComment}
          </p>
        ) : null}
      </button>
    </div>
  );
}

function DayCell({
  day,
  dayKey,
  workouts,
  isPast,
  isToday,
  copiedWorkout,
  movingWorkoutId,
  pastingDate,
  hasWeekDivider,
  onCreate,
  onImportFromProgram,
  onPaste,
  onEditWorkout,
  onCopyWorkout,
  onDeleteWorkout,
}: {
  day: Date;
  dayKey: string;
  workouts: CoachWorkout[];
  isPast: boolean;
  isToday: boolean;
  copiedWorkout: CoachWorkout | null;
  movingWorkoutId: string;
  pastingDate: string;
  hasWeekDivider: boolean;
  onCreate: () => void;
  onImportFromProgram: () => void;
  onPaste: () => void;
  onEditWorkout: (workout: CoachWorkout) => void;
  onCopyWorkout: (workout: CoachWorkout) => void;
  onDeleteWorkout: (workout: CoachWorkout) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `day:${dayKey}`,
    data: { type: "day", date: dayKey },
  });

  return (
    <article
      ref={setNodeRef}
      onDoubleClick={(e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest("button,a,[data-workout-card]")) return;
        onCreate();
      }}
      className={`group/day min-h-28 rounded-2xl p-2 transition-all duration-200 ${
        isOver
          ? "bg-brand-primary/5 shadow-inner ring-2 ring-brand-primary/20"
          : isPast
          ? "bg-slate-50/40 text-slate-400 hover:bg-slate-50/80"
          : "bg-white/20 text-slate-950 hover:bg-white/70"
      } ${hasWeekDivider ? "lg:border-t lg:border-slate-200/70 lg:pt-3" : ""}`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div
          className={`rounded-xl transition-colors duration-150 ${
            isToday
              ? "bg-brand-primary/5 px-2 py-1 shadow-[inset_0_1px_0_rgba(198,40,152,0.22)]"
              : "px-0 py-1"
          }`}
        >
          <p className={`text-[11px] font-semibold uppercase tracking-[0.1em] ${isToday ? "text-brand-primary/80" : "text-slate-400"}`}>
            {dayLabel(day)} {dateLabel(day).slice(0, 2)}
          </p>
        </div>
        <div className="grid min-w-[8.75rem] grid-cols-1 gap-1 opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover/day:opacity-100 sm:group-focus-within/day:opacity-100">
          {copiedWorkout ? (
            <button
              type="button"
              onClick={onPaste}
              disabled={pastingDate === dayKey}
              title="Вставить копию тренировки"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/40 text-slate-400 transition-colors duration-150 hover:bg-brand-primary/10 hover:text-brand-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              ⧉
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCreate}
            className="min-h-7 w-full rounded-full bg-white/65 px-2.5 text-center text-[10px] font-semibold text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-primary/20"
          >
            + Пустая тренировка
          </button>
          <button
            type="button"
            onClick={onImportFromProgram}
            className="min-h-7 w-full rounded-full bg-emerald-50 px-2.5 text-center text-[10px] font-semibold text-emerald-700 transition-colors duration-150 hover:bg-emerald-100 hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-200"
          >
            + Из программы
          </button>
        </div>
      </div>

      {workouts.length > 0 ? (
        <div className="space-y-2">
          {workouts.map((workout) => (
            <WorkoutCard
              key={workout.id}
              workout={workout}
              isMoving={movingWorkoutId === workout.id}
              onEdit={() => onEditWorkout(workout)}
              onCopy={() => onCopyWorkout(workout)}
              onDelete={() => onDeleteWorkout(workout)}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function previewExerciseTitle(exercise: { title?: string; exerciseTitle?: string } | undefined) {
  return String(exercise?.title || exercise?.exerciseTitle || "").trim();
}

function buildWorkoutPreviewExercises(workout: ProgramTemplateWorkoutPreview) {
  const seen = new Set<string>();
  const items: string[] = [];
  const addExercise = (exercise: { id?: string; title?: string; exerciseTitle?: string } | undefined) => {
    const title = previewExerciseTitle(exercise);
    if (!title) return;
    const key = String(exercise?.id || title).trim().toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push(title);
  };

  (workout.exercises || []).forEach(addExercise);
  (workout.groups || []).forEach((group) => (group.exercises || []).forEach(addExercise));
  return items;
}

function ProgramWorkoutPreviewCard({
  workout,
  selected,
  disabled,
  onToggle,
}: {
  workout: ProgramTemplateWorkoutPreview;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const exerciseTitles = buildWorkoutPreviewExercises(workout);
  const visibleExercises = exerciseTitles.slice(0, PROGRAM_WORKOUT_PREVIEW_LIMIT);
  const hiddenCount = Math.max(0, exerciseTitles.length - visibleExercises.length);
  const exerciseCount = exerciseTitles.length;
  const groupCount = workout.groups?.length || 0;
  const checkboxId = `program-workout-${workout.id}`;

  function toggleIfAllowed() {
    if (!disabled) onToggle();
  }

  return (
    <div
      role="checkbox"
      aria-checked={selected}
      tabIndex={disabled ? -1 : 0}
      onClick={toggleIfAllowed}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        toggleIfAllowed();
      }}
      className={`group flex min-h-52 cursor-pointer flex-col rounded-3xl border p-4 text-left shadow-sm transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${
        selected
          ? "border-emerald-300 bg-emerald-50/80 shadow-emerald-100"
          : "border-slate-200 bg-white hover:-translate-y-px hover:border-slate-300 hover:shadow-md"
      } ${disabled ? "pointer-events-none cursor-not-allowed opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            День {workout.dayNumber || 1}
          </p>
          <h4 className="line-clamp-2 text-base font-semibold leading-snug text-slate-950">
            {workout.title || "Тренировка"}
          </h4>
        </div>
        <input
          id={checkboxId}
          type="checkbox"
          checked={selected}
          disabled={disabled}
          onClick={(e) => e.stopPropagation()}
          onChange={toggleIfAllowed}
          className="mt-1 h-5 w-5 shrink-0 rounded border-slate-300 text-emerald-600 focus:ring-emerald-200"
          aria-label={`Выбрать тренировку ${workout.title || "Тренировка"}`}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
          {exerciseCount} {pluralRu(String(exerciseCount), "упражнение", "упражнения", "упражнений")}
        </span>
        {groupCount ? (
          <span className="rounded-full bg-emerald-100/80 px-2.5 py-1 text-xs font-medium text-emerald-700">
            {groupCount} {pluralRu(String(groupCount), "группа", "группы", "групп")}
          </span>
        ) : null}
      </div>

      {visibleExercises.length > 0 ? (
        <ol className="mt-4 flex-1 space-y-1.5 text-sm text-slate-600">
          {visibleExercises.map((title, index) => (
            <li key={`${title}-${index}`} className="flex gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
                {String.fromCharCode(65 + index)}
              </span>
              <span className="line-clamp-1">{title}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 flex-1 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-500">Упражнения не указаны.</p>
      )}

      {hiddenCount > 0 ? (
        <p className="mt-3 text-xs font-semibold text-slate-400">
          +{hiddenCount} {pluralRu(String(hiddenCount), "ещё", "ещё", "ещё")}
        </p>
      ) : null}
      {workout.summary ? (
        <p className="mt-3 line-clamp-2 rounded-2xl bg-white/60 px-3 py-2 text-xs leading-5 text-slate-500">
          {workout.summary}
        </p>
      ) : null}
    </div>
  );
}

function metricPayload(workout: CoachWorkout, workoutDate: string, options: { includeIds?: boolean } = {}) {
  const includeIds = options.includeIds ?? true;
  return {
    workoutDate,
    expectedUpdatedAt: workout.updatedAt || null,
    title: workout.title,
    coachComment: workout.coachComment || "",
    groups: (workout.groups || []).map((group) => ({
      id: includeIds ? group.id : undefined,
      draftId: group.id,
      title: group.title,
      sets: group.sets || "",
      rest: group.rest || "",
      notes: group.notes || "",
      sortOrder: group.sortOrder,
    })),
    exercises: workout.exercises.map((exercise) => ({
      id: includeIds ? exercise.id : undefined,
      exerciseId: exercise.exerciseId || "",
      groupId: exercise.groupId || "",
      groupDraftId: exercise.groupId || "",
      exerciseTitle: exercise.title,
      sets: exercise.sets || "",
      reps: exercise.reps || "",
      rest: exercise.rest || "",
      tempo: exercise.tempo || "",
      notes: exercise.notes || "",
      sortOrder: exercise.sortOrder ?? 0,
    })),
  };
}

type ExerciseBlock =
  | { type: "exercise"; exercise: DraftExercise; index: number }
  | { type: "group"; group: DraftExerciseGroup; exercises: Array<{ exercise: DraftExercise; index: number }> };

function blockSortableId(block: ExerciseBlock) {
  return block.type === "group" ? `group:${block.group.draftId}` : block.exercise.draftId;
}

function isGroupSortableId(id: string) {
  return id.startsWith("group:");
}

function groupIdFromSortableId(id: string) {
  return id.replace(/^group:/, "");
}

function buildExerciseBlocks(exercises: DraftExercise[], groups: DraftExerciseGroup[]): ExerciseBlock[] {
  const groupById = new Map(groups.map((group) => [group.draftId, group]));
  const seenGroups = new Set<string>();
  const blocks: ExerciseBlock[] = [];

  exercises.forEach((exercise, index) => {
    const groupId = exercise.groupDraftId;
    const group = groupId ? groupById.get(groupId) : undefined;
    if (!groupId || !group) {
      blocks.push({ type: "exercise", exercise, index });
      return;
    }
    if (seenGroups.has(groupId)) return;
    seenGroups.add(groupId);
    blocks.push({
      type: "group",
      group,
      exercises: exercises
        .map((item, idx) => ({ exercise: item, index: idx }))
        .filter((item) => item.exercise.groupDraftId === groupId),
    });
  });

  return blocks;
}

function blockRange(block: ExerciseBlock) {
  if (block.type === "exercise") {
    return { start: block.index, end: block.index };
  }
  const indexes = block.exercises.map((item) => item.index);
  return { start: Math.min(...indexes), end: Math.max(...indexes) };
}

function WorkoutExerciseGroupBlock({
  block,
  exerciseLibrary,
  onUpdateGroup,
  onUngroup,
  onSearchChange,
  onSelect,
  onUpdateExercise,
  onDuplicate,
  onInsertBelow,
  onMove,
  onRemove,
  onPreviewVideo,
}: {
  block: Extract<ExerciseBlock, { type: "group" }>;
  exerciseLibrary: ExerciseLibraryItem[];
  onUpdateGroup: (field: Exclude<keyof DraftExerciseGroup, "sortOrder">, value: string) => void;
  onUngroup: () => void;
  onSearchChange: (index: number, query: string) => void;
  onSelect: (index: number, exerciseId: string) => void;
  onUpdateExercise: (index: number, field: keyof DraftExercise, value: string) => void;
  onDuplicate: (index: number) => void;
  onInsertBelow: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
  onPreviewVideo: (exercise: PreviewExercise) => void;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: blockSortableId(block),
    data: {
      type: "group",
      groupDraftId: block.group.draftId,
    },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-3xl border border-emerald-200/60 bg-emerald-50/55 p-3 shadow-sm ${
        isDragging ? "relative z-30 shadow-2xl" : ""
      }`}
    >
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 gap-2">
          <button
            type="button"
            ref={setActivatorNodeRef}
            className="mt-0.5 cursor-grab rounded-xl px-2 py-1 text-lg leading-none text-emerald-600/55 transition-colors hover:bg-white/70 hover:text-emerald-700 active:cursor-grabbing"
            aria-label="Перетащить комбо"
            {...attributes}
            {...listeners}
          >
            ☰
          </button>
          <div className="min-w-0 flex-1">
            <input
              value={block.group.title}
              onChange={(e) => onUpdateGroup("title", e.target.value)}
              className="w-full border-0 bg-transparent text-base font-semibold text-slate-950 outline-none placeholder:text-slate-400"
              placeholder="Комбо"
            />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <InlineMetric
                label={formatSetsLabel(block.group.sets)}
                value={block.group.sets}
                placeholder="3"
                onChange={(value) => onUpdateGroup("sets", value)}
              />
              <span className="text-slate-300">·</span>
              <InlineMetric
                label={formatRestLabel(block.group.rest)}
                value={block.group.rest}
                placeholder="2 мин"
                onChange={(value) => onUpdateGroup("rest", value)}
              />
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onUngroup}
          className="rounded-full px-3 py-1.5 text-sm font-medium text-slate-400 transition-colors hover:bg-white/70 hover:text-slate-700"
        >
          Разъединить
        </button>
      </div>

      <SortableContext
        items={block.exercises.map(({ exercise }) => exercise.draftId)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-2 border-l-2 border-emerald-300/45 pl-3">
          {block.exercises.map(({ exercise, index }) => (
            <WorkoutExerciseCard
              key={exercise.draftId}
              exercise={exercise}
              index={index}
              exerciseLibrary={exerciseLibrary}
              onSearchChange={(query) => onSearchChange(index, query)}
              onSelect={(exerciseId) => onSelect(index, exerciseId)}
              onUpdate={(field, value) => onUpdateExercise(index, field, value)}
              onDuplicate={() => onDuplicate(index)}
              onInsertBelow={() => onInsertBelow(index)}
              onMove={(direction) => onMove(index, direction)}
              onRemove={() => onRemove(index)}
              onPreviewVideo={onPreviewVideo}
            />
          ))}
        </div>
      </SortableContext>

      <textarea
        value={block.group.notes}
        onChange={(e) => onUpdateGroup("notes", e.target.value)}
        className="mt-3 min-h-16 w-full rounded-2xl border border-emerald-200/55 bg-white/70 px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-emerald-400/60"
        placeholder="Общий комментарий к комбо"
      />
    </div>
  );
}

function WorkoutExerciseCard({
  exercise,
  index,
  exerciseLibrary,
  onSearchChange,
  onSelect,
  onUpdate,
  onDuplicate,
  onInsertBelow,
  onMove,
  onRemove,
  onPreviewVideo,
}: {
  exercise: DraftExercise;
  index: number;
  exerciseLibrary: ExerciseLibraryItem[];
  onSearchChange: (query: string) => void;
  onSelect: (exerciseId: string) => void;
  onUpdate: (field: keyof DraftExercise, value: string) => void;
  onDuplicate: () => void;
  onInsertBelow: () => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onPreviewVideo: (exercise: PreviewExercise) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(Boolean(exercise.notes));
  const [isReplacing, setIsReplacing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: exercise.draftId,
    data: {
      type: "exercise",
      groupDraftId: exercise.groupDraftId || "",
    },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const libraryExercise = exercise.exerciseId
    ? exerciseLibrary.find((item) => item.id === exercise.exerciseId)
    : undefined;
  const suggestedDescription = String(libraryExercise?.description || "").trim();
  const showNotesBlock = notesOpen || Boolean(exercise.notes.trim()) || Boolean(suggestedDescription);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(e: PointerEvent) {
      const target = e.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-3xl border border-slate-200 bg-white p-3 shadow-sm ${
        isDragging ? "relative z-30 shadow-2xl" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            ref={setActivatorNodeRef}
            className="cursor-grab rounded-xl px-2 py-1 text-lg leading-none text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing"
            aria-label="Перетащить упражнение"
            {...attributes}
            {...listeners}
          >
            ☰
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-xl px-2 py-1 text-sm leading-none text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
            aria-label="Удалить упражнение"
          >
            🗑
          </button>
        </div>

        <div className="min-w-0 flex-1">
          {exercise.exerciseId && !isReplacing ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsReplacing(true)}
                className="min-w-0 text-left"
                title="Нажми, чтобы заменить упражнение"
              >
                <h5 className="truncate text-base font-semibold text-slate-950 transition-colors hover:text-brand-primary sm:text-lg">
                  {exercise.exerciseTitle}
                </h5>
              </button>
              <span className="hidden text-xs font-medium text-slate-300 sm:inline">
                изменить
              </span>
              {libraryExercise?.videoUrl ? (
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] text-slate-500 transition-colors hover:bg-brand-primary/10 hover:text-brand-primary"
                  title="Посмотреть видео упражнения"
                  aria-label={`Посмотреть видео упражнения ${exercise.exerciseTitle}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPreviewVideo({
                      title: libraryExercise.title,
                      videoUrl: libraryExercise.videoUrl,
                    });
                  }}
                >
                  ▶
                </button>
              ) : null}
            </div>
          ) : (
            <ExerciseSearchPicker
              exercise={exercise}
              exerciseLibrary={exerciseLibrary}
              autoFocus={isReplacing}
              onSearchChange={onSearchChange}
              onSelect={(exerciseId) => {
                onSelect(exerciseId);
                setIsReplacing(false);
              }}
            />
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
            <InlineMetric
              label={formatSetsLabel(exercise.sets)}
              value={exercise.sets}
              placeholder="2"
              onChange={(value) => onUpdate("sets", value)}
            />
            <span className="text-slate-300">×</span>
            <InlineMetric
              label={formatRepsLabel(exercise.reps)}
              value={exercise.reps}
              placeholder="8"
              onChange={(value) => onUpdate("reps", value)}
            />
            <span className="text-slate-300">·</span>
            <InlineMetric
              label={formatRestLabel(exercise.rest)}
              value={exercise.rest}
              placeholder="2–3 мин"
              onChange={(value) => onUpdate("rest", value)}
            />
          </div>

          <div className="mt-3">
            {showNotesBlock ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 transition-colors focus-within:border-brand-primary">
                <textarea
                  value={exercise.notes}
                  onChange={(e) => onUpdate("notes", e.target.value)}
                  onFocus={() => setNotesOpen(true)}
                  className="min-h-14 w-full resize-y border-0 bg-transparent p-0 text-sm text-slate-800 outline-none placeholder:text-slate-400"
                  placeholder="Заметка к упражнению"
                />
                {suggestedDescription && !exercise.notes.trim() ? (
                  <button
                    type="button"
                    onClick={() => {
                      onUpdate("notes", suggestedDescription);
                      setNotesOpen(true);
                    }}
                    className="mt-1 w-full rounded-xl bg-slate-50 px-2.5 py-1.5 text-left text-xs text-slate-500 transition-colors hover:bg-brand-primary/5 hover:text-slate-700"
                  >
                    <span className="block font-medium text-slate-600">Вставить описание из библиотеки</span>
                    <span className="mt-0.5 block line-clamp-2">{suggestedDescription}</span>
                  </button>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setNotesOpen(true)}
                className="text-sm font-medium text-slate-400 transition-colors hover:text-brand-primary"
              >
                + заметка
              </button>
            )}
          </div>
        </div>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            className="rounded-full px-2 py-1 text-xl leading-none text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label={`Действия для упражнения ${index + 1}`}
          >
            ⋯
          </button>
          {menuOpen ? (
            <div className="absolute right-0 z-20 mt-1 w-56 rounded-2xl border border-slate-200 bg-white p-1 text-sm shadow-xl">
              {exercise.exerciseId ? (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setIsReplacing(true);
                  }}
                  className="block w-full rounded-xl px-3 py-2 text-left text-slate-700 hover:bg-slate-100"
                >
                  Заменить упражнение
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDuplicate();
                }}
                className="block w-full rounded-xl px-3 py-2 text-left text-slate-700 hover:bg-slate-100"
              >
                Дублировать
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onInsertBelow();
                }}
                className="block w-full rounded-xl px-3 py-2 text-left text-slate-700 hover:bg-slate-100"
              >
                Вставить упражнение ниже
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onMove(-1);
                }}
                className="block w-full rounded-xl px-3 py-2 text-left text-slate-700 hover:bg-slate-100"
              >
                Переместить выше
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onMove(1);
                }}
                className="block w-full rounded-xl px-3 py-2 text-left text-slate-700 hover:bg-slate-100"
              >
                Переместить ниже
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onRemove();
                }}
                className="block w-full rounded-xl px-3 py-2 text-left text-red-600 hover:bg-red-50"
              >
                Удалить упражнение
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function LkStudentCalendar({ studentId, workouts, exerciseLibrary }: Props) {
  const router = useRouter();
  const [visibleWeekStart, setVisibleWeekStart] = useState(() => startOfWeek(new Date()));
  const [localWorkouts, setLocalWorkouts] = useState(workouts);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [error, setError] = useState("");
  const [calendarError, setCalendarError] = useState("");
  const [copiedWorkout, setCopiedWorkout] = useState<CoachWorkout | null>(null);
  const [movingWorkoutId, setMovingWorkoutId] = useState("");
  const [pastingDate, setPastingDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewExercise, setPreviewExercise] = useState<PreviewExercise | null>(null);
  const [programImportDate, setProgramImportDate] = useState("");
  const [programs, setPrograms] = useState<ProgramTemplatePreview[] | null>(null);
  const [programsLoading, setProgramsLoading] = useState(false);
  const [programsError, setProgramsError] = useState("");
  const [programPreferenceLoading, setProgramPreferenceLoading] = useState(false);
  const [programPreferenceError, setProgramPreferenceError] = useState("");
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const [selectedProgram, setSelectedProgram] = useState<ProgramTemplatePreview | null>(null);
  const [selectedProgramLoading, setSelectedProgramLoading] = useState(false);
  const [selectedProgramError, setSelectedProgramError] = useState("");
  const [selectedWorkoutIds, setSelectedWorkoutIds] = useState<string[]>([]);
  const [importingProgram, setImportingProgram] = useState(false);
  const [importError, setImportError] = useState("");
  const [importSuccess, setImportSuccess] = useState("");
  const [pendingOpenWorkoutId, setPendingOpenWorkoutId] = useState("");
  const programOpenRequestRef = useRef(0);
  const programDetailsRequestRef = useRef(0);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const byDate = useMemo(() => {
    const map = new Map<string, CoachWorkout[]>();
    for (const workout of localWorkouts) {
      const list = map.get(workout.date) || [];
      list.push(workout);
      map.set(workout.date, list);
    }
    return map;
  }, [localWorkouts]);

  const selectedProgramWorkouts = selectedProgram?.workouts || [];

  useEffect(() => {
    setLocalWorkouts(workouts);
  }, [workouts]);

  useEffect(() => {
    if (!pendingOpenWorkoutId) return;
    const workout = localWorkouts.find((item) => item.id === pendingOpenWorkoutId);
    if (!workout) return;
    openEdit(workout);
    setPendingOpenWorkoutId("");
    setImportSuccess("");
  }, [localWorkouts, pendingOpenWorkoutId]);

  useEffect(() => {
    if (!previewExercise) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPreviewExercise(null);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [previewExercise]);

  useEffect(() => {
    if (!editing || saving || previewExercise) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setEditing(null);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editing, saving, previewExercise]);

  useEffect(() => {
    if (!programImportDate) return;

    const requestId = programOpenRequestRef.current + 1;
    programOpenRequestRef.current = requestId;
    const controller = new AbortController();

    setProgramsLoading(true);
    setProgramPreferenceLoading(true);
    setPrograms(null);
    setProgramsError("");
    setProgramPreferenceError("");
    setImportError("");
    setSelectedProgramId("");
    setSelectedProgram(null);
    setSelectedProgramError("");
    setSelectedProgramLoading(false);
    setSelectedWorkoutIds([]);

    async function loadInitialProgramState() {
      const programsRequest = fetch("/api/lk/coach/programs", { signal: controller.signal })
        .then(async (res) => {
          const json = (await res.json().catch(() => null)) as {
            ok?: boolean;
            message?: string;
            error?: string;
            programs?: ProgramTemplatePreview[];
          } | null;
          if (!res.ok || json?.ok === false) {
            throw new Error(json?.message || json?.error || "Не удалось загрузить программы.");
          }
          return Array.isArray(json?.programs) ? json.programs : [];
        });

      const preferenceRequest = fetch(`/api/lk/coach/students/${studentId}/calendar/program-preference`, {
        signal: controller.signal,
      })
        .then(async (res) => {
          const json = (await res.json().catch(() => null)) as {
            ok?: boolean;
            programTemplateId?: string | null;
          } | null;
          if (!res.ok || json?.ok === false) return null;
          return typeof json?.programTemplateId === "string" ? json.programTemplateId : null;
        })
        .catch((e) => {
          if (e instanceof DOMException && e.name === "AbortError") throw e;
          if (programOpenRequestRef.current === requestId) {
            setProgramPreferenceError("Не удалось загрузить последнюю программу.");
          }
          return null;
        });

      try {
        const [nextPrograms, preferredProgramId] = await Promise.all([programsRequest, preferenceRequest]);
        if (controller.signal.aborted || programOpenRequestRef.current !== requestId) return;
        setPrograms(nextPrograms);
        const rememberedProgram = preferredProgramId
          ? nextPrograms.find((program) => program.id === preferredProgramId)
          : undefined;
        if (rememberedProgram) {
          setSelectedProgramId(rememberedProgram.id);
        }
      } catch (e) {
        if (controller.signal.aborted || programOpenRequestRef.current !== requestId) return;
        setPrograms(null);
        setProgramsError(e instanceof Error ? e.message : "Не удалось загрузить программы.");
      } finally {
        if (!controller.signal.aborted && programOpenRequestRef.current === requestId) {
          setProgramsLoading(false);
          setProgramPreferenceLoading(false);
        }
      }
    }

    void loadInitialProgramState();
    return () => controller.abort();
  }, [programImportDate, studentId]);

  useEffect(() => {
    const requestId = programDetailsRequestRef.current + 1;
    programDetailsRequestRef.current = requestId;
    const controller = new AbortController();
    setSelectedWorkoutIds([]);

    if (!selectedProgramId) {
      setSelectedProgram(null);
      setSelectedProgramError("");
      setSelectedProgramLoading(false);
      return () => controller.abort();
    }

    setSelectedProgramLoading(true);
    setSelectedProgramError("");
    setSelectedProgram(null);

    async function loadSelectedProgram() {
      try {
        const res = await fetch(`/api/lk/coach/programs/${selectedProgramId}`, { signal: controller.signal });
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          message?: string;
          error?: string;
          program?: ProgramTemplatePreview;
        } | null;
        if (!res.ok || json?.ok === false || !json?.program) {
          throw new Error(json?.message || json?.error || "Не удалось загрузить программу.");
        }
        if (controller.signal.aborted || programDetailsRequestRef.current !== requestId) return;
        setSelectedProgram(json.program);
      } catch (e) {
        if (controller.signal.aborted || programDetailsRequestRef.current !== requestId) return;
        setSelectedProgramError(e instanceof Error ? e.message : "Не удалось загрузить программу.");
      } finally {
        if (!controller.signal.aborted && programDetailsRequestRef.current === requestId) {
          setSelectedProgramLoading(false);
        }
      }
    }

    void loadSelectedProgram();
    return () => controller.abort();
  }, [selectedProgramId]);

  const daysCount = 42;
  const days = Array.from({ length: daysCount }, (_, index) => addDays(visibleWeekStart, index));
  const weekDays = days.slice(0, 7);
  const todayKey = dateKey(new Date());

  function openCreate(workoutDate: string) {
    setError("");
    setEditing({
      mode: "create",
      workoutDate,
      title: "",
      coachComment: "",
      groups: [],
      exercises: [emptyExercise()],
    });
  }

  function openEdit(workout: CoachWorkout) {
    setError("");
    setEditing({
      mode: "edit",
      workoutId: workout.id,
      expectedUpdatedAt: workout.updatedAt || null,
      workoutDate: workout.date,
      title: workout.title,
      coachComment: workout.coachComment || "",
      groups: workoutGroupsToDraft(workout),
      exercises: workout.exercises.length > 0 ? workout.exercises.map(exerciseToDraft) : [emptyExercise()],
    });
  }

  function openProgramImport(workoutDate: string) {
    setProgramImportDate(workoutDate);
    setImportError("");
    setImportSuccess("");
    setCalendarError("");
    setSelectedWorkoutIds([]);
  }

  function closeProgramImport() {
    if (importingProgram) return;
    programOpenRequestRef.current += 1;
    programDetailsRequestRef.current += 1;
    setProgramImportDate("");
    setImportError("");
    setProgramPreferenceError("");
    setSelectedProgramId("");
    setSelectedProgram(null);
    setSelectedProgramError("");
    setSelectedWorkoutIds([]);
  }

  function toggleSelectedWorkout(workoutId: string) {
    setSelectedWorkoutIds((current) =>
      current.includes(workoutId) ? current.filter((id) => id !== workoutId) : [...current, workoutId]
    );
  }

  async function importSelectedWorkouts() {
    if (!programImportDate || !selectedProgramId || selectedWorkoutIds.length === 0) {
      setImportError("Выбери программу и хотя бы одну тренировку.");
      return;
    }

    setImportingProgram(true);
    setImportError("");
    setImportSuccess("");
    try {
      const res = await fetch(`/api/lk/coach/students/${studentId}/calendar/import-template-workouts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programTemplateId: selectedProgramId,
          startDate: programImportDate,
          templateWorkoutIds: selectedWorkoutIds,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        error?: string;
        workoutIds?: string[];
        importedWorkouts?: ImportWorkoutItem[];
      } | null;
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.message || json?.error || "Не удалось импортировать тренировки.");
      }

      const importedWorkouts = Array.isArray(json?.importedWorkouts) ? json.importedWorkouts : [];
      const workoutIds = Array.isArray(json?.workoutIds) ? json.workoutIds.filter(Boolean) : [];
      const totalImported = importedWorkouts.length || workoutIds.length || selectedWorkoutIds.length;
      setProgramImportDate("");
      setSelectedWorkoutIds([]);
      setSelectedProgramId("");
      setSelectedProgram(null);
      setImportSuccess(
        totalImported === 1 ? "Тренировка добавлена." : `Добавлено тренировок: ${totalImported}.`
      );
      router.refresh();

      if (totalImported === 1) {
        const importedWorkoutId = importedWorkouts[0]?.clientWorkoutId || workoutIds[0] || "";
        if (importedWorkoutId) {
          const existingWorkout = localWorkouts.find((workout) => workout.id === importedWorkoutId);
          if (existingWorkout) {
            openEdit(existingWorkout);
            setImportSuccess("");
          } else {
            setPendingOpenWorkoutId(importedWorkoutId);
            window.setTimeout(() => {
              setPendingOpenWorkoutId((current) => (current === importedWorkoutId ? "" : current));
            }, 2500);
          }
        }
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Не удалось импортировать тренировки.");
    } finally {
      setImportingProgram(false);
    }
  }

  function updateExercise(index: number, field: keyof DraftExercise, value: string) {
    setEditing((current) => {
      if (!current) return current;
      return {
        ...current,
        exercises: current.exercises.map((exercise, idx) =>
          idx === index ? { ...exercise, [field]: value } : exercise
        ),
      };
    });
  }

  function selectLibraryExercise(index: number, exerciseId: string) {
    const selected = exerciseLibrary.find((exercise) => exercise.id === exerciseId);
    setEditing((current) => {
      if (!current) return current;
      return {
        ...current,
        exercises: current.exercises.map((exercise, idx) =>
          idx === index
            ? {
                ...exercise,
                exerciseId,
                exerciseTitle: selected?.title || exercise.exerciseTitle,
              }
            : exercise
        ),
      };
    });
  }

  function updateExerciseSearch(index: number, query: string) {
    setEditing((current) => {
      if (!current) return current;
      return {
        ...current,
        exercises: current.exercises.map((exercise, idx) =>
          idx === index ? { ...exercise, exerciseId: "", exerciseTitle: query } : exercise
        ),
      };
    });
  }

  function insertExerciseAfter(index: number) {
    setEditing((current) => {
      if (!current) return current;
      const next = [...current.exercises];
      const source = current.exercises[index];
      next.splice(index + 1, 0, { ...emptyExercise(), groupDraftId: source?.groupDraftId });
      return { ...current, exercises: next };
    });
  }

  function duplicateExercise(index: number) {
    setEditing((current) => {
      if (!current) return current;
      const source = current.exercises[index];
      if (!source) return current;
      const next = [...current.exercises];
      next.splice(index + 1, 0, { ...source, id: undefined, draftId: createDraftId() });
      return { ...current, exercises: next };
    });
  }

  function removeExercise(index: number) {
    setEditing((current) => {
      if (!current) return current;
      const removing = current.exercises[index];
      const nextExercises =
        current.exercises.length > 1
          ? current.exercises.filter((_, idx) => idx !== index)
          : [emptyExercise()];
      const nextGroups = current.groups.filter((group) =>
        nextExercises.some((exercise) => exercise.groupDraftId === group.draftId)
      );
      return {
        ...current,
        groups: removing?.groupDraftId ? nextGroups : current.groups,
        exercises: nextExercises,
      };
    });
  }

  function moveExercise(index: number, direction: -1 | 1) {
    setEditing((current) => {
      if (!current) return current;
      const target = index + direction;
      if (target < 0 || target >= current.exercises.length) return current;
      const next = [...current.exercises];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return { ...current, exercises: next };
    });
  }

  function groupAdjacentExercises(index: number) {
    setEditing((current) => {
      if (!current) return current;
      const first = current.exercises[index];
      const second = current.exercises[index + 1];
      if (!first || !second || first.groupDraftId || second.groupDraftId) return current;

      const draftId = createDraftId();
      const group: DraftExerciseGroup = {
        draftId,
        title: `Комбо ${current.groups.length + 1}`,
        sets: "",
        rest: "",
        notes: "",
        sortOrder: index,
      };

      return {
        ...current,
        groups: [...current.groups, group],
        exercises: current.exercises.map((exercise, idx) =>
          idx === index || idx === index + 1 ? { ...exercise, groupDraftId: draftId, sets: "", rest: "" } : exercise
        ),
      };
    });
  }

  function joinExerciseToGroup(index: number, groupDraftId: string) {
    setEditing((current) => {
      if (!current) return current;
      const exercise = current.exercises[index];
      const group = current.groups.find((item) => item.draftId === groupDraftId);
      if (!exercise || !group || exercise.groupDraftId) return current;

      return {
        ...current,
        exercises: current.exercises.map((item, idx) =>
          idx === index ? { ...item, groupDraftId, sets: "", rest: "" } : item
        ),
      };
    });
  }

  function updateGroup(groupDraftId: string, field: Exclude<keyof DraftExerciseGroup, "sortOrder">, value: string) {
    setEditing((current) => {
      if (!current) return current;
      return {
        ...current,
        groups: current.groups.map((group) =>
          group.draftId === groupDraftId ? { ...group, [field]: value } : group
        ),
      };
    });
  }

  function ungroupExercises(groupDraftId: string) {
    setEditing((current) => {
      if (!current) return current;
      return {
        ...current,
        groups: current.groups.filter((group) => group.draftId !== groupDraftId),
        exercises: current.exercises.map((exercise) =>
          exercise.groupDraftId === groupDraftId ? { ...exercise, groupDraftId: undefined } : exercise
        ),
      };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setEditing((current) => {
      if (!current) return current;
      const activeId = String(active.id);
      const overId = String(over.id);
      const activeType = String(active.data.current?.type || "");
      const overType = String(over.data.current?.type || "");
      const activeGroupDraftId = String(active.data.current?.groupDraftId || "");
      const overGroupDraftId = String(over.data.current?.groupDraftId || "");

      if (activeType === "exercise" && overType === "exercise" && activeGroupDraftId && activeGroupDraftId === overGroupDraftId) {
        const oldIndex = current.exercises.findIndex((exercise) => exercise.draftId === activeId);
        const newIndex = current.exercises.findIndex((exercise) => exercise.draftId === overId);
        if (oldIndex < 0 || newIndex < 0) return current;
        return { ...current, exercises: arrayMove(current.exercises, oldIndex, newIndex) };
      }

      if (activeType === "exercise" && activeGroupDraftId) {
        return current;
      }

      const blocks = buildExerciseBlocks(current.exercises, current.groups);
      const findBlock = (id: string): ExerciseBlock | undefined => {
        if (isGroupSortableId(id)) {
          const groupDraftId = groupIdFromSortableId(id);
          return blocks.find((block) => block.type === "group" && block.group.draftId === groupDraftId);
        }
        const topLevelExercise = blocks.find((block) => block.type === "exercise" && block.exercise.draftId === id);
        if (topLevelExercise) return topLevelExercise;
        return blocks.find(
          (block) => block.type === "group" && block.exercises.some((item) => item.exercise.draftId === id)
        );
      };
      const sourceBlock = findBlock(activeId);
      const targetBlock = findBlock(overId);
      if (!sourceBlock || !targetBlock || sourceBlock === targetBlock) return current;

      const source = blockRange(sourceBlock);
      const target = blockRange(targetBlock);
      const segment = current.exercises.slice(source.start, source.end + 1);
      const remaining = [
        ...current.exercises.slice(0, source.start),
        ...current.exercises.slice(source.end + 1),
      ];
      const insertIndex = source.start < target.start ? target.start - segment.length : target.start;
      return {
        ...current,
        exercises: [
          ...remaining.slice(0, insertIndex),
          ...segment,
          ...remaining.slice(insertIndex),
        ],
      };
    });
  }

  async function moveWorkoutToDate(workout: CoachWorkout, workoutDate: string) {
    if (workout.date === workoutDate) return;

    const previousWorkouts = localWorkouts;
    const optimisticWorkout = { ...workout, date: workoutDate };
    setLocalWorkouts((current) =>
      current.map((item) => (item.id === workout.id ? optimisticWorkout : item))
    );
    setMovingWorkoutId(workout.id);
    setCalendarError("");
    try {
      const res = await fetch(`/api/lk/coach/students/${studentId}/workouts/${workout.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metricPayload(workout, workoutDate)),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
        throw new Error(json?.message || json?.error || "Не удалось перенести тренировку.");
      }
      router.refresh();
    } catch (e) {
      setLocalWorkouts(previousWorkouts);
      setCalendarError(e instanceof Error ? e.message : "Не удалось перенести тренировку.");
    } finally {
      setMovingWorkoutId("");
    }
  }

  function handleWorkoutDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const workout = active.data.current?.workout as CoachWorkout | undefined;
    const date = over?.data.current?.date as string | undefined;
    if (!workout || !date) return;
    void moveWorkoutToDate(workout, date);
  }

  async function pasteWorkoutToDate(workoutDate: string) {
    if (!copiedWorkout) return;

    const previousWorkouts = localWorkouts;
    const temporaryWorkout: CoachWorkout = {
      ...copiedWorkout,
      id: `optimistic-${createDraftId()}`,
      date: workoutDate,
    };
    setLocalWorkouts((current) => [...current, temporaryWorkout]);
    setPastingDate(workoutDate);
    setCalendarError("");
    try {
      const res = await fetch(`/api/lk/coach/students/${studentId}/workouts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metricPayload(copiedWorkout, workoutDate, { includeIds: false })),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
        throw new Error(json?.message || json?.error || "Не удалось вставить копию тренировки.");
      }
      router.refresh();
    } catch (e) {
      setLocalWorkouts(previousWorkouts);
      setCalendarError(e instanceof Error ? e.message : "Не удалось вставить копию тренировки.");
    } finally {
      setPastingDate("");
    }
  }

  async function deleteWorkout(workout: CoachWorkout) {
    const previousWorkouts = localWorkouts;
    const previousCopiedWorkout = copiedWorkout;
    setLocalWorkouts((current) => current.filter((item) => item.id !== workout.id));
    if (copiedWorkout?.id === workout.id) setCopiedWorkout(null);
    setCalendarError("");

    try {
      const res = await fetch(`/api/lk/coach/students/${studentId}/workouts/${workout.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
        throw new Error(json?.message || json?.error || "Не удалось удалить тренировку.");
      }
      router.refresh();
    } catch (e) {
      setLocalWorkouts(previousWorkouts);
      setCopiedWorkout(previousCopiedWorkout);
      setCalendarError(e instanceof Error ? e.message : "Не удалось удалить тренировку.");
    }
  }

  async function saveWorkout() {
    if (!editing) return;
    const title = editing.title.trim() || "Тренировка";
    const hasUnselectedExercise = editing.exercises.some((exercise) => !exercise.exerciseId);
    if (hasUnselectedExercise) {
      setError("Выбери упражнение из библиотеки для каждой строки.");
      return;
    }

    setSaving(true);
    setError("");

    const endpoint =
      editing.mode === "edit" && editing.workoutId
        ? `/api/lk/coach/students/${studentId}/workouts/${editing.workoutId}`
        : `/api/lk/coach/students/${studentId}/workouts`;

    try {
      const blocks = buildExerciseBlocks(editing.exercises, editing.groups);
      const groupSortOrder = new Map<string, number>();
      const exerciseSortOrder = new Map<string, number>();
      blocks.forEach((block, blockIndex) => {
        if (block.type === "group") {
          groupSortOrder.set(block.group.draftId, blockIndex);
          block.exercises.forEach((item, innerIndex) => {
            exerciseSortOrder.set(item.exercise.draftId, innerIndex);
          });
        } else {
          exerciseSortOrder.set(block.exercise.draftId, blockIndex);
        }
      });

      const res = await fetch(endpoint, {
        method: editing.mode === "edit" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutDate: editing.workoutDate,
          expectedUpdatedAt: editing.expectedUpdatedAt || null,
          title,
          coachComment: editing.coachComment,
          groups: editing.groups.map((group) => ({
            id: group.id,
            draftId: group.draftId,
            title: group.title,
            sets: group.sets,
            rest: group.rest,
            notes: group.notes,
            sortOrder: groupSortOrder.get(group.draftId) ?? group.sortOrder,
          })),
          exercises: editing.exercises.map((exercise) => ({
            ...exercise,
            groupDraftId: exercise.groupDraftId || "",
            sortOrder: exerciseSortOrder.get(exercise.draftId) ?? 0,
          })),
        }),
      });

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
        throw new Error(json?.message || json?.error || "Не удалось сохранить тренировку.");
      }

      setEditing(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить тренировку.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Календарь</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">
            {calendarRangeLabel(visibleWeekStart, daysCount)}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setVisibleWeekStart((current) => addWeeks(current, -1))}
            className="rounded-full px-3 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100"
          >
            Пред. неделя
          </button>
          <button
            type="button"
            onClick={() => setVisibleWeekStart(startOfWeek(new Date()))}
            className="rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200"
          >
            Сегодня
          </button>
          <button
            type="button"
            onClick={() => setVisibleWeekStart((current) => addWeeks(current, 1))}
            className="rounded-full px-3 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100"
          >
            След. неделя
          </button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto rounded-2xl bg-slate-50/80 p-2">
        {weekDays.map((day) => {
          const key = dateKey(day);
          const workoutCount = (byDate.get(key) || []).length;
          const isToday = key === todayKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setVisibleWeekStart(startOfWeek(day))}
              className={`min-w-20 rounded-xl px-3 py-2 text-left transition-all duration-150 ${
                isToday ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 opacity-80 hover:bg-white/70 hover:opacity-100"
              }`}
            >
              <span className="block text-[11px] uppercase tracking-[0.12em]">{dayLabel(day)}</span>
              <span className="mt-1 flex items-center gap-2 text-sm font-semibold">
                {dateLabel(day)}
                {loadDots(workoutCount)}
              </span>
            </button>
          );
        })}
      </div>

      {calendarError ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {calendarError}
        </p>
      ) : null}
      {importSuccess ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {importSuccess}
        </p>
      ) : null}
      {copiedWorkout ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-brand-primary/20 bg-brand-primary/5 px-3 py-2 text-sm text-slate-600">
          <span>
            Скопирована тренировка: <span className="font-semibold text-slate-900">{copiedWorkout.title}</span>
          </span>
          <button
            type="button"
            onClick={() => setCopiedWorkout(null)}
            className="rounded-full px-2 py-1 text-slate-400 transition-colors hover:bg-white hover:text-slate-700"
            aria-label="Очистить скопированную тренировку"
          >
            ×
          </button>
        </div>
      ) : null}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleWorkoutDragEnd}>
        <div className="grid max-h-[72vh] gap-2 overflow-y-auto pr-1 lg:grid-cols-7">
          {days.map((day, index) => {
            const key = dateKey(day);
            const dayWorkouts = byDate.get(key) || [];
            const isPast = key < todayKey;
            const isToday = key === todayKey;
            return (
              <DayCell
                key={key}
                day={day}
                dayKey={key}
                workouts={dayWorkouts}
                isPast={isPast}
                isToday={isToday}
                copiedWorkout={copiedWorkout}
                movingWorkoutId={movingWorkoutId}
                pastingDate={pastingDate}
                hasWeekDivider={index >= 7}
                onCreate={() => openCreate(key)}
                onImportFromProgram={() => openProgramImport(key)}
                onPaste={() => pasteWorkoutToDate(key)}
                onEditWorkout={openEdit}
                onCopyWorkout={(workout) => {
                  setCopiedWorkout(workout);
                  setCalendarError("");
                }}
                onDeleteWorkout={(workout) => void deleteWorkout(workout)}
              />
            );
          })}
        </div>
      </DndContext>

      {programImportDate ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-slate-950/40 px-2 py-3 sm:items-center sm:justify-center sm:px-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeProgramImport();
          }}
        >
          <div
            className="flex h-[90vh] max-h-[calc(100vh-1.5rem)] w-full max-w-[1320px] flex-col overflow-hidden rounded-3xl bg-white text-slate-950 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 border-b border-slate-100 px-4 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-emerald-600">Из программы</p>
                  <h3 className="mt-1 text-2xl font-semibold">Добавить тренировки</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Дата старта: {formatDateHuman(programImportDate)}. Смещения дней сохраняются из шаблона.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeProgramImport}
                  disabled={importingProgram}
                  className="rounded-full px-3 py-1 text-sm text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Закрыть
                </button>
              </div>
            </div>

            <div className="shrink-0 space-y-3 border-b border-slate-100 px-4 py-4 sm:px-6">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Программа</span>
                <select
                  value={selectedProgramId}
                  onChange={(e) => {
                    setSelectedProgramId(e.target.value);
                    setImportError("");
                  }}
                  disabled={programsLoading || importingProgram}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-50"
                >
                  <option value="">Выбери программу</option>
                  {(programs || []).map((program) => (
                    <option key={program.id} value={program.id}>
                      {program.title}
                      {program.workoutsCount ? ` (${program.workoutsCount})` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  {programsLoading ? (
                    <p className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-500">Загружаю программы...</p>
                  ) : null}
                  {programPreferenceLoading ? (
                    <p className="mt-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-500">
                      Проверяю последнюю программу ученика...
                    </p>
                  ) : null}
                  {programPreferenceError ? (
                    <p className="mt-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-500">
                      Последнюю программу не удалось загрузить, можно выбрать вручную.
                    </p>
                  ) : null}
                  {programsError ? (
                    <p className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {programsError}
                    </p>
                  ) : null}
                  {!programsLoading && programs && programs.length === 0 ? (
                    <p className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-500">
                      Нет доступных программ для импорта.
                    </p>
                  ) : null}

                  {selectedProgram ? (
                    <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <h4 className="truncate text-base font-semibold text-slate-950">{selectedProgram.title}</h4>
                          {selectedProgram.description ? (
                            <p className="mt-1 line-clamp-2 text-sm text-slate-500">{selectedProgram.description}</p>
                          ) : null}
                        </div>
                        <p className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500">
                          Выбрано: {selectedWorkoutIds.length}
                        </p>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
                        {selectedProgram.level ? (
                          <span className="rounded-full bg-white px-2 py-1">{selectedProgram.level}</span>
                        ) : null}
                        {selectedProgram.goal ? (
                          <span className="rounded-full bg-white px-2 py-1">{selectedProgram.goal}</span>
                        ) : null}
                        {selectedProgram.tags?.slice(0, 4).map((tag) => (
                          <span key={tag} className="rounded-full bg-white px-2 py-1">
                            {tag}
                          </span>
                        ))}
                        {selectedProgram.ownerType === "global" ? (
                          <span className="rounded-full bg-white px-2 py-1">общая</span>
                        ) : selectedProgram.ownerType === "other" ? (
                          <span className="rounded-full bg-white px-2 py-1">другой тренер</span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedWorkoutIds(selectedProgramWorkouts.map((workout) => workout.id))}
                    disabled={selectedProgramLoading || importingProgram || selectedProgramWorkouts.length === 0}
                    className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Выбрать все
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedWorkoutIds([])}
                    disabled={selectedProgramLoading || importingProgram || selectedWorkoutIds.length === 0}
                    className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Сбросить
                  </button>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              {selectedProgramLoading ? (
                <p className="rounded-3xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  Загружаю тренировки...
                </p>
              ) : null}
              {selectedProgramError ? (
                <p className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {selectedProgramError}
                </p>
              ) : null}
              {!selectedProgramId && !selectedProgramLoading && !programsLoading ? (
                <p className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-8 text-center text-sm text-slate-500">
                  Выбери программу, чтобы увидеть тренировки.
                </p>
              ) : null}

              {selectedProgram && !selectedProgramLoading ? (
                selectedProgramWorkouts.length > 0 ? (
                  <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {selectedProgramWorkouts.map((workout) => (
                      <ProgramWorkoutPreviewCard
                        key={workout.id}
                        workout={workout}
                        selected={selectedWorkoutIds.includes(workout.id)}
                        disabled={importingProgram}
                        onToggle={() => toggleSelectedWorkout(workout.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-3xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    В этой программе нет тренировок для импорта.
                  </p>
                )
              ) : null}
            </div>

            <div className="shrink-0 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
              {importError ? (
                <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {importError}
                </p>
              ) : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs text-slate-400">
                    Первая выбранная по дню тренировка попадёт на дату старта, остальные сохранят смещения.
                  </p>
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeProgramImport}
                    disabled={importingProgram}
                    className="rounded-full px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={() => void importSelectedWorkouts()}
                    disabled={!selectedProgramId || selectedWorkoutIds.length === 0 || selectedProgramLoading || importingProgram}
                    className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {importingProgram ? "Добавляю..." : "Добавить выбранные"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {editing ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-slate-950/40 px-3 py-4 sm:items-center sm:justify-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !saving) setEditing(null);
          }}
        >
          <div
            className="max-h-[86vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-4 text-slate-950 shadow-2xl sm:p-5"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  {editing.mode === "edit" ? "Редактирование" : "Новая тренировка"}
                </p>
                <h3 className="mt-1 text-xl font-semibold">
                  {editing.mode === "edit" ? "Изменить тренировку" : "Создать тренировку"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-full border border-slate-200 px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100"
              >
                Закрыть
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
              <label className="space-y-1 text-sm">
                <span className="text-slate-500">Дата</span>
                <input
                  type="date"
                  value={editing.workoutDate}
                  onChange={(e) => setEditing({ ...editing, workoutDate: e.target.value })}
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-slate-950 outline-none focus:border-brand-primary"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-slate-500">Название</span>
                <input
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-slate-950 outline-none focus:border-brand-primary"
                  placeholder="Тренировка"
                />
              </label>
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h4 className="font-semibold">Упражнения</h4>
              </div>

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext
                  items={buildExerciseBlocks(editing.exercises, editing.groups).map(blockSortableId)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {buildExerciseBlocks(editing.exercises, editing.groups).map((block, blockIndex, blocks) => {
                      const nextBlock = blocks[blockIndex + 1];
                      const canGroupWithNext = block.type === "exercise" && nextBlock?.type === "exercise";
                      const canJoinNextToGroup = block.type === "group" && nextBlock?.type === "exercise";
                      const canJoinCurrentToNextGroup = block.type === "exercise" && nextBlock?.type === "group";

                      if (block.type === "group") {
                        return (
                          <div key={block.group.draftId} className="group/combo space-y-2">
                            <WorkoutExerciseGroupBlock
                              block={block}
                              exerciseLibrary={exerciseLibrary}
                              onUpdateGroup={(field, value) => updateGroup(block.group.draftId, field, value)}
                              onUngroup={() => ungroupExercises(block.group.draftId)}
                              onSearchChange={updateExerciseSearch}
                              onSelect={selectLibraryExercise}
                              onUpdateExercise={updateExercise}
                              onDuplicate={duplicateExercise}
                              onInsertBelow={insertExerciseAfter}
                              onMove={moveExercise}
                              onRemove={removeExercise}
                              onPreviewVideo={setPreviewExercise}
                            />
                            {canJoinNextToGroup ? (
                              <div className="flex justify-center opacity-80 transition-opacity group-hover/combo:opacity-100">
                                <button
                                  type="button"
                                  onClick={() => joinExerciseToGroup(nextBlock.index, block.group.draftId)}
                                  className="rounded-full border border-dashed border-brand-primary/20 bg-white/70 px-3 py-1 text-xs font-semibold text-brand-primary/80 transition-colors hover:border-brand-primary/40 hover:bg-brand-primary/5 hover:text-brand-primary"
                                >
                                  + добавить в комбо
                                </button>
                              </div>
                            ) : null}
                          </div>
                        );
                      }

                      return (
                        <div key={block.exercise.draftId} className="space-y-2">
                          <WorkoutExerciseCard
                            exercise={block.exercise}
                            index={block.index}
                            exerciseLibrary={exerciseLibrary}
                            onSearchChange={(query) => updateExerciseSearch(block.index, query)}
                            onSelect={(exerciseId) => selectLibraryExercise(block.index, exerciseId)}
                            onUpdate={(field, value) => updateExercise(block.index, field, value)}
                            onDuplicate={() => duplicateExercise(block.index)}
                            onInsertBelow={() => insertExerciseAfter(block.index)}
                            onMove={(direction) => moveExercise(block.index, direction)}
                            onRemove={() => removeExercise(block.index)}
                            onPreviewVideo={setPreviewExercise}
                          />
                          {canGroupWithNext ? (
                            <div className="flex justify-center opacity-70 transition-opacity hover:opacity-100 focus-within:opacity-100">
                              <button
                                type="button"
                                onClick={() => groupAdjacentExercises(block.index)}
                                className="rounded-full border border-dashed border-brand-primary/20 bg-white/80 px-3 py-1 text-xs font-semibold text-brand-primary/80 transition-colors hover:border-brand-primary/40 hover:bg-brand-primary/5 hover:text-brand-primary"
                              >
                                + объединить в комбо
                              </button>
                            </div>
                          ) : null}
                          {canJoinCurrentToNextGroup ? (
                            <div className="flex justify-center opacity-70 transition-opacity hover:opacity-100 focus-within:opacity-100">
                              <button
                                type="button"
                                onClick={() => joinExerciseToGroup(block.index, nextBlock.group.draftId)}
                                className="rounded-full border border-dashed border-brand-primary/20 bg-white/80 px-3 py-1 text-xs font-semibold text-brand-primary/80 transition-colors hover:border-brand-primary/40 hover:bg-brand-primary/5 hover:text-brand-primary"
                              >
                                + добавить в комбо
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
              <button
                type="button"
                onClick={() =>
                  setEditing({
                    ...editing,
                    exercises: [...editing.exercises, emptyExercise()],
                  })
                }
                className="w-full rounded-2xl bg-brand-primary px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-brand-primary/20 transition-colors hover:bg-brand-primary/90"
              >
                + Добавить упражнение
              </button>
            </div>

            <label className="mt-4 block space-y-1 text-sm">
              <span className="text-slate-500">Комментарий тренера</span>
              <textarea
                value={editing.coachComment}
                onChange={(e) => setEditing({ ...editing, coachComment: e.target.value })}
                className="min-h-20 w-full rounded-2xl border border-slate-200 px-3 py-2 text-slate-950 outline-none focus:border-brand-primary"
                placeholder="Что важно учесть на тренировке"
              />
            </label>

            {error ? (
              <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            ) : null}

            <div className="sticky bottom-0 -mx-4 mt-4 flex flex-col-reverse gap-2 border-t border-slate-100 bg-white/95 px-4 pt-3 backdrop-blur sm:-mx-5 sm:flex-row sm:justify-end sm:px-5">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={saveWorkout}
                disabled={saving}
                className="rounded-full bg-brand-primary px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Сохраняем..." : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {previewExercise ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 px-3 py-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPreviewExercise(null);
          }}
        >
          <div
            className="w-full max-w-3xl overflow-hidden rounded-3xl bg-white text-slate-950 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Видео упражнения</p>
                <h3 className="truncate text-base font-semibold">{previewExercise.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewExercise(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                aria-label="Закрыть видео"
              >
                ×
              </button>
            </div>
            <div className="aspect-video bg-slate-950">
              <iframe
                src={previewExercise.videoUrl}
                title={previewExercise.title}
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                className="h-full w-full"
              />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
