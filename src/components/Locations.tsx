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
        price: "Стоимость пробного занятия: 950 ₽",
      },
      {
        id: "msk-2",
        name: "м. 1905 года · 5 мин. пешком",
        address: "Адрес: ул. Большая Декабрьская, д.3 с25",
        schedule:
          "Групповые: вт, чт · 18:40 и 20:00, сб · 12:00. Персональные — по записи.",
        price: "Стоимость пробного занятия: 950 ₽",
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
        price: "Стоимость пробного занятия: 950 ₽",
      },
      {
        id: "spb-2",
        name: "м. Выборгская · 5 мин. пешком",
        address: "Адрес: Малый Сампсониевский пр., дом 2",
        schedule: "Групповые: пн, ср · 20:30, сб · 14:00.",
        price: "Стоимость пробного занятия: 950 ₽",
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

  const activeCity =
    cities.find((city) => city.id === activeCityId) ?? cities[0];

  function openTariffs(cityName: string, studioName: string) {
    setTariffsContext({ cityName, studioName });
    setIsTariffsOpen(true);
  }

  function closeTariffs() {
    setIsTariffsOpen(false);
  }

  function handleTrialPurchase(studioName: string) {
    onOpenPurchaseModal?.({
      tariffId: "review", // используем существующий тариф-id, чтобы не ломать типы
      tariffLabel: `Пробное занятие в студии · ${studioName}`,
      amount: 950, // ₽
      currency: "RUB",
      studioName,
    });
  }

  return (
    <section
      id="locations"
      className="py-16 sm:py-20 lg:py-24 scroll-mt-24 md:scroll-mt-28 border-t border-white/5"
    >
      <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8">
        {/* Заголовок */}
        <div className="mb-8 sm:mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand-muted mb-3">
              Локации
            </p>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight mb-3">
              Где можно тренироваться в студиях
            </h2>
            <p className="max-w-2xl text-sm sm:text-base text-brand-muted">
              Можно заниматься только онлайн, совмещать онлайн с залом или
              полностью ходить в студию. Прогресс, программы и разбор техники —
              в одном личном кабинете.
            </p>
          </div>

          {/* Переключатель городов */}
          <div className="inline-flex items-center gap-1 rounded-full bg-white/5 border border-white/10 p-1 text-xs sm:text-sm">
            {cities.map((city) => {
              const isActive = city.id === activeCityId;
              return (
                <button
                  key={city.id}
                  type="button"
                  onClick={() => setActiveCityId(city.id)}
                  className={[
                    "px-3 sm:px-4 py-1.5 rounded-full transition-colors",
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

        {/* Описание выбранного города */}
        <div className="mb-8 sm:mb-10 text-sm sm:text-base text-brand-muted">
          {activeCity.subtitle}
        </div>

        {/* Сами студии */}
        <div className="grid gap-6 md:grid-cols-2">
          {activeCity.studios.map((studio) => (
            <article
              key={studio.id}
              className="flex flex-col rounded-3xl border border-white/10 bg-white/5 px-5 py-6 sm:px-6 sm:py-7 backdrop-blur-sm"
            >
              <h3 className="text-base sm:text-lg font-semibold mb-1">
                {studio.name}
              </h3>
              <p className="text-xs sm:text-sm text-brand-muted mb-2">
                {studio.address}
              </p>
              <p className="text-[11px] sm:text-xs text-brand-muted mb-2">
                {studio.schedule}
              </p>
              <p className="text-[11px] sm:text-xs text-brand-muted mb-4">
                {studio.price}
              </p>

              <div className="mt-auto pt-2 flex flex-wrap gap-3">
                <button
                  className="inline-flex items-center justify-center rounded-full bg-brand-primary px-4 py-2 text-xs sm:text-sm font-semibold shadow-soft hover:bg-brand-primary/90 transition-colors"
                  type="button"
                  onClick={() => handleTrialPurchase(studio.name)}
                >
                  Записаться на пробную
                </button>
                <button
                  className="inline-flex items-center justify-center rounded-full border border-white/20 px-4 py-2 text-xs sm:text-sm font-semibold text-brand-muted hover:bg-white/5 transition-colors"
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
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4 sm:px-0"
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
                className="rounded-full bg-white/5 p-1 text-brand-muted hover:bg-white/10 hover:text-white transition-colors"
                aria-label="Закрыть"
              >
                <span className="block h-4 w-4 leading-none">✕</span>
              </button>
            </div>

            <div className="space-y-3 text-sm sm:text-base text-brand-muted">
              <p>👉🏻 Абонемент на 12 тренировок (длительность 8 недель) — 13 200₽</p>
              <p>👉🏻 1 тренировка (по-разово) — 1 400₽</p>
            </div>

            <p className="mt-4 text-[11px] sm:text-xs text-brand-muted/80">
              Оплатить можно на месте после пробного занятия или через онлайн-оплату
              по ссылке от тренера.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
