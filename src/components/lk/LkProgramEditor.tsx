"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
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
import type { CoachStudent } from "@/lib/airtable/coachStudents";
import type { ExerciseLibraryItem } from "@/lib/supabase/exerciseLibrary";
import type { ProgramTemplate, ProgramTemplateWorkout } from "@/lib/supabase/programTemplates";

type DraftExercise = {
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
  students: CoachStudent[];
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
      draftId: group.id,
      title: group.title,
      sets: group.sets || "",
      rest: group.rest || "",
      notes: group.notes || "",
      sortOrder: group.sortOrder,
    })),
    exercises: workout.exercises.map((exercise) => ({
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

function cloneWorkout(workout: DraftWorkout, index: number): DraftWorkout {
  const groupIdMap = new Map<string, string>();
  const groups = workout.groups.map((group) => {
    const draftId = createDraftId();
    groupIdMap.set(group.draftId, draftId);
    return { ...group, draftId };
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
      draftId: createDraftId(),
      groupDraftId: exercise.groupDraftId ? groupIdMap.get(exercise.groupDraftId) : undefined,
    })),
  };
}

function exerciseSummary(workout: DraftWorkout) {
  const titles = workout.exercises.map((exercise) => exercise.exerciseTitle).filter(Boolean);
  if (titles.length === 0) return workout.summary || "Пустой день";
  return titles.slice(0, 3).join(" · ") + (titles.length > 3 ? ` +${titles.length - 3}` : "");
}

function workoutDensity(workout: DraftWorkout) {
  if (workout.exercises.length >= 6) return "min-h-36";
  if (workout.exercises.length >= 3) return "min-h-30";
  return "min-h-24";
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

function SortableWorkoutCard({
  workout,
  onOpen,
  onDuplicate,
  onCopy,
  onPasteAfter,
  canPaste,
}: {
  workout: DraftWorkout;
  onOpen: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onPasteAfter: () => void;
  canPaste: boolean;
}) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id: workout.draftId,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`group rounded-3xl border border-slate-200 bg-white p-3 shadow-sm transition-all hover:-translate-y-px hover:shadow-lg ${workoutDensity(workout)} ${
        isDragging ? "relative z-30 scale-[1.01] shadow-2xl" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="cursor-grab rounded-xl px-2 py-1 text-lg leading-none text-slate-300 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
          aria-label="Перетащить день"
          {...attributes}
          {...listeners}
        >
          ☰
        </button>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className="text-xs font-semibold text-slate-400">Day {workout.dayNumber}</p>
          <h3 className="mt-1 line-clamp-1 font-semibold text-slate-950">{workout.title}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-slate-500">{exerciseSummary(workout)}</p>
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            {workout.workoutType ? <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-500">{workout.workoutType}</span> : null}
            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-500">{workout.exercises.length} упр.</span>
            {workout.estimatedMinutes ? (
              <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-500">{workout.estimatedMinutes} мин</span>
            ) : null}
          </div>
        </button>
        <details className="relative">
          <summary className="list-none rounded-full px-2 py-1 text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            ⋯
          </summary>
          <div className="absolute right-0 z-20 mt-1 w-44 rounded-2xl border border-slate-200 bg-white p-1 text-sm shadow-xl">
            <button type="button" onClick={onOpen} className="block w-full rounded-xl px-3 py-2 text-left text-slate-700 hover:bg-slate-100">
              Открыть
            </button>
            <button type="button" onClick={onDuplicate} className="block w-full rounded-xl px-3 py-2 text-left text-slate-700 hover:bg-slate-100">
              Дублировать
            </button>
            <button type="button" onClick={onCopy} className="block w-full rounded-xl px-3 py-2 text-left text-slate-700 hover:bg-slate-100">
              Копировать
            </button>
            {canPaste ? (
              <button type="button" onClick={onPasteAfter} className="block w-full rounded-xl px-3 py-2 text-left text-slate-700 hover:bg-slate-100">
                Вставить после
              </button>
            ) : null}
          </div>
        </details>
      </div>
    </article>
  );
}

export function LkProgramEditor({ program, exerciseLibrary, students }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(program.title);
  const [description, setDescription] = useState(program.description || "");
  const [durationDays, setDurationDays] = useState(String(program.durationDays || 7));
  const [weeksCount, setWeeksCount] = useState(String(program.weeksCount || 1));
  const [level, setLevel] = useState(program.level || "");
  const [goal, setGoal] = useState(program.goal || "");
  const [tags, setTags] = useState(program.tags.join(", "));
  const [workouts, setWorkouts] = useState<DraftWorkout[]>((program.workouts || []).map(workoutToDraft));
  const [editingId, setEditingId] = useState("");
  const [copiedWorkout, setCopiedWorkout] = useState<DraftWorkout | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [clientId, setClientId] = useState(students[0]?.id || "");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
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
  const editing = workouts.find((workout) => workout.draftId === editingId) || null;

  function normalizeTimeline(nextWorkouts: DraftWorkout[]) {
    return nextWorkouts.map((workout, index) => ({
      ...workout,
      sortOrder: index,
      dayNumber: index + 1,
      weekNumber: Math.ceil((index + 1) / 7),
    }));
  }

  function updateWorkout(draftId: string, patch: Partial<DraftWorkout>) {
    setWorkouts((current) => current.map((workout) => (workout.draftId === draftId ? { ...workout, ...patch } : workout)));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setWorkouts((current) => {
      const oldIndex = current.findIndex((workout) => workout.draftId === active.id);
      const newIndex = current.findIndex((workout) => workout.draftId === over.id);
      if (oldIndex < 0 || newIndex < 0) return current;
      return normalizeTimeline(arrayMove(current, oldIndex, newIndex));
    });
  }

  function addWorkout() {
    setWorkouts((current) => {
      const next = [...current, emptyWorkout(current.length)];
      setEditingId(next[next.length - 1].draftId);
      return next;
    });
  }

  function duplicateWorkout(draftId: string) {
    setWorkouts((current) => {
      const index = current.findIndex((workout) => workout.draftId === draftId);
      if (index < 0) return current;
      const next = [...current];
      next.splice(index + 1, 0, cloneWorkout(current[index], index + 1));
      return normalizeTimeline(next);
    });
  }

  function duplicateWeek(weekNumber: number) {
    setWorkouts((current) => {
      const source = current.filter((workout) => workout.weekNumber === weekNumber);
      if (source.length === 0) return current;
      const next = [
        ...current,
        ...source.map((workout, index) =>
          cloneWorkout({ ...workout, weekNumber: Math.max(...current.map((item) => item.weekNumber), 0) + 1 }, current.length + index)
        ),
      ];
      return normalizeTimeline(next);
    });
  }

  function pasteAfter(draftId: string) {
    if (!copiedWorkout) return;
    setWorkouts((current) => {
      const index = current.findIndex((workout) => workout.draftId === draftId);
      if (index < 0) return current;
      const next = [...current];
      next.splice(index + 1, 0, cloneWorkout(copiedWorkout, index + 1));
      return normalizeTimeline(next);
    });
  }

  function updateEditingExercise(index: number, patch: Partial<DraftExercise>) {
    if (!editing) return;
    const exercises = editing.exercises.map((exercise, idx) => (idx === index ? { ...exercise, ...patch } : exercise));
    updateWorkout(editing.draftId, { exercises });
  }

  function selectExercise(index: number, exerciseId: string) {
    const exercise = exerciseLibrary.find((item) => item.id === exerciseId);
    updateEditingExercise(index, {
      exerciseId,
      exerciseTitle: exercise?.title || "",
    });
  }

  function addExercise() {
    if (!editing) return;
    updateWorkout(editing.draftId, {
      exercises: [...editing.exercises, emptyExercise(editing.exercises.length)],
    });
  }

  function groupAdjacent(index: number) {
    if (!editing) return;
    const first = editing.exercises[index];
    const second = editing.exercises[index + 1];
    if (!first || !second || first.groupDraftId || second.groupDraftId) return;
    const draftId = createDraftId();
    updateWorkout(editing.draftId, {
      groups: [
        ...editing.groups,
        { draftId, title: `Комбо ${editing.groups.length + 1}`, sets: "", rest: "", notes: "", sortOrder: index },
      ],
      exercises: editing.exercises.map((exercise, idx) =>
        idx === index || idx === index + 1 ? { ...exercise, groupDraftId: draftId, sets: "", rest: "" } : exercise
      ),
    });
  }

  function ungroup(groupDraftId: string) {
    if (!editing) return;
    updateWorkout(editing.draftId, {
      groups: editing.groups.filter((group) => group.draftId !== groupDraftId),
      exercises: editing.exercises.map((exercise) =>
        exercise.groupDraftId === groupDraftId ? { ...exercise, groupDraftId: undefined } : exercise
      ),
    });
  }

  async function saveProgram() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/lk/coach/programs/${program.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          durationDays,
          weeksCount,
          level,
          goal,
          tags,
          workouts: sortedWorkouts.map((workout, workoutIndex) => ({
            id: workout.id,
            dayNumber: workout.dayNumber,
            weekNumber: workout.weekNumber,
            title: workout.title,
            summary: workout.summary,
            estimatedMinutes: workout.estimatedMinutes,
            workoutType: workout.workoutType,
            sortOrder: workoutIndex,
            groups: workout.groups.map((group) => ({
              draftId: group.draftId,
              title: group.title,
              sets: group.sets,
              rest: group.rest,
              notes: group.notes,
              sortOrder: group.sortOrder,
            })),
            exercises: workout.exercises.map((exercise, exerciseIndex) => ({
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
      const json = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!res.ok) throw new Error(json?.message || json?.error || "Не удалось сохранить программу.");
      setSuccess("Программа сохранена.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить программу.");
    } finally {
      setSaving(false);
    }
  }

  async function assignProgram() {
    setAssigning(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/lk/coach/programs/${program.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, startDate }),
      });
      const json = (await res.json().catch(() => null)) as { createdWorkouts?: number; message?: string; error?: string } | null;
      if (!res.ok) throw new Error(json?.message || json?.error || "Не удалось назначить программу.");
      setAssignOpen(false);
      setSuccess(`Программа назначена. Создано тренировок: ${json?.createdWorkouts ?? 0}.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось назначить программу.");
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <Link href="/lk/coach/programs" className="text-sm font-medium text-slate-400 hover:text-brand-primary">
            ← Все программы
          </Link>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-2 block w-full border-0 bg-transparent p-0 text-2xl font-semibold text-slate-950 outline-none"
          />
          <p className="mt-1 text-sm text-slate-500">
            {durationDays || 0} дней · {weeksCount || 0} недель · {workouts.length} тренировок
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setClientId(students[0]?.id || "");
              setAssignOpen(true);
            }}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            Назначить
          </button>
          <button
            type="button"
            onClick={addWorkout}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            + Добавить тренировку
          </button>
          <button
            type="button"
            onClick={saveProgram}
            disabled={saving}
            className="rounded-full bg-brand-primary px-5 py-2 text-sm font-semibold text-white hover:bg-brand-primary/90 disabled:opacity-60"
          >
            {saving ? "Сохраняем..." : "Сохранить"}
          </button>
        </div>
      </div>

      <section className="grid gap-3 lg:grid-cols-5">
        <label className="space-y-1 text-sm lg:col-span-2">
          <span className="text-slate-500">Описание</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-24 w-full rounded-2xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-primary"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Дней</span>
          <input value={durationDays} onChange={(e) => setDurationDays(e.target.value)} className="w-full rounded-2xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-primary" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Недель</span>
          <input value={weeksCount} onChange={(e) => setWeeksCount(e.target.value)} className="w-full rounded-2xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-primary" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-500">Уровень</span>
          <input value={level} onChange={(e) => setLevel(e.target.value)} className="w-full rounded-2xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-primary" />
        </label>
        <label className="space-y-1 text-sm lg:col-span-2">
          <span className="text-slate-500">Цель</span>
          <input value={goal} onChange={(e) => setGoal(e.target.value)} className="w-full rounded-2xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-primary" />
        </label>
        <label className="space-y-1 text-sm lg:col-span-3">
          <span className="text-slate-500">Теги</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} className="w-full rounded-2xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-primary" placeholder="Strength, Beginner" />
        </label>
      </section>

      {error ? <p className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {success ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</p> : null}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sortedWorkouts.map((workout) => workout.draftId)} strategy={verticalListSortingStrategy}>
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
                  <div className="grid min-w-[720px] grid-cols-4 gap-3 xl:grid-cols-7">
                    {weekWorkouts.map((workout) => (
                      <SortableWorkoutCard
                        key={workout.draftId}
                        workout={workout}
                        onOpen={() => setEditingId(workout.draftId)}
                        onDuplicate={() => duplicateWorkout(workout.draftId)}
                        onCopy={() => setCopiedWorkout(workout)}
                        onPasteAfter={() => pasteAfter(workout.draftId)}
                        canPaste={Boolean(copiedWorkout)}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        </SortableContext>
      </DndContext>

      {editing ? (
        <WorkoutEditModal
          workout={editing}
          exerciseLibrary={exerciseLibrary}
          onClose={() => setEditingId("")}
          onUpdate={(patch) => updateWorkout(editing.draftId, patch)}
          onSelectExercise={selectExercise}
          onUpdateExercise={updateEditingExercise}
          onAddExercise={addExercise}
          onRemoveExercise={(index) =>
            updateWorkout(editing.draftId, { exercises: editing.exercises.filter((_, idx) => idx !== index) })
          }
          onGroupAdjacent={groupAdjacent}
          onUngroup={ungroup}
        />
      ) : null}

      {assignOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-3 py-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAssignOpen(false);
          }}
        >
          <div className="w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-950">Назначить программу</h3>
            <p className="mt-1 text-sm text-slate-500">
              {title} · {durationDays || 0} дней · {workouts.length} тренировок
            </p>
            <label className="mt-4 block space-y-1 text-sm">
              <span className="text-slate-500">Ученик</span>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-primary"
              >
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block space-y-1 text-sm">
              <span className="text-slate-500">Дата старта</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-primary"
              />
            </label>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setAssignOpen(false)}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={assignProgram}
                disabled={!clientId || assigning}
                className="rounded-full bg-brand-primary px-5 py-2 text-sm font-semibold text-white hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {assigning ? "Назначаем..." : "Назначить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
  return (
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
          <label className="space-y-1 text-sm">
            <span className="text-slate-500">Day</span>
            <input value={workout.dayNumber} onChange={(e) => onUpdate({ dayNumber: Number(e.target.value) || 1 })} className="w-full rounded-2xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-primary" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-slate-500">Week</span>
            <input value={workout.weekNumber} onChange={(e) => onUpdate({ weekNumber: Number(e.target.value) || 1 })} className="w-full rounded-2xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-primary" />
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
                        <select
                          value={exercise.exerciseId}
                          onChange={(e) => onSelectExercise(index, e.target.value)}
                          className="rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-primary sm:col-span-2"
                        >
                          <option value="">Выбрать упражнение</option>
                          {exerciseLibrary.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.title}
                            </option>
                          ))}
                        </select>
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
  );
}
