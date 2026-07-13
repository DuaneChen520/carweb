# 术语表（Glossary）

> 随 ADR-0010 收敛工作建立，统一「全部应用」相关概念表述。

## 组件与界面

- **VirtualScreen**：单屏界面组件。承载 `mirror`（屏幕镜像，单条 scrcpy 会话）与单虚拟屏两种内部模式；渲染 `ControlSidebar`。
- **DesktopScreen**：分屏桌面界面组件（`displayMode==='virtual'`）。由 `SessionManager` 管理多条会话的分屏桌面，渲染 `ControlSidebar` + `DesktopShell` + 各类浮窗。
- **ControlSidebar**：常驻侧边栏（两屏共用），含返回 / 桌面 / 全屏等按钮、pinned / 常用 dock、缓存设置等。
- **dock**：侧边栏中常驻显示的应用快捷区（pinned + 常用），点击直接启动。
- **AppPicker（统一全部应用浮窗）**：ADR-0010 后唯一的全应用窗口，取代旧的 ① 面板与 ② `AppPickerOverlay`。
- **AppGrid**：应用网格组件，被 `AppPicker` 包裹；负责列表拉取、排序（`sortApps`：置顶>常用>其他）、分页、图标懒加载、手动刷新。
- **AppIcon**：单个应用图标按钮（共享 `src/components/AppIcon.tsx`）；支持 `pinMode` / `isPinned` 角标与 `cacheVersion` 缓存刷新。

## 启动落点模式（AppPickerMode）

- **single**：镜像 / 单虚拟屏模式。启动 = `startApp(pkg)`，设备端直接起该 app，镜像流中显示。
- **pane**：桌面左 / 右半屏。启动 = `onLaunchOnPane(pkg, pane)`（foreground-pane 会话）。
- **fullscreen**：桌面全屏 pane（受 `SessionManager` 管理的 foreground 会话，之后可转后台 / 拆分 / 切换）。启动 = `onLaunchFullscreen(pkg)`。

> 关键区别：`fullscreen` 仍是桌面体系内的*受管会话*，并非镜像模式。

## 行为与状态

- **pin（置顶）模式**：`AppPicker` 头部开关；开启后点击应用 = `togglePin(pkg)`（切换侧栏 dock 置顶状态），而非启动。`togglePin` 全仓库唯一管理应用置顶的入口。
- **计数角标**：`AppPicker` 标题后的 `(N)`，N = 已装应用总数（`getAllDeviceApps().length`），随 `appListVersion` 刷新。
- **appListVersion**：`useAdbStore` 中的计数器；设备应用数据变更时 bump，驱动 `AppGrid` / dock 重读列表（见 ADR-0009 反馈环修复）。
- **AppPickerContext**：`openAppPicker(config)` / `closeAppPicker()`；两屏通过它触发统一浮窗，浮窗在 App 层单实例渲染。

## 冗余 / 已清理项（ADR-0010）

- **① 全部应用面板**：`ControlSidebar` 内 `panelMode='apps'/'search'` 浮层，ADR-0010 已剔除。
- **`AppPickerOverlay`**：旧 ② 双模式浮窗，被统一 `AppPicker` 取代并删除。
- **孤儿组件**：`ConnectionPanel.tsx`、`DesktopView.tsx`（全仓库零引用），ADR-0010 已删除。
