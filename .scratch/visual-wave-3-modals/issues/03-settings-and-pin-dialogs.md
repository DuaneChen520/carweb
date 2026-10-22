# Issue 03: 重构 CacheSettingsDialog 与 PinDialog

Status: resolved
Type: task

## Comments

- `src/components/CacheSettingsDialog.tsx`：
  - 遮罩层与模态外框升级为座舱微毛玻璃：`bg-surface-elevated/95 backdrop-blur-xl border border-surface-card rounded-2xl shadow-float`；
  - 顶栏关闭按钮升级为 48x48px 触控区（`w-12 h-12 flex items-center justify-center rounded-xl`）；
  - 单项清除按钮（图标/偏好）扩充至 `min-h-[44px]`，二次确认按钮与取消按钮高度对齐 `min-h-[44px]`，防误触间距 $\ge 8\text{px}$；
  - 底部“清理所有设备数据”与“关闭”按钮全部达到 `min-h-[48px]`；
  - 消除全部 Slate 裸色，对齐 `surface.*` 与 `content.*` 语义体系。
- `src/components/PinDialog.tsx`：
  - 浮窗背景升级为座舱冷调微毛玻璃（`bg-surface-elevated/95 border border-surface-card rounded-2xl shadow-float`）；
  - 数字键盘按键升级为 `bg-surface-card hover:bg-surface-elevated active:bg-surface-base text-content-primary border border-surface-card`，尺寸保证 48px 高度（`h-12`）与防误触间距；
  - 底部“忘记 PIN”与“返回/取消”按钮升级为 `min-h-[48px]` 友好触控行。
- 类型检查与现有全量测试通过。
