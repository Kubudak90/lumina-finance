import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          cyan: "#06b6d4",
          blue: "#3b82f6",
          dark: "#0c1222",
          card: "#0f172a",
          border: "rgba(6, 182, 212, 0.1)",
        },
        success: "#4ade80",
        danger: "#ef4444",
        warning: "#facc15",
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;
