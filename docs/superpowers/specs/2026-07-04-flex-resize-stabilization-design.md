# CarWeb Flex Display Resize 稳定化设计

- 日期：2026-07-04
- 状态：已实现（见 `docs/superpowers/plans/2026-07-04-flex-resize-stabilization-plan.md`）
- 关联：`docs/superpowers/specs/2026-07-01-scrcpy4-flex-display-design.md`、`docs/superpowers/specs/2026-07-04-usb-disconnect-handling-design.md`

## 1. 背景与问题

flex display 特性（`2026-07-01-scrcpy4-flex-display-design.md`）已接入，目标是虚拟屏在运行时动态改变尺寸而无需销毁重建会话。但接入后 resize **从未正常工作过**：用户对浏览器做缩放操作（拖动窗口、全屏、Ctrl+滚轮）时，虚拟屏实时调整失效，并触发崩溃。

### 1.1 现象

- 报错：`useInputInjector.ts:33 [touch] 控制 Socket 已永久关闭，停止触摸注入: Socket closed`，调用栈指向 `VirtualScreen.tsx:273`（pointer 事件注入触摸）。
- 缩放即崩：画面直接卡住不动，侧边栏无法打开新应用。
- 触发源覆盖所有尺寸变化场景（拖窗口、全屏、浏览器缩放、预设切换）。

### 1.2 关键事实

1. `Socket closed` 是 `injectTouch` 撞见的尸检，不是 resize 发送时报的——control socket 在某处已死，注入器只是第一个撞上尸体的调用。
2. **级联致命点**：`useInputInjector.ts:34` 在重试 3 次后执行 `controllerRef.current = null`。而 `useScrcpySession.ts:186-188` 的 `sendResize` 依赖 `controllerRef.current`——controller 被清空后，flex-client 的所有 resize 请求静默失效，侧边栏 `startApp` 也跟着失效。这完美解释了"画面卡住、侧边栏无法开应用"。
3. server jar 确实是 v4.0（dex 含 `Cannot resize a non-flex display`、`Flex display does not support cropping` 等字符串），协议层、demuxer、flex-client 状态机、session 包分流均已实现。
4. flex display 接入后从未正常工作过——不是回归，是从接入起就有根本性缺陷。

## 2. 根因假设与验证策略

重构前必须先确认"为什么从未正常过"。识别出两个并列的最高嫌疑根因，方案 C 的重构会同时消除这两类，但验证步骤决定是否需要在重构前做协议层修复。

### 2.1 根因 R1：RESIZE_DISPLAY 的 type 字节值未经验证（协议层）

- 当前代码：`src/lib/scrcpy4/options.ts:24` 硬编码 `RESIZE_DISPLAY_TYPE = 18`，理由是"@yume-chan 枚举只到 17，4.0 在末尾追加"。
- 风险：scrcpy 4.0 server 的 `control_msg_type` 枚举顺序未必是简单追加。如果 4.0 在中间插入了新类型，或 `RESIZE_DISPLAY` 的实际字节不是 18，server 会解析成未知消息或错位消息。
- 后果：server 收到错误 type → 抛异常或直接关闭 control 通道 → `Socket closed`。

### 2.2 根因 R2：flex-client 实例随 React render 重建（架构层）

- 当前代码：`useScrcpySession.ts:426` 直接 `return flexClientRef.current`，而 `ScrcpyContext.tsx:70` 的 `useMemo` 依赖列表里没有 `flexClient`，但 `VirtualScreen.tsx:60` 的 ResizeObserver effect 依赖 `[flexClient, useMirrorMode, resolutionPreset]`。
- 风险：`flexClient` 是 ref 的快照值，首次 render 为 null，启动后 ref 更新但没有触发 re-render，Context value 的 useMemo 拿到的还是旧 null。`VirtualScreen` 拿到的 `flexClient` 可能是启动前的 null 快照，导致 `onContainerResize` 走 `if (flexClient && !useMirrorMode)` 的 false 分支——resize 请求根本没发出去。
- 这能解释"从未正常过"：不是 server 崩，而是客户端从没发过有效的 resize。

### 2.3 验证步骤（重构前先做，单列 M0 milestone）

