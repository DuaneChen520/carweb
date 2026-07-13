# ADR-0010：全部应用窗口收敛为单一组件

- 状态：已采纳（Accepted）
- 日期：2026-07-14
- 关联：ADR-0009（数据丢失/遗忘后重同步）
- 技能流程：`/grill-with-docs`（决策锁定后落盘 ADR + 术语表）

## 背景（Context）

仓库中同时存在**两套「全部应用」窗口**，服务于两套互斥的顶层界面：

1. **① `ControlSidebar` 内部浮层**（`panelMode='apps'/'search'`）
   - 仅在 `VirtualScreen`（单屏 mirror / 单虚拟屏）可达；该模式未注入 `onOpenAppPickerFullscreen`，侧栏按钮走 `togglePanel('apps')`。
   - 独有能力：搜索框、`置顶(pin)` 模式、可拖拽、`独立解析进度条`、标题计数角标 `(N)`。
2. **② `AppPickerOverlay`**（双模式 `pane` / `fullscreen`）
   - 仅在 `DesktopScreen`（分屏桌面）渲染；侧栏按钮走 `onOpenAppPickerFullscreen`，空 pane 中央点击走 pane 模式。
   - 基于 `AppGrid`，纯网格 + 刷新按钮，无搜索 / 无置顶 / 无计数。

二者渲染同一份设备应用数据，刷新逻辑分两套，且 ① 在桌面模式下实际已不可达（其 `panelMode='apps'` 分支仅在 `VirtualScreen` 生效）。属典型历史遗留（单屏面板）与新架构（桌面浮窗）并存。

排查中另发现两类重复 / 冗余组件：
- **真重复**：`ControlSidebar` 内本地 `AppIcon`（行 20–97）与共享 `src/components/AppIcon.tsx` **逐字节相同**，但侧栏 dock 仍引用本地版。
- **孤儿组件**：`ConnectionPanel.tsx`、`DesktopView.tsx` 全仓库零引用（仅自身定义）。

## 决策（Decision）

将 ① 的功能合并进 ②，形成**单一统一组件 `AppPicker`**，并剔除 ①；同时全量清理重复 / 冗余组件。四项子决策经 grill 确认：

### D1 — 三模式统一启动落点
统一组件显式支持三种启动模式（组件内 `switch` 分发）：
- `single`：镜像 / 单虚拟屏模式 → `startApp(pkg)`（投送到单条 scrcpy 会话）。
- `pane`：桌面左 / 右半屏 → `onLaunchOnPane(pkg, pane)`。
- `fullscreen`：桌面全屏 pane（受 SessionManager 管理的 foreground 会话）→ `onLaunchFullscreen(pkg)`。

> 注意：`fullscreen` 是桌面体系内的*受管会话*，≠ 镜像模式；`single` 才是另一套独立单会话架构。二者运行时不同，故组件必须靠调用方传入的 `onLaunch` 决定投送目标。

### D2 — 保留功能集
合并 ① 的 `search` + `置顶(pin)模式` + `计数角标`；**移除** `drag`（模态居中下无意义）与 `独立解析进度条`（`AppGrid` 自带 loading / 解析处理）。
- `pin` 模式是唯一能管理应用置顶的 UI（`togglePin` 全仓库仅 ① 调用），必须保留。
- 计数角标显示已装应用总数（`getAllDeviceApps().length`，随 `appListVersion` 刷新）。

### D3 — 提升到 App 层，用 Context 触发
新建 `AppPickerContext`：
- `openAppPicker(config: AppPickerConfig)`：两屏只调 open，不各自渲染浮窗。
- `AppPickerProvider` 持有 `config | null` 状态，在 `config` 非空时于 App 层统一渲染一次 `<AppPicker>`（`z-index` 一致、单一实例、行为统一）。
- `config` 携带 `mode` + 可选 `targetPane` + `onLaunch: (pkg) => void`（启动语义由调用方提供）。

### D4 — 全量清理
- `ControlSidebar` 本地 `AppIcon` 删除，侧栏 dock 改为 `import` 共享 `AppIcon.tsx`（真重复、低风险）。
- 删除孤儿 `ConnectionPanel.tsx`、`DesktopView.tsx`（零引用）。

## 后果（Consequences）

### 正向
- 同一功能从两套实现收敛为一套，刷新逻辑、图标缓存（`cacheVersion=appListVersion`）、pin 管理全部统一。
- 浮窗在 App 层单实例渲染，`z-index` 与交互一致，避免两屏漂移。
- 删除约 130 行 ① 面板代码 + 2 个孤儿文件，降低维护面。

### 负向 / 注意
- 调用方需自行绑定 `onLaunch`（single→`startApp`、pane→`handleLaunchOnPane`、fullscreen→`handleLaunchFullscreen`）；若不传 `onLaunch` 点击无反应。
- `ControlSidebar` 的 dock 不再显示 pin 指示 / 不再支持 dock 上切换置顶；置顶管理收敛到 `AppPicker` 的 pin 模式（符合 D2）。
- 计数角标改为「总数」而非「过滤后数」，搜索激活时不随过滤变化（可接受简化）。

### 未覆盖
- `DesktopScreen` 重复注入 adb 产生的 1~2 次无害 `同步正在进行中，跳过重复调用` 日志（ADR-0009 修复遗留）本次不处理。
