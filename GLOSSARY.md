# CarWeb 领域术语表

> **事实源声明**：本文件（`GLOSSARY.md`）是项目领域词汇的单一事实源，以 `src/` 下**当前代码**为准编写，不依赖早期 ADR 或旧设计文档。
> 若本文件与代码冲突，以代码为准。如某术语涉及「已决定但未落地」的决策，会显式标注。
> 每个术语用 `_Avoid_` 列出本项目不采用的同义词；新术语按此格式追加。
> **引用约定**：只写文件名与符号名，不写行号——行号会随代码变动而失效。
> 2026-10-22 起，原 `docs/glossary.md` 的界面与音频术语并入本文件，该文件已删除。

## 架构总览

CarWeb 是基于 **WebADB + Scrcpy** 的车机投屏 Web 应用：通过浏览器（WebUSB / WiFi）连接 Android 手机，
在车机浏览器内创建独立虚拟显示屏并运行手机应用，支持分屏与全屏切换。三层结构：

- **连接层**：`useAdbStore`（Zustand）维护 `connectionStatus` 状态机
  （`idle / connecting / connected / disconnected / error`）；`useUsbConnection` / `useWifiConnection` 负责建立连接。
  USB 自动重连走 `retryConnectUsb`（`src/lib/usb-connect.ts`），采用固定退避序列 `[0, 500, 1200, 2000]`ms
  覆盖「页面刷新后手机端 adbd 旧连接未释放」的竞态（`src/lib/usb-retry.ts`）。
- **会话层**：`ScrcpySession`（`src/lib/scrcpy-session.ts`）——可实例化的单会话管理类，持有 canvas、
  视频/音频解码器、控制通道、server PID；用 `withLaunchMutex` 串行化 `pushServer + start` 临界区，
  避免多会话并发争夺同一 `localabstract:scrcpy` 反向隧道。
  **单屏 `VirtualScreen`（mirror 模式）经 `useScrcpySession`（`src/hooks/scrcpy/useScrcpySession.ts`）
  薄适配器复用同一 `ScrcpySession` 类**（架构评审候选 1 收口，2026-07-09）：hook 仅保留 React 层关注点
  （应用管理 `useAppManager`、IME 软键盘、设备级屏控、链路监督 `LinkSupervisor`），传输核心全部委托给类。
  此收口消除了与 `DesktopScreen` 路径的重复实现，并让镜像路径自动获得类已实现的能力
  （每会话独立 `scid`、`withLaunchMutex`、15s 启动超时、以及虚拟屏 `vdSystemDecorations:false` 修复）。
- **编排层**：`SessionManager`（`src/lib/session-manager.ts`，Zustand）——统一管理所有 `ScrcpySession`
  实例、app 运行时状态机、displayId 池。分屏桌面设计见 `docs/plans/2026-07-05-split-desktop-design.md`。
  **启动活性门禁（2026-07-09）**：`launchOnPane/launchFullscreen/_restartSession` 经 `getLiveAdb()`
  取 adb——仅当 `useAdbStore.connectionStatus === 'connected'` 才视为存活，否则返回 null 并拒绝启动。
  拦截「adb 引用非空但底层 transport 已死」的竞态，避免对死连接 `ScrcpySession.start` 触发
  `AdbScrcpyExitedError: scrcpy server exited prematurely`。

## 无线连接与桥接代理（WiFi 路径）

车机浏览器无法直接建立到手机 5555 端口的 TCP 连接（无 raw socket），因此无线投屏依赖一个跑在**车机本机**的
轻量 Go 桥接代理 `bridge/main.go`（tiny-bridge，默认监听 8080）。

- **桥接代理端点**（`bridge/main.go` 文件头注释为唯一出处）：
  - `/adb/{target}`——WebSocket ↔ TCP 双向桥接，把浏览器流量转发到手机 ADB 端口（5555）。
  - `/pair`——ADB 无线配对握手（TLS 密钥协商 + SPAKE2 + AES-128-GCM）。
  - `/scan/{subnet}`——扫描指定网段内开放的 5555 端口，用于局域网发现设备。
- **浏览器侧模块**：
  - `src/lib/websocket-device.ts`：`AdbDaemonWebSocketDevice`，连接 `ws://{host}:8080/adb/{targetHost}:{targetPort}`，
    默认指向车机本机（`localhost:8080`）。
  - `src/lib/websocket-stream.ts`：把 WebSocket 二进制帧与 ADB 包互相转换（`AdbPacket` / `AdbPacketHeader`），
    并用 `@yume-chan/struct` 的 `Uint8ArrayExactReadable` 做定长读取。
  - `src/lib/adb-pairing.ts`：`parseAdbQrCode` 解析「无线调试」二维码，`pairWithDevice` 走 `/pair` 完成配对。
  - `src/hooks/useWifiConnection.ts`：连接层入口，负责扫描、解析二维码、配对、建连。
