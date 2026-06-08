"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Footer } from "@/components/Footer";

const PRICE_RUB = 9600;
const STUDENT_STORIES = [
  {
    name: "Анна",
    text:
      "@i_do_calisthenics просто замечательная платформа и команда профессионалов! 🔥👏 Я уже занимаюсь с ними около 9 месяцев и все еще в полном восторге! Очень интересно пробовать разные упражнения, виден прогресс, несмотря на то, что в калистенике он всегда медленный. До занятий я не могла ни подтягиваться нормально, ни отжиматься больше пяти раз, сейчас есть строгие подтягивания, отличные отжимания и другие классные упражнения получаются. Даша дает подробную обратную связь и очень внимательно относится к моему состоянию. В общем, супер, очень рекомендую! 💪",
    videoUrl: "https://storage.yandexcloud.net/idc-website-app/pullups/Anna.MOV",
  },
  {
    name: "Елена",
    text:
      "Я всегда занималась спортом, но в последнее время у меня было ограничение по времени, да и стало скучно делать стандартные упражнения/программы. Вот уже год я занимаюсь с вами калистеникой и это превзошло все мои фантазии! Моя сила значительно увеличилась, при это я стала более гибкой, крепкой и выносливой. Моя форма уселась в красивую фигуру, хоть я и не очень сильно похудела (потому что я отказываюсь сидеть на строгой диете). Тренер Даша часто дополнительно отправляет видео, чтобы объяснить непонятные аспекты. Мы ставим общие цели и работаем для этого. И, конечно, что для очень важно - я могу тренироваться тогда когда удобно МНЕ. Обожаю вас! Долгих лет успеха вам! ❤️",
    // Временная ссылка по подтверждению пользователя.
    videoUrl: "https://storage.yandexcloud.net/idc-website-app/pullups/Elena.MP4",
  },
  {
    name: "Зульфина",
    text:
      "Калистеника стала приятным открытием в моей жизни, и позволила стать сильнее по настоящему) Как бонус, нарастила мышцы и сожгла жирок, стало красиво) тренерка Даша самая лучшая, всегда внимательно следит за прогрессом, ведет, и дает интересные упражнения. В зал наконец то стало не скучно ходить! Когда только пришла, была одна цель научиться подтягиваться, а сейчас спустя меньше полугода не то, что подтягиваюсь, а умею делать еще кучу других разных крутых штук 😎",
    videoUrl: "https://storage.yandexcloud.net/idc-website-app/pullups/Zulfia.MP4",
  },
] as const;

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
  return digits[0] === "7" || digits[0] === "8";
}

