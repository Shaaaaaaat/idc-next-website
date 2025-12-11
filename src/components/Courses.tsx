// src/components/Courses.tsx
"use client";

import { TestSignupButton } from "@/components/TestSignupButton";

type CoursesProps = {
  onOpenTestModal?: (context?: string) => void;
};

export function Courses({ onOpenTestModal }: CoursesProps) {
  return (
    <section
      id="courses"
      className="border-t border-black/5 bg-[#F5F7FB] text-brand-dark py-16 sm:py-20 lg:py-24"
    >
      <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8">
        {/* Заголовок + бейдж */}
        <div className="flex flex-col gap-4 mb-8 sm:mb-10">
          <div className="inline-flex w-fit items-center gap-2 rounded-full bg-white shadow-sm border border-black/5 px-3 py-1.5 text-[11px] sm:text-xs text-gray-600">
            <span className="h-2 w-2 rounded-full bg-brand-accent" />
            <span>Онлайн программы для зала и дома</span>
          </div>

          <div className="max-w-3xl">
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight mb-3">
              Цели и программы
            </h2>
            <p className="text-sm sm:text-base text-gray-600">
              Выбирай направление, которое тебе сейчас ближе — в любой момент
              ты можешь переключиться на другой курс. Программа гибко
              подстраивается под твой уровень и интересы.
            </p>
          </div>
        </div>

        {/* Подпись про скролл */}
        <div className="flex items-center justify-between text-[11px] sm:text-xs text-gray-500 mb-3 sm:mb-4">
          <span>Пролистай вправо, чтобы увидеть все программы.</span>
          <span className="hidden sm:inline">
            Любой курс можно адаптировать под твой стартовый уровень.
          </span>
        </div>

        {/* Горизонтальный скролл с карточками */}
        <div className="mt-3">
          <div className="flex gap-4 sm:gap-6 lg:gap-8 overflow-x-auto pt-3 pb-4 sm:pb-6 -mx-1 px-1 snap-x snap-mandatory [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-black/10">
            {/* 1. Calisthenics Light */}
            <article className="snap-start flex flex-col shrink-0 w-[82%] sm:w-[60%] lg:w-[40%] rounded-3xl bg-white border border-black/5 shadow-sm p-5 sm:p-6 transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-xl hover:border-brand-primary/50">
              <div className="flex items-center justify-between gap-2 mb-3 text-[11px] sm:text-xs">
                <span className="inline-flex items-center gap-2 rounded-full bg-gray-50 border border-black/10 px-3 py-1 text-gray-600">
                  <span className="h-2 w-2 rounded-full bg-brand-accent" />
                  Лёгкий старт · Для начинающих
                </span>
              </div>

              <h3 className="text-base sm:text-lg font-semibold mb-2 text-gray-900">
                Calisthenics Light
              </h3>
              <p className="text-xs sm:text-sm text-gray-600 mb-4">
                Мягкий вход в тренировки, если давно не занимался или много
                сидишь за компьютером. Без выгорания и «убойных» схем.
              </p>

              <ul className="mb-4 space-y-1.5 text-[11px] sm:text-xs text-gray-600">
                <li>• 20–30 минут без инвентаря</li>
                <li>• Спина, плечи, кор и ноги</li>
                <li>• Фундамент для подтягиваний и стойки</li>
              </ul>

              <div className="mt-auto flex items-center justify-end gap-2 pt-2 text-[11px] sm:text-xs">
                <TestSignupButton
                  label="Пройти тест силы"
                  buttonClassName="shrink-0 rounded-full bg-brand-primary px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-brand-primary/90"
                  onClick={() =>
                    onOpenTestModal?.("Курс: Calisthenics Light")
                  }
                />
              </div>
            </article>

            {/* 2. Super Calisthenics */}
            <article className="snap-start flex flex-col shrink-0 w-[82%] sm:w-[60%] lg:w-[40%] rounded-3xl bg-white border border-black/5 shadow-sm p-5 sm:p-6 transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-xl hover:border-brand-primary/50">
              <div className="flex items-center justify-between gap-2 mb-3 text-[11px] sm:text-xs">
                <span className="inline-flex items-center gap-2 rounded-full bg-gray-50 border border-black/10 px-3 py-1 text-gray-600">
                  <span className="h-2 w-2 rounded-full bg-brand-blue" />
                  Стать сильнее · Любой уровень
                </span>
              </div>

              <h3 className="text-base sm:text-lg font-semibold mb-2 text-gray-900">
                Super Calisthenics
              </h3>
              <p className="text-xs sm:text-sm text-gray-600 mb-4">
                Главный курс, если хочешь просто стать сильным: всё тело,
                прогресс в подтягиваниях, стойке и базовых элементах.
              </p>

              <ul className="mb-4 space-y-1.5 text-[11px] sm:text-xs text-gray-600">
                <li>• 45–60 минут, нужен турник</li>
                <li>• Баланс тяги, жима и кора</li>
                <li>• Обучение любому элементу</li>
              </ul>

              <div className="mt-auto flex items-center justify-end gap-2 pt-2 text-[11px] sm:text-xs">
                <TestSignupButton
                  label="Пройти тест силы"
                  buttonClassName="shrink-0 rounded-full bg-gray-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-black"
                  onClick={() =>
                    onOpenTestModal?.("Курс: Super Calisthenics")
                  }
                />
              </div>
            </article>

            {/* 3. Подтягивания для девушек */}
            <article className="snap-start flex flex-col shrink-0 w-[82%] sm:w-[60%] lg:w-[40%] rounded-3xl bg-white border border-black/5 shadow-sm p-5 sm:p-6 transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-xl hover:border-brand-primary/50">
              <div className="flex items-center justify-between gap-2 mb-3 text-[11px] sm:text-xs">
                <span className="inline-flex items-center gap-2 rounded-full bg-gray-50 border border-black/10 px-3 py-1 text-gray-600">
                  <span className="h-2 w-2 rounded-full bg-brand-blue" />
                  Обучиться подтягиваниям · Любой уровень
                </span>
              </div>

              <h3 className="text-base sm:text-lg font-semibold mb-2 text-gray-900">
                Подтягивания для девушек
              </h3>
              <p className="text-xs sm:text-sm text-gray-600 mb-4">
                Цель — первое уверенное подтягивание. Без стресса, сравнений и
                комментариев «это не для тебя».
              </p>

              <ul className="mb-4 space-y-1.5 text-[11px] sm:text-xs text-gray-600">
                <li>• 45–60 минут, нужен турник</li>
                <li>• Пошаговый путь от 0 → 1 и дальше</li>
                <li>• Super Calisthenics с выбранной целью</li>
              </ul>

              <div className="mt-auto flex items-center justify-end gap-2 pt-2 text-[11px] sm:text-xs">
                <TestSignupButton
                  label="Пройти тест силы"
                  buttonClassName="shrink-0 rounded-full bg-brand-primary px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-brand-primary/90"
                  onClick={() =>
                    onOpenTestModal?.("Курс: Подтягивания для девушек")
                  }
                />
              </div>
            </article>

            {/* 4. Стойка на руках */}
            <article className="snap-start flex flex-col shrink-0 w-[82%] sm:w-[60%] lg:w-[40%] rounded-3xl bg-white border border-black/5 shadow-sm p-5 sm:p-6 transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-xl hover:border-brand-primary/50">
              <div className="flex items-center justify-between gap-2 mb-3 text-[11px] sm:text-xs">
                <span className="inline-flex items-center gap-2 rounded-full bg-gray-50 border border-black/10 px-3 py-1 text-gray-600">
                  <span className="h-2 w-2 rounded-full bg-brand-primary" />
                  Научиться стоять на руках · Любой уровень
                </span>
              </div>

              <h3 className="text-base sm:text-lg font-semibold mb-2 text-gray-900">
                Стойка на руках
              </h3>
              <p className="text-xs sm:text-sm text-gray-600 mb-4">
                От «никогда не стоял у стены» до уверенного баланса. Работаем
                над мобильностью, силой и чувством позиции.
              </p>

              <ul className="mb-4 space-y-1.5 text-[11px] sm:text-xs text-gray-600">
                <li>• 30–40 минут без инвентаря</li>
                <li>• Подготовка плеч, запястий и кора</li>
                <li>• Изучение техники баланса</li>
              </ul>

              <div className="mt-auto flex items-center justify-end gap-2 pt-2 text-[11px] sm:text-xs">
                <TestSignupButton
                  label="Пройти тест силы"
                  buttonClassName="shrink-0 rounded-full bg-gray-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-brand-primary/90"
                  onClick={() =>
                    onOpenTestModal?.("Курс: Стойка на руках")
                  }
                />
              </div>
            </article>

            {/* 5. Калистеника для кроссфитеров */}
            <article className="snap-start flex flex-col shrink-0 w-[82%] sm:w-[60%] lg:w-[40%] rounded-3xl bg-white border border-black/5 shadow-sm p-5 sm:p-6 transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-xl hover:border-brand-primary/50">
              <div className="flex items-center justify-between gap-2 mb-3 text-[11px] sm:text-xs">
                <span className="inline-flex items-center gap-2 rounded-full bg-gray-50 border border-black/10 px-3 py-1 text-gray-600">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  Добавить строгие движения · Для продвинутых
                </span>
              </div>

              <h3 className="text-base sm:text-lg font-semibold mb-2 text-gray-900">
                Калистеника для кроссфитеров
              </h3>
              <p className="text-xs sm:text-sm text-gray-600 mb-4">
                Если хочешь к киппингу добавить уверенные строгие движения:
                подтягивания, отжимания в стойке и выходы — без потери техники
                и плеч.
              </p>

              <ul className="mb-4 space-y-1.5 text-[11px] sm:text-xs text-gray-600">
                <li>• 60–80 минут на тренировку, нужен турник</li>
                <li>• Сила лопаток и корпуса под гимнастику</li>
                <li>• Строгие подтягивания и HSPU</li>
              </ul>

              <div className="mt-auto flex items-center justify-end gap-2 pt-2 text-[11px] sm:text-xs">
                <TestSignupButton
                  label="Пройти тест силы"
                  buttonClassName="shrink-0 rounded-full bg-brand-primary px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-black"
                  onClick={() =>
                    onOpenTestModal?.("Курс: Калистеника для кроссфитеров")
                  }
                />
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}
