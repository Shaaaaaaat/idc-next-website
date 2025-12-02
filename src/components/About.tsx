"use client";

import { useMemo, useState } from "react";
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
    photo: "/images/coaches/gubanov.jpg", // поставь свой путь
    quote:
      "Десятки людей уже перемещаются по городу с красивым телом и отличным самочувствием. Присоединяйся и ты!",
    education: [
      "Российский государственный университет физической культуры, кафедра тяжелоатлетических видов спорта, бакалавр (2018)",
      "Практикую тяжёлую атлетику, стритлифтинг и элементы калистеники — тому же обучаю учеников"
    ],
    about: [
      "Люблю разбирать технику и прогрессию силовых элементов: подтягивания, выходы силой, стойки",
      "Меломан, увлекаюсь диджеингом и активным отдыхом, люблю вкусно поесть"
    ]
  },
  {
    id: "taranishina",
    name: "Дарья Таранишина",
    role: "Тренер по калистенике",
    city: "Санкт-Петербург и онлайн",
    photo: "/images/coaches/taranishina.jpg", // и тут свой путь
    quote:
      "Я как пазл собираю знания, методы и способы обучения, систематизирую и упрощаю их для лёгкого восприятия.",
    education: [
      "Школа фитнеса «Корус» — инструктор Т3 (2015)",
      "CrossFit LVL 1 (2018), КМС по тяжелой атлетике (2018)",
      "CrossFit Gymnastics (2020), CrossFit LVL 2 (2023)",
      "POWER MONKEY CAMP Online Course (2023)"
    ],
    about: [
      "Люблю тяжёлую атлетику, турники и брусья, тренируюсь и тренирую из любви и интереса к движению",
      "Помогаю ученикам побеждать слабость и страхи, говорю о сложных вещах простым языком"
    ]
  }
];

const team: Coach[] = [
  {
    name: "Имя Фамилия",
    role: "Тренер по калистенике",
    bio: "12 лет в гимнастике и калистенике. Фокус — техника, сила, работа с новичками.",
    since: "В I Do Calisthenics с 2020 года",
    photo: "/images/coaches/coach-1.jpg" // мини-аватар, можно оставить пустым
  },
  {
    name: "Имя Фамилия",
    role: "Ведущий тренер",
    bio: "Опыт в CrossFit и функциональном тренинге. Помогает ставить элементы без травм.",
    since: "В команде с 2019 года",
    photo: "/images/coaches/coach-2.jpg"
  },
  {
    name: "Имя Фамилия",
    role: "Методист",
    bio: "Собирает программы, следит за прогрессией нагрузок и логикой курсов.",
    since: "Следит за методикой с 2018 года",
    photo: "/images/coaches/coach-3.jpg"
  }
  // сюда потом спокойно добавишь ещё 2–4 тренеров
];

// фотки студий
const studioPhotos = [
  "/images/about/photo12.jpg",
  "/images/about/photo22.jpg",
  "/images/about/photo33.jpg",
  "/images/about/photo41.jpg"
];

