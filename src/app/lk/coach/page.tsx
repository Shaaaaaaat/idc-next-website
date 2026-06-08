import { redirect } from "next/navigation";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import { LkAccessDenied } from "@/components/lk/LkAccessDenied";
import { getCoachStudentsForCoachLkByEmail } from "@/lib/supabase/coachStudents";
import { LkCoachStudentsTable } from "@/components/lk/LkCoachStudentsTable";
import { LkShell } from "@/components/lk/LkShell";

export default async function LkCoachPage() {
  const email = await getValidatedSessionEmail();
  if (!email) redirect("/lk/login");

  const access = await resolveLkAccessByEmail(email);
  if (access.type === "admin" || access.type === "client") {
    redirect("/lk");
  }
  if (access.type === "deny") {
    return <LkAccessDenied />;
  }

  const sb = await getCoachStudentsForCoachLkByEmail(access.email);
  const students = sb.ok ? sb.students : [];
  if (!sb.ok) {
    console.warn("[lk/coach] Supabase coach students failed");
  }

  return (
    <LkShell role="coach" title="Кабинет тренера" subtitle="Твои активные ученики" activeHref="/lk/coach">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Ученики</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">Список учеников</h2>
            <p className="mt-2 text-sm text-slate-500">
              Ближайшие тренировки, баланс и быстрый переход в карточку.
            </p>
          </div>
          <span className="inline-flex w-fit items-center rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600">
            {students.length} активных
          </span>
        </div>
        <LkCoachStudentsTable students={students} />
      </div>
    </LkShell>
  );
}

