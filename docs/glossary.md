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

## 虚拟屏渲染与方向（ADR-0011）

- **captureOrientation**：scrcpy 4.x 采集方向选项（官方 CLI 为 `--capture-orientation`）。决定"发送到电脑的视频帧方向"，即 canvas 帧尺寸的来源层。
  - **Unlocked**（协议值 0，无 `@`）：采集**跟随**设备/显示旋转 → app 启动旋转显示即翻转视频帧 → 触发 canvas 清屏白闪。carweb 虚拟屏路径原错用此项（`scrcpy-session.ts:335`）。
  - **LockedInitial**（协议值 1，CLI `@`）：采集方向**锁定到初始方向**（虚拟屏创建时的方向），显示旋转不改变采集帧方向 → 无翻转。scrcpy 默认值（平板/镜像路径即此行为）。
- **canvas-clear（清屏）**：`canvas.width=w; canvas.height=h` 赋值会清空 canvas 为透明（`scrcpy-session.ts:422-425`）。每当视频帧尺寸变化（`flex-client.ts` 的 `onSessionPacket`）即触发，是白闪的直接来源；透明 canvas 透出浅色容器即"白屏"。
- **flex-display resize（尺寸变化）**：`flexDisplay` 开启时，`SplitPane` 的 `ResizeObserver` 经 `flex-client` 防抖（150ms）向设备发 `RESIZE_DISPLAY`，把虚拟屏尺寸改为容器尺寸。尺寸变化同样触发 canvas-clear → 白闪（与方向锁无关，故 `LockedInitial` 修不了）。
- **统一过渡占位（transition placeholder）**：ADR-0011 的 D2——浅色背景 + 居中应用图标，作为**启动**与**尺寸变化**两类过渡的统一动画（参考 HyperOS 分屏 resize 占位）；canvas 无有效帧/过渡中显示，有效帧到达淡出。由 `AppTransitionPlaceholder.tsx` 实现，取代已删除的零引用死代码 `AppLaunchingOverlay.tsx`。
- **setRotationLocked(adb)**：Android 层旋转锁（`scrcpy-session.ts:392`，`try/catch` 防护），阻止虚拟屏被 app 转走，使方向不符 app 正立留黑边；`LockedInitial` 为其采集层双保险。

## 音频（ADR-0013）

- **AudioContext 手势唤醒**：浏览器自动播放策略要求 `AudioContext.resume()` 必须在用户手势内同步调用。`VirtualScreen` 在其 pointer 处理器内调 `resumeAudio()`（单屏镜像模式出声）；分屏桌面由 `DesktopScreen` 顶层持久化 `pointerdown`/`keydown` 监听统一唤醒 `SessionManager` 所有 session 的 `AudioContext`（ADR-0013）。
- **resumeAudio()**：`ScrcpySession` 方法（`scrcpy-session.ts:934`），仅当 `AudioContext` 为 `suspended` 时调用 `resume()`，幂等；音频流不可用（`audioCtx` 未建）时为 no-op。
- **useCanvasPointerInput**：分屏/全屏桌面的触控 hook，把容器 div 的 pointer 事件路由到对应 session 的 `injectTouch`；本身不负责音频唤醒（音频唤醒交由 `DesktopScreen` 的全局监听统一处理，ADR-0013）。

## 应用显示名解析（ADR-0012）

- **displayName（应用显示名）**：顶部下拉（`PaneDropdown`/`FullscreenDropdown`）、分屏选择（`PaneSelector`）、活动进程（`ActivityManagerPanel`）、启动占位（`AppTransitionPlaceholder`）、应用网格（`AppGrid`）、侧栏 dock（`ControlSidebar`）中展示给用户的应用名称。
- **AppInfo.label**：设备端 `AppInfoFetcher.java` 解析出的应用真实名称（如"微信"），经 `app-info-service.parseAllApps` 缓存于 IndexedDB。是 displayName 的**唯一数据源**。
- **AppInstance.appLabel（已弃用）**：`AppInstance` 可选字段，原意图"由 UI 层在 launch 时填充"。因启动调用点（`DesktopScreen.tsx` 的 `launchOnPane`/`launchFullscreen`）从未传入，且写入后不随缓存刷新、跨 resume/backgroundify 易失配，ADR-0012 起不再作为显示名来源。
- **getCachedAppLabels(pkgs)**：`ScrcpyContext` 暴露的批量解析接口（`useAppManager` → `app-info-service`），按包名返回 `Map<pkg,label>`。
- **渲染时解析（pull 模型）**：ADR-0012 决策——所有 displayName 在**渲染时**经 `useAppDisplayName(pkg)` / `useAppLabels(pkgs)` 按包名查 `getCachedAppLabels` 获得；单一数据源、自动随缓存刷新、覆盖所有启动入口（选择器/侧栏/媒体/NowPlaying）。
- **兜底规则**：label 缺失（首次启动、设备未扫完）时显示**完整包名**（如 `com.tencent.mm`），不再用末段缩写（`com.tencent.mm → mm`）——后者不可读，已于 ADR-0012 全面废弃。

## 冗余 / 已清理项（ADR-0010）

- **① 全部应用面板**：`ControlSidebar` 内 `panelMode='apps'/'search'` 浮层，ADR-0010 已剔除。
- **`AppPickerOverlay`**：旧 ② 双模式浮窗，被统一 `AppPicker` 取代并删除。
- **孤儿组件**：`ConnectionPanel.tsx`、`DesktopView.tsx`（全仓库零引用），ADR-0010 已删除。