function isValidIntlPhone(v: string) {
  const compact = v.replace(/[\s()-]/g, "");
  if (/^\+7/.test(compact)) return isValidRuPhone(v);
  return /^\+\d{8,15}$/.test(compact);
}

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export default function PullupsLandingClient() {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);

  const [fullNameError, setFullNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [agreeError, setAgreeError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;

    let hasError = false;
    if (!fullName.trim()) {
      setFullNameError("Введите имя и фамилию");
      hasError = true;
    } else {
      setFullNameError(null);
    }

    if (!isValidIntlPhone(phone)) {
      setPhoneError("Проверьте номер телефона: формат +7 (XXX) XXX-XX-XX");
      hasError = true;
    } else {
      setPhoneError(null);
    }

    if (!isValidEmail(email)) {
      setEmailError("Проверьте email: формат name@example.com");
      hasError = true;
    } else {
      setEmailError(null);
    }

    if (!agreed) {
      setAgreeError("Подтвердите согласие с офертой и политикой");
      hasError = true;
    } else {
      setAgreeError(null);
    }

    if (hasError) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch("/api/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: PRICE_RUB,
          currency: "RUB",
          fullName: fullName.trim(),
          phone,
          email: email.trim().toLowerCase(),
          courseName: "Подтягивания для девушек",
          tariffId: "month",
          tariffLabel: "12 тренировок (интенсивный блок)",
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.paymentUrl) {
        setSubmitError(data?.error || "Не удалось создать оплату. Попробуйте еще раз.");
        return;
      }

      window.location.href = data.paymentUrl;
    } catch {
      setSubmitError("Ошибка сети. Проверьте интернет и попробуйте снова.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#F7F8FC] text-brand-dark">
      <section className="mx-auto max-w-container px-4 sm:px-6 lg:px-8 py-14 sm:py-16 lg:py-20">
        <div className="rounded-4xl border border-black/10 bg-white p-6 sm:p-8 lg:p-10 shadow-soft">
          <div className="max-w-4xl">
            <p className="inline-flex rounded-full border border-brand-primary/20 bg-brand-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-brand-primary mb-4">
              Онлайн-программа для девушек
            </p>
            <h1 className="text-[30px] sm:text-4xl lg:text-5xl font-semibold tracking-tight leading-tight mb-5">
              Научись подтягиваться - даже если сейчас не получается ни разу
            </h1>
            <p className="text-[16px] sm:text-lg text-brand-muted leading-relaxed max-w-2xl mb-7">
            Онлайн-программа тренировок для девушек с индивидуальной программой, акцентом на технику и поддержкой тренера.
            </p>

            <ul className="grid gap-3 sm:grid-cols-2 max-w-3xl text-[15px] text-brand-dark/90 mb-7">
              <li className="rounded-2xl border border-black/10 bg-[#FAFBFF] px-4 py-3">Индивидуальная программа тренировок</li>
              <li className="rounded-2xl border border-black/10 bg-[#FAFBFF] px-4 py-3">Видео с техникой упражнений</li>
              <li className="rounded-2xl border border-black/10 bg-[#FAFBFF] px-4 py-3">Обратная связь от тренера</li>
              <li className="rounded-2xl border border-black/10 bg-[#FAFBFF] px-4 py-3">Поддержка тренера и ответы на вопросы</li>
            </ul>

            <div className="flex flex-wrap items-center gap-3">
              <a
                href="#pricing"
                className="inline-flex items-center justify-center rounded-full bg-brand-primary px-6 py-3 text-sm sm:text-base font-semibold text-white shadow-soft hover:bg-brand-primary/90 transition-colors"
              >
                Начать тренировки
              </a>
              <a
                href="#faq"
                className="inline-flex items-center justify-center rounded-full border border-black/15 px-6 py-3 text-sm sm:text-base font-semibold hover:bg-black/[0.03] transition-colors"
              >
                Посмотреть FAQ
              </a>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3 max-w-2xl">
              {["12 тренировок", "2-3 занятия в неделю", "30-60 минут"].map((item) => (
                <div key={item} className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-medium">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-black/5">
        <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8 py-14 sm:py-16">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-4">Это нормально, если пока не получается</h2>
          <div className="rounded-3xl border border-black/10 bg-white p-5 sm:p-6">
            <p className="text-[15px] sm:text-base text-brand-muted leading-relaxed max-w-3xl mb-4">
              Большинство девушек не могут подтянуться не потому, что слабые. А потому, что тренируют не те мышцы.
            </p>
            <p className="text-[15px] sm:text-base text-brand-muted leading-relaxed max-w-3xl mb-4">
              Подтягивание - это движение, в котором работают широчайшие мышцы спины, плечи, бицепс, корпус и предплечья.
            </p>
            <p className="text-[15px] sm:text-base text-brand-muted leading-relaxed max-w-3xl">
              Если развивать их постепенно, подтягивание становится вполне достижимой целью.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-black/5">
        <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8 py-14 sm:py-16">
          <div className="flex items-end justify-between gap-4 mb-7">
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Как проходит обучение</h2>
            <a href="#pricing" className="text-sm text-brand-primary font-medium hover:underline">
              Хочу так же
            </a>
          </div>
          <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
            {[
              {
                step: "1",
                title: "Тест силы",
                text: "Ты проходишь короткий тест, чтобы определить текущий уровень. Есть два варианта: с турником и без турника.",
              },
              {
                step: "2",
                title: "Индивидуальная программа",
                text: "После теста тренер собирает план тренировок именно под тебя и твой текущий уровень.",
              },
              {
                step: "3",
                title: "Тренировки",
                text: "Ты занимаешься 2-3 раза в неделю, в удобное время, дома или на площадке.",
              },
              {
                step: "4",
                title: "Поддержка",
                text: "Можно отправлять видео упражнений и получать обратную связь от тренера по технике.",
              },
            ].map((item) => (
              <article key={item.title} className="rounded-3xl border border-black/10 bg-white px-5 py-5 sm:px-6 sm:py-6 shadow-soft">
                <h3 className="text-lg font-semibold mb-2">
                  <span className="mr-1.5 text-emerald-700">{item.step}.</span>
                  {item.title}
                </h3>
                <p className="text-[15px] text-brand-muted leading-relaxed">{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-black/5">
        <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8 py-14 sm:py-16">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-6">Что входит в программу</h2>
          <div className="grid gap-3 sm:grid-cols-2 max-w-4xl">
            {[
              "Программа тренировок под твой уровень",
              "Видео с техникой упражнений",
              "Постепенное увеличение сложности",
              "Возможность отправлять видео и получать обратную связь",
              "Поддержка тренера",
              "Поддержка тренера и ответы на вопросы",
            ].map((text) => (
              <div key={text} className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-[15px]">
                {text}
              </div>
            ))}
          </div>
          <a
            href="#pricing"
            className="mt-7 inline-flex items-center justify-center rounded-full bg-brand-primary px-6 py-3 text-sm sm:text-base font-semibold text-white shadow-soft hover:bg-brand-primary/90 transition-colors"
          >
            Забронировать старт
          </a>
        </div>
      </section>

      <section className="border-t border-black/5">
        <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8 py-14 sm:py-16">
          <div className="rounded-4xl border border-brand-primary/20 bg-gradient-to-br from-brand-primary/10 via-white to-white p-6 sm:p-8">
            <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
              <div>
                <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-4">Ты будешь тренироваться не одна</h2>
                <p className="text-[15px] sm:text-base text-brand-muted leading-relaxed mb-4">
                  В поток собирается небольшая группа девушек, которые вместе начинают путь к первому подтягиванию.
                </p>
                <p className="text-[15px] sm:text-base text-brand-muted leading-relaxed mb-4">
                  У каждой своя программа тренировок, а прогресс и вопросы разбираются напрямую с тренером.
                </p>
                <p className="text-[15px] sm:text-base text-brand-muted leading-relaxed">
                  Это помогает не бросить и спокойно идти к цели в своем темпе.
                </p>
              </div>

              <div className="rounded-3xl border border-black/10 bg-white p-5 sm:p-6">
                <h3 className="text-xl sm:text-2xl font-semibold tracking-tight mb-3">Тренировки легко встроить в жизнь</h3>
                <p className="text-[15px] sm:text-base text-brand-muted leading-relaxed mb-4">
                  Ты можешь регулировать длительность: около 30 минут для легкой тренировки или около 60 минут для более интенсивной.
                </p>
                <p className="text-[15px] sm:text-base text-brand-muted leading-relaxed mb-6">
                  Рекомендуемая частота - 2-3 тренировки в неделю.
                </p>
                <a
                  href="#pricing"
                  className="inline-flex items-center justify-center rounded-full bg-brand-primary px-6 py-3 text-sm sm:text-base font-semibold text-white shadow-soft hover:bg-brand-primary/90 transition-colors"
                >
                  Начать тренировки
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-black/5" aria-label="Отзывы и видео участниц">
        <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8 py-14 sm:py-16">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-4">Отзывы нащих учениц</h2>
          <p className="text-[15px] sm:text-base text-brand-muted leading-relaxed mb-6">Истории участниц, которые уже прошли путь к уверенным подтягиваниям.</p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
            {STUDENT_STORIES.map((story) => (
              <article key={story.name} className="rounded-3xl border border-black/10 bg-white px-5 py-5">
                <h3 className="text-base font-semibold mb-2">{story.name}</h3>
                <p className="text-sm text-brand-muted leading-relaxed">{story.text}</p>
              </article>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STUDENT_STORIES.map((story) => (
              <div key={`${story.name}-video`} className="rounded-3xl border border-black/10 bg-white p-3">
                <div className="aspect-[9/16] w-full overflow-hidden rounded-2xl border border-black/10 bg-[#F2F4FA]">
                  <video
                    className="h-full w-full object-cover"
                    src={`${story.videoUrl}#t=0.1`}
                    controls
                    muted
                    playsInline
                    preload="auto"
                  >
                    Ваш браузер не поддерживает видео.
                  </video>
                </div>
              
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="border-t border-black/5 scroll-mt-20">
        <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8 py-14 sm:py-16">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-2">Начать тренировки</h2>
          <p className="text-[15px] sm:text-base text-brand-muted mb-7">12 тренировок с индивидуальной программой, техникой и поддержкой тренера.</p>

          <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            <article className="rounded-3xl border border-brand-primary/25 bg-gradient-to-b from-brand-primary/10 to-white p-5 sm:p-6">
              <p className="text-xs uppercase tracking-[0.16em] text-brand-muted mb-2">Тариф</p>
              <h3 className="text-[30px] leading-none sm:text-4xl font-semibold mb-2">9 600 ₽</h3>
              <div className="mb-4 flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full bg-brand-primary/15 px-3 py-1 text-xs font-semibold text-brand-primary">
                  12 тренировок
                </span>
                <span className="inline-flex items-center rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-medium text-brand-dark/80">
                  800 ₽ за тренировку
                </span>
              </div>
              <div className="rounded-2xl border border-black/10 bg-white/80 px-4 py-4">
                <p className="text-sm font-semibold text-brand-dark mb-3">Что входит:</p>
                <ul className="space-y-2.5 text-[15px] text-brand-dark/90">
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                      ✓
                    </span>
                    <span>Персональный план под твой уровень</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                      ✓
                    </span>
                    <span>Пошаговая техника на видео</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                      ✓
                    </span>
                    <span>Разбор твоих видео и обратная связь тренера</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                      ✓
                    </span>
                    <span>12 тренировок с персональной программой</span>
                  </li>
                </ul>
              </div>
              <div className="mt-3 rounded-2xl border border-emerald-300/70 bg-emerald-50 px-4 py-4">
                <p className="text-sm font-semibold text-emerald-700 mb-3">Бонус программы:</p>
                <ul className="space-y-2.5 text-[15px] text-brand-dark/90">
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
                      +
                    </span>
                    <span>Увеличенный срок действия абонемента: 6 недель вместо 4</span>
                  </li>
                </ul>
              </div>
            </article>

            <form onSubmit={handleSubmit} className="rounded-3xl border border-black/10 bg-white p-5 sm:p-6 shadow-soft">
              <p className="text-sm text-brand-muted mb-4">Заполни 3 поля и перейди к безопасной оплате</p>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm text-brand-muted">Фамилия и имя</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => {
                      setFullName(e.target.value);
                      setFullNameError(null);
                    }}
                    className={`w-full rounded-2xl border bg-white px-3 py-2 text-sm outline-none focus:border-brand-primary ${
                      fullNameError ? "border-red-400 ring-1 ring-red-400" : "border-black/10"
                    }`}
                    placeholder="Иванова Анна"
                    required
                  />
                  {fullNameError && <p className="mt-1 text-xs text-red-500">{fullNameError}</p>}
                </div>

                <div>
                  <label className="mb-1 block text-sm text-brand-muted">Телефон</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => {
                      setPhone(formatPhoneInput(e.target.value));
                      setPhoneError(null);
                    }}
                    onFocus={() => {
                      if (!phone) setPhone("+7 ");
                    }}
                    onBlur={(e) => {
                      const v = (e.currentTarget.value || "").trim();
                      if (!v) return;
                      if (v === "+7" || v === "+7)") {
                        setPhone("");
                        return;
                      }
                      const next = /^\+?7/.test(v) || /^8/.test(v)
                        ? formatPhoneInput(v)
                        : (v.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "").startsWith("+")
                            ? v.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "")
                            : "+" + v.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, ""));
                      setPhone(next);
                      if (phoneError && isValidIntlPhone(next)) setPhoneError(null);
                    }}
                    className={`w-full rounded-2xl border bg-white px-3 py-2 text-sm outline-none focus:border-brand-primary ${
                      phoneError ? "border-red-400 ring-1 ring-red-400" : "border-black/10"
                    }`}
                    placeholder="+7 (___) ___-__-__"
                    required
                  />
                  {phoneError && <p className="mt-1 text-xs text-red-500">{phoneError}</p>}
                </div>

                <div>
                  <label className="mb-1 block text-sm text-brand-muted">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setEmailError(null);
                    }}
                    className={`w-full rounded-2xl border bg-white px-3 py-2 text-sm outline-none focus:border-brand-primary ${
                      emailError ? "border-red-400 ring-1 ring-red-400" : "border-black/10"
                    }`}
                    placeholder="name@example.com"
                    required
                  />
                  {emailError && <p className="mt-1 text-xs text-red-500">{emailError}</p>}
                </div>

                <label className="flex items-start gap-2 text-xs text-brand-muted">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => {
                      setAgreed(e.target.checked);
                      setAgreeError(null);
                    }}
                    className="mt-[2px] h-4 w-4 rounded border-black/20"
                  />
                  <span>
                    Я принимаю условия{" "}
                    <Link href="/offer" className="text-brand-primary hover:underline">
                      публичной оферты
                    </Link>{" "}
                    и{" "}
                    <Link href="/privacy" className="text-brand-primary hover:underline">
                      политики конфиденциальности
                    </Link>
                    .
                  </span>
                </label>
                {agreeError && <p className="-mt-2 text-xs text-red-500">{agreeError}</p>}

                {submitError && (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                    {submitError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex w-full items-center justify-center rounded-full bg-brand-primary px-6 py-3 text-sm sm:text-base font-semibold text-white shadow-soft hover:bg-brand-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? "Создаем оплату..." : "Начать тренировки"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>

      <section id="faq" className="border-t border-black/5">
        <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8 py-14 sm:py-16 max-w-3xl">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-6">FAQ</h2>
          <div className="space-y-3">
            {[
              {
                q: "Можно ли начать без турника?",
                a: "Да. В программе есть упражнения без турника, чтобы безопасно развивать базовую силу.",
              },
              {
                q: "Что если я вообще не могу подтянуться?",
                a: "Программа как раз рассчитана на новичков и тех, кто пока делает 1-2 повторения.",
              },
              {
                q: "Сколько времени занимают тренировки?",
                a: "Обычно 30-60 минут, в зависимости от выбранного объема тренировки.",
              },
              {
                q: "Нужно ли оборудование?",
                a: "Достаточно турника или простой альтернативы. Минимальный набор подскажем после теста.",
              },
            ].map((item) => (
              <article key={item.q} className="rounded-2xl border border-black/10 bg-white px-4 py-4 sm:px-5 sm:py-5">
                <h3 className="text-base font-semibold mb-2">{item.q}</h3>
                <p className="text-sm text-brand-muted leading-relaxed">{item.a}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-black/5">
        <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8 py-14 sm:py-16">
          <div className="rounded-4xl border border-brand-primary/20 bg-gradient-to-br from-brand-primary/10 via-white to-white px-6 py-8 sm:px-8 sm:py-10 text-center">
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-4">Начни путь к первому подтягиванию</h2>
            <p className="text-[15px] sm:text-base text-brand-muted leading-relaxed mb-7 max-w-2xl mx-auto">
              12 тренировок, персональный план и поддержка, чтобы уверенно двигаться к результату.
            </p>
            <a
              href="#pricing"
              className="inline-flex items-center justify-center rounded-full bg-brand-primary px-6 py-3 text-sm sm:text-base font-semibold text-white shadow-soft hover:bg-brand-primary/90 transition-colors"
            >
              Начать тренировки
            </a>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
