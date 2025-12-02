// src/components/Pricing.tsx
"use client";

import { useState } from "react";
import { TestSignupButton } from "@/components/TestSignupButton";

function StepDot({ color = "bg-emerald-400" }: { color?: string }) {
  return (
    <span className={`inline-block h-2 aspect-square rounded-full ${color}`} />
  );
}

// отдельные цены для RUB и EUR
const prices = {
  review: {
    RUB: { total: 1100, per: 1100 }, // разовый формат
    EUR: { total: 11, per: 11 },
  },
  month: {
    RUB: { total: 9600, per: 800 }, // 12 тренировок
    EUR: { total: 108, per: 9 },
  },
  slow12: {
    RUB: { total: 11400, per: 950 }, // 12 тренировок в спокойном темпе
    EUR: { total: 120, per: 10 },
  },
  long36: {
    RUB: { total: 23400, per: 650 }, // 36 тренировок
    EUR: { total: 252, per: 7 },
  },
} as const;

type Currency = "RUB" | "EUR";

function formatPrice(value: number, currency: Currency) {
  const suffix = currency === "RUB" ? "₽" : "€";
  return `${value.toLocaleString("ru-RU")} ${suffix}`;
}

// то, что передаём вверх в модалку покупки
export type PurchaseOptions = {
  tariffId: "review" | "month" | "slow12" | "long36";
  tariffLabel: string;
  amount: number;
  currency: Currency;
};

type PricingProps = {
  onOpenTestModal?: (context?: string) => void;
  onOpenPurchaseModal?: (options: PurchaseOptions) => void;
};

