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
};

export default nextConfig;
