import { redirect } from "next/navigation";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import { LkAccessDenied } from "@/components/lk/LkAccessDenied";
import { getAdminStudentsForAdminLk } from "@/lib/supabase/coachStudents";
import { LkAdminStudentsTable } from "@/components/lk/LkAdminStudentsTable";
import { LkInfoCard, LkShell } from "@/components/lk/LkShell";

export default async function LkAdminPage() {
  const email = await getValidatedSessionEmail();
  if (!email) redirect("/lk/login");

  const access = await resolveLkAccessByEmail(email);
  if (access.type === "coach" || access.type === "client") {
    redirect("/lk");
  }
  if (access.type === "deny") {
    return <LkAccessDenied />;
  }

  const sb = await getAdminStudentsForAdminLk();
  const activeStudents = sb.ok ? sb.activeStudents : [];
  const allStudents = sb.ok ? sb.allStudents : [];
  if (!sb.ok) {
    console.warn("[lk/admin] Supabase admin students failed");
  }

  return (
    <LkShell
      role="admin"
      title="Кабинет администратора"
      subtitle="Сводка активных учеников и контроль баланса"
      activeHref="/lk/admin"
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <LkInfoCard label="Email" value={access.email} />
          <LkInfoCard label="Активных учеников" value={activeStudents.length} />
          <LkInfoCard label="Всего клиентов" value={allStudents.length} />
        </div>
        <div>
          <p className="mb-3 text-sm text-slate-500">
            Сводная таблица активных клиентов и быстрые фильтры.
          </p>
          <LkAdminStudentsTable activeStudents={activeStudents} allStudents={allStudents} />
        </div>
      </div>
    </LkShell>
  );
}