export function Pricing({ onOpenTestModal, onOpenPurchaseModal }: PricingProps) {
  const [currency, setCurrency] = useState<Currency>("RUB");
  const isRub = currency === "RUB";

  const toggleCurrency = () => {
    setCurrency((prev) => (prev === "RUB" ? "EUR" : "RUB"));
  };

  const switchHint = isRub
    ? "Оплата российской картой"
    : "Оплата зарубежной картой";

  return (
    <section
      id="pricing"
      className="py-16 sm:py-20 lg:py-24 scroll-mt-24 md:scroll-mt-28 border-t border-white/5"
    >
      <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8">
        {/* Заголовок + переключатель валюты */}
        <div className="mb-10 sm:mb-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand-muted mb-3">
              Цены
            </p>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight mb-4">
              Сколько стоят тренировки
            </h2>

            <p className="mt-3 max-w-2xl text-sm sm:text-base text-brand-muted">
              Ты покупаешь блок тренировок, проходишь его в своём темпе, а
              потом можешь взять следующий. Без подписки и автосписаний.
            </p>
          </div>

          {/* Переключатель валюты */}
          <div className="flex flex-col items-start sm:items-end gap-1.5">
            <div className="flex items-center gap-3">
              <span className="text-[11px] uppercase tracking-[0.16em] text-brand-muted/80" />
              <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1 text-xs sm:text-sm">
                <button
                  type="button"
                  onClick={toggleCurrency}
                  className={[
                    "px-3 py-1.5 rounded-full transition-colors",
                    isRub ? "bg-white text-brand-dark" : "text-brand-muted",
                  ].join(" ")}
                >
                  ₽ RUB
                </button>
                <button
                  type="button"
                  onClick={toggleCurrency}
                  className={[
                    "px-3 py-1.5 rounded-full transition-colors",
                    !isRub ? "bg-white text-brand-dark" : "text-brand-muted",
                  ].join(" ")}
                >
                  € EUR
                </button>
              </div>
            </div>
            <p className="text-[11px] sm:text-xs text-brand-muted/80">
              {switchHint}
            </p>
          </div>
        </div>

        {/* Две аккуратные колонки с текстом над карточками */}
        <div className="mb-8 sm:mb-10 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs sm:text-sm text-brand-muted">
          <span>
            1 тренировка = персональная программа в приложении + разбор техники
            по твоим видео.
          </span>
          <span className="text-brand-muted/80">
            Количество тренировок можно использовать в своём темпе, без жёстких
            сроков.
          </span>
        </div>

        {/* Сетка тарифов */}
        <div className="grid gap-6 lg:gap-8 md:grid-cols-2 xl:grid-cols-4 items-stretch">
          {/* 1. Тест силы — бесплатный, использует текущую модалку теста */}
          <article className="flex h-full flex-col rounded-3xl border border-white/10 bg-white/5 px-5 py-6 sm:px-6 sm:py-7 backdrop-blur-sm shadow-soft">
            <div>
              <div className="inline-flex items-center gap-2 mb-3 text-[11px] uppercase tracking-[0.16em] text-brand-muted">
                <StepDot />
                <span>Шаг 1 · старт · приложение</span>
              </div>
              <h3 className="text-base sm:text-lg font-semibold mb-2">
                Тест силы
              </h3>
              <p className="text-sm font-semibold mb-1">
                {formatPrice(0, currency)}
              </p>
              <p className="text-[11px] text-brand-muted mb-4">бесплатно</p>
              <ul className="mb-4 space-y-1.5 text-[11px] sm:text-xs text-brand-muted">
                <li>• Доступ к приложению и формату тренировок</li>
                <li>• Упражнения с объяснением техники</li>
                <li>• Без оплаты и обязательств</li>
              </ul>
              <p className="text-xs sm:text-sm text-brand-muted">
                Проходишь тест в удобное время и загружаешь видео в приложение.
              </p>
            </div>

            <div className="mt-auto pt-4">
              <TestSignupButton
                label="Пройти тест бесплатно"
                buttonClassName="w-full rounded-full bg-brand-primary px-4 py-2 text-xs sm:text-sm font-semibold shadow-soft hover:bg-brand-primary/90 transition-colors"
                onClick={() =>
                  onOpenTestModal?.("Блок цен: Тест силы (бесплатно)")
                }
              />
            </div>
          </article>

          {/* 2. Разбор техники — платный тариф */}
          <article className="flex h-full flex-col rounded-3xl border border-white/10 bg-white/5 px-5 py-6 sm:px-6 sm:py-7 backdrop-blur-sm shadow-soft">
            <div>
              <div className="inline-flex items-center gap-2 mb-3 text-[11px] uppercase tracking-[0.16em] text-brand-muted">
                <StepDot color="bg-brand-accent" />
                <span>Разовый формат</span>
              </div>
              <h3 className="text-base sm:text-lg font-semibold mb-2">
                Разбор техники
              </h3>
              <p className="text-sm font-semibold mb-1">
                {formatPrice(prices.review[currency].total, currency)}
              </p>
              <p className="text-[11px] text-brand-muted mb-4">
                разовый формат
              </p>
              <ul className="mb-4 space-y-1.5 text-[11px] sm:text-xs text-brand-muted">
                <li>• Всё, что в тесте силы</li>
                <li>• Подробный разбор техники от тренера</li>
                <li>• Первая тренировка под тебя</li>
                <li>• Рекомендации по нагрузке на ближайшие недели</li>
              </ul>
              <p className="text-xs sm:text-sm text-brand-muted">
                Знакомишься с тренером и начинаешь свой путь в калистенике.
              </p>
            </div>

            <div className="mt-auto pt-4">
              <button
                className="w-full rounded-full border border-white/40 px-4 py-2 text-xs sm:text-sm font-semibold hover:bg-white/10 transition-colors"
                onClick={() =>
                  onOpenPurchaseModal?.({
                    tariffId: "review",
                    tariffLabel: "Разбор техники (1 занятие)",
                    amount: prices.review[currency].total,
                    currency,
                  })
                }
              >
                Оплатить разбор техники
              </button>
            </div>
          </article>

          {/* 3. 12 занятий — акцентный план */}
          <article className="relative flex h-full flex-col rounded-3xl border border-brand-primary/40 bg-brand-primary/5 px-5 py-6 sm:px-6 sm:py-7 backdrop-blur-sm shadow-[0_0_40px_rgba(216,22,150,0.35)] overflow-hidden">
            <div className="pointer-events-none absolute inset-0 rounded-3xl border border-brand-primary/60 opacity-40" />
            <div className="relative flex h-full flex-col">
              <div>
                <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-brand-muted min-h-[32px]">
                  <StepDot color="bg-brand-primary" />
                  <span>Интенсивный блок</span>
                </div>
                <h3 className="text-base sm:text-lg font-semibold mb-2">
                  12 тренировок
                </h3>
                <p className="text-sm font-semibold mb-1">
                  {formatPrice(prices.month[currency].total, currency)}
                </p>
                <p className="text-[11px] text-brand-muted mb-4">
                  {formatPrice(prices.month[currency].per, currency)} за
                  тренировку
                </p>
                <ul className="mb-4 space-y-1.5 text-[11px] sm:text-xs text-brand-muted">
                  <li>• Всё, что в тесте силы</li>
                  <li>• 12 персональных тренировок</li>
                  <li>• Разбор техники после каждой тренировки</li>
                  <li>• Можно тренироваться 2–3 раза в неделю</li>
                </ul>
                <p className="text-xs sm:text-sm text-brand-muted">
                  Блок, чтобы заметно продвинуться в силе, технике и форме.
                </p>
              </div>

              <div className="mt-auto pt-4">
                <button
                  className="mt-3 w-full rounded-full border border-white/40 bg-transparent px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-white/10 transition-colors"
                  onClick={() =>
                    onOpenPurchaseModal?.({
                      tariffId: "month",
                      tariffLabel: "Блок 12 тренировок",
                      amount: prices.month[currency].total,
                      currency,
                    })
                  }
                >
                  Купить 12 тренировок
                </button>
              </div>
            </div>
          </article>

          {/* 4. Спокойный темп + длинный блок */}
          <article className="relative flex h-full flex-col rounded-3xl border border-white/10 bg-white/5 px-5 py-6 sm:px-6 sm:py-7">
            <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-brand-muted min-h-[32px]">
              <StepDot color="bg-brand-accent/80" />
              <span>Спокойный и длинный формат</span>
            </div>

            {/* верхняя половина — 12 тренировок в спокойном темпе */}
            <div className="flex flex-1 flex-col justify-between pb-4 mb-4 border-b border-white/10">
              <div>
                <h3 className="text-base sm:text-lg font-semibold mb-2">
                  12 тренировок — спокойный темп
                </h3>

                <p className="text-sm font-semibold text-white">
                  {formatPrice(prices.slow12[currency].total, currency)}
                </p>
                <p className="text-[11px] text-brand-muted mb-2">
                  {formatPrice(prices.slow12[currency].per, currency)} за
                  тренировку
                </p>

                <p className="text-[11px] sm:text-xs text-brand-muted">
                  Подойдёт, если хочешь 1–2 тренировки в неделю без гонки и
                  дедлайнов.
                </p>
              </div>

              <button
                className="mt-3 w-full rounded-full border border-white/40 bg-transparent px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-white/10 transition-colors"
                onClick={() =>
                  onOpenPurchaseModal?.({
                    tariffId: "slow12",
                    tariffLabel: "12 тренировок — спокойный темп",
                    amount: prices.slow12[currency].total,
                    currency,
                  })
                }
              >
                Купить спокойный блок (12 трен.)
              </button>
            </div>

            {/* нижняя половина — 36 тренировок */}
            <div className="flex flex-1 flex-col justify-between pt-2">
              <div>
                <h3 className="text-sm sm:text-base font-semibold mb-1 text-white">
                  36 тренировок
                </h3>

                <p className="text-sm font-semibold text-white">
                  {formatPrice(prices.long36[currency].total, currency)}
                </p>
                <p className="text-[11px] text-brand-muted mb-2">
                  {formatPrice(prices.long36[currency].per, currency)} за
                  тренировку
                </p>

                <p className="text-[11px] sm:text-xs text-brand-muted">
                  Для тех, кто точно остаётся надолго и хочет стабильный рост.
                </p>
              </div>

              <button
                className="mt-3 w-full rounded-full border border-white/40 bg-transparent px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-white/10 transition-colors"
                onClick={() =>
                  onOpenPurchaseModal?.({
                    tariffId: "long36",
                    tariffLabel: "36 тренировок",
                    amount: prices.long36[currency].total,
                    currency,
                  })
                }
              >
                Купить 36 тренировок
              </button>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
