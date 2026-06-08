import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Онлайн‑стойка на руках — Calisthenics",
  description:
    "Пошаговая программа по стойке на руках: укрепление базовой силы, баланс, мобильность плеч. Видео‑разбор техники и контроль прогресса.",
  alternates: { canonical: "/handstand_online" },
};

export default function HandstandOnlinePage() {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl sm:text-4xl font-semibold mb-6">
        Онлайн‑курс по стойке на руках
      </h1>
      <div className="space-y-4 text-base text-white/80">
        <p>
          Курс сочетает силовую подготовку и работу над балансом: укрепляем плечевой пояс, корпус и
          кисти, осваиваем безопасные подходы к стойке у стены и в пространстве. По вашим видео мы
          даём обратную связь и корректируем нагрузку.
        </p>
        <p>
          Программа подойдёт начинающим и продолжающим: вы получите понятную структуру и измеримый
          прогресс по неделям. Регулярность и корректная техника — ключ к уверенной стойке.
        </p>
      </div>
    </main>
  );
}

