import { redirect } from "next/navigation";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import { LkAccessDenied } from "@/components/lk/LkAccessDenied";
import { getAdminActiveStudents } from "@/lib/airtable/coachStudents";
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

  const students = await getAdminActiveStudents();

  return (
    <LkShell
      role="admin"
      title="Кабинет администратора"
      subtitle="Сводка активных учеников и контроль баланса"
      activeHref="/lk/admin"
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <LkInfoCard label="Email" value={access.email} />
          <LkInfoCard label="Активных учеников" value={students.length} />
        </div>
        <div>
          <p className="mb-3 text-sm text-slate-500">
            Сводная таблица активных клиентов и быстрые фильтры.
          </p>
          <LkAdminStudentsTable students={students} />
        </div>
      </div>
    </LkShell>
  );
}

