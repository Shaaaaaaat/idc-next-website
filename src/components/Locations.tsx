// src/components/Locations.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PurchaseOptions } from "@/components/Pricing";
import { detectDeviceType, trackGoal } from "@/lib/metrika";

type Studio = {
  id: string;
  name: string;
  address: string;
  schedule: string;
  price: string;
  note?: string;
  managerUrl?: string;
};

type City = {
  id: string;
  name: string;
  subtitle: string;
  studios: Studio[];
};

const cities: City[] = [
  {
    id: "moscow",
    name: "Москва",
    subtitle:
      "Две студии рядом с метро — удобно встроить тренировки в рабочий график.",
    studios: [
      {
        id: "msk-1",
        name: "м. Октябрьская · 6 мин. пешком",
        address: "Адрес: Калужская площадь, 1к2, 3 этаж",
        schedule: "Групповые: пн, ср, пт · 20:00. Персональные — по записи.",
            price: "Стоимость пробного занятия: 1 100 ₽",
      },
      {
        id: "msk-2",
        name: "Парк Лужники · летний формат",
        address: "Открытая площадка в Лужниках",
        schedule:
          "Групповые: вт, чт · 18:40 и 20:00, сб · 12:00. Персональные — по записи.",
            price: "Стоимость пробного занятия: 1 100 ₽",
        note:
          "Пока хорошая погода, тренировки проходят на открытом воздухе. При плохом прогнозе занятие переносится в зал You Can у м. 1905 года.",
        managerUrl: "https://t.me/idc_manager",
      },
    ],
  },
  {
    id: "spb",
    name: "Питер",
    subtitle:
      "Залы с турниками и брусьями — комфортно тренироваться круглый год.",
    studios: [
      {
        id: "spb-1",
        name: "м. Московские Ворота · 4 мин. пешком",
        address: "Адрес: ул. Заставская, 33П",
        schedule:
          "Групповые: вт, чт · 21:00, сб · 14:00. Персональные — по записи.",
            price: "Стоимость пробного занятия: 1 100 ₽",
      },
      {
        id: "spb-2",
        name: "м. Выборгская · 5 мин. пешком",
        address: "Адрес: Малый Сампсониевский пр., дом 2",
        schedule: "Групповые: пн, ср · 20:30, сб · 14:00. Персональные — по записи.",
            price: "Стоимость пробного занятия: 1 100 ₽",
      },
    ],
  },
];

type LocationsProps = {
  onOpenPurchaseModal?: (options: PurchaseOptions) => void;
};

