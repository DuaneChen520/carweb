# Issue 01: 重构 ControlSidebar 常驻外壳与 List Row 整行设置面板

Status: resolved

## Comments

- 已将侧栏根容器迁移至 `bg-surface-base border-r border-surface-card select-none`。
- Dock 应用项间距锁死至 `gap-2`（8px）。
- 活动进程角标升级为 `text-xs min-w-5 h-5 px-1 bg-accent-500 text-content-primary shadow-accent-glow font-medium`。
- 设置二级弹窗拓宽至 `w-64`（256px），背景采用 `bg-surface-elevated/95 backdrop-blur-xl border border-surface-card rounded-2xl shadow-float`。
- 所有设置项升级为 `min-h-[48px]` 的车机 List Row 整行触控，彻底杜绝 `text-[10px]` 与微型药丸按钮。
- `npm run check` 与 `npm run lint` 全部通过。
Type: task

## 目标

依据 ADR-0018、ADR-0019 与 `CODING_STANDARDS.md`，对 `src/components/ControlSidebar.tsx` 执行人机工效与 Token 重构：
1. 侧栏根容器使用 `bg-surface-base border-r border-surface-card`，消除 `bg-slate-950`；
2. Dock 应用列表间距保持 `gap-2`（8px），分割线使用 `bg-surface-elevated/60`；
3. 活动进程数量角标从 `text-[9px] w-4 h-4` 提升为 `text-xs min-w-5 h-5 px-1 bg-accent-500 text-content-primary shadow-accent-glow font-medium`；
4. 设置面板（`showSettings`）宽度从 `w-44`（176px）拓宽为 `w-64`（256px），背景采用 `bg-surface-elevated/95 backdrop-blur-xl border border-surface-card rounded-2xl shadow-float z-50 p-2 space-y-1`；
5. 设置面板内部项全部重构为车机原生 **List Row 整行触控**（最小高度 $\ge 48\text{px}$）：
   - 缓存大小展示行
   - 键盘模式切换行（点击整行切换）
   - 启动 PIN 行（点击整行调起设置或更改）
   - 音频输出切换行（点击整行切换浏览器/手机）
   - 显示模式切换行（点击整行切换镜像/虚拟屏）
   - 画质选择行（整行排版，下拉框样式 Token 化）
   - 缓存设置操作行（整行高亮与点击）
6. 彻底清除组件内所有的裸色和 `text-[10px]`。
