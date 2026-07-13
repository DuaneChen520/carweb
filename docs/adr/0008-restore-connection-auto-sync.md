# ADR-0008: 恢复「连接即同步应用列表」(connection-level auto-sync)

- Status: **Accepted / 已实施** — 2026-07-13 起草并评审，同日落地（commit 待提交）
- 决策人: DuaneChen
- 相关提交: `f7391bb`（加入）/ `9afad53`（误删）/ 本次恢复（待提交）

## Context（背景）

设备初次连接时不会触发 dex 应用信息拉取（见 2026-07-13 诊断）。

- 历史上 `f7391bb` 在 `useScrcpySession.ts` 的连接成功回调里调用
  `appManager.syncWithDevice(adb)`，命中 `toParse>0` 即 `parseAllApps()`。
- 该逻辑在 `9afad53`（"refactor(link): 统一链路监督 LinkSupervisor 并收口
  useScrcpySession 为薄适配器"）被整体删除，且未在新建连接链路（LinkSupervisor）重建。
- 当前唯一触发点在 `ControlSidebar.tsx`：挂载 `useEffect` → `refreshSidebarApps()`
  （仅一次），且仅当 `getAllDeviceApps().length === 0` 才 `syncWithDevice()` + `parseAllApps()`。

当前触发点的三个失败因子：

1. **触发位置错层**：dex 拉取依赖 `ControlSidebar` 挂载，而它只在虚拟屏/桌面视图内渲染；
   连接建立时若桌面视图未挂载，触发不发生。
2. **挂载竞态（主因）**：`refreshSidebarApps` 在挂载瞬间只跑一次，此时 `syncWithDevice`
   （`useAppManager.ts:116`）读 `adbRef.current`；若仍为 `null`，立即返回空结果且**不重试**。
3. **空 store 闸门**：老设备/残留缓存（`DeviceAppsStore`，按 deviceSerial 复合键）使
   `=== 0` 判否，整段 sync+parse 被跳过。

**根因结论**：连接级自动同步（握有连接后 `adb` 句柄）被删，降级为受竞态与闸门限制的 UI 副作用。

## Decision（提议）

在连接建立、且 `adb` 句柄已就位的时刻，重新注入 `syncWithDevice()`，恢复连接即同步。
推荐注入点见下方选项 A。

## Options（候选方案）

### A. 在 `startScrcpy` 内 `appManager.setAdb(adb)` 之后重新注入（推荐，已实施）

位置：`useScrcpySession.ts` 的 `startScrcpy` 内、`appManager.setAdb(adb)` 之后，fire-and-forget：

```ts
appManager.setAdb(adb);
// 连接即后台同步应用列表（恢复 f7391bb，被 9afad53 误删）
appManager.syncAndParseIfNeeded().catch((err) => {
  console.warn('[ScrcpySession] 后台同步应用列表失败:', err);
});
```

> **Seam 决策（实施细节）**：为可单测，把「`syncWithDevice` → 仅 `toParse>0` 才 `parseAllApps`」
> 抽成 `AppInfoService.syncAndParseIfNeeded(adb, deviceSerial, signal?)`（新增方法），
> `useAppManager` 暴露同名回调（读 `adbRef.current` + `deviceSerial` 后委托），
> `startScrcpy` 仅做 fire-and-forget 调用。这样「连接级自动同步」的增量逻辑收口到单一
> 方法，既忠实还原 `f7391bb` 行为，又满足 TDD 的可测试性（无需渲染 React hook）。
> 注：原草案写的 `parseAllApps(false)` 有误——`parseAllApps` 收的是进度回调而非布尔值，
> 故改为 `syncAndParseIfNeeded` 内部按 `toParse` 决定。

- 优点：diff 极小（≈8 行）；忠实还原 `f7391bb` 已验证行为；`adb` 句柄在手、无竞态；
  与视图挂载无关，镜像/虚拟屏均生效；`syncWithDevice` 自带重入守卫（`syncing` 标志），
  `parseAllApps` 仅 `toParse>0` 才跑。
