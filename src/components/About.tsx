// src/components/About.tsx
"use client";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";

type FeaturedCoach = {
  id: string;
  name: string;
  role: string;
  city: string;
  photo: string;
  quote: string;
  education: string[];
  about: string[];
};

type Coach = {
  name: string;
  role: string;
  bio: string;
  since: string;
  photo?: string;
};

const featuredCoaches: FeaturedCoach[] = [
  {
    id: "gubanov",
    name: "Евгений Губанов",
    role: "Тренер по калистенике",
    city: "Москва и онлайн",
    photo: "/images/coaches/gubanov.jpg",
    quote:
      "Десятки людей уже перемещаются по городу с красивым телом и отличным самочувствием. Присоединяйся и ты!",
    education: [
      "Российский государственный университет физической культуры, кафедра тяжелоатлетических видов спорта, бакалавр (2018)",
      "Практикую тяжёлую атлетику, стритлифтинг и элементы калистеники — тому же обучаю учеников",
    ],
    about: [
      "Люблю разбирать технику и прогрессию силовых элементов: подтягивания, выходы силой, стойки",
      "Меломан, увлекаюсь диджеингом и активным отдыхом, люблю вкусно поесть",
    ],
  },
  {
    id: "taranishina",
    name: "Дарья Таранишина",
    role: "Тренер по калистенике",
    city: "Санкт-Петербург и онлайн",
    photo: "/images/coaches/taranishina.jpg",
    quote:
      "Я как пазл собираю знания, методы и способы обучения, систематизирую и упрощаю их для лёгкого восприятия.",
    education: [
      "Школа фитнеса «Корус» — инструктор Т3 (2015)",
      "CrossFit LVL 1 (2018), КМС по тяжелой атлетике (2018)",
      "CrossFit Gymnastics (2020), CrossFit LVL 2 (2023)",
      "POWER MONKEY CAMP Online Course (2023)",
    ],
    about: [
      "Люблю тяжёлую атлетику, турники и брусья, тренируюсь и тренирую из любви и интереса к движению",
      "Помогаю ученикам побеждать слабость и страхи, говорю о сложных вещах простым языком",
    ],
  },
];

const team: Coach[] = [
  {
    name: "Имя Фамилия",
    role: "Тренер по калистенике",
    bio: "12 лет в гимнастике и калистенике. Фокус — техника, сила, работа с новичками.",
    since: "В I Do Calisthenics с 2020 года",
    photo: "/images/coaches/coach-1.jpg",
  },
  {
    name: "Имя Фамилия",
    role: "Ведущий тренер",
    bio: "Опыт в CrossFit и функциональном тренинге. Помогает ставить элементы без травм.",
    since: "В команде с 2019 года",
    photo: "/images/coaches/coach-2.jpg",
  },
  {
    name: "Имя Фамилия",
    role: "Методист",
    bio: "Собирает программы, следит за прогрессией нагрузок и логикой курсов.",
    since: "Следит за методикой с 2018 года",
    photo: "/images/coaches/coach-3.jpg",
  },
];

// фотки студий
const studioPhotos = [
  "/images/about/photo12.jpg",
  "/images/about/photo22.jpg",
  "/images/about/photo33.jpg",
  "/images/about/photo41.jpg",
];

