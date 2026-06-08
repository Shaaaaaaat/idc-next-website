import { notFound, redirect } from "next/navigation";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import { LkAccessDenied } from "@/components/lk/LkAccessDenied";
import { LkShell } from "@/components/lk/LkShell";
import { LkProgramEditor } from "@/components/lk/LkProgramEditor";
import { getCoachStudentsForCoachLkByEmail } from "@/lib/supabase/coachStudents";
import { listActiveExercises } from "@/lib/supabase/exerciseLibrary";
import { getProgramTemplate } from "@/lib/supabase/programTemplates";

type PageProps = {
  params: Promise<{ programId: string }>;
};

export default async function LkCoachProgramPage({ params }: PageProps) {
  const email = await getValidatedSessionEmail();
  if (!email) redirect("/lk/login");

  const access = await resolveLkAccessByEmail(email);
  if (access.type === "admin" || access.type === "client") redirect("/lk");
  if (access.type === "deny") return <LkAccessDenied />;

  const { programId } = await params;
  const [programResult, exercises, studentsResult] = await Promise.all([
    getProgramTemplate(access.email, programId),
    listActiveExercises(),
    getCoachStudentsForCoachLkByEmail(access.email),
  ]);

  if (!programResult.ok) {
    if (programResult.reason === "not_found") notFound();
    return <LkAccessDenied />;
  }

  return (
    <LkShell
      role="coach"
      title={programResult.data.title}
      subtitle="Timeline тренировочной системы без реальных дат"
      activeHref="/lk/coach/programs"
      hideHeader
    >
      <LkProgramEditor
        program={programResult.data}
        exerciseLibrary={exercises}
        students={studentsResult.ok ? studentsResult.students : []}
      />
    </LkShell>
  );
}
