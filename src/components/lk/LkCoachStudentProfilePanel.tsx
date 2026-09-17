"use client";

import { useEffect, useRef, useState } from "react";

type CoachStudentProfile = {
  clientId: string;
  fio: string | null;
  email: string | null;
  balance: number | null;
  currency: string | null;
  finalDay: string | null;
  city: string | null;
  birthDate: string | null;
  weightKg: number | null;
  heightCm: number | null;
  avatarUrl: string | null;
};

type ProfileResponse = {
  ok?: boolean;
  student?: CoachStudentProfile;
};

type Props = {
  studentId: string;
};

function isStudentProfile(value: unknown): value is CoachStudentProfile {
  if (!value || typeof value !== "object") return false;

  const profile = value as Partial<CoachStudentProfile>;
  return typeof profile.clientId === "string";
}

function formatDate(raw: string | null) {
  const value = String(raw || "").trim();
  if (!value) return "—";

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "—";

  return `${match[3]}.${match[2]}.${match[1]}`;
}

function formatNumber(value: number | null, suffix = "") {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";

  const formatted = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
  }).format(value);
  return suffix ? `${formatted} ${suffix}` : formatted;
}

function formatBalance(balance: number | null, currency: string | null) {
  if (typeof balance !== "number" || !Number.isFinite(balance)) return "—";

  const formatted = formatNumber(balance);
  const normalizedCurrency = String(currency || "").trim();
  if (!normalizedCurrency) return formatted;
  if (normalizedCurrency.toUpperCase() === "RUB") return `${formatted} ₽`;

  return `${formatted} ${normalizedCurrency}`;
}

function displayValue(value: string | null) {
  return String(value || "").trim() || "—";
}

function initialsFor(profile: CoachStudentProfile | null) {
  const fio = String(profile?.fio || "").trim();
  if (fio) {
    const letters = fio
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
    return letters || "?";
  }

  const email = String(profile?.email || "").trim();
  return email ? email[0].toUpperCase() : "?";
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

export function LkCoachStudentProfilePanel({ studentId }: Props) {
  const [profile, setProfile] = useState<CoachStudentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    async function loadProfile() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(`/api/lk/coach/students/${studentId}/profile`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = (await response.json().catch(() => null)) as ProfileResponse | null;

        if (!response.ok || json?.ok !== true || !isStudentProfile(json.student)) {
          throw new Error("profile_load_failed");
        }

        if (controller.signal.aborted || requestRef.current !== requestId) return;
        setProfile(json.student);
        setAvatarFailed(false);
      } catch {
        if (controller.signal.aborted || requestRef.current !== requestId) return;
        setError("Не удалось загрузить данные ученика.");
      } finally {
        if (!controller.signal.aborted && requestRef.current === requestId) {
          setLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      controller.abort();
    };
  }, [studentId, retryKey]);

  const showAvatarImage = Boolean(profile?.avatarUrl && !avatarFailed);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-lg font-semibold text-slate-500">
            {showAvatarImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile?.avatarUrl || ""}
                alt=""
                className="h-full w-full object-cover"
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <span>{initialsFor(profile)}</span>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Данные ученика</p>
            <h3 className="mt-1 text-xl font-semibold text-slate-950">
              {displayValue(profile?.fio || null)}
            </h3>
            <p className="mt-1 text-sm text-slate-500">{displayValue(profile?.email || null)}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setRetryKey((value) => value + 1)}
          disabled={loading}
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Обновляем..." : "Повторить"}
        </button>
      </div>

      {error ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {loading && !profile ? (
        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
          Загружаем данные ученика...
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ProfileField label="Имя и фамилия" value={displayValue(profile?.fio || null)} />
          <ProfileField label="Email" value={displayValue(profile?.email || null)} />
          <ProfileField label="Баланс" value={formatBalance(profile?.balance ?? null, profile?.currency ?? null)} />
          <ProfileField label="Доступ до" value={formatDate(profile?.finalDay ?? null)} />
          <ProfileField label="Город" value={displayValue(profile?.city || null)} />
          <ProfileField label="Дата рождения" value={formatDate(profile?.birthDate ?? null)} />
          <ProfileField label="Вес" value={formatNumber(profile?.weightKg ?? null, "кг")} />
          <ProfileField label="Рост" value={formatNumber(profile?.heightCm ?? null, "см")} />
        </div>
      )}
    </section>
  );
}
