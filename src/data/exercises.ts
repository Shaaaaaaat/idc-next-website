export type ExerciseDirection = "pullups" | "handstand" | "muscleup";
export type ExerciseEquipment = "no_bar" | "bar";
export type ExerciseLevel = "beginner" | "intermediate" | "advanced";

export type ExerciseItem = {
  id: string;
  title: string;
  videoUrl: string;
  direction: ExerciseDirection;
  equipment: ExerciseEquipment;
  level: ExerciseLevel;
  tags: string[];
  isActive: boolean;
};

export const directionLabels: Record<ExerciseDirection, string> = {
  pullups: "Подтягивания",
  handstand: "Стойка на руках",
  muscleup: "Выходы силой",
};

export const equipmentLabels: Record<ExerciseEquipment, string> = {
  no_bar: "Без турника",
  bar: "Нужен турник",
};

export const levelLabels: Record<ExerciseLevel, string> = {
  beginner: "Новичок",
  intermediate: "Тренирующийся",
  advanced: "Продвинутый",
};

// Шаблоны: замените title/videoUrl/tags на реальные данные.
export const exercises: ExerciseItem[] = [
  {
    id: "muscleup-template-1",
    title: "Выход силой",
    videoUrl: "https://storage.yandexcloud.net/idc-website-app/%D0%B1%D0%B8%D0%B1%D0%BB%D0%B8%D0%BE%D1%82%D0%B5%D0%BA%D0%B0%20%D1%83%D0%BF%D1%80%D0%B0%D0%B6%D0%BD%D0%B5%D0%BD%D0%B8%D0%B9/%D0%B2%D1%8B%D1%85%D0%BE%D0%B4%D1%8B%20%D1%81%D0%B8%D0%BB%D0%BE%D0%B9/6.5(%D0%9A%D0%B0%D1%82%D1%8F)%20%D0%B2%D1%8B%D1%85%D0%BE%D0%B4.mov",
    direction: "muscleup",
    equipment: "bar",
    level: "intermediate",
    tags: ["выход силой", "переход", "шаблон"],
    isActive: true,
  },
  {
    id: "muscleup-template-2",
    title: "Выход силой",
    videoUrl: "https://storage.yandexcloud.net/idc-website-app/%D0%B1%D0%B8%D0%B1%D0%BB%D0%B8%D0%BE%D1%82%D0%B5%D0%BA%D0%B0%20%D1%83%D0%BF%D1%80%D0%B0%D0%B6%D0%BD%D0%B5%D0%BD%D0%B8%D0%B9/%D0%B2%D1%8B%D1%85%D0%BE%D0%B4%D1%8B%20%D1%81%D0%B8%D0%BB%D0%BE%D0%B9/6.6(%D0%94%D0%B0%D1%88%D0%B0)%20%D0%BF%D0%B5%D1%80%D0%B5%D1%85%D0%BE%D0%B4%D1%8B.mov",
    direction: "muscleup",
    equipment: "bar",
    level: "intermediate",
    tags: ["выход силой", "переход", "шаблон"],
    isActive: true,
  },
  {
    id: "pullups-template-1",
    title: "Подтягивания",
    videoUrl: "https://storage.yandexcloud.net/idc-website-app/%D0%B1%D0%B8%D0%B1%D0%BB%D0%B8%D0%BE%D1%82%D0%B5%D0%BA%D0%B0%20%D1%83%D0%BF%D1%80%D0%B0%D0%B6%D0%BD%D0%B5%D0%BD%D0%B8%D0%B9/%D0%BF%D0%BE%D0%B4%D1%82%D1%8F%D0%B3%D0%B8%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F/8.5%20(%D0%94%D0%B0%D1%88%D0%B0).mov",
    direction: "pullups",
    equipment: "bar",
    level: "beginner",
    tags: ["подтягивания", "база", "шаблон"],
    isActive: true,
  },
  {
    id: "pullups-template-2",
    title: "Подтягивания",
    videoUrl: "https://storage.yandexcloud.net/idc-website-app/%D0%B1%D0%B8%D0%B1%D0%BB%D0%B8%D0%BE%D1%82%D0%B5%D0%BA%D0%B0%20%D1%83%D0%BF%D1%80%D0%B0%D0%B6%D0%BD%D0%B5%D0%BD%D0%B8%D0%B9/%D0%BF%D0%BE%D0%B4%D1%82%D1%8F%D0%B3%D0%B8%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F/%D0%90%D1%81%D1%81%D0%B8%D1%81%D1%82%D0%B8%D1%80%D0%BE%D0%B2%D0%B0%D0%BD%D0%BD%D1%8B%D0%B5.mov",
    direction: "pullups",
    equipment: "bar",
    level: "beginner",
    tags: ["подтягивания", "база", "шаблон"],
    isActive: true,
  },
  {
    id: "handstand-template-1",
    title: "Стойка на руках",
    videoUrl: "https://storage.yandexcloud.net/idc-website-app/%D0%B1%D0%B8%D0%B1%D0%BB%D0%B8%D0%BE%D1%82%D0%B5%D0%BA%D0%B0%20%D1%83%D0%BF%D1%80%D0%B0%D0%B6%D0%BD%D0%B5%D0%BD%D0%B8%D0%B9/%D1%81%D1%82%D0%BE%D0%B9%D0%BA%D0%B0%20%D0%BD%D0%B0%20%D1%80%D1%83%D0%BA%D0%B0%D1%85/8.3%20(%D0%94%D0%B0%D1%88%D0%B0)%20%D1%83%D0%BF%D1%80%D0%B0%D0%B6%D0%BD%D0%B5%D0%BD%D0%B8.mov",
    direction: "handstand",
    equipment: "no_bar",
    level: "beginner",
    tags: ["стойка", "баланс", "шаблон"],
    isActive: true,
  },
];
