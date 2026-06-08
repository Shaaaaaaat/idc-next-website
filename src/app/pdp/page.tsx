import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Политика обработки данных — Calisthenics",
  description:
    "Правовая информация о порядке обработки персональных данных, правах пользователей и мерах защиты.",
  alternates: { canonical: "/pdp" },
};

export default function PdpPage() {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl sm:text-4xl font-semibold mb-6">
        Политика обработки персональных данных
      </h1>
      <div className="space-y-4 text-base text-white/80">
        <p>
          На этой странице приведены ключевые положения о том, как мы собираем, используем и
          храним персональные данные. Мы соблюдаем требования действующего законодательства и
          применяем организационные и технические меры защиты.
        </p>
        <p>
          Подробную версию политики и условия вы можете найти в соответствующих разделах сайта.
          Если у вас есть вопросы относительно обработки данных, свяжитесь с нами любым удобным
          способом.
        </p>
      </div>
    </main>
  );
}

