# ADR-0009: 数据丢失与设备遗忘后的重同步策略 (re-sync on data-loss & device-forget)

- Status: **Accepted / 已实施** — 2026-07-13 起草，2026-07-14 落地
- 决策人: DuaneChen
- 关联: ADR-0008（连接级自动同步，已实施）；本 ADR 补全 ADR-0008 的触发盲区
- 实测场景来源: 2026-07-13 用户实测——①清空用户数据后列表空且不再拉取；②删除设备重连仍不触发拉取

## Context（背景）

ADR-0008 将「同步应用列表」的唯一触发点收口在 `startScrcpy`（`useScrcpySession.ts:101`
内的 `appManager.setAdb(adb)` 之后 fire-and-forget `syncAndParseIfNeeded`），并对
`toParse>0` 设闸门（仅「有变更」才跑全量 dex）。该设计覆盖「会话启动 / 重连」生命周期，
但无法响应以下两类**缓存应当失效**的事件：

### 场景 1：连接态内清空用户数据

- 路径：`ControlSidebar`「缓存设置」→「清空全部」(或任何清空入口) →
  `scrcpy.clearAll()` → `AppInfoService.clearAll()` 静默清空
  `cache` + `deviceAppsStore` + `prefsStore`（**无任何日志**）。
- 后果：侧栏列表（读 `getAllDeviceApps()`）瞬间变空。设备**仍 connected**，
  `startScrcpy` 不重入 → `syncAndParseIfNeeded` 不触发 → 列表保持空白。
- 现有局部补救：`CacheSettingsDialog.onClearAll`（:675-681）在 `clearAll()` 后已接
  `refreshSidebarApps(true)`；「全部应用」浮窗的「更新应用列表」按钮（:712-730）同样
  调 `refreshSidebarApps(true)` → `parseAllApps()`（**全量拉取**）。
  即"手动全量刷新"能力**已存在**，缺口是：①其他清空入口未必都接刷新；
  ②列表清空后该按钮是否仍可见/可发现；③`clearAll` 自身不保证重拉。

### 场景 2：删除设备（forget）后重连

- 路径：`useRememberedDevices.forget(id)`（:41）**仅**从 `localStorage('carweb-devices')`
  删除配对记录，**完全不触碰**按 adb serial 索引的 `AppInfoCache` / `DeviceAppsStore`。
- 后果：重连 → `VirtualScreen` effect（依赖 `store.adb`）→ `startScrcpy` → `syncAndParseIfNeeded`
  → `syncWithDevice`：`fetchQuickPackageList` 拿到设备列表，与**幸存缓存**比对
  `versionCode` 全匹配 → `toParse = []` → `parseAllApps` 被跳过。
- 控制台可观测：`[AppInfoService] 同步完成: 设备 N 个应用, 需解析 0 个`，
  随后**无** `[AppInfoService] 尝试使用设备端解析器...`。
- 语义错位：用户心智是"删除设备=从零开始"，代码实际是"缓存命中=无变更=不重拉"。

### 根因结论

ADR-0008 的触发点绑定「会话启停 + `toParse>0` 闸门」，缺少对
**「缓存应当失效」这一事实的显式响应**（in-session 清空 / 设备被遗忘）。
两者是同一类缺口的两个实例。

## Decision（决策）

经 grill（2026-07-13 三问定案），采用以下组合，**不引入**连接级自动重拉、不新增公开
`forceResync` API：

### D1. 场景 1：手动全量刷新为法定恢复路径，不做自动重拉

- **不**在 `clearAll` / `clearDeviceApps` / `clearDeviceAppCache` 内自动 fire
  `syncAndParseIfNeeded`（避免与 ADR-0008 的会话生命周期触发耦合、避免清空即抢占 ADB 传输）。
- 法定恢复 = 用户在「全部应用」浮窗点「更新应用列表」按钮 → `refreshSidebarApps(true)`
  → `parseAllApps()`（全量 dump，已具备）。
- 配套可达性加固（实施时落实）：
  1. 确保清空后「全部应用」浮窗的刷新按钮**始终可见**（列表为空时仍可点，而非依赖非空列表才渲染）；
  2. 统一所有"清空用户数据"入口的后续行为：要么显式接 `refreshSidebarApps(true)`，
     要么明确文档化"清空后请点刷新"——`CacheSettingsDialog.onClearAll` 的现有接法是范本，
     不应回退。
- 理由：清空是低频、用户显式操作；立即自动重拉会与进行中的会话争用 ADB，且多数清空场景
  用户本就打算随后手动操作，自动重拉收益低、风险高。

