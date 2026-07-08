# ADR-0005: Controller 健康状态机 + 自动重连

- 日期：2026-07-04
- 状态：已采纳

## 背景

flex display resize 接入后每次 resize 操作触发崩溃，根因是 `useInputInjector` 在
Socket closed 后执行 `controllerRef.current = null`，导致 flex-client 的 `sendResize`
静默失效。多个通道（注入器、resize）各自维护错误处理逻辑，缺乏统一协调。

## 决策

引入 `ControllerHealth` 三态状态机（IDLE/HEALTHY/DEGRADED/DEAD）统一管理 scrcpy
控制通道的健康状态，并在 DEAD 态触发会话级自动重连。

### 关键规则

1. **不清空 `controllerRef.current`**：DEAD 态通过 `tryGetController()` 返回 null
   拒绝发送，但 ref 本身保持原值，避免误伤其他通道
2. **非 Socket closed 错误直接 DEAD**：不可恢复错误不重试
3. **Socket closed 最多重试 3 次后进入 DEAD**
4. **DEAD 态触发会话级自动重连**：`stopScrcpy()` → 指数退避（500ms/1s/2s）→
   `startScrcpy()`，重连成功后重置状态机
5. **3 次重连上限**：超过后停止并显示"连接已断开，请手动重连"

### 架构变化

- `useInputInjector`：移除 `for attempt` 重试循环 + `controllerRef.current = null`，
  改为 `health.tryGetController()` + `health.reportError()` + `health.markHealthy()`
- `useScrcpySession`：flex-client 的 `sendResize` 同样过 `health.tryGetController()`
- `reconnect()`：自动重连守护，监听 `ControllerHealth.onStateChange` 的 DEAD 事件

## 影响

- 正向：socket 死亡从级联崩溃变为可恢复事件
- 负向：重连过程有短暂黑屏（stopScrcpy→startScrcpy），前台应用不恢复

## 演进 addendum（2026-07-09）

### 背景
架构评审（候选 2）确认「链路健康与重连」概念碎在 5 处：`ControllerHealth` 仅管 control-socket；
`useScrcpySession` 另有 `reconnectAttemptRef`/`MAX_RECONNECT_ATTEMPTS` 重复计数与 `reconnect()`；
`useUsbConnection` 的 `adb.disconnected` handler、`App.tsx` 的断线 overlay、`VirtualScreen` 的僵尸清理
各管一段。两个重连源（ADB 级 / scrcpy 级）可竞态，直接对应「刷新后页面总提示连接失败」现象。

### 决策
将 `ControllerHealth` 演进为端到端 **`LinkSupervisor`**（`src/lib/link-supervisor.ts`，纯 TS 类）：
- 管「连接建立之后」的链路健康与重连；初始 USB 建连仍归 `useUsbConnection`。
- 五态 `LinkState`：`connected / degraded / reconnecting / disconnected / failed`；**ADB-down 优先**。
- `ControllerHealth` 降为内部 control-socket 子监视器；新增 ADB 子监视器订阅全局 `useAdbStore.disconnected`。
- 构造注入 `reconnect(attempt)` 回调（由 `ScrcpySession` 提供，保留虚拟屏 `displayConfig`）。
- 每会话一个实例，随 `ScrcpySession.start()` 创建、`stop` 销毁。
- `App` overlay 与 `VirtualScreen` 僵尸清理改为订阅主会话 `LinkState`。

### 与 ADR-0005 原决策的关系
**不推翻**原决策（不清空 `controllerRef.current`、Socket closed 最多重试 3 次后 DEAD、DEAD 触发会话级自动重连）。
原决策是「control-socket 健康 + 会话重连」的局部实现；本 addendum 将其**范围扩展到整条链路**并消除重复计数，
属演进而非反向。

### 影响
- 正向：重连计数单一真相、ADB 与 scrcpy 两重连源不再竞态、消费者订阅统一 `LinkState`。
- 正向：修复虚拟屏会话重连后静默退回镜像模式的隐藏 bug。
- 负向：新增 `link-supervisor.ts` 深模块；`useScrcpySession` 的重连逻辑并入该类（与候选 1 合并实施）。