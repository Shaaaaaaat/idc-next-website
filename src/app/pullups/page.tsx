import type { Metadata } from "next";

import PullupsLandingClient from "./PullupsLandingClient";

export const metadata: Metadata = {
  title: "Подтягивания для девушек — онлайн-программа",
  description:
    "Простая онлайн-программа для девушек, чтобы научиться подтягиваться с нуля: индивидуальный план, поддержка тренера и чат участниц.",
  alternates: { canonical: "/pullups" },
};

export default function PullupsPage() {
  return <PullupsLandingClient />;
}
