// src/data/courses.ts
export const courseNames = [
    "Calisthenics Light",
    "Calisthenics Classic",
    "Подтягивания для девушек",
    "Стойка на руках",
    "Калистеника для кроссфитеров",
  ] as const;
  
  export type CourseName = (typeof courseNames)[number];
  