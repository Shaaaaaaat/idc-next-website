import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Минимальный набор для standalone-режима и React Compiler
  output: "standalone",
  reactCompiler: true,
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.idocalisthenics.ru" }],
        destination: "https://idocalisthenics.ru/:path*",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/mobile/consume",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
