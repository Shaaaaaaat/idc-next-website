"use client";

import { useEffect, useState } from "react";

const COOKIE_KEY = "idc_cookie_consent";

export function CookieBanner() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(COOKIE_KEY);
    if (!saved) {
      setIsVisible(true);
    }
  }, []);

  function acceptAll() {
    localStorage.setItem(
      COOKIE_KEY,
      JSON.stringify({
        analytics: true,
        date: new Date().toISOString(),
      })
    );

    // Сообщаем Метрике, что аналитика разрешена
    if (typeof window !== "undefined" && (window as any).ym) {
      (window as any).ym(105882814, "consent", "grant");
    }

    setIsVisible(false);
  }

  function openSettings() {
    alert(
      "Расширенные настройки cookie будут добавлены позже. Сейчас вы можете либо разрешить все cookie, либо отказаться, закрыв баннер."
    );
  }

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] sm:max-w-sm">
      <div className="rounded-3xl border border-white/10 bg-brand-dark/80 backdrop-blur-xl shadow-2xl px-5 py-4">
        <p className="text-sm font-semibold text-white">
          I Do Calisthenics использует файлы cookie
        </p>

        <p className="mt-1 text-[12px] text-brand-muted leading-relaxed">
          Они необходимы для оптимальной работы сайтов и сервисов. Подробнее —
          в{" "}
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
  );
}
