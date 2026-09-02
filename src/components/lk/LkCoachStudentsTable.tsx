"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CoachStudent } from "@/lib/airtable/coachStudents";

type Props = {
  students: CoachStudent[];
};

function formatDateLabel(raw?: string) {
  const value = String(raw || "").trim();
  if (!value) return "—";
  const d = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function awaitingFeedbackLabel(count?: number) {
  const value = Number(count || 0);
  if (!Number.isFinite(value) || value <= 0) return null;

  const lastTwo = value % 100;
  const last = value % 10;
  let noun = "тренировок";

  if (lastTwo < 11 || lastTwo > 14) {
    if (last === 1) noun = "тренировка";
    if (last >= 2 && last <= 4) noun = "тренировки";
  }

  const verb = noun === "тренировка" ? "ждёт" : "ждут";

  return `${value} ${noun} ${verb} ответа`;
}

export function LkCoachStudentsTable({ students }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.name.toLowerCase().includes(q));
  }, [students, query]);

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="students-search" className="mb-2 block text-sm text-slate-600">
          Поиск ученика
        </label>
        <input
          id="students-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Введите имя..."
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/20"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500 shadow-sm">
          Ученики не найдены.
        </div>
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {filtered.map((s) => {
              const feedbackLabel = awaitingFeedbackLabel(s.awaitingFeedbackCount);

              return (
                <Link
                  key={s.id}
                  href={`/lk/coach/students/${encodeURIComponent(s.id)}`}
                  className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:bg-slate-50"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <p className="text-base font-medium">{s.name}</p>
                    {feedbackLabel ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                        {feedbackLabel}
                      </span>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-xs text-slate-500">Ближайшая тренировка</p>
                      <p className="mt-0.5 text-slate-600">{formatDateLabel(s.nextWorkoutAt)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-xs text-slate-500">Баланс</p>
                      <p className="mt-0.5 text-slate-600">{s.balance}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-xs text-slate-500">Дата окончания</p>
                      <p className="mt-0.5 text-slate-600">{formatDateLabel(s.finalDay)}</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:block">
            <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr] bg-slate-100 px-4 py-3 text-xs uppercase tracking-[0.12em] text-slate-500">
              <div>Имя</div>
              <div>Ближайшая тренировка</div>
              <div>Баланс</div>
              <div>Дата окончания</div>
            </div>
            <div className="divide-y divide-slate-100">
              {filtered.map((s) => {
                const feedbackLabel = awaitingFeedbackLabel(s.awaitingFeedbackCount);

                return (
                  <Link
                    key={s.id}
                    href={`/lk/coach/students/${encodeURIComponent(s.id)}`}
                    className="grid grid-cols-[1.6fr_1fr_1fr_1fr] px-4 py-3 text-sm text-slate-950 transition-colors hover:bg-slate-50"
                  >
                    <div className="flex flex-wrap items-center gap-2 pr-2 break-words">
                      <span>{s.name}</span>
                      {feedbackLabel ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                          {feedbackLabel}
                        </span>
                      ) : null}
                    </div>
                    <div className="pr-2 break-words text-slate-600">{formatDateLabel(s.nextWorkoutAt)}</div>
                    <div className="pr-2 break-words text-slate-600">{s.balance}</div>
                    <div className="break-words text-slate-600">{formatDateLabel(s.finalDay)}</div>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

