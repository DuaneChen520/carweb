# ADR-0007: 隔离「有意断开」与「真实掉线」信号，修复已绑定设备连接时误弹“USB 连接已断开”

- 日期：2026-07-09
- 状态：**已接受并实施（2026-07-09）**

## 背景

用户报告：已绑定（已记忆）设备连接时，必出现 overlay 提示
“USB 连接已断开。设备可能已被拔出或连接异常，请重新连接。”
但底层连接实际成功（或仅被重连逻辑短暂重置）。

## 现象与事实（以 `src/` 当前代码为事实源）

- 提示唯一渲染入口：`src/components/ConnectionOverlay.tsx:113-121`（`overlayState === 'reconnecting'`）。
- `reconnecting` 唯一触发：`src/App.tsx:101-104`
  ```ts
  if (store.connectionStatus === 'disconnected' && overlayState === 'hidden') {
    setOverlayState('reconnecting');
  }
  ```
- `connectionStatus` 被业务写为 `'disconnected'` 的唯一来源：
  `src/hooks/useUsbConnection.ts:30-45` 的 `adb.disconnected` 回调
  （**正常分支与异常分支都会写 `'disconnected'`**）。
- 有意断开点：
  - `tryAutoConnectUsb` 开头 `await store.disconnect()`（`useUsbConnection.ts:82`）；
  - `handleStop`（`App.tsx:164`）也调 `store.disconnect()`。
- `store.disconnect()`（`src/hooks/useAdbStore.ts:55-66`）：
  `await adb.close()` → 触发 `adb.disconnected` → 回调写 `'disconnected'`；
  其 `finally { set(initialState) }` 才把状态归 `'idle'`。

## 根因

`adb.disconnected` 回调是 microtask，在 `store.disconnect()` 的 `finally`（置 `idle`）**之后**
才把状态落定为 `'disconnected'`；而该回调**不区分“本次关闭是应用层有意发起（重连前置 disconnect / 用户停止）”
还是“物理掉线 / USB 异常”**。

当这一次有意关闭发生在 overlay 已 `hidden`（桌面已显示）之后，典型触发链：

- **dev（StrictMode 开启，`main.tsx:1,7`）**：挂载自动连接 effect（`App.tsx:54-83`，无 cleanup）
  双调用 → 两次并发 `tryAutoConnectUsb`；第 1 次连上并 `finishConnect()` → overlay `hidden`、
  桌面出现；第 2 次开头的 `store.disconnect()` 关闭**第 1 次的 adb**，其 `adb.disconnected` 回调晚到，
  此时 overlay 已是 `hidden` → `App.tsx:101` 误判为“使用中真掉线” → 弹出断线 overlay。
- **生产态竞态**：手动重连 / 已存在旧 adb 时，前置 `store.disconnect()` 的 `adb.disconnected`
  也可能在 `finishConnect()` 之后落定 `disconnected`，偶发命中同一分支。

**不变量**：`disconnected` 信号被有意断开复用，且 `App.tsx` 在 `overlay=hidden` 时无条件弹“使用中掉线”。

## 与既有 ADR 的关系

- ADR-0005 addendum（2026-07-09）已点名
  “`useUsbConnection` 的 `adb.disconnected` handler、`App.tsx` 的断线 overlay 各管一段、
  两个重连源可竞态”，但其把 `LinkSupervisor` 范围限定在**“连接建立之后”**，
  明确保留**“初始 USB 建连仍归 `useUsbConnection`”**。本次 bug 正落在被排除的初始建连路径上，故未被覆盖。
- **不推翻** ADR-0005：本 ADR 仅补齐初始建连路径的断开信号隔离，
  与 `LinkSupervisor` 的“连接建立之后”监管**正交**。

## 决策（提案）

在 `adb.disconnected` 回调中区分“有意断开”与“真实掉线”，**仅真实掉线写 `connectionStatus='disconnected'`**。

推荐实现（最小改动、精准）：

1. `useAdbStore.disconnect()` 在 `adb.close()` **之前**给该 adb 实例打标：
   `(adb as any).__intentionalClose = true`
   （标记必须**同步**写入，`close()` 是异步的，标记须先于它）。
2. `connectOnce` 的 `adb.disconnected` 回调改读标记：
   - 标记为真（有意关闭）→ 清理 `adb / usbDevice / deviceInfo` 并将状态置 `'idle'`，
     **不写 `'disconnected'`、不写 error**；读取后清除标记。
   - 标记为假（真实掉线）→ 维持现状写 `'disconnected'`（异常分支写 error），
     由 `App.tsx:101` 正常弹出重连 overlay。