- 缺点：与 `startScrcpy` 生命周期耦合，每次（重）启动都会触发（重连亦如此，通常为 no-op）；
  与 scrcpy 启动共用 ADB 传输，轻量 DEX 推送可能短暂争用（原 `f7391bb` 即如此，非阻塞）；
  `ControlSidebar` 挂载触发成为冗余（无害但重复）。

### B. 保留 `ControlSidebar` 为唯一触发点，仅修复其竞态与闸门

将挂载 effect 改为依赖 `connectionStatus === 'connected'`，并将 `=== 0` 闸门改为始终/按陈旧度同步。

- 优点：不动连接/会话层，dex 拉取仍与 apps UI 关联。
- 缺点：**仍与 UI 耦合**——若连接后停留在镜像模式且未打开侧栏，则不拉 dex，未能完全修复报告的问题；
  需把连接状态接入侧栏 effect，改动面更大、更脆；代码量多于 A，风险更高。

### C. 在 `useScrcpySession` 内新增独立 `useEffect`，以 `connectionStatus === 'connected'`（及 deviceSerial 变化）为依赖，每次连接调用一次 `syncWithDevice()`

> ⚠️ **2026-07-13 修订：原草案称「C 仍有 live adb、无竞态」是错误的，已核实更正。**

- 信号可得性已核实：`connectionStatus`（`useAdbStore`）在 `connectOnce` 末尾置位
  （`useUsbConnection.ts:27` 先 `setAdb`、`:29` 再 `setConnectionStatus('connected')`），
  故 `connectionStatus === 'connected'` 信号本身可用。
- **但 `syncWithDevice` 读的 `adbRef.current` 此时为 `null`**：`useAppManager.adbRef`
  只在 `useScrcpySession.ts:110`（`startScrcpy` 内 `appManager.setAdb(adb)`）才被赋值，
  而 `startScrcpy` 由用户/自动「启动会话」触发，晚于 `connectionStatus` 翻转。
  → 按原样实现的 C 会在 `adbRef.current === null` 时触发 `syncWithDevice`
  （`useAppManager.ts:116-120` 直接 `return { toParse: [], deviceApps: new Map() }`），
  **增量 `toParse` 永不计算，dex 永不拉取——重演本报告要修的 bug。**
- 要让 C 正确，必须额外保证触发前 `adbRef.current` 已置位，二选一：
  - (c1) 在连接 effect 内先 `appManager.setAdb(useAdbStore.getState().adb)`（即把 `startScrcpy:110`
    的赋值提前到连接时刻），再 `syncWithDevice()`；或
  - (c2) 重构 `syncWithDevice` 接受 `adb` 入参，绕过对 `adbRef.current` 的依赖。
  二者都会抵消 C「更干净/更小」的优势，使其复杂度 ≥ A。
- 优点（仅 (c1)/(c2) 修正后成立）：同步与「连接」绑定，覆盖「已连接但未启动 scrcpy 会话」
  的潜在场景（当前 UX 中侧栏仅存在于虚拟屏/桌面视图，该场景实际不存在，故收益有限）。
- 缺点：naive 实现有正确陷阱；修正后需改动 adb 传播契约或 `syncWithDevice` 签名；
  代码量与风险 ≥ A；`ControlSidebar` 触发同样冗余。

## 增量触发逻辑对 A/C 的约束（关键对比）

「增量更新」= `syncWithDevice` 用轻量 DEX 拉取设备当前列表，与 `AppInfoCache`/`DeviceAppsStore`
逐包比对 `versionCode`，仅把新增/变更的包纳入 `toParse`，再对 `toParse` 跑全量 dex（`parseAllApps`）。

> **设备端能力约束（评审澄清）**：设备 fetcher（`deviceParser.parseAllApps`）经 `app_process`
> 一次性 dump 全部应用元数据，**不支持只取 `toParse` 子集**。`parseAllApps` 内部已对每个包做
> `versionCode` 比对、仅把变更项写入缓存（`app-info-service.ts:58-77`）。因此「增量」的真实语义是：
> **仅在有变更（`toParse>0`）时跑一次全量 dex，且只写差异到缓存**，而非每次都重写。
> `syncAndParseIfNeeded` 的 `if (toParse.length > 0)` 门控正是这个语义，忠实还原 `f7391bb`，
> 与 ADR 中 `parseAllApps(toParse)` 的简写记号（parseAllApps 实际不接收 toParse 参数）不矛盾。

