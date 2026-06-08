import { redirect } from "next/navigation";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import { LkAccessDenied } from "@/components/lk/LkAccessDenied";
import { LkShell } from "@/components/lk/LkShell";
import { LkProgramLibrary } from "@/components/lk/LkProgramLibrary";
import { getCoachStudentsForCoachLkByEmail } from "@/lib/supabase/coachStudents";
import { listProgramTemplates, verifyProgramTemplateSchema } from "@/lib/supabase/programTemplates";

export default async function LkCoachProgramsPage() {
  const email = await getValidatedSessionEmail();
  if (!email) redirect("/lk/login");

  const access = await resolveLkAccessByEmail(email);
  if (access.type === "admin" || access.type === "client") redirect("/lk");
  if (access.type === "deny") return <LkAccessDenied />;

  const schema = await verifyProgramTemplateSchema(access.email);
  if (!schema.ok) {
    console.warn("[lk/coach/programs] schema check failed", schema.message || schema.reason);
  }

  const [programs, studentsResult] = await Promise.all([
    listProgramTemplates(access.email),
    getCoachStudentsForCoachLkByEmail(access.email),
  ]);

  return (
    <LkShell
      role="coach"
      title="Программы"
      subtitle="Библиотека reusable training systems"
      activeHref="/lk/coach/programs"
    >
      <LkProgramLibrary programs={programs} students={studentsResult.ok ? studentsResult.students : []} />
    </LkShell>
  );
}
