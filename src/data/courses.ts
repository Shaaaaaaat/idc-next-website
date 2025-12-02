// src/data/courses.ts
export const courseNames = [
    "Calisthenics Light",
    "Super Calisthenics",
    "Подтягивания для девушек",
    "Стойка на руках",
    "Калистеника для кроссфитеров",
  ] as const;
  
  export type CourseName = (typeof courseNames)[number];
  