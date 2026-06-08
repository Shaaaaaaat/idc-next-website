import { notFound, redirect } from "next/navigation";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import { LkAccessDenied } from "@/components/lk/LkAccessDenied";
import { LkExerciseVideoClient } from "@/components/lk/LkExerciseVideoClient";
import { getActiveExerciseById } from "@/lib/supabase/exerciseLibrary";

type PageProps = {
  params: Promise<{ exerciseId: string }>;
};

export default async function LkExerciseVideoPage({ params }: PageProps) {
  const email = await getValidatedSessionEmail();
  if (!email) redirect("/lk/login");

  const access = await resolveLkAccessByEmail(email);
  if (access.type !== "coach" && access.type !== "admin") {
    return <LkAccessDenied />;
  }

  const { exerciseId } = await params;
  const exercise = await getActiveExerciseById(exerciseId);
  if (!exercise) notFound();

  const role = access.type === "admin" ? "admin" : "coach";
  const backHref = access.type === "admin" ? "/lk/admin" : "/lk/coach/exercises";

  return (
    <LkExerciseVideoClient
      role={role}
      exercise={exercise}
      backHref={backHref}
      canEdit={access.type === "coach"}
    />
  );
}
