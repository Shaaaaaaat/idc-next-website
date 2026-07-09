"use client";

import Link from "next/link";
import { useLkUnsavedChangesOptional } from "@/components/lk/LkUnsavedChangesContext";

type LkRole = "admin" | "coach" | "client" | "guest";
type LkNavItem = { href: string; label: string; disabled?: boolean };

export function LkShellTopNav({ items, activeHref }: { items: LkNavItem[]; activeHref?: string }) {
  const { confirmLeave } = useLkUnsavedChangesOptional();

  return (
    <nav className="mb-4 flex gap-2 overflow-x-auto pb-1">
      {items.map((item) => {
        const isActive = activeHref === item.href;
        if (item.disabled) {
          return (
            <span
              key={item.label}
              className="inline-flex shrink-0 cursor-not-allowed items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-400"
            >
              {item.label}
            </span>
          );
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={(e) => {
              if (!confirmLeave()) e.preventDefault();
            }}
            className={`inline-flex shrink-0 items-center justify-center rounded-full px-4 py-2 text-sm transition-colors ${
              isActive
                ? "bg-brand-primary text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function LkShellSidebar({
  role,
  items,
  activeHref,
}: {
  role: LkRole;
  items: LkNavItem[];
  activeHref?: string;
}) {
  const { confirmLeave } = useLkUnsavedChangesOptional();
  const badge = role === "admin" ? "A" : role === "coach" ? "C" : "P";
  const profileLabel = role === "coach" ? "Профиль тренера" : "Профиль";

  return (
    <aside className="hidden min-h-[calc(100vh-2rem)] flex-col justify-between rounded-3xl bg-[#1f1d2b] p-4 text-white shadow-xl md:flex">
      <div>
        <div className="mb-8 flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-primary text-lg font-semibold shadow-lg shadow-brand-primary/20">
          {badge}
        </div>
        <nav className="space-y-1">
          {items.map((item) => {
            const isActive = activeHref === item.href;
            if (item.disabled) {
              return (
                <span
                  key={item.label}
                  className="block cursor-not-allowed rounded-xl px-3 py-2 text-sm text-white/35"
                >
                  {item.label}
                </span>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={(e) => {
                  if (!confirmLeave()) e.preventDefault();
                }}
                className={`block rounded-xl px-3 py-2 text-sm transition-colors ${
                  isActive ? "bg-white/10 text-white ring-1 ring-white/10" : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="space-y-1 border-t border-white/10 pt-4">
        <span className="block cursor-not-allowed rounded-xl px-3 py-2 text-sm text-white/35">
          Уведомления
        </span>
        <span className="block cursor-not-allowed rounded-xl px-3 py-2 text-sm text-white/35">
          {profileLabel}
        </span>
      </div>
    </aside>
  );
}

export function LkShellLogoutLink() {
  const { confirmLeave } = useLkUnsavedChangesOptional();

  return (
    <a
      href="/lk/logout"
      onClick={(e) => {
        if (!confirmLeave()) e.preventDefault();
      }}
      className="inline-flex items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100"
    >
      Выйти
    </a>
  );
}
