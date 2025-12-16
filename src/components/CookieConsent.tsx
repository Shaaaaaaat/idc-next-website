// src/components/CookieConsent.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Script from "next/script";

type Consent = {
  analytics: boolean;
  updatedAt: number;
};

const STORAGE_KEY = "idc_cookie_consent_v1";
const METRIKA_ID = 105882814;

function readConsent(): Consent | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Consent;
    if (typeof parsed?.analytics !== "boolean") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeConsent(consent: Consent) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
}

export function CookieConsent() {
  const [consent, setConsent] = useState<Consent | null>(null);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // локальные настройки внутри модалки
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);

  // аккордеоны как на скрине
  const [openTech, setOpenTech] = useState(true);
  const [openAnalytics, setOpenAnalytics] = useState(false);

  useEffect(() => {
    const existing = readConsent();
    setConsent(existing);
    if (!existing) setBannerOpen(true);
    if (existing) setAnalyticsEnabled(existing.analytics);
  }, []);

  const metrikaAllowed = !!consent?.analytics;

  const policyHref = "/cookie-policy";

  function acceptAll() {
    const next: Consent = { analytics: true, updatedAt: Date.now() };
    writeConsent(next);
    setConsent(next);
    setAnalyticsEnabled(true);
    setBannerOpen(false);
    setSettingsOpen(false);
  }

  function openSettings() {
    setSettingsOpen(true);
    setBannerOpen(false);
  }

  function saveSettings() {
    const next: Consent = { analytics: analyticsEnabled, updatedAt: Date.now() };
    writeConsent(next);
    setConsent(next);
    setSettingsOpen(false);
    setBannerOpen(false);
  }

  function closeSettingsOnly() {
    // если пользователь просто закрыл настройки и согласия ещё нет — вернём баннер
    setSettingsOpen(false);
    if (!consent) setBannerOpen(true);
  }

  // Тексты — как ты прислал
  const bannerTitle = "I Do Calisthenics использует файлы cookie";
  const bannerText =
    "Они необходимы для оптимальной работы сайтов и сервисов. Подробнее прочитайте в";
  const bannerLinkText = "Политике использования файлов cookie";

  const modalTitle = "Настройки файлов cookie";
  const modalIntro =
    "I Do Calisthenics использует технические файлы cookie, необходимые для работы сайта и его базовых функций. Мы также хотели бы использовать аналитические cookie, чтобы понимать, как пользователи взаимодействуют с сайтом и улучшать его работу. Вы можете в любой момент изменить свой выбор. Подробнее — в";

  const techTitle = "Технические, всегда активны";
  const techDesc =
    "Эти файлы cookie необходимы для корректной работы сайта I Do Calisthenics. Они обеспечивают базовые функции: навигацию, безопасность, авторизацию, сохранение сессии. Без них сайт может работать нестабильно, поэтому они активны по умолчанию и не требуют согласия пользователя.";

  const analyticsTitle = "Аналитические";
  const analyticsDesc =
    "Эти cookie помогают нам понимать, как пользователи взаимодействуют с сайтом: какие страницы посещаются, сколько времени проводят на сайте, откуда приходит трафик.\nИнформация собирается обезличенно и используется только для улучшения структуры и функциональности сайта I Do Calisthenics.";

  return (
    <>
      {/* Метрика — только после согласия на аналитические */}
      {metrikaAllowed && (
        <>
          <Script
            id="yandex-metrika"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `
                (function(m,e,t,r,i,k,a){
                    m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
                    m[i].l=1*new Date();
                    for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
                    k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
                })(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=${METRIKA_ID}', 'ym');

                ym(${METRIKA_ID}, 'init', {
                  ssr:true,
                  webvisor:true,
                  clickmap:true,
                  ecommerce:"dataLayer",
                  accurateTrackBounce:true,
                  trackLinks:true
                });
              `,
            }}
          />
          {/* noscript тоже только при согласии */}
          <noscript>
            <div>
              <img
                src={`https://mc.yandex.ru/watch/${METRIKA_ID}`}
                style={{ position: "absolute", left: "-9999px" }}
                alt=""
              />
            </div>
          </noscript>
        </>
      )}

      {/* Баннер */}
      {bannerOpen && (
        <div className="fixed inset-x-0 bottom-0 z-[60] px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4">
          <div className="mx-auto max-w-3xl rounded-2xl bg-white text-black shadow-[0_20px_80px_rgba(0,0,0,0.35)] border border-black/10 px-5 py-4">
            <div className="text-[22px] sm:text-2xl font-semibold leading-snug">
              {bannerTitle}
            </div>
            <p className="mt-2 text-sm sm:text-base text-black/75">
              {bannerText}{" "}
              <a
                href={policyHref}
                className="text-fuchsia-600 underline decoration-fuchsia-400 underline-offset-2"
              >
                {bannerLinkText}
              </a>
            </p>

            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={acceptAll}
                className="rounded-xl bg-black px-5 py-3 text-white text-sm sm:text-base font-medium"
              >
                Разрешить все
              </button>

              <button
                type="button"
                onClick={openSettings}
                className="text-sm sm:text-base font-medium text-black/80 hover:text-black"
              >
                Настроить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка настроек */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4"
          onClick={closeSettingsOnly}
        >
          <div
            className="w-full max-w-3xl max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl bg-white text-black shadow-[0_30px_120px_rgba(0,0,0,0.45)] border border-black/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-6 sm:px-8 sm:py-8">
              <div className="text-3xl sm:text-4xl font-semibold">
                {modalTitle}
              </div>

              <p className="mt-4 text-base sm:text-lg text-black/80 leading-relaxed">
                {modalIntro}{" "}
                <a
                  href={policyHref}
                  className="text-fuchsia-600 underline decoration-fuchsia-400 underline-offset-2"
                >
                  {bannerLinkText}
                </a>
              </p>

              <div className="mt-8 border-t border-black/10" />

              {/* Технические */}
              <div className="py-5 border-b border-black/10">
                <button
                  type="button"
                  onClick={() => setOpenTech((v) => !v)}
                  className="w-full flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl leading-none select-none">
                      {openTech ? "–" : "+"}
                    </span>
                    <span className="text-xl sm:text-2xl font-semibold">
                      {techTitle}
                    </span>
                  </div>

                  <span className="text-sm sm:text-base text-blue-600">
                    Всегда разрешено
                  </span>
                </button>

                {openTech && (
                  <p className="mt-4 text-base sm:text-lg text-black/65 leading-relaxed">
                    {techDesc}
                  </p>
                )}
              </div>

              {/* Аналитические */}
              <div className="py-5 border-b border-black/10">
                <button
                  type="button"
                  onClick={() => setOpenAnalytics((v) => !v)}
                  className="w-full flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl leading-none select-none">
                      {openAnalytics ? "–" : "+"}
                    </span>
                    <span className="text-xl sm:text-2xl font-semibold">
                      {analyticsTitle}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-sm sm:text-base text-black/50">
                      {analyticsEnabled ? "Разрешено" : "Запрещено"}
                    </span>

                    {/* простой тумблер */}
                    <button
                      type="button"
                      aria-label="Переключить аналитические cookie"
                      onClick={() => setAnalyticsEnabled((v) => !v)}
                      className={[
                        "relative h-8 w-14 rounded-full transition-colors border border-black/10",
                        analyticsEnabled ? "bg-black" : "bg-black/20",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "absolute top-1/2 -translate-y-1/2 h-6 w-6 rounded-full bg-white shadow transition-transform",
                          analyticsEnabled ? "translate-x-7" : "translate-x-1",
                        ].join(" ")}
                      />
                    </button>
                  </div>
                </button>

                {openAnalytics && (
                  <p className="mt-4 whitespace-pre-line text-base sm:text-lg text-black/65 leading-relaxed">
                    {analyticsDesc}
                  </p>
                )}
              </div>

              <div className="pt-6">
                <button
                  type="button"
                  onClick={saveSettings}
                  className="w-full rounded-xl bg-black px-5 py-4 text-white text-base font-medium"
                >
                  Согласиться
                </button>

                <button
                  type="button"
                  onClick={closeSettingsOnly}
                  className="mt-3 w-full text-center text-sm text-black/60 hover:text-black"
                >
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
