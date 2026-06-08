import Link from "next/link";
import { redirect } from "next/navigation";
import { LkShell } from "@/components/lk/LkShell";

type VerifyPageProps = {
  searchParams?:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
};

function getFirstValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

export default async function LkVerifyPage({ searchParams }: VerifyPageProps) {
  const params = await Promise.resolve(searchParams ?? {});
  const token = getFirstValue(params.token).trim();
  const invalid = getFirstValue(params.invalid) === "1";
  const expired = getFirstValue(params.expired) === "1";

  if (token) {
    redirect(`/lk/verify/consume?token=${encodeURIComponent(token)}`);
  }

  return (
    <LkShell
      role="guest"
      title={invalid || expired ? "Ссылка недействительна или устарела" : "Проверь свою почту"}
      subtitle={
        invalid || expired
          ? "Запроси новую ссылку для входа."
          : "Мы отправили ссылку для входа. Открой письмо и перейди по ней."
      }
      activeHref="/lk/login"
    >
      <div className="flex flex-wrap gap-2">
        <Link
          href="/lk/login"
          className="inline-flex items-center justify-center rounded-full bg-brand-primary px-4 py-3 text-sm font-semibold text-white shadow-soft transition-all hover:bg-brand-primary/90 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50"
        >
          Запросить новую
        </Link>
      </div>
    </LkShell>
  );
}

