import { redirect } from "next/navigation";
import { resolveLkAccessByEmail } from "@/lib/auth/lkAccess";
import { LkAccessDenied } from "@/components/lk/LkAccessDenied";
import { getValidatedSessionEmail } from "@/lib/auth/lkSession";
import { LkInfoCard, LkShell } from "@/components/lk/LkShell";

export default async function LkPage() {
  const email = await getValidatedSessionEmail();
  if (!email) {
    redirect("/lk/login");
  }

  const access = await resolveLkAccessByEmail(email);

  if (access.type === "admin") {
    redirect("/lk/admin");
  }
  if (access.type === "coach") {
    redirect("/lk/coach");
  }
  if (access.type === "deny") {
    return <LkAccessDenied />;
  }

  return (
    <LkShell role="client" title="Профиль" subtitle="Краткая сводка по доступу и балансу" activeHref="/lk">
      <div className="grid gap-3 sm:grid-cols-3">
        <LkInfoCard label="Email" value={access.client.email} />
        <LkInfoCard label="Баланс" value={access.client.balance} />
        <LkInfoCard label="Доступ до" value={access.client.finalDay} />
      </div>
    </LkShell>
  );
}