- **USB 路径**（对照）：`useUsbConnection` + `@yume-chan/adb-daemon-webusb`（WebUSB 传输），
  ADB 私钥由 `@yume-chan/adb-credential-web` 存 IndexedDB。
- **关键约束**：无线路径**必须先在车机上运行桥接代理**，否则扫描与配对都无从发起。

_Avoid_: 无线投屏、WiFi 投屏（指整条链路时）、tiny-bridge（指代整个方案时）。

## 链路监督（LinkSupervisor）

端到端链路健康与重连的单一深模块（`src/lib/link-supervisor.ts`，纯 TS 类、框架无关、可单测）。
由架构评审候选 2 深化引入，演进 ADR-0005（ControllerHealth 从「仅 control-socket」扩为「整条链路」）。

_Avoid_: 健康检查、重连管理器、断线监控。

- **范围**：管「连接建立之后」的链路健康与重连；初始 USB 建连（`useUsbConnection` 的 `retryConnectUsb`）仍归连接层。
- **状态模型**：五态 `LinkState` = `connected / degraded / reconnecting / disconnected / failed`。
- **组合规则**：ADB 子监视器 down → 立即 `disconnected`（**不消耗** scrcpy 重连次数，因传输已失，重连无意义）；
  control-socket 子监视器 `DEGRADED`→`degraded`、`DEAD`→触发 `reconnecting`；重连用尽→`failed`。
- **内部组成**：`ControllerHealth`（`scrcpy4`）降为其内部 control-socket 子监视器；另含一个 ADB 子监视器
  （订阅全局 `useAdbStore` 的 `disconnected`）。
- **重连接缝**：构造时注入 `reconnect(attempt: number) => Promise<void>`（由 `ScrcpySession` 提供，
  内部 `stopScrcpy`→退避→`startScrcpy` 且**保留虚拟屏 `displayConfig`**）；supervisor 只管计数/退避/状态转换。
- **实例归属**：每会话一个。mirror 路径在 `useScrcpySession` 内随组件挂载创建，与 `ScrcpySession`
  共享同一 `ControllerHealth` 实例（flex-client 输入门控、链路监督都读它），随会话 `stop`/`dispose` 销毁。
- **消费者**：`App` 的断线重连 overlay 与 `VirtualScreen` 的僵尸清理改为订阅「主会话」`LinkState`，
  取代原先散落的 `adb.disconnected` 反应（原 `useScrcpySession.reconnectAttemptRef`/`MAX_RECONNECT_ATTEMPTS`
  与 `useEffect(DEAD→reconnect)` 被并入 supervisor 单一计数与状态机）。
- **顺带修复**：原 `reconnect()` 调用 `startScrcpy(adb, canvas)` 未传 `displayConfig`，虚拟屏会话自动重连后
  静默退回镜像模式——收口后由注入的重连策略统一保留 `displayConfig`。

## 显示模式

### 虚拟屏（Virtual Display / `newDisplay` + flex display）
使用 Scrcpy `newDisplay` 参数在手机上创建一个**全新的虚拟显示屏**（非物理屏镜像），初始尺寸由车机浏览器窗口尺寸决定；
并通过 **`flex_display=true`**（scrcpy 4.0 协议标志）将其声明为**可运行时 resize 的 flex 显示**。

_Avoid_: 虚拟屏幕、投屏窗口、虚拟显示器。

- 创建原语仍是 `new ScrcpyNewDisplay(width, height, dpi)`（`scrcpy-session.ts` 中 `ScrcpySession.start()`
  构造 `newDisplay` 选项处），提供初始几何尺寸。
- `flex_display=true` 由 `AdbScrcpyOptions4_0.serialize()` 追加（`src/lib/scrcpy4/options.ts` 的
  `serialize()` 覆写中 `value.flexDisplay` 分支），二者需配合使用（`AdbScrcpyOptions4_0.Init` 的
  `flexDisplay` 字段注释「需配合 newDisplay」）——**flex_display 是 newDisplay 的增强，并非替代**。
- flex 显示支持运行时改分辨率：`FlexDisplayClient`（`src/lib/scrcpy4/flex-client.ts`）通过
  `RESIZE_DISPLAY`（控制消息类型 21，`scrcpy4/options.ts` 的 `RESIZE_DISPLAY_TYPE` 常量）发送 resize，无需重建显示。
- `vdSystemDecorations: false`：虚拟屏不渲染状态栏/导航栏/Launcher。

### 镜像模式（Mirror Mode）
直接镜像手机物理屏幕（`displayId: 0`），不创建新虚拟屏。
代码：`scrcpy-session.ts` 非虚拟屏时传 `{ displayId: 0 }`。当前 `VirtualScreen` 组件同时承载两种模式
（`mode` 由 `App.tsx` 传入，`mirror` 走 `displayId:0`，`virtual` 走分屏桌面 `DesktopScreen`）。

