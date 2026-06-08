import { LkLoginForm } from "@/components/lk/LkLoginForm";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { redirect } from "next/navigation";
import { LkShell } from "@/components/lk/LkShell";

type LoginPageProps = {
  searchParams?:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
};

function getFirstValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

export default async function LkLoginPage({ searchParams }: LoginPageProps) {
  const sessionEmail = await getValidatedSessionEmail();
  if (sessionEmail) {
    redirect("/lk?already=1");
  }

  const params = await Promise.resolve(searchParams ?? {});
  const sent = getFirstValue(params.sent) === "1";
  const invalid = getFirstValue(params.invalid) === "1";
  const expired = getFirstValue(params.expired) === "1";

  return (
    <LkShell
      role="guest"
      title="Вход по ссылке"
      subtitle="Введи email, мы отправим одноразовую ссылку для входа."
      activeHref="/lk/login"
    >
      <LkLoginForm />

      {(sent || invalid || expired) && (
        <div className="mt-4 space-y-2">
          {sent ? (
            <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-brand-muted">
              Если такой email есть в системе, мы отправили ссылку.
            </p>
          ) : null}
          {invalid ? (
            <p className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              Ссылка недействительна. Запроси новую.
            </p>
          ) : null}
          {expired ? (
            <p className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              Срок действия ссылки истек. Отправь новую ссылку входа.
            </p>
          ) : null}
        </div>
      )}
    </LkShell>
  );
}

