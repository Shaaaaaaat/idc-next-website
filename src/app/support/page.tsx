import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Поддержка приложения IDC",
  description:
    "Помощь пользователям приложения IDC: вопросы по аккаунту, тренировкам, результатам, видео, абонементу и оплате.",
  alternates: { canonical: "/support" },
};

const supportTopics = [
  "вход и доступ к аккаунту",
  "отображение тренировочной программы",
  "результаты тренировок и обратная связь",
  "загрузка видео выполнения упражнений",
  "баланс и срок действия абонемента",
  "вопросы по оплате",
  "технические ошибки приложения",
];

const requestDetails = [
  "имя, указанное в приложении",
  "краткое описание проблемы",
  "модель устройства и версию iOS",
  "скриншот ошибки, если это возможно",
  "примерное время возникновения проблемы",
];

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-brand-dark text-white">
      <div className="mx-auto max-w-container px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-brand-muted/80 sm:text-xs">
              Поддержка
            </p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Поддержка приложения IDC
            </h1>
            <p className="max-w-3xl text-sm leading-relaxed text-brand-muted sm:text-base">
              Если у вас возник вопрос по тренировкам, доступу к аккаунту, оплате или работе приложения,
              свяжитесь с нашей службой поддержки.
            </p>
          </div>
          <Link
            href="/"
            className="shrink-0 text-[11px] text-brand-muted underline decoration-dotted underline-offset-4 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white sm:text-xs"
          >
            ← На главную
          </Link>
        </header>

        <div className="space-y-5">
          <section className="rounded-3xl border border-white/10 bg-black/30 px-4 py-6 text-sm leading-relaxed text-brand-muted sm:px-6 sm:py-8 lg:px-8">
            <div className="max-w-3xl space-y-4">
              <a
                href="https://t.me/mroooooom"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-brand-dark transition-colors hover:bg-brand-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
              >
                Написать в Telegram
              </a>
              <p>
                В сообщении кратко опишите проблему и укажите имя, указанное в вашем профиле. Не
                отправляйте пароль или другие конфиденциальные данные.
              </p>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-black/30 px-4 py-6 text-sm leading-relaxed text-brand-muted sm:px-6 sm:py-8 lg:px-8">
            <h2 className="text-base font-semibold text-white sm:text-lg">
              С чем мы можем помочь
            </h2>
            <ul className="mt-4 list-disc space-y-2 pl-5">
              {supportTopics.map((topic) => (
                <li key={topic}>{topic}</li>
              ))}
            </ul>
          </section>

          <section className="rounded-3xl border border-white/10 bg-black/30 px-4 py-6 text-sm leading-relaxed text-brand-muted sm:px-6 sm:py-8 lg:px-8">
            <h2 className="text-base font-semibold text-white sm:text-lg">
              Что указать при обращении
            </h2>
            <ul className="mt-4 list-disc space-y-2 pl-5">
              {requestDetails.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
            <p className="mt-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-semibold text-white">
              Не отправляйте пароль, данные банковской карты или коды подтверждения.
            </p>
          </section>

          <nav
            aria-label="Полезные ссылки"
            className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-black/30 px-4 py-5 text-sm text-brand-muted sm:flex-row sm:flex-wrap sm:px-6 lg:px-8"
          >
            <Link
              href="/privacy"
              className="underline decoration-dotted underline-offset-4 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            >
              Политика конфиденциальности
            </Link>
            <Link
              href="/offer"
              className="underline decoration-dotted underline-offset-4 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            >
              Онлайн-оферта
            </Link>
            <Link
              href="/"
              className="underline decoration-dotted underline-offset-4 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            >
              Главная
            </Link>
          </nav>
        </div>
      </div>
    </main>
  );
}
