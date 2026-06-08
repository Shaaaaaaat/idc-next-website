import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Оплата — Calisthenics",
  description:
    "Информация об оплате тренировок и программ: способы оплаты, безопасность и что происходит после успешного платежа.",
  alternates: { canonical: "/payment" },
};

export default function PaymentPage() {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl sm:text-4xl font-semibold mb-6">Оплата</h1>
      <div className="space-y-4 text-base text-white/80">
        <p>
          Мы используем надёжные платёжные инструменты. После успешной оплаты вы получите письмо с
          инструкциями: как начать тренировки, как подключиться к боту и где смотреть материалы.
          Если письмо не пришло — проверьте папку «Спам» или напишите нам.
        </p>
        <p>
          Все платежи проводятся в рублях. Данные обрабатываются в соответствии с политикой
          конфиденциальности. Возникли вопросы? Свяжитесь с поддержкой — поможем.
        </p>
      </div>
    </main>
  );
}

