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
import { About } from "@/components/About";
import { FAQ } from "@/components/FAQ";
import { Testimonials } from "@/components/Testimonials";
import { courseNames } from "@/data/courses";
import { Footer } from "@/components/Footer";
import { trackGoal, detectDeviceType } from "@/lib/metrika";

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
  const productsViewSentRef = useRef<Record<string, boolean>>({});
  function trackProductsView(productType: "online" | "gym", source: "menu" | "CTA" | "scroll") {
    const key = `${productType}:${source}`;
    if (productsViewSentRef.current[key]) return;
    productsViewSentRef.current[key] = true;
    trackGoal("products_view", {
      product_type: productType,
      source,
      device: detectDeviceType(),
    });
  }

  /* ---------- Модалка теста силы ---------- */
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [testContext, setTestContext] = useState<string | undefined>();

  const [testFullName, setTestFullName] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [testAgreed, setTestAgreed] = useState(false);
  const [testFullNameError, setTestFullNameError] = useState<string | null>(null);
  const [testEmailError, setTestEmailError] = useState<string | null>(null);
  const [testAgreedError, setTestAgreedError] = useState<string | null>(null);
  const [isTestSubmitting, setIsTestSubmitting] = useState(false);

  function openTestModal(context?: string) {
    setTestContext(context);
    setIsTestModalOpen(true);
  }

  function closeTestModal() {
    if (isTestSubmitting) return;
    setIsTestModalOpen(false);
  }

  function isValidEmail(v: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  }

  async function handleTestSubmit(e: FormEvent) {
    e.preventDefault();
    if (isTestSubmitting) return;

    let hasError = false;
    if (!testFullName.trim()) {
      setTestFullNameError("Введите имя и фамилию");
      hasError = true;
    } else {
      setTestFullNameError(null);
    }
    if (!isValidEmail(testEmail)) {
      setTestEmailError("Проверьте email: формат name@example.com");
      hasError = true;
    } else {
      setTestEmailError(null);
    }
    if (!testAgreed) {
      setTestAgreedError("Подтвердите согласие с политикой");
      hasError = true;
    } else {
      setTestAgreedError(null);
    }
    if (hasError) return;

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
        setTestFullNameError(null);
        setTestEmailError(null);
        setTestAgreedError(null);
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

  /* ---------- Курсы: модалка-информация (Шаг 1) ---------- */
  const [isCourseInfoOpen, setIsCourseInfoOpen] = useState(false);
  const [selectedCourseName, setSelectedCourseName] = useState<string | null>(
    null
  );
  const [cameFromCourseInfo, setCameFromCourseInfo] = useState(false);

  function openCourseInfo(name: string) {
    setSelectedCourseName(name);
    setIsCourseInfoOpen(true);
  }

  function closeCourseInfo() {
    setIsCourseInfoOpen(false);
  }

  const [buyFullName, setBuyFullName] = useState("");
  const [buyEmail, setBuyEmail] = useState("");
  const [buyPhone, setBuyPhone] = useState("");
  const [buyPhoneError, setBuyPhoneError] = useState<string | null>(null);
  const [buyFullNameError, setBuyFullNameError] = useState<string | null>(null);
  const [buyEmailError, setBuyEmailError] = useState<string | null>(null);
  const [buyAgreedError, setBuyAgreedError] = useState<string | null>(null);
  const [buyCourse, setBuyCourse] = useState<string>("");
  const [buyCourseError, setBuyCourseError] = useState<string | null>(null);
  const [buyAgreed, setBuyAgreed] = useState(false);
  const [isBuySubmitting, setIsBuySubmitting] = useState(false);
  const [isPricesPopoverOpen, setIsPricesPopoverOpen] = useState(false);
  const [isMobilePricesOpen, setIsMobilePricesOpen] = useState(false);
  const pricesBtnRef = useRef<HTMLButtonElement | null>(null);
  const pricesPopoverRef = useRef<HTMLDivElement | null>(null);

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

  function isValidRuPhone(v: string) {
    const digits = (v.match(/\d/g) || []).join("");
    if (digits.length !== 11) return false;
    const first = digits[0];
    return first === "7" || first === "8";
  }
  function isValidIntlPhone(v: string) {
    const compact = v.replace(/[\s()-]/g, "");
    if (/^\+7/.test(compact)) return isValidRuPhone(v);
    return /^\+\d{8,15}$/.test(compact);
  }

  function openPurchaseModal(options: PurchaseOptions) {
    setPurchaseOptions(options);
    setIsPurchaseModalOpen(true);
  }

  function closePurchaseModal() {
    if (isBuySubmitting) return;
    setIsPurchaseModalOpen(false);
    // сбросить флаг источника (из курсов), чтобы следующие открытия были чистыми
    setCameFromCourseInfo(false);
  }

  async function handlePurchaseSubmit(e: FormEvent) {
    e.preventDefault();
    if (!purchaseOptions || isBuySubmitting) return;

    let hasError = false;
    if (!buyFullName.trim()) {
      setBuyFullNameError("Введите имя и фамилию");
      hasError = true;
    } else {
      setBuyFullNameError(null);
    }
    if (!isValidIntlPhone(buyPhone)) {
      setBuyPhoneError("Проверьте номер телефона: нужно 11 цифр, формат +7 (XXX) XXX-XX-XX");
      hasError = true;
    } else {
      setBuyPhoneError(null);
    }
    if (!isValidEmail(buyEmail)) {
      setBuyEmailError("Проверьте email: формат name@example.com");
      hasError = true;
    } else {
      setBuyEmailError(null);
    }
    const showCourseSelect = !purchaseOptions.studioName && !cameFromCourseInfo;
    if (showCourseSelect && !buyCourse.trim()) {
      setBuyCourseError("Выберите курс");
      hasError = true;
    } else {
      setBuyCourseError(null);
    }
    if (!buyAgreed) {
      setBuyAgreedError("Подтвердите согласие с офертой и политикой");
      hasError = true;
    } else {
      setBuyAgreedError(null);
    }
    if (hasError) return;

    setIsBuySubmitting(true);
    const submitProductType: "online" | "gym" = purchaseOptions.studioName ? "gym" : "online";
    const submitProductName = purchaseOptions.studioName
      ? purchaseOptions.studioName
      : (cameFromCourseInfo && selectedCourseName
          ? selectedCourseName
          : buyCourse || purchaseOptions.tariffLabel);
    trackGoal("signup_submit", {
      product_type: submitProductType,
      product_name: submitProductName,
      source: "scroll",
    });

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
          studioId: purchaseOptions.studioId ?? null,
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
    isTestModalOpen ||
    isPurchaseModalOpen ||
    isLoginModalOpen ||
    isCourseInfoOpen;

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
    
    useEffect(() => {
      const handler = () => setIsPricesPopoverOpen(false);
      // @ts-ignore
      document.addEventListener("close-prices-popover", handler);
      return () => {
        // @ts-ignore
        document.removeEventListener("close-prices-popover", handler);
      };
    }, []);

    // Close desktop popover on outside click
    useEffect(() => {
      if (!isPricesPopoverOpen) return;
      const onDocClick = (e: MouseEvent) => {
        const t = e.target as Node;
        if (pricesBtnRef.current?.contains(t)) return;
        if (pricesPopoverRef.current?.contains(t)) return;
        setIsPricesPopoverOpen(false);
      };
      document.addEventListener("click", onDocClick);
      return () => document.removeEventListener("click", onDocClick);
    }, [isPricesPopoverOpen]);

  return (
    <main className="min-h-screen bg-brand-dark text-white">
      <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8 py-8 sm:py-16 lg:py-20">
        {/* Top bar */}
        <header className="sticky top-0 z-40 mb-8 sm:mb-12 backdrop-blur-md">
          <div className="flex items-center justify-between gap-4 py-3 md:grid md:grid-cols-[1fr_auto_1fr] md:items-center">
            <div className="flex items-center gap-2 md:col-start-1 md:justify-self-start">
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
            <nav className="hidden md:flex items-center gap-4 lg:gap-6 text-sm text-brand-muted md:col-start-2 md:justify-self-center whitespace-nowrap relative">
              <a href="#how" className="hover:text-white transition-colors">
                Как это работает
              </a>
              <a
                href="#courses"
                className="hover:text-white transition-colors"
                onClick={() => trackProductsView("online", "menu")}
              >
                Курсы
              </a>
              <div className="relative">
                <button
                  type="button"
                  ref={pricesBtnRef}
                  onClick={() => setIsPricesPopoverOpen((v) => !v)}
                  className="hover:text-white transition-colors"
                  aria-haspopup="menu"
                  aria-expanded={isPricesPopoverOpen}
                >
                  Цены
                </button>
                {isPricesPopoverOpen && (
                  <div
                    ref={pricesPopoverRef}
                    className="absolute left-1/2 -translate-x-1/2 mt-2 w-60 rounded-2xl border border-white/10 bg-brand-dark shadow-xl p-2"
                    role="menu"
                  >
                    <a
                      href="#pricing"
                      onClick={() => setIsPricesPopoverOpen(false)}
                      className="block rounded-xl px-3 py-2 text-left hover:bg-white/5"
                      role="menuitem"
                    >
                      на онлайн‑тренировки
                    </a>
                    <a
                      href="#locations"
                      onClick={() => setIsPricesPopoverOpen(false)}
                      className="mt-1 block rounded-xl px-3 py-2 text-left hover:bg-white/5"
                      role="menuitem"
                    >
                      на тренировки в залах
                    </a>
                  </div>
                )}
              </div>
              <a
                href="#locations"
                className="hover:text-white transition-colors"
                onClick={() => trackProductsView("gym", "menu")}
              >
                Залы
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
        {/* auto-close popover on scroll */}
        {isPricesPopoverOpen && (
          <script dangerouslySetInnerHTML={{__html: `
            (function(){
              var onScroll = function(){ try { document.dispatchEvent(new CustomEvent('close-prices-popover')); } catch(e){} };
              window.addEventListener('scroll', onScroll, { once: true });
              setTimeout(function(){ window.removeEventListener('scroll', onScroll); }, 3000);
            })();
          `}} />
        )}

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
                  onClick={() => {
                    trackProductsView("online", "menu");
                    setIsMobileNavOpen(false);
                  }}
                >
                  Курсы
                </a>
                <button
                  type="button"
                  className="rounded-2xl px-3 py-2 text-left hover:bg-white/5"
                  onClick={() => setIsMobilePricesOpen((v) => !v)}
                  aria-expanded={isMobilePricesOpen}
                >
                  Цены
                </button>
                {isMobilePricesOpen && (
                  <div className="ml-2 flex flex-col gap-1 mb-2">
                    <a
                      href="#pricing"
                      className="rounded-2xl px-3 py-2 hover:bg-white/5"
                      onClick={() => {
                        setIsMobileNavOpen(false);
                        setIsMobilePricesOpen(false);
                      }}
                    >
                      на онлайн‑тренировки
                    </a>
                    <a
                      href="#locations"
                      className="rounded-2xl px-3 py-2 hover:bg-white/5"
                      onClick={() => {
                        setIsMobileNavOpen(false);
                        setIsMobilePricesOpen(false);
                      }}
                    >
                      на тренировки в залах
                    </a>
                  </div>
                )}
                <a
                  href="#locations"
                  className="rounded-2xl px-3 py-2 hover:bg-white/5"
                  onClick={() => {
                    trackProductsView("gym", "menu");
                    setIsMobileNavOpen(false);
                  }}
                >
                  Залы
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
                <a
                  href="#courses"
                  onClick={() => {
                    trackProductsView("online", "CTA");
                    setIsMobileNavOpen(false);
                  }}
                  className="block w-full text-center rounded-full bg-brand-primary px-4 py-3 text-sm font-semibold text-white hover:bg-brand-primary/90 transition-colors"
                >
                  Посмотреть курсы
                </a>
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
              <a
                href="#courses"
                className="inline-flex items-center justify-center rounded-full bg-brand-primary px-6 py-3 text-sm sm:text-base font-semibold text-white shadow-soft hover:bg-brand-primary/90 transition-colors"
                onClick={() => trackProductsView("online", "CTA")}
              >
                Посмотреть курсы
              </a>

              <a
                href="#locations"
                className="inline-flex items-center justify-center rounded-full border border-white/20 px-6 py-3 text-sm sm:text-base font-semibold hover:bg-white/5 transition-colors"
                onClick={() => trackProductsView("gym", "CTA")}
              >
                Записаться в зал
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
                  👤
                </span>
                <span>сопровождение тренера</span>
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
  src="https://storage.yandexcloud.net/idc-website-app/hero-preview2.mp4"
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
                          Узнай, как это работает
                        </div>
                      </div>
                      <a
                        href="#how"
                        className="shrink-0 rounded-full bg-brand-accent text-brand-dark px-4 py-2 text-xs font-semibold hover:bg-brand-accent/90 transition-colors"
                      >
                        Узнать
                      </a>
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

      <Courses onOpenCourseInfo={openCourseInfo} />

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

      {/* МОДАЛКА КУРСА: Шаг 1 из 2 */}
      {isCourseInfoOpen && selectedCourseName && (
        <div
          className="fixed inset-0 z-50 bg-black/60 p-4 sm:p-0 flex items-center justify-center"
          onClick={closeCourseInfo}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-brand-dark border border-white/10 p-5 sm:p-6 shadow-xl
                       max-h-[calc(100dvh-2rem)] overflow-y-auto
                       pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-[11px] sm:text-xs text-brand-muted">Шаг 1 из 2</p>
                <h2 className="text-lg sm:text-xl font-semibold leading-snug">
                  Первый шаг — пройти тест силы
                </h2>
              </div>
              <button
                type="button"
                onClick={closeCourseInfo}
                className="rounded-full bg-white/5 p-1 text-brand-muted hover:bg-white/10 hover:text-white transition-colors"
                aria-label="Закрыть"
              >
                <span className="block h-4 w-4 leading-none">✕</span>
              </button>
            </div>

            <div className="space-y-3 text-[13px] sm:text-sm text-brand-muted">
              <p>Вот что тебя ждёт:</p>
              <ul className="ml-1 space-y-1.5">
                <li>• Определим твой текущий уровень</li>
                <li>• Разберём технику упражнений по видео</li>
                <li>• Дадим рекомендации для дальнейших тренировок</li>
              </ul>
              <div className="mt-2">
                <span className="text-brand-muted">Стоимость: </span>
                <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[12px] font-medium text-white">
                  950 ₽
                </span>
              </div>
            </div>

            <button
              type="button"
              className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-brand-primary px-4 py-2.5 text-sm font-semibold hover:bg-brand-primary/90 transition-colors"
              onClick={() => {
                trackGoal("signup_click", {
                  product_type: "online",
                  product_name: selectedCourseName,
                  source: "scroll",
                });
                // перейти к шагу 2 — оплате
                setCameFromCourseInfo(true);
                setBuyCourse(selectedCourseName);
                closeCourseInfo();
                openPurchaseModal({
                  tariffId: "review",
                  tariffLabel: `Старт курса · ${selectedCourseName}`,
                  amount: 950,
                  currency: "RUB",
                });
              }}
            >
              Записаться
            </button>

            <p className="mt-2 text-[11px] sm:text-xs text-brand-muted/80 text-center">
              После оплаты ты сразу получишь инструкции для старта
            </p>
          </div>
        </div>
      )}

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
                  Фамилия и имя
                </label>
                <input
                  type="text"
                  value={testFullName}
                  onChange={(e) => {
                    setTestFullName(e.target.value);
                    setTestFullNameError(null);
                  }}
                  required
                  className={`w-full rounded-2xl border bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary ${testFullNameError ? "border-red-400 ring-1 ring-red-400" : "border-white/10"}`}
                  placeholder="Например: Иванова Анна"
                />
                {testFullNameError && (
                  <p className="mt-1 text-[12px] text-red-400">{testFullNameError}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs sm:text-sm text-brand-muted">
                  Email
                </label>
                <input
                  type="email"
                  value={testEmail}
                  onChange={(e) => {
                    setTestEmail(e.target.value);
                    setTestEmailError(null);
                  }}
                  required
                  className={`w-full rounded-2xl border bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary ${testEmailError ? "border-red-400 ring-1 ring-red-400" : "border-white/10"}`}
                  placeholder="name@example.com"
                />
                {testEmailError && (
                  <p className="mt-1 text-[12px] text-red-400">{testEmailError}</p>
                )}
              </div>

              <input type="hidden" name="context" value={testContext ?? ""} />

              <label className="flex items-start gap-2 text-[11px] sm:text-xs text-brand-muted">
                <input
                  type="checkbox"
                  checked={testAgreed}
                  onChange={(e) => {
                    setTestAgreed(e.target.checked);
                    setTestAgreedError(null);
                  }}
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
              {testAgreedError && (
                <p className="text-[12px] text-red-400">{testAgreedError}</p>
              )}

              <button
                type="submit"
                disabled={isTestSubmitting}
                className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-brand-primary px-4 py-2.5 text-sm font-semibold disabled:opacity-60 disabled:pointer-events-none hover:bg-brand-primary/90 transition-colors"
              >
                {isTestSubmitting ? "Отправляем..." : "Отправить заявку"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* МОДАЛКА ПОКУПКИ ТАРИФА (Шаг 2, если пришли из курса) */}
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
                {cameFromCourseInfo && (
                  <p className="text-[11px] sm:text-xs text-brand-muted">
                    Шаг 2 из 2
                  </p>
                )}
                <h2 className="text-lg sm:text-xl font-semibold">
                  {cameFromCourseInfo ? "Оплата теста силы" : "Оплата блока тренировок"}
                </h2>
                <p className="mt-1 text-[11px] sm:text-xs text-brand-muted">
                  {cameFromCourseInfo && selectedCourseName
                    ? `Старт курса «${selectedCourseName}»`
                    : purchaseOptions.studioName
                    ? `Тариф: ${purchaseOptions.tariffLabel}`
                    : `Тариф: ${purchaseOptions.tariffLabel} · ${purchaseOptions.amount.toLocaleString("ru-RU")} ${
                        purchaseOptions.currency === "RUB" ? "₽" : "€"
                      }`}
                </p>
                {cameFromCourseInfo && (
                  <button
                    type="button"
                    className="mt-1 text-[12px] underline decoration-dotted text-brand-muted hover:text-white transition-colors"
                    onClick={() => {
                      closePurchaseModal();
                      // вернуться к шагу 1
                      setTimeout(() => {
                        if (selectedCourseName) {
                          setIsCourseInfoOpen(true);
                        }
                      }, 0);
                    }}
                  >
                    Назад
                  </button>
                )}
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
                <label className="text-xs sm:text-sm text-brand-muted">Фамилия и имя</label>
                <input
                  type="text"
                  value={buyFullName}
                  onChange={(e) => {
                    setBuyFullName(e.target.value);
                    setBuyFullNameError(null);
                  }}
                  required
                  className={`w-full rounded-2xl border bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary ${buyFullNameError ? "border-red-400 ring-1 ring-red-400" : "border-white/10"}`}
                  placeholder="Иванова Анна"
                />
                {buyFullNameError && (
                  <p className="mt-1 text-[12px] text-red-400">{buyFullNameError}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs sm:text-sm text-brand-muted">
                  Телефон{" "}
                </label>
                <input
                  type="tel"
                  value={buyPhone}
                  onChange={(e) => {
                    setBuyPhone(formatPhoneInput(e.target.value));
                    setBuyPhoneError(null);
                  }}
                  onFocus={() => {
                    try {
                      if (!buyPhone) {
                        setBuyPhone("+7 ");
                      }
                    } catch {}
                  }}
                  onBlur={(e) => {
                    try {
                      const v = (e.currentTarget.value || "").trim();
                      if (!v) return;

                      let next = v;
                      if (v === "+7" || v === "+7)") {
                        setBuyPhone("");
                        return;
                      }

                      if (/^\+?7/.test(v) || /^8/.test(v)) {
                        next = formatPhoneInput(v);
                      } else {
                        const cleaned = v.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
                        next = cleaned.startsWith("+") ? cleaned : "+" + cleaned;
                      }
                      setBuyPhone(next);
                      if (buyPhoneError && isValidIntlPhone(next)) setBuyPhoneError(null);
                    } catch {}
                  }}
                  required
                  className={`w-full rounded-2xl border bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary ${buyPhoneError ? "border-red-400 ring-1 ring-red-400" : "border-white/10"}`}
                  placeholder="(___) ___-__-__"
                />
                {buyPhoneError && (
                  <p className="mt-1 text-[12px] text-red-400">{buyPhoneError}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs sm:text-sm text-brand-muted">
                  Email
                </label>
                <input
                  type="email"
                  value={buyEmail}
                  onChange={(e) => {
                    setBuyEmail(e.target.value);
                    setBuyEmailError(null);
                  }}
                  required
                  className={`w-full rounded-2xl border bg-white/5 px-3 py-2 text-sm outline-none focus:border-brand-primary ${buyEmailError ? "border-red-400 ring-1 ring-red-400" : "border-white/10"}`}
                  placeholder="name@example.com"
                />
                {buyEmailError && (
                  <p className="mt-1 text-[12px] text-red-400">{buyEmailError}</p>
                )}
              </div>

              {/* Если пришли из курсов, селект курса не нужен */}
              {!purchaseOptions.studioName && !cameFromCourseInfo && (
                <div className="space-y-1">
                  <label className="text-xs sm:text-sm text-brand-muted">
                    Курс
                  </label>

                  <div className="relative">
                    <select
                      value={buyCourse}
                      onChange={(e) => {
                        setBuyCourse(e.target.value);
                        setBuyCourseError(null);
                      }}
                      required
                      className={`w-full rounded-2xl border bg-brand-dark px-3 py-2 pr-8 text-sm text-white outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary appearance-none ${buyCourseError ? "border-red-400 ring-1 ring-red-400" : "border-brand-primary/60"}`}
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
                  {buyCourseError && (
                    <p className="mt-1 text-[12px] text-red-400">{buyCourseError}</p>
                  )}
                </div>
              )}

              <label className="flex items-start gap-2 text-[11px] sm:text-xs text-brand-muted">
                <input
                  type="checkbox"
                  checked={buyAgreed}
                  onChange={(e) => {
                    setBuyAgreed(e.target.checked);
                    setBuyAgreedError(null);
                  }}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-white/20 bg-transparent text-brand-primary focus:ring-0"
                  required
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
              {buyAgreedError && (
                <p className="text-[12px] text-red-400">{buyAgreedError}</p>
              )}

              <button
                type="submit"
                disabled={isBuySubmitting}
                className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-brand-primary px-4 py-2.5 text-sm font-semibold disabled:opacity-60 disabled:pointer-events-none hover:bg-brand-primary/90 transition-colors"
              >
                {isBuySubmitting
                  ? "Переходим к оплате..."
                  : `Оплатить ${purchaseOptions.amount.toLocaleString("ru-RU")} ${
                      purchaseOptions.currency === "RUB" ? "₽" : "€"
                    }`}
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
                  placeholder="name@example.com"
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
      {/* Чат поддержки временно скрыт */}
    </main>
  );
}