### D2. 场景 2：forget 同时清空该设备 dex 缓存（删除即清缓存）

- `useRememberedDevices.forget(deviceId)` 在删除配对记录的同时，调用
  `appManager.clearDeviceAppCache(serial)` + `appManager.clearDevicePreferences(serial)`
  （二者均已存在，无需新增 service 方法），按 serial 清空 `AppInfoCache` + `DeviceAppsStore`
  + `prefsStore`。
- 因缓存已空，重连时 `syncWithDevice` 的 `toParse` 自然为全量 → `parseAllApps` 被触发
  → 完整重拉。复用 ADR-0008 既有增量 seam，**无需改 `startScrcpy` / `syncAndParseIfNeeded`**。
- **前置子任务（实施时必做）**：`RememberedDevice` 需携带 adb `serial`，否则 forget 时无
  serial 可清。改动：
  - `useRememberedDevices.ts`：`RememberedDevice` 增加 `serial: string`；`remember()`
    在写入时填入 `useAdbStore.getState().deviceSerial`（或调用方传入）；
  - forget 调用处（如 `App.tsx:231` 的 `onForget`）通过 `devices` 列表由 `id` 反查 `serial`，
    再触发 D2 的两个清空方法。若调用处拿不到 `appManager`，可在 `useRememberedDevices`
    注入 `onForgetDevice?(serial: string)` 回调由 `App.tsx` 接 `scrcpy` 清空方法。
- 离线安全：清空仅操作 IndexedDB（按 serial 索引），**不依赖 live adb**，故即便设备已断开
  （forget 时常见）也能正确失效缓存。

### D3. 架构：就近挂钩（colocate-with-event），不引入连接级 effect / 新 API

- 触发点就近落在"产生失效事实"的地方：`forget` 负责清 per-device 缓存；刷新按钮 handler
  就近调用全量拉取。
- 不采用：连接级 `useEffect` 监听"缓存失效版本号"（改动最大、引入新状态）、显式
  `forceResync()` 公开 API（新增调用点、与 ADR-0008 seam 重复）。
- 理由：改动面最小、语义最自然，且完全复用 ADR-0008 已验证的 `syncAndParseIfNeeded` /
  `parseAllApps` seam 与重入守卫。

## Options（候选方案，定案前的对比）

### 场景 1 的备选

- **A（采纳 D1）手动全量刷新**：零新触发点，复用现有 `refreshSidebarApps(true)`。
  - 优点：不清空即抢占 ADB；与 ADR-0008 生命周期解耦；实现量≈可达性加固数行。
  - 缺点：清空后列表短暂空白，需用户点一次刷新（用户已认可此交互）。
- **B 自动重拉（否决）**：`clearAll` 内 connected 时 fire `syncAndParseIfNeeded`。
  - 缺点：与 ADR-0008 会话触发耦合；清空即抢占 ADB 传输；用户未必想要立即重拉。

### 场景 2 的备选

- **A（采纳 D2）forget 清缓存**：删除即清，重连增量自然全拉。
  - 优点：零新 API，复用 ADR-0008 seam；离线安全；符合"删除=从零"心智。
  - 缺点：需补全 `RememberedDevice.serial`（约 1 处结构改动 + 调用处反查）。
- **B 保留缓存（否决）**：维持"需解析 0 个"现状，重连不重拉。与用户"删除即从零"心智冲突。
- **C 连接级 effect 监听失效标志（否决）**：改动最大、引入新状态，覆盖收益不抵成本。

## 增量语义一致性（与 ADR-0008 对齐）

- `syncAndParseIfNeeded`（app-info-service.ts:184）= `syncWithDevice`（轻量比对 → `toParse`）
  + 仅 `toParse>0` 才 `parseAllApps`（全量 dump、按 versionCode 写差异）。
- D2 通过"先清缓存"使 `syncWithDevice` 必然得 `toParse=全量`，从而 `parseAllApps` 必跑——
  **不绕开、不改写** ADR-0008 的增量语义，只是让失效事件自然地放大 `toParse`。
- D1 的手动刷新走 `parseAllApps()` 直接全量 dump（绕过 `toParse` 闸门），属用户显式全量意图，
  与增量语义不冲突（语义上等价"我已知缓存全失效，直接全拉"）。

## Consequences（影响）

