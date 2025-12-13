// src/app/page.tsx
"use client";

import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";

import { HowItWorks } from "@/components/HowItWorks";
import { Courses } from "@/components/Courses";
import { Pricing, type PurchaseOptions } from "@/components/Pricing";
import { Locations } from "@/components/Locations";
import { ChatWidget } from "@/components/ChatWidget";
import { About } from "@/components/About";
import { FAQ } from "@/components/FAQ";
import { Testimonials } from "@/components/Testimonials";
import { TestSignupButton } from "@/components/TestSignupButton";
import { courseNames } from "@/data/courses";
import { Footer } from "@/components/Footer";

function HowStepCard({
  children,
  className,
  delayClass = "delay-0",
}: {
  children: ReactNode;
  className?: string;
  delayClass?: string;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.2 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={cardRef}
      className={[
        "relative rounded-3xl border p-5 sm:p-6 flex flex-col gap-3",
        "transform-gpu transition-all duration-700 ease-out",
        delayClass,
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
        "hover:-translate-y-1.5",
        className ?? "",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

export default function HomePage() {
  /* ---------- Мобильное меню ---------- */
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  /* ---------- Модалка теста силы ---------- */
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [testContext, setTestContext] = useState<string | undefined>();

  const [testFullName, setTestFullName] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [testAgreed, setTestAgreed] = useState(false);
  const [isTestSubmitting, setIsTestSubmitting] = useState(false);

  function openTestModal(context?: string) {
    setTestContext(context);
    setIsTestModalOpen(true);
  }

  function closeTestModal() {
    if (isTestSubmitting) return;
    setIsTestModalOpen(false);
  }

  async function handleTestSubmit(e: FormEvent) {
    e.preventDefault();
    if (!testAgreed || isTestSubmitting) return;

    setIsTestSubmitting(true);

    try {
      const res = await fetch("/api/test-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: testFullName,
          email: testEmail,
          context: testContext ?? "",
        }),
      });

      if (!res.ok) {
        console.error("Ошибка отправки формы теста", await res.text());
      } else {
        setTestFullName("");
        setTestEmail("");
        setTestAgreed(false);
        setIsTestModalOpen(false);
      }
    } catch (err) {
      console.error("Ошибка запроса (тест силы)", err);
    } finally {
      setIsTestSubmitting(false);
    }
  }

  /* ---------- Модалка покупки тарифа ---------- */
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [purchaseOptions, setPurchaseOptions] =
    useState<PurchaseOptions | null>(null);

  const [buyFullName, setBuyFullName] = useState("");
  const [buyEmail, setBuyEmail] = useState("");
  const [buyPhone, setBuyPhone] = useState("");
  const [buyCourse, setBuyCourse] = useState<string>("");
  const [buyAgreed, setBuyAgreed] = useState(false);
  const [isBuySubmitting, setIsBuySubmitting] = useState(false);

  function openPurchaseModal(options: PurchaseOptions) {
    setPurchaseOptions(options);
    setIsPurchaseModalOpen(true);
  }

  function closePurchaseModal() {
    if (isBuySubmitting) return;
    setIsPurchaseModalOpen(false);
  }

  async function handlePurchaseSubmit(e: FormEvent) {
    e.preventDefault();
    if (!purchaseOptions || !buyAgreed || isBuySubmitting) return;

    setIsBuySubmitting(true);

    try {
      const res = await fetch("/api/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: buyFullName,
          email: buyEmail,
          phone: buyPhone,
          courseName: buyCourse,
          tariffId: purchaseOptions.tariffId,
          tariffLabel: purchaseOptions.tariffLabel,
          amount: purchaseOptions.amount,
          currency: purchaseOptions.currency,
          studioName: purchaseOptions.studioName ?? null,
        }),
      });

      if (!res.ok) {
        console.error("Ошибка создания оплаты", await res.text());
      } else {
        const data = await res.json();
        if (data.paymentUrl) {
          window.location.href = data.paymentUrl;
        } else {
          console.error("paymentUrl не получен из API");
        }
      }
    } catch (err) {
      console.error("Ошибка запроса (покупка тарифа)", err);
    } finally {
      setIsBuySubmitting(false);
    }
  }

  /* ---------- Модалка логина (Войти) ---------- */
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isLoginSubmitting, setIsLoginSubmitting] = useState(false);
  const [loginMessage, setLoginMessage] = useState("");

  function openLoginModal() {
    setLoginEmail("");
    setLoginPassword("");
    setLoginMessage("");
    setIsLoginModalOpen(true);
  }

  function closeLoginModal() {
    if (isLoginSubmitting) return;
    setIsLoginModalOpen(false);
  }

  function handleLoginSubmit(e: FormEvent) {
    e.preventDefault();
    if (isLoginSubmitting) return;

    setIsLoginSubmitting(true);

    // имитация "логина" без реальной авторизации
    setTimeout(() => {
      setIsLoginSubmitting(false);
      setLoginMessage(
        "Личный кабинет сейчас в разработке. Мы сообщим на email, когда доступ к приложению будет открыт."
      );
    }, 400);
  }

  /* ---------- Scroll lock для iOS Safari, чтобы модалки не “уезжали вниз” ---------- */
  const scrollYRef = useRef(0);
  const anyModalOpen =
    isTestModalOpen || isPurchaseModalOpen || isLoginModalOpen;

    useEffect(() => {
      if (!anyModalOpen) return;
    
      scrollYRef.current = window.scrollY || 0;
    
      const body = document.body;
      body.style.position = "fixed";
      body.style.top = `-${scrollYRef.current}px`;
      body.style.left = "0";
      body.style.right = "0";
      body.style.width = "100%";
      body.style.overflow = "hidden";
    
      return () => {
        const y = scrollYRef.current;
    
        body.style.position = "";
        body.style.top = "";
        body.style.left = "";
        body.style.right = "";
        body.style.width = "";
        body.style.overflow = "";
    
        // 🔥 важно: убрать smooth на миг, иначе будет “пролистывание”
        const html = document.documentElement;
        const prev = html.style.scrollBehavior;
        html.style.scrollBehavior = "auto";
    
        // если вдруг браузер чуть “уплыл”, вернём строго
        window.scrollTo({ top: y, left: 0, behavior: "auto" });
    
        // вернуть как было
        html.style.scrollBehavior = prev;
      };
    }, [anyModalOpen]);
    

  return (
    <main className="min-h-screen bg-brand-dark text-white">
      <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8 py-8 sm:py-16 lg:py-20">
        {/* Top bar */}
        <header className="sticky top-0 z-40 mb-8 sm:mb-12 backdrop-blur-md">
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex items-center gap-2">
              <Image
                src="/logo-idc-white1.svg"
                alt="I Do Calisthenics"
                width={150}
                height={40}
                className="h-7 w-auto sm:h-8 lg:h-9"
                priority
              />
              <span className="text-base sm:text-lg font-medium tracking-tight">
                I Do Calisthenics
              </span>
            </div>

            {/* Десктоп-навигация */}
            <nav className="hidden md:flex items-center gap-6 text-sm text-brand-muted">
              <a href="#how" className="hover:text-white transition-colors">
                Как это работает
              </a>
              <a href="#courses" className="hover:text-white transition-colors">
                Курсы
              </a>
              <a href="#pricing" className="hover:text-white transition-colors">
                Цены
              </a>
              <a
                href="#locations"
                className="hover:text-white transition-colors"
              >
                Локации
              </a>
              <a href="#about" className="hover:text-white transition-colors">
                О проекте
              </a>
              <a href="#reviews" className="hover:text-white transition-colors">
                Отзывы
              </a>
              <a href="#faq" className="hover:text-white transition-colors">
                FAQ
              </a>
            </nav>

            {/* Кнопка Войти — десктоп */}
            <button
              className="hidden md:inline-flex items-center rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium hover:bg-white/10 transition-colors"
              type="button"
              onClick={openLoginModal}
            >
              Войти
            </button>

            {/* Бургер — только мобилка */}
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/5 md:hidden"
              onClick={() => setIsMobileNavOpen(true)}
              aria-label="Открыть меню"
            >
              <span className="sr-only">Открыть меню</span>
              <div className="flex flex-col items-center justify-center gap-1.5">
                <span className="block h-0.5 w-5 rounded-full bg-white" />
                <span className="block h-0.5 w-5 rounded-full bg-white" />
                <span className="block h-0.5 w-5 rounded-full bg-white" />
              </div>
            </button>
          </div>
        </header>

        {/* Мобильное меню */}
        {isMobileNavOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/70 md:hidden"
            onClick={() => setIsMobileNavOpen(false)}
          >
            <nav
              className="absolute left-4 right-4 top-6 rounded-3xl bg-brand-dark border border-white/10 p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className="text-base font-medium">Меню</span>

                <button
                  type="button"
                  onClick={() => setIsMobileNavOpen(false)}
                  className="h-10 w-10 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-xl leading-none hover:bg-white/20 transition-colors"
                  aria-label="Закрыть меню"
                >
                  ×
                </button>
              </div>

              <div className="flex flex-col gap-2 mb-4 text-[16px]">
                <a
                  href="#how"
                  className="rounded-2xl px-3 py-2 hover:bg-white/5"
                  onClick={() => setIsMobileNavOpen(false)}
                >
                  Как это работает
                </a>
                <a
                  href="#courses"
                  className="rounded-2xl px-3 py-2 hover:bg-white/5"
                  onClick={() => setIsMobileNavOpen(false)}
                >
                  Курсы
                </a>
                <a
                  href="#pricing"
                  className="rounded-2xl px-3 py-2 hover:bg-white/5"
                  onClick={() => setIsMobileNavOpen(false)}
                >
                  Цены
                </a>
                <a
                  href="#locations"
                  className="rounded-2xl px-3 py-2 hover:bg-white/5"
                  onClick={() => setIsMobileNavOpen(false)}
                >
                  Локации
                </a>
                <a
                  href="#about"
                  className="rounded-2xl px-3 py-2 hover:bg-white/5"
                  onClick={() => setIsMobileNavOpen(false)}
                >
                  О проекте
                </a>
                <a
                  href="#reviews"
                  className="rounded-2xl px-3 py-2 hover:bg-white/5"
                  onClick={() => setIsMobileNavOpen(false)}
                >
                  Отзывы
                </a>
                <a
                  href="#faq"
                  className="rounded-2xl px-3 py-2 hover:bg-white/5"
                  onClick={() => setIsMobileNavOpen(false)}
                >
                  FAQ
                </a>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileNavOpen(false);
                    openTestModal("Моб. меню: Пройти тест силы");
                  }}
                  className="w-full rounded-full bg-brand-primary px-4 py-3 text-sm font-semibold text-white hover:bg-brand-primary/90 transition-colors"
                >
                  Пройти тест силы
                </button>
              </div>
            </nav>
          </div>
        )}

        {/* HERO */}
        <section className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] items-center mb-16 lg:mb-24">
          {/* Left side */}
          <div className="space-y-6 sm:space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-[12px] sm:text-sm text-brand-muted border border-white/10">
              <span className="h-2 w-2 rounded-full bg-brand-accent" />
              Онлайн программы по калистенике
            </div>

            <h1 className="text-[30px] sm:text-4xl lg:text-6xl font-semibold leading-tight tracking-tight">
              Тренировки с
              <br />
              собственным весом
              <span className="block text-[17px] sm:text-xl lg:text-2xl text-brand-accent mt-3 lg:mt-4">
                в комфортном темпе и с фокусом на технике
              </span>
            </h1>

            <p className="max-w-xl text-[15px] sm:text-base text-brand-muted leading-relaxed">
              Учишься технике, набираешь силу и осваиваешь элементы шаг за
              шагом. Каждая тренировка подстраивается под твой уровень, цели и
              расписание.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 pt-2">
              <TestSignupButton
                onClick={() => openTestModal("Главный блок: Пройти тест силы")}
              />

              <a
                href="#courses"
                className="inline-flex items-center justify-center rounded-full border border-white/20 px-6 py-3 text-sm sm:text-base font-semibold hover:bg-white/5 transition-colors"
              >
                Посмотреть курсы
              </a>
            </div>

            <div className="flex flex-wrap gap-4 pt-4 text-[13px] sm:text-sm text-brand-muted">
              <div className="flex items-center gap-2">
                <span className="h-6 w-6 rounded-full bg-white/5 flex items-center justify-center text-[11px]">
                  ✔
                </span>
                <span>персональный план под твои цели</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-6 w-6 rounded-full bg-white/5 flex items-center justify-center text-[11px]">
                  24/7
                </span>
                <span>чат поддержки</span>
              </div>
            </div>
          </div>

          {/* Right side */}
          <div className="relative">
            <div className="relative rounded-4xl bg-gradient-to-br from-brand-blue to-[#111827] p-1 shadow-soft">
              <div className="rounded-4xl bg-brand-dark/90 border border-white/10 p-4 sm:p-5 lg:p-6">
                <div className="relative overflow-hidden rounded-3xl bg-black/60 h-56 sm:h-64 lg:h-72 mb-4 sm:mb-5">
                  <video
                    className="absolute inset-0 h-full w-full object-cover"
                    src="/hero-preview2.mp4"
                    playsInline
                    muted
                    autoPlay
                    loop
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs sm:text-sm">
                  <div className="rounded-2xl bg-white/5 border border-white/10 px-3 py-3">
                    <div className="text-brand-muted mb-1">
                      Тренировок в неделю
                    </div>
                    <div className="text-lg sm:text-xl font-semibold">2–3</div>
                    <div className="mt-1 text-[11px] text-brand-muted">
                      оптимально для прогресса и восстановления
                    </div>
                  </div>

                  <div className="rounded-2xl bg-white/5 border border-white/10 px-3 py-3">
                    <div className="text-brand-muted mb-1">
                      Заметный прогресс через
                    </div>
                    <div className="text-lg sm:text-xl font-semibold">
                      3–4 недели
                    </div>
                    <div className="mt-1 text-[11px] text-brand-muted">
                      рост силы и техники
                    </div>
                  </div>

                  <div className="rounded-2xl bg-brand-accent/10 border border-brand-accent/40 px-3 py-3 col-span-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-brand-muted mb-1">
                          Твой следующий шаг
                        </div>
                        <div className="text-sm font-semibold">
                          Подбери программу под себя
                        </div>
                      </div>
                      <button
                        className="shrink-0 rounded-full bg-brand-accent text-brand-dark px-4 py-2 text-xs font-semibold hover:bg-brand-accent/90 transition-colors"
                        onClick={() =>
                          openTestModal(
                            "Главный блок: Подбери программу под себя"
                          )
                        }
                      >
                        Начать
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="pointer-events-none absolute -top-8 -right-10 h-32 w-32 rounded-full bg-brand-blue/40 blur-3xl" />
          </div>
        </section>

        {/* Остальные секции */}
        <HowItWorks />
      </div>

      <Courses onOpenTestModal={openTestModal} />

      <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8 pb-16 sm:pb-20 lg:pb-24">
        <Pricing
          onOpenTestModal={openTestModal}
          onOpenPurchaseModal={openPurchaseModal}
        />
        <Locations onOpenPurchaseModal={openPurchaseModal} />
        <About />
        <Testimonials />
        <FAQ />
      </div>

      <Footer />

      {/* МОДАЛКА ТЕСТА СИЛЫ */}
      {isTestModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 p-4 sm:p-0 flex items-center justify-center"
          onClick={closeTestModal}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-brand-dark border border-white/10 p-5 sm:p-6 shadow-xl
                       max-h-[calc(100dvh-2rem)] overflow-y-auto
                       pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="text-lg sm:text-xl font-semibold">
                Записаться на тест силы
              </h2>

              <button
                type="button"
                onClick={closeTestModal}
                className="rounded-full bg-white/5 p-1 text-brand-muted hover:bg-white/10 hover:text-white transition-colors"
                aria-label="Закрыть форму"
              >
                <span className="block h-4 w-4 leading-none">✕</span>
              </button>
            </div>

            <form className="space-y-4" onSubmit={handleTestSubmit}>
              <div className="space-y-1">
                <label className="text-xs sm:text-sm text-brand-muted">
                  Имя и фамилия
                </label>
                <input
                  type="text"
                  value={testFullName}
                  onChange={(e) => setTestFullName(e.target.value)}
                  required
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary"
                  placeholder="Например: Анна Иванова"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs sm:text-sm text-brand-muted">
                  Email
                </label>
                <input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  required
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary"
                  placeholder="you@example.com"
                />
              </div>

              <input type="hidden" name="context" value={testContext ?? ""} />

              <label className="flex items-start gap-2 text-[11px] sm:text-xs text-brand-muted">
                <input
                  type="checkbox"
                  checked={testAgreed}
                  onChange={(e) => setTestAgreed(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-white/20 bg-transparent text-brand-primary focus:ring-0"
                  required
                />
                <span>
                  Я согласен(на) с{" "}
                  <a
                    href="/privacy"
                    target="_blank"
                    className="underline decoration-dotted hover:text-white"
                  >
                    политикой обработки персональных данных
                  </a>
                  .
                </span>
              </label>

              <button
                type="submit"
                disabled={isTestSubmitting || !testAgreed}
                className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-brand-primary px-4 py-2.5 text-sm font-semibold disabled:opacity-60 disabled:pointer-events-none hover:bg-brand-primary/90 transition-colors"
              >
                {isTestSubmitting ? "Отправляем..." : "Отправить заявку"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* МОДАЛКА ПОКУПКИ ТАРИФА */}
      {isPurchaseModalOpen && purchaseOptions && (
        <div
          className="fixed inset-0 z-50 bg-black/60 p-4 sm:p-0 flex items-center justify-center"
          onClick={closePurchaseModal}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-brand-dark border border-white/10 p-5 sm:p-6 shadow-xl
                       max-h-[calc(100dvh-2rem)] overflow-y-auto
                       pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg sm:text-xl font-semibold">
                  Оплата блока тренировок
                </h2>
                <p className="mt-1 text-[11px] sm:text-xs text-brand-muted">
                  Тариф: {purchaseOptions.tariffLabel} ·{" "}
                  {purchaseOptions.amount.toLocaleString("ru-RU")}{" "}
                  {purchaseOptions.currency === "RUB" ? "₽" : "€"}
                </p>
              </div>

              <button
                type="button"
                onClick={closePurchaseModal}
                className="rounded-full bg-white/5 p-1 text-brand-muted hover:bg-white/10 hover:text-white transition-colors"
                aria-label="Закрыть покупку"
              >
                <span className="block h-4 w-4 leading-none">✕</span>
              </button>
            </div>

            <form className="space-y-4" onSubmit={handlePurchaseSubmit}>
              <div className="space-y-1">
                <label className="text-xs sm:text-sm text-brand-muted">
                  Имя и фамилия
                </label>
                <input
                  type="text"
                  value={buyFullName}
                  onChange={(e) => setBuyFullName(e.target.value)}
                  required
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary"
                  placeholder="Например: Анна Иванова"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs sm:text-sm text-brand-muted">
                  Email
                </label>
                <input
                  type="email"
                  value={buyEmail}
                  onChange={(e) => setBuyEmail(e.target.value)}
                  required
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary"
                  placeholder="you@example.com"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs sm:text-sm text-brand-muted">
                  Телефон
                </label>
                <input
                  type="tel"
                  value={buyPhone}
                  onChange={(e) => setBuyPhone(e.target.value)}
                  required
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary"
                  placeholder="+7 900 000-00-00"
                />
              </div>

              {!purchaseOptions.studioName && (
                <div className="space-y-1">
                  <label className="text-xs sm:text-sm text-brand-muted">
                    Курс
                  </label>

                  <div className="relative">
                    <select
                      value={buyCourse}
                      onChange={(e) => setBuyCourse(e.target.value)}
                      required
                      className="w-full rounded-2xl border border-brand-primary/60 bg-brand-dark px-3 py-2 pr-8 text-sm text-white outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary appearance-none"
                    >
                      <option value="" disabled>
                        Выбери курс
                      </option>

                      {courseNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>

                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-brand-muted">
                      ▾
                    </span>
                  </div>
                </div>
              )}

              <label className="flex items-start gap-2 text-[11px] sm:text-xs text-brand-muted">
                <input
                  type="checkbox"
                  checked={buyAgreed}
                  onChange={(e) => setBuyAgreed(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-white/20 bg-transparent text-brand-primary focus:ring-0"
                  required
                />
                <span>
                  Я согласен(на) с{" "}
                  <a
                    href="/privacy"
                    target="_blank"
                    className="underline decoration-dotted hover:text-white"
                  >
                    политикой обработки персональных данных
                  </a>{" "}
                  и условиями оплаты.
                </span>
              </label>

              <button
                type="submit"
                disabled={isBuySubmitting || !buyAgreed}
                className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-brand-primary px-4 py-2.5 text-sm font-semibold disabled:opacity-60 disabled:pointer-events-none hover:bg-brand-primary/90 transition-colors"
              >
                {isBuySubmitting ? "Переходим к оплате..." : "Перейти к оплате"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* МОДАЛКА ЛОГИНА */}
      {isLoginModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 p-4 sm:p-0 flex items-center justify-center"
          onClick={closeLoginModal}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-brand-dark border border-white/10 p-5 sm:p-6 shadow-xl
                       max-h-[calc(100dvh-2rem)] overflow-y-auto
                       pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg sm:text-xl font-semibold">
                  Войти в личный кабинет
                </h2>
                <p className="mt-1 text-[11px] sm:text-xs text-brand-muted">
                  Личный кабинет приложения сейчас в разработке. Форма входа —
                  демонстрационная.
                </p>
              </div>

              <button
                type="button"
                onClick={closeLoginModal}
                className="rounded-full bg-white/5 p-1 text-brand-muted hover:bg-white/10 hover:text-white transition-colors"
                aria-label="Закрыть форму входа"
              >
                <span className="block h-4 w-4 leading-none">✕</span>
              </button>
            </div>

            <form className="space-y-4" onSubmit={handleLoginSubmit}>
              <div className="space-y-1">
                <label className="text-xs sm:text-sm text-brand-muted">
                  Email
                </label>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  required
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary"
                  placeholder="you@example.com"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs sm:text-sm text-brand-muted">
                  Пароль
                </label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary"
                  placeholder="Пароль"
                />
              </div>

              {loginMessage && (
                <p className="text-[11px] sm:text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-2xl px-3 py-2">
                  {loginMessage}
                </p>
              )}

              <button
                type="submit"
                disabled={isLoginSubmitting}
                className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-white/90 px-4 py-2.5 text-sm font-semibold text-brand-dark disabled:opacity-60 disabled:pointer-events-none hover:bg-white transition-colors"
              >
                {isLoginSubmitting ? "Проверяем…" : "Войти"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Десктоп-чат (на мобилке скрыт) */}
      <div className="hidden md:block">
        <ChatWidget />
      </div>
    </main>
  );
}
