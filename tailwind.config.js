/** @type {import('tailwindcss').Config} */

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      fontFamily: {
        // 全局唯一字体：阿里巴巴普惠体 3.0（Alibaba PuHuiTi 3.0），自托管于
        // /public/fonts/puhuiti/，覆盖 Latin + CJK；离线车机环境无外链依赖。
        // 仅保留 sans-serif 作为最后的通用回退（mono 同样指向该字体）。
        sans: ["Alibaba PuHuiTi 3.0", "sans-serif"],
        mono: ["Alibaba PuHuiTi 3.0", "sans-serif"],
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
        // 语义化设计变量 (Design Tokens) - 遵循 DTCG 与座舱人机工效规范
        surface: {
          base: "#0f172a",      // 主背景：深邃 Slate-900，杜绝夜间纯黑眩光
          card: "#1e293b",      // 卡片/容器层：Slate-800，承载主要内容
          elevated: "#334155",  // 浮层/模态框：Slate-700，高层级对比
          hover: "#283548",     // 悬浮/激活交互表面
        },
        content: {
          primary: "#f8fafc",   // 主文本/重要图标：Slate-50，高对比度但非刺眼纯白
          secondary: "#94a3b8", // 次要说明/辅助标签：Slate-400，清晰克制
          muted: "#64748b",     // 占位符/微弱边框：Slate-500
        },
        feedback: {
          success: "#10b981",   // 稳定绿色
          warning: "#f59e0b",   // 琥珀警告
          danger: "#ef4444",    // 警示/断开
          info: "#0ea5e9",      // 辅助提示
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
