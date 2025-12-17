"use client";

import { useEffect, useState } from "react";

const COOKIE_KEY = "idc_cookie_consent";
const METRIKA_ID = 105882814;

type ConsentState = {
  analytics: boolean;
  date: string;
};

function readConsent(): ConsentState | null {
  try {
    const raw = localStorage.getItem(COOKIE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ConsentState;
  } catch {
    return null;
  }
}

function writeConsent(next: ConsentState) {
  localStorage.setItem(COOKIE_KEY, JSON.stringify(next));
  // чтобы другие компоненты могли отреагировать (если надо)
  window.dispatchEvent(new Event("cookie-consent-updated"));
}

export function CookieBanner() {
  const [isVisible, setIsVisible] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [analyticsAllowed, setAnalyticsAllowed] = useState(false);

  useEffect(() => {
    const saved = readConsent();
    if (!saved) {
      setIsVisible(true);
      setAnalyticsAllowed(false);
    } else {
      setIsVisible(false);
      setIsSettingsOpen(false);
      setAnalyticsAllowed(!!saved.analytics);
    }
  }, []);

  function acceptAll() {
    writeConsent({
      analytics: true,
      date: new Date().toISOString(),
    });

    // Сообщаем Метрике, что аналитика разрешена (если уже загружена)
    if (typeof window !== "undefined" && (window as any).ym) {
      try {
        (window as any).ym(METRIKA_ID, "consent", "grant");
      } catch {}
    }

    setAnalyticsAllowed(true);
    setIsSettingsOpen(false);
    setIsVisible(false);
  }

  function openSettings() {
    const saved = readConsent();
    setAnalyticsAllowed(saved?.analytics ?? false);
    setIsSettingsOpen(true);
    setIsVisible(false);
  }

  function saveSettings() {
    writeConsent({
      analytics: analyticsAllowed,
      date: new Date().toISOString(),
    });

    // Если Метрика уже загружена — можно уведомить
    if (typeof window !== "undefined" && (window as any).ym) {
      try {
        (window as any).ym(
          METRIKA_ID,
          "consent",
          analyticsAllowed ? "grant" : "deny"
        );
      } catch {}
    }

    setIsSettingsOpen(false);
    setIsVisible(false);
  }

  function closeAll() {
    // Закрыть без аналитики (технические всегда остаются)
    writeConsent({
      analytics: false,
      date: new Date().toISOString(),
    });

    if (typeof window !== "undefined" && (window as any).ym) {
      try {
        (window as any).ym(METRIKA_ID, "consent", "deny");
      } catch {}
    }

    setAnalyticsAllowed(false);
    setIsSettingsOpen(false);
    setIsVisible(false);
  }

  if (!isVisible && !isSettingsOpen) return null;

  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] sm:max-w-sm">
      {/* БАННЕР */}
      {isVisible && (
        <div className="rounded-3xl border border-white/10 bg-brand-dark/80 backdrop-blur-xl shadow-2xl px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">
                I Do Calisthenics использует файлы cookie
              </p>

              <p className="mt-1 text-[12px] text-brand-muted leading-relaxed">
                Они необходимы для оптимальной работы сайтов и сервисов. Подробнее
                прочитайте в{" "}
                <a
                  href="/cookie-policy"
                  className="text-brand-primary underline decoration-dotted underline-offset-2 hover:text-white transition-colors"
                >
                  Политике использования файлов cookie
                </a>
                .
              </p>
            </div>

            <button
              type="button"
              onClick={closeAll}
              className="shrink-0 h-9 w-9 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors flex items-center justify-center text-white/80"
              aria-label="Закрыть"
            >
              ✕
            </button>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              onClick={acceptAll}
              className="flex-1 rounded-full bg-brand-primary px-4 py-2 text-sm font-semibold hover:bg-brand-primary/90 transition-colors"
            >
              Разрешить все
            </button>

            <button
              onClick={openSettings}
              className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/10 hover:text-white transition-colors"
            >
              Настроить
            </button>
          </div>
        </div>
      )}

      {/* НАСТРОЙКИ */}
      {isSettingsOpen && (
        <div className="rounded-3xl border border-white/10 bg-brand-dark/90 backdrop-blur-xl shadow-2xl px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">
                Настройки файлов cookie
              </p>

              <p className="mt-1 text-[12px] text-brand-muted leading-relaxed">
                <span className="font-semibold text-white">
                  I Do Calisthenics использует технические файлы cookie
                </span>
                , необходимые для работы сайта и его базовых функций. Мы также
                хотели бы использовать{" "}
                <span className="font-semibold text-white">
                  аналитические cookie
                </span>
                , чтобы понимать, как пользователи взаимодействуют с сайтом и
                улучшать его работу. Вы можете в любой момент изменить свой выбор.
                Подробнее — в{" "}
                <a
                  href="/cookie-policy"
                  className="text-brand-primary underline decoration-dotted underline-offset-2 hover:text-white transition-colors"
                >
                  Политике использования файлов cookie
                </a>
                .
              </p>
            </div>

            <button
              type="button"
              onClick={closeAll}
              className="shrink-0 h-9 w-9 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors flex items-center justify-center text-white/80"
              aria-label="Закрыть"
            >
              ✕
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {/* Технические */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-white">
                    Технические, всегда активны
                  </div>
                  <div className="mt-1 text-[12px] text-brand-muted">
                    Всегда разрешено
                  </div>
                </div>
                <span className="text-[12px] text-emerald-300/90">
                  Всегда разрешено
                </span>
              </div>

              <p className="mt-3 text-[12px] text-brand-muted leading-relaxed">
                Эти файлы cookie необходимы для корректной работы сайта I Do
                Calisthenics. Они обеспечивают базовые функции: навигацию,
                безопасность, авторизацию, сохранение сессии. Без них сайт может
                работать нестабильно, поэтому они активны по умолчанию и не
                требуют согласия пользователя.
              </p>
            </div>

            {/* Аналитические */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-white">
                    Аналитические
                  </div>
                  <div className="mt-1 text-[12px] text-brand-muted">
                    {analyticsAllowed ? "Разрешено" : "Запрещено"}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setAnalyticsAllowed((v) => !v)}
                  className={[
                    "h-7 w-12 rounded-full border transition-colors relative",
                    analyticsAllowed
                      ? "bg-brand-primary/90 border-brand-primary/50"
                      : "bg-white/5 border-white/15",
                  ].join(" ")}
                  aria-label="Переключить аналитические cookie"
                >
                  <span
                    className={[
                      "absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform",
                      analyticsAllowed ? "translate-x-5" : "translate-x-0.5",
                    ].join(" ")}
                  />
                </button>
              </div>

              <p className="mt-3 text-[12px] text-brand-muted leading-relaxed">
                Эти cookie помогают нам понимать, как пользователи взаимодействуют
                с сайтом: какие страницы посещаются, сколько времени проводят на
                сайте, откуда приходит трафик. Информация собирается обезличенно
                и используется только для улучшения структуры и функциональности
                сайта I Do Calisthenics.
              </p>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={saveSettings}
              className="flex-1 rounded-full bg-brand-primary px-4 py-2 text-sm font-semibold hover:bg-brand-primary/90 transition-colors"
            >
              Согласиться
            </button>

            <button
              onClick={acceptAll}
              className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/10 hover:text-white transition-colors"
            >
              Разрешить все
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
