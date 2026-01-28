import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        "midnight": {
          950: "#050811",
          900: "#0A0F1D",
          800: "#0D1425",
          700: "#161F35",
          600: "#1E293B",
        },
        "silver": {
          DEFAULT: "#E2E8F0",
          400: "#94A3B8",
          200: "#CBD5E1",
        }
      },
      fontFamily: {
        "sans": ["Inter", "sans-serif"],
        "serif": ["Source Serif 4", "serif"],
      }
    },
  },
  plugins: []
};

export default config;

