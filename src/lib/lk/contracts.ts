export type LkRole = "admin" | "coach" | "client";

export type LkStudentSummary = {
  id: string;
  name: string;
  finalDay: string;
  balance: string;
};

export type TrainingStatus = "draft" | "active" | "completed";

export type LkTrainingBlock = {
  id: string;
  title: string;
  status: TrainingStatus;
  weekLabel: string;
  notes?: string;
};

export type LkChecklistItem = {
  id: string;
  label: string;
  done: boolean;
};

export const TRAINING_STATUS_LABEL: Record<TrainingStatus, string> = {
  draft: "Черновик",
  active: "Активно",
  completed: "Завершено",
};

