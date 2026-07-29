"use client";

import { useEffect, useMemo, useState } from "react";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

type ConsumeState = "checking" | "opening" | "invalid";

function tokenFromLocation() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("token")?.trim() || "";
}

function clearTokenFromAddressBar() {
  if (typeof window === "undefined") return;
  window.history.replaceState(null, "", window.location.pathname);
}

export default function MobileConsumePage() {
  const [state, setState] = useState<ConsumeState>("checking");
  const [token, setToken] = useState("");

  const deepLink = useMemo(() => {
    if (!TOKEN_RE.test(token)) return "";
    return `studentapp://consume?token=${encodeURIComponent(token)}`;
  }, [token]);

  useEffect(() => {
    const rawToken = tokenFromLocation();
    clearTokenFromAddressBar();

    if (!TOKEN_RE.test(rawToken)) {
      setState("invalid");
      return;
    }

    setToken(rawToken);
    setState("opening");
  }, []);

  useEffect(() => {
    if (!deepLink || state !== "opening") return;
    window.location.assign(deepLink);
  }, [deepLink, state]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-dark px-4 py-10 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-6 text-center shadow-2xl shadow-black/20">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brand-muted">
          Student App
        </p>
        <h1 className="mt-3 text-2xl font-semibold">
          {state === "invalid" ? "Ссылка недействительна" : "Открываем приложение..."}
        </h1>

        {state === "checking" ? (
          <p className="mt-3 text-sm text-brand-muted">Проверяем ссылку...</p>
        ) : null}

        {state === "opening" ? (
          <div className="mt-5 space-y-4">
            <p className="text-sm text-brand-muted">
              Если приложение не открылось автоматически, нажми кнопку ниже.
            </p>
            <a
              href={deepLink}
              className="inline-flex w-full items-center justify-center rounded-full bg-brand-primary px-4 py-3 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50"
            >
              Открыть приложение
            </a>
          </div>
        ) : null}

        {state === "invalid" ? (
          <p className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            Ссылка отсутствует или некорректна. Запроси новую ссылку входа.
          </p>
        ) : null}
      </section>
    </main>
  );
}
