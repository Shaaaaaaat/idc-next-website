import type { EmailPayload } from "./types.ts";

const TRUECOACH_IOS_URL =
  "https://apps.apple.com/am/app/truecoach-for-clients/id1439127794";
const TRUECOACH_ANDROID_URL =
  "https://play.google.com/store/apps/details?id=co.truecoach.client";
const MANAGER_TELEGRAM_URL = "http://t.me/idc_manager";

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

function displayCourseName(value: string) {
  const cleaned = textValue(value, 160);
  const normalized = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, "_");

  if (normalized === "light" || normalized.endsWith("_light")) {
    return "Calisthenics Light";
  }
  if (normalized === "classic" || normalized.endsWith("_classic")) {
    return "Calisthenics Classic";
  }
  if (normalized === "pullups" || normalized.endsWith("_pullups")) {
    return "Pull-Ups";
  }
  if (normalized === "handstand" || normalized.endsWith("_handstand")) {
    return "Handstand";
  }
  if (normalized === "crossfit" || normalized.endsWith("_crossfit")) {
    return "CrossFit";
  }

  return cleaned;
}

function isTechnicalTariffLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "online_test" ||
    normalized === "gift_certificate" ||
    normalized.startsWith("package_") ||
    normalized.startsWith("short") ||
    normalized.startsWith("long");
}

function displayTariffOrCourse(tariffLabel: string, courseName: string) {
  const tariff = textValue(tariffLabel, 160);
  if (tariff && !isTechnicalTariffLabel(tariff)) {
    return displayCourseName(tariff);
  }

  return displayCourseName(courseName || tariff);
}

function emailShell(content: string) {
  return [
    '<div style="margin:0;padding:24px 0;background:#f5f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">',
    '<div style="max-width:640px;margin:0 auto;padding:0 16px;">',
    '<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;padding:28px;box-shadow:0 8px 28px rgba(15,23,42,0.08);">',
    content,
    "</div>",
    "</div>",
    "</div>",
  ].join("\n");
}

function paragraphHtml(lines: string[]) {
  return lines
    .map((line) =>
      `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;">${
        escapeHtml(line)
      }</p>`
    )
    .join("\n");
}

function buttonHtml(label: string, href: string) {
  const safeHref = escapeHtml(href);
  return [
    '<p style="margin:18px 0 24px;">',
    `<a href="${safeHref}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;line-height:1.2;padding:14px 22px;border-radius:999px;">${
      escapeHtml(label)
    }</a>`,
    "</p>",
  ].join("");
}

function mutedCardHtml(content: string) {
  return [
    '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:18px 18px 4px;margin:0 0 16px;">',
    content,
    "</div>",
  ].join("\n");
}

function importantCardHtml(content: string) {
  return [
    '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;padding:18px 18px 4px;margin:0 0 16px;">',
    content,
    "</div>",
  ].join("\n");
}

function emphasizeImportantPrefix(line: string) {
  if (!line.startsWith("Важно:")) return escapeHtml(line);

  return `<strong>Важно:</strong>${escapeHtml(line.slice("Важно:".length))}`;
}

function instructionParagraphHtml(line: string) {
  return `<p style="margin:0 0 16px;font-size:16px;line-height:1.65;">${
    emphasizeImportantPrefix(line)
  }</p>`;
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
  const courseName = displayCourseName(input.courseName || input.tariffLabel);
  const tariffLabel = displayTariffOrCourse(
    input.tariffLabel,
    input.courseName,
  );
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

  const html = emailShell([
    paragraphHtml([
      greeting,
      durationLine,
      "В течение 24 часов на вашу почту придет письмо с темой [TrueCoach] Invitation, содержащее приглашение для доступа к приложению, где будет стоять первая тренировка.",
      "После ее прохождения тренер свяжется с вами и предоставит подробную обратную связь.",
      "Перейдите в Telegram — там вы сможете быстро связаться с поддержкой и проверить свой баланс:",
    ]),
    buttonHtml("Перейти в Telegram", input.telegramUrl),
    paragraphHtml([
      "Для удобства рекомендуем скачать мобильную версию приложения 👇🏻",
    ]),
    buttonHtml("Скачать для iOS", TRUECOACH_IOS_URL),
    buttonHtml("Скачать для Android", TRUECOACH_ANDROID_URL),
    paragraphHtml([
      "Также мы отправим отдельным письмом короткую инструкцию по выполнению теста силы.",
      "Пусть каждая тренировка приносит результат и удовольствие.",
    ]),
  ].join("\n"));

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

  const html = emailShell([
    mutedCardHtml(instructionParagraphHtml(paragraphs[0])),
    importantCardHtml(instructionParagraphHtml(paragraphs[1])),
    importantCardHtml(instructionParagraphHtml(paragraphs[2])),
    mutedCardHtml(instructionParagraphHtml(paragraphs[3])),
  ].join("\n"));

  return {
    subject,
    html,
    text: paragraphs.join("\n\n"),
  };
}

export function buildFirstLessonFollowupEmail(): Omit<EmailPayload, "to"> {
  const subject = "🎉 Поздравляем с первой тренировкой!";
  const paragraphs = [
    "Ура! Начало пути в калистенике положено 🎉",
    "Надеемся, тебе всё понравилось 😊",
    "Если ты хочешь продолжить тренировки, выбери удобный вариант:",
    "1. Свяжись с нашим менеджером Никитой — он ответит на вопросы и поможет подобрать подходящий формат занятий:",
    MANAGER_TELEGRAM_URL,
    "2. Или сразу приобрети новый тариф на нашем сайте.",
    "Будем рады видеть тебя снова на тренировках! 💪",
  ];

  const html = emailShell([
    paragraphHtml([
      paragraphs[0],
      paragraphs[1],
      paragraphs[2],
    ]),
    mutedCardHtml(paragraphHtml([
      "Свяжись с нашим менеджером Никитой — он ответит на вопросы и поможет подобрать подходящий формат занятий.",
    ])),
    buttonHtml("Связаться с Никитой", MANAGER_TELEGRAM_URL),
    paragraphHtml([
      paragraphs[5],
      paragraphs[6],
    ]),
  ].join("\n"));

  return {
    subject,
    html,
    text: paragraphs.join("\n\n"),
  };
}

export function buildSubscriptionWrOffClientEmail(): Omit<EmailPayload, "to"> {
  const subject = "💙 Ждём тебя снова на тренировках";
  const paragraphs = [
    "Привет!",
    "Твой абонемент закончился 💔",
    "Спасибо, что тренировался вместе с нами! Надеемся, занятия были полезными и помогли приблизиться к твоим целям.",
    "Если у тебя остался положительный баланс или ты хочешь продолжить тренировки, свяжись, пожалуйста, с нашим менеджером Никитой:",
    MANAGER_TELEGRAM_URL,
    "Он поможет проверить баланс, подобрать подходящий формат занятий и ответит на вопросы.",
    "Будем рады видеть тебя снова! 💪",
  ];

  const html = emailShell([
    paragraphHtml([
      paragraphs[0],
      paragraphs[1],
      paragraphs[2],
      paragraphs[3],
    ]),
    buttonHtml("Связаться с Никитой", MANAGER_TELEGRAM_URL),
    paragraphHtml([
      paragraphs[5],
      paragraphs[6],
    ]),
  ].join("\n"));

  return {
    subject,
    html,
    text: paragraphs.join("\n\n"),
  };
}
