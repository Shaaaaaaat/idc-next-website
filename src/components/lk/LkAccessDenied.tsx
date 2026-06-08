export function LkAccessDenied() {
  return (
    <main className="min-h-screen bg-brand-dark text-white">
      <section className="mx-auto max-w-xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-8">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand-muted mb-3">
            Личный кабинет
          </p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-4">
            Доступ ограничен
          </h1>
          <p className="text-sm text-brand-muted mb-6">
            Вход выполнен, но доступ к разделу пока не активирован. Если это ошибка,
            напиши в поддержку.
          </p>
          <a
            href="/lk/logout"
            className="inline-flex rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-brand-muted hover:bg-white/10 transition-colors"
          >
            Выйти
          </a>
        </div>
      </section>
    </main>
  );
}

