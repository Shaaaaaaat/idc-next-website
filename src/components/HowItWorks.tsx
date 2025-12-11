"use client";

const steps = [
  {
    number: "01",
    title: "Определяем уровень и цели",
    text: "Проходишь тест силы по нашей инструкции: 5–7 упражнений в зависимости от выбранного курса и доступного инвентаря. Фиксируем текущий уровень и выбираем главную цель.",
    meta: "Займёт 30–40 минут",
  },
  {
    number: "02",
    title: "Собираем программу под твой уровень",
    text: "На основе теста подбираем упражнения и прогрессии под твой уровень, объясняем правильную технику и разбираем частые ошибки.",
    meta: "Программа на 4–12 недель",
  },
  {
    number: "03",
    title: "Занимаешься и укрепляешь тело",
    text: "Выполняешь тренировки по приложению, отмечаешь выполненные сессии и отправляешь видео-отчёты тренеру. Тренер даёт обратную связь и обновляет тренировку под твой прогресс. Видишь, как растёт сила, улучшается техника и цель становится достижимой.",
    meta: "Обратная связь после каждой тренировки",
  },
];

export function HowItWorks() {
  return (
    <section
      id="how"
      className="relative w-full border-t border-white/5 bg-[#050816] scroll-mt-24 md:scroll-mt-28"
    >
      {/* лёгкое фоновое свечение слева / справа */}
      <div className="pointer-events-none absolute -left-40 top-10 h-80 w-80 rounded-full bg-brand-blue/30 blur-[120px]" />
      <div className="pointer-events-none absolute right-0 bottom-0 h-72 w-72 rounded-full bg-brand-primary/20 blur-[120px]" />

      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-14 sm:py-20 lg:py-24 relative">
        {/* заголовок */}
        <div className="mb-10 sm:mb-16 lg:mb-20 max-w-2xl">
          <p className="text-[11px] sm:text-xs font-medium uppercase tracking-[0.2em] text-brand-muted mb-3">
            Процесс
          </p>
          <h2 className="text-[26px] sm:text-3xl lg:text-4xl font-semibold tracking-tight mb-4 leading-tight">
            От теста силы до подтягиваний,
            <br className="hidden sm:block" /> стойки на руках и выходов силой
          </h2>
          <p className="text-[14px] sm:text-base text-brand-muted leading-relaxed">
            Каждый элемент разбираем на технику, частые ошибки и понятные
            прогрессии под твой уровень. Тест силы показывает, где ты сейчас,
            цель — к какому элементу идёшь, а индивидуальная программа и
            видео-разборы тренера помогают дойти до целей безопасно и
            эффективно.
          </p>
        </div>

        <div className="relative">
          {/* вертикальная линия таймлайна */}
          <div className="absolute left-5 sm:left-6 top-2 bottom-4">
            <div className="h-full w-px bg-gradient-to-b from-brand-primary/30 via-brand-blue/30 to-brand-accent/20" />
          </div>

          {/* сами шаги */}
          <div className="space-y-10 sm:space-y-16 lg:space-y-20">
            {steps.map((step, index) => (
              <article
                key={step.number}
                className="relative pl-14 sm:pl-20"
              >
                {/* точка на линии */}
                <div className="absolute left-3.5 sm:left-4.5 top-2 flex h-4 w-4 items-center justify-center">
                  <div className="relative h-3 w-3">
                    <span className="absolute inset-0 rounded-full bg-brand-accent/35 blur-[4px] opacity-70" />
                    <span className="relative block h-2 w-2 rounded-full bg-brand-accent shadow-[0_0_12px_rgba(124,255,178,0.9)]" />
                  </div>
                </div>

                {/* огромная цифра на фоне */}
                <div className="pointer-events-none absolute -left-5 sm:-left-3 -top-5 text-[64px] sm:text-[100px] lg:text-[120px] font-semibold leading-none text-white/5 select-none">
                  {step.number}
                </div>

                {/* контент шага */}
                <div className="relative rounded-3xl bg-white/5 hover:bg-white/8 transition-colors duration-300 border border-white/5 backdrop-blur-sm px-4 py-5 sm:px-6 sm:py-6 lg:px-7 lg:py-7">
                  <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-3 mb-3">
                    <div className="inline-flex items-center gap-2 text-[12px] sm:text-xs text-brand-muted">
                      <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.16em]">
                        Шаг {index + 1}
                      </span>
                    </div>
                    <span className="text-[11px] sm:text-xs text-brand-muted">
                      {step.meta}
                    </span>
                  </div>

                  <h3 className="text-[16px] sm:text-lg lg:text-xl font-semibold mb-2">
                    {step.title}
                  </h3>

                  <p className="text-[14px] sm:text-sm text-brand-muted leading-relaxed max-w-2xl">
                    {step.text}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