1. 抓 server 端日志：`adb logcat -s scrcpy` 观察 resize 时 server 是否收到 `RESIZE_DISPLAY`、是否报 unknown type / 异常。
2. 抓 control 通道字节：在 `sendResize` 前打印 `serializeResizeDisplay` 的 5 字节十六进制，核对首字节。
3. 核对 type 字节：从 scrcpy 4.0 源码 `server/src/com/genymobile/scrcpy/control/ControlMessage.java` 确认 `TYPE_RESIZE_DISPLAY` 的实际值。
4. 验证 flexClient 注入：在 `VirtualScreen` 的 ResizeObserver 回调里加日志，确认 `flexClient` 非空且 `onContainerResize` 被调用。

## 3. 架构重构——稳定化的 resize 生命周期

方案 C 的核心。目标是消除 R2 这类"实例随 render 漂移"的架构缺陷，并把 resize 通道做成显式、可观测、与注入器解耦。

### 3.1 问题：当前 flexClient 的传递路径是脆弱的

```
useScrcpySession
  flexClientRef.current = new FlexDisplayClient(...)   // 启动时赋值
  return { flexClient: flexClientRef.current }          // ref 快照
    ↓
ScrcpyContext.useMemo([..., session.flexClient])        // 依赖列表含 flexClient
    ↓
VirtualScreen.useScrcpyContext().flexClient             // 消费
    ↓
ResizeObserver effect [flexClient, ...]                 // 依赖 flexClient
```

三个问题：
1. ref 快照陷阱：`flexClientRef.current` 在 `startScrcpy` 内赋值，但 `useScrcpySession` 的 return 是 render 时求值——首次 render 时 ref 为 null，return null；启动后 ref 变了但没有触发 re-render，Context value 的 useMemo 拿到的还是旧 null。
2. 依赖漂移：`flexClient` 进了 Context 的 useMemo 依赖，理论上 ref 变化不触发 re-render，所以这个依赖是"看起来正确实际失效"。
3. ResizeObserver effect 重建：即使 flexClient 正确更新，effect 依赖它会导致 observer disconnect/reconnect，丢中间事件。

### 3.2 重构：flexClient 提升为 state，稳定化 ResizeObserver

**改动 1：flexClient 从 ref 改为 state**

`useScrcpySession` 新增 `const [flexClient, setFlexClient] = useState<FlexDisplayClient | null>(null)`：
- `startScrcpy` 内创建实例后 `setFlexClient(instance)`（替代 `flexClientRef.current = instance`）。
- `stopScrcpy` 内 `setFlexClient(null)`。
- 保留 `flexClientRef` 作为同步读取用途（pump 循环、sendResize 闭包里用 ref 读最新值，避免闭包陈旧），但状态以 state 为准。即 ref 是 state 的镜像：用一个 `useEffect` 同步 `flexClientRef.current = flexClient`。

这样 `startScrcpy` 完成后 `setFlexClient` 触发 re-render → Context useMemo 重算 → VirtualScreen 拿到真实实例。

**改动 2：ResizeObserver effect 解耦 flexClient**

当前 `VirtualScreen.tsx:60` 的 effect 依赖 `[flexClient, useMirrorMode, resolutionPreset]`，导致 flexClient 变化时 observer 重建。改为：
- effect 只依赖 `[useMirrorMode]`（结构性变化才重建 observer）。
- effect 内部用 ref 读 flexClient（`flexClientRef` 从 context 暴露，或 VirtualScreen 自建一个 ref 跟踪最新值）。
- 这样 flexClient 从 null → 实例 时，observer 不重建，只是下次回调读到新实例。

**改动 3：resolutionPreset 不再触发 observer 重建**

预设切换（原画/超清/高清/流畅）改变的是 `scale`，当前 `onContainerResize(width, height, currentPreset.scale, dpr)` 把 scale 作为参数传入。改为：
- ResizeObserver 回调里通过 ref 读最新 `currentPreset.scale`。
- 预设切换时主动调用一次 `flexClient.onContainerResize(currentSize, newScale, dpr)` 触发 resize（单次，不需要 observer 重建）。

### 3.3 重构：resize 通道与注入通道解耦

当前 `controllerRef` 同时服务三件事：
- `injectTouch`/`injectText`/`injectKeyCode`（注入器）
- `sendResize`（flex-client，闭包捕获 `controllerRef.current`）
- `resizeDisplay` shell 降级（已废弃但保留）

