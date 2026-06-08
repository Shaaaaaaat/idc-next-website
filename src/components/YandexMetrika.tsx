"use client";

import Script from "next/script";
import { useEffect, useMemo, useState } from "react";

const METRIKA_ID = Number(process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID);

// должен совпадать с CookieBanner / CookieConsent
const CONSENT_KEY = "idc_cookie_consent";

// событие, которое мы будем диспатчить из CookieBanner при любом изменении настроек
const CONSENT_EVENT = "idc:cookie-consent";

type ConsentState = {
  analytics?: boolean;
  date?: string;
};

function readConsent(): ConsentState | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ConsentState;
  } catch {
    return null;
  }
}

export function YandexMetrika() {
  const [enabled, setEnabled] = useState(false);

  // читаем согласие при старте + подписываемся на изменения
  useEffect(() => {
    const apply = () => {
      const c = readConsent();
      const nextEnabled = c?.analytics === true;
      setEnabled(nextEnabled);

      // если Метрика уже загружена, переключаем consent без перезагрузки
      if (typeof window !== "undefined" && (window as any).ym) {
        (window as any).ym(
          METRIKA_ID,
          "consent",
          nextEnabled ? "grant" : "revoke"
        );
      }
    };

    apply();

    // изменения из этого же таба (мы будем диспатчить вручную)
    window.addEventListener(CONSENT_EVENT, apply);

    // изменения из других вкладок
    const onStorage = (e: StorageEvent) => {
      if (e.key === CONSENT_KEY) apply();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(CONSENT_EVENT, apply);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Страховка от повторной вставки кода
  const scriptCode = useMemo(() => {
    return `
(function(m,e,t,r,i,k,a){
  m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
  m[i].l=1*new Date();
  for (var j = 0; j < document.scripts.length; j++) { if (document.scripts[j].src === r) { return; } }
  k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
})(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=${METRIKA_ID}', 'ym');

ym(${METRIKA_ID}, 'init', {
  ssr: true,
  webvisor: true,
  clickmap: true,
  ecommerce: "dataLayer",
  referrer: document.referrer,
  url: location.href,
  accurateTrackBounce: true,
  trackLinks: true
});


// сразу фиксируем согласие как GRANT (мы сюда попадаем только если enabled=true)
ym(${METRIKA_ID}, 'consent', 'grant');
`;
  }, [METRIKA_ID]);

  if (!Number.isFinite(METRIKA_ID) || !enabled) {
    if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
      const reason = !Number.isFinite(METRIKA_ID)
        ? `env: NEXT_PUBLIC_YANDEX_METRIKA_ID=${process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID}`
        : `consent: ${localStorage.getItem(CONSENT_KEY) ?? "нет"}`;
      console.warn("[YandexMetrika] Скрипт не грузится:", reason);
    }
    return null;
  }

  return (
    <>
      <Script id="yandex-metrika" strategy="afterInteractive">
        {scriptCode}
      </Script>

      {/* noscript тут скорее формальность (без JS баннер тоже не покажется), но пусть будет */}
      <noscript>
        <div>
          <img
            src={"https://mc.yandex.ru/watch/" + METRIKA_ID}
            style={{ position: "absolute", left: "-9999px" }}
            alt=""
          />
        </div>
      </noscript>
    </>
  );
}
