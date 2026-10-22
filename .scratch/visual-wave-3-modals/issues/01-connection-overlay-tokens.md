# Issue 01: 重构 ConnectionOverlay 语义 Token 与触控工效

Status: resolved
Type: task

## Comments

- `src/components/ConnectionOverlay.tsx`：
  - 遮罩层全量迁移至 `bg-surface-base/80 backdrop-blur-xl`；
  - 标题、描述与状态文字全部替换为 `text-content-primary`、`text-content-secondary`、`text-content-muted`；
  - 模式选择按钮、已配对设备整行与忘记按钮、Tab 栏、无线二级切换栏、配对指南卡、输入框、二维码文本域与主 CTA 按钮全面适配 `surface.elevated/95`、`surface.card`、`surface.base` 等语义 Token；
  - 触控靶区全面满足 $\ge 48\times 48\text{px}$ 规范与 $\ge 8\text{px}$ 防误触间距；
  - 现有 3 个测试持续通过，`npm run check` 与 `npm run lint` 全绿。