export function About() {
  // сколько лет студии с учётом месяца
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
    setPhotoIndex(prev => (prev === 0 ? studioPhotos.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setPhotoIndex(prev =>
      prev === studioPhotos.length - 1 ? 0 : prev + 1
    );
  };

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
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight mb-4">
            От студии к цифровой системе
          </h2>
          <p className="text-sm sm:text-base text-brand-muted">
            I Do Calisthenics — школа калистеники, которая выросла из студии в Москве
            в систему тренировок с собственным весом для людей по всему миру. Мы совмещаем опыт живых
            тренировок и удобство приложения.
          </p>
        </div>

        {/* История + фото/факты */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] mb-12 sm:mb-14">
          {/* История и миссия */}
          <div className="space-y-5 text-sm sm:text-base text-brand-muted">
            <p>
              Первую студию мы открыли более{" "}
              <span className="font-semibold text-white">
                {yearsSinceLaunch}
              </span>{" "}
              лет назад. За это время обучили тысячи людей: разбирали технику
              по шагам, подбирали прогрессии и находили подход к каждому ученику — чтобы движение становилось понятным и доступным.
            </p>
            <p>
              Сейчас этот опыт переехал в цифровой формат. Всё, что мы отрабатывали
              руками и глазами в залах, стало системой: понятные шаги
              от базовых движений к сложным элементам.
            </p>
            <p>
              Онлайн для нас — не компромисс, а продолжение того, что работает.
              Можно заниматься из любой точки мира: дома, на
              турнике во дворе или в зале.
            </p>
            <p className="pt-2 border-t border-white/5 text-sm sm:text-base">
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
              <p className="text-xs sm:text-sm text-brand-muted mb-3">
              Калистеника объединяет людей разного возраста и уровня — тех, 
              кто хочет стать сильнее или освоить элементы, о которых давно мечтал.
              </p>

              <div className="relative mt-2 overflow-hidden rounded-2xl bg-black/40 aspect-[4/3] sm:aspect-[3/2]">
                <Image
                  src={studioPhotos[photoIndex]}
                  alt="Групповая тренировка I Do Calisthenics"
                  fill
                  className="object-cover"
                  sizes="(min-width: 1024px) 380px, 100vw"
                />

                {studioPhotos.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={handlePrev}
                      className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-2 py-1 text-sm sm:text-base backdrop-blur-sm hover:bg-black/70 transition-colors"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={handleNext}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-2 py-1 text-sm sm:text-base backdrop-blur-sm hover:bg-black/70 transition-colors"
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
                        idx === photoIndex
                          ? "bg-brand-primary"
                          : "bg-white/20"
                      ].join(" ")}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* КОМАНДА – крупные карточки двух тренеров
        <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand-muted mb-2">
              Команда
            </p>
            <h3 className="text-lg sm:text-xl font-semibold">
              Тренеры, которые сами живут калистеникой
            </h3>
          </div>
          <p className="text-xs sm:text-sm text-brand-muted max-w-md">
            Ниже — тренеры, с которыми ты будешь работать над техникой и силой.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-2 mb-10">
          {featuredCoaches.map(coach => (
            <article
              key={coach.id}
              className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#5b2cff]/20 via-[#c026d3]/10 to-[#0ea5e9]/10 px-5 py-5 sm:px-6 sm:py-6 backdrop-blur-sm"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="relative h-12 w-12 sm:h-14 sm:w-14 rounded-full overflow-hidden bg-white/10">
                    <Image
                      src={coach.photo}
                      alt={coach.name}
                      fill
                      className="object-cover"
                    />
                  </div>
                  <div>
                    <h4 className="text-sm sm:text-base font-semibold">
                      {coach.name}
                    </h4>
                    <p className="text-[11px] sm:text-xs text-brand-muted">
                      {coach.role} · {coach.city}
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-sm sm:text-base font-medium mb-4">
                «{coach.quote}»
              </p>

              <div className="grid gap-4 sm:grid-cols-2 text-xs sm:text-sm text-brand-muted">
                <div>
                  <p className="mb-1 font-semibold text-[11px] sm:text-xs uppercase tracking-[0.16em]">
                    Тренерское образование
                  </p>
                  <ul className="space-y-1.5">
                    {coach.education.map((item, idx) => (
                      <li key={idx} className="flex gap-2">
                        <span className="mt-1 h-1 w-1 rounded-full bg-white/60" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 font-semibold text-[11px] sm:text-xs uppercase tracking-[0.16em]">
                    О себе
                  </p>
                  <ul className="space-y-1.5">
                    {coach.about.map((item, idx) => (
                      <li key={idx} className="flex gap-2">
                        <span className="mt-1 h-1 w-1 rounded-full bg-white/60" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </article>
          ))}
        </div> */}

        {/* Остальные тренеры – компактные карточки, можно добавить до 5–7 человек
        <div className="grid gap-4 sm:gap-6 md:grid-cols-3">
          {team.map((coach, index) => (
            <article
              key={`${coach.name}-${index}`}
              className="rounded-3xl border border-white/10 bg-white/5 px-4 py-4 sm:px-5 sm:py-5 backdrop-blur-sm flex flex-col"
            >
              <div className="mb-3 flex items-center gap-3">
                <div className="relative h-10 w-10 sm:h-12 sm:w-12 rounded-full overflow-hidden bg-white/10 flex items-center justify-center text-xs font-semibold">
                  {coach.photo ? (
                    <Image
                      src={coach.photo}
                      alt={coach.name}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    "ID"
                  )}
                </div>
                <div>
                  <h4 className="text-sm sm:text-base font-semibold">
                    {coach.name}
                  </h4>
                  <p className="text-[11px] sm:text-xs text-brand-muted">
                    {coach.role}
                  </p>
                </div>
              </div>
              <p className="text-xs sm:text-sm text-brand-muted mb-3">
                {coach.bio}
              </p>
              <p className="mt-auto text-[11px] sm:text-xs text-brand-muted/80">
                {coach.since}
              </p>
            </article>
          ))}
        </div> */}
      </div>
    </section>
  );
}
