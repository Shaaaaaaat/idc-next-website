// src/app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { CookieConsent } from "@/components/CookieConsent";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
        {children}

        {/* Cookie banner + настройки + загрузка Метрики по согласию */}
        <CookieConsent />
      </body>
    </html>
  );
}