export function Locations({ onOpenPurchaseModal }: LocationsProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [activeCityId, setActiveCityId] = useState<string>(cities[0].id);
  const [isTariffsOpen, setIsTariffsOpen] = useState(false);
  const [tariffsContext, setTariffsContext] = useState<{
    cityName: string;
    studioName: string;
  } | null>(null);
  const [activeTariffTab, setActiveTariffTab] = useState<"group" | "personal">(
    "group"
  );
  const [isTrialOpen, setIsTrialOpen] = useState(false);
  const [trialStep, setTrialStep] = useState<1 | 2>(1);
  const [trialContext, setTrialContext] = useState<{
    cityName: string;
    studioName: string;
    studioId: string;
  } | null>(null);
  const [leadFullName, setLeadFullName] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadPhoneError, setLeadPhoneError] = useState<string | null>(null);
  const [leadEmailError, setLeadEmailError] = useState<string | null>(null);
  const [leadNameError, setLeadNameError] = useState<string | null>(null);
  const [leadAgreed, setLeadAgreed] = useState(false);
  const [leadAgreeError, setLeadAgreeError] = useState<string | null>(null);
  const [leadLoading, setLeadLoading] = useState(false);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [slotSelectionError, setSlotSelectionError] = useState<string | null>(null);
  const [slots, setSlots] = useState<
    { id: string; studioId: string; startAtLocal: string; startAtISO: string }[]
  >([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  const activeCity =
    cities.find((city) => city.id === activeCityId) ?? cities[0];

  const cityDisplayForLead = useMemo(() => {
    const city = activeCity?.name || "";
    return city === "Питер" ? "Санкт-Петербург" : city;
  }, [activeCity?.name]);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        trackGoal("products_view", {
          product_type: "gym",
          source: "scroll",
          device: detectDeviceType(),
        });
        observer.disconnect();
      },
      { threshold: 0.35 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Map cleaned studio name to studioId (for schedule API and storage)
  function mapStudioToId(cleanName: string): string {
    const map: Record<string, string> = {
      "м. 1905 года": "msk_youcan",
      "Парк Лужники · летний формат": "msk_youcan",
      "Парк Лужники": "msk_youcan",
      "м. Октябрьская": "msk_elfit",
      "м. Московские Ворота": "spb_spirit",
      "м. Выборгская": "spb_hkc",
    };
    return map[cleanName] || cleanName.toLowerCase().replace(/\s+/g, "_");
  }

  // Phone formatting:
  // - If +7 → mask as +7 (999) 123-45-67
  // - Else: keep international form (+XXXXXXXX...) without masking
  function formatPhoneInput(raw: string): string {
    const s = String(raw || "");
    const plusDigits = s.replace(/[^\d+]/g, "");
    const isRu = /^\+?7/.test(plusDigits) || /^8/.test(plusDigits);
    if (isRu) {
      let digits = (plusDigits.match(/\d/g) || []).join("");
      if (!digits) return "+7 ";
      if (digits[0] === "8") digits = "7" + digits.slice(1);
      if (digits[0] !== "7") digits = "7" + digits; // normalize to 7
      const rest = digits.slice(1, 11);
      const p1 = rest.slice(0, 3);
      const p2 = rest.slice(3, 6);
      const p3 = rest.slice(6, 8);
      const p4 = rest.slice(8, 10);
      let out = "+7";
      if (p1) out += ` (${p1}${p1.length === 3 ? ")" : ""}`;
      if (p2) out += ` ${p2}`;
      if (p3) out += `-${p3}`;
      if (p4) out += `-${p4}`;
      return out;
    }
    // International free form (keep only + and digits, ensure single + at start)
    let out = plusDigits.replace(/(?!^)\+/g, "");
    if (out && out[0] !== "+") out = "+" + out.replace(/[^\d]/g, "");
    return out;
  }

  function openTariffs(cityName: string, studioName: string) {
    const clean = cleanStudioName(studioName);
    trackGoal("product_select", {
      product_type: "gym",
      product_name: clean,
      source: "scroll",
    });
    trackGoal("pricing_view", {
      product_type: "gym",
      source: "scroll",
      device: detectDeviceType(),
    });
    setTariffsContext({ cityName, studioName });
    setActiveTariffTab("group");
    setIsTariffsOpen(true);
  }

  function closeTariffs() {
    setIsTariffsOpen(false);
  }

  // Убираем из названия студии хвост вида " · N мин. пешком"
  function cleanStudioName(input: string): string {
    try {
      return input.replace(/\s·\s\d+\s*мин\. пешком/i, "");
    } catch {
      return input;
    }
  }

  function openTrial(cityName: string, studioName: string) {
    const clean = cleanStudioName(studioName);
    trackGoal("product_select", {
      product_type: "gym",
      product_name: clean,
      source: "scroll",
    });
    trackGoal("signup_click", {
      product_type: "gym",
      product_name: clean,
      source: "scroll",
    });
    const studioId = mapStudioToId(clean);
    setTrialContext({ cityName, studioName: clean, studioId });
    setLeadFullName("");
    setLeadPhone("");
    setLeadEmail("");
    setSelectedSlotId(null);
    setNotices([]);
    setSlots([]);
    setSlotsError(null);
    setSlotSelectionError(null);
    setLeadPhoneError(null);
    setLeadEmailError(null);
    setLeadNameError(null);
    setLeadAgreeError(null);
    setTrialStep(1);
    setIsTrialOpen(true);
    // Prefetch schedule to minimize loading on step 2
    (async () => {
      try {
        setSlotsLoading(true);
        const qs = new URLSearchParams({
          studioId,
          days: "7",
          product: "trial",
        }).toString();
        const rs = await fetch(`/api/schedule?${qs}`, { cache: "no-store" });
        if (rs.ok) {
          const data = await rs.json();
          setSlots(Array.isArray(data?.slots) ? data.slots : []);
          setNotices(Array.isArray(data?.notices) ? data.notices : []);
        }
      } catch {}
      finally {
        setSlotsLoading(false);
      }
    })();
  }

  function isValidRuPhone(v: string) {
    const digits = (v.match(/\d/g) || []).join("");
    // Accept 11 digits starting with 7 (or 8 which we normalize to 7)
    if (digits.length !== 11) return false;
    const first = digits[0];
    return first === "7" || first === "8";
  }
  function isValidIntlPhone(v: string) {
    const compact = v.replace(/[\s()-]/g, "");
    if (/^\+7/.test(compact)) return isValidRuPhone(v);
    return /^\+\d{8,15}$/.test(compact);
  }
  function isValidEmail(v: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  }

  async function submitLead() {
    if (!trialContext) return;
    // validate phone
    if (!isValidIntlPhone(leadPhone)) {
      setLeadPhoneError("Проверьте номер телефона: нужно 11 цифр, формат +7 (XXX) XXX-XX-XX");
      return;
    }
    setLeadPhoneError(null);
    // validate name
    if (!leadFullName.trim()) {
      setLeadNameError("Введите имя и фамилию");
      return;
    }
    setLeadNameError(null);
    // validate email (required)
    if (!isValidEmail(leadEmail)) {
      setLeadEmailError("Проверьте email: формат name@example.com");
      return;
    }
    setLeadEmailError(null);
    // validate consent
    if (!leadAgreed) {
      setLeadAgreeError("Подтвердите согласие с офертой и политикой");
      return;
    }
    setLeadAgreeError(null);
    setLeadLoading(true);
    try {
      const r = await fetch("/api/leads/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: leadFullName,
          phone: leadPhone,
          email: leadEmail,
          city: cityDisplayForLead,
          studio: trialContext.studioName,
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || "Lead create failed");
      }
      // proceed to Step 2: fetch schedule
      setTrialStep(2);
      setSlotsLoading(true);
      setSlotsError(null);
      const qs = new URLSearchParams({
        studioId: trialContext.studioId,
        days: "7",
        product: "trial",
      }).toString();
      const rs = await fetch(`/api/schedule?${qs}`, { cache: "no-store" });
      if (!rs.ok) {
        const t = await rs.text();
        throw new Error(t || "Schedule load failed");
      }
      const data = await rs.json();
      setSlots(Array.isArray(data?.slots) ? data.slots : []);
      setNotices(Array.isArray(data?.notices) ? data.notices : []);
    } catch (e: any) {
      setSlotsError(e?.message || "Ошибка при создании лида");
    } finally {
      setLeadLoading(false);
      setSlotsLoading(false);
    }
  }

  async function payForTrial() {
    if (!trialContext) return;
    if (!selectedSlotId) {
      setSlotSelectionError("Выберите время");
      return;
    }
    setSlotSelectionError(null);
    const slot = slots.find((s) => s.id === selectedSlotId);
    if (!slot) return;
    trackGoal("signup_submit", {
      product_type: "gym",
      product_name: trialContext.studioName,
      source: "scroll",
    });
    try {
      const resp = await fetch("/api/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: 1100,
          currency: "RUB",
          email: leadEmail,
          fullName: leadFullName,
          courseName: "", // not needed for trial
          tariffId: "review",
          tariffLabel: "Пробная тренировка",
          studioName: trialContext.studioName,
          studioId: trialContext.studioId,
          slotStartAt: slot.startAtLocal,
          phone: leadPhone,
        }),
      });
      const json = await resp.json();
      if (!resp.ok || !json?.paymentUrl) {
        throw new Error(json?.error || "Не удалось создать оплату");
      }
      window.location.href = json.paymentUrl;
    } catch (e) {
      alert("Ошибка: не удалось перейти к оплате");
    }
  }

  function handleTariffPurchase(
    studioName: string,
    label: string,
    amount: number,
    id: "review" | "month" | "fast12" | "long36" = "review"
  ) {
    const clean = cleanStudioName(studioName);
    trackGoal("signup_click", {
      product_type: "gym",
      product_name: `${label} · ${clean}`,
      source: "scroll",
    });
    const studioId = mapStudioToId(clean);
    onOpenPurchaseModal?.({
      tariffId: id,
      tariffLabel: `${label} · ${clean}`,
      amount,
      currency: "RUB",
      studioName: clean,
      studioId,
    });
  }

  return (
    <section
      ref={sectionRef}
      id="locations"
      className="py-16 sm:py-20 lg:py-24 border-t border-white/5 scroll-mt-[calc(var(--header-h)+var(--anchor-extra))]"
    >
      <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8">
        {/* Заголовок + переключатель */}
        <div className="mb-8 sm:mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand-muted mb-3">
              Залы
            </p>
            <h2 className="text-[26px] sm:text-3xl lg:text-4xl font-semibold tracking-tight mb-3">
              Залы — цены и запись
            </h2>
            <p className="max-w-2xl text-[15px] sm:text-base text-brand-muted leading-relaxed">
              Можно заниматься только онлайн, совмещать онлайн с залом или
              полностью ходить в студию. Прогресс, программы и разбор техники —
              в одном личном кабинете.
            </p>
          </div>

          {/* Переключатель городов */}
          <div className="flex sm:justify-end">
            <div className="inline-flex w-full sm:w-auto items-center justify-between sm:justify-end gap-1 rounded-full bg-white/5 border border-white/10 p-1 text-xs sm:text-sm">
              {cities.map((city) => {
                const isActive = city.id === activeCityId;
                return (
                  <button
                    key={city.id}
                    type="button"
                    onClick={() => setActiveCityId(city.id)}
                    className={[
                      "flex-1 sm:flex-none px-3 sm:px-4 py-1.5 rounded-full transition-colors",
                      isActive
                        ? "bg-white text-brand-dark"
                        : "text-brand-muted hover:text-white",
                    ].join(" ")}
                  >
                    {city.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Описание выбранного города */}
        <div className="mb-8 sm:mb-10 text-[14px] sm:text-sm text-brand-muted">
          {activeCity.subtitle}
        </div>

        {/* Сами студии */}
        <div className="grid gap-5 sm:gap-6 md:grid-cols-2">
          {activeCity.studios.map((studio) => (
            <article
              key={studio.id}
              className="flex flex-col rounded-3xl border border-white/10 bg-white/5 px-5 py-5 sm:px-6 sm:py-6 backdrop-blur-sm"
            >
              <h3 className="text-[15px] sm:text-lg font-semibold mb-1.5">
                {studio.name}
              </h3>
              <p className="text-[13px] sm:text-sm text-brand-muted mb-2">
                {studio.address}
              </p>
              <p className="text-[12px] sm:text-xs text-brand-muted mb-1.5">
                {studio.schedule}
              </p>
              <p className="text-[12px] sm:text-xs text-brand-muted mb-4">
                {studio.price}
              </p>
              {studio.note ? (
                <p className="mb-4 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-[12px] leading-relaxed text-brand-muted">
                  {studio.note}{" "}
                  {studio.managerUrl ? (
                    <a
                      href={studio.managerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
                    >
                      Уточнить у менеджера
                    </a>
                  ) : null}
                </p>
              ) : null}

              <div className="mt-auto pt-2 flex flex-wrap gap-3">
                <button
                  className="inline-flex items-center justify-center rounded-full bg-brand-primary px-4 py-2 text-[13px] sm:text-sm font-semibold shadow-soft hover:bg-brand-primary/90 transition-colors"
                  type="button"
                  onClick={() => openTrial(activeCity.name, studio.name)}
                >
                  Записаться на пробную
                </button>
                <button
                  className="inline-flex items-center justify-center rounded-full border border-white/20 px-4 py-2 text-[13px] sm:text-sm font-semibold text-brand-muted hover:bg-white/5 transition-colors"
                  type="button"
                  onClick={() => openTariffs(activeCity.name, studio.name)}
                >
                  Смотреть тарифы
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>

      {/* Модалка с тарифами студий */}
      {isTariffsOpen && tariffsContext && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 sm:px-0"
          onClick={closeTariffs}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-brand-dark border border-white/10 p-5 sm:p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg sm:text-xl font-semibold">
                  Тарифы в студии
                </h3>
                <p className="mt-1 text-[11px] sm:text-xs text-brand-muted">
                  {tariffsContext.cityName} · {tariffsContext.studioName}
                </p>
              </div>
              <button
                type="button"
                onClick={closeTariffs}
                className="rounded-full bg-white/5 p-1.5 text-brand-muted hover:bg-white/10 hover:text-white transition-colors"
                aria-label="Закрыть"
              >
                <span className="block h-4 w-4 leading-none">✕</span>
              </button>
            </div>

            {/* Переключатель тарифов */}
            <div className="mb-4 flex items-center justify-center">
              <div className="inline-flex rounded-full bg-white/5 border border-white/10 p-1 text-[12px] sm:text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTariffTab("group")}
                  className={[
                    "px-3 sm:px-4 py-1.5 rounded-full transition-colors",
                    activeTariffTab === "group"
                      ? "bg-white text-brand-dark"
                      : "text-brand-muted hover:text-white",
                  ].join(" ")}
                >
                  Групповые
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTariffTab("personal")}
                  className={[
                    "px-3 sm:px-4 py-1.5 rounded-full transition-colors",
                    activeTariffTab === "personal"
                      ? "bg-white text-brand-dark"
                      : "text-brand-muted hover:text-white",
                  ].join(" ")}
                >
                  Персональные
                </button>
              </div>
            </div>

            <div className="space-y-4 text-[14px] sm:text-base text-brand-muted">
              {/* Групповые тарифы */}
              {activeTariffTab === "group" && (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 sm:px-5 sm:py-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-brand-muted mb-2">
                  Групповые тарифы
                </div>
                {tariffsContext.cityName === "Москва" ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <p>👉🏻 Пробная тренировка — 1 100 ₽</p>
                      <button
                        className="shrink-0 rounded-full border border-white/20 px-3 py-1.5 text-[12px] hover:bg-white/10 whitespace-nowrap"
                        onClick={() =>
                          handleTariffPurchase(
                            tariffsContext.studioName,
                            "Пробная тренировка",
                            1100,
                            "review"
                          )
                        }
                      >
                        Оплатить
                      </button>
                    </div>
                    <p className="mt-0.5 text-[12px] sm:text-xs text-brand-muted/70">действует 4 недели</p>
                    <div className="flex items-center justify-between gap-3">
                      <p>👉🏻 По‑разово — 1 500 ₽</p>
                      <button
                        className="shrink-0 rounded-full border border-white/20 px-3 py-1.5 text-[12px] hover:bg-white/10 whitespace-nowrap"
                        onClick={() =>
                          handleTariffPurchase(
                            tariffsContext.studioName,
                            "Групповая 1 тренировка",
                            1500,
                            "review"
                          )
                        }
                      >
                        Оплатить
                      </button>
                    </div>
                    <p className="mt-0.5 text-[12px] sm:text-xs text-brand-muted/70">действует 4 недели</p>
                    <div className="flex items-center justify-between gap-3">
                      <p>👉🏻 12 тренировок — 14 400 ₽</p>
                      <button
                        className="shrink-0 rounded-full border border-white/20 px-3 py-1.5 text-[12px] hover:bg-white/10 whitespace-nowrap"
                        onClick={() =>
                          handleTariffPurchase(
                            tariffsContext.studioName,
                            "Групповой абонемент 12 тренировок",
                            14400,
                            "month"
                          )
                        }
                      >
                        Оплатить
                      </button>
                    </div>
                    <p className="mt-0.5 text-[12px] sm:text-xs text-brand-muted/70">действует 8 недель</p>
                  </> 
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <p>👉🏻 Пробная тренировка — 1 100 ₽</p>
                      <button
                        className="shrink-0 rounded-full border border-white/20 px-3 py-1.5 text-[12px] hover:bg-white/10 whitespace-nowrap"
                        onClick={() =>
                          handleTariffPurchase(
                            tariffsContext.studioName,
                            "Пробная тренировка",
                            1100,
                            "review"
                          )
                        }
                      >
                        Оплатить
                      </button>
                    </div>
                    <p className="mt-0.5 text-[12px] sm:text-xs text-brand-muted/70">действует 4 недели</p>
                    <div className="flex items-center justify-between gap-3">
                      <p>👉🏻 По‑разово — 1 400 ₽</p>
                      <button
                        className="shrink-0 rounded-full border border-white/20 px-3 py-1.5 text-[12px] hover:bg-white/10 whitespace-nowrap"
                        onClick={() =>
                          handleTariffPurchase(
                            tariffsContext.studioName,
                            "Групповая 1 тренировка",
                            1400,
                            "review"
                          )
                        }
                      >
                        Оплатить
                      </button>
                    </div>
                    <p className="mt-0.5 text-[12px] sm:text-xs text-brand-muted/70">действует 4 недели</p>
                    <div className="flex items-center justify-between gap-3">
                      <p>👉🏻 12 тренировок — 11 400 ₽</p>
                      <button
                        className="shrink-0 rounded-full border border-white/20 px-3 py-1.5 text-[12px] hover:bg-white/10 whitespace-nowrap"
                        onClick={() =>
                          handleTariffPurchase(
                            tariffsContext.studioName,
                            "Групповой абонемент 12 тренировок",
                            11400,
                            "fast12"
                          )
                        }
                      >
                        Оплатить
                      </button>
                    </div>
                    <p className="mt-0.5 text-[12px] sm:text-xs text-brand-muted/70">действует 4 недели</p>
                    <div className="flex items-center justify-between gap-3">
                      <p>👉🏻 12 тренировок — 13 200 ₽</p>
                      <button
                        className="shrink-0 rounded-full border border-white/20 px-3 py-1.5 text-[12px] hover:bg-white/10 whitespace-nowrap"
                        onClick={() =>
                          handleTariffPurchase(
                            tariffsContext.studioName,
                            "Групповой абонемент 12 тренировок",
                            13200,
                            "month"
                          )
                        }
                      >
                        Оплатить
                      </button>
                    </div>
                    <p className="mt-0.5 text-[12px] sm:text-xs text-brand-muted/70">действует 8 недель</p>
                  </>
                )}
                </div>
              )}

              {/* Персональные тарифы — одинаково для всех городов */}
              {activeTariffTab === "personal" && (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 sm:px-5 sm:py-4">
                <div className="text-[11px] uppercase tracking-[0.16em] text-brand-muted mb-2">
                  Персональные тарифы
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p>👉🏻 1 тренировка (1 чел.) — 4 900 ₽</p>
                  <button
                    className="shrink-0 rounded-full border border-white/20 px-3 py-1.5 text-[12px] hover:bg-white/10 whitespace-nowrap"
                    onClick={() =>
                      handleTariffPurchase(
                        tariffsContext.studioName,
                        "Персональная 1 тренировка (1 чел.)",
                        4900,
                        "review"
                      )
                    }
                  >
                    Оплатить
                  </button>
                </div>
                <p className="mt-0.5 text-[12px] sm:text-xs text-brand-muted/70">действует 4 недели</p>
                <div className="flex items-center justify-between gap-3">
                  <p>👉🏻 1 тренировка (2-3 чел.) — 6 600 ₽</p>
                  <button
                    className="shrink-0 rounded-full border border-white/20 px-3 py-1.5 text-[12px] hover:bg-white/10 whitespace-nowrap"
                    onClick={() =>
                      handleTariffPurchase(
                        tariffsContext.studioName,
                        "Персональная 1 тренировка (2-3 чел.)",
                        6600,
                        "review"
                      )
                    }
                  >
                    Оплатить
                  </button>
                </div>
                <p className="mt-0.5 text-[12px] sm:text-xs text-brand-muted/70">действует 4 недели</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Модалка «Пробная тренировка»: форма → выбор слота → оплата */}
      {isTrialOpen && trialContext && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 sm:px-0"
          onClick={() => setIsTrialOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-brand-dark border border-white/10 p-5 sm:p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg sm:text-xl font-semibold">
                  Пробная тренировка
                </h3>
                <p className="mt-1 text-[11px] sm:text-xs text-brand-muted">
                  {cityDisplayForLead} · {trialContext.studioName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsTrialOpen(false)}
                className="rounded-full bg-white/5 p-1.5 text-brand-muted hover:bg-white/10 hover:text-white transition-colors"
                aria-label="Закрыть"
              >
                <span className="block h-4 w-4 leading-none">✕</span>
              </button>
            </div>

            {trialStep === 1 && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[12px] sm:text-xs text-brand-muted mb-1">
                    Фамилия и имя
                  </label>
                  <input
                    type="text"
                    value={leadFullName}
                    onChange={(e) => {
                      setLeadFullName(e.target.value);
                      setLeadNameError(null);
                    }}
                    className={`w-full rounded-2xl border bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary ${leadNameError ? "border-red-400 ring-1 ring-red-400" : "border-white/10"}`}
                    placeholder="Иванова Анна"
                  />
                  {leadNameError && (
                    <p className="mt-1 text-[12px] text-red-400">{leadNameError}</p>
                  )}
                </div>
                <div>
                  <label className="block text-[12px] sm:text-xs text-brand-muted mb-1">
                    Телефон
                  </label>
                  <input
                    type="tel"
                    value={leadPhone}
                    onChange={(e) => {
                      setLeadPhone(formatPhoneInput(e.target.value));
                      setLeadPhoneError(null);
                    }}
                    onFocus={() => {
                      if (!leadPhone) {
                        setLeadPhone("+7 ");
                      }
                    }}
                    onBlur={(e) => {
                      const v = (e.currentTarget.value || "").trim();
                      if (!v) return;

                      let next = v;
                      if (v === "+7" || v === "+7)") {
                        setLeadPhone("");
                        return;
                      }
                      // If starts with +7 reformat, else keep sanitized international
                      if (/^\+?7/.test(v) || /^8/.test(v)) {
                        next = formatPhoneInput(v);
                      } else {
                        const cleaned = v.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
                        next = cleaned.startsWith("+") ? cleaned : "+" + cleaned;
                      }
                      setLeadPhone(next);
                      if (leadPhoneError && isValidIntlPhone(next)) setLeadPhoneError(null);
                    }}
                    className={`w-full rounded-2xl border bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary ${leadPhoneError ? "border-red-400 ring-1 ring-red-400" : "border-white/10"}`}
                    placeholder="(___) ___-__-__"
                  />
                  {leadPhoneError && (
                    <p className="mt-1 text-[12px] text-red-400">{leadPhoneError}</p>
                  )}
                </div>
                <div>
                  <label className="block text-[12px] sm:text-xs text-brand-muted mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={leadEmail}
                    onChange={(e) => {
                      setLeadEmail(e.target.value);
                      setLeadEmailError(null);
                    }}
                    className={`w-full rounded-2xl border bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary ${leadEmailError ? "border-red-400 ring-1 ring-red-400" : "border-white/10"}`}
                    placeholder="name@example.com"
                    required
                  />
                  {leadEmailError && (
                    <p className="mt-1 text-[12px] text-red-400">{leadEmailError}</p>
                  )}
                </div>
                {/* Согласие */}
                <label className="flex items-start gap-2 text-[11px] sm:text-xs text-brand-muted">
                  <input
                    type="checkbox"
                    checked={leadAgreed}
                    onChange={(e) => {
                      setLeadAgreed(e.target.checked);
                      setLeadAgreeError(null);
                    }}
                    className="mt-0.5 h-3.5 w-3.5 rounded border-white/20 bg-transparent text-brand-primary focus:ring-0"
                  />
                  <span>
                    Я согласен(на) с{" "}
                    <a
                      href="/offer"
                      target="_blank"
                      className="underline decoration-dotted hover:text-white"
                    >
                      условиями Договора оферты
                    </a>{" "}
                    и{" "}
                    <a
                      href="/privacy"
                      target="_blank"
                      className="underline decoration-dotted hover:text-white"
                    >
                      Политикой обработки персональных данных
                    </a>
                    .
                  </span>
                </label>
                {leadAgreeError && (
                  <p className="text-[12px] text-red-400">{leadAgreeError}</p>
                )}
                <button
                  type="button"
                  onClick={submitLead}
                  disabled={leadLoading}
                  className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-brand-primary px-4 py-2.5 text-sm font-semibold hover:bg-brand-primary/90 transition-colors disabled:opacity-60"
                >
                  {leadLoading ? "Отправляем..." : "Выбрать день"}
                </button>
              </div>
            )}

            {trialStep === 2 && (
              <div>
                {slotsLoading && (
                  <p className="text-sm text-brand-muted">Загружаем расписание…</p>
                )}
                {slotsError && (
                  <p className="text-sm text-red-400">{slotsError}</p>
                )}
                {!slotsLoading && !slotsError && (
                  <div className="space-y-3">
                    {notices.length > 0 && (
                      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-[12px] text-yellow-200">
                        {notices.map((n, idx) => (
                          <p key={idx}>{n}</p>
                        ))}
                      </div>
                    )}
                    <div className="max-h-72 overflow-auto pr-1 space-y-2">
                      {slots.length === 0 && (
                        <p className="text-sm text-brand-muted">
                          На ближайшие 7 дней слотов нет.
                        </p>
                      )}
                      {slots.map((s) => {
                        const dt = new Date(s.startAtLocal);
                        const dateStr = new Intl.DateTimeFormat("ru-RU", {
                          weekday: "short",
                          day: "2-digit",
                          month: "short",
                          timeZone: "Europe/Moscow",
                        }).format(dt);
                        const timeStr = new Intl.DateTimeFormat("ru-RU", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "Europe/Moscow",
                        }).format(dt);
                        const selected = selectedSlotId === s.id;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              setSelectedSlotId(s.id);
                              setSlotSelectionError(null);
                            }}
                            className={[
                              "w-full text-left rounded-xl border px-3 py-2 text-sm transition-colors",
                              selected
                                ? "border-brand-primary bg-brand-primary/10"
                                : "border-white/10 bg-white/5 hover:bg-white/10",
                            ].join(" ")}
                          >
                            <span className="font-semibold">{dateStr}</span>
                            <span className="ml-2 text-brand-muted">{timeStr}</span>
                          </button>
                        );
                      })}
                    </div>
                    {slotSelectionError && (
                      <p className="text-[12px] text-red-400">{slotSelectionError}</p>
                    )}
                    <button
                      type="button"
                      onClick={payForTrial}
                      className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-brand-primary px-4 py-2.5 text-sm font-semibold hover:bg-brand-primary/90 transition-colors"
                    >
                      Оплатить 1 100 ₽
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                      setTrialStep(1);
                      setSlotSelectionError(null);
                    }}
                      className="mt-2 inline-flex w-full items-center justify-center rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 transition-colors"
                    >
                      Назад
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
