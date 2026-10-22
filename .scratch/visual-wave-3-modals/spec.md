# Feature Spec: Wave 3 模态浮层与连接遮罩视觉与触控工效重构

## 背景与目的

基于 ADR-0018（座舱视觉体系）、ADR-0019（车载触控人机工效与材质分层）和 `CODING_STANDARDS.md`，Wave 1（常驻外壳与 Dock 区）和 Wave 2（多窗流媒体区）已全部完成重构与测试并合入 master。

本特性推进 Wave 3：模态浮层、启动选择器与连接遮罩区的系统化重构，完成全项目视觉 Token 化与触控工效闭环。

## 适用范围

1. `src/components/ConnectionOverlay.tsx`：连接遮罩全界面（等待、重连、引导、免线配对、局域网直连、已配对设备管理）；
2. `src/components/AppPicker.tsx` & `src/components/AppGrid.tsx`：应用抽屉浮层、搜索栏、置顶管理、网格与滚动触控；
3. `src/components/CacheSettingsDialog.tsx` & `src/components/PinDialog.tsx`：偏好与缓存清理对话框、启动 PIN 拨号盘；
4. 配套自动化测试及全量门禁检验。

## 核心设计与工效准则

1. **材质统一**：
   - 全浮层与模态外框采用 **座舱冷调微毛玻璃 (Translucent Cockpit Glass)**：`bg-surface-elevated/95 backdrop-blur-xl border border-surface-card rounded-2xl shadow-float`；
   - 遮罩采用 `bg-surface-base/80 backdrop-blur-xl`；
2. **色值 Token 化**：
   - 彻底清除 Slate/Gray 裸色与裸白色；
   - 背景使用 `surface.base`、`surface.card`、`surface.elevated`；
   - 文本使用 `content.primary`、`content.secondary`、`content.muted`；
   - 品牌高亮与反馈使用 `accent.*`、`emerald-*`、`red-400`、`amber-400`；
3. **触控与尺寸下限**：
   - 每一个可交互操作按钮点击靶区必须 $\ge 48\times 48\text{px}$（`w-12 h-12` 或 `min-h-[48px]`），相邻控件间距 $\ge 8\text{px}$（`gap-2`）；
   - 整行列表项（设备列表、缓存项操作）保证整行触控或独立 48px 操作按钮；
   - 文字下限严格保证 $\ge 12\text{px}$（`text-xs`），消除所有微型不可读字体。

## 任务拆解 (Issues)

- `01-connection-overlay-tokens.md`：重构 ConnectionOverlay 全量 Token 与触控工效，保证现有 8 个无线连接测试全绿。
- `02-app-picker-and-grid.md`：重构 AppPicker 与 AppGrid（浮窗冷调玻璃材质、顶栏 48px 控制按钮、输入框 Token 化、网格指示器）。
- `03-settings-and-pin-dialogs.md`：重构 CacheSettingsDialog 与 PinDialog（清理操作 List Row 触控扩充、PIN 拨号键与取消按钮触控工效）。
- `04-wave-3-automated-tests.md`：补全新组件的视觉与工效断言测试。
- `05-standards-review-and-merge.md`：全量门禁检查（test, check, lint）及代码审查，合入 master。