该逻辑**要正确运行，必须同时满足两个前置条件**：

1. **live `adb` 句柄**（`fetchQuickPackageList` 与 `parseAllApps` 都依赖它）；
2. **正确的 `deviceSerial`**（读/写对应设备的缓存）。

| 维度 | 方案 A（startScrcpy 内注入） | 方案 C（connectionStatus effect，naive） | 方案 C（c1/c2 修正后） |
|---|---|---|---|
| 触发时 `adbRef.current` | ✅ 已置位（`:110` 同步赋值后紧接触发） | ❌ 仍 `null`（`setAdb` 在更晚的 `startScrcpy`） | ✅ 需额外 `setAdb` 或传参 |
| 增量 `toParse` 是否真实计算 | ✅ 是 | ❌ 否（空返回，等于没修） | ✅ 是 |
| 与 scrcpy 生命周期耦合 | 是（每次 start 一次） | 否（每次 connect 一次） | 否 |
| 覆盖范围（未启会话即连接） | 不覆盖（但当前 UX 无此路径） | 覆盖（但当前 UX 无此路径） | 同左 |
| 改动量 / 风险 | ≈8 行、低风险 | 看似小、实则**引入回归** | ≥ A（需改 adb 契约或签名） |

**结论**：增量 `toParse` 计算的可靠性完全取决于「触发时 `adbRef.current` 是否已置位」。
方案 A 复用现存的、已验证的 `appManager.setAdb(adb)` 单一调用点，构造上保证该前置条件；
方案 C 的 naive 形式在 `adbRef.current` 仍为空时触发，等于把要修的 bug 原样保留。
因此**方案 A 在增量触发语义下严格优于 naive C**，而修正后的 C 既不更简单也不更覆盖当前 UX，
故 A 为唯一稳妥选择。

## Consequences（影响）

- 采用 A/C 后：初次连接即确定性拉取 dex，修复报告问题；`ControlSidebar` 的 `=== 0` 闸门在常规连接后大多不再触发（无害）。
- `DeviceAppsStore`/`AppInfoCache` 的对账逻辑（`app-info-service.ts:120` `syncWithDevice`、
  `:39` `parseAllApps`）保持不变，无需改动。
- 已知对账边界（非回归）：`DeviceAppsStore.setAll` 只 `put` 不删，卸载包残留孤儿记录，仅手动清缓存可移除。

## 实施记录（2026-07-13）

- **改动文件**：
  - `src/lib/app-info-service.ts`：新增 `syncAndParseIfNeeded(adb, deviceSerial, signal?)`，
    先 `syncWithDevice` 比对，仅 `toParse>0` 才 `parseAllApps`（增量解析）。
  - `src/hooks/scrcpy/useAppManager.ts`：新增 `syncAndParseIfNeeded` 回调（读 `adbRef.current`
    + `deviceSerial` 后委托 service），并加入返回对象与 memo deps。
  - `src/hooks/scrcpy/useScrcpySession.ts`：在 `startScrcpy` 的 `appManager.setAdb(adb)` 之后，
    注入 `appManager.syncAndParseIfNeeded().catch(...)`（fire-and-forget，不阻塞会话启动）。
  - `src/lib/app-info-sync-trigger.test.ts`（新增）：`syncAndParseIfNeeded` 回归测试，见下。
- **验证**：
  - 新增测试 5 项全过（空缓存→全量解析+Store 填充 / versionCode 全匹配→不解析 / 单包变更→仅该包解析 /
    可重复调用不抛错 / 空列表安全 no-op）。
  - 本人源码改动 + 新测试文件经 `tsc -b --noEmit` **零类型错误**。
  - 全量 `vitest` 运行：`43 failed | 232 passed`。经 stash 源码改动后的**基线对比**，
    失败数同样是 `43 failed`（集中于 `app-info-integration` / `app-info-cache` /
    `user-preferences-store` / `adb-media-commands` / `app-info-service` 等**既存、未改动**文件，
    均属旧 API 不匹配或 `fake-indexeddb` key 问题的既有技术债）。**本次改动零新增失败、零回归。**
