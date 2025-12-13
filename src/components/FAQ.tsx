// src/components/FAQ.tsx
"use client";

import { useId, useState } from "react";

type FAQItem = {
  question: string;
  answer: string;
};

const faqs: FAQItem[] = [
  {
    question: "Подойдёт ли это, если я никогда не занимался/не занималась?",
    answer:
      "Да. Мы начинаем с теста силы и простых упражнений, чтобы понять твой уровень. Программа масштабируется под тебя: от самых базовых движений до элементов. Никаких «сравнить с нормами» — мы сравниваем только тебя сегодняшнего с тобой же через несколько недель."
  },
  {
    question: "Сколько времени занимает одна тренировка?",
    answer:
      "В среднем 30–60 минут в зависимости от формата и уровня. Для стартовых программ — ближе к 30–40 минутам. Можно тренироваться дома, на площадке или в зале, если тебе так комфортнее."
  },
  {
    question: "Нужен ли турник или зал?",
    answer:
      "На самых первых этапах можно обойтись без зала: часть программ рассчитана на тренировки дома. Но для прогресса в подтягиваниях и элементах турник или доступ к площадке всё-таки нужен. Мы подскажем минимальный набор, с которого стоит начать."
  },
  {
    question: "Как тренер даёт обратную связь по технике?",
    answer:
      "Ты снимаешь по одному подходу на видео и загружаешь в приложение. Тренер смотрит, отмечает ошибки, даёт комментарии и корректировки. На основе этого он собирает следующую тренировку или корректирует текущий блок, чтобы ты прогрессировал безопасно."
  },
  {
    question: "Что если я пропущу тренировки или выбьюсь из графика?",
    answer:
      "Это нормально, жизнь не всегда укладывается в идеальный план. Если что-то пропустил — просто возвращаешься к программе с того места, где остановился. Тренер может адаптировать план под новую реальность: уменьшить объём, поменять частоту, пересобрать неделю."
  },
  {
    question: "Можно ли менять курс или цель внутри блока тренировок?",
    answer:
      "Да. Ты покупаешь блок тренировок, а не жёстко привязываешься к одному курсу. Если в процессе захочешь сместить фокус, например с подтягиваний на стойку на руках, — обсудишь это с тренером, и он адаптирует программу."
  }
];

export function FAQ() {
  const sectionId = useId();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleIndex = (index: number) => {
    setOpenIndex((prev) => (prev === index ? null : index));
  };

  return (
    <section
      id="faq"
      className="py-16 sm:py-20 lg:py-24 scroll-mt-24 md:scroll-mt-28 border-t border-white/5"
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
            Если остались сомнения — скорее всего, здесь есть ответ. Если нет —
            можно всегда задать вопрос тренеру перед стартом.
          </p>
        </div>

        <div className="space-y-3 sm:space-y-4">
          {faqs.map((item, index) => {
            const isOpen = openIndex === index;
            const panelId = `${sectionId}-panel-${index}`;
            const buttonId = `${sectionId}-button-${index}`;

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
                  onClick={() => toggleIndex(index)}
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

                {/* Плавное раскрытие без изменения текста */}
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

        {/* небольшой call-to-action под FAQ */}
        <div className="mt-8 sm:mt-10 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 sm:px-5 sm:py-5 text-[13px] sm:text-sm text-brand-muted leading-relaxed">
          Всё ещё сомневаешься, с чего начать? Попробуй с бесплатного теста
          силы — это безопасный способ понять свой уровень и формат тренировок.
        </div>
      </div>
    </section>
  );
}
