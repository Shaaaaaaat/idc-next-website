export default function PaymentSuccessPage() {
    return (
      <main className="min-h-screen bg-brand-dark text-white flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <h1 className="text-2xl sm:text-3xl font-semibold mb-4">
            Оплата прошла успешно 🙌
          </h1>
          <p className="text-sm sm:text-base text-brand-muted mb-6">
            Спасибо! В ближайшее время мы свяжемся с тобой и подключим доступ к
            тренировкам.
          </p>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-full bg-brand-primary px-6 py-3 text-sm font-semibold hover:bg-brand-primary/90 transition-colors"
          >
            Вернуться на главную
          </a>
        </div>
      </main>
    );
  }
  