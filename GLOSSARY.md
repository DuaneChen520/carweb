# CarWeb 领域术语表

> **事实源声明**：本文件（`GLOSSARY.md`）是项目领域词汇的单一事实源，以 `src/` 下**当前代码**为准编写，不依赖早期 ADR 或旧设计文档。
> 若本文件与代码冲突，以代码为准。如某术语涉及「已决定但未落地」的决策，会显式标注。
> 每个术语用 `_Avoid_` 列出本项目不采用的同义词；新术语按此格式追加。

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

## 方向锁定（captureOrientation）—— `LockedInitial`，ADR-0001 决策已落地

`ScrcpySession.start()` 当前对虚拟屏使用
`captureOrientation: new ScrcpyCaptureOrientation(ScrcpyLockOrientation.LockedInitial, ScrcpyOrientation.Orient0)`
（`scrcpy-session.ts` 中紧随 `newDisplay` 选项的 `captureOrientation` 构造处，带 ADR-0011/ADR-0001 注释）。

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
`dpi = min(width, height) × 160 / 600`。任意分辨率下 sw 均达到 600dp 大屏阈值。

## DPR 与 DPI 解耦
`w/h = cssW × scale × dpr`（含 DPR）。DPI 由 sw 公式自动响应：`dpr` 翻倍 → `w/h` 翻倍 → `dpi` 翻倍 → `sw` 不变。
跨设备（不同 DPR）sw 表现一致，无需额外补偿。

## 码率计算
码率与像素总数成正比（`DesktopScreen.tsx` / `VirtualScreen.tsx`）：以 1080p×8Mbps 为基准，
`bitRate = clamp(8_000_000 × (w×h)/(1920×1080), 1Mbps, 40Mbps)`。

## 应用信息解析（App Info Parsing）
当前通过**设备端解析**获取应用名称与图标，避免把整个 APK 下载到浏览器：
- `DeviceAppParser`（`src/lib/device-app-parser.ts`）将 `AppInfoFetcher.java` 编译的 DEX 推送到设备，
  在设备端读取应用列表（`packageName / label / iconBase64 / versionCode / launchCount`）。
- 解析结果缓存进 `AppInfoCache`（IndexedDB，key = `deviceSerial + packageName`），`versionCode` 变化即失效重解析。
- 每设备应用记录（`launchCount / localCount / pinned` 等）持久化于 `DeviceAppsStore`（IndexedDB）。
- 旧方案（浏览器端用 `app-info-parser` 的 `ApkParser` 下载并解析 APK）对应的遗留模块为 `src/lib/apk-parser.ts`；
  当前主路径走设备端解析。

_Avoid_: APK 解析（指旧的浏览器端路径）、应用列表解析。

## 会话健壮性要点（供诊断参考）
- **启动临界区串行化**：`withLaunchMutex` 防止多会话 `reverse.remove` 误拆彼此的反向隧道
  （表现为 `AdbScrcpyExitedError: scrcpy server exited prematurely`）。
- **启动超时保护**：`AdbScrcpyClient.start()` 外包 15s `Promise.race` 超时，防止 USB 断开时永久卡死（zombie session）。
- **启动前清理**：`connectOnce` 中 `killScrcpyServer` 清旧 server；启动后按 PID 精确 `killScrcpyByPid`。
- **USB 重置恢复**：`restoreDevice` 优先做总线级 `reset()`（~250ms 重新枚举），用于页面刷新后接口处于「半开」的恢复。

## 断开信号语义（2026-07-09，ADR-0007 提案）

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
- **修复不变量（提案）**：`adb.disconnected` 回调需按「是否有意关闭标记」分流——
  有意 → 置 `idle` 且不写 `disconnected`；真实 → 写 `disconnected`。细节见 `docs/adr/0007-isolate-intentional-vs-real-disconnect.md`。
- **`reconnecting` overlay**：`ConnectionOverlay.tsx` 中「USB 连接已断开」文案分支的提示，
  唯一由上述 `App.tsx` 的 `disconnected + overlay=hidden` effect 触发；mirror 路径另由 `LinkSupervisor`
  的 `disconnected/failed` 经 `subscribeLinkState` 订阅 effect 承接（`App.tsx`）。
