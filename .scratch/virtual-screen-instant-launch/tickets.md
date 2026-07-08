# Tickets: 虚拟屏应用启动「瞬间打开、无多次跳转」

修复虚拟屏中启动/恢复应用时出现的「多次跳转启动动画」。根因（详见诊断对话）：每次启动都重建虚拟屏 + 事后强杀 Launcher（H1，必现）；ROM 忽略 `am --display` 时走「主屏启动→move-to-display」搬运（H2）；`launchFullscreen` 用全局 `pkill` 误杀常驻分屏（路径3 缺陷）；`resumeBackground` 重建屏而非复用（路径4 缺陷）；全局 `pkill -f scrcpy` 造成黑屏停顿与分屏误杀（H3）。

官方 scrcpy 4.0 已原生支持 `--start-app`（等价 `controller.startApp`）与 `--no-vd-system-decorations`（禁用虚拟屏 Launcher），@yume-chan 层均已具备对应能力。本组工单即用官方机制替换 carweb 当前绕路的 `am` + `forceStopPackage` 方案。

Triage 标签：**ready-for-agent**（每条均可由 agent 独立领取）。

---

## 范围说明（已确认排除）

- **路径2（全屏→另一分屏覆盖旧 app）**：用户明确认可为「带覆盖确认的有意行为」，不在本组工单内。
- **路径1（分屏→全屏，已运行 app）**：`reparentCanvas` 不重启，已平滑，无需改动。

---

## T1 — 关闭虚拟屏 Launcher（vdSystemDecorations:false）

**What to build:** 新建的虚拟屏默认不再渲染任何 Launcher/桌面，从根上消除「新屏首帧是 home」这一跳。

**Blocked by:** None — 可立即开始

**状态：已完成（代码 + 单测）** — 提交于 `master`。两条真机验收因沙箱无真实设备，待实机验证（机制已由单测证明 `vd_system_decorations=false` 正确序列化）。

- [x] 选项层 `AdbScrcpyOptions4_0` 虚拟屏分支注入 `vdSystemDecorations:false`（scrcpy-session.ts:291-304 的 `useVirtualDisplay` 分支；物理屏分支 `{displayId:0}` 不受影响）
- [ ] 真实设备确认：新建虚拟屏后视频流首帧不是 Launcher 桌面（待实机）
- [ ] 真实设备确认：空屏（未启动 app）时不渲染 home 帧（仅黑/空）（待实机）

**交付物：**
- `src/lib/scrcpy-session.ts`：虚拟屏 options 注入 `vdSystemDecorations: false`
- `src/lib/__tests__/scrcpy4-options.test.ts`（新增）：断言虚拟屏分支 `serialize()` 含 `vd_system_decorations=false`，且物理屏分支不含（作用域不被误扩）

---

## T2 — 用原生 startApp 把 app 直接落到虚拟屏（替换 am 分支）

**What to build:** 启动 app 直接出现在虚拟屏，不再有「主屏启动 → move-to-display 搬运」跳转，也不再依赖 ROM 是否支持 `am --display`。

**Blocked by:** T1

**状态：已完成（主路径）** — 提交于 `master`。
- [x] `ScrcpySession.startAppOnDisplay` 改为委托 `controller.startApp(pkg)`（原生 type-16 控制消息），主路径（SessionManager→ScrcpySession→launchOnPane/launchFullscreen/resumeBackground）不再走 `am`
- [x] 移除 `ScrcpySession` 中 `ensureDisplayId` 死代码（轮询 + 500ms×5 sleep）
- [x] 单测：断言 `startAppOnDisplay` 调用原生 `controller.startApp`，不再走 adb-commands 的 am 分支
- [x] 类型修复：`scrcpy4-options.test.ts` 的 `videoCodec: 'h264' as const`（T1 遗留）
- [ ] 真实设备验证：新屏无 home 闪、目标 app 直接显示、不再发送 `am task move-to-display`（待实机）

**范围说明（落地偏差，已确认）：** 验收「移除 adb-commands 中 am 分支 + 三个 sleep」**只在主路径成立**。
`adb-commands.startAppOnDisplay`（am + 策略2 回退 + 三个 sleep）**未删除**，因为 legacy `useScrcpySession` hook（经 `ScrcpyContext` 仍接线）仍引用它。
该 hook 的 `startAppOnDisplay` 经核实**未被任何 UI 组件调用**（现代多屏路径统一走 session-manager），属「接线保留但未被调用」的兼容壳。
遵循 tracer-bullet 纪律（不越界、可独立验证），am 函数的删除折入 **T3**（本身即「清理死代码」），与 `forceStopPackage` 一并清理，并迁移/下线 legacy hook 的 am 调用。

---

## T3 — 清理启动路径死代码（forceStopPackage + am 分支 + sleep）

**What to build:** 启动路径干净：不再事后全局强杀 Launcher，且彻底移除 adb-commands 中的 am 分支与三个 sleep。home 已由 T1 根本禁用、由 T2 直接启动取代，强杀/搬运逻辑均成为死代码。

