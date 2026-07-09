import "server-only";

import { getCoachByEmail, type CoachProfileRow } from "@/lib/supabase/coachStudents";

export type CoachAccessLevel = "coach" | "head_coach";
export type LkResourceActor = {
  email: string;
  lkRole: "coach" | "admin";
  coachId?: string;
  coachAccessLevel: CoachAccessLevel | null;
};
export type LkOwnerType = "own" | "global" | "other";

type OwnedByCoachResource = {
  coachId?: string | null;
  createdByCoachId?: string | null;
};

function normalizeAccessLevel(raw: unknown): CoachAccessLevel {
  return raw === "head_coach" ? "head_coach" : "coach";
}

export function actorFromCoach(coach: CoachProfileRow): LkResourceActor {
  return {
    email: coach.email,
    lkRole: "coach",
    coachId: coach.id,
    coachAccessLevel: normalizeAccessLevel(coach.access_level),
  };
}

export async function getCoachResourceActor(email: string): Promise<LkResourceActor | null> {
  const coach = await getCoachByEmail(email);
  return coach ? actorFromCoach(coach) : null;
}

export function isPrivilegedActor(actor: LkResourceActor): boolean {
  return actor.lkRole === "admin" || actor.coachAccessLevel === "head_coach";
}

export function canManageGlobalResources(actor: LkResourceActor): boolean {
  return isPrivilegedActor(actor);
}

function ownerId(resource: OwnedByCoachResource): string {
  return String(resource.coachId || resource.createdByCoachId || "").trim();
}

export function getOwnerType(actor: LkResourceActor | null, resource: OwnedByCoachResource): LkOwnerType {
  const owner = ownerId(resource);
  if (!owner) return "global";
  return actor?.coachId && owner === actor.coachId ? "own" : "other";
}

function canMutateOwnedResource(actor: LkResourceActor, resource: OwnedByCoachResource): boolean {
  if (isPrivilegedActor(actor)) return true;
  const owner = ownerId(resource);
  return Boolean(owner && actor.coachId && owner === actor.coachId);
}

export function canReadExercise(actor: LkResourceActor, exercise: OwnedByCoachResource): boolean {
  if (isPrivilegedActor(actor)) return true;
  const owner = ownerId(exercise);
  return !owner || Boolean(actor.coachId && owner === actor.coachId);
}

export function canEditExercise(actor: LkResourceActor, exercise: OwnedByCoachResource): boolean {
  return canMutateOwnedResource(actor, exercise);
}

export function canArchiveExercise(actor: LkResourceActor, exercise: OwnedByCoachResource): boolean {
  return canMutateOwnedResource(actor, exercise);
}

export function canReadProgram(actor: LkResourceActor, program: OwnedByCoachResource): boolean {
  if (isPrivilegedActor(actor)) return true;
  const owner = ownerId(program);
  return !owner || Boolean(actor.coachId && owner === actor.coachId);
}

export function canEditProgram(actor: LkResourceActor, program: OwnedByCoachResource): boolean {
  return canMutateOwnedResource(actor, program);
}

export function canArchiveProgram(actor: LkResourceActor, program: OwnedByCoachResource): boolean {
  return canMutateOwnedResource(actor, program);
}
