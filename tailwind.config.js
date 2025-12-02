/** @type {import('tailwindcss').Config} */
const plugin = require('tailwindcss/plugin');
module.exports = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#D81696",   // твой фиолетовый — ГЛАВНЫЙ
          blue: "#1A3BFF",      // второстепенный синий
          dark: "#050816",
          light: "#F5F6FF",
          accent: "#7CFFB2",    // лаймовый
          muted: "#9CA3AF",
        },
      },
      borderRadius: {
        "3xl": "1.75rem",
        "4xl": "2.5rem",
      },
      boxShadow: {
        soft: "0 18px 50px rgba(26,59,255,0.25)",
      },
      maxWidth: {
        container: "1120px",
      },
    },
  },
  plugins: [
    plugin(function ({ addBase }) {
      addBase({
        "@keyframes fade-up": {
          "0%": { opacity: "0", transform: "translateY(1rem)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      });
    }),
  ],
};

