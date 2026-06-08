"use client";

import { useMemo, useState } from "react";
import type { CoachStudent } from "@/lib/airtable/coachStudents";

type Props = {
  students: CoachStudent[];
};

function parseBalanceNumber(value: string): number | null {
  const raw = String(value || "").trim();
  if (!raw || raw === "—") return null;
  const normalized = raw
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  if (!normalized) return null;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

const NEWCOMER_TAG_ORDER = ["MSC_group_ELF", "MSC_group_YCG", "SPB_group_HKC", "SPB_group_SPI"];

function newcomerTagRank(tag: string | undefined): number {
  const normalized = String(tag || "").trim();
  const index = NEWCOMER_TAG_ORDER.indexOf(normalized);
  return index === -1 ? NEWCOMER_TAG_ORDER.length : index;
}

function parseFuturePlanDate(value: string | undefined): number {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/);
  if (!match) return Number.MAX_SAFE_INTEGER;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const yearRaw = match[3] ? Number(match[3]) : new Date().getFullYear();
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  if (!Number.isFinite(day) || !Number.isFinite(month) || day < 1 || month < 1) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Date.UTC(year, month - 1, day);
}

function isNewcomerGroupStart(students: CoachStudent[], index: number): boolean {
  if (index <= 0) return false;
  return String(students[index]?.tag || "").trim() !== String(students[index - 1]?.tag || "").trim();
}

export function LkAdminStudentsTable({ students }: Props) {
  const [query, setQuery] = useState("");
  const [onlyNegativeBalance, setOnlyNegativeBalance] = useState(false);
  const [onlyNewcomers, setOnlyNewcomers] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result = students.filter((s) => {
      const byName = !q || s.name.toLowerCase().includes(q);
      if (!byName) return false;
      if (onlyNegativeBalance) {
        const b = parseBalanceNumber(s.balance);
        if (b === null || b >= 0) return false;
      }
      if (onlyNewcomers) {
        const futurePlan = String(s.futurePlan || "").trim();
        if (!futurePlan || futurePlan === "—") return false;
      }
      return true;
    });
    if (!onlyNewcomers) return result;
    return [...result].sort((a, b) => {
      const byTag = newcomerTagRank(a.tag) - newcomerTagRank(b.tag);
      const byDate = parseFuturePlanDate(a.futurePlan) - parseFuturePlanDate(b.futurePlan);
      return byTag || byDate || a.name.localeCompare(b.name, "ru");
    });
  }, [students, query, onlyNegativeBalance, onlyNewcomers]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div>
          <label htmlFor="admin-students-search" className="mb-2 block text-sm text-slate-600">
            Поиск ученика
          </label>
          <input
            id="admin-students-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Введите имя..."
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/20"
          />
        </div>
        <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm">
          <input
            type="checkbox"
            checked={onlyNegativeBalance}
            onChange={(e) => setOnlyNegativeBalance(e.target.checked)}
            className="h-4 w-4 accent-brand-primary"
          />
          Только Balance &lt; 0
        </label>
        <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm">
          <input
            type="checkbox"
            checked={onlyNewcomers}
            onChange={(e) => setOnlyNewcomers(e.target.checked)}
            className="h-4 w-4 accent-brand-primary"
          />
          Только новички
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500 shadow-sm">
          Ученики не найдены.
        </div>
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {filtered.map((s, idx) => (
              <article
                key={s.id}
                className={
                  onlyNewcomers && isNewcomerGroupStart(filtered, idx)
                    ? "rounded-xl border border-brand-primary/20 bg-brand-primary/5 p-4 shadow-sm"
                    : "rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                }
              >
                <p className="mb-2 text-base font-medium">{s.name}</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {onlyNewcomers ? (
                    <>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs text-slate-500">Future_plan</p>
                        <p className="mt-0.5 text-slate-600">{s.futurePlan || "—"}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs text-slate-500">Tag</p>
                        <p className="mt-0.5 text-slate-600">{s.tag || "—"}</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs text-slate-500">Дата окончания</p>
                        <p className="mt-0.5 text-slate-600">{s.finalDay}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs text-slate-500">Баланс</p>
                        <p className="mt-0.5 text-slate-600">{s.balance}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs text-slate-500">GR_price</p>
                        <p className="mt-0.5 text-slate-600">{s.grPrice || "—"}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs text-slate-500">DS_price</p>
                        <p className="mt-0.5 text-slate-600">{s.dsPrice || "—"}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs text-slate-500">PR_price</p>
                        <p className="mt-0.5 text-slate-600">{s.prPrice || "—"}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs text-slate-500">SP_price</p>
                        <p className="mt-0.5 text-slate-600">{s.spPrice || "—"}</p>
                      </div>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
            <div className="w-full min-w-0">
              <div
                className={
                  onlyNewcomers
                    ? "grid grid-cols-[1.8fr_1fr_1fr] bg-slate-100 px-4 py-3 text-xs uppercase tracking-[0.08em] text-slate-500"
                    : "grid grid-cols-[1.9fr_1fr_1fr_0.9fr_0.9fr_0.9fr_0.9fr] bg-slate-100 px-4 py-3 text-xs uppercase tracking-[0.08em] text-slate-500"
                }
              >
                <div>Имя</div>
                {onlyNewcomers ? (
                  <>
                    <div>Future_plan</div>
                    <div>Tag</div>
                  </>
                ) : (
                  <>
                    <div>Дата окончания</div>
                    <div>Баланс</div>
                    <div>GR_price</div>
                    <div>DS_price</div>
                    <div>PR_price</div>
                    <div>SP_price</div>
                  </>
                )}
              </div>

              <div className="divide-y divide-slate-100">
                {filtered.map((s, idx) => (
                  <div
                    key={s.id}
                    className={
                      onlyNewcomers
                        ? `grid grid-cols-[1.8fr_1fr_1fr] px-4 py-3 text-sm ${
                            isNewcomerGroupStart(filtered, idx) ? "bg-brand-primary/5" : ""
                          }`
                        : "grid grid-cols-[1.9fr_1fr_1fr_0.9fr_0.9fr_0.9fr_0.9fr] px-4 py-3 text-sm"
                    }
                  >
                    <div className="pr-2 break-words">{s.name}</div>
                    {onlyNewcomers ? (
                      <>
                        <div className="pr-2 break-words text-slate-600">{s.futurePlan || "—"}</div>
                        <div className="break-words text-slate-600">{s.tag || "—"}</div>
                      </>
                    ) : (
                      <>
                        <div className="pr-2 break-words text-slate-600">{s.finalDay}</div>
                        <div className="pr-2 break-words text-slate-600">{s.balance}</div>
                        <div className="pr-2 break-words text-slate-600">{s.grPrice || "—"}</div>
                        <div className="pr-2 break-words text-slate-600">{s.dsPrice || "—"}</div>
                        <div className="pr-2 break-words text-slate-600">{s.prPrice || "—"}</div>
                        <div className="break-words text-slate-600">{s.spPrice || "—"}</div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