问题：`useInputInjector.ts:34` 在 socket closed 时 `controllerRef.current = null`，误伤 resize 通道。

**改动**：`controllerRef` 保持共享，但引入 controller 健康状态机（见 §4），任一通道发现 socket 死亡时不清空 ref，而是标记 dead 并触发统一恢复流程（自动重连）。注入器和 resize 通道都通过健康状态机读取 controller，dead 时拒绝发送并等待重连恢复。

### 3.4 重构：可观测性

resize 路径加结构化日志（带 `[FlexResize]` 前缀），覆盖：
- `onContainerResize` 入口：`target=${w}x${h}, current=${cw}x${ch}, pending=${...}`
- `requestResize`：`sent RESIZE_DISPLAY type=${typeByte} bytes=${hex}`
- `onSessionPacket`：`confirmed ${w}x${h} clientResized=${b}, pending cleared=${...}`
- `sendResize` 失败：`failed: ${msg}, controllerDead=${...}`
- 重连触发：`controller declared dead, initiating reconnect`

这把当前"黑盒崩"变成可定位的事件序列，配合 §2.3 的验证步骤闭环。

## 4. Controller 健康状态机与自动重连

把"socket 死亡"从致命级联变成可恢复事件。socket 关闭时不再清空 `controllerRef` 误伤所有通道，而是走统一的健康状态机 + 自动重连。

### 4.1 状态机：三态 + 单一权威

引入 `ControllerHealth` 状态机，挂在 `useScrcpySession`，作为 `controllerRef` 的门面：

```
                  startScrcpy 成功
        ┌──────────────────────────────┐
        ▼                              │
   ┌─────────┐   首次成功 write    ┌─────────┐
   │  IDLE   │ ──────────────────▶ │ HEALTHY │
   └─────────┘                     └────┬────┘
                                        │ Socket closed
                                        │ (瞬态, 可重试)
                                        ▼
                                   ┌──────────┐
                                   │ DEGRADED │ ── 重试成功 ──▶ HEALTHY
                                   └────┬─────┘
                                        │ 重试用尽 / 不可恢复错误
                                        ▼
                                   ┌──────────┐
                                   │   DEAD   │ ──▶ 触发自动重连(§4.3)
                                   └──────────┘
                                        │ 重连成功
                                        ▼
                                   ┌─────────┐
                                   │ HEALTHY │ (新 controller)
                                   └─────────┘
```

**关键决策：不清空 `controllerRef.current`**。当前 `useInputInjector.ts:34` 的 `controllerRef.current = null` 是级联根因，替换为：
- DEAD 态保留旧 controller 引用（仅作占位），所有通道通过 `health.tryGetController()` 读取——DEAD 态返回 null（拒绝发送），但 ref 本身不清空。
- 重连成功后 `setController(newController)` 覆盖引用，health 回到 HEALTHY。

**状态转换规则**（单点判定，集中在 `ControllerHealth` 类）：
- 任意通道 catch `Socket closed`：DEGRADED，记录 `lastErrorTime`。
- DEGRADED 态下重试成功：HEALTHY。
- DEGRADED 态下重试到上限（如 3 次 × 退避）仍 `Socket closed`：DEAD。
- 任意通道 catch 非 socket 错误（如 TypeError）：直接 DEAD（不可恢复）。

### 4.2 通道适配：注入器与 resize 统一过门面

**注入器（`useInputInjector`）改动**：
- 移除当前 `for attempt` 重试 + `controllerRef.current = null` 逻辑。
- 改为 `const ctrl = health.tryGetController(); if (!ctrl) return;` + 单次 `try/catch`。
- catch 时调 `health.reportError(error)`，由状态机决定重试还是 DEAD。重试逻辑（退避、次数）下沉到状态机，注入器只负责"试一次，报告结果"。

**resize 通道（`flex-client.sendResize`）改动**：
- 同样过 `health.tryGetController()`。
- sendResize 失败时 `health.reportError(error)`，不自己吞错。
- flex-client 的 `pendingResize` 在 DEAD 态保留（重连后由 `onSessionPacket` 或下一次 `onContainerResize` 校正），不丢失用户意图。

