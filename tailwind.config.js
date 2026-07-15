/** @type {import('tailwindcss').Config} */

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      fontFamily: {
        // Latin/数字用 Outfit（有性格的几何 grotesk），CJK 回退到系统字体，
        // 保证离线车机环境下优雅降级。
        sans: [
          "Outfit",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "PingFang SC",
          "Microsoft YaHei",
          "Noto Sans SC",
          "Helvetica",
          "Arial",
          "sans-serif",
          "Apple Color Emoji",
          "Segoe UI Emoji",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      colors: {
        // 单一考究强调色：沉稳、略去饱和的深邃 azure，取代通用 AI 蓝。
        // 与原 blue 同属蓝系但更克制，全局统一为唯一强调色。
        accent: {
          50: "#eef4ff",
          100: "#dce7fe",
          200: "#bcd0fc",
          300: "#8fb0f8",
          400: "#5b8def",
          500: "#2f6ae6",
          600: "#1f52c4",
          700: "#1a44a0",
          800: "#193b83",
          900: "#19336c",
        },
      },
      borderRadius: {
        // 分层圆角尺度：内层紧、容器松。
        xl: "0.875rem",
        "2xl": "1.125rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        // 着色阴影：带蓝黑冷调，取代通用纯黑，营造统一光源纵深。
        card: "0 1px 2px rgba(19, 31, 55, 0.06), 0 8px 24px -8px rgba(19, 31, 55, 0.14)",
        "card-hover":
          "0 2px 4px rgba(19, 31, 55, 0.08), 0 16px 40px -12px rgba(19, 31, 55, 0.22)",
        float:
          "0 8px 32px -8px rgba(15, 23, 42, 0.28), 0 2px 8px -2px rgba(15, 23, 42, 0.16)",
        "accent-glow": "0 8px 24px -6px rgba(47, 106, 230, 0.45)",
      },
      keyframes: {
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%, 60%": { transform: "translateX(-6px)" },
          "40%, 80%": { transform: "translateX(6px)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        shake: "shake 0.35s cubic-bezier(0.36, 0.07, 0.19, 0.97)",
        "fade-in": "fade-in 0.2s ease-out",
        "scale-in": "scale-in 0.18s cubic-bezier(0.23, 1, 0.32, 1)",
        "slide-up": "slide-up 0.22s cubic-bezier(0.23, 1, 0.32, 1)",
      },
    },
  },
  plugins: [],
};