- **未做**：`ControlSidebar` 挂载触发保留（防御纵深，见点 2）；重连重同步已由 `startScrcpy` 重入自动覆盖（点 3）。

### 代码评审结论（2026-07-13， Standards + Spec 双轴）

- **核心实现正确**：Spec 轴曾质疑「`parseAllApps` 重解析整个设备列表而非仅 `toParse`」，
  核实为对设备端能力（fetcher 一次性 dump 全部元数据、不支持子集）的误读；
  `parseAllApps` 内部已按 `versionCode` 比对、仅写差异到缓存，且 `toParse>0` 门控确保
  「有变更才跑一次全量 dex」——忠实还原 `f7391bb`。**未改核心逻辑。**
- **已修正（轻量）**：
  - 测试名「adb 为 null 时…」实际测的是空列表路径 → 更名为「设备应用列表为空时…」。
  - `syncAndParseIfNeeded` 注释「同步自带重入守卫」措辞模糊 → 精确为
    「syncWithDevice 自带重入守卫（syncing 标志）」。
  - 新增「设备端能力约束」说明，澄清真实增量语义与 ADR 中 `parseAllApps(toParse)` 简写记号。
- **残留局限已解决（2026-07-13 跟进）**：已在 `src/hooks/scrcpy/useScrcpySession.sync-guard.test.tsx`
  引入 `@testing-library/react` + `jsdom` 基建，渲染 `useScrcpySession` 并断言 `startScrcpy`
  触发 `appManager.syncAndParseIfNeeded`（含重连重入两次调用）。该端到端断言守护「调用点」本身——
  若有人删除 `startScrcpy` 内的 `syncAndParseIfNeeded()` 调用（即 9afad53 式回归），测试将变红。
  同时清理了 5 个过期测试文件的既有技术债（`app-info-cache`/`app-info-integration`/
  `app-info-service`/`user-preferences-store` 的复合键 API 重写、`adb-media-commands` 因
  `getMediaSession`/`dispatchMediaKey` 被过度删除导致的 build 断链——已还原到新
  `media-commands.ts` 并修正导入），全量 `tsc -b --noEmit` 与 `vitest run` 均 0 失败。

## Open Questions（grilling 待决议）

1. ~~注入策略选 A 还是 C？~~ **已澄清：增量 `toParse` 计算依赖触发时 `adbRef.current` 已置位，
   naive C 会重演 bug，修正后 C 复杂度 ≥ A 且无额外覆盖收益，故锁定 A。**

2. **`ControlSidebar` 挂载触发用于什么场景？移除是否影响用户？**
   - 场景：`ControlSidebar.tsx:228` 挂载 `useEffect`→`refreshSidebarApps()`（:185）。
     其唯一自动角色是**空 Store 兜底**——仅当 `getAllDeviceApps().length === 0` 才
     `syncWithDevice()`+（必要时）`parseAllApps()`；非空则直接读现有缓存排序展示。
     手动「刷新/全量重解」按钮（:187/:277）与挂载触发相互独立，移除挂载触发不影响手动刷新。
   - 移除影响：常规路径**无影响**（方案 A 已在 `startScrcpy` 先于侧栏挂载填充 Store，
     此时 `=== 0` 判否，挂载触发本就是 no-op）；仅在「A 的同步瞬时失败 / 用户手动清缓存
     (`clearDeviceApps`/`clearAll`) 后仍在当前视图内」时，侧栏失去自动回填能力，
     需用户点一次手动刷新。属可恢复的小幅降级，非硬断裂。
   - **建议：保留**作防御纵深（零成本、带重入守卫、仅在 Store 全空时激活），不作删除。