_Avoid_: 同屏、屏幕复制、原屏投屏。

### 分屏桌面（Split Desktop）
虚拟屏模式下的实际 UI，由 `SessionManager` 管理：
- **Pane**：`paneLeft` / `paneRight` 各持有一个 streaming session。
- **全屏覆盖层**：`fullscreenSessionId` 叠加在 pane 之上（并发上限内的第 3 个 streaming session）。
- **App 运行时四态**：`foreground-pane` / `foreground-fullscreen` / `background` / `closed`。
  `background` 状态断开 scrcpy 流但**保留设备端虚拟屏**，恢复时复用原 displayId。
- **Canvas Reparenting**：分屏 ↔ 全屏切换时通过 `ScrcpySession.reparentCanvas()` 移动 DOM 父节点，
  WebGL context 不变，画面连续无中断。
- **并发上限**：最多 3 个 streaming session（左 + 右 + 1 全屏）+ N 个 background session
  （仅占设备虚拟屏，不占浏览器解码资源）。

_Avoid_: 多窗口、双屏模式。

## 界面组件与落点模式

- **VirtualScreen**：单屏界面组件。承载 `mirror`（屏幕镜像，单条 scrcpy 会话）与单虚拟屏两种内部模式；渲染 `ControlSidebar`。
- **DesktopScreen**：分屏桌面界面组件（`displayMode==='virtual'`）。由 `SessionManager` 管理多条会话的分屏桌面，渲染 `ControlSidebar` + `DesktopShell` + 各类浮窗。
- **ControlSidebar**：常驻侧边栏（两屏共用），含返回 / 桌面 / 全屏等按钮、pinned / 常用 dock、缓存设置等。宽度 `w-16`（64px）。
- **dock**：侧边栏中常驻显示的应用快捷区（pinned + 常用），点击直接启动。
- **AppPicker（统一全部应用浮窗）**：ADR-0010 后唯一的全应用窗口，取代旧的 ① 面板与 ② `AppPickerOverlay`。
- **AppGrid**：应用网格组件，被 `AppPicker` 包裹；负责列表拉取、排序（`sortApps`：置顶>常用>其他）、分页、图标懒加载、手动刷新。
- **AppIcon**：单个应用图标按钮（共享 `src/components/AppIcon.tsx`）；支持 `pinMode` / `isPinned` 角标与 `cacheVersion` 缓存刷新。
- **AppPickerContext**：`openAppPicker(config)` / `closeAppPicker()`；两屏通过它触发统一浮窗，浮窗在 App 层单实例渲染。
- **pin（置顶）模式**：`AppPicker` 头部开关；开启后点击应用 = `togglePin(pkg)`（切换侧栏 dock 置顶状态），而非启动。`togglePin` 全仓库唯一管理应用置顶的入口。
- **计数角标**：`AppPicker` 标题后的 `(N)`，N = 已装应用总数（`getAllDeviceApps().length`），随 `appListVersion` 刷新。
- **appListVersion**：`useAdbStore` 中的计数器；设备应用数据变更时 bump，驱动 `AppGrid` / dock 重读列表（见 ADR-0009 反馈环修复）。
- **整行触控（List Row Touch Target）**：设置列表与弹窗中的车机交互单元。整行作为单一交互靶区（高度 $\ge 48\text{px}$），取代易引发颠簸误触的微型独立药丸按钮。
  _Avoid_: 药丸按钮、微型控件。
- **座舱冷调微毛玻璃（Translucent Cockpit Glass）**：用于分屏顶栏、全部应用抽屉及悬浮弹窗的轻量半透明材质（`surface.elevated` 配合 `backdrop-blur-md`），弱化对底层视频流画面的遮挡。
  _Avoid_: 全局拟态、厚重实体材质（用于浮窗时）。
- **物理靶区透明外壳（Transparent Hitbox Extender）**：当图标视觉规格为 20px~24px 时，通过外层包裹至少 $48\times 48\text{px}$ 的透明容器（`w-12 h-12 flex items-center justify-center`）补足物理点击区。
  _Avoid_: 裸图标小按钮、缩水触控靶区。

### 启动落点模式（AppPickerMode）

- **single**：镜像 / 单虚拟屏模式。启动 = `startApp(pkg)`，设备端直接起该 app，镜像流中显示。
- **pane**：桌面左 / 右半屏。启动 = `onLaunchOnPane(pkg, pane)`（foreground-pane 会话）。
- **fullscreen**：桌面全屏 pane（受 `SessionManager` 管理的 foreground 会话，之后可转后台 / 拆分 / 切换）。启动 = `onLaunchFullscreen(pkg)`。

> 关键区别：`fullscreen` 仍是桌面体系内的*受管会话*，并非镜像模式。

