import { redirect } from "next/navigation";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import { LkAccessDenied } from "@/components/lk/LkAccessDenied";
import { LkShell } from "@/components/lk/LkShell";
import { LkExerciseLibraryManager } from "@/components/lk/LkExerciseLibraryManager";
import { listActiveExercises } from "@/lib/supabase/exerciseLibrary";

export default async function LkCoachExercisesPage() {
  const email = await getValidatedSessionEmail();
  if (!email) redirect("/lk/login");

  const access = await resolveLkAccessByEmail(email);
  if (access.type === "admin" || access.type === "client") {
    redirect("/lk");
  }
  if (access.type === "deny") {
    return <LkAccessDenied />;
  }

  const exercises = await listActiveExercises();

  return (
    <LkShell
      role="coach"
      title="Библиотека упражнений"
      subtitle="Глобальная база упражнений с видео для программ учеников"
      activeHref="/lk/coach/exercises"
    >
      <LkExerciseLibraryManager exercises={exercises} />
    </LkShell>
  );
}
