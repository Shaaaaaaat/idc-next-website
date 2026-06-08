import type { Metadata } from "next";

import ExercisesClient from "./ExercisesClient";

export const metadata: Metadata = {
  title: "Calisthenics Exercises — база упражнений",
  description:
    "Библиотека упражнений по калистенике: фильтры по направлению, уровню и оборудованию. Видео с источником из Яндекса.",
  alternates: { canonical: "/exercises" },
};

export default function ExercisesPage() {
  return <ExercisesClient />;
}
