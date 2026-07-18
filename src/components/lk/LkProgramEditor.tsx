"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { LkExerciseEditorModal } from "@/components/lk/LkExerciseEditorModal";
import { useLkUnsavedChanges, UNSAVED_CHANGES_CONFIRM_MESSAGE } from "@/components/lk/LkUnsavedChangesContext";
import { WorkoutSelectionBar } from "@/components/lk/WorkoutSelectionBar";
import { ClipboardNotification } from "@/components/lk/workout-editor/ClipboardNotification";
import { ExerciseLibrarySearchInput } from "@/components/lk/workout-editor/ExerciseLibrarySearchInput";
import {
  clearWorkoutClipboard,
  copyWorkoutClipboard,
  useWorkoutClipboard,
  type WorkoutClipboard,
  type WorkoutClipboardSource,
} from "@/components/lk/workout-editor/workoutClipboard";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ExerciseLibraryItem } from "@/lib/supabase/exerciseLibrary";
import type { ProgramTemplate, ProgramTemplateWorkout } from "@/lib/supabase/programTemplates";

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
  sortOrder: number;
};

type DraftGroup = {
  id?: string;
  draftId: string;
  title: string;
  sets: string;
  rest: string;
  notes: string;
  sortOrder: number;
};

type DraftWorkout = {
  draftId: string;
  id?: string;
  dayNumber: number;
  weekNumber: number;
  title: string;
  summary: string;
  estimatedMinutes: string;
  workoutType: string;
  sortOrder: number;
  groups: DraftGroup[];
  exercises: DraftExercise[];
};

type Props = {
  program: ProgramTemplate;
  exerciseLibrary: ExerciseLibraryItem[];
};

function createDraftId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function workoutToDraft(workout: ProgramTemplateWorkout): DraftWorkout {
  return {
    draftId: workout.id || createDraftId(),
    id: workout.id,
    dayNumber: workout.dayNumber,
    weekNumber: workout.weekNumber,
    title: workout.title,
    summary: workout.summary || "",
    estimatedMinutes: workout.estimatedMinutes ? String(workout.estimatedMinutes) : "",
    workoutType: workout.workoutType || "",
    sortOrder: workout.sortOrder,
    groups: workout.groups.map((group) => ({
      id: group.id,
      draftId: group.id,
      title: group.title,
      sets: group.sets || "",
      rest: group.rest || "",
      notes: group.notes || "",
      sortOrder: group.sortOrder,
    })),
    exercises: workout.exercises.map((exercise) => ({
      id: exercise.id,
      draftId: exercise.id || createDraftId(),
      groupDraftId: exercise.groupId,
      exerciseId: exercise.exerciseId || "",
      exerciseTitle: exercise.title,
      sets: exercise.sets || "",
      reps: exercise.reps || "",
      rest: exercise.rest || "",
      tempo: exercise.tempo || "",
      notes: exercise.notes || "",
      sortOrder: exercise.sortOrder,
    })),
  };
}

function emptyWorkout(index: number): DraftWorkout {
  const dayNumber = index + 1;
  return {
    draftId: createDraftId(),
    dayNumber,
    weekNumber: Math.ceil(dayNumber / 7),
    title: `Day ${dayNumber}`,
    summary: "",
    estimatedMinutes: "",
    workoutType: "",
    sortOrder: index,
    groups: [],
    exercises: [],
  };
}

function emptyExercise(sortOrder: number): DraftExercise {
  return {
    draftId: createDraftId(),
    exerciseId: "",
    exerciseTitle: "",
    sets: "",
    reps: "",
    rest: "",
    tempo: "",
    notes: "",
    sortOrder,
  };
}

function isFullyEmptyExercise(ex: DraftExercise): boolean {
  return (
    !ex.exerciseId &&
    !ex.exerciseTitle.trim() &&
    !ex.sets.trim() &&
    !ex.reps.trim() &&
    !ex.rest.trim() &&
    !ex.tempo.trim() &&
    !ex.notes.trim()
  );
}

function seedEmptyDayDraft(workout: DraftWorkout): DraftWorkout {
  const next = cloneWorkoutDraft(workout);
  if (next.exercises.length === 0) {
    next.exercises = [emptyExercise(0)];
  }
  return next;
}

const INLINE_METRIC_INPUT_CLASS =
  "min-w-0 border-0 bg-transparent p-0 text-[13px] leading-5 text-slate-700 shadow-none outline-none focus:border-transparent focus:outline-none focus:ring-0 placeholder:text-slate-400";
const INLINE_REPS_METRIC_CLASS = `${INLINE_METRIC_INPUT_CLASS} block w-full max-h-20 resize-none overflow-y-auto whitespace-pre-wrap break-words`;
const EMPTY_METRIC_FIELD_CLASS =
  "flex h-8 min-w-0 w-full items-center rounded-md border border-[#E6EBF1] bg-[#FAFBFC] px-2 transition-colors focus-within:border-emerald-200 focus-within:bg-white focus-within:ring-2 focus-within:ring-emerald-100";
const EMPTY_METRIC_INPUT_CLASS =
  "h-full w-full min-w-0 border-0 bg-transparent p-0 text-center text-[12px] font-medium leading-8 text-slate-600 shadow-none outline-none focus:border-transparent focus:outline-none focus:ring-0 placeholder:text-[10px] placeholder:font-semibold placeholder:tracking-[0.05em] placeholder:text-slate-400";
const REPS_METRIC_MAX_HEIGHT = 80;

function cloneWorkout(workout: DraftWorkout, index: number): DraftWorkout {
  const groupIdMap = new Map<string, string>();
  const groups = workout.groups.map((group) => {
    const draftId = createDraftId();
    groupIdMap.set(group.draftId, draftId);
    return { ...group, id: undefined, draftId };
  });
  return {
    ...workout,
    draftId: createDraftId(),
    id: undefined,
    dayNumber: index + 1,
    weekNumber: Math.ceil((index + 1) / 7),
    sortOrder: index,
    groups,
    exercises: workout.exercises.map((exercise) => ({
      ...exercise,
      id: undefined,
      draftId: createDraftId(),
      groupDraftId: exercise.groupDraftId ? groupIdMap.get(exercise.groupDraftId) : undefined,
    })),
  };
}

function cloneWorkoutDraft(workout: DraftWorkout): DraftWorkout {
  return {
    ...workout,
    groups: workout.groups.map((group) => ({ ...group })),
    exercises: workout.exercises.map((exercise) => ({ ...exercise })),
  };
}

function draftWorkoutToClipboard(workout: DraftWorkout, source: WorkoutClipboardSource = "program"): WorkoutClipboard {
  return {
    version: 1,
    source,
    workout: {
      title: workout.title,
      summary: workout.summary,
      coachComment: "",
      estimatedMinutes: workout.estimatedMinutes,
      workoutType: workout.workoutType,
      groups: workout.groups.map((group) => ({
        clipboardGroupId: group.draftId,
        title: group.title,
        sets: group.sets,
        rest: group.rest,
        notes: group.notes,
        sortOrder: group.sortOrder,
      })),
      exercises: workout.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        groupClipboardId: exercise.groupDraftId,
        exerciseTitle: exercise.exerciseTitle,
        sets: exercise.sets,
        reps: exercise.reps,
        rest: exercise.rest,
        tempo: exercise.tempo,
        notes: exercise.notes,
        sortOrder: exercise.sortOrder,
      })),
    },
  };
}

function clipboardToDraftWorkout(clipboard: WorkoutClipboard, index: number): DraftWorkout {
  const groupIdMap = new Map<string, string>();
  const groups = clipboard.workout.groups.map((group) => {
    const draftId = createDraftId();
    groupIdMap.set(group.clipboardGroupId, draftId);
    return {
      draftId,
      title: group.title,
      sets: group.sets,
      rest: group.rest,
      notes: group.notes,
      sortOrder: group.sortOrder,
    };
  });

  return {
    draftId: createDraftId(),
    dayNumber: index + 1,
    weekNumber: Math.ceil((index + 1) / 7),
    title: clipboard.workout.title,
    summary: clipboard.workout.summary || clipboard.workout.coachComment,
    estimatedMinutes: clipboard.workout.estimatedMinutes,
    workoutType: clipboard.workout.workoutType,
    sortOrder: index,
    groups,
    exercises: clipboard.workout.exercises.map((exercise) => ({
      draftId: createDraftId(),
      groupDraftId: exercise.groupClipboardId ? groupIdMap.get(exercise.groupClipboardId) : undefined,
      exerciseId: exercise.exerciseId,
      exerciseTitle: exercise.exerciseTitle,
      sets: exercise.sets,
      reps: exercise.reps,
      rest: exercise.rest,
      tempo: exercise.tempo,
      notes: exercise.notes,
      sortOrder: exercise.sortOrder,
    })),
  };
}

type WorkoutPreviewLine = {
  prefix?: string;
  title: string;
};

type PreviewExercise = {
  title: string;
  videoUrl: string;
};

type ClipboardMode = "copy" | "move" | null;
type ActiveMetric = "sets" | "reps" | "rest" | null;

/** Tailwind col-span для раскрытой карточки — менять после скрина. */
const EXPANDED_WORKOUT_CARD_COL_SPAN = "col-span-2 xl:col-span-2";

function ExerciseVideoPreviewModal({ exercise, onClose }: { exercise: PreviewExercise; onClose: () => void }) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-3 py-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-[min(90vw,720px)] max-w-[720px] overflow-hidden rounded-2xl bg-white text-slate-950 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Видео упражнения</p>
            <h3 className="truncate text-base font-semibold">{exercise.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Закрыть видео"
          >
            ×
          </button>
        </div>
        <div className="flex max-h-[80vh] items-center justify-center bg-slate-950">
          <iframe
            src={exercise.videoUrl}
            title={exercise.title}
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            className="aspect-video max-h-[80vh] w-full"
          />
        </div>
      </div>
    </div>,
    document.body
  );
}

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function computeProgramMetrics(workoutCount: number) {
  const count = Math.max(0, workoutCount);
  return {
    durationDays: count || 1,
    weeksCount: Math.max(1, Math.ceil(count / 7)),
  };
}

function serializeProgramDraft(params: {
  title: string;
  description: string;
  level: string;
  goal: string;
  tags: string;
  workouts: DraftWorkout[];
}) {
  const normalizedWorkouts = params.workouts.map((workout, index) => ({
    id: workout.id ?? null,
    sortOrder: index,
    dayNumber: index + 1,
    weekNumber: Math.ceil((index + 1) / 7),
    title: workout.title.trim(),
    summary: workout.summary.trim(),
    estimatedMinutes: workout.estimatedMinutes.trim(),
    workoutType: workout.workoutType.trim(),
    groups: workout.groups.map((group, groupIndex) => ({
      sortOrder: groupIndex,
      title: group.title.trim(),
      sets: group.sets.trim(),
      rest: group.rest.trim(),
      notes: group.notes.trim(),
    })),
    exercises: workout.exercises.map((exercise, exerciseIndex) => ({
      sortOrder: exerciseIndex,
      groupIndex: exercise.groupDraftId
        ? workout.groups.findIndex((group) => group.draftId === exercise.groupDraftId)
        : -1,
      exerciseId: exercise.exerciseId.trim(),
      exerciseTitle: exercise.exerciseTitle.trim(),
      sets: exercise.sets.trim(),
      reps: exercise.reps.trim(),
      rest: exercise.rest.trim(),
      tempo: exercise.tempo.trim(),
      notes: exercise.notes.trim(),
    })),
  }));

  return JSON.stringify({
    title: params.title.trim(),
    description: params.description.trim(),
    level: params.level.trim(),
    goal: params.goal.trim(),
    tags: params.tags.trim(),
    workouts: normalizedWorkouts,
  });
}