## 方向锁定（captureOrientation）—— `LockedInitial`，ADR-0001 决策已落地

`ScrcpySession.start()` 当前对虚拟屏使用
`captureOrientation: new ScrcpyCaptureOrientation(ScrcpyLockOrientation.LockedInitial, ScrcpyOrientation.Orient0)`
（`scrcpy-session.ts` 中 `newDisplay` 选项之后的 `captureOrientation` 构造处，带 ADR-0011/ADR-0001 注释）。

**决策状态（已收口）**：ADR-0001 决定锁定到初始方向（`LockedInitial`）。该决策曾长期未落地
（旧代码为 `Unlocked`，构成 open gap），现已实现于 `ScrcpySession`：锁定的是「虚拟屏创建时的初始方向」，
而初始方向由窗口宽高比（`displayConfig`）决定；运行时改分辨率由 flex display resize 承担，灵活性不受影响。

_Avoid_: 自动旋转、方向固定。

## 应用启动流程（App Launch Flow）——历史「多次跳转/慢启动」嫌疑步骤均已收口

应用启动由 `SessionManager.launchOnPane/launchFullscreen` → `ScrcpySession.start` → `ScrcpySession.startAppOnDisplay`
串联完成。历史上产生可见过渡/延迟的步骤及其现状：

1. **不再于每次启动前全局杀 server**：`launchOnPane/launchFullscreen` 已移除启动开头的
   `killScrcpyServer`（见 `session-manager.ts` 中 `launchOnPane` 内的 T6 注释）。各会话有独立 `scid`
   反向隧道，残留 server 不再阻塞新会话。全局 `pkill -f scrcpy`（`adb-commands.ts` 的 `killScrcpyServer`）
   仅在两处兜底：USB 连接引导（`useUsbConnection.ts` 的 `connectOnce`）与冷启动对账
   （`session-manager.ts` 的 `reconcileVirtualDisplaysOnColdStart`，仅 0 会话冷启动窗口，ADR-0014）。
2. **虚拟屏创建后不再强杀 Launcher**：原「`forceStopPackage(homePkg)` 导致 Launcher 闪现 → 黑屏 →
   应用出现」的路径已删除；`forceStopPackage` 现仅在 `closeApp`（关闭 app）时对目标包调用。
3. **`startAppOnDisplay` 改用原生控制消息**：`ScrcpySession.startAppOnDisplay` 通过 scrcpy server
   原生 `startApp`（控制消息 type 16）直接在本会话附着的虚拟屏启动 app（见该方法的 T2 注释），
   取代旧的 `am start --display` + 「主屏启动 + `move-to-display` 搬运」双路径回退与三个 sleep（累计 ~6s）；
   「先在主屏出现再被搬进虚拟屏」的跳转不复存在，也不依赖 ROM 是否支持 `am --display`。
4. **`AppLaunchingOverlay` 已删除**：原零引用死代码（全屏深色遮罩、无任何 import/渲染），其"启动过渡"角色由
   ADR-0011 的 `AppTransitionPlaceholder`（浅色+图标统一占位）取代；启动期的视觉过渡来自真实显示内容变化，
   而非该 DOM 覆盖层。

## 分辨率预设（Resolution Preset）
用户可选虚拟屏画质档位，在保持窗口宽高比前提下按比例缩放（`useScrcpySession.ts` 的 `RESOLUTION_PRESETS`）：
- 原画（original）: 1.0x
- 超清（ultra）: 0.75x
- 高清（hd）: 0.5x
- 流畅（smooth）: 0.25x

_Avoid_: 清晰度、画质档位。

## Smallest Width（sw）
Android 概念：`sw(dp) = min(width_px, height_px) × 160 / dpi`。标准大屏阈值 `sw ≥ 600dp`
（超过即被视为平板/可折叠大屏，触发响应式布局）。

## sw 锚点 DPI 计算
虚拟屏 DPI 以目标 sw 值（600dp）为锚点反向计算（`utils/display.ts` 的 `calculateDpi`）：
`dpi = round(min(width, height) × 160 / 600)`。任意分辨率下 sw 均达到 600dp 大屏阈值。

## DPR 与 DPI 解耦
`w/h = cssW × scale × dpr`（含 DPR）。DPI 由 sw 公式自动响应：`dpr` 翻倍 → `w/h` 翻倍 → `dpi` 翻倍 → `sw` 不变。
跨设备（不同 DPR）sw 表现一致，无需额外补偿。

## 码率计算
码率与像素总数成正比（`VirtualScreen.tsx` / `DesktopScreen.tsx` 的 `displayConfig`）：以 1080p×8Mbps 为基准，
`bitRate = clamp(round(8_000_000 × (w×h)/(1920×1080)), 1Mbps, 40Mbps)`。