3. `handleStop` / `tryAutoConnectUsb` 均经 `store.disconnect()`，自动被覆盖；
   真实拔线不经过 `store.disconnect()`，标记为假，正常弹 overlay。
4. 防御：`connectOnce` 开头重置标记（新 adb 默认未标记），避免旧标记污染后续连接。

## 备选方案

- **B. 引入独立状态 `dropped`**：`ConnectionStatus` 新增 `dropped`，仅真实掉线置之，
  `App` 仅对 `dropped` 弹 overlay；`disconnected` 仅作内部清理态。
  语义更清晰，但需改 `ConnectionStatus` 联合类型与多处引用（含测试、`LinkSupervisor` 消费者）。
- **C. 把初始建连也纳入 `LinkSupervisor`**：关闭 ADR-0005 addendum 的
  “初始 USB 建连仍归 `useUsbConnection`”缺口，单一真相源统一重连。最彻底，
  但改动最大，需重构 `tryAutoConnectUsb` 与 `App` 自动连接 effect 的衔接。
- **D. 成功后再 attach handler**：把 `adb.disconnected` 的 attach 移到 `connectOnce` 成功之后，
  使前置 `store.disconnect()` 不触发。需确保真实掉线仍被捕获（attach 时序需谨慎）。

## 影响

- 正向：消除“已绑定设备连接时误弹 USB 连接已断开”；真实掉线检测不受影响。
- 风险：标记需精准覆盖所有有意关闭路径。注意 `App.tsx:39` 的 `beforeunload` 直接 `adb.close()`
  不走 `store.disconnect()`，不标记录——但发生在页面卸载、不会触发 overlay，可接受；
  若求一致，可在 `handleBeforeUnload` 同样打标。

## 关联修复（次要，非直接成因）

- StrictMode 双调用导致两次并发 `tryAutoConnectUsb`：可在自动连接 mount effect 增加 cleanup
  （取消 / 仅跑一次），避免重复连接浪费；属同一根因面，建议一并处理，但非 overlay bug 的直接成因。

## 验证

- 单测：对“有意 `disconnect` 后 `adb.disconnected` 触发”断言状态为 `idle` 而非 `disconnected`；
  对“未标记的 `adb.disconnected`”断言为 `disconnected`。
- 手动：dev + 已绑定设备加载 → 不再弹“USB 连接已断开”；物理拔线 → 仍弹。

## 实施记录（2026-07-09）

按推荐方案落地，并做了一处实现细化（用 WeakSet 替代 `(adb as any).__intentionalClose`，类型安全、随对象 GC、无泄漏）。

新增 / 修改文件：

- `src/lib/adb-intent.ts`（新增）：`markIntentionalClose(adb)` / `consumeIntentionalClose(adb)`，
  基于 `WeakSet<Adb>`，同步写入、读取后清除（标记一次、消费一次）。
- `src/lib/adb-disconnect.ts`（新增，可单测）：`handleAdbDisconnected(store, adb, error?)` ——
  成为 `adb.disconnected` 正常/异常两个分支的统一入口。
  - 有意断开 → 清理引用并置 `idle`（**不写 `disconnected`、不写 error**）；
  - 真实掉线 → 维持写 `disconnected`（异常分支写 error），由 `App.tsx` 正常弹 overlay。
- `src/hooks/useUsbConnection.ts`：`connectOnce` 的 `adb.disconnected` 回调改为调用 `handleAdbDisconnected`
  （替换原内联双分支）；业务其余逻辑不变。
- `src/hooks/useAdbStore.ts`：`disconnect()` 在 `adb.close()` **之前**同步 `markIntentionalClose(adb)`。
- `src/App.tsx`：
  - `handleBeforeUnload` 同样 `markIntentionalClose(adb)`（页面卸载属有意关闭，保持语义一致）；
  - 自动连接 mount effect 增加 `autoConnectRanRef` 守卫，避免 StrictMode 双调用导致两次并发
    `tryAutoConnectUsb`（ADR「关联修复（次要）」项，dev 路径的触发面）。

测试：

- `src/lib/__tests__/adb-disconnect.test.ts`（新增，4 用例全过）：
  有意断开→idle；真实掉线→disconnected；异常分支→disconnected+error；标记只读一次。

验证结果：

- `npm run test -- adb-disconnect`：4 passed。
- `npm run check`（tsc）改动文件零类型错误。
- 全量 `npm run test`：报告 43 失败，但全部落在 `app-info-*` / `user-preferences-store` /
  `adb-media-commands` 等**与本次无关的既有文件**；已通过 `git stash` 基线对照确认这些失败为预先存在，
  非本改动引入。本改动未导致任何回归。
