import type { EmailPayload } from "./types.ts";

const TRUECOACH_IOS_URL =
  "https://apps.apple.com/am/app/truecoach-for-clients/id1439127794";
const TRUECOACH_ANDROID_URL =
  "https://play.google.com/store/apps/details?id=co.truecoach.client";

export type WelcomeTemplateInput = {
  clientName: string;
  courseName: string;
  tariffLabel: string;
  validWeeks: number;
  telegramUrl: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textValue(value: string, maxLength = 240) {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function paragraphHtml(lines: string[]) {
  return lines
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("\n");
}

function linkHtml(label: string, href: string) {
  const safeHref = escapeHtml(href);
  return `<p>${escapeHtml(label)}<br><a href="${safeHref}">${safeHref}</a></p>`;
}

export function weekPluralRu(value: number) {
  const absolute = Math.abs(Math.trunc(value));
  const mod100 = absolute % 100;
  const mod10 = absolute % 10;

  if (mod100 >= 11 && mod100 <= 14) return "недель";
  if (mod10 === 1) return "неделя";
  if (mod10 >= 2 && mod10 <= 4) return "недели";
  return "недель";
}

export function buildFirstOnlinePurchaseWelcomeEmail(
  input: WelcomeTemplateInput,
): Omit<EmailPayload, "to"> {
  const courseName = textValue(input.courseName, 120);
  const tariffLabel = textValue(input.tariffLabel || input.courseName, 160);
  const clientName = textValue(input.clientName, 120);
  const greeting = clientName
    ? `Ура, ${clientName}, оплата прошла успешно! 🎉`
    : "Ура, оплата прошла успешно! 🎉";
  const durationLine = `${tariffLabel} — доступ действует ${input.validWeeks} ${
    weekPluralRu(input.validWeeks)
  } с момента оплаты.`;
  const subject = `IDC: вы приобрели тест-силы для курса "${courseName}" ✅`;

  const text = [
    greeting,
    "",
    durationLine,
    "",
    "В течение 24 часов на вашу почту придет письмо с темой [TrueCoach] Invitation, содержащее приглашение для доступа к приложению, где будет стоять первая тренировка.",
    "",
    "После ее прохождения тренер свяжется с вами и предоставит подробную обратную связь.",
    "",
    "Перейдите в Telegram — там вы сможете быстро связаться с поддержкой и проверить свой баланс:",
    "",
    input.telegramUrl,
    "",
    "Для удобства рекомендуем скачать мобильную версию приложения 👇🏻",
    "",
    "Ссылка для iOS:",
    TRUECOACH_IOS_URL,
    "",
    "Ссылка для Андроида:",
    TRUECOACH_ANDROID_URL,
    "",
    "Также мы отправим отдельным письмом короткую инструкцию по выполнению теста силы.",
    "",
    "Пусть каждая тренировка приносит результат и удовольствие.",
  ].join("\n");

  const html = [
    paragraphHtml([
      greeting,
      durationLine,
      "В течение 24 часов на вашу почту придет письмо с темой [TrueCoach] Invitation, содержащее приглашение для доступа к приложению, где будет стоять первая тренировка.",
      "После ее прохождения тренер свяжется с вами и предоставит подробную обратную связь.",
      "Перейдите в Telegram — там вы сможете быстро связаться с поддержкой и проверить свой баланс:",
    ]),
    linkHtml("Telegram", input.telegramUrl),
    paragraphHtml([
      "Для удобства рекомендуем скачать мобильную версию приложения 👇🏻",
    ]),
    linkHtml("Ссылка для iOS:", TRUECOACH_IOS_URL),
    linkHtml("Ссылка для Андроида:", TRUECOACH_ANDROID_URL),
    paragraphHtml([
      "Также мы отправим отдельным письмом короткую инструкцию по выполнению теста силы.",
      "Пусть каждая тренировка приносит результат и удовольствие.",
    ]),
  ].join("\n");

  return { subject, html, text };
}

export function buildStrengthTestInstructionEmail(): Omit<EmailPayload, "to"> {
  const subject =
    "Краткая инструкция как выполнять тест силы от I Do Calisthenics";
  const paragraphs = [
    "Всего 5–7 упражнений (в зависимости от выбранного курса). Для каждого упражнения в приложении указано возможное количество вариаций (от 1 до 3); вам надо выбрать и выполнить только одну вариацию и один подход в каждом упражнении — ту, которая для вас не самая простая, но с которой вы уверенно справитесь (хотя бы на 2–3 повторения) 😉 Постарайтесь сделать максимальное количество качественных, красивых и контролируемых повторений выбранной вариации (это и есть «комфортный максимум»).",
    "Важно: все упражнения необходимо снять на видео и загрузить в приложение — это поможет нам определить ваш текущий уровень и составить последующие тренировки эффективно.",
    "Также важно: пожалуйста, не переживайте, если у вас что-то не получится, вы для этого и пришли к нам, чтобы укрепить свои мышцы!",
    "Например, по подтягиваниям: с нами можно заниматься с любого уровня, мы на этом и специализируемся 🙂 И любые результаты подойдут — даже просто показать, как вы висите на турнике и делаете попытки подтянуться (или ответ — что и повисеть не удалось — это тоже нормально!). Нам надо зафиксировать стартовый уровень, чтобы потом можно было сравнить ДО и ПОСЛЕ. Вы однозначно почувствуете изменения с нами, даже не сомневайтесь. Мышцы станут крепче, самочувствие лучше. Главное — стабильно тренироваться и акцентировать внимание на том, что есть результат 🤍",
  ];

  return {
    subject,
    html: paragraphHtml(paragraphs),
    text: paragraphs.join("\n\n"),
  };
}
