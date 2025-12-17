"use client";

import { useEffect, useState } from "react";

const COOKIE_KEY = "idc_cookie_consent";
const COUNTER_ID = 105882814;
const CONSENT_EVENT = "idc:cookie-consent";

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

function writeConsent(analytics: boolean) {
  localStorage.setItem(
    COOKIE_KEY,
    JSON.stringify({ analytics, date: new Date().toISOString() })
  );

  // сообщаем всем слушателям (в т.ч. YandexMetrika), что согласие обновилось
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CONSENT_EVENT));
  }
}

function applyYmConsent(analyticsAllowed: boolean) {
  // если ym уже загружен — переключаем consent прямо сейчас
  if (typeof window !== "undefined" && (window as any).ym) {
    (window as any).ym(
      COUNTER_ID,
      "consent",
      analyticsAllowed ? "grant" : "revoke"
    );
  }
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-8 w-14 items-center rounded-full",
        "border border-white/15 transition-colors",
        checked ? "bg-brand-primary" : "bg-white/10",
        "focus:outline-none focus:ring-2 focus:ring-brand-primary/60",
        "overflow-hidden", // важно: ничего не вылезает
      ].join(" ")}
    >
      <span
        className={[
          "absolute left-1 top-1 h-6 w-6 rounded-full bg-white shadow",
          "transition-transform duration-200",
          checked ? "translate-x-6" : "translate-x-0",
        ].join(" ")}
      />
    </button>
  );
}

export function CookieBanner() {
  const [isBannerVisible, setIsBannerVisible] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [analyticsAllowed, setAnalyticsAllowed] = useState(false);

  useEffect(() => {
    const saved = readConsent();

    if (!saved) {
      setIsBannerVisible(true);
      setAnalyticsAllowed(false);
      return;
    }

    setIsBannerVisible(false);
    setAnalyticsAllowed(Boolean(saved.analytics));

    // если ранее было разрешено — просто синхронизируем consent (скрипт загрузит YandexMetrika)
    applyYmConsent(Boolean(saved.analytics));
  }, []);

  function acceptAll() {
    writeConsent(true);
    setAnalyticsAllowed(true);
    applyYmConsent(true);

    setIsBannerVisible(false);
    setIsSettingsOpen(false);
  }

  function openSettings() {
    setIsSettingsOpen(true);
  }

  function closeSettings() {
    setIsSettingsOpen(false);
  }

  function saveSettings() {
    writeConsent(analyticsAllowed);
    applyYmConsent(analyticsAllowed);

    setIsBannerVisible(false);
    setIsSettingsOpen(false);
  }

  // если баннер не нужен и модалка закрыта — ничего не рендерим
  if (!isBannerVisible && !isSettingsOpen) return null;

  return (
    <>
      {/* Баннер (справа снизу) */}
      {isBannerVisible && (
        <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] sm:max-w-sm">
          <div className="rounded-3xl border border-white/10 bg-brand-dark/80 backdrop-blur-xl shadow-2xl px-5 py-4">
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
        </div>
      )}

      {/* Модалка настроек */}
      {isSettingsOpen && (
        <div
          className="fixed inset-0 z-[70] bg-black/60 p-4 sm:p-0 flex items-center justify-center"
          onClick={closeSettings}
        >
          <div
            className="w-full max-w-lg rounded-3xl bg-brand-dark border border-white/10 p-5 sm:p-6 shadow-xl
                       max-h-[calc(100dvh-2rem)] overflow-y-auto
                       pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="text-lg sm:text-xl font-semibold">
                Настройки файлов cookie
              </h2>

              <button
                type="button"
                onClick={closeSettings}
                className="rounded-full bg-white/5 p-1 text-brand-muted hover:bg-white/10 hover:text-white transition-colors"
                aria-label="Закрыть"
              >
                <span className="block h-4 w-4 leading-none">✕</span>
              </button>
            </div>

            <div className="space-y-4 text-sm sm:text-base text-white/80 leading-relaxed">
              <p>
                <span className="font-semibold text-white">
                  I Do Calisthenics использует технические файлы cookie
                </span>
                , необходимые для работы сайта и его базовых функций. Мы также
                хотели бы использовать{" "}
                <span className="font-semibold text-white">
                  аналитические cookie
                </span>
                , чтобы понимать, как пользователи взаимодействуют с сайтом и
                улучшать его работу. Вы можете в любой момент изменить свой
                выбор.
                <br />
                Подробнее — в{" "}
                <a
                  href="/cookie-policy"
                  className="text-brand-primary underline decoration-dotted underline-offset-2 hover:text-white transition-colors"
                >
                  Политике использования файлов cookie
                </a>
                .
              </p>

              {/* Технические */}
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-white">
                      Технические
                    </p>
                    <p className="text-sm text-brand-muted mt-0.5">
                      Всегда разрешено
                    </p>
                  </div>

                  <span className="text-xs text-brand-muted mt-2">
                    всегда активны
                  </span>
                </div>

                <p className="mt-3 text-sm text-brand-muted leading-relaxed">
                  Эти файлы cookie необходимы для корректной работы сайта I Do
                  Calisthenics. Они обеспечивают базовые функции: навигацию,
                  безопасность, авторизацию, сохранение сессии. Без них сайт
                  может работать нестабильно, поэтому они активны по умолчанию
                  и не требуют согласия пользователя.
                </p>
              </div>

              {/* Аналитические */}
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-white">
                      Аналитические
                    </p>
                    <p className="text-sm text-brand-muted mt-0.5">
                      {analyticsAllowed ? "Разрешено" : "Запрещено"}
                    </p>
                  </div>

                  <Toggle
                    checked={analyticsAllowed}
                    onChange={setAnalyticsAllowed}
                  />
                </div>

                <p className="mt-3 text-sm text-brand-muted leading-relaxed">
                  Эти cookie помогают нам понимать, как пользователи
                  взаимодействуют с сайтом: какие страницы посещаются, сколько
                  времени проводят на сайте, откуда приходит трафик. Информация
                  собирается обезличенно и используется только для улучшения
                  структуры и функциональности сайта I Do Calisthenics.
                </p>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row gap-2">
                <button
                  onClick={acceptAll}
                  className="w-full sm:w-auto rounded-full bg-brand-primary px-5 py-2.5 text-sm font-semibold hover:bg-brand-primary/90 transition-colors"
                >
                  Разрешить все
                </button>

                <button
                  onClick={saveSettings}
                  className="w-full sm:w-auto rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-white/90 hover:bg-white/10 hover:text-white transition-colors"
                >
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