**Blocked by:** T1, T2

- [x] 删除会话 `start()`（scrcpy-session.ts）与 legacy hook（useScrcpySession.ts）中的 `forceStopPackage(homePkg)` 调用（Launcher 强杀）
- [x] 删除 `adb-commands.startAppOnDisplay` 的 am 分支（含 `am start --display` 直投、策略2「主屏启动 + `am task move-to-display` 搬运」回退、三个 `sleep` 2000/2500/1500ms）+ 其辅助函数（isPackageRunning / getAppDisplayLocations / resolveLauncherComponent / getAppTaskId）+ 局部 `sleep` 辅助
- [x] 下线 legacy `useScrcpySession` hook 对 am 分支的引用（连同 `startAppOnDisplayFn` 与 `ScrcpyContext.startAppOnDisplay` 字段一并移除；该接口无 UI 消费者，属「接线保留但未调用」的兼容壳）
- [x] 移除 `scrcpy-session.ts` / `useScrcpySession.ts` 中已无用的 `getDefaultHomePackage` / `forceStopPackage` import（注意：`forceStopPackage` 函数本身保留——`session-manager.ts` 仍用它强杀目标 app）
- [x] 代码库检索确认无遗留的 `forceStopPackage(homePkg)` 与启动 sleep

**状态：已完成。** 双轴代码审查无违规/异味；tsc 无 scrcpy 相关新增错误；44 个 scrcpy 相关单测全绿；全量套件 5 个失败文件均为预存在的 `app-info-*`/`adb-media-commands`/`user-preferences-store` 问题，无新增回归。

---

## T4 — launchFullscreen 改为叠加第 3 路并发，不再 pkill 常驻分屏

**What to build:** 应用抽屉「全屏启动」新 app 时，左/右常驻分屏继续流，不再被静默杀死（消除路径3 缺陷，并补上用户「覆盖需提示」原则在该路径的缺口）。

**Blocked by:** T2, T3

- [x] `launchFullscreen` 去掉开头全局 `killScrcpyServer(pkill)` 与对两分屏的 `backgroundify`
- [x] 仅对「上一个全屏」做 `backgroundify`（按 PID 精确 kill，不误伤）
- [x] 新全屏 session 走 T2 的 `startApp` 路径
- [x] 若全屏覆盖某分屏，复用路径2 已有的「覆盖确认」提示
- [x] 验收：全屏启动新 app 后左/右分屏仍正常流；仅上一全屏被 backgroundify；覆盖分屏时仍有覆盖确认

**状态：已完成（代码 + 单测）** — 提交 `69eb3c5`（4 文件，+120/-40）。

**落地偏差 / 新增前置（已确认并记录）：**

1. **`scid` 每会话隧道隔离是 T4 目标成立的必要条件，原先未在清单列明。**
   诊断中发现：@yume-chan 的 3_3_3/4_0 options 路径**未暴露 scid**，所有会话默认共用设备端 `localabstract:scrcpy` 隧道；后启动的会话在 `AdbScrcpyReverseConnection.initialize()` 中会 `reverse.remove(localabstract:scrcpy)`，**拆掉先启动会话已建立的隧道** → 先启动者 `AdbScrcpyExitedError`。这正是旧代码不得不用 `killScrcpyServer(pkill)` 先杀光其它会话的根因。
   因此「全屏作为第 3 路并发、常驻分屏不杀」在真机上**物理上不可行**，除非先解决隧道隔离。实现方案：每个 `ScrcpySession.start()` 生成独立 8 位十六进制 `scid`（`generateScid()`），传入 `AdbScrcpyOptions4_0`，使各会话走各自的 `localabstract:scrcpy_<scid>`（连接层 `getSocketName` 已支持 scid，base `serialize()` 自动产出 `scid=<value>`，无需手动 push）。该改为**横切**（launchOnPane/resumeBackground 等所有路径均受益），blast radius 超出 launchFullscreen，但属 T4 验收项「左/右分屏仍正常流」的前提，故在此一并落地。scid 是否被正确接受由单测证明（`scrcpy4-options.test.ts` 断言 `scid=` 序列化、且不重复）；**真机验收待实机**（确认 scrcpy-server.jar 接受 `scid=` 参数，scrcpy 4.0 原生支持）。

2. **「覆盖确认」在 launchFullscreen 路径为 N/A，非缺失。** fullscreen 是叠加在第 3 层的覆盖层，**不是分屏替换**；并发上限（§2.3 = 左+右+全屏）由启动顺序隐式保证（先 `backgroundify` 上一全屏释放 1 名额，再起新全屏，总数恒 ≤ 3），故 launchFullscreen **永远不会覆盖/替换某个分屏**，无需在该路径触发覆盖确认。覆盖确认仍由路径2（fullscreenToPane）的 `PaneSelector` 提示承担，未受影响。

