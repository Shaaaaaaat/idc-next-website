import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "О проекте — Calisthenics",
  description:
    "Кто мы, как тренируем и почему делаем упор на технику. Команда тренеров, подход к нагрузкам и прогрессу, ценности проекта.",
  alternates: { canonical: "/project" },
};

export default function ProjectPage() {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl sm:text-4xl font-semibold mb-6">О проекте</h1>
      <div className="space-y-4 text-base text-white/80">
        <p>
          Мы помогаем людям развивать силу и контроль над телом через калистенику. В основе —
          последовательная методика, внимание к технике и бережное отношение к восстановлению.
          Наша цель — долгосрочный прогресс без травм и перегрузок.
        </p>
        <p>
          Команда объединяет тренеров с опытом онлайн‑и офлайн‑работы. Мы адаптируем программы под
          уровень и задачи, объясняем логику упражнений, делаем акцент на качестве движений и
          разумной периодизации.
        </p>
      </div>
    </main>
  );
}

