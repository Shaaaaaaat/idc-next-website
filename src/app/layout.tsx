// src/app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { YandexMetrika } from "@/components/YandexMetrika";
import { CookieBanner } from "@/components/CookieBanner";
import { HeaderHeightVar } from "@/components/HeaderHeightVar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "optional",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "optional",
});

export const metadata: Metadata = {
  title: "I Do Calisthenics",
  description:
    "Тренировки с собственным весом в комфортном темпе и с фокусом на технике.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="bg-brand-dark overflow-x-hidden">
      <body
        className={`
          ${geistSans.variable} 
          ${geistMono.variable} 
          antialiased 
          min-h-screen 
          bg-brand-dark 
          text-white 
          overflow-x-hidden
        `}
      >
        {/* Устанавливаем CSS-переменную высоты липкого хэдера */}
        <HeaderHeightVar />

        {children}

        {/* Метрика грузится ТОЛЬКО если аналитика разрешена */}
        <YandexMetrika />

        {/* Cookie banner (справа снизу) */}
        <CookieBanner />
      </body>
    </html>
  );
}