3. **修正 `fullscreenToDesktop` 情况3 的测试/注释旧假设。** 原测试依赖「launchFullscreen 会 backgroundify 两分屏」的旧行为来构造「两 pane 都占」场景；T4 下该前置不再成立。已改为用 `launchOnPane`×2 + `launchFullscreen` 直接构造「两 pane 都占 + 全屏无 sourcePane」的真实可达场景，并确认情况3 代码（已为 `_backgroundify(fullscreenSessionId)`）与该语义一致。

**待办（真机验收）：**
- [ ] 真机确认：全屏启动新 app 后左/右分屏画面继续流、不黑屏、不被杀
- [ ] 真机确认：仅上一全屏被 backgroundify（画面退回常驻虚拟屏、不停流）
- [ ] 真机确认：scrcpy-server.jar 接受 `scid=` 参数（隧道隔离生效，无 AdbScrcpyExitedError）


---

## T5 — resumeBackground 复用原 displayId，不再重建虚拟屏

**What to build:** 后台常驻 app 恢复时画面瞬间回前台，无「Launcher 闪→黑→app」重建跳动（消除路径4 缺陷）。

**Blocked by:** T2, T3

- [x] `resumeBackground/_restartSession` 让会话 start() 在传入已有 `displayId` 时「接管已有屏」而非 `newDisplay`
- [x] `keepActive` 保存的 `displayId` 真正被复用，旧屏不再孤立泄漏
- [x] teardown 按 PID 精确 kill（沿用 T4 的 `killScrcpyByPid`）
- [x] 验收（单测）：`resumeBackground` 后 `start()` 以 attach 模式传入原 displayId；仅该 session 的 server 被精确 kill

**状态：已完成（与「同包名去重」bug 合并实现）** — 提交见下方。

**落地说明（与去重 bug 合并，见 T5.1）：**
- `ScrcpySession.start(adb, displayConfig?, attachDisplayId?)` 新增可选 `attachDisplayId`：提供时 options 用 `{ displayId: attachDisplayId }` 接管已有虚拟屏，`this.displayId` 直接取该值、不再 `newDisplay`/`getVirtualDisplayId`；PID 追踪与旋转锁定沿用 `useVirtualDisplay`（含 attach 模式）。
- `resumeBackground` 新增 `target?: 'pane' | 'fullscreen'`：默认 `'pane'`（保留原 §7.4 落点规则）；`'fullscreen'` 强制落全屏覆盖层、复用原 displayId、不抢占 pane。供 `launchFullscreen` 去重路由调用。

---

## T5.1 — launchFullscreen 同包名去重（修复双实例 bug）

**What to build:** 侧边栏对已运行中的 app 点「全屏启动」时，复用既有 session/屏/进程，不再拉起第 2 个实例（消除用户报告的「左分屏 + 全屏两个 minimap」双实例）。

**联动 T5：** background 分支依赖 T5 的 attach 模式，否则 resume 会重建屏（跳转回归）。

- [x] `launchFullscreen` 开头按 `packageName` 查找既有 app（优先级 foreground-pane > foreground-fullscreen > background）
- [x] `foreground-pane` → `paneToFullscreen(pane)`（reparent，零重建，画面连续）
- [x] `foreground-fullscreen` → no-op 返回（已在全屏，替代旧「backgroundify 旧全屏再新建」）
- [x] `background` → `resumeBackground(sessionId, displayConfig, 'fullscreen')`（T5 attach 复用原屏）
- [x] 未命中 → 走原有新建路径（T4 第 3 路并发不变）
- [x] 单测：左分屏 launch 同包名后 launchFullscreen → 仅 1 实例且被提升为 fullscreen；background 同包名 launchFullscreen → 复用该 session、resume 到全屏、`start()` 以 attach 模式传原 displayId

**范围外（可后续）：** `launchOnPane`/应用选择器 pane 路径同样无同包名去重（点同一 app 进另一 pane 也会双实例）；本期只修全屏路径。

---

## T6 — 将「按 PID 精确 kill」推广到所有启动/销毁路径

**What to build:** 全局 `pkill -f scrcpy` 退出历史舞台；任何会话销毁/替换只杀自身 server PID，不再误伤同屏其它 streaming 会话（消除 H3 黑屏停顿 + 分屏误杀）。

**Blocked by:** T4, T5

- [ ] 以 T4/T5 建立的 PID 精确 kill 为样板，统一 `launchOnPane` 等其余路径的销毁逻辑
- [ ] 移除 `killScrcpyServer` 的全局 `pkill` 实现，或仅保留为兜底
- [ ] 验收：无全局 `pkill -f scrcpy`；单会话销毁不影响其它 streaming 会话

---

##  frontier 推进顺序

1. T1（无阻塞，起始）— 已完成 `29b6acf`
2. T2（依赖 T1）— 已完成 `b4c43a8`
3. T3（依赖 T1、T2）— 已完成 `c7c94ae`
4. T4（依赖 T2、T3）— 已完成 `69eb3c5`
5. T5 + T5.1（依赖 T2、T3）— 已完成（本次提交）
6. T6（依赖 T4、T5）— 可领取

每条工单用 `/implement` 单独领取，工单间清空上下文。