- 场景 1：清空后列表空白，用户点「全部应用→更新应用列表」即全量回填；不再依赖隐式自动重拉。
- 场景 2：删除设备后其 dex 缓存被失效，重连确定性全量重拉，符合用户心智。
- 不改动：ADR-0008 的 `startScrcpy` 注入点、`syncAndParseIfNeeded` seam、重连重校验逻辑。
- 新增代价：`RememberedDevice.serial` 字段 + forget 调用处反查 serial 并清缓存（约 2 文件小改）。
- 残留：卸载包残留孤儿记录（`DeviceAppsStore.setAll` 只 put 不删）仍仅手动清缓存可移除，
  非本次范围。

## 实施记录（已实施 — 2026-07-14）

- 改动清单（实际落地，遵循"不多改"）：
  - **新增 `src/lib/forget-device-cache.ts`**：导出 `forgetDeviceCache(serial)`，用独立
    `AppInfoService` 实例 fire-and-forget 调用 `clearDeviceAppCache` + `clearDevicePreferences`
    （按 serial 清 `AppInfoCache` + `DeviceAppsStore` + `prefsStore`），失败仅 `console.warn`。
    仅依赖 IndexedDB（实例间共享底层库），离线安全。
  - **`src/hooks/useRememberedDevices.ts`**：`RememberedDevice` 增加 `serial: string`；
    `remember()` 由调用方写入 `serial`（= `device.id`，即 adb serial）。`forget` 签名不变，
    缓存清理由调用点就近触发（保持 hook 与 app-info 解耦）。
  - **`src/App.tsx`**：`remember({..., serial: device.id})`；`PinDialog.onForgot` 在
    `forget` 前调用 `forgetDeviceCache(pinGuard.deviceId)`（`pinGuard.deviceId` 即 serial）。
  - **`src/components/ConnectionOverlay.tsx`**：`onForget(device.id)` 前调用
    `forgetDeviceCache(device.serial || device.id)`（旧记录缺 `serial` 时回退到 `id`）。
  - **`src/components/ControlSidebar.tsx`**：`CacheSettingsDialog` 的 `onClearDeviceAppCache` /
    `onClearDevicePreferences` 在清完后调用 `refreshSidebarApps()`（非 force）。与全局
    「清理所有设备数据」（`refreshSidebarApps(true)`）对齐入口行为；per-device 用非 force 版：
    清偏好（列表空）时 `refreshSidebarApps` 经 `syncWithDevice` 自然检测 `toParse>0` 触发重拉，
    清图标（列表非空）时仅刷新标签，避免每次清空都强制全量 dump 抢占 ADB。
  - **`src/components/ConnectionOverlay.tsx`**：`onForget` 调用点仅追加 `forgetDeviceCache`
    缓存失效副作用，未改动按钮外观/可访问性（保持与 HEAD 一致，避免范围蔓延）。
- D1 可达性核实（无需改渲染）：「全部应用」浮窗经 `togglePanel('apps')` 打开，与列表是否为空
  无关；其「更新应用列表」刷新按钮（:712）仅由 `panelMode === 'apps'` 门控，列表空时仍可见可点。
  故 D1 的"刷新按钮始终可见"已天然满足，落地仅补强了清空入口的自动刷新一致性。
- 验证：
  - 新增 `src/lib/forget-device-cache.test.ts`（3 项，复用 `fake-indexeddb/auto`）：按 serial
    清空三条缓存、不影响其它 serial、空 serial 安全。
  - 全量回归：`tsc -b --noEmit` 0 错误；`vitest run` 31 文件 / 284 项全过（含 ADR-0008 的
    `sync-guard` 测试，确认 `startScrcpy` 注入点未被破坏）。
- 提交：见 git log（本 ADR 落地提交）。

## Glossary（ubiquitous language，扩展 ADR-0008）

- **数据丢失事件 (data-loss event)**：in-session 清空 `cache`/`deviceAppsStore`/`prefsStore`
  （`clearAll`/`clearDeviceApps`/`clearDeviceAppCache`），使已渲染列表变空。
- **设备遗忘 (device-forget)**：`useRememberedDevices.forget(id)` 删除配对记录；
  本 ADR 规定其**副作用**须同时失效该设备按 serial 索引的 dex 缓存。
- **法定恢复路径 (sanctioned recovery)**：场景 1 下用户手动点「全部应用→更新应用列表」
  → `parseAllApps()` 全量重拉；非自动。
- **删除即清缓存 (forget-clears-cache)**：forget 同时 `clearForDevice` 清 `AppInfoCache` +
  `DeviceAppsStore`，使重连增量同步 `toParse` 自然为全量。
- **缓存失效事实 (cache-invalidation fact)**：一类"缓存应被视为过期"的事件（清空 / 遗忘），
  须被显式响应；ADR-0008 仅响应"会话启停 + versionCode 变更"，本 ADR 补全此类。