**好处**：注入器和 resize 通道都不再各自处理 socket 死亡，统一由状态机决策。任一通道发现死亡，全通道同步进入 DEAD，避免"注入器发现死了但 resize 还在傻发"的不一致。

### 4.3 自动重连：会话级重建

DEAD 态触发自动重连。重连 = 整体重建 scrcpy 会话（不是只重建 control socket——scrcpy 协议下 control/video/audio 是同一连接的子流，无法单独重建 control）。流程挂在 `useScrcpySession`，新增 `reconnect()`：

```
DEAD 触发
  → reconnect() (带 startingLock 防并发)
  → stopScrcpy()              // 清理旧 client/controller/decoder, 保留 adb
  → 退避等待 (500ms × 指数, 上限 3 次)
  → startScrcpy(adb, canvas, displayConfig, setCanvasSize)
    → 成功：health → HEALTHY, flexClient 重新 setInitialDisplaySize(当前容器尺寸)
    → 失败：退避重试, 3 次仍失败 → setState error, 停止重连（避免无限循环）
```

**关键点**：
1. 重连自动完成，无需用户手动操作：displayConfig 用当前容器尺寸（不是初始尺寸），重连后画面尺寸直接对齐当前容器。注意重连过程中会有短暂的 stopScrcpy→startScrcpy 黑屏过渡（非完全无感），但优于"画面永久卡死"。
2. displayId 变化处理：重连创建新虚拟屏，displayId 会变。`displayIdRef.current` 在 `startScrcpy` 内重新探测。`startAppOnDisplay` 走 `ensureDisplayId` 读最新值，自动命中新屏。
3. 前台应用恢复：重连后虚拟屏是新的，原前台 App 不会自动出现在新屏。当前架构已删除"销毁重建式 resize 的应用恢复"——重连同样不恢复，这是可接受代价（重连是异常恢复，不是常规 resize）。如果用户在车机地图 App，重连后会回到 Launcher，用户需手动重开——比"画面永久卡死"好。
4. 防抖动重连：`startingLockRef` 已有并发保护；新增 `reconnectAttemptRef` 计数 + 上限，3 次失败后 `setState({ error: '连接已断开，请手动重连' })`，停止自动重连。
5. 镜像模式：重连逻辑对镜像模式同样适用（displayId=0，无虚拟屏销毁），更简单。

### 4.4 与 §3.4 的可观测性联动

`ControllerHealth` 的每次状态转换都打 `[CtrlHealth]` 日志：
- `HEALTHY → DEGRADED: socket closed at <channel>`
- `DEGRADED → DEAD: retries exhausted`
- `DEAD → reconnect attempt <n>/<max>`
- `reconnect success/fail`

配合 `[FlexResize]` 日志，整条链路可追溯。

## 5. 测试策略

### 5.1 单元测试（必做，纯逻辑）

| 测试文件 | 覆盖目标 |
|---|---|
| `scrcpy4/__tests__/flex-client.test.ts`（扩展） | ① flexClient 从 null→实例 后 `onContainerResize` 能正常发 resize（锁死 R2 修复）② 预设切换主动触发一次 resize ③ DEAD 态 `sendResize` 不抛、保留 pendingResize ④ 重连后 pendingResize 被校正 |
| `__tests__/controller-health.test.ts`（新增） | ① IDLE→HEALTHY（首次成功 write）② HEALTHY→DEGRADED（socket closed）③ DEGRADED→HEALTHY（重试成功）④ DEGRADED→DEAD（重试用尽）⑤ 非 socket 错误直接 DEAD ⑥ DEAD 态 `tryGetController` 返回 null ⑦ 状态转换日志可观测 |
| `__tests__/reconnect.test.ts`（新增） | ① DEAD 触发 `reconnect`，调 `stopScrcpy`+`startScrcpy` ② displayConfig 用当前容器尺寸 ③ 3 次失败后停止并 setState error ④ `startingLock` 防并发 ⑤ 重连成功后 health→HEALTHY |

ControllerHealth 和 reconnect 用假 controller / 假 session 函数注入，不依赖真机。

### 5.2 不测的（YAGNI）

- 真机抓包验证 type 字节：归入 M0（验证根因），不是单测。
- WebCodecs reconfigure、ADB 传输层：库已测。
- E2E 真机 resize 全链路：归入手测验收。

