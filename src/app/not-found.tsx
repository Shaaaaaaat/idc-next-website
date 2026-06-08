export default function NotFound() {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-24">
      <h1 className="text-3xl sm:text-4xl font-semibold mb-4">Страница не найдена</h1>
      <p className="text-white/80 mb-8">
        Возможно, ссылка устарела или была изменена. Проверьте адрес или вернитесь на главную.
      </p>
      <a
        href="/"
        className="inline-block rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 px-4 py-2 text-sm"
      >
        На главную
      </a>
    </main>
  );
}

