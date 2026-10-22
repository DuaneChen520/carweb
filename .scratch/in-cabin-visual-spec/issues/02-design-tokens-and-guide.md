# 02: 建立语义化设计变量与详尽规范手册 (Design Tokens & Guide)

**What to build:** 扩展 `tailwind.config.js`，将原本孤立的颜色扩展为系统化的语义设计变量（Surface 阶梯、文本层级、反馈状态），并在 `docs/design/visual-spec.md` 中编写详尽的视觉与排版设计手册，使开发者与 Agent 可以直接通过语义类名构建界面。

**Blocked by:** 01 (建立根标准文件与架构决策记录)

**Status:** resolved

- [x] 在 `tailwind.config.js` 中扩充语义颜色体系：`surface`（base / card / elevated）、`text`（primary / secondary / muted）、`feedback`
- [x] 确保与现有的 `accent` 阶梯、普惠体 3.0 以及冷调投影配置无缝兼容
- [x] 撰写 `docs/design/visual-spec.md` 手册，详细规定色彩阶梯、字体使用场景、交互反馈曲线与防抖动准则
- [x] 运行 `npm run check` 验证构建与类型配置正常无破坏
