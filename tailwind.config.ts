import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        dvivid: {
          // Primary — Phase 35 design system
          primary: "#2563EB",
          "primary-hover": "#1D4ED8",
          "primary-light": "#EFF6FF",
          "primary-border": "#D6E4FF",
          // Semantic
          success: "#159455",
          "success-light": "#E6F7EF",
          warning: "#D97706",
          "warning-light": "#FEF3E2",
          error: "#D14343",
          "error-light": "#FDECEC",
          // Surfaces
          "page-bg": "#F7F9FC",
          surface: "#FFFFFF",
          "surface-alt": "#FAFBFD",
          // Text
          "text-primary": "#25324B",
          "text-secondary": "#66758F",
          "text-muted": "#8A97AD",
          // Borders
          border: "#DCE3EE",
          "border-light": "#EEF1F6",
          // Legacy aliases (for backward compat with existing pages)
          blue: "#2563EB",
          "blue-light": "#1D4ED8",
          "blue-lighter": "#EFF6FF",
          accent: "#2563EB",
          "accent-light": "#3B82F6",
          red: "#D14343",
          "red-light": "#FDECEC",
          dark: "#25324B",
          gray: "#F7F9FC",
          "border-legacy": "#DCE3EE",
          "text-tertiary": "#8A97AD",
        },
      },
      borderRadius: {
        card: "20px",
        input: "11px",
        button: "10px",
      },
      boxShadow: {
        card: "0 1px 3px 0 rgba(37,50,75,0.04), 0 1px 2px 0 rgba(37,50,75,0.02)",
        "card-hover": "0 4px 16px 0 rgba(37,50,75,0.06), 0 2px 6px 0 rgba(37,50,75,0.03)",
        cta: "0 2px 8px 0 rgba(37,99,235,0.18)",
        focus: "0 0 0 3px rgba(37,99,235,0.12)",
      },
      spacing: {
        card: "28px",
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        "page-title": ["30px", { lineHeight: "38px", fontWeight: "700" }],
        "section-title": ["22px", { lineHeight: "28px", fontWeight: "600" }],
        "card-title": ["18px", { lineHeight: "24px", fontWeight: "600" }],
      },
    },
  },
  plugins: [],
};
export default config;