## 应用信息解析（App Info Parsing）
当前通过**设备端解析**获取应用名称与图标，避免把整个 APK 下载到浏览器：
- `DeviceAppParser`（`src/lib/device-app-parser.ts`）将 `AppInfoFetcher.java` 编译的 DEX 推送到设备，
  在设备端读取应用列表（`packageName / label / iconBase64 / versionCode / launchCount`）。
- 解析结果缓存进 `AppInfoCache`（IndexedDB，key = `deviceSerial + packageName`），`versionCode` 变化即失效重解析。
- 每设备应用记录（`launchCount / localCount / pinned` 等）持久化于 `DeviceAppsStore`（IndexedDB）。
- 旧方案（浏览器端用 `app-info-parser` 的 `ApkParser` 下载并解析 APK）对应的遗留模块为 `src/lib/apk-parser.ts`；
  当前主路径走设备端解析。

_Avoid_: APK 解析（指旧的浏览器端路径）、应用列表解析。

## 应用显示名解析（ADR-0012）

- **displayName（应用显示名）**：顶部下拉（`PaneDropdown`/`FullscreenDropdown`）、分屏选择（`PaneSelector`）、活动进程（`ActivityManagerPanel`）、启动占位（`AppTransitionPlaceholder`）、应用网格（`AppGrid`）、侧栏 dock（`ControlSidebar`）中展示给用户的应用名称。
- **AppInfo.label**：设备端 `AppInfoFetcher.java` 解析出的应用真实名称（如"微信"），经 `app-info-service.parseAllApps` 缓存于 IndexedDB。是 displayName 的**唯一数据源**。
- **AppInstance.appLabel（已弃用）**：`AppInstance` 可选字段，原意图"由 UI 层在 launch 时填充"。因启动调用点从未传入，且写入后不随缓存刷新、跨 resume/backgroundify 易失配，ADR-0012 起不再作为显示名来源。
- **getCachedAppLabels(pkgs)**：`ScrcpyContext` 暴露的批量解析接口（`useAppManager` → `app-info-service`），按包名返回 `Map<pkg,label>`。
- **渲染时解析（pull 模型）**：ADR-0012 决策——所有 displayName 在**渲染时**经 `useAppDisplayName(pkg)` / `useAppLabels(pkgs)` 按包名查 `getCachedAppLabels` 获得；单一数据源、自动随缓存刷新、覆盖所有启动入口（选择器/侧栏/媒体/NowPlaying）。
- **兜底规则**：label 缺失（首次启动、设备未扫完）时显示**完整包名**（如 `com.tencent.mm`），不再用末段缩写（`com.tencent.mm → mm`）——后者不可读，已于 ADR-0012 全面废弃。

## 音频链路（ADR-0013 / ADR-0015 / ADR-0016）

