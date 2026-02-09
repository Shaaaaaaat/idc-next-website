// src/components/Pricing.tsx
"use client";
import { useState } from "react";

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
    RUB: { total: 25200, per: 700 }, // 36 тренировок
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
  studioName?: string;
};

type PricingProps = {
  onOpenTestModal?: (context?: string) => void;
  onOpenPurchaseModal?: (options: PurchaseOptions) => void;
};

export function Pricing({
  onOpenTestModal,
  onOpenPurchaseModal,
}: PricingProps) {
  const currency: Currency = "RUB";
  // Подарочный сертификат — состояние модалки и формы
  const [isCertOpen, setIsCertOpen] = useState(false);
  const [certPayerName, setCertPayerName] = useState("");
  const [certRecipientName, setCertRecipientName] = useState("");
  const [certEmail, setCertEmail] = useState("");
  const [certPhone, setCertPhone] = useState("");
  const [certAmount, setCertAmount] = useState<string>("");
  const [certAgreed, setCertAgreed] = useState(false);
  const [isCertSubmitting, setIsCertSubmitting] = useState(false);
  const [certPhoneError, setCertPhoneError] = useState<string | null>(null);

  // Телефон: +7 маска, иначе интернац. формат
  function formatPhoneInput(raw: string): string {
    const s = String(raw || "");
    const plusDigits = s.replace(/[^\d+]/g, "");
    const isRu = /^\+?7/.test(plusDigits) || /^8/.test(plusDigits);
    if (isRu) {
      let digits = (plusDigits.match(/\d/g) || []).join("");
      if (!digits) return "+7 ";
      if (digits[0] === "8") digits = "7" + digits.slice(1);
      if (digits[0] !== "7") digits = "7" + digits;
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
    let out = plusDigits.replace(/(?!^)\+/g, "");
    if (out && out[0] !== "+") out = "+" + out.replace(/[^\d]/g, "");
    return out;
  }

  function isValidIntlPhone(v: string) {
    const compact = v.replace(/[\s()-]/g, "");
    if (/^\+7/.test(compact)) {
      const digits = (compact.match(/\d/g) || []).join("");
      return digits.length === 11 && digits[0] === "7";
    }
    return /^\+\d{8,15}$/.test(compact);
  }

  async function handleCertificateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isCertSubmitting || !certAgreed) return;
    if (!isValidIntlPhone(certPhone)) {
      setCertPhoneError("Проверьте номер телефона: нужно 11 цифр, формат +7 (XXX) XXX-XX-XX");
      return;
    }
    setCertPhoneError(null);
    const amountNumber = Number((certAmount || "").replace(/[^\d]/g, ""));
    if (!amountNumber || amountNumber <= 0) return;

    setIsCertSubmitting(true);
    try {
      const res = await fetch("/api/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: certPayerName,
          email: certEmail,
          phone: certPhone,
          courseName: `Подарочный сертификат · Получатель: ${certRecipientName}`,
          tariffId: "review",
          tariffLabel: "Подарочный сертификат",
          amount: amountNumber,
          currency,
          studioName: null,
        }),
      });
      if (!res.ok) {
        console.error("Ошибка создания оплаты сертификата", await res.text());
        return;
      }
      const data = await res.json();
      if (data.paymentUrl) {
        window.location.href = data.paymentUrl;
      }
    } catch (err) {
      console.error("Ошибка запроса (сертификат)", err);
    } finally {
      setIsCertSubmitting(false);
    }
  }

  return (
    <section
      id="pricing"
      className="py-16 sm:py-20 lg:py-24 border-t border-white/5 scroll-mt-[calc(var(--header-h)+var(--anchor-extra))]"
    >
      <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8">
        {/* Заголовок */}
        <div className="mb-6 sm:mb-8 flex flex-col gap-6">
          <div className="max-w-3xl">
            <p className="text-[11px] sm:text-xs font-medium uppercase tracking-[0.2em] text-brand-muted mb-3">
              Цены
            </p>
            <h2 className="text-[26px] sm:text-3xl lg:text-4xl font-semibold tracking-tight mb-3 leading-tight">
              Сколько стоят онлайн‑тренировки
            </h2>

            <p className="mt-2 max-w-2xl text-[14px] sm:text-base text-brand-muted leading-relaxed">
              Ты покупаешь блок тренировок, проходишь его в своём темпе, а
              потом можешь взять следующий. Без подписки и автосписаний.
            </p>
          </div>
        </div>

        {/* CTA для оплат зарубежной картой */}
        <div className="mb-8 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 sm:px-5 sm:py-4 flex items-center justify-between gap-3 text-[13px] sm:text-sm">
          <span className="text-brand-muted">Находитесь за рубежом?</span>
          <a
            href="https://www.idocalisthenics.com/ru#pricing-top"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-full border border-white/30 px-4 py-2 font-semibold hover:bg-white/10 transition-colors"
          >
            Оплатить зарубежной картой
          </a>
        </div>

        {/* Короткое пояснение — привязываем ширину к колонкам карточек */}
        <div className="mb-8 sm:mb-10 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-3 text-[13px] sm:text-sm text-brand-muted">
          <span className="sm:col-span-2 xl:col-span-2">
            1 тренировка = персональная программа в приложении + разбор техники по твоим видео.
          </span>
          <span className="sm:col-span-2 xl:col-span-2 text-brand-muted/80">
            Темп прохождения тренировок зависит от выбранного тарифа.
          </span>
        </div>

        {/* Сетка тарифов */}
        <div className="grid gap-6 lg:gap-8 md:grid-cols-2 xl:grid-cols-4 items-stretch">
          {/* 1. 1 тренировка — разовый формат */}
          <article className="flex h-full flex-col rounded-3xl border border-white/10 bg-white/5 px-5 py-6 sm:px-6 sm:py-7 backdrop-blur-sm shadow-soft">
            <div>
              <div className="inline-flex items-center gap-2 mb-3 text-[11px] uppercase tracking-[0.16em] text-brand-muted min-h-[32px]">
                <StepDot />
                <span>Разовый формат</span>
              </div>
              <h3 className="text-[16px] sm:text-lg font-semibold mb-2">
                1 тренировка
              </h3>
              <p className="text-[15px] font-semibold mb-1 min-h-[24px] sm:min-h-[28px]">
                {formatPrice(prices.review[currency].total, currency)}
              </p>
              <p className="text-[11px] text-brand-muted mb-4 min-h-[18px] sm:min-h-[20px]">
                доступ 4 недели
              </p>
              <ul className="mb-4 space-y-1.5 text-[12px] sm:text-xs text-brand-muted">
                <li>• Разовый платёж без обязательств</li>
                <li>• Можно совмещать с другими тренировками</li>
              </ul>
              <p className="text-[13px] sm:text-sm text-brand-muted leading-relaxed">
                Идеальный вариант, чтобы понять, подходит ли тебе калистеника.
              </p>
            </div>

            <div className="mt-auto pt-4">
              <button
                className="w-full rounded-full border border-white/40 px-4 py-2.5 text-[13px] sm:text-sm font-semibold hover:bg-white/10 transition-colors"
                onClick={() =>
                  onOpenPurchaseModal?.({
                    tariffId: "review",
                    tariffLabel: "1 тренировка",
                    amount: prices.review[currency].total,
                    currency,
                  })
                }
              >
                Купить
              </button>
            </div>
          </article>

          {/* 2. 12 тренировок — интенсивный блок */}
          <article className="flex h-full flex-col rounded-3xl border border-white/10 bg-white/5 px-5 py-6 sm:px-6 sm:py-7 backdrop-blur-sm shadow-soft">
            <div>
              <div className="inline-flex items-center gap-2 mb-3 text-[11px] uppercase tracking-[0.16em] text-brand-muted min-h-[32px]">
                <StepDot color="bg-brand-accent" />
                <span>Интенсивный блок</span>
              </div>
              <h3 className="text-[16px] sm:text-lg font-semibold mb-2">
                12 тренировок
              </h3>
              <p className="text-[15px] font-semibold mb-1 min-h-[24px] sm:min-h-[28px]">
                {formatPrice(prices.month[currency].total, currency)}
              </p>
              <p className="text-[11px] text-brand-muted mb-4 min-h-[18px] sm:min-h-[20px]">доступ 4 недели</p>
              <ul className="mb-4 space-y-1.5 text-[12px] sm:text-xs text-brand-muted">
                <li>• Тренировки 3 раза в неделю</li>
                <li>• Самый результативный формат</li>
              </ul>
              <p className="text-[13px] sm:text-sm text-brand-muted leading-relaxed">
                Для тех, кто хочет заметный прогресс за короткий срок.
              </p>
            </div>

            <div className="mt-auto pt-4">
              <button
                className="w-full rounded-full border border-white/40 px-4 py-2.5 text-[13px] sm:text-sm font-semibold hover:bg-white/10 transition-colors"
                onClick={() =>
                  onOpenPurchaseModal?.({
                    tariffId: "month",
                    tariffLabel: "12 тренировок (интенсивный блок)",
                    amount: prices.month[currency].total,
                    currency,
                  })
                }
              >
                Купить
              </button>
            </div>
          </article>

          {/* 3. 12 тренировок — спокойный формат */}
          <article className="relative flex h-full flex-col rounded-3xl border border-brand-primary/40 bg-brand-primary/5 px-5 py-6 sm:px-6 sm:py-7 backdrop-blur-sm shadow-[0_0_40px_rgba(216,22,150,0.35)] overflow-hidden">
            <div className="pointer-events-none absolute inset-0 rounded-3xl border border-brand-primary/60 opacity-40" />

            <div className="relative flex h-full flex-col">
              <div>
                <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-brand-muted min-h-[32px]">
                  <StepDot color="bg-brand-primary" />
                  <span>Спокойный формат</span>
                </div>
                <h3 className="text-[16px] sm:text-lg font-semibold mb-2">
                  12 тренировок
                </h3>
                <p className="text-[15px] font-semibold mb-1 min-h-[24px] sm:min-h-[28px]">
                  {formatPrice(prices.slow12[currency].total, currency)}
                </p>
                <p className="text-[11px] text-brand-muted mb-4 min-h-[18px] sm:min-h-[20px]">доступ 8 недель</p>
                <ul className="mb-4 space-y-1.5 text-[12px] sm:text-xs text-brand-muted">
                  <li>• Тренировки 2 раза в неделю</li>
                  <li>• Спокойный и комфортный темп</li>
                </ul>
                <p className="text-[13px] sm:text-sm text-brand-muted leading-relaxed">
                  Подойдёт, если хочешь встроить тренировки в жизнь без спешки.
                </p>
              </div>

              <div className="mt-auto pt-4">
                <button
                  className="mt-3 w-full rounded-full border border-white/40 bg-transparent px-4 py-2.5 text-[13px] sm:text-sm font-semibold text-white hover:bg-white/10 transition-colors"
                  onClick={() =>
                    onOpenPurchaseModal?.({
                      tariffId: "slow12",
                      tariffLabel: "12 тренировок (спокойный формат)",
                      amount: prices.slow12[currency].total,
                      currency,
                    })
                  }
                >
                  Купить
                </button>
              </div>
            </div>
          </article>

          {/* 4. 36 тренировок — спокойный и длинный формат */}
          <article className="relative flex h-full flex-col rounded-3xl border border-white/10 bg-white/5 px-5 py-6 sm:px-6 sm:py-7">
            <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-brand-muted min-h-[32px]">
              <StepDot color="bg-brand-accent/80" />
              <span>Спокойный формат</span>
            </div>

            <div className="flex flex-1 flex-col justify-between pb-1">
              <div>
                <h3 className="text-[16px] sm:text-lg font-semibold mb-2 whitespace-nowrap min-h-[24px] sm:min-h-[28px]">
                  36 тренировок
                </h3>

                <p className="text-[15px] font-semibold text-white min-h-[24px] sm:min-h-[28px]">
                  {formatPrice(prices.long36[currency].total, currency)}
                </p>
                <p className="text-[11px] text-brand-muted mb-4 min-h-[18px] sm:min-h-[20px]">доступ 18 недель</p>
                <ul className="mb-4 space-y-1.5 text-[12px] sm:text-xs text-brand-muted">
                  <li>• Стабильный прогресс и наиболее выгодная цена</li>
                </ul>

                <p className="text-[13px] sm:text-sm text-brand-muted leading-relaxed">
                  Для тех, кто точно остаётся надолго и хочет стабильный рост.
                </p>
              </div>

              <button
                className="mt-3 w-full rounded-full border border-white/40 bg-transparent px-4 py-2.5 text-[13px] sm:text-sm font-semibold text-white hover:bg-white/10 transition-colors"
                onClick={() =>
                  onOpenPurchaseModal?.({
                    tariffId: "long36",
                    tariffLabel: "36 тренировок",
                    amount: prices.long36[currency].total,
                    currency,
                  })
                }
              >
                Купить
              </button>
            </div>
          </article>
        </div>
        {/* Футер блока цен: пояснение + сертификат */}
        <div className="mt-8 sm:mt-10 text-center text-[13px] sm:text-sm text-brand-muted">
          Ты можешь начать с теста силы отдельно или сразу с тарифа — в этом случае первая тренировка будет тестом силы.
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setIsCertOpen(true)}
              className="text-white underline decoration-dotted hover:opacity-90"
            >
              Подарить сертификат
            </button>
          </div>
        </div>

        {/* Модалка сертификата */}
        {isCertOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/60 p-4 sm:p-0 flex items-center justify-center"
            onClick={() => setIsCertOpen(false)}
          >
            <div
              className="w-full max-w-md rounded-3xl bg-brand-dark border border-white/10 p-5 sm:p-6 shadow-xl max-h-[calc(100dvh-2rem)] overflow-y-auto pb-[max(1.25rem,env(safe-area-inset-bottom))]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg sm:text-xl font-semibold">Сумма (RUB)</h3>
                  <p className="mt-1 text-[11px] sm:text-xs text-brand-muted">
                    Укажите данные плательщика и имя получателя. Сумму можно выбрать самостоятельно.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCertOpen(false)}
                  className="rounded-full bg-white/5 p-1 text-brand-muted hover:bg-white/10 hover:text-white transition-colors"
                  aria-label="Закрыть"
                >
                  <span className="block h-4 w-4 leading-none">✕</span>
                </button>
              </div>

              <form className="space-y-4" onSubmit={handleCertificateSubmit}>
                <div className="space-y-1">
                  <label className="text-xs sm:text-sm text-brand-muted">Ваше имя</label>
                  <input
                    type="text"
                    value={certPayerName}
                    onChange={(e) => setCertPayerName(e.target.value)}
                    required
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary"
                    placeholder="Например: Анна Иванова"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs sm:text-sm text-brand-muted">Имя получателя</label>
                  <input
                    type="text"
                    value={certRecipientName}
                    onChange={(e) => setCertRecipientName(e.target.value)}
                    required
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary"
                    placeholder="Кому дарим сертификат"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs sm:text-sm text-brand-muted">Email</label>
                  <input
                    type="email"
                    value={certEmail}
                    onChange={(e) => setCertEmail(e.target.value)}
                    required
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary"
                    placeholder="you@example.com"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs sm:text-sm text-brand-muted">Телефон</label>
                  <input
                    type="tel"
                    value={certPhone}
                    onChange={(e) => setCertPhone(formatPhoneInput(e.target.value))}
                    onFocus={() => {
                      if (!certPhone) {
                        setCertPhone("+7 ");
                      }
                    }}
                    onBlur={() => {
                      const v = (certPhone || "").trim();
                      if (!v) return;
                      if (v === "+7" || v === "+7)") {
                        setCertPhone("");
                        return;
                      }
                      if (/^\+?7/.test(v) || /^8/.test(v)) {
                        setCertPhone(formatPhoneInput(v));
                      } else {
                        const cleaned = v.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
                        setCertPhone(cleaned.startsWith("+") ? cleaned : "+" + cleaned);
                      }
                    }}
                    inputMode="tel"
                    required
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary"
                    placeholder="(___) ___-__-__"
                  />
                  {certPhoneError && (
                    <p className="mt-1 text-[12px] text-red-400">{certPhoneError}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-xs sm:text-sm text-brand-muted">Сумма (RUB)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={certAmount}
                    onChange={(e) => setCertAmount(e.target.value.replace(/[^\d]/g, ""))}
                    required
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary"
                    placeholder="Например: 5000"
                  />
                </div>

                <label className="flex items-start gap-2 text-[11px] sm:text-xs text-brand-muted">
                  <input
                    type="checkbox"
                    checked={certAgreed}
                    onChange={(e) => setCertAgreed(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 rounded border-white/20 bg-transparent text-brand-primary focus:ring-0"
                    required
                  />
                  <span>
                    Я согласен(на) с{" "}
                    <a href="/offer" target="_blank" className="underline decoration-dotted hover:text-white">
                      условиями Договора оферты
                    </a>{" "}
                    и{" "}
                    <a href="/privacy" target="_blank" className="underline decoration-dotted hover:text-white">
                      Политикой обработки персональных данных
                    </a>
                    .
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={isCertSubmitting || !certAgreed || !isValidIntlPhone(certPhone)}
                  className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-brand-primary px-4 py-2.5 text-sm font-semibold disabled:opacity-60 disabled:pointer-events-none hover:bg-brand-primary/90 transition-colors"
                >
                  {isCertSubmitting ? "Переходим к оплате..." : "Оплатить сертификат"}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