export function About() {
  const yearsSinceLaunch = useMemo(() => {
    const startYear = 2018;
    const startMonth = 9; // сентябрь
    const now = new Date();
    let years = now.getFullYear() - startYear;

    const anniversaryPassed =
      now.getMonth() + 1 > startMonth ||
      (now.getMonth() + 1 === startMonth && now.getDate() >= 1);

    if (!anniversaryPassed) years -= 1;
    return Math.max(years, 0);
  }, []);

  const [photoIndex, setPhotoIndex] = useState(0);

  const handlePrev = () => {
    setPhotoIndex((prev) => (prev === 0 ? studioPhotos.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setPhotoIndex((prev) => (prev === studioPhotos.length - 1 ? 0 : prev + 1));
  };

  /* ---------- Swipe (touch) ---------- */
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const swipeLocked = useRef<"x" | "y" | null>(null);

  const SWIPE_MIN_PX = 42; // порог свайпа
  const LOCK_THRESHOLD = 10; // когда понять что это горизонтальный жест

  function onTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    const t = e.touches[0];
    touchStartX.current = t.clientX;
    touchStartY.current = t.clientY;
    swipeLocked.current = null;
  }

  function onTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (touchStartX.current == null || touchStartY.current == null) return;

    const t = e.touches[0];
    const dx = t.clientX - touchStartX.current;
    const dy = t.clientY - touchStartY.current;

    // определяем направление жеста, чтобы не ломать вертикальный скролл страницы
    if (!swipeLocked.current) {
      if (Math.abs(dx) > LOCK_THRESHOLD || Math.abs(dy) > LOCK_THRESHOLD) {
        swipeLocked.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
    }

    // если жест горизонтальный — блокируем прокрутку страницы во время свайпа
    if (swipeLocked.current === "x") {
      e.preventDefault();
    }
  }

  function onTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    if (touchStartX.current == null || touchStartY.current == null) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX.current;
    const dy = t.clientY - touchStartY.current;

    // если это был вертикальный жест — ничего не делаем
    if (swipeLocked.current === "y") {
      touchStartX.current = null;
      touchStartY.current = null;
      swipeLocked.current = null;
      return;
    }

    // горизонтальный свайп
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) handleNext();
      else handlePrev();
    }

    touchStartX.current = null;
    touchStartY.current = null;
    swipeLocked.current = null;
  }

  return (
    <section
      id="about"
      className="py-16 sm:py-20 lg:py-24 scroll-mt-24 md:scroll-mt-28 border-t border-white/5"
    >
      <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8">
        {/* Заголовок */}
        <div className="mb-8 sm:mb-10 max-w-4xl">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand-muted mb-3">
            О проекте
          </p>
          <h2 className="text-[26px] sm:text-3xl lg:text-4xl font-semibold tracking-tight mb-4">
            От студии к цифровой системе
          </h2>
          <p className="text-[15px] sm:text-base text-brand-muted leading-relaxed">
            I Do Calisthenics — школа калистеники, которая выросла из студии в
            Москве в систему тренировок с собственным весом для людей по всему
            миру. Мы совмещаем опыт живых тренировок и удобство приложения.
          </p>
        </div>

        {/* История + фото/факты */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] mb-12 sm:mb-14">
          {/* История и миссия */}
          <div className="space-y-5 text-[15px] sm:text-base text-brand-muted leading-relaxed">
            <p>
              Первую студию мы открыли более{" "}
              <span className="font-semibold text-white">{yearsSinceLaunch}</span>{" "}
              лет назад. За это время обучили тысячи людей: разбирали технику по
              шагам, подбирали прогрессии и находили подход к каждому ученику —
              чтобы движение становилось понятным и доступным.
            </p>
            <p>
              Сейчас этот опыт переехал в цифровой формат. Всё, что мы
              отрабатывали руками и глазами в залах, стало системой: понятные
              шаги от базовых движений к сложным элементам.
            </p>
            <p>
              Онлайн для нас — не компромисс, а продолжение того, что работает.
              Можно заниматься из любой точки мира: дома, на турнике во дворе
              или в зале.
            </p>
            <p className="pt-3 border-t border-white/5 text-[15px] sm:text-base">
              Наша миссия — помогать людям становиться сильнее, свободнее и
              увереннее.
            </p>
          </div>

          {/* Правая колонка: фотогалерея */}
          <div className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-white/5 px-5 py-5 sm:px-6 sm:py-6 backdrop-blur-sm">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-brand-muted mb-2">
                Калистеника для каждого
              </p>
              <p className="text-[13px] sm:text-sm text-brand-muted mb-3 leading-relaxed">
                Калистеника объединяет людей разного возраста и уровня — тех,
                кто хочет стать сильнее или освоить элементы, о которых давно
                мечтал.
              </p>

              <div
                className="relative mt-2 overflow-hidden rounded-2xl bg-black/40 aspect-[4/3] sm:aspect-[3/2] select-none"
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
                style={{ touchAction: "pan-y" }} // разрешаем вертикальный скролл, а горизонталь берём на себя
              >
                <Image
                  src={studioPhotos[photoIndex]}
                  alt="Групповая тренировка I Do Calisthenics"
                  fill
                  className="object-cover"
                  sizes="(min-width: 1024px) 380px, 100vw"
                  priority={photoIndex === 0}
                />

                {studioPhotos.length > 1 && (
                  <>
                    {/* подсказка градиентом, что можно листать */}
                    <div className="pointer-events-none absolute inset-y-0 left-0 w-14 bg-gradient-to-r from-black/40 to-transparent" />
                    <div className="pointer-events-none absolute inset-y-0 right-0 w-14 bg-gradient-to-l from-black/40 to-transparent" />

                    {/* кнопки (тач-зоны) */}
                    <button
                      type="button"
                      onClick={handlePrev}
                      className="absolute left-2 top-1/2 -translate-y-1/2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white text-lg backdrop-blur-sm hover:bg-black/70 transition-colors"
                      aria-label="Предыдущее фото"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={handleNext}
                      className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white text-lg backdrop-blur-sm hover:bg-black/70 transition-colors"
                      aria-label="Следующее фото"
                    >
                      ›
                    </button>
                  </>
                )}
              </div>

              {studioPhotos.length > 1 && (
                <div className="mt-3 flex justify-center gap-1.5">
                  {studioPhotos.map((_, idx) => (
                    <span
                      key={idx}
                      className={[
                        "h-1.5 w-1.5 rounded-full transition-colors",
                        idx === photoIndex ? "bg-brand-primary" : "bg-white/20",
                      ].join(" ")}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Блоки команды у тебя закомментированы — оставляю как было */}
      </div>
    </section>
  );
}
