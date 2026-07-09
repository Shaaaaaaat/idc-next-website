"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProgramTemplate } from "@/lib/supabase/programTemplates";

type Props = {
  programs: ProgramTemplate[];
};

function formatUpdated(raw?: string) {
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

function programSearchText(program: ProgramTemplate) {
  return [
    program.title,
    program.description,
    program.level,
    program.goal,
    `${program.durationDays} дней`,
    `${program.weeksCount} недель`,
    ...program.tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function LkProgramLibrary({ programs }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [openMenuId, setOpenMenuId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredPrograms = useMemo(() => {
    if (!normalizedQuery) return programs;
    return programs.filter((program) => programSearchText(program).includes(normalizedQuery));
  }, [normalizedQuery, programs]);

  useEffect(() => {
    if (!openMenuId) return;

    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpenMenuId("");
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenMenuId("");
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenuId]);

  async function createProgram() {
    const title = window.prompt("Название новой программы", "Новая программа");
    if (!title?.trim()) return;

    setCreating(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/lk/coach/programs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const json = (await res.json().catch(() => null)) as { program?: ProgramTemplate; message?: string; error?: string } | null;
      if (!res.ok || !json?.program) throw new Error(json?.message || json?.error || "Не удалось создать программу.");
      router.push(`/lk/coach/programs/${json.program.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать программу.");
    } finally {
      setCreating(false);
    }
  }

  async function duplicateProgram(program: ProgramTemplate) {
    setOpenMenuId("");
    setBusyId(program.id);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/lk/coach/programs/${program.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "duplicate" }),
      });
      const json = (await res.json().catch(() => null)) as { program?: ProgramTemplate; message?: string; error?: string } | null;
      if (!res.ok || !json?.program) throw new Error(json?.message || json?.error || "Не удалось дублировать программу.");
      setSuccess("Программа продублирована.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось дублировать программу.");
    } finally {
      setBusyId("");
    }
  }

  async function deleteProgram(program: ProgramTemplate) {
    if (!program.canArchive) return;
    setOpenMenuId("");
    if (!window.confirm(`Скрыть программу "${program.title}"?`)) return;

    setBusyId(program.id);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/lk/coach/programs/${program.id}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!res.ok) throw new Error(json?.message || json?.error || "Не удалось скрыть программу.");
      setSuccess("Программа скрыта из библиотеки.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось скрыть программу.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Библиотека систем</p>
          <h2 className="mt-1 text-2xl font-semibold text-slate-950">Программы</h2>
          <p className="mt-2 text-sm text-slate-500">
            Reusable training plans для микроциклов, назначения и быстрых правок.
          </p>
        </div>
        <button
          type="button"
          onClick={createProgram}
          disabled={creating}
          className="inline-flex items-center justify-center rounded-full bg-brand-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand-primary/20 transition-colors hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {creating ? "Создаем..." : "+ Новая программа"}
        </button>
      </section>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-h-11 flex-1 rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none transition-colors focus:border-brand-primary"
          placeholder="Поиск по названию, тегам, уровню, цели или длительности"
        />
        <span className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-500">
          {filteredPrograms.length} из {programs.length}
        </span>
      </div>

      {error ? <p className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {success ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</p>
      ) : null}

      {programs.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center">
          <h3 className="text-lg font-semibold text-slate-950">Создайте первую программу</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Начните с пустого timeline, затем добавьте недели, дни и тренировки.
          </p>
          <button
            type="button"
            onClick={createProgram}
            className="mt-5 rounded-full bg-brand-primary px-5 py-2 text-sm font-semibold text-white"
          >
            + Новая программа
          </button>
        </div>
      ) : filteredPrograms.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
          По запросу “{query.trim()}” программ не найдено.
        </p>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {filteredPrograms.map((program) => (
            <article
              key={program.id}
              className="group rounded-3xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-px hover:border-slate-300 hover:shadow-lg"
            >
              <div className="flex items-start justify-between gap-3">
                <Link href={`/lk/coach/programs/${program.id}`} className="min-w-0 flex-1">
                  <h3 className="truncate text-lg font-semibold text-slate-950">{program.title}</h3>
                  {program.isGlobal ? (
                    <span className="mt-2 inline-flex rounded-full bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-700">
                      Общий шаблон
                    </span>
                  ) : null}
                </Link>
                <div className="relative" ref={openMenuId === program.id ? menuRef : undefined}>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenMenuId((current) => (current === program.id ? "" : program.id));
                    }}
                    className="cursor-pointer rounded-full px-2 py-1 text-xl leading-none text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                    aria-haspopup="menu"
                    aria-expanded={openMenuId === program.id}
                    aria-label={`Действия для ${program.title}`}
                  >
                    ⋯
                  </button>
                  {openMenuId === program.id ? (
                    <div className="absolute right-0 z-20 mt-1 w-44 rounded-2xl border border-slate-200 bg-white p-1 text-sm shadow-xl">
                      <button
                        type="button"
                        onClick={() => duplicateProgram(program)}
                        disabled={busyId === program.id}
                        className="block w-full rounded-xl px-3 py-2 text-left text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      >
                        Дублировать
                      </button>
                      {program.canArchive ? (
                        <button
                          type="button"
                          onClick={() => deleteProgram(program)}
                          disabled={busyId === program.id}
                          className="block w-full rounded-xl px-3 py-2 text-left text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          Скрыть
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              <Link href={`/lk/coach/programs/${program.id}`} className="mt-4 grid grid-cols-3 gap-2 text-sm">
                <span className="rounded-2xl bg-slate-50 px-3 py-2">
                  <span className="block text-xs text-slate-400">Длительность</span>
                  <span className="font-semibold text-slate-800">{program.durationDays} дней</span>
                </span>
                <span className="rounded-2xl bg-slate-50 px-3 py-2">
                  <span className="block text-xs text-slate-400">Тренировки</span>
                  <span className="font-semibold text-slate-800">{program.workoutsCount}</span>
                </span>
                <span className="rounded-2xl bg-slate-50 px-3 py-2">
                  <span className="block text-xs text-slate-400">Обновлено</span>
                  <span className="font-semibold text-slate-800">{formatUpdated(program.updatedAt)}</span>
                </span>
              </Link>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {[program.level, program.goal, ...program.tags].filter(Boolean).slice(0, 5).map((tag) => (
                  <span key={String(tag)} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                    {tag}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}

    </div>
  );
}