- **REMOTE_SUBMIX（音频源）**：scrcpy 默认 `audio-source=output`，在设备级捕获**整机**音频输出。关键约束：同一设备同一时刻**仅 1 个** scrcpy 连接能成功获取音频流，其余连接会被 server 返回音频流元数据 `disabled`（见 @yume-chan `client.ts` 的 `parseAudioStreamMetadata`）。因此分屏桌面**不能**让每个 pane 各自 `audio:true`，否则多数 pane 拿不到流 → 无 AudioContext → 无声。这是分屏桌面无声的真因（ADR-0015）。
- **专用音频采集连接（ADR-0015）**：`SessionManager` 持有的独立常驻 scrcpy 连接，作为全设备唯一的 `audio:true`「音频拥有者」。参数 `video:false, control:false, audio:true`，`displayId:0`（不新建虚拟屏、不渲染、不占视频解码资源），独占 `REMOTE_SUBMIX` 捕获**整机**声音（满足「听全部声音」）。生命周期与任何 pane 解耦：`launchOnPane`/`launchFullscreen`/`resumeBackground` 时经 `_ensureAudioCapture` 拉起，最后 app 关闭（`closeApp` 时 `apps.length===0`）或设备断开（`setAdb(null)`）时 `_stopAudioCapture` 清理；session id 存于 `audioCaptureSessionId`。是分屏桌面声音的唯一来源。
- **audioOnly（StartOptions）**：`ScrcpySession.start` 的可选开关（`scrcpy-session.ts` 的 `StartOptions.audioOnly`）。`true` 即「专用音频采集连接」形态：`video=false, control=false`，只抓整机音频、不创建虚拟屏、不渲染画面。`start()` 据此设 `audioEnabled = opts?.audio ?? true`，`audio:false` 的 pane 不建 AudioContext。
- **AudioContext 手势唤醒**：浏览器自动播放策略要求 `AudioContext.resume()` 必须在用户手势内同步调用。`DesktopScreen` 顶层持久化全局 `pointerdown`/`keydown` 监听（捕获阶段）遍历 `SessionManager` 所有 session 调 `resumeAudio()`；唤醒对象现为专用音频采集连接（其拥有 AudioContext）。镜像模式（VirtualScreen）仍走自身 pointer 处理器内 `resumeAudio()`（ADR-0013 的唤醒机制保留，现服务 ADR-0015）。
- **resumeAudio()**：`ScrcpySession` 方法，仅当 `AudioContext` 为 `suspended` 时 `resume()`，幂等；`!audioEnabled`（分屏 pane，`audio:false`）时直接静默返回 no-op（ADR-0015，音频由专用连接承载）；`audioEnabled` 但 `audioCtx` 未建时为 no-op（启动初期 1–2s 正常态，告警每会话仅一次）。
- **useCanvasPointerInput**：分屏/全屏桌面的触控 hook，把容器 div 的 pointer 事件路由到对应 session 的 `injectTouch`；**不再**调用 `resumeAudio()`（ADR-0015 起音频唤醒统一交由 `DesktopScreen` 全局手势监听处理）。
- **未知音频编解码标签的容错解析（ADR-0016）**：设备端返回过非标准的音频 codec 标签 `0x32333034`，不属于官方 scrcpy 的 4 种
  （`OPUS=0x6f707573` / `AAC=0x00616163` / `FLAC=0x666c6163` / `RAW=0x00726177`）。`@yume-chan/scrcpy` 的
  `parseAudioStreamMetadata` 只认这 4 种，遇未知标签即抛 `Unknown audio codec metadata value` → 专用音频连接启动崩溃。
  **该标签的真因已定位（2026-07-14）**：它不是 codec 标签，而是 **`sendDeviceMeta` 写入的 64 字节设备名的前 4 字节**
  （ASCII `"2304"`，完整设备名形如 `"2304FPN6DC…"`）。`video:true` 时设备名写视频 socket（`parseVideoStreamMetadata` 正确跳过 64 字节）；
  `video:false`（audioOnly 专用音频连接）时设备名改写**音频** socket，而 `parseAudioStreamMetadata` 未跳过 → 读成 codec 标签。
  修复：`ScrcpySession.start` 设 `sendDeviceMeta: !audioOnly`（`scrcpy-session.ts`）。`public/scrcpy-server.jar` 经 SHA256 校验与官方 scrcpy
  **v4.0** server 完全一致，**并非车机 OEM 定制版**（早期文档曾误记为定制版，已更正）。ADR-0016 的容错解析因此保留，属防御性措施而非已知定制依赖。
- **AUDIO_CODEC_FALLBACK（ADR-0016）**：`scrcpy4/options.ts` 导出的**单一旋钮**（默认 `"opus"`），同时控制「发给 server 的 `--audio-codec` 请求」与「`parseAudioStreamMetadata` 对未知标签的回退 codec」。`AdbScrcpyOptions4_0.parseAudioStreamMetadata` 重写后，未知标签回退到该值（正常消费 4 字节元数据、不抛错）并打诊断日志；`scrcpy-session.ts` 的 options 构造以 `audioCodec: AUDIO_CODEC_FALLBACK` 接入。默认值 `opus` 与官方 scrcpy 默认编码一致（官方 `AudioCodec.java` / `doc/audio.md` 已核实）。若设备实际编码为 AAC（无 Opus 编码器），除手动改该常量外，运行时还可通过下方**自动自愈**自动改试 aac。
- **audioCodecOverride / 自动自愈（ADR-0016 D4）**：`ScrcpySession.start` 的 `StartOptions.audioCodecOverride` 覆盖本次 `--audio-codec` 请求（默认仍 `AUDIO_CODEC_FALLBACK`）。专用音频连接在 worker 上报「opus 解码失败」（`onAudioDecodeError` 回调；worker 内部对同 codec 重试 3 次后仍失败才上抛）时，`SessionManager` 自动以 `audioCodecOverride:'aac'` 重建该连接（仅一次，置 `audioCaptureRetried` 防无限循环），与官方 scrcpy「`Failed to initialize audio/opus` → `--audio-codec=aac`」回退指引对齐——用户无需手动翻 `AUDIO_CODEC_FALLBACK`。若 aac 仍失败则打「已无更多回退」日志、不再重试。

## 虚拟屏渲染与过渡

- **captureOrientation**：scrcpy 4.x 采集方向选项（官方 CLI 为 `--capture-orientation`）。决定"发送到电脑的视频帧方向"，即 canvas 帧尺寸的来源层。
  - **Unlocked**（协议值 0，无 `@`）：采集**跟随**设备/显示旋转 → app 启动旋转显示即翻转视频帧 → 触发 canvas 清屏白闪。carweb 虚拟屏路径原错用此项。
  - **LockedInitial**（协议值 1，CLI `@`）：采集方向**锁定到初始方向**（虚拟屏创建时的方向），显示旋转不改变采集帧方向 → 无翻转。scrcpy 默认值（平板/镜像路径即此行为）。
