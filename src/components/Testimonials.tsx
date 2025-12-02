

  "use client";

import { useRef, useState, MouseEvent } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Pagination, Mousewheel } from "swiper/modules";
import type { Swiper as SwiperType } from "swiper";

import "swiper/css";
import "swiper/css/pagination";

type Testimonial = {
  id: string;
  name: string;
  tag?: string;
  text: string;
  source?: string;
  url?: string;
};


  
const testimonials: Testimonial[] = [
  {
    id: "t1",
    name: "Женя",
    tag: "Онлайн · Подтягивания для девушек",
    text: "Я всегда занималась спортом, но в последнее время у меня было ограничение по времени, да и стало скучно делать стандартные упражнения/программы. Вот уже год я занимаюсь с вами калистеникой и это превзошло все мои фантазии! Моя сила значительно увеличилась, при это я стала более гибкой, крепкой и выносливой. Моя форма уселась в красивую фигуру, хоть я и не очень сильно похудела (потому что я отказываюсь сидеть на строгой диете). Тренер Даша часто дополнительно отправляет видео, чтобы обьяснить непонятные аспекты. Мы ставим общие цели и работаем для этого. И ,конечно, что для очень важно - я могу треннироваться тогда когда удобно МНЕ. Обожаю вас! Долгих лет успеха вам! ❤️",
    source: "Instagram",
    url: "https://www.instagram.com/p/DIB_beJiU6f/?igsh=MWpsenA0MXJuMnJs"  // вставишь реальные ссылки
  },
  {
    id: "t2",
    name: "Дмитрий",
    tag: "Москва · зал + онлайн",
    text: "Очень крутое место для занятий калистеникой. Тренеру действительно важно сначала изучить индивидуальные способности и особенности занимающихся. Очень здорово, что через приложение, доступ к которому предоставляется школой, можно отслеживать свой прогресс. Приятно, когда команда школы делает много для того, чтобы и ученики чувствовали себя комфортно, в то же время выкладываясь и меняясь к лучшему, и тренер был заряжен и заинтересован в их прогрессе! Настоятельно рекомендую попробовать тем, кто хотел бы добавить в спортивную жизнь динамику и креатив и кто хочет узнать, почему активность с минимальным оборудованием и без тяжёлых весов может открыть новый мир с огромным потенциалом роста!",
    source: "Яндекс.Карты",
    url: "https://yandex.com/maps/org/i_do_calisthenics/161199229699/?ll=37.557879%2C55.764496&z=16"
  },
  {
    id: "t3",
    name: "Инна",
    tag: "Онлайн · Calisthenics light",
    text: "Добрый день! Занимаюсь третий месяц - с января, решила попробовать и неожиданно нашла для себя идеальный формат занятий - тренируюсь, когда удобно, необходимость отправлять отчеты дисциплинирует) на каждой тренировке - разные упражнения, это очень интересно. Поначалу было прям легко, сейчас подобрали оптимальную нагрузку и многие упражнения уже даются непросто и это вызывает азарт ) И прогресс, конечно, есть - очень приятное ощущение, когда силы становится больше и упражнение дается легче! Моя цель - научиться подтягиваться со своим весом к лету и мне кажется, я уже на уверенной половине пути)",
    source: "Instagram",
    url: "https://www.instagram.com/p/DIB_beJiU6f/?igsh=MWpsenA0MXJuMnJs"
  },
  {
      id: "t4",
      name: "Александр",
      tag: "Онлайн · Calisthenics light",
      text: "Добрый день! Занимаюсь третий месяц - с января, решила попробовать и неожиданно нашла для себя идеальный формат занятий - тренируюсь, когда удобно, необходимость отправлять отчеты дисциплинирует) на каждой тренировке - разные упражнения, это очень интересно. Поначалу было прям легко, сейчас подобрали оптимальную нагрузку и многие упражнения уже даются непросто и это вызывает азарт ) И прогресс, конечно, есть - очень приятное ощущение, когда силы становится больше и упражнение дается легче! Моя цель - научиться подтягиваться со своим весом к лету и мне кажется, я уже на уверенной половине пути)",
      source: "Instagram",
      url: "https://www.instagram.com/p/DIB_beJiU6f/?igsh=MWpsenA0MXJuMnJs"
    },
];


export function Testimonials() {
  const [swiper, setSwiper] = useState<SwiperType | null>(null);
  const lastSlideTimeRef = useRef<number>(0);

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    if (!swiper) return;
    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;

    const now = Date.now();
    const throttleMs = 600; // раз в 0.6 сек максимум
    if (now - lastSlideTimeRef.current < throttleMs) return;

    const edgeZone = width * 0.2; // 20% слева и справа

    if (x < edgeZone) {
      swiper.slidePrev();
      lastSlideTimeRef.current = now;
    } else if (x > width - edgeZone) {
      swiper.slideNext();
      lastSlideTimeRef.current = now;
    }
  }

  function handleMouseLeave() {
    // сбрасываем троттлинг, когда курсор ушёл
    lastSlideTimeRef.current = 0;
  }

  return (
    <section
      id="reviews"
      className="py-16 sm:py-20 lg:py-24 border-t border-white/5 scroll-mt-24 md:scroll-mt-28"
    >
      <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8">
        {/* Заголовок */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8 sm:mb-10">
          <div className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand-muted mb-3">
              Отзывы
            </p>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight mb-3">
              Что говорят ученики
            </h2>
            <p className="text-sm sm:text-base text-brand-muted">
              Ниже — несколько отзывов ребят, которые уже прошли тест силы,
              получили разбор техники и тренируются по нашей системе.
            </p>
          </div>

          <div className="text-xs sm:text-sm text-brand-muted/80">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span>Отзывы из Instagram и Яндекс.Карт</span>
            </div>
          </div>
        </div>

        {/* Свайпер + реакция на движение курсора */}
        <div
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="relative"
        >
          <Swiper
            modules={[Pagination, Mousewheel]}
            spaceBetween={20}
            slidesPerView={1.05}
            pagination={{ clickable: true }}
            mousewheel={{ forceToAxis: true, releaseOnEdges: true }}
            grabCursor
            onSwiper={(instance) => setSwiper(instance)}
            breakpoints={{
              640: { slidesPerView: 1.4, spaceBetween: 24 },
              768: { slidesPerView: 2, spaceBetween: 24 },
              1024: { slidesPerView: 3, spaceBetween: 24 },
            }}
            className="!pb-12"
          >
            {testimonials.map((review) => (
              <SwiperSlide key={review.id} className="h-auto">
                <article className="flex h-full flex-col rounded-3xl border border-white/10 bg-white/5 px-5 py-5 sm:px-6 sm:py-6 backdrop-blur-sm shadow-soft">
                  <div className="mb-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm sm:text-base font-semibold">
                          {review.name}
                        </h3>
                        {review.tag && (
                          <p className="text-[11px] sm:text-xs text-brand-muted mt-0.5">
                            {review.tag}
                          </p>
                        )}
                      </div>

                      {review.source && review.url && (
                        <a
                          href={review.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-brand-muted hover:text-white transition-colors"
                        >
                          {review.source}
                        </a>
                      )}
                    </div>
                  </div>

                  <p className="text-sm text-brand-muted leading-relaxed whitespace-pre-line">
                    {review.text}
                  </p>
                </article>
              </SwiperSlide>
            ))}
          </Swiper>
        </div>
      </div>
    </section>
  );
}
