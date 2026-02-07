// src/components/Locations.tsx
"use client";

import { useState } from "react";
import type { PurchaseOptions } from "@/components/Pricing";

type Studio = {
  id: string;
  name: string;
  address: string;
  schedule: string;
  price: string;
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
        name: "м. 1905 года · 5 мин. пешком",
        address: "Адрес: ул. Большая Декабрьская, д.3 с25",
        schedule:
          "Групповые: вт, чт · 18:40 и 20:00, сб · 12:00. Персональные — по записи.",
            price: "Стоимость пробного занятия: 1 100 ₽",
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
  const [activeCityId, setActiveCityId] = useState<string>(cities[0].id);
  const [isTariffsOpen, setIsTariffsOpen] = useState(false);
  const [tariffsContext, setTariffsContext] = useState<{
    cityName: string;
    studioName: string;
  } | null>(null);
  const [activeTariffTab, setActiveTariffTab] = useState<"group" | "personal">(
    "group"
  );

  const activeCity =
    cities.find((city) => city.id === activeCityId) ?? cities[0];

  function openTariffs(cityName: string, studioName: string) {
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

  function handleTrialPurchase(studioName: string) {
    const clean = cleanStudioName(studioName);
    onOpenPurchaseModal?.({
      tariffId: "review", // используем существующий тариф-id, чтобы не ломать типы
      tariffLabel: `Пробное занятие в студии · ${clean}`,
      amount: 1100, // ₽ — пробная единая для всех городов
      currency: "RUB",
      studioName: clean,
    });
  }

  function handleTariffPurchase(
    studioName: string,
    label: string,
    amount: number,
    id: "review" | "month" | "slow12" | "long36" = "review"
  ) {
    const clean = cleanStudioName(studioName);
    onOpenPurchaseModal?.({
      tariffId: id,
      tariffLabel: `${label} · ${clean}`,
      amount,
      currency: "RUB",
      studioName: clean,
    });
  }

  return (
    <section
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
              Где можно тренироваться в студиях
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

              <div className="mt-auto pt-2 flex flex-wrap gap-3">
                <button
                  className="inline-flex items-center justify-center rounded-full bg-brand-primary px-4 py-2 text-[13px] sm:text-sm font-semibold shadow-soft hover:bg-brand-primary/90 transition-colors"
                  type="button"
                  onClick={() => handleTrialPurchase(studio.name)}
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
                  <p>👉🏻 1 тренировка (1 чел.) — 4 900₽</p>
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
                  <p>👉🏻 1 тренировка (2 чел.) — 6 800₽</p>
                  <button
                    className="shrink-0 rounded-full border border-white/20 px-3 py-1.5 text-[12px] hover:bg-white/10 whitespace-nowrap"
                    onClick={() =>
                      handleTariffPurchase(
                        tariffsContext.studioName,
                        "Персональная 1 тренировка (2 чел.)",
                        6800,
                        "review"
                      )
                    }
                  >
                    Оплатить
                  </button>
                </div>
                <p className="mt-0.5 text-[12px] sm:text-xs text-brand-muted/70">действует 4 недели</p>
                <div className="flex items-center justify-between gap-3">
                  <p>👉🏻 1 тренировка (3 чел.) — 8 100₽</p>
                  <button
                    className="shrink-0 rounded-full border border-white/20 px-3 py-1.5 text-[12px] hover:bg-white/10 whitespace-nowrap"
                    onClick={() =>
                      handleTariffPurchase(
                        tariffsContext.studioName,
                        "Персональная 1 тренировка (3 чел.)",
                        8100,
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
    </section>
  );
}