function mapCoachApiError(error: string | undefined, status: number, fallback: string) {
  if (status === 401 || error === "unauthorized") return "Сессия истекла. Войдите снова.";
  if (status === 403 || error === "forbidden") return "Нет доступа к этой программе.";
  if (status === 404 || error === "not_found") return "Программа не найдена.";
  if (status === 409 || error === "stale") return "Программа была изменена в другом окне. Обновите страницу.";
  return error?.trim() || fallback;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isTransientSaveStatus(status: number) {
  return status === 502 || status === 503 || status === 504;
}

async function saveProgramFetchWithRetry(url: string, init: RequestInit) {
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (!isTransientSaveStatus(response.status) || attempt === maxAttempts) {
        if (isTransientSaveStatus(response.status) && attempt === maxAttempts) {
          throw new Error("Не удалось сохранить из-за временной ошибки сети. Попробуйте ещё раз.");
        }
        return response;
      }
      if (process.env.NODE_ENV === "development") {
        console.warn("[LkProgramEditor] retrying transient save response", { attempt, status: response.status });
      }
    } catch (error) {
      if (attempt === maxAttempts) {
        if (error instanceof Error && error.message.includes("временной ошибки сети")) throw error;
        throw new Error("Не удалось сохранить из-за временной ошибки сети. Попробуйте ещё раз.");
      }
      if (process.env.NODE_ENV === "development") {
        console.warn("[LkProgramEditor] retrying failed save fetch", {
          attempt,
          message: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    await delay(500);
  }
  throw new Error("Не удалось сохранить из-за временной ошибки сети. Попробуйте ещё раз.");
}

function buildWorkoutPreviewLines(workout: DraftWorkout, maxLines = 8) {
  const lines: WorkoutPreviewLine[] = [];

  for (const exercise of workout.exercises) {
    const title = exercise.exerciseTitle.trim();
    if (!title) continue;

    const letter = String.fromCharCode(65 + lines.length);
    lines.push({ prefix: `${letter})`, title });
  }

  if (lines.length === 0 && workout.summary.trim()) {
    lines.push({ title: workout.summary.trim() });
  }

  const hiddenCount = Math.max(0, lines.length - maxLines);
  return { lines: lines.slice(0, maxLines), hiddenCount };
}

function workoutCardMinHeight(workout: DraftWorkout) {
  const lineCount = buildWorkoutPreviewLines(workout).lines.length;
  if (lineCount >= 6) return "min-h-52";
  if (lineCount >= 4) return "min-h-44";
  if (lineCount >= 2) return "min-h-36";
  return "min-h-28";
}

function groupByWeek(workouts: DraftWorkout[]) {
  const map = new Map<number, DraftWorkout[]>();
  for (const workout of workouts) {
    const list = map.get(workout.weekNumber) || [];
    list.push(workout);
    map.set(workout.weekNumber, list);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([week, items]) => [week, items.sort((a, b) => a.sortOrder - b.sortOrder)] as const);
}

function WeekDayTimeline({
  workouts,
  editingId,
}: {
  workouts: DraftWorkout[];
  editingId: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1 text-xs" aria-hidden="true">
      {workouts.map((workout, index) => (
        <span key={workout.draftId} className="inline-flex items-center gap-1">
          {index > 0 ? <span className="text-slate-300">—</span> : null}
          <span
            className={`rounded-full border px-2.5 py-1 font-medium ${
              editingId === workout.draftId
                ? "border-emerald-300 bg-emerald-50 font-semibold text-emerald-800"
                : "border-slate-200 bg-slate-50 text-slate-600"
            }`}
          >
            День {workout.dayNumber}
          </span>
        </span>
      ))}
    </div>
  );
}

function WorkoutDropSlot({ position }: { position: "before" | "after" }) {
  return (
    <div
      className={`pointer-events-none flex justify-center ${position === "before" ? "mb-2 -mt-1" : "mt-3"}`}
      aria-hidden="true"
    >
      <div className="h-2 w-2/3 rounded-full border border-dashed border-emerald-300 bg-emerald-50/70 shadow-[0_0_0_3px_rgba(16,185,129,0.06)]" />
    </div>
  );
}

function ComboGroupInstructions({
  group,
  onUpdateTitle,
  onUpdate,
  onUngroup,
}: {
  group: DraftGroup;
  onUpdateTitle: (title: string) => void;
  onUpdate: (patch: Partial<DraftGroup>) => void;
  onUngroup: () => void;
}) {
  const [notesFocused, setNotesFocused] = useState(false);
  const notesTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const showNotes = notesFocused || Boolean(group.notes.trim());
  const normalizedTitle = group.title.trim().toLowerCase();
  const hasCustomTitle = normalizedTitle !== "" && normalizedTitle !== "комбо" && normalizedTitle !== "combo";
  const inputClass =
    "h-8 w-full rounded-md border border-slate-200/80 bg-white px-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-emerald-300 focus:ring-0";
  const labelClass = "mb-0.5 block text-xs font-medium text-slate-500";

  function openAndFocusNotes() {
    setNotesFocused(true);
    requestAnimationFrame(() => {
      notesTextareaRef.current?.focus();
    });
  }

  return (
    <div className="mb-1 ml-3 space-y-1 rounded-xl border border-emerald-200/70 bg-emerald-50/25 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2 border-b border-emerald-200/70 pb-1">
        <span className="shrink-0 rounded-full bg-emerald-100/80 px-1.5 py-px text-[10px] font-semibold text-emerald-700">
          КОМБО
        </span>
        {hasCustomTitle ? (
          <input
            value={group.title}
            onChange={(event) => onUpdateTitle(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            className="min-w-0 flex-1 border-0 bg-transparent px-0 text-[11px] font-medium text-slate-600 outline-none placeholder:text-slate-400 focus:ring-0"
          />
        ) : (
          <span className="min-w-0 flex-1" aria-hidden="true" />
        )}
        <button
          type="button"
          onClick={onUngroup}
          className="rounded-full px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/70 hover:text-slate-600"
        >
          Разъединить
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="min-w-0">
          <span className={labelClass}>Подходы</span>
          <input
            value={group.sets}
            onChange={(event) => onUpdate({ sets: event.target.value })}
            onKeyDown={(event) => event.stopPropagation()}
            className={inputClass}
            placeholder="3 подхода"
          />
        </label>
        <label className="min-w-0">
          <span className={labelClass}>Отдых</span>
          <input
            value={group.rest}
            onChange={(event) => onUpdate({ rest: event.target.value })}
            onKeyDown={(event) => event.stopPropagation()}
            className={inputClass}
            placeholder="30 сек"
          />
        </label>
      </div>
      {showNotes ? (
        <label className="block">
          <span className={labelClass}>Заметка</span>
          <textarea
            ref={notesTextareaRef}
            value={group.notes}
            onChange={(event) => onUpdate({ notes: event.target.value })}
            onFocus={() => setNotesFocused(true)}
            onBlur={() => setNotesFocused(false)}
            onKeyDown={(event) => event.stopPropagation()}
            className="block h-8 w-full resize-none rounded-md border border-slate-200/80 bg-white px-2 py-1.5 text-sm leading-5 text-slate-800 outline-none placeholder:text-slate-400 focus:h-16 focus:border-emerald-300 focus:ring-0"
            placeholder="Комментарий к комбо"
          />
        </label>
      ) : (
        <button
          type="button"
          onClick={openAndFocusNotes}
          className="py-0.5 text-left text-xs text-slate-400 hover:text-slate-600"
        >
          Добавить заметку
        </button>
      )}
    </div>
  );
}

function SortableWorkoutCard({
  workout,
  weekWorkouts,
  isOpen,
  isLastInProgram,
  isWorkoutDragActive,
  dropSlotPosition,
  selected,
  onOpen,
  onInsertAfter,
  onCopy,
  onPasteAfter,
  onToggleSelect,
  canPaste,
  recentlyAdded,
  exerciseLibrary,
  onCollapse,
  onApplyDay,
  onExerciseLibraryChanged,
  onDirtyChange,
  expandedScrollRef,
}: {
  workout: DraftWorkout;
  weekWorkouts: DraftWorkout[];
  isOpen: boolean;
  isLastInProgram: boolean;
  isWorkoutDragActive: boolean;
  dropSlotPosition: "before" | "after" | null;
  selected: boolean;
  recentlyAdded: boolean;
  onOpen: () => void;
  onInsertAfter: () => void;
  onCopy: () => void;
  onPasteAfter: () => void;
  onToggleSelect: (draftId: string, weekItems: DraftWorkout[], options: { shiftKey?: boolean }) => void;
  canPaste: boolean;
  exerciseLibrary: ExerciseLibraryItem[];
  onCollapse: () => void;
  onApplyDay: (workout: DraftWorkout) => void;
  onExerciseLibraryChanged: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  expandedScrollRef?: RefObject<HTMLElement | null>;
}) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id: workout.draftId,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const preview = buildWorkoutPreviewLines(workout);
  const isLastInWeek = weekWorkouts[weekWorkouts.length - 1]?.draftId === workout.draftId;
  const dragMotionClass = isDragging
    ? "relative z-30 opacity-90 shadow-md"
    : isWorkoutDragActive
    ? ""
    : "hover:z-40 hover:-translate-y-px hover:shadow-lg";
  const cardControlClass =
    "flex h-7 w-7 items-center justify-center rounded-xl border border-slate-200 bg-white/80 text-slate-400 opacity-100 transition-all duration-150 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-700";

  function handleCardClick(event: MouseEvent<HTMLButtonElement>) {
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      onToggleSelect(workout.draftId, weekWorkouts, { shiftKey: event.shiftKey });
      return;
    }
    onOpen();
  }

  return (
    <article
      ref={(node) => {
        setNodeRef(node);
        if (expandedScrollRef && isOpen) {
          expandedScrollRef.current = node;
        }
      }}
      style={style}
      className={`group relative flex flex-col rounded-3xl border p-3 shadow-sm transition-all focus-within:z-40 ${dragMotionClass} ${
        isOpen ? `min-h-0 ${EXPANDED_WORKOUT_CARD_COL_SPAN}` : workoutCardMinHeight(workout)
      } ${
        isOpen
          ? "border-emerald-500/35 bg-[#FAF8FC] shadow-[0_2px_12px_rgba(15,23,42,0.05)]"
          : selected
          ? "border-emerald-300 bg-emerald-50/45 ring-2 ring-emerald-100"
          : "border-slate-200 bg-white"
      } ${recentlyAdded && !isOpen ? "border-emerald-400 bg-emerald-50/70 ring-2 ring-emerald-200" : ""} ${
        canPaste ? "ring-1 ring-emerald-100" : ""
      }`}
    >
      {dropSlotPosition === "before" ? <WorkoutDropSlot position="before" /> : null}

      {!isWorkoutDragActive && !isOpen && !isLastInWeek && !isLastInProgram ? (
        <div className="absolute right-0 top-1/2 z-50 flex h-12 w-10 -translate-y-1/2 translate-x-[calc(50%+0.375rem)] items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onInsertAfter();
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className="flex h-7 w-7 scale-95 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-semibold leading-none text-slate-400 shadow-sm transition-all duration-150 group-hover:scale-100 hover:border-emerald-300 hover:bg-white hover:text-emerald-600"
            aria-label={`Добавить тренировку после ${workout.title}`}
          >
            +
          </button>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onCopy();
          }}
          className={cardControlClass}
          title="Скопировать тренировку"
          aria-label={`Скопировать ${workout.title}`}
        >
          ⧉
        </button>
        <button
          type="button"
          ref={setActivatorNodeRef}
          className={`${cardControlClass} cursor-grab active:cursor-grabbing`}
          aria-label="Перетащить день"
          {...attributes}
          {...listeners}
        >
          ☰
        </button>
        <button type="button" onClick={handleCardClick} className="min-w-0 flex-1 text-left">
          <p className="truncate text-xs font-semibold text-slate-400">Day {workout.dayNumber}</p>
        </button>
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={selected ? `Снять выбор ${workout.title}` : `Выбрать ${workout.title}`}
          title={selected ? "Снять выбор" : "Выбрать тренировку"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelect(workout.draftId, weekWorkouts, { shiftKey: event.shiftKey });
          }}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border text-[11px] font-bold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${
            selected
              ? "border-emerald-300 bg-emerald-500 text-white shadow-sm shadow-emerald-200"
              : "border-slate-200 bg-white/80 text-transparent hover:border-slate-300 hover:bg-slate-100"
          }`}
        >
          ✓
        </button>
      </div>

      {isOpen ? (
        <div
          className="mt-2 min-h-0 flex-1"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {isDragging ? (
            <div className="min-h-32 rounded-2xl border border-slate-200 bg-white/80 p-3">
              <h3 className="line-clamp-1 text-sm font-semibold text-slate-900">{workout.title}</h3>
              <p className="mt-1 text-xs text-slate-500">
                {workout.exercises.filter((exercise) => !isFullyEmptyExercise(exercise)).length || 0} упражнений
              </p>
              <p className="mt-3 text-xs text-slate-400">Перетаскиваем тренировку...</p>
            </div>
          ) : null}
          <div className={isDragging ? "hidden" : ""}>
            <WorkoutDayDraftEditor
              key={workout.draftId}
              workout={workout}
              exerciseLibrary={exerciseLibrary}
              onCollapse={onCollapse}
              onApplyDay={onApplyDay}
              onExerciseLibraryChanged={onExerciseLibraryChanged}
              onDirtyChange={onDirtyChange}
            />
          </div>
        </div>
      ) : (
        <button type="button" onClick={handleCardClick} className="mt-2 min-h-0 flex-1 text-left">
          <h3 className="line-clamp-1 text-base font-semibold text-slate-950">{workout.title}</h3>
          <div className="mt-2 min-h-[4.5rem]">
            {preview.lines.length > 0 ? (
              <ul className="space-y-0.5 text-xs leading-5 text-slate-600">
                {preview.lines.map((line, index) => (
                  <li key={`${workout.draftId}-${index}`} className="flex min-w-0 gap-1">
                    {line.prefix ? <span className="shrink-0 font-medium text-slate-400">{line.prefix}</span> : null}
                    <span className="truncate">{line.title}</span>
                  </li>
                ))}
                {preview.hiddenCount > 0 ? (
                  <li className="text-slate-400">+{preview.hiddenCount} ещё</li>
                ) : null}
              </ul>
            ) : (
              <p className="text-xs text-slate-400">Пустой день</p>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-500">{workout.exercises.length} упр.</span>
          </div>
        </button>
      )}

      {!isWorkoutDragActive && !isOpen && isLastInWeek && !isLastInProgram ? (
        <div className="mt-3 flex justify-center opacity-80 transition-opacity duration-150 group-hover:opacity-100">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onInsertAfter();
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-emerald-200 bg-emerald-50/40 px-3 py-1.5 text-xs font-semibold text-emerald-600 transition-colors hover:bg-emerald-50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
            aria-label={`Добавить день после ${workout.title}`}
          >
            <span className="text-sm leading-none">+</span>
            <span>день</span>
          </button>
        </div>
      ) : null}

      {dropSlotPosition === "after" ? <WorkoutDropSlot position="after" /> : null}

      {canPaste && !isWorkoutDragActive ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPasteAfter();
          }}
          className="mt-3 rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/80 px-3 py-2 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
        >
          Вставить после
        </button>
      ) : null}
    </article>
  );
}

export function LkProgramEditor({ program, exerciseLibrary }: Props) {
  const router = useRouter();
  const unsavedChanges = useLkUnsavedChanges();
  const isReadOnly = !program.canEdit;
  const [title, setTitle] = useState(program.title);
  const [description] = useState(program.description || "");
  const [level] = useState(program.level || "");
  const [goal] = useState(program.goal || "");
  const [tags] = useState(program.tags.join(", "));
  const [workouts, setWorkouts] = useState<DraftWorkout[]>((program.workouts || []).map(workoutToDraft));
  const savedUpdatedAtRef = useRef(program.updatedAt || "");
  const initialSnapshot = useRef(
    serializeProgramDraft({
      title: program.title,
      description: program.description || "",
      level: program.level || "",
      goal: program.goal || "",
      tags: program.tags.join(", "),
      workouts: (program.workouts || []).map(workoutToDraft),
    })
  );
  const [editingId, setEditingId] = useState("");
  const [workoutDraftDirty, setWorkoutDraftDirty] = useState(false);
  const expandedCardRef = useRef<HTMLElement | null>(null);
  const [selectedWorkoutIds, setSelectedWorkoutIds] = useState<string[]>([]);
  const lastSelectedWorkoutIdRef = useRef("");
  const copiedWorkout = useWorkoutClipboard();
  const clipboardMode: ClipboardMode = copiedWorkout ? "copy" : null;
  const [recentlyAddedWorkoutIds, setRecentlyAddedWorkoutIds] = useState<string[]>([]);
  const recentlyAddedTimerRef = useRef<number | null>(null);
  const pendingRecentlyAddedIdsRef = useRef<string[]>([]);
  const emptyWorkoutCleanupIdsRef = useRef<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [clipboardNotification, setClipboardNotification] = useState("");
  const successTimerRef = useRef<number | null>(null);
  const clipboardNotificationTimerRef = useRef<number | null>(null);
  const [activeWorkoutDragId, setActiveWorkoutDragId] = useState("");
  const [overWorkoutDragId, setOverWorkoutDragId] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const sortedWorkouts = useMemo(
    () => workouts.map((workout, index) => ({ ...workout, sortOrder: index })).sort((a, b) => a.sortOrder - b.sortOrder),
    [workouts]
  );
  const weeks = useMemo(() => groupByWeek(sortedWorkouts), [sortedWorkouts]);
  const lastProgramWorkoutId = sortedWorkouts[sortedWorkouts.length - 1]?.draftId || "";
  const programMetrics = useMemo(() => computeProgramMetrics(sortedWorkouts.length), [sortedWorkouts.length]);
  const isWorkoutDragActive = Boolean(activeWorkoutDragId);
  const currentSnapshot = useMemo(
    () => serializeProgramDraft({ title, description, level, goal, tags, workouts: sortedWorkouts }),
    [title, description, level, goal, tags, sortedWorkouts]
  );
  const isDirty = currentSnapshot !== initialSnapshot.current;

  function confirmDiscardChanges() {
    if (!isDirty) return true;
    return window.confirm(UNSAVED_CHANGES_CONFIRM_MESSAGE);
  }

  function updateSavedSnapshot(nextWorkouts = sortedWorkouts, nextProgram?: ProgramTemplate) {
    initialSnapshot.current = serializeProgramDraft({
      title: nextProgram ? nextProgram.title : title,
      description: nextProgram ? nextProgram.description || "" : description,
      level: nextProgram ? nextProgram.level || "" : level,
      goal: nextProgram ? nextProgram.goal || "" : goal,
      tags: nextProgram ? nextProgram.tags.join(", ") : tags,
      workouts: nextWorkouts,
    });
    unsavedChanges?.setIsDirty(false);
  }

  useEffect(() => {
    unsavedChanges?.setIsDirty(isDirty);
  }, [isDirty, unsavedChanges]);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  useEffect(() => {
    return () => {
      if (recentlyAddedTimerRef.current) window.clearTimeout(recentlyAddedTimerRef.current);
      if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
      if (clipboardNotificationTimerRef.current) window.clearTimeout(clipboardNotificationTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isDirty || !success) return;
    if (successTimerRef.current) {
      window.clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
    setSuccess("");
  }, [isDirty, success]);

  useEffect(() => {
    if (pendingRecentlyAddedIdsRef.current.length === 0) return;
    markRecentlyAdded(pendingRecentlyAddedIdsRef.current);
    pendingRecentlyAddedIdsRef.current = [];
  }, [workouts]);

  useEffect(() => {
    setError("");
  }, [title, description, level, goal, tags, workouts, editingId]);

  function showTemporarySuccess(message: string, timeoutMs = 3000) {
    setSuccess(message);
    if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
    successTimerRef.current = window.setTimeout(() => {
      setSuccess("");
      successTimerRef.current = null;
    }, timeoutMs);
  }

  function showClipboardNotification(message: string, timeoutMs = 2000) {
    setClipboardNotification(message);
    if (clipboardNotificationTimerRef.current) window.clearTimeout(clipboardNotificationTimerRef.current);
    clipboardNotificationTimerRef.current = window.setTimeout(() => {
      setClipboardNotification("");
      clipboardNotificationTimerRef.current = null;
    }, timeoutMs);
  }

  useEffect(() => {
    if (!editingId) return;
    const frame = requestAnimationFrame(() => {
      expandedCardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [editingId]);

  function requestOpenWorkout(draftId: string) {
    if (draftId === editingId) return;
    if (workoutDraftDirty) {
      const ok = window.confirm("Изменения в тренировке не будут сохранены. Перейти к другому дню?");
      if (!ok) return;
    }
    cleanupEmptyNewWorkouts();
    setEditingId(draftId);
    setWorkoutDraftDirty(false);
  }

  function collapseWorkoutEditor() {
    cleanupEmptyNewWorkouts();
    setEditingId("");
    setWorkoutDraftDirty(false);
  }

  function normalizeTimeline(nextWorkouts: DraftWorkout[]) {
    return nextWorkouts.map((workout, index) => ({
      ...workout,
      sortOrder: index,
      dayNumber: index + 1,
      weekNumber: Math.ceil((index + 1) / 7),
    }));
  }

  function applyWorkoutAndCleanup(draftId: string, draftWorkout: DraftWorkout) {
    setWorkouts((current) => {
      const next = current.map((workout) => (workout.draftId === draftId ? { ...workout, ...draftWorkout } : workout));
      return removeEmptyNewWorkoutsFromList(next).workouts;
    });
  }

  function isNewWorkoutFullyEmpty(workout: DraftWorkout) {
    const title = workout.title.trim();
    const hasDefaultTitle = !title || title === `Day ${workout.dayNumber}`;
    const hasRealExercise = workout.exercises.some((exercise) => !isFullyEmptyExercise(exercise));
    return (
      hasDefaultTitle &&
      !workout.summary.trim() &&
      !workout.estimatedMinutes.trim() &&
      !workout.workoutType.trim() &&
      !hasRealExercise
    );
  }

  function removeEmptyNewWorkoutsFromList(nextWorkouts: DraftWorkout[]) {
    if (emptyWorkoutCleanupIdsRef.current.size === 0) return { workouts: nextWorkouts, removedIds: [] as string[] };
    const removedIds: string[] = [];
    const filtered = nextWorkouts.filter((workout) => {
      if (!emptyWorkoutCleanupIdsRef.current.has(workout.draftId)) return true;
      if (!isNewWorkoutFullyEmpty(workout)) return true;
      removedIds.push(workout.draftId);
      return false;
    });
    if (removedIds.length === 0) return { workouts: nextWorkouts, removedIds };
    removedIds.forEach((id) => emptyWorkoutCleanupIdsRef.current.delete(id));
    return { workouts: normalizeTimeline(filtered), removedIds };
  }

  function cleanupEmptyNewWorkouts() {
    setWorkouts((current) => {
      const result = removeEmptyNewWorkoutsFromList(current);
      if (result.removedIds.length === 0) return current;
      setSelectedWorkoutIds((selected) => selected.filter((id) => !result.removedIds.includes(id)));
      return result.workouts;
    });
  }

  function clearSelection() {
    setSelectedWorkoutIds([]);
    lastSelectedWorkoutIdRef.current = "";
  }

  function getSelectedWorkoutsInOrder() {
    const selected = new Set(selectedWorkoutIds);
    return sortedWorkouts.filter((workout) => selected.has(workout.draftId));
  }

  function copyWorkoutsToClipboard(items: DraftWorkout[], mode: Exclude<ClipboardMode, null>) {
    const workout = items[0];
    if (!workout || mode !== "copy") return;
    copyWorkoutClipboard(draftWorkoutToClipboard(workout, "program"));
    showClipboardNotification(`Тренировка «${workout.title}» скопирована`);
  }

  function clearClipboard() {
    clearWorkoutClipboard();
  }

  function markRecentlyAdded(ids: string[]) {
    if (ids.length === 0) return;
    setRecentlyAddedWorkoutIds(ids);
    if (recentlyAddedTimerRef.current) window.clearTimeout(recentlyAddedTimerRef.current);
    recentlyAddedTimerRef.current = window.setTimeout(() => {
      setRecentlyAddedWorkoutIds([]);
      recentlyAddedTimerRef.current = null;
    }, 2200);
  }

  function toggleWorkoutSelection(draftId: string, weekWorkouts: DraftWorkout[], options: { shiftKey?: boolean }) {
    if (options.shiftKey && lastSelectedWorkoutIdRef.current) {
      const weekIds = weekWorkouts.map((workout) => workout.draftId);
      const anchorIndex = weekIds.indexOf(lastSelectedWorkoutIdRef.current);
      const currentIndex = weekIds.indexOf(draftId);
      if (anchorIndex >= 0 && currentIndex >= 0) {
        const start = Math.min(anchorIndex, currentIndex);
        const end = Math.max(anchorIndex, currentIndex);
        const rangeIds = weekIds.slice(start, end + 1);
        setSelectedWorkoutIds((current) => Array.from(new Set([...current, ...rangeIds])));
        lastSelectedWorkoutIdRef.current = draftId;
        return;
      }
    }

    setSelectedWorkoutIds((current) =>
      current.includes(draftId) ? current.filter((id) => id !== draftId) : [...current, draftId]
    );
    lastSelectedWorkoutIdRef.current = draftId;
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setWorkouts((current) => {
      const activeId = String(active.id);
      const overId = String(over.id);
      const selected = new Set(selectedWorkoutIds);
      const isGroupDrag = selectedWorkoutIds.length > 1 && selected.has(activeId);
      const oldIndex = current.findIndex((workout) => workout.draftId === activeId);
      const newIndex = current.findIndex((workout) => workout.draftId === overId);
      if (oldIndex < 0 || newIndex < 0) return current;

      if (isGroupDrag) {
        if (selected.has(overId)) return current;
        const selectedWorkouts = current.filter((workout) => selected.has(workout.draftId));
        const remainingWorkouts = current.filter((workout) => !selected.has(workout.draftId));
        const overIndexInRemaining = remainingWorkouts.findIndex((workout) => workout.draftId === overId);
        if (overIndexInRemaining < 0) return current;
        const insertIndex = oldIndex < newIndex ? overIndexInRemaining + 1 : overIndexInRemaining;
        const next = [...remainingWorkouts];
        next.splice(insertIndex, 0, ...selectedWorkouts);
        return normalizeTimeline(next);
      }

      return normalizeTimeline(arrayMove(current, oldIndex, newIndex));
    });
  }

  function handleWorkoutDragStart(event: DragStartEvent) {
    const activeId = String(event.active.id);
    if (!sortedWorkouts.some((workout) => workout.draftId === activeId)) return;
    setActiveWorkoutDragId(activeId);
    setOverWorkoutDragId(activeId);
  }

  function handleWorkoutDragOver(event: DragOverEvent) {
    if (!activeWorkoutDragId) return;
    const overId = event.over ? String(event.over.id) : "";
    setOverWorkoutDragId(sortedWorkouts.some((workout) => workout.draftId === overId) ? overId : "");
  }

  function clearWorkoutDragVisualState() {
    setActiveWorkoutDragId("");
    setOverWorkoutDragId("");
  }

  function handleWorkoutDragCancel() {
    clearWorkoutDragVisualState();
  }

  function handleWorkoutDragEnd(event: DragEndEvent) {
    handleDragEnd(event);
    clearWorkoutDragVisualState();
  }

  function getWorkoutDropSlotPosition(workout: DraftWorkout): "before" | "after" | null {
    if (!activeWorkoutDragId || !overWorkoutDragId || workout.draftId !== overWorkoutDragId) return null;
    if (activeWorkoutDragId === overWorkoutDragId) return null;
    const activeIndex = sortedWorkouts.findIndex((item) => item.draftId === activeWorkoutDragId);
    const overIndex = sortedWorkouts.findIndex((item) => item.draftId === overWorkoutDragId);
    if (activeIndex < 0 || overIndex < 0) return null;
    return activeIndex < overIndex ? "after" : "before";
  }

  function addWorkout() {
    setWorkouts((current) => {
      const normalized = normalizeTimeline([...current, emptyWorkout(current.length)]);
      const created = normalized[normalized.length - 1];
      setEditingId(created.draftId);
      pendingRecentlyAddedIdsRef.current = [created.draftId];
      emptyWorkoutCleanupIdsRef.current.add(created.draftId);
      return normalized;
    });
  }

  function insertWorkoutAfter(draftId: string) {
    setWorkouts((current) => {
      const index = current.findIndex((workout) => workout.draftId === draftId);
      if (index < 0) return current;
      const insertIndex = index + 1;
      const next = [...current];
      next.splice(insertIndex, 0, emptyWorkout(insertIndex));
      const normalized = normalizeTimeline(next);
      const created = normalized[insertIndex];
      setEditingId(created.draftId);
      pendingRecentlyAddedIdsRef.current = [created.draftId];
      emptyWorkoutCleanupIdsRef.current.add(created.draftId);
      return normalized;
    });
  }

  function duplicateWeek(weekNumber: number) {
    setWorkouts((current) => {
      const source = current.filter((workout) => workout.weekNumber === weekNumber);
      if (source.length === 0) return current;
      const clones = source.map((workout, index) =>
        cloneWorkout({ ...workout, weekNumber: Math.max(...current.map((item) => item.weekNumber), 0) + 1 }, current.length + index)
      );
      pendingRecentlyAddedIdsRef.current = clones.map((clone) => clone.draftId);
      const next = [
        ...current,
        ...clones,
      ];
      return normalizeTimeline(next);
    });
  }

  function pasteAfter(draftId: string) {
    if (!copiedWorkout) return;
    const insertAfterIndex = sortedWorkouts.findIndex((workout) => workout.draftId === draftId);
    if (insertAfterIndex < 0) return;
    setWorkouts((current) => {
      const index = current.findIndex((workout) => workout.draftId === draftId);
      if (index < 0) return current;
      const next = [...current];
      const clone = clipboardToDraftWorkout(copiedWorkout, index + 1);
      pendingRecentlyAddedIdsRef.current = [clone.draftId];
      next.splice(index + 1, 0, clone);
      return normalizeTimeline(next);
    });
    clearWorkoutClipboard();
    showClipboardNotification("Тренировка вставлена");
  }

  function bulkCopySelected() {
    const selected = getSelectedWorkoutsInOrder();
    if (selected.length === 0) return;
    copyWorkoutsToClipboard(selected, "copy");
  }

  function bulkDuplicateSelected() {
    const selected = getSelectedWorkoutsInOrder();
    if (selected.length === 0) return;
    setWorkouts((current) => {
      const indices = selected
        .map((workout) => current.findIndex((item) => item.draftId === workout.draftId))
        .filter((index) => index >= 0);
      const insertAfter = Math.max(...indices);
      const next = [...current];
      const clones = selected.map((item, cloneIndex) => cloneWorkout(item, insertAfter + 1 + cloneIndex));
      pendingRecentlyAddedIdsRef.current = clones.map((clone) => clone.draftId);
      next.splice(insertAfter + 1, 0, ...clones);
      return normalizeTimeline(next);
    });
    clearSelection();
  }

  function bulkDeleteSelected(options?: { skipConfirm?: boolean }) {
    if (selectedWorkoutIds.length === 0) return;
    if (!options?.skipConfirm && !window.confirm(`Удалить ${selectedWorkoutIds.length} тренировок?`)) return;

    const selected = new Set(selectedWorkoutIds);
    setWorkouts((current) => normalizeTimeline(current.filter((workout) => !selected.has(workout.draftId))));
    if (selected.has(editingId)) setEditingId("");
    clearSelection();
  }

  async function saveProgram() {
    if (isReadOnly) {
      setError("У вас нет прав на редактирование этой программы.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const cleanupResult = removeEmptyNewWorkoutsFromList(sortedWorkouts);
      const payloadWorkouts = cleanupResult.workouts;
      if (cleanupResult.removedIds.length > 0) {
        setWorkouts(payloadWorkouts);
        if (cleanupResult.removedIds.includes(editingId)) {
          setEditingId("");
          setWorkoutDraftDirty(false);
        }
        setSelectedWorkoutIds((selected) => selected.filter((id) => !cleanupResult.removedIds.includes(id)));
      }
      const payloadMetrics = computeProgramMetrics(payloadWorkouts.length);
      const res = await saveProgramFetchWithRetry(`/api/lk/coach/programs/${program.id}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: savedUpdatedAtRef.current || null,
          title,
          description,
          durationDays: payloadMetrics.durationDays,
          weeksCount: payloadMetrics.weeksCount,
          level,
          goal,
          tags,
          workouts: payloadWorkouts.map((workout, workoutIndex) => ({
            id: workout.id,
            dayNumber: workout.dayNumber,
            weekNumber: workout.weekNumber,
            title: workout.title,
            summary: workout.summary,
            estimatedMinutes: workout.estimatedMinutes,
            workoutType: workout.workoutType,
            sortOrder: workoutIndex,
            groups: workout.groups.map((group) => ({
              id: group.id,
              draftId: group.draftId,
              title: group.title,
              sets: group.sets,
              rest: group.rest,
              notes: group.notes,
              sortOrder: group.sortOrder,
            })),
            exercises: workout.exercises.map((exercise, exerciseIndex) => ({
              id: exercise.id,
              exerciseId: exercise.exerciseId,
              groupDraftId: exercise.groupDraftId || "",
              exerciseTitle: exercise.exerciseTitle,
              sets: exercise.sets,
              reps: exercise.reps,
              rest: exercise.rest,
              tempo: exercise.tempo,
              notes: exercise.notes,
              sortOrder: exercise.groupDraftId
                ? workout.exercises.filter((item) => item.groupDraftId === exercise.groupDraftId).findIndex((item) => item.draftId === exercise.draftId)
                : exerciseIndex,
            })),
          })),
        }),
      });
      const json = (await res.json().catch(() => null)) as { program?: ProgramTemplate; message?: string; error?: string } | null;
      if (!res.ok) {
        const message = mapCoachApiError(json?.message || json?.error, res.status, "Не удалось сохранить программу.");
        if (res.status === 401) {
          router.push(`/lk/login?next=${encodeURIComponent(window.location.pathname)}`);
        }
        throw new Error(message);
      }
      let savedWorkouts = payloadWorkouts;
      let savedProgram: ProgramTemplate | undefined;
      if (json?.program) {
        const nextWorkouts = (json.program.workouts || []).map(workoutToDraft);
        const editingIndex = editingId ? payloadWorkouts.findIndex((workout) => workout.draftId === editingId) : -1;
        savedUpdatedAtRef.current = json.program.updatedAt || savedUpdatedAtRef.current;
        setTitle(json.program.title);
        setWorkouts(nextWorkouts);
        if (editingIndex >= 0) setEditingId(nextWorkouts[editingIndex]?.draftId || "");
        savedWorkouts = nextWorkouts;
        savedProgram = json.program;
      }
      updateSavedSnapshot(savedWorkouts, savedProgram);
      emptyWorkoutCleanupIdsRef.current.clear();
      showTemporarySuccess("Программа сохранена.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить программу.");
    } finally {
      setSaving(false);
    }
  }

  if (isReadOnly) {
    return (
      <div className="space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => router.push("/lk/coach/programs")}
              className="text-sm font-medium text-slate-400 hover:text-brand-primary"
            >
              ← Все программы
            </button>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">{sortedWorkouts.length} тренировок</p>
          </div>
          <span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-500">
            Только просмотр
          </span>
        </div>

        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Это общий или чужой шаблон. Его можно просматривать и дублировать, но редактирование доступно только владельцу или head coach.
        </p>

        <div className="space-y-6 overflow-x-auto pb-2">
          {weeks.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center">
              <h3 className="font-semibold text-slate-950">Timeline пустой</h3>
              <p className="mt-2 text-sm text-slate-500">В программе пока нет тренировок.</p>
            </div>
          ) : (
            weeks.map(([weekNumber, weekWorkouts]) => (
              <section key={weekNumber}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-400">Week {weekNumber}</h3>
                </div>
                <WeekDayTimeline workouts={weekWorkouts} editingId="" />
                <div className="grid min-w-[720px] grid-cols-4 gap-3 xl:grid-cols-7">
                  {weekWorkouts.map((workout) => (
                    <article
                      key={workout.draftId}
                      className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                        Week {workout.weekNumber} · Day {workout.dayNumber}
                      </p>
                      <h4 className="mt-1 text-base font-semibold text-slate-950">{workout.title}</h4>
                      {workout.summary ? <p className="mt-1 text-sm text-slate-500">{workout.summary}</p> : null}

                      {workout.exercises.length > 0 ? (
                        <div className="mt-3 space-y-2">
                          {workout.exercises.map((exercise) => (
                            <div
                              key={exercise.draftId}
                              className="rounded-2xl border border-[#E6EBF1] bg-[#FAFBFC] px-3 py-2"
                            >
                              <p className="text-sm font-semibold text-slate-800">
                                {exercise.exerciseTitle || "Упражнение"}
                              </p>
                              {[exercise.sets, exercise.reps, exercise.rest, exercise.tempo].filter(Boolean).length > 0 ? (
                                <p className="mt-1 text-xs text-slate-500">
                                  {[exercise.sets, exercise.reps, exercise.rest, exercise.tempo].filter(Boolean).join(" · ")}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 rounded-2xl border border-dashed border-slate-200 px-3 py-2 text-sm text-slate-400">
                          Без упражнений.
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ClipboardNotification message={clipboardNotification} />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => {
              if (!confirmDiscardChanges()) return;
              router.push("/lk/coach/programs");
            }}
            className="text-sm font-medium text-slate-400 hover:text-brand-primary"
          >
            ← Все программы
          </button>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            readOnly={isReadOnly}
            className="mt-2 block w-full border-0 bg-transparent p-0 text-2xl font-semibold text-slate-950 outline-none read-only:cursor-default"
          />
          <p className="mt-1 text-sm text-slate-500">{sortedWorkouts.length} тренировок</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isReadOnly ? (
            <button
              type="button"
              onClick={addWorkout}
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >
              + Добавить тренировку
            </button>
          ) : null}
          <button
            type="button"
            onClick={saveProgram}
            disabled={saving || isReadOnly}
            className="rounded-full bg-brand-primary px-5 py-2 text-sm font-semibold text-white hover:bg-brand-primary/90 disabled:opacity-60"
          >
            {isReadOnly ? "Только просмотр" : saving ? "Сохраняем..." : "Сохранить"}
          </button>
        </div>
      </div>

      {isReadOnly ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Это общий или чужой шаблон. Его можно просматривать и дублировать, но редактирование доступно только владельцу или head coach.
        </p>
      ) : null}
      {error ? <p className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {success ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</p> : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleWorkoutDragStart}
        onDragOver={handleWorkoutDragOver}
        onDragCancel={handleWorkoutDragCancel}
        onDragEnd={handleWorkoutDragEnd}
      >
        <SortableContext items={sortedWorkouts.map((workout) => workout.draftId)} strategy={verticalListSortingStrategy}>
          {!isReadOnly ? (
            <WorkoutSelectionBar
              count={selectedWorkoutIds.length}
              clipboardCount={copiedWorkout ? 1 : 0}
              clipboardMode={clipboardMode}
              onDelete={() => bulkDeleteSelected()}
              onCopy={bulkCopySelected}
              onDuplicate={bulkDuplicateSelected}
              onClear={clearSelection}
              onClearClipboard={clearClipboard}
              copyDisabled={selectedWorkoutIds.length > 1}
              copyDisabledReason={selectedWorkoutIds.length > 1 ? "Копирование нескольких тренировок будет добавлено отдельно" : ""}
            />
          ) : null}
          <div className="space-y-6 overflow-x-auto pb-2">
            {weeks.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center">
                <h3 className="font-semibold text-slate-950">Timeline пустой</h3>
                <p className="mt-2 text-sm text-slate-500">Добавьте первую тренировку, чтобы собрать структуру программы.</p>
                <button type="button" onClick={addWorkout} className="mt-5 rounded-full bg-brand-primary px-5 py-2 text-sm font-semibold text-white">
                  + Добавить тренировку
                </button>
              </div>
            ) : (
              weeks.map(([weekNumber, weekWorkouts]) => (
                <section key={weekNumber}>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-400">Week {weekNumber}</h3>
                    <button
                      type="button"
                      onClick={() => duplicateWeek(weekNumber)}
                      className="rounded-full px-3 py-1.5 text-xs font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      Дублировать неделю
                    </button>
                  </div>
                  <WeekDayTimeline workouts={weekWorkouts} editingId={editingId} />
                  <div className="grid min-w-[720px] grid-cols-4 gap-3 xl:grid-cols-7">
                    {weekWorkouts.map((workout) => (
                      <SortableWorkoutCard
                        key={workout.draftId}
                        workout={workout}
                        weekWorkouts={weekWorkouts}
                        isLastInProgram={workout.draftId === lastProgramWorkoutId}
                        isWorkoutDragActive={isWorkoutDragActive}
                        dropSlotPosition={getWorkoutDropSlotPosition(workout)}
                        isOpen={editingId === workout.draftId}
                        selected={selectedWorkoutIds.includes(workout.draftId)}
                        recentlyAdded={recentlyAddedWorkoutIds.includes(workout.draftId)}
                        onOpen={() => requestOpenWorkout(workout.draftId)}
                        onInsertAfter={() => insertWorkoutAfter(workout.draftId)}
                        onCopy={() => copyWorkoutsToClipboard([workout], "copy")}
                        onPasteAfter={() => pasteAfter(workout.draftId)}
                        onToggleSelect={toggleWorkoutSelection}
                        canPaste={Boolean(copiedWorkout)}
                        exerciseLibrary={exerciseLibrary}
                        onCollapse={collapseWorkoutEditor}
                        onApplyDay={(draftWorkout) => {
                          applyWorkoutAndCleanup(workout.draftId, draftWorkout);
                          setWorkoutDraftDirty(false);
                          setEditingId("");
                        }}
                        onExerciseLibraryChanged={() => router.refresh()}
                        onDirtyChange={editingId === workout.draftId ? setWorkoutDraftDirty : undefined}
                        expandedScrollRef={editingId === workout.draftId ? expandedCardRef : undefined}
                      />
                    ))}
                    {weekWorkouts.some((workout) => workout.draftId === lastProgramWorkoutId) ? (
                      <button
                        type="button"
                        disabled={isWorkoutDragActive}
                        onClick={addWorkout}
                        className="flex min-h-32 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm font-semibold text-slate-500 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-40"
                      >
                        <span className="mb-1 flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-lg leading-none text-slate-500">
                          +
                        </span>
                        <span>Добавить тренировку</span>
                      </button>
                    ) : null}
                  </div>
                </section>
              ))
            )}
          </div>
        </SortableContext>
      </DndContext>

    </div>
  );
}

function WorkoutEditModal({
  workout,
  exerciseLibrary,
  onClose,
  onUpdate,
  onSelectExercise,
  onUpdateExercise,
  onAddExercise,
  onRemoveExercise,
  onGroupAdjacent,
  onUngroup,
}: {
  workout: DraftWorkout;
  exerciseLibrary: ExerciseLibraryItem[];
  onClose: () => void;
  onUpdate: (patch: Partial<DraftWorkout>) => void;
  onSelectExercise: (index: number, exerciseId: string) => void;
  onUpdateExercise: (index: number, patch: Partial<DraftExercise>) => void;
  onAddExercise: () => void;
  onRemoveExercise: (index: number) => void;
  onGroupAdjacent: (index: number) => void;
  onUngroup: (groupDraftId: string) => void;
}) {
  const [previewExercise, setPreviewExercise] = useState<PreviewExercise | null>(null);

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-3 py-4"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                Week {workout.weekNumber} · Day {workout.dayNumber}
              </p>
              <h3 className="mt-1 text-xl font-semibold text-slate-950">Редактор тренировки</h3>
            </div>
            <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-2xl leading-none text-slate-400 hover:bg-slate-100">
              ×
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="text-slate-500">Название</span>
              <input value={workout.title} onChange={(e) => onUpdate({ title: e.target.value })} className="w-full rounded-2xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-primary" />
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="text-slate-500">Summary</span>
              <input value={workout.summary} onChange={(e) => onUpdate({ summary: e.target.value })} className="w-full rounded-2xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-primary" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-slate-500">Минуты</span>
              <input value={workout.estimatedMinutes} onChange={(e) => onUpdate({ estimatedMinutes: e.target.value })} className="w-full rounded-2xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-primary" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-slate-500">Тип</span>
              <input value={workout.workoutType} onChange={(e) => onUpdate({ workoutType: e.target.value })} className="w-full rounded-2xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-primary" placeholder="Strength" />
            </label>
          </div>

          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-slate-950">Упражнения</h4>
              <button type="button" onClick={onAddExercise} className="rounded-full bg-brand-primary px-4 py-2 text-sm font-semibold text-white">
                + Добавить
              </button>
            </div>
            {workout.exercises.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">Пока нет упражнений.</p>
            ) : (
              <div className="space-y-2">
                {workout.exercises.map((exercise, index) => {
                  const group = exercise.groupDraftId ? workout.groups.find((item) => item.draftId === exercise.groupDraftId) : undefined;
                  const isFirstInGroup = group && workout.exercises.findIndex((item) => item.groupDraftId === group.draftId) === index;
                  const next = workout.exercises[index + 1];
                  const libraryExercise = exercise.exerciseId
                    ? exerciseLibrary.find((item) => item.id === exercise.exerciseId)
                    : undefined;
                  return (
                    <div key={exercise.draftId} className={group ? "rounded-3xl border border-emerald-200/60 bg-emerald-50/50 p-3" : ""}>
                      {isFirstInGroup ? (
                        <div className="mb-2 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <input
                              value={group.title}
                              onChange={(e) =>
                                onUpdate({ groups: workout.groups.map((item) => (item.draftId === group.draftId ? { ...item, title: e.target.value } : item)) })
                              }
                              className="min-w-0 flex-1 border-0 bg-transparent font-semibold text-slate-950 outline-none"
                            />
                            <button type="button" onClick={() => onUngroup(group.draftId)} className="rounded-full px-3 py-1 text-sm text-slate-400 hover:bg-white/70 hover:text-slate-700">
                              Разъединить
                            </button>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-3">
                            <input
                              value={group.sets}
                              onChange={(e) =>
                                onUpdate({ groups: workout.groups.map((item) => (item.draftId === group.draftId ? { ...item, sets: e.target.value } : item)) })
                              }
                              className="rounded-2xl border border-emerald-200/70 bg-white/70 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                              placeholder="подходы комбо"
                            />
                            <input
                              value={group.rest}
                              onChange={(e) =>
                                onUpdate({ groups: workout.groups.map((item) => (item.draftId === group.draftId ? { ...item, rest: e.target.value } : item)) })
                              }
                              className="rounded-2xl border border-emerald-200/70 bg-white/70 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                              placeholder="отдых комбо"
                            />
                            <input
                              value={group.notes}
                              onChange={(e) =>
                                onUpdate({ groups: workout.groups.map((item) => (item.draftId === group.draftId ? { ...item, notes: e.target.value } : item)) })
                              }
                              className="rounded-2xl border border-emerald-200/70 bg-white/70 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                              placeholder="комментарий"
                            />
                          </div>
                        </div>
                      ) : null}
                      <div className="rounded-2xl border border-slate-200 bg-white p-3">
                        <div className="grid gap-2 sm:grid-cols-6">
                          <div className="flex items-center gap-2 sm:col-span-2">
                            <select
                              value={exercise.exerciseId}
                              onChange={(e) => onSelectExercise(index, e.target.value)}
                              className="min-w-0 flex-1 rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-primary"
                            >
                              <option value="">Выбрать упражнение</option>
                              {exerciseLibrary.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.title}
                                </option>
                              ))}
                            </select>
                            {libraryExercise?.videoUrl ? (
                              <button
                                type="button"
                                onMouseDown={(e) => e.stopPropagation()}
                                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] text-slate-500 transition-colors hover:bg-brand-primary/10 hover:text-brand-primary"
                                title="Посмотреть видео упражнения"
                                aria-label={`Посмотреть видео упражнения ${libraryExercise.title}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewExercise({
                                    title: libraryExercise.title,
                                    videoUrl: libraryExercise.videoUrl,
                                  });
                                }}
                              >
                                ▶
                              </button>
                            ) : null}
                          </div>
                          <input value={exercise.sets} onChange={(e) => onUpdateExercise(index, { sets: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-primary" placeholder="подходы" disabled={Boolean(group)} />
                          <input value={exercise.reps} onChange={(e) => onUpdateExercise(index, { reps: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-primary" placeholder="разы" />
                          <input value={exercise.rest} onChange={(e) => onUpdateExercise(index, { rest: e.target.value })} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-primary" placeholder="отдых" disabled={Boolean(group)} />
                          <button type="button" onClick={() => onRemoveExercise(index)} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-red-500 hover:bg-red-50">
                            Удалить
                          </button>
                        </div>
                        <textarea
                          value={exercise.notes}
                          onChange={(e) => onUpdateExercise(index, { notes: e.target.value })}
                          className="mt-2 min-h-14 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-primary"
                          placeholder="Заметка"
                        />
                      </div>
                      {!exercise.groupDraftId && next && !next.groupDraftId ? (
                        <div className="flex justify-center py-2">
                          <button type="button" onClick={() => onGroupAdjacent(index)} className="rounded-full border border-dashed border-emerald-200 bg-white/80 px-3 py-1 text-xs font-semibold text-emerald-700">
                            + объединить в комбо
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {previewExercise ? <ExerciseVideoPreviewModal exercise={previewExercise} onClose={() => setPreviewExercise(null)} /> : null}
    </>
  );
}

function SortableExerciseDraftRow({
  exercise,
  index,
  letter,
  group,
  isFirstInGroup,
  next,
  libraryItems,
  focusedExerciseDraftId,
  onFocusExercise,
  onBlurExercise,
  onUpdateGroupTitle,
  onUpdateGroup,
  onUngroup,
  onUpdateTitle,
  onSelectLibrary,
  onPreviewVideo,
  onUploadVideo,
  onRemove,
  onUpdateExercise,
  onGroupAdjacent,
  exerciseRowRefs,
  titleInputRefs,
}: {
  exercise: DraftExercise;
  index: number;
  letter: string;
  group: DraftGroup | undefined;
  isFirstInGroup: boolean;
  next: DraftExercise | undefined;
  libraryItems: ExerciseLibraryItem[];
  focusedExerciseDraftId: string;
  onFocusExercise: (draftId: string) => void;
  onBlurExercise: () => void;
  onUpdateGroupTitle: (groupDraftId: string, title: string) => void;
  onUpdateGroup: (groupDraftId: string, patch: Partial<DraftGroup>) => void;
  onUngroup: (groupDraftId: string) => void;
  onUpdateTitle: (index: number, title: string) => void;
  onSelectLibrary: (index: number, exerciseId: string) => void;
  onPreviewVideo: (preview: PreviewExercise) => void;
  onUploadVideo: (index: number) => void;
  onRemove: (index: number) => void;
  onUpdateExercise: (index: number, patch: Partial<DraftExercise>) => void;
  onGroupAdjacent: (index: number) => void;
  exerciseRowRefs: RefObject<Map<string, HTMLDivElement>>;
  titleInputRefs: RefObject<Map<string, HTMLInputElement>>;
}) {
  const isComboMember = Boolean(exercise.groupDraftId);
  const [activeMetric, setActiveMetric] = useState<ActiveMetric>(null);
  const metricRowRef = useRef<HTMLDivElement>(null);
  const setsInputRef = useRef<HTMLInputElement>(null);
  const repsTextareaRef = useRef<HTMLTextAreaElement>(null);
  const restInputRef = useRef<HTMLInputElement>(null);
  const startedEditingFromEmptyRef = useRef(false);
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id: exercise.draftId,
    disabled: isComboMember,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const libraryExercise = exercise.exerciseId ? libraryItems.find((item) => item.id === exercise.exerciseId) : undefined;
  const inputTitle = exercise.exerciseTitle;
  const displayTitle = inputTitle.trim();
  const showSuggestions = focusedExerciseDraftId === exercise.draftId;
  const videoUrl = libraryExercise?.videoUrl || "";
  const videoTitle = displayTitle || libraryExercise?.title || "";
  const hasVideo = Boolean(videoUrl);
  const groupOwnsSharedMetrics = Boolean(group);

  useEffect(() => {
    if (groupOwnsSharedMetrics && (activeMetric === "sets" || activeMetric === "rest")) {
      setActiveMetric(null);
    }
  }, [activeMetric, groupOwnsSharedMetrics]);

  useEffect(() => {
    if (!activeMetric) startedEditingFromEmptyRef.current = false;
  }, [activeMetric]);

  useEffect(() => {
    if (!activeMetric) return;
    const frameId = window.requestAnimationFrame(() => {
      if (activeMetric === "sets") setsInputRef.current?.focus();
      if (activeMetric === "reps") {
        repsTextareaRef.current?.focus();
        if (repsTextareaRef.current) syncRepsTextareaHeight(repsTextareaRef.current);
      }
      if (activeMetric === "rest") restInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeMetric]);

  useLayoutEffect(() => {
    if (activeMetric !== "reps" || !repsTextareaRef.current) return;
    syncRepsTextareaHeight(repsTextareaRef.current);
  }, [activeMetric, exercise.reps]);

  function canEditMetric(metric: Exclude<ActiveMetric, null>) {
    return metric === "reps" || !groupOwnsSharedMetrics;
  }

  function isMetricDraftEmpty() {
    return !exercise.sets.trim() && !exercise.reps.trim() && !exercise.rest.trim();
  }

  function activateMetric(metric: Exclude<ActiveMetric, null>) {
    if (!canEditMetric(metric)) return;
    if (!activeMetric && isMetricDraftEmpty()) {
      startedEditingFromEmptyRef.current = true;
    }
    setActiveMetric(metric);
  }

  function scheduleMetricBlur() {
    window.requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && metricRowRef.current?.contains(activeElement)) return;
      setActiveMetric(null);
    });
  }

  function focusMetricWithKeyboard(metric: Exclude<ActiveMetric, null>) {
    if (!canEditMetric(metric)) return false;
    setActiveMetric(metric);
    return true;
  }

  function handleMetricKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    metric: Exclude<ActiveMetric, null>
  ) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.currentTarget.blur();
      setActiveMetric(null);
      return;
    }
    if (event.key !== "Tab") return;

    let nextMetric: Exclude<ActiveMetric, null> | null = null;
    if (event.shiftKey) {
      if (metric === "rest") nextMetric = "reps";
      if (metric === "reps") nextMetric = "sets";
    } else {
      if (metric === "sets") nextMetric = "reps";
      if (metric === "reps") nextMetric = "rest";
    }

    if (!nextMetric || !focusMetricWithKeyboard(nextMetric)) return;
    event.preventDefault();
  }

  function syncRepsTextareaHeight(node: HTMLTextAreaElement) {
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, REPS_METRIC_MAX_HEIGHT)}px`;
  }

  function metricInputWidth(value: string, minCh: number, maxCh: number) {
    return `${Math.min(Math.max(value.length || minCh, minCh), maxCh)}ch`;
  }

  function metricSegmentClass(editable: boolean, extra = "") {
    return `rounded px-1 py-0.5 -mx-1 transition-colors focus-within:bg-emerald-50 focus-within:ring-2 focus-within:ring-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-100 ${
      editable ? "cursor-text hover:bg-slate-50" : "cursor-default"
    } ${extra}`;
  }

  function renderSetsSegment() {
    const editable = canEditMetric("sets");
    const isActive = activeMetric === "sets" && editable;
    if (isActive) {
      return (
        <label className={metricSegmentClass(true, "inline-flex shrink-0 items-baseline gap-1")}>
          <input
            ref={setsInputRef}
            value={exercise.sets}
            onChange={(e) => onUpdateExercise(index, { sets: e.target.value })}
            onBlur={scheduleMetricBlur}
            onKeyDown={(e) => handleMetricKeyDown(e, "sets")}
            className={INLINE_METRIC_INPUT_CLASS}
            placeholder="0"
            style={{ width: metricInputWidth(exercise.sets, 3, 10) }}
          />
          <span className="text-slate-500">подх.</span>
        </label>
      );
    }

    if (!editable) {
      return <span className={metricSegmentClass(false, "inline-flex shrink-0 text-slate-500")}>{exercise.sets} подх.</span>;
    }

    return (
      <button
        type="button"
        onClick={() => activateMetric("sets")}
        className={metricSegmentClass(true, "inline-flex shrink-0 text-left text-slate-700")}
        aria-label="Редактировать подходы"
      >
        {exercise.sets} <span className="ml-1 text-slate-500">подх.</span>
      </button>
    );
  }

  function renderRepsSegment() {
    const isActive = activeMetric === "reps";
    if (isActive) {
      return (
        <label className={metricSegmentClass(true, "min-w-[8rem] flex-1")}>
          <textarea
            ref={repsTextareaRef}
            value={exercise.reps}
            onChange={(e) => {
              onUpdateExercise(index, { reps: e.target.value });
              syncRepsTextareaHeight(e.currentTarget);
            }}
            onBlur={scheduleMetricBlur}
            onKeyDown={(e) => handleMetricKeyDown(e, "reps")}
            className={INLINE_REPS_METRIC_CLASS}
            placeholder="повторения"
            rows={1}
          />
        </label>
      );
    }

    return (
      <button
        type="button"
        onClick={() => activateMetric("reps")}
        className={metricSegmentClass(true, "min-w-[8rem] flex-1 whitespace-pre-wrap break-words text-left text-slate-700")}
        aria-label="Редактировать повторения"
      >
        {exercise.reps}
      </button>
    );
  }

  function renderRestSegment() {
    const editable = canEditMetric("rest");
    const isActive = activeMetric === "rest" && editable;
    return (
      <div className="ml-1 border-l border-slate-200 pl-2 text-[11px] leading-5 text-slate-500">
        <span className="mr-1 text-slate-400">отдых</span>
        {isActive ? (
          <label className={metricSegmentClass(true, "inline-flex max-w-full align-baseline")}>
            <input
              ref={restInputRef}
              value={exercise.rest}
              onChange={(e) => onUpdateExercise(index, { rest: e.target.value })}
              onBlur={scheduleMetricBlur}
              onKeyDown={(e) => handleMetricKeyDown(e, "rest")}
              className={`${INLINE_METRIC_INPUT_CLASS} text-[11px] text-slate-500`}
              placeholder="Добавить"
              style={{ width: metricInputWidth(exercise.rest, 7, 18) }}
            />
          </label>
        ) : editable ? (
          <button
            type="button"
            onClick={() => activateMetric("rest")}
            className={metricSegmentClass(true, "inline-block max-w-full whitespace-pre-wrap break-words text-left align-baseline text-slate-500")}
            aria-label="Редактировать отдых"
          >
            {exercise.rest}
          </button>
        ) : (
          <span className="inline-block max-w-full whitespace-pre-wrap break-words align-baseline text-slate-400">{exercise.rest}</span>
        )}
      </div>
    );
  }

  function renderMetricAddAction(metric: Exclude<ActiveMetric, null>, label: string) {
    if (!canEditMetric(metric)) return null;
    return (
      <button
        type="button"
        onClick={() => activateMetric(metric)}
        className="rounded-full px-1.5 py-0.5 text-[10px] leading-none text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-100"
      >
        + {label}
      </button>
    );
  }

  function renderEmptyMetricEntry() {
    return (
      <div className="grid w-full min-w-0 grid-cols-[minmax(0,0.8fr)_minmax(0,1.8fr)_minmax(0,0.9fr)] gap-1.5">
        {canEditMetric("sets") ? (
          <label className={EMPTY_METRIC_FIELD_CLASS}>
            <input
              ref={setsInputRef}
              value={exercise.sets}
              onChange={(e) => onUpdateExercise(index, { sets: e.target.value })}
              onFocus={() => activateMetric("sets")}
              onBlur={scheduleMetricBlur}
              onKeyDown={(e) => handleMetricKeyDown(e, "sets")}
              className={EMPTY_METRIC_INPUT_CLASS}
              placeholder="ПОДХОДЫ"
            />
          </label>
        ) : (
          <span className={`${EMPTY_METRIC_FIELD_CLASS} justify-center text-[11px] text-slate-300`}>—</span>
        )}
        <label className={EMPTY_METRIC_FIELD_CLASS}>
          <textarea
            ref={repsTextareaRef}
            value={exercise.reps}
            onChange={(e) => {
              onUpdateExercise(index, { reps: e.target.value });
              syncRepsTextareaHeight(e.currentTarget);
            }}
            onFocus={() => activateMetric("reps")}
            onBlur={scheduleMetricBlur}
            onKeyDown={(e) => handleMetricKeyDown(e, "reps")}
            className={`${EMPTY_METRIC_INPUT_CLASS} max-h-20 resize-none overflow-y-auto whitespace-pre-wrap`}
            placeholder="ПОВТОРЕНИЯ"
            rows={1}
          />
        </label>
        {canEditMetric("rest") ? (
          <label className={EMPTY_METRIC_FIELD_CLASS}>
            <input
              ref={restInputRef}
              value={exercise.rest}
              onChange={(e) => onUpdateExercise(index, { rest: e.target.value })}
              onFocus={() => activateMetric("rest")}
              onBlur={scheduleMetricBlur}
              onKeyDown={(e) => handleMetricKeyDown(e, "rest")}
              className={EMPTY_METRIC_INPUT_CLASS}
              placeholder="ОТДЫХ"
            />
          </label>
        ) : (
          <span className={`${EMPTY_METRIC_FIELD_CLASS} justify-center text-[11px] text-slate-300`}>—</span>
        )}
      </div>
    );
  }

  function renderMetricSummary() {
    const hasSets = Boolean(exercise.sets.trim());
    const hasReps = Boolean(exercise.reps.trim());
    const hasRest = Boolean(exercise.rest.trim());
    const showSets = hasSets || activeMetric === "sets";
    const showReps = hasReps || activeMetric === "reps";
    const showRest = hasRest || activeMetric === "rest";
    const allEmpty = !hasSets && !hasReps && !hasRest;
    const keepEmptyEntryDuringEdit = Boolean(activeMetric && startedEditingFromEmptyRef.current);

    if (allEmpty || keepEmptyEntryDuringEdit) return renderEmptyMetricEntry();

    return (
      <div className="space-y-1">
        {(showSets || showReps) ? (
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[13px] leading-5 text-slate-700">
            {showSets ? renderSetsSegment() : null}
            {showSets && showReps ? <span className="shrink-0 text-slate-400">×</span> : null}
            {showReps ? renderRepsSegment() : null}
          </div>
        ) : null}
        {showRest ? renderRestSegment() : null}
        <div className="flex flex-wrap gap-1">
          {!hasSets && activeMetric !== "sets" ? renderMetricAddAction("sets", "подходы") : null}
          {!hasReps && activeMetric !== "reps" ? renderMetricAddAction("reps", "повторения") : null}
          {!hasRest && activeMetric !== "rest" ? renderMetricAddAction("rest", "отдых") : null}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        if (node) exerciseRowRefs.current.set(exercise.draftId, node);
        else exerciseRowRefs.current.delete(exercise.draftId);
      }}
      style={style}
      className={`${
        group
          ? "relative overflow-visible rounded-lg border border-emerald-100/80 bg-emerald-50/20 px-2.5 py-2 shadow-[0_1px_3px_rgba(15,23,42,0.035)]"
          : "rounded-lg border border-[#E6EBF1] bg-white p-3 shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
      } ${isDragging ? "relative z-20 shadow-lg" : ""}`}
    >
      {group ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-2 left-2 top-2 w-1 rounded-full bg-emerald-300/70"
        />
      ) : null}
      {isFirstInGroup && group ? (
        <ComboGroupInstructions
          group={group}
          onUpdateTitle={(title) => onUpdateGroupTitle(group.draftId, title)}
          onUpdate={(patch) => onUpdateGroup(group.draftId, patch)}
          onUngroup={() => onUngroup(group.draftId)}
        />
      ) : null}
      <div className={`${group ? "ml-3 pl-2" : ""}`}>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            {isComboMember ? (
              <span
                title="Упражнения в комбо пока нельзя перетаскивать отдельно"
                aria-label="Упражнения в комбо пока нельзя перетаскивать отдельно"
                className="flex h-5 w-5 shrink-0 items-center justify-center text-[10px] leading-none text-slate-300 cursor-not-allowed"
              >
                ⋮⋮
              </span>
            ) : (
              <button
                type="button"
                ref={setActivatorNodeRef}
                aria-label="Перетащить упражнение"
                className="flex h-5 w-5 shrink-0 items-center justify-center text-[10px] leading-none text-slate-400 cursor-grab hover:text-slate-600 active:cursor-grabbing"
                onPointerDown={(e) => e.stopPropagation()}
                {...attributes}
                {...listeners}
              >
                ⋮⋮
              </button>
            )}
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[8px] font-bold text-slate-500">
              {letter}
            </span>
            <div className="min-w-0 flex-1">
              <ExerciseLibrarySearchInput
                value={inputTitle}
                selectedExerciseId={exercise.exerciseId}
                items={libraryItems}
                isOpen={showSuggestions}
                showEmptyQueryResults={false}
                getSearchText={normalizeSearchText}
                placeholder="Название"
                inputRef={(node) => {
                  if (node) titleInputRefs.current.set(exercise.draftId, node);
                  else titleInputRefs.current.delete(exercise.draftId);
                }}
                containerClassName="min-w-0"
                inputClassName={`border-0 bg-transparent px-0 py-0.5 text-sm font-semibold text-slate-900 focus:border-transparent focus:ring-0 sm:text-sm ${
                  exercise.exerciseId ? "" : "border-b border-transparent focus:border-slate-200"
                }`}
                dropdownWidthClassName="w-[min(35rem,calc(100vw-2rem))]"
                dropdownClassName="max-h-64"
                onQueryChange={(query) => onUpdateTitle(index, query)}
                onSelect={(exerciseId) => onSelectLibrary(index, exerciseId)}
                onFocus={() => onFocusExercise(exercise.draftId)}
                onBlur={onBlurExercise}
                onKeyDown={(event) => event.stopPropagation()}
              />
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {hasVideo ? (
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPreviewVideo({ title: videoTitle, videoUrl });
                  }}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-transparent text-[9px] text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  title="Посмотреть видео"
                  aria-label="Посмотреть видео"
                >
                  ▶
                </button>
              ) : null}
              {!hasVideo && displayTitle ? (
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUploadVideo(index);
                  }}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-dashed border-slate-300 bg-transparent text-[11px] font-bold leading-none text-slate-400 hover:border-slate-400 hover:text-slate-600"
                  title="Загрузить видео"
                  aria-label="Загрузить видео"
                >
                  ↑
                </button>
              ) : null}
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(index);
                }}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Удалить упражнение"
              >
                ×
              </button>
            </div>
          </div>

          <div ref={metricRowRef} className="space-y-1.5 pl-11">
            {renderMetricSummary()}
          </div>
          <textarea
            value={exercise.notes}
            onChange={(e) => onUpdateExercise(index, { notes: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            className="ml-11 mt-1 min-h-6 w-[calc(100%-2.75rem)] resize-none border-0 bg-transparent px-0 py-0 text-[13px] leading-5 text-slate-700 outline-none focus:ring-0 placeholder:text-slate-400"
            placeholder="Заметка"
          />
        </div>
      </div>
      {!exercise.groupDraftId && next && !next.groupDraftId ? (
        <div className="group/combo relative -my-0.5 h-3">
          <div className="absolute inset-x-5 top-1/2 border-t border-slate-200 group-hover/combo:border-slate-300" />
          <button
            type="button"
            onClick={() => onGroupAdjacent(index)}
            className="absolute left-1/2 top-1/2 flex min-h-5 -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-full border border-transparent bg-white px-2 py-0 text-[9px] font-medium text-slate-400 opacity-0 transition-opacity group-hover/combo:opacity-100 group-hover/combo:border-emerald-100 group-hover/combo:text-emerald-600 group-hover/combo:shadow-sm focus-visible:opacity-100 focus-visible:border-emerald-100 focus-visible:text-emerald-600 focus-visible:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
            aria-label="Объединить в комбо"
          >
            + комбо
          </button>
        </div>
      ) : null}
    </div>
  );
}

function WorkoutDayDraftEditor({
  workout,
  exerciseLibrary,
  onCollapse,
  onApplyDay,
  onExerciseLibraryChanged,
  onDirtyChange,
}: {
  workout: DraftWorkout;
  exerciseLibrary: ExerciseLibraryItem[];
  onCollapse: () => void;
  onApplyDay: (workout: DraftWorkout) => void;
  onExerciseLibraryChanged: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [draftWorkout, setDraftWorkout] = useState<DraftWorkout>(() => seedEmptyDayDraft(workout));
  const [libraryItems, setLibraryItems] = useState<ExerciseLibraryItem[]>(exerciseLibrary);
  const [initialSnapshot, setInitialSnapshot] = useState(() =>
    serializeProgramDraft({ title: "", description: "", level: "", goal: "", tags: "", workouts: [seedEmptyDayDraft(workout)] })
  );
  const [previewExercise, setPreviewExercise] = useState<PreviewExercise | null>(null);
  const [uploadExerciseIndex, setUploadExerciseIndex] = useState<number | null>(null);
  const [focusedExerciseDraftId, setFocusedExerciseDraftId] = useState("");
  const [focusTargetDraftId, setFocusTargetDraftId] = useState("");
  const exerciseRowRefs = useRef(new Map<string, HTMLDivElement>());
  const titleInputRefs = useRef(new Map<string, HTMLInputElement>());
  const currentSnapshot = useMemo(
    () => serializeProgramDraft({ title: "", description: "", level: "", goal: "", tags: "", workouts: [draftWorkout] }),
    [draftWorkout]
  );
  const isDirty = currentSnapshot !== initialSnapshot;

  useEffect(() => {
    const wasEmpty = workout.exercises.length === 0;
    const nextDraft = seedEmptyDayDraft(workout);
    setDraftWorkout(nextDraft);
    setInitialSnapshot(serializeProgramDraft({ title: "", description: "", level: "", goal: "", tags: "", workouts: [nextDraft] }));
    setPreviewExercise(null);
    setFocusedExerciseDraftId("");
    setFocusTargetDraftId(wasEmpty && nextDraft.exercises[0] ? nextDraft.exercises[0].draftId : "");
  }, [workout]);

  useEffect(() => {
    if (!focusTargetDraftId) return;
    const draftId = focusTargetDraftId;
    requestAnimationFrame(() => {
      exerciseRowRefs.current.get(draftId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      titleInputRefs.current.get(draftId)?.focus();
      setFocusTargetDraftId("");
    });
  }, [focusTargetDraftId]);

  useEffect(() => {
    setLibraryItems(exerciseLibrary);
  }, [exerciseLibrary]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  function cancelEdit() {
    onCollapse();
  }

  function applyDay() {
    const applied = cloneWorkoutDraft(draftWorkout);
    applied.exercises = applied.exercises.filter((ex) => !isFullyEmptyExercise(ex));
    const usedGroupIds = new Set(
      applied.exercises.map((ex) => ex.groupDraftId).filter((id): id is string => Boolean(id))
    );
    applied.groups = applied.groups.filter((group) => usedGroupIds.has(group.draftId));
    onApplyDay(applied);
    setInitialSnapshot(serializeProgramDraft({ title: "", description: "", level: "", goal: "", tags: "", workouts: [applied] }));
    onDirtyChange?.(false);
  }

  function updateDraft(patch: Partial<DraftWorkout>) {
    setDraftWorkout((current) => ({ ...current, ...patch }));
  }

  function updateDraftExercise(index: number, patch: Partial<DraftExercise>) {
    setDraftWorkout((current) => ({
      ...current,
      exercises: current.exercises.map((exercise, idx) => (idx === index ? { ...exercise, ...patch } : exercise)),
    }));
  }

  function selectLibraryExercise(index: number, exerciseId: string) {
    const libraryExercise = libraryItems.find((item) => item.id === exerciseId);
    setDraftWorkout((current) => ({
      ...current,
      exercises: current.exercises.map((exercise, idx) => {
        if (idx !== index) return exercise;
        return {
          ...exercise,
          exerciseId,
          exerciseTitle: libraryExercise?.title || exercise.exerciseTitle.trim(),
        };
      }),
    }));
  }

  function updateExerciseTitle(index: number, title: string) {
    const exactMatch = libraryItems.find((item) => normalizeSearchText(item.title) === normalizeSearchText(title));
    updateDraftExercise(index, {
      exerciseTitle: title,
      exerciseId: exactMatch?.id || "",
    });
  }

  function attachCreatedExercise(index: number, createdExercise: ExerciseLibraryItem | undefined) {
    if (!createdExercise) return;
    setLibraryItems((current) => {
      const withoutDuplicate = current.filter((item) => item.id !== createdExercise.id);
      return [createdExercise, ...withoutDuplicate];
    });
    setDraftWorkout((current) => ({
      ...current,
      exercises: current.exercises.map((exercise, idx) =>
        idx === index
          ? {
              ...exercise,
              exerciseId: createdExercise.id,
              exerciseTitle: exercise.exerciseTitle.trim() || createdExercise.title,
            }
          : exercise
      ),
    }));
    onExerciseLibraryChanged();
  }

  function addExerciseDraft() {
    const newExercise = emptyExercise(draftWorkout.exercises.length);
    setDraftWorkout((current) => ({
      ...current,
      exercises: [...current.exercises, newExercise],
    }));
    setFocusTargetDraftId(newExercise.draftId);
  }

  function removeDraftExercise(index: number) {
    setDraftWorkout((current) => ({
      ...current,
      exercises: current.exercises.filter((_, idx) => idx !== index),
    }));
  }

  function groupAdjacentDraft(index: number) {
    const first = draftWorkout.exercises[index];
    const second = draftWorkout.exercises[index + 1];
    if (!first || !second || first.groupDraftId || second.groupDraftId) return;
    const draftId = createDraftId();
    setDraftWorkout((current) => ({
      ...current,
      groups: [
        ...current.groups,
        { draftId, title: `Комбо ${current.groups.length + 1}`, sets: "", rest: "", notes: "", sortOrder: index },
      ],
      exercises: current.exercises.map((exercise, idx) =>
        idx === index || idx === index + 1 ? { ...exercise, groupDraftId: draftId, sets: "", rest: "" } : exercise
      ),
    }));
  }

  function ungroupDraft(groupDraftId: string) {
    setDraftWorkout((current) => ({
      ...current,
      groups: current.groups.filter((group) => group.draftId !== groupDraftId),
      exercises: current.exercises.map((exercise) =>
        exercise.groupDraftId === groupDraftId ? { ...exercise, groupDraftId: undefined } : exercise
      ),
    }));
  }

  const exerciseSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const sortableExerciseIds = useMemo(
    () => draftWorkout.exercises.map((ex) => ex.draftId),
    [draftWorkout.exercises]
  );

  function handleExerciseDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDraftWorkout((current) => {
      const oldIndex = current.exercises.findIndex((ex) => ex.draftId === active.id);
      const newIndex = current.exercises.findIndex((ex) => ex.draftId === over.id);
      if (oldIndex < 0 || newIndex < 0) return current;
      const activeEx = current.exercises[oldIndex];
      const overEx = current.exercises[newIndex];
      if (activeEx?.groupDraftId || overEx?.groupDraftId) return current;
      return {
        ...current,
        exercises: arrayMove(current.exercises, oldIndex, newIndex).map((ex, i) => ({
          ...ex,
          sortOrder: i,
        })),
      };
    });
  }

  function updateGroupTitle(groupDraftId: string, title: string) {
    updateDraft({
      groups: draftWorkout.groups.map((item) => (item.draftId === groupDraftId ? { ...item, title } : item)),
    });
  }

  function updateGroup(groupDraftId: string, patch: Partial<DraftGroup>) {
    updateDraft({
      groups: draftWorkout.groups.map((item) => (item.draftId === groupDraftId ? { ...item, ...patch } : item)),
    });
  }

  return (
    <>
      <div>
        <label className="block space-y-0.5 text-xs">
          <span className="text-slate-500">Название</span>
          <input
            value={draftWorkout.title}
            onChange={(e) => updateDraft({ title: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:border-brand-primary"
          />
        </label>
      </div>

      <div className="mt-2 space-y-0.5">
        <h4 className="text-xs font-semibold text-slate-950">Упражнения</h4>
        <DndContext sensors={exerciseSensors} collisionDetection={closestCenter} onDragEnd={handleExerciseDragEnd}>
          <SortableContext items={sortableExerciseIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-2.5">
              {draftWorkout.exercises.map((exercise, index) => {
                const group = exercise.groupDraftId
                  ? draftWorkout.groups.find((item) => item.draftId === exercise.groupDraftId)
                  : undefined;
                const isFirstInGroup =
                  group && draftWorkout.exercises.findIndex((item) => item.groupDraftId === group.draftId) === index;
                const next = draftWorkout.exercises[index + 1];
                const letter = String.fromCharCode(65 + index);
                return (
                  <SortableExerciseDraftRow
                    key={exercise.draftId}
                    exercise={exercise}
                    index={index}
                    letter={letter}
                    group={group}
                    isFirstInGroup={Boolean(isFirstInGroup)}
                    next={next}
                    libraryItems={libraryItems}
                    focusedExerciseDraftId={focusedExerciseDraftId}
                    onFocusExercise={setFocusedExerciseDraftId}
                    onBlurExercise={() => setFocusedExerciseDraftId("")}
                    onUpdateGroupTitle={updateGroupTitle}
                    onUpdateGroup={updateGroup}
                    onUngroup={ungroupDraft}
                    onUpdateTitle={updateExerciseTitle}
                    onSelectLibrary={(idx, exerciseId) => {
                      selectLibraryExercise(idx, exerciseId);
                      setFocusedExerciseDraftId("");
                    }}
                    onPreviewVideo={setPreviewExercise}
                    onUploadVideo={setUploadExerciseIndex}
                    onRemove={removeDraftExercise}
                    onUpdateExercise={updateDraftExercise}
                    onGroupAdjacent={groupAdjacentDraft}
                    exerciseRowRefs={exerciseRowRefs}
                    titleInputRefs={titleInputRefs}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
        <button
          type="button"
          onClick={addExerciseDraft}
          className="mt-2 w-full rounded-lg border border-dashed border-[#E6EBF1] bg-white/70 py-2 text-xs font-medium text-slate-500 hover:border-slate-300 hover:bg-white"
        >
          + упражнение
        </button>
      </div>

      <div className="mt-2 flex justify-end gap-1.5 border-t border-[#EEF1F4] pt-2">
        <button
          type="button"
          onClick={cancelEdit}
          className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={applyDay}
          className="rounded-full bg-brand-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-primary/90"
        >
          Готово
        </button>
      </div>

      <LkExerciseEditorModal
        open={uploadExerciseIndex !== null}
        mode="create"
        initialTitle={uploadExerciseIndex !== null ? draftWorkout.exercises[uploadExerciseIndex]?.exerciseTitle || "" : ""}
        onClose={() => setUploadExerciseIndex(null)}
        onSaved={(createdExercise) => {
          if (uploadExerciseIndex !== null) attachCreatedExercise(uploadExerciseIndex, createdExercise);
          setUploadExerciseIndex(null);
        }}
      />

      {previewExercise ? <ExerciseVideoPreviewModal exercise={previewExercise} onClose={() => setPreviewExercise(null)} /> : null}
    </>
  );
}
