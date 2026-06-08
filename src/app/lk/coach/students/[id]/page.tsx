import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import { LkAccessDenied } from "@/components/lk/LkAccessDenied";
import { LkInfoCard, LkShell } from "@/components/lk/LkShell";
import { LkStudentCalendar } from "@/components/lk/LkStudentCalendar";
import { getCoachStudentByIdForCoach } from "@/lib/supabase/coachStudents";
import { getCoachWorkoutsForStudent } from "@/lib/supabase/coachWorkouts";
import { listActiveExercises } from "@/lib/supabase/exerciseLibrary";

type PageProps = {
  params: Promise<{ id: string }>;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatShortDate(raw?: string) {
  const value = String(raw || "").trim();
  if (!value) return "—";
  const d = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

export default async function LkCoachStudentPage({ params }: PageProps) {
  const { id } = await params;
  const email = await getValidatedSessionEmail();
  if (!email) redirect("/lk/login");

  const access = await resolveLkAccessByEmail(email);
  if (access.type === "admin" || access.type === "client") {
    redirect("/lk");
  }
  if (access.type === "deny") {
    return <LkAccessDenied />;
  }

  const student = await getCoachStudentByIdForCoach(access.email, id);
  if (!student) notFound();

  const today = new Date();
  const fromDate = dateKey(new Date(today.getTime() - 56 * MS_PER_DAY));
  const toDate = dateKey(new Date(today.getTime() + 120 * MS_PER_DAY));
  const workouts = await getCoachWorkoutsForStudent({
    studentId: student.id,
    fromDate,
    toDate,
  });
  const exerciseLibrary = await listActiveExercises();

  return (
    <LkShell role="coach" title={student.name} subtitle="Карточка ученика" activeHref="/lk/coach" hideHeader>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Ученик</p>
            <h2 className="mt-1 text-2xl font-semibold">{student.name}</h2>
          </div>
          <Link
            href="/lk/coach"
            className="inline-flex items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100"
          >
            Назад к ученикам
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <LkInfoCard label="Email" value={student.email || "—"} />
          <LkInfoCard label="Баланс" value={student.balance} />
          <LkInfoCard label="Доступ до" value={formatShortDate(student.finalDay)} />
        </div>

        <LkStudentCalendar studentId={student.id} workouts={workouts} exerciseLibrary={exerciseLibrary} />
      </div>
    </LkShell>
  );
}
