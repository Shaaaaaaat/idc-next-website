import type { ReactNode } from "react";
import { LkShellLogoutLink, LkShellSidebar, LkShellTopNav } from "@/components/lk/LkShellNav";

type LkRole = "admin" | "coach" | "client" | "guest";

type LkNavItem = { href: string; label: string; disabled?: boolean };

type LkShellProps = {
  role: LkRole;
  title: string;
  subtitle?: string;
  children: ReactNode;
  topRight?: ReactNode;
  nav?: LkNavItem[];
  activeHref?: string;
  hideHeader?: boolean;
};

const roleLabel: Record<LkRole, string> = {
  admin: "Админ",
  coach: "Тренер",
  client: "Клиент",
  guest: "Гость",
};

function defaultNavItems(role: LkRole) {
  if (role === "admin") return [{ href: "/lk/admin", label: "Ученики" }];
  if (role === "coach") {
    return [
      { href: "/lk/coach", label: "Ученики" },
      { href: "/lk/coach/exercises", label: "Упражнения" },
      { href: "/lk/coach/programs", label: "Программы" },
      { href: "#", label: "Команда", disabled: true },
    ];
  }
  if (role === "client") return [{ href: "/lk", label: "Профиль" }];
  return [{ href: "/lk/login", label: "Вход" }];
}

function HeaderBlock({
  role,
  title,
  subtitle,
  topRight,
  authed,
}: {
  role: LkRole;
  title: string;
  subtitle?: string;
  topRight?: ReactNode;
  authed: boolean;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-slate-950 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:rounded-3xl sm:p-6">
      <div className="min-w-0">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">
          Личный кабинет
        </p>
        <div className="flex items-center gap-2">
          <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
          <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] text-slate-500">
            {roleLabel[role]}
          </span>
        </div>
        {subtitle ? <p className="mt-2 text-sm text-slate-500">{subtitle}</p> : null}
      </div>

      <div className="flex items-center gap-2">
        {topRight}
        {authed ? <LkShellLogoutLink /> : null}
      </div>
    </div>
  );
}

export function LkShell({ role, title, subtitle, children, topRight, nav, activeHref, hideHeader }: LkShellProps) {
  const items = nav || defaultNavItems(role);
  const authed = role !== "guest";

  if (authed) {
    return (
      <main className="min-h-screen bg-[#f5f6fb] text-slate-950">
        <section className="grid w-full gap-4 px-4 py-4 md:min-h-screen md:grid-cols-[220px_minmax(0,1fr)]">
          <LkShellSidebar role={role} items={items} activeHref={activeHref} />
          <div className="min-w-0">
            {hideHeader ? null : (
              <HeaderBlock role={role} title={title} subtitle={subtitle} topRight={topRight} authed={authed} />
            )}
            <div className="md:hidden">
              <LkShellTopNav items={items} activeHref={activeHref} />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
              {children}
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-brand-dark text-white">
      <section className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <HeaderBlock role={role} title={title} subtitle={subtitle} topRight={topRight} authed={authed} />
        <LkShellTopNav items={items} activeHref={activeHref} />

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:rounded-3xl sm:p-6">{children}</div>
      </section>
    </main>
  );
}

export function LkInfoCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="mb-1 text-xs text-slate-500">{label}</p>
      <p className="text-sm text-slate-950 sm:text-base">{value}</p>
    </div>
  );
}