- **canvas-clear（清屏）**：`canvas.width=w; canvas.height=h` 赋值会清空 canvas 为透明（`scrcpy-session.ts` 的 canvas 尺寸赋值处）。每当视频帧尺寸变化（`flex-client.ts` 的 `onSessionPacket`）即触发，是白闪的直接来源；透明 canvas 透出浅色容器即"白屏"。
- **flex-display resize（尺寸变化）**：`flexDisplay` 开启时，`SplitPane` 的 `ResizeObserver` 经 `flex-client` 防抖（150ms）向设备发 `RESIZE_DISPLAY`，把虚拟屏尺寸改为容器尺寸。尺寸变化同样触发 canvas-clear → 白闪（与方向锁无关，故 `LockedInitial` 修不了）。
- **统一过渡占位（transition placeholder）**：ADR-0011 的 D2——浅色背景 + 居中应用图标，作为**启动**与**尺寸变化**两类过渡的统一动画（参考 HyperOS 分屏 resize 占位）；canvas 无有效帧/过渡中显示，有效帧到达淡出。由 `desktop/AppTransitionPlaceholder.tsx` 实现，取代已删除的零引用死代码 `AppLaunchingOverlay.tsx`。
- **setRotationLocked(adb)**：Android 层旋转锁（`scrcpy-session.ts`，带 `try/catch` 防护），阻止虚拟屏被 app 转走，使方向不符 app 正立留黑边；`LockedInitial` 为其采集层双保险。

## 会话健壮性与启动期诊断

- **启动临界区串行化**：`withLaunchMutex`（`scrcpy-session.ts` 的模块级 Promise 链）防止多会话 `reverse.remove` 误拆彼此的反向隧道
  （表现为 `AdbScrcpyExitedError: scrcpy server exited prematurely`）。
- **启动超时保护**：`AdbScrcpyClient.start()` 外包 15s `Promise.race` 超时（`scrcpy-session.ts` 的 `START_TIMEOUT_MS`），防止 USB 断开时永久卡死（zombie session）。
- **启动前清理**：`connectOnce` 中 `killScrcpyServer` 清旧 server；启动后按 PID 精确 `killScrcpyByPid`。
- **USB 重置恢复**：`restoreDevice` 优先做总线级 `reset()`（~250ms 重新枚举），用于页面刷新后接口处于「半开」的恢复。
- **AdbScrcpyExitedError**：@yume-chan 在 `AdbScrcpyClient.start()` 中，当设备端 scrcpy server 进程先于 `connection.getStreams()` 建立而退出时抛出的错误。`.output` 为 server 的 stderr 行数组；因填充 `lines` 的是一条**并发 pipe**，进程退出瞬间 `lines` 常为空——**空 output 不能判定"沉默崩溃"**，须靠真机 server 真实 stderr 确证。
- **newDisplay（虚拟屏新建）**：scrcpy 4.0 `--new-display`，在设备端新建一块虚拟显示；carweb 每条 foreground 启动都新建一块（不受 `launchMutex` 保护旧屏释放）。与设备虚拟屏数量上限强相关。
- **keepActive：当前为 `false`**。`scrcpy-session.ts` 中显式设为 `false` 并附查证注释：官方 `keepActive` 仅表示"保持设备唤醒"（userActivity），
  且 `@yume-chan` 4_0 的 `keepActive` 字段无序列化逻辑（从未传给 server），设 true 无意义。早期文档「keepActive 使 server 断开后仍保留虚拟屏」的描述**已失效**。
