"use client";

import { useSyncExternalStore } from "react";

export type WorkoutClipboardSource = "program" | "calendar";

export type WorkoutClipboardGroup = {
  clipboardGroupId: string;
  title: string;
  sets: string;
  rest: string;
  notes: string;
  sortOrder: number;
};

export type WorkoutClipboardExercise = {
  exerciseId: string;
  groupClipboardId?: string;
  exerciseTitle: string;
  sets: string;
  reps: string;
  rest: string;
  tempo: string;
  notes: string;
  sortOrder: number;
};

export type WorkoutClipboardWorkout = {
  title: string;
  summary: string;
  coachComment: string;
  estimatedMinutes: string;
  workoutType: string;
  groups: WorkoutClipboardGroup[];
  exercises: WorkoutClipboardExercise[];
};

export type WorkoutClipboard = {
  version: 1;
  source: WorkoutClipboardSource;
  workout: WorkoutClipboardWorkout;
};

let currentClipboard: WorkoutClipboard | null = null;
const listeners = new Set<() => void>();

function cloneClipboard(clipboard: WorkoutClipboard): WorkoutClipboard {
  return {
    version: 1,
    source: clipboard.source,
    workout: {
      title: clipboard.workout.title,
      summary: clipboard.workout.summary,
      coachComment: clipboard.workout.coachComment,
      estimatedMinutes: clipboard.workout.estimatedMinutes,
      workoutType: clipboard.workout.workoutType,
      groups: clipboard.workout.groups.map((group) => ({ ...group })),
      exercises: clipboard.workout.exercises.map((exercise) => ({ ...exercise })),
    },
  };
}

function emitClipboardChange() {
  listeners.forEach((listener) => listener());
}

export function copyWorkoutClipboard(clipboard: WorkoutClipboard) {
  currentClipboard = cloneClipboard(clipboard);
  emitClipboardChange();
}

export function getWorkoutClipboard() {
  return currentClipboard ? cloneClipboard(currentClipboard) : null;
}

function getWorkoutClipboardSnapshot() {
  return currentClipboard;
}

export function clearWorkoutClipboard() {
  if (!currentClipboard) return;
  currentClipboard = null;
  emitClipboardChange();
}

export function subscribeWorkoutClipboard(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWorkoutClipboard() {
  return useSyncExternalStore(subscribeWorkoutClipboard, getWorkoutClipboardSnapshot, getWorkoutClipboardSnapshot);
}