### 5.3 手测验收清单

1. 拖动浏览器窗口：画面 <300ms 跟随、无黑屏、应用不中断、控制台 `[FlexResize]` 日志连续。
2. 全屏切换：阶跃尺寸变化，画面跟随。
3. Ctrl+滚轮缩放（dpr 变化）：画面跟随。
4. 预设切换：画面按新 scale 调整。
5. 快速连续 resize：不堆积请求、不抖动循环（看 pending squash 日志）。
6. 故意触发 socket 死亡（如 USB 抖动）：`[CtrlHealth]` 显示 DEGRADED→DEAD→reconnect→HEALTHY，画面恢复，无需手动操作。
7. 重连 3 次失败：显示错误提示，停止重连。
8. `[FlexResize]` / `[CtrlHealth]` 日志清晰、无刷屏。

## 6. 里程碑

### M0 — 根因验证（重构前置，必须先做）

按 §2.3 的验证步骤：
1. `adb logcat -s scrcpy` 抓 resize 时 server 日志。
2. `sendResize` 前打印 5 字节十六进制。
3. 核对 scrcpy 4.0 源码 `TYPE_RESIZE_DISPLAY` 实际值。
4. 确认 `VirtualScreen` 拿到的 `flexClient` 非空。

**验收**：明确 R1（type 字节）和 R2（flexClient 注入）哪个是真根因，或两者皆是。若 R1 成立，先修 type 字节常量（一行改动）让 resize 真正能发到 server。

### M1 — 架构重构（§3）

- flexClient: ref → state + ref 镜像。
- ResizeObserver effect 解耦 flexClient/preset。
- preset 切换主动触发 resize。
- `[FlexResize]` 可观测性日志。

**验收**：单测（flex-client 扩展）绿；手测 resize 在所有尺寸变化场景跟随。

### M2 — controller 健康状态机 + 自动重连（§4）

- `ControllerHealth` 三态状态机。
- 注入器 / resize 通道过门面。
- `reconnect()` 会话级重连 + 3 次退避上限。
- `[CtrlHealth]` 日志。

**验收**：单测（controller-health / reconnect）绿；手测故意断连恢复。

### M3 — 清理 + 文档

- 移除 `useInputInjector` 的 `controllerRef.current = null` 旧逻辑。
- 移除 `resizeDisplay` shell 降级路径（若 M1/M2 稳定后确认不需要）。
- 更新 flex-display 设计文档（标注 §3/§4 的重构）。
- 更新 ADR（新增 controller 健康状态机 + 自动重连决策）。

**验收**：文档与代码一致，无残留死代码。

## 7. 范围与非目标

### 范围（In）

- 根因验证（M0）。
- flexClient / ResizeObserver / controllerRef 架构稳定化重构。
- `ControllerHealth` 三态状态机 + 注入器/resize 通道统一门面。
- 会话级自动重连（3 次退避上限）。
- `[FlexResize]` / `[CtrlHealth]` 可观测性日志。
- 单测 + 手测验收。

### 非目标（Out）

- 多会话多虚拟屏（仍单会话）。
- 冷启动加速（flex 不解决首次 push jar + 首帧冷启动耗时）。
- 运行时改码率（scrcpy 无运行时码率控制消息）。
- 重连后恢复前台应用（回到 Launcher，用户手动重开）。
- `--start-app` 服务端启动参数（保留现有 ADB `am start --display`）。

## 8. 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| **R1 type 字节错误** | 高 | M0 先验证；若成立一行修复；单测锁定字节值。 |
| **R2 flexClient 注入失效** | 高 | flexClient 改 state 触发 re-render；单测锁死 null→实例 后 resize 可发。 |
| **自动重连在 USB 持续抖动时抖动** | 中 | 3 次退避上限 + 失败后停止并提示手动重连，避免无限循环。 |
| **重连后 displayId 变化导致 startApp 落错屏** | 中 | `ensureDisplayId` 读最新 ref；手测验证 startApp 命中新屏。 |
| **ControllerHealth 状态机在真机时序异常** | 中 | 单测锁死状态转换；手测故意断连覆盖。 |
| **重连不恢复前台应用影响体验** | 低 | 异常恢复场景可接受；比永久卡死好。 |
