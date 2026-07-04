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