3. **重连是否重同步？「重同步」指什么？**
   - 含义：重连（ADB 掉线后 LinkSupervisor 重连）后，是否重新跑增量校验
     （`syncWithDevice` 的 versionCode 比对 → 仅变更包入 `toParse` → `parseAllApps(toParse)`）。
   - 关键事实：`useScrcpySession.ts:272-279` 的 `reconnect` 回调**会重新调用 `startScrcpy`**
     （`await startScrcpy(adb, canvas, displayConfigRef.current)`）。方案 A 的触发点就在
     `startScrcpy` 内 `setAdb` 之后，故**重连天然重跑 `syncWithDevice`**——「重连重同步」在 A
     下自动成立，无需额外代码。
   - 用户提出的「做校验，校验不通过就再拉」——这正是 `syncWithDevice` 的内置语义：
     它本身就是一次轻量校验（设备当前列表 vs 缓存 versionCode 比对），`toParse` 非空即
     「校验不通过」，随即只对 `toParse` 跑全量 dex。无需另写校验逻辑，增量 diff 即校验。
   - 边界：若未来重连改走「不重入 `startScrcpy`、仅 `session.start` 恢复」的路径，A 的触发会
     漏掉重校验；当前代码走 `startScrcpy`，故暂不须额外挂钩。
   - **结论：采用 A 后，重连重同步已自动覆盖；无需额外机制。**

4. **是否补回归测试？→ 建议：补，且分三层（见下方测试建议）。**

## 测试建议（回归防护，点 4）

目标：防止 `9afad53` 式「连接级同步被悄悄删除」重演，并固化增量校验语义。基于现有
vitest 基建（`app-info-service.test.ts` 已覆盖 `syncWithDevice`；`session-manager-launch-gate.test.ts`
用 `useAdbStore.setState` 模拟连接）。

**实施结果**：新增 `src/lib/app-info-sync-trigger.test.ts`，mock `DeviceAppParser`
（`fetchQuickPackageList` + `parseAllApps`）与 `AppInfoCache`（`cache.get`/`setAll`），
用真实 `DeviceAppsStore`（fake-indexeddb 已全局装配）断言：

1. **删除防护 + 增量正确性（已落地）**：
   - 空缓存 → `toParse` 全量 → `parseAllApps` 被调用一次，且真实 `DeviceAppsStore` 被填充；
   - versionCode 全匹配 → `parseAllApps` **不被调用**（校验通过不重拉），但 `DeviceAppsStore` 仍由
     `syncWithDevice` 填充；
   - 单包 versionCode 变更 → 仅该包入 `toParse` 并触发一次全量解析（校验不通过才再拉）。
   这几条既防「触发被删」、又固化「`syncWithDevice`=校验、`toParse`=差异」语义。
2. **重连重校验（单元层已落地）**：「可重复调用（模拟重连重入）不抛错，且第二次同步仍正常」
   一条，验证重复触发的安全性；端到端重连路径由 `LinkSupervisor.reconnect` 重入 `startScrcpy`
   保证（点 3 结论），无需额外 hook 测试基建（当前未引入 `@testing-library/react`）。

优先级：1 + 2 必做（直接防护回归 + 固化增量语义）；端到端重连断言为加分项（受限于测试基建）。

## Glossary（ ubiquitous language）

- **dex 拉取 (dex fetch)**：向设备推送 `AppInfoFetcher.dex` 并经 `app_process` 执行，读取包名/label/icon/versionCode。
- **syncWithDevice**：`AppInfoService` 方法，用轻量 DEX 拉取设备当前应用列表，与 IndexedDB 缓存比对，返回 `toParse`。
- **toParse**：需要全量 dex 解析的包名集合（新增或 versionCode 变更）。
- **DeviceAppsStore**：按 `deviceSerial+packageName` 复合键的 IndexedDB 商店，存应用记录（versionCode、pin/launch 计数）。
- **AppInfoCache**：按 `deviceSerial+packageName` 复合键的 IndexedDB 缓存，存 label/icon/versionCode。
- **连接级自动同步 (connection-level auto-sync)**：在设备连接建立的时刻触发 `syncWithDevice`，而非依赖 UI 挂载。
- **空 store 闸门 (empty-store gate)**：仅当 `DeviceAppsStore` 为空才触发同步的条件。
