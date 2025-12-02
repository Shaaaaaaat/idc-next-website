// src/app/consent/page.tsx
import Link from "next/link";

export default function ConsentPage() {
  return (
    <main className="min-h-screen bg-brand-dark text-white">
      <div className="mx-auto max-w-container px-4 sm:px-6 lg:px-8 py-8 sm:py-10 lg:py-12">
        {/* Хедер страницы */}
        <header className="mb-8 flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-[11px] sm:text-xs text-brand-muted/80 uppercase tracking-wide">
              Документ
            </p>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Согласие на обработку персональных данных
            </h1>
          </div>
          <Link
            href="/"
            className="text-[11px] sm:text-xs text-brand-muted hover:text-white transition-colors underline underline-offset-4 decoration-dotted"
          >
            ← На главную
          </Link>
        </header>

        {/* Тело документа */}
        <section className="rounded-3xl border border-white/10 bg-black/30 px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10 text-[13px] sm:text-sm leading-relaxed text-brand-muted space-y-4">
          <p className="font-semibold text-white">
            Согласие на обработку персональных данных
          </p>

          <p>
            Отправляя заявку или регистрируясь на сайте{" "}
            <a
              href="https://calisthenics.ru/"
              target="_blank"
              rel="noreferrer"
              className="text-white underline decoration-dotted"
            >
              https://calisthenics.ru/
            </a>{" "}
            и/или в чат-боте{" "}
            <a
              href="https://t.me/idcmain_bot"
              target="_blank"
              rel="noreferrer"
              className="text-white underline decoration-dotted"
            >
              https://t.me/idcmain_bot
            </a>{" "}
            Пользователь подтверждает согласие на обработку своих персональных
            данных Индивидуальным предпринимателем Шатворяном Ованесом
            Рубеновичем (далее - Оператор, ИНН: 771777622100; ОГРН:
            318774600511781, Москва ул Новоалексеевская 9 кв 94 индекс 129626),
            в целях предоставления ответов на запросы, а также в целях оказания
            услуг Пользователю.
          </p>

          <p>
            Пользователь дает согласие Оператору на осуществление
            автоматизированной и неавтоматизированной обработки, включая сбор,
            запись, систематизацию, накопление, хранение, уточнение (обновление,
            изменение), использование, передачу (предоставление, доступ)
            следующих персональных данных:
          </p>

          <ul className="list-disc list-inside ml-4 space-y-1">
            <li>Фамилия Имя Отчество</li>
            <li>Адрес электронной почты</li>
            <li>Номер телефона/мессенджер</li>
          </ul>

          <p>
            Согласие Пользователя действует до даты его отзыва путем направления
            Пользователем письменного заявления Оператору на адрес электронной
            почты OV.SHATVORYAN@GMAIL.COM или до даты достижения целей обработки
            персональных данных, в зависимости от того, какой момент наступит
            раньше.
          </p>

          <p>
            В случае отзыва Пользователем согласия на обработку персональных
            данных Оператор вправе продолжить обработку персональных данных без
            согласия субъекта персональных данных при наличии оснований,
            указанных в пунктах 2 – 11 части 1 статьи 6, части 2 статьи 10 и
            части 2 статьи 11 Федерального закона №152-ФЗ «О персональных
            данных» от 27.07.2006 г.
          </p>
        </section>
      </div>
    </main>
  );
}
