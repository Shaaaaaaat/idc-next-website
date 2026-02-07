// src/components/FAQ.tsx
"use client";

import { useId, useState } from "react";

type FAQItem = {
  question: string;
  answer: string;
};

type FAQGroup = {
  title: string;
  items: FAQItem[];
};

// Группы: Онлайн / В зале / Совмещать
const faqGroups: FAQGroup[] = [
  {
    title: "Онлайн",
    items: [
      {
        question: "Подойдёт ли мне калистеника, если я никогда не занимался/не занималась?",
        answer:
          "Да. Мы начинаем с теста силы и простых упражнений, чтобы понять твой уровень. Программа масштабируется под тебя: от самых базовых движений до элементов. Никаких «сравнить с нормами» — мы сравниваем только тебя сегодняшнего с тобой же через несколько недель."
      },
      {
        question: "Сколько времени занимает онлайн‑тренировка?",
        answer:
          "Обычно 30–60 минут. Для стартовых уровней — ближе к 30–40 минутам. Формат гибкий: можно тренироваться дома, на площадке или в зале."
      },
      {
        question: "Нужен ли турник или зал?",
        answer:
          "На самых первых этапах можно обойтись без зала: часть программ рассчитана на тренировки дома. Но для прогресса в подтягиваниях и элементах турник или доступ к площадке всё-таки нужен. Мы подскажем минимальный набор, с которого стоит начать."
      },
      {
        question: "Что если я пропущу тренировку или выбьюсь из графика?",
        answer:
          "Это нормально, жизнь не всегда укладывается в идеальный план. Если что-то пропустил — просто возвращаешься к программе с того места, где остановился. Тренер может адаптировать план под новую реальность: уменьшить объём и поменять частоту, чтобы вернуться без стресса."
      }
    ]
  },
  {
    title: "В зале",
    items: [
      {
        question: "Как проходит первая тренировка в студии и что надо взять с собой?",
        answer:
          "Возьми удобную форму и воду — остальное подскажем на месте. У нас групповая тренировка с особым вниманием новичкам: тренер уточнит цели, посмотрит текущий уровень (что получается, что нет) и даст упражнения под тебя. Всё проходит в дружелюбной и поддерживающей атмосфере."
      },
      {
        question: "Подойдут ли мне тренировки в зале, если я без опыта?",
        answer:
          "Конечно, подойдут. Даже на групповых занятиях мы сохраняем индивидуальный подход. Подбираем упражнения под твой текущий уровень — от базовых движений до более сложных элементов. Уделяем внимание технике и постепенному прогрессу."
      }
    ]
  },
  {
    title: "Совмещать",
    items: [
      {
        question: "Можно ли совмещать онлайн и тренировки в студии?",
        answer:
          "Конечно! Мы сделали так, чтобы ты мог тренироваться с нами в любом формате — без потери качества и прогресса. Онлайн, в студии или совмещая оба варианта. Все занятия сохраняются в приложении, а тренер подстраивает нагрузку под тебя и твой график."
      }
    ]
  }
];

export function FAQ() {
  const sectionId = useId();
  const [openKey, setOpenKey] = useState<string | null>(null);

  const toggleKey = (key: string) => {
    setOpenKey((prev) => (prev === key ? null : key));
  };

  return (
    <section
      id="faq"
      className="py-16 sm:py-20 lg:py-24 border-t border-white/5 scroll-mt-[calc(var(--header-h)+var(--anchor-extra))]"
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 sm:mb-10">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand-muted mb-3">
            FAQ
          </p>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight mb-4">
            Частые вопросы
          </h2>
          <p className="text-sm sm:text-base text-brand-muted">
          Если остались сомнения — скорее всего, здесь есть ответ.
          </p>
        </div>

        <div className="space-y-6 sm:space-y-7">
          {faqGroups.map((group, gi) => {
            return (
              <div key={group.title}>
                <h3 className="mb-2 text-[11px] sm:text-xs uppercase tracking-[0.16em] text-brand-muted">
                  {group.title}
                </h3>
                <div className="space-y-3 sm:space-y-4">
                  {group.items.map((item, ii) => {
                    const key = `${gi}-${ii}`;
                    const isOpen = openKey === key;
                    const panelId = `${sectionId}-panel-${key}`;
                    const buttonId = `${sectionId}-button-${key}`;

                    return (
                      <div
                        key={item.question}
                        className={[
                          "rounded-2xl border bg-white/5 backdrop-blur-sm transition-colors",
                          isOpen ? "border-white/20" : "border-white/10 hover:border-white/15"
                        ].join(" ")}
                      >
                        <button
                          id={buttonId}
                          type="button"
                          onClick={() => toggleKey(key)}
                          aria-expanded={isOpen}
                          aria-controls={panelId}
                          className={[
                            "group flex w-full items-start justify-between gap-4",
                            "px-4 py-4 sm:px-5 sm:py-4",
                            "text-left",
                            "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-dark",
                            "active:scale-[0.99] transition"
                          ].join(" ")}
                        >
                          <span className="text-base sm:text-base font-medium leading-snug">
                            {item.question}
                          </span>

                          <span
                            className={[
                              "mt-0.5 shrink-0 grid place-items-center",
                              "h-9 w-9 rounded-full",
                              "border border-white/20 bg-white/5",
                              "text-sm font-semibold text-white/90",
                              "group-hover:bg-white/10 transition-colors"
                            ].join(" ")}
                            aria-hidden="true"
                          >
                            {isOpen ? "–" : "+"}
                          </span>
                        </button>

                        <div
                          id={panelId}
                          role="region"
                          aria-labelledby={buttonId}
                          className={[
                            "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
                            isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                          ].join(" ")}
                        >
                          <div className="overflow-hidden">
                            <div className="px-4 pb-4 sm:px-5 sm:pb-5 -mt-1">
                              <p className="text-[15px] sm:text-sm text-brand-muted leading-relaxed">
                                {item.answer}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* небольшой call-to-action под FAQ */}
        <div className="mt-8 sm:mt-10 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 sm:px-5 sm:py-5 text-[13px] sm:text-sm text-brand-muted leading-relaxed">
          Всё ещё сомневаешься, с чего начать? Пройди тест силы — безопасный способ понять свой уровень и формат тренировок.
        </div>
      </div>
    </section>
  );
}