- **flex_display / vdSystemDecorations**：`--flex-display`（虚拟屏运行时 resize）、`--no-vd-system-decorations`（虚拟屏不渲染状态栏/导航栏/Launcher）。均 ADR-0011 引入。
- **scid（每会话隧道标识）**：`localabstract:scrcpy_<scid>` 端点。**必须是合法十六进制串，且其十六进制数值 ≤ `0x7FFFFFFF`**（31 位有界），因为设备端 scrcpy server 用 `Integer.parseInt(value, 16)`（**十六进制**）把 scid 读入 32 位有符号 int 字段（合法 −1 … `0x7FFFFFFF`）；当十六进制数值 > `0x7FFFFFFF` 时整数溢出 → 抛 `NumberFormatException` → server 提前退出（`AdbScrcpyExitedError`）。隧道名两端均按**十六进制**构造：设备端 `%08x` 零填充、`@yume-chan` 连接层 `getSocketName` 用 `padStart(8,'0')`，故 scid 必须合法且两端零填充一致（ADR-0014 H6 / D4）。`generateScid()` 现产出 31 位有界十六进制（随机值 `>>> 1` 后 `toString(16)`，数值恒 ≤ `0x7FFFFFFF`），永不溢出。
- **虚拟屏瞬态叠加**：pane 切换时 `closeApp(old)` 异步释放旧屏、`launchOnPane(new)` 立即 `newDisplay`，窗口内设备虚拟屏数瞬态超出 ROM 上限 → `newDisplay` 失败 → `AdbScrcpyExitedError`。
- **冷启动对账（ADR-0014 D1 修复）**：`session-manager.ts` 的 `reconcileVirtualDisplaysOnColdStart`——浏览器侧 0 会话的冷启动窗口跑一次 `killScrcpyServer` + settle 800ms，杀光残留 scrcpy 进程、等孤儿屏回收；模块级 flag 保证每页面加载仅一次，非冷启动跳过以保后台 app。
- **启动自愈重试（ADR-0014 D2 修复）**：`scrcpy-session.ts` 的 `start()` 对 `AdbScrcpyExitedError` 重试一次（settle 1000ms 等回收），把"手动重开即成功"自动化；重试不 pkill，避免误杀其它会话。
- **设备侧快照诊断（ADR-0014 D3 深化）**：`adb-commands.ts` 的 `captureDeviceSnapshot(adb)` 在 `AdbScrcpyExitedError` 时采集三类证据——虚拟屏清单（`dumpsys display`，含 id/flag/uniqueId）、scrcpy 进程（`pidof` + `/proc/<pid>/cmdline` 含 `scid=`）、反向隧道（`adb.reverse.list()` 过滤 `scrcpy_<scid>`）；由 `diagnoseFailure`（`scrcpy-session.ts`）在重试前与最终失败两处输出**单条 `console.error` 结构化对象**（字段含 `suspect` 自动判读），逐字附 `error.output`（server stderr）。据此可区分「虚拟屏累积超上限 / 并发 pane 超限 / 反向隧道泄漏 / 真 ROM 不兼容 / 回收瞬态窗口>1s」五类更深原因。

## 断开信号语义（ADR-0007，已实现）

`connectionStatus` 的 `disconnected` 既是「应用层有意关闭」也是「物理/传输真掉线」的**共用信号**，
二者在 `useAdbStore.disconnect()` → `adb.close()` → `adb.disconnected` 回调链中被混写，
且 `App.tsx` 中「`connectionStatus === 'disconnected' && overlayState === 'hidden'`」的 effect
在 `overlay=hidden` 时**无条件**将 `disconnected` 解读为「使用中真掉线」并弹
“USB 连接已断开” overlay。这是「已绑定设备连接时误弹断线」的根因。

_Avoid_: 掉线、断线（二者混用会掩盖 intentional disconnect 与 real drop 的区别）。

- **有意断开（intentional disconnect）**：由代码主动发起的关闭——`tryAutoConnectUsb` 开头的前置
  `store.disconnect()`（`useUsbConnection.ts`）、`handleStop`（`App.tsx`）、
  `beforeunload` 监听内的 `adb.close()`（`App.tsx` 的 `handleBeforeUnload`）。**不应**触发“使用中掉线”overlay。
- **真实掉线（real drop）**：用户拔线 / USB 传输异常导致 `adb.disconnected` 在**无有意关闭标记**下触发。
  **应**触发“使用中掉线”overlay（由上述 `App.tsx` 的 `disconnected + overlay=hidden` effect 承接）。
- **落地形态**：`src/lib/adb-disconnect.ts` 的 `handleAdbDisconnected` 统一处理 `adb.disconnected`
  的正常 resolve 与异常 reject 两个分支——有意关闭时仅清理引用并置 `idle`（**不写 `disconnected`、不写 error**），
  真实掉线时置 `disconnected`（异常分支额外写 error）。有意标记由 `src/lib/adb-intent.ts` 的
  `consumeIntentionalClose` 消费，单次有效。行为由 `src/lib/__tests__/adb-disconnect.test.ts` 覆盖。
- **`reconnecting` overlay**：`ConnectionOverlay.tsx` 中「USB 连接已断开」文案分支的提示，
  唯一由上述 `App.tsx` 的 `disconnected + overlay=hidden` effect 触发；mirror 路径另由 `LinkSupervisor`
  的 `disconnected/failed` 经 `subscribeLinkState` 订阅 effect 承接（`App.tsx`）。

## 已清理项

- **① 全部应用面板**：`ControlSidebar` 内 `panelMode='apps'/'search'` 浮层，ADR-0010 已剔除。
- **`AppPickerOverlay`**：旧 ② 双模式浮窗，被统一 `AppPicker` 取代并删除。
- **孤儿组件**：`ConnectionPanel.tsx`、`DesktopView.tsx`（全仓库零引用），ADR-0010 已删除。
- **`useScrcpy.ts`**：仅为向后兼容的 re-export 层（转发到 `src/hooks/scrcpy/`），新代码应直接用 `useScrcpySession`。
