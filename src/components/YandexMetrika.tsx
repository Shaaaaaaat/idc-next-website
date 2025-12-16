"use client";

import Script from "next/script";
import { useEffect, useState } from "react";

const METRIKA_ID = 105882814;

// ⚠️ ВАЖНО: этот ключ должен совпадать с тем, что пишет твой CookieBanner.
// Если в CookieBanner другое имя — поменяй здесь.
const CONSENT_KEY = "idc_cookie_consent";

export function YandexMetrika() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CONSENT_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (parsed?.analytics === true) setEnabled(true);
    } catch {
      // ignore
    }
  }, []);

  if (!enabled) return null;

  return (
    <>
      <Script id="yandex-metrika" strategy="afterInteractive">
        {`
(function(m,e,t,r,i,k,a){
  m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
  m[i].l=1*new Date();
  for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
  k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
})(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=${METRIKA_ID}', 'ym');

ym(${METRIKA_ID}, 'init', {
  ssr: true,
  webvisor: true,
  clickmap: true,
  ecommerce: "dataLayer",
  accurateTrackBounce: true,
  trackLinks: true
});
        `}
      </Script>

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
