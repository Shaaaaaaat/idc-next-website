"use client";

import { useState } from "react";

type Studio = {
  id: string;
  name: string;
  address: string;
  note?: string;
  schedule: string;
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
        name: "ID Calisthenics · Центр",
        address: "ул. Такая-то, 10 · м. Пушкинская",
        note: "Малые группы до 8 человек",
        schedule: "Групповые: пн, ср, пт · 19:00 и 20:00. Персоналки — по записи."
      },
      {
        id: "msk-2",
        name: "ID Calisthenics · Юг",
        address: "ул. Такая-то, 25 · м. Полянка",
        schedule: "Групповые: вт, чт · 19:30. Выходные классы — сб · 12:00."
      }
    ]
  },
  {
    id: "spb",
    name: "Санкт-Петербург",
    subtitle:
      "Залы с турниками и брусьями — комфортно тренироваться круглый год.",
    studios: [
      {
        id: "spb-1",
        name: "ID Calisthenics · Центр",
        address: "Невский проспект, 50 · м. Гостиный двор",
        schedule: "Групповые: пн, ср, пт · 19:30. Персональные — по записи."
      },
      {
        id: "spb-2",
        name: "ID Calisthenics · Василеостровская",
        address: "7-я линия В.О., 20 · м. Василеостровская",
        schedule: "Групповые: вт, чт · 20:00. Утренние классы — сб · 11:00."
      }
    ]
  }
];

export function Locations() {
  const [activeCityId, setActiveCityId] = useState<string>(cities[0].id);

  // ВАЖНО: всегда есть фолбэк, чтобы не было undefined
  const activeCity =
    cities.find((city) => city.id === activeCityId) ?? cities[0];

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
              полностью ходить в студию. Прогресс и программы — в одном
              личном кабинете.
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
                      : "text-brand-muted hover:text-white"
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
              {studio.note && (
                <p className="text-[11px] text-brand-muted mb-4">
                  {studio.note}
                </p>
              )}
              <p className="text-[11px] sm:text-xs text-brand-muted mb-4">
                {studio.schedule}
              </p>

              <div className="mt-auto pt-2 flex flex-wrap gap-3">
                <button className="inline-flex items-center justify-center rounded-full bg-brand-primary px-4 py-2 text-xs sm:text-sm font-semibold shadow-soft hover:bg-brand-primary/90 transition-colors">
                  Записаться на пробную
                </button>
                <button className="inline-flex items-center justify-center rounded-full border border-white/20 px-4 py-2 text-xs sm:text-sm font-semibold text-brand-muted hover:bg-white/5 transition-colors">
                  Смотреть расписание
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
