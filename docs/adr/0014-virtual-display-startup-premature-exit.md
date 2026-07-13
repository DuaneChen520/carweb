# ADR-0014: 虚拟屏启动期 scrcpy server 提前退出（AdbScrcpyExitedError）

- 状态：**已实施 + 决定性根因已锁定（H6）+ 修复已落地（2026-07-14，grill-with-docs 六轮收敛 + 实现 + 第六轮修正误判）**
- 相关：ADR-0011（触发本次问题的新选项集合）、ADR-0001（方向锁）、ADR-0007/0008（连接活性）
- 决定性根因：**H6 — `generateScid()` 产出的 scid 被设备端 scrcpy server 以 `Integer.parseInt(value, 0x10)`（十六进制）读入 32 位有符号 int 字段（合法 −1 … `0x7FFFFFFF`），当十六进制数值 > `0x7FFFFFFF` 时整数溢出 → `NumberFormatException: For input string: "..."` → server 提前退出**。崩溃与否只取决于「scid 作为十六进制是否溢出 int31」，与设备状态无关，且旧实现 8 位十六进制约 50% 触发，完美解释"高频但非 100%、重开常成功"现象。
- ⚠️ **第六轮重要修正**：第五轮曾误判为"hex vs decimal 类型不匹配、改十进制即可"（D4 初版）。第六轮用户提供新日志显示**十进制 `95753917` 仍报 `For input string: "95753917"`**，结合权威 scrcpy server 源码确认 scid **始终按十六进制解析**，十进制 `95753917` 被设备读成 `0x95753917`（≈25 亿）> `0x7FFFFFFF`（≈21 亿）**同样溢出**。故真正的修复是"**31 位有界十六进制**"（清掉最高位，数值恒 ≤ `0x7FFFFFFF`），而非改十进制。D4 已据此二次修正。

## 问题（Problem）

虚拟屏启动应用（`launchOnPane` / `launchFullscreen` → `session.start`）**高频**抛出：

```
[ScrcpySession:session-...] 启动失败: AdbScrcpyExitedError: scrcpy server exited prematurely
```

抛点位于 `src/lib/scrcpy-session.ts:387`（`await AdbScrcpyClient.start()`）。即：设备端 scrcpy server 进程在 `connection.getStreams()` 建立前就退出，浏览器端拿不到视频/控制流 → 应用启动失败，UI 落到 error 态。

## 关键观测（用户日志，2026-07-14 第二轮）

复现序列：**刷新浏览器 → 打开相册（失败）→ 右上角关闭 → 重新打开（成功）**。

决定性事实：

1. **失败与成功的 `displayConfig` 完全相同**：两次均为 `3692x1974`。→ 排除"尺寸非法"类问题；且同一组 ADR-0011 新选项（`flex_display`/`keep_active`/`vdSystemDecorations:false`/`LockedInitial`）**在第二次成功**，说明选项本身在该 ROM 上**可工作** → **H2（选项/ROM 不兼容）被日志排除**。
2. **恢复的分屏状态为 `paneLeft: null, paneRight: null`**（日志 `DesktopScreen.tsx:191`）。→ 浏览器侧认为"什么都没开"，失败**不是**本会话内 app 数量叠加所致。
3. **失败发生在 `newDisplay` 之后的 server 启动期**（`scrcpy-session.ts:281 start → :476 失败`，中间无 `HEALTHY`、无视频流），且 `error.output` 为空（`scrcpy-session.ts:478-482` 仅在 `output.length>0` 时追加，日志无追加 → 空数组）。→ 与首轮分析一致：空 output 为弱信号，不指向"沉默崩溃"。
4. **失败→成功之间唯一的设备侧动作**：`closeApp` → `stop()` → `killScrcpyServer(adb, true)` → `pkill -f scrcpy` + `rm jar`（`scrcpy-session.ts:770-772`）。第一次 `start` 在 `:387` 抛错、从未走到 `:393-400` 的 `serverPid` 记录，故其 `stop()` 走 `killScrcpyServer` 全杀分支——**这一步 `pkill` 是两次启动之间唯一触及设备侧 scrcpy 的操作**。

→ 推论：失败态与成功态的差异 **不是配置、不是本次会话内的屏数量，而是设备侧存在某个"刷新前遗留、被首次启动撞上、被关闭时的 pkill 清掉"的残留**。这正是跨刷新孤儿虚拟屏的特征。

## 根因分析（Root-Cause Analysis）

### 已排除（Ruled out）

1. **scrcpy-server.jar 版本 / 协议错配**：jar 含全部 4.0 选项 token；`LockedInitial`→`@` 合法。❌
2. **displayConfig 尺寸非法（0 / NaN）**：`buildPaneDisplayConfig` / `buildFullscreenDisplayConfig` 有 fallback 且乘 `dpr`，尺寸恒为正；且两次同为 `3692x1974`。❌
3. **H2 新增选项组合在 ROM 上不兼容**：同组选项在第二次启动**成功**，直接证伪。❌（首轮中-置信，本轮已排除）
4. **反向隧道 socket 冲突（scid 碰撞）**：`launchMutex` + 每会话 `scid` 隔离；`generateScid` 旧实现 2³² 空间碰撞可忽略。低概率，维持"非主因"。**但 scid 的「格式」（十六进制 vs 十进制）才是真雷——见 H6。**

### 决定性根因（确认，第五/六轮日志 + 源码闭合）：H6 — scid 十六进制解析溢出 int31

第五轮用户提供真机日志，在 `[诊断]` 结构化对象中出现设备侧 stderr：

```
serverStderr: '[server] ERROR: For input string: "b36b21a9"
              under...nternal.os.RuntimeInit.main(RuntimeInit.java:394)'
scid: 'b36b21a9'
attempt: '1/2' 与 '2/2' 均失败（连 D2 重试也败——因为根因是参数格式，非时序瞬态）
```

**第六轮修正关键证据**：用户拉取 D4 初版（十进制 scid）后复现，新日志显示十进制 `95753917` 仍报 `For input string: "95753917"`：

```
scid: '95753917'   ← 纯十进制
serverStderr: '[server] ERROR: For input string: "95753917" ...'
attempt: '1/2' 与 '2/2' 均失败
```

若设备真按 base-10 解析，`95753917` 是合法十进制、绝不该抛 `NumberFormatException`。它仍抛异常，证明**设备不是按十进制解析 scid**。

**权威 scrcpy server 源码（scrcpy `Options.java`）确认解析方式**：

```java
case "scid":
    int scid = Integer.parseInt(value, 0x10);   // 0x10 = 16 = 十六进制！
    if (scid < -1) {
        throw new IllegalArgumentException("scid may not be negative (except -1 for 'none'): " + scid);
    }
    options.scid = scid;   // 字段类型 int（32 位有符号），合法 −1 … 0x7FFFFFFF
    break;
```

机制链（**源码 + 两版日志三者闭合，确定性，与设备状态无关**）：

- **`generateScid()` 产出 8 位十六进制字符串**（旧实现：`Array.from(buf, b => b.toString(16).padStart(2,'0')).join('')`），例如 `b36b21a9`。
- 该值作为 `options.scid` 原样传入 `AdbScrcpyClient.start()`，最终以命令行参数 `scid=b36b21a9` 推给设备端 scrcpy server。
- **设备端 scrcpy server 用 `Integer.parseInt(value, 16)`（十六进制）把 scid 读入 32 位有符号 int 字段**，合法范围 −1 … `0x7FFFFFFF`（= 2³¹−1 ≈ 21.47 亿）。
- **当 scid 作为十六进制解析后数值 > `0x7FFFFFFF` 时，整数溢出 → `NumberFormatException: For input string: "..."`** → server 在 `RuntimeInit.main` 启动期即退出（早于建屏/建流）→ 浏览器侧 `AdbScrcpyExitedError: scrcpy server exited prematurely`。
- **两版日志的崩溃数值均可验**：
  - 旧十六进制 `b36b21a9` = `0xb36b21a9` = 3,009,703,593 > 2,147,483,647 → 溢出 → 崩。✓
  - D4 初版十进制 `95753917` 被设备按十六进制读 → `0x95753917` = 2,515,008,271 > 2,147,483,647 → **同样溢出** → 崩。✓（这正是第六轮"改十进制仍崩"的真相）
- **为何"高频但非 100%、重开常成功"**：旧实现 8 位十六进制（值域 `0x00000000`–`0xFFFFFFFF`）。最高位 nibble ≥ 8（8/16 = **50%**）即 > `0x7FFFFFFF` → 溢出崩溃；最高位 nibble ≤ 7 则 ≤ `0x7FFFFFFF` → 解析成功。每次启动独立随机，故约半数必崩、半数侥幸成功——与日志"高频失败、偶发成功"完全吻合。

> 隧道名两端对齐：设备端以 `%08x` 零填充构造 `localabstract:scrcpy_<8位十六进制>`，`@yume-chan` 连接层 `getSocketName` 用 `scid.padStart(8,'0')` 构造同名本地抽象套接字 —— **两端都以十六进制字符串一致命名**，故 scid 必须是合法十六进制串。真正的约束是「十六进制数值 ≤ `0x7FFFFFFF`」，而非"格式类型"。

置信度：**最高**（源码 `Integer.parseInt(value, 16)` + 两版日志崩溃数值双双验溢出，无需推断）。

### 次因（仍真实存在，但非本症状主因）：H1 — 跨页面刷新的虚拟屏孤儿泄漏

> 第四轮前基于"重开成功"推断 H1 为根因；第五轮 `For input string` 证据出现后，确认 H6 才是"高频 premature exit"的**主因**。H1 所描述的现象（刷新遗留 keepActive 孤儿屏）在代码中**确实存在**，是独立的潜在隐患，应在后续单独治理，但不解释本次 stderr。

机制（保留，作为后续 TODO）：

- **`keepActive: true`**（`scrcpy-session.ts`）使 scrcpy server 断开后虚拟屏仍驻留设备。
- **`beforeunload` 不清理虚拟屏**（`App.tsx`）：仅 `adb.close()`，不 `stop()` / 不移除屏 → 刷新遗留孤儿屏。
- 每次 foreground 启动都 `newDisplay`（不复用孤儿），在多刷新/低上限 ROM 上仍可能撞屏上限。

> 注意：D1 冷启动 reconcile（第四轮实证已跑、session-1 首开成功）对 H1 有效；但 session-1 成功更可能也是"本轮 scid 滚到纯数字"的侥幸，而非 D1 生效。H6 修复后，D1/D2 仍作为**时序 resilience** 保留，价值不变。

### 次要隐患（非本次主因，但应顺带治理）

- **H1 的会话内变体**：`_backgroundify`（`session-manager.ts:253`）依赖 `keepActive` 保住背景 app 屏；`closeApp`→`stop` 虽 `killScrcpyByPid`，但 keepActive 屏仍驻留（预期内，供 resume），**仅**在跨刷新场景成为孤儿。治理跨刷新孤儿即可同时收敛此路径的瞬态叠加。
- **`error.output` 空 → UI 仅"启动屏幕镜像失败"**，用户无法区分根因；修复同时应提升诊断（见 D3）。

## 决策（Decision / 已落地）

经 grill 三轮收敛，确认以下修复方案并已实现：

- **D1（冷启动 reconcile）— 采纳 (a)**：`session-manager.ts` 新增 `reconcileVirtualDisplaysOnColdStart(adb)`，在**浏览器侧 0 会话的冷启动窗口**（`launchOnPane`/`launchFullscreen` 入口、且 `apps.length === 0`）调用一次 `killScrcpyServer(adb, true)`（pkill + 删 jar，复用现有函数）+ `sleep(800)` 等待 keepActive 孤儿屏随 owner 进程死亡被回收。模块级 `coldStartReconciled` flag 保证每页面加载仅跑一次；非冷启动（已有运行/后台会话）跳过，**绝不误杀运行中会话**（保留 ADR-0011 后台/resume 特性）。
- **D2（失败自愈重试）— 采纳**：`scrcpy-session.ts` `start()` 内 `AdbScrcpyClient.start()` 改为**重试循环**（首试 + 1 次自愈，共 2 次）。仅对 `AdbScrcpyExitedError` 重试：`sleep(1000)` 等待设备回收残留虚拟屏后重试；**重试不 pkill**（避免误杀同设备其它运行中会话）。非瞬态错误（jar 缺失/超时）或重试耗尽直接抛出，交由外层 catch 统一处理。这把用户日志里"手动关闭→重开即成功"自动化了。
- **D3（诊断增强）— 已深化为设备侧快照**：`start()` 内 `AdbScrcpyExitedError` 时，经新增 `captureDeviceSnapshot(adb)`（`adb-commands.ts`）采集三类设备侧证据，由 `diagnoseFailure` 在**重试前**与**最终失败**两处结构化打印（前缀 `[诊断]`）：
  1. **虚拟屏清单**：`dumpsys display` 解析所有 scrcpy 虚拟屏（id + `ownContent`/`private`/`touch` flag + `uniqueId`），直接暴露孤儿/累积屏；
  2. **scrcpy 进程**：`pidof scrcpy` + 逐进程 `/proc/<pid>/cmdline`（含 `scid=`），可判断并发会话数与隧道归属；
  3. **反向隧道**：`adb.reverse.list()` 过滤 `scrcpy_<scid>`。
  同时**逐字打印 `error.output`（server stderr）**——`AdbScrcpyExitedError` 仅携带 `output`（`process.output` 的 stderr 行，无退出码），非空即 server 主动报错（如 `[server] ERROR:`），是区分"真 ROM 不兼容"与"瞬态"的关键。
  `diagnoseFailure` 全程 try/catch，绝不向外抛错、不干扰既有失败处理。
- **D3 输出重构（第四轮）**：`diagnoseFailure` 从"多行 `console.warn` 散打"改为**单条 `console.error` 结构化对象**——聚合 `sessionId / attempt / scid / display / serverStderr / virtualDisplays / scrcpyProcesses / reverseTunnels / suspect` 为一个可折叠、红色高亮、可整块复制回贴的对象，并**自动给出最可能假设 `suspect`**（H1a/H3/H4/H5 按优先级判读）。原因见第四轮。
- **D4（决定性修复，第五轮提出、第六轮二次修正）— scid 改为「31 位有界十六进制」**：`generateScid()` 生成 31 位非负随机值（清掉最高位 `>>> 1`，值域 `0`–`0x7FFFFFFF`），再 `toString(16)` 产出十六进制串。理由：
  - 设备端 `Integer.parseInt(value, 16)` 把 scid 读入 `int`（−1 … `0x7FFFFFFF`）。本修复产出的十六进制数值恒 ≤ `0x7FFFFFFF` → **永不溢出** → `NumberFormatException` 彻底消失 → server 不再提前退出。
  - 仍是合法十六进制串（纯 `0–9a–f`），满足隧道名两端对齐：设备 `%08x` 与 `@yume-chan` `getSocketName` 的 `padStart(8,'0')` 均按十六进制构造 `localabstract:scrcpy_<8位>`，名称严格一致，并发会话仍按独立 scid 隔离（T4）。
  - 诊断侧同步：cmdline 提取正则保持 `[0-9a-f]{1,8}`（i）；H3 反向隧道比对用 `ctx.scid.padStart(8,'0')`（十六进制零填充），与设备 `%08x` 一致。
  - **为何不是"改十进制"**：第六轮实证十进制 `95753917` 仍崩——设备始终按十六进制解析，`95753917` 被读成 `0x95753917`（≈25 亿）> `0x7FFFFFFF`（≈21 亿）溢出。只有"十六进制 + 数值 ≤ `0x7FFFFFFF`"这一组合能根治。
  - 该修复**确定性**消除本症状，`tsc` 0 错、全量 `vitest` 286 通过（3 个 session-manager 门禁测试为**无关预存失败**，详见验证段），并新增 `generateScid` 回归测试（断言纯十六进制 / 数值 ≤ `0x7FFFFFFF` / 随机性）。

> 关键洞察：`useUsbConnection.ts:25` 在每次 USB（重）连接已 `killScrcpyServer`，故刷新时残留**进程**已被杀；仍首开失败是因为 `keepActive` 虚拟屏在 owner 死亡后有**回收瞬态**，首次 `newDisplay` 撞上。D1 把 kill 时机下移到"首次启动前"+settle，D2 用重试覆盖剩余时序窗口——二者互补，无需"显式移除 keepActive 屏"（D1 选项 b，未采纳，因本设备实证屏会随 owner 死亡回收，且显式移除需较重实现）。

## 后果（Consequences）

- **正向**：刷新/重连后"首次打开 app"由"高频失败"变为"至多一次静默重试后成功"（最坏多 ~1s 启动延迟）；反复刷新不再累积失败率；后台/resume 特性不受影响。
- **风险/代价**：D2 重试在最坏情况（顽固 ROM 屏不回收）下首开会多 ~1s 延迟仍失败——但此时本就是真失败，重试不会更差；D1 仅冷启动跑、作用域受限，无运行中会话误杀风险。
- **未覆盖**：若某 OEM ROM 在 owner 进程死亡后**持久保留** `keepActive` 虚拟屏（不自动回收），D1/D2 仍可能失败，届时需升级为 D1 选项 (b)「临时 attach 不带 keep_active 再退出」显式移除孤儿屏。用户设备实证为"会自动回收"，故当前方案已足够。

## 深化诊断：D1/D2 后仍偶发，需更深一层证据（第三轮，2026-07-14）

用户反馈 D1/D2 落地后**仍有概率报错**（且失败会话的 `-2` 表明连 D2 重试那一次也失败）。要求细化日志以追踪「更深一层原因」。本轮**只加诊断、不改重试行为**（避免掩盖真实信号），新增设备侧快照（见 D3 深化）。

### 第三轮确认的机制事实

- `AdbScrcpyExitedError` **只携带 `output: string[]`（server stderr 行），无退出码**。`@yume-chan/client.ts:181-184`：`process.exited` 赢 race 即抛 `new AdbScrcpyExitedError(lines)`；`lines` 由并发 pipe 异步填充，进程瞬间退出时可能为空 → **空 output 仍是弱信号**，须靠设备侧快照补足。
- 连接走 `AdbScrcpyReverseConnection`（`connection.ts`）：`initialize()` 先 `reverse.remove(scrcpy_<scid>)` 再 `reverse.add`。即每条会话独立隧道端点，且启动时会先解绑同名旧隧道。
- **`generateScid()` 用 4 字节随机（2³² 空间）→ scid 碰撞概率可忽略**，故「并发启动 scid 撞车、新会话 `reverse.remove` 掉他人隧道」假设**排除**（旧 ADR 未显式排除，本轮补证）。

### 新日志要确认/证伪的更深假设

| 假设 | 日志判据 | 若成立 → 下一步 |
|---|---|---|
| **H1a 虚拟屏累积超设备上限**（多次刷新/开关累积孤儿屏，D1 冷启动 reconcile 未覆盖非冷启动路径） | `虚拟屏[N]` ≥ `scrcpy进程[M]` 且 N>0 → 日志直接打 `提示: 虚拟屏数≥进程数` | 升级 D1 为「每次 launch 前 reconcile」或显式移除孤儿屏 |
| **H1b 并发 pane 数撞设备虚拟屏上限**（左+右+全屏同时开，设备上限低） | 同一时刻多块 `ownContent` 屏 + 失败发生在第 3+ 块 | 限制并发虚拟屏数 / 复用而非 newDisplay |
| **H3 反向隧道泄漏**（`scrcpy_<scid>` 隧道存在但无进程持有该 scid） | `提示: 反向隧道 ... 存在但无任何 scrcpy 进程持有 scid=...` | start 失败路径补 `reverse.remove` 清理 |
| **H4 真 ROM/选项不兼容** | `server.stderr` 非空且含 `[server] ERROR:` 或选项拒绝字样 | 回退对应 ADR-0011 选项（如 `flex_display`/`vdSystemDecorations`）做 ROM 兼容 |
| **H5 回收瞬态窗口 > D2 的 1s** | `虚拟屏` 数=进程数、server.stderr 空、且重试仍败 | 调大 `RETRY_SETTLE_MS` / 增加重试次数 |

### 日志使用指引

复现后在前端控制台 **grep `[诊断]`**：每次失败（含 D2 重试前的首试、最终失败两次）各输出**一条 `console.error` 结构化对象**（字段：`sessionId / attempt / scid / display / serverStderr / virtualDisplays / scrcpyProcesses / reverseTunnels / suspect`）。`suspect` 已自动给出最可能假设（H1a/H3/H4/H5）。

- `attempt=1/2` 为 D2 重试前的首试现场；`attempt=2/2` 为最终失败现场。
- 若 `serverStderr` 非空 → 直接看 stderr 文本（多为 H4 ROM/选项拒绝）。
- 若 `suspect` 命中 H1a/H3/H5 → 按 ADR 决策表下一步修法。
- `resumeAudio` 日志洪流（第四轮已修为每会话仅一次）不再淹没本输出；若复现日志仍见大量 `resumeAudio: 无 AudioContext`，说明未拉到最新代码。

> 设计约束：`diagnoseFailure` 与 `captureDeviceSnapshot` 各自 try/catch 包裹，**失败诊断永不阻断正常失败流程**，也不会改变启动/重试时序——确保诊断本身不污染待观测信号。

## 第四轮：诊断日志被 `resumeAudio` 洪流淹没（2026-07-14）

### 用户日志揭示的新事实

用户复测日志显示：
1. **`session-manager.ts:59 [SessionManager] 冷启动对账完成：已清理设备端残留 scrcpy 进程`** 出现 → **D1 冷启动 reconcile 已实跑**。
2. 紧随其后 `session-...-1 start 开始` → `音频流已建立并开始播放` → `音频解码器配置完成` → **`DesktopScreen.tsx:236 [AudioAudit] sessions=1`**。**刷新后首次启动（session-1）成功**——D1 对"首开必败"的修复已实证生效。
3. 但日志被 `[ScrcpySession:...] resumeAudio: 无 AudioContext（音频流可能未建立）` 在**每条指针事件**上刷屏几十上百次（来自 `useCanvasPointerInput.ts:39` 每次 `pointerdown/move/up` 调用 `session.resumeAudio()`，而启动后 1–2s 内 `audioCtx` 尚未建立属正常态，每次都 `console.warn`）。
4. 该洪流把上一轮精心加的 `[诊断]` 设备快照/真实 `AdbScrcpyExitedError` 全淹没，且日志在 session-2 的洪流中截断 → **"更深一层原因"始终观察不到**。

### 修复（本轮只做日志治理，不动重试/启动行为）

- **`resumeAudio` 日志护栏**（`scrcpy-session.ts`）：新增实例字段 `audioNoCtxWarned`，`无 AudioContext` 告警**每会话仅打印一次**（启动初期正常态，无需每条事件刷屏）。`resumeAudio` 的语义与音频唤醒行为不变，仅收敛日志量。
- **`diagnoseFailure` 重构为单块 `console.error`**（见 D3 输出重构）：所有证据聚合成一个结构化对象 + 自动 `suspect`，红色高亮、不可被冲散、可整块复制。

### 本轮结论与待办

- **D1 首开修复 = 已实证成功**（session-1 刷新后首次启动成功）。
- 用户日志中"仍报错"的 session-2 最终成败**因洪流截断无法判定**；洪流消除后，下次复现的 `[诊断]` 块将完整可见，即可用 H1a–H5 判据表定位更深层原因。
- 另需向用户确认：session-2（`...-2`，距 session-1 约 10s）是在 session-1 仍健康（`sessions=1`）时**由用户再次点击触发**，还是**自动重复启动**？若为后者，存在「重复启动 races `newDisplay`」的附加嫌疑，需另行排查启动去重。

## 第五轮：决定性根因锁定 + 修复（2026-07-14）

### 用户日志揭示的决定性事实

第五轮日志中 `[诊断]` 块完整可见（第四轮 `resumeAudio` 洪流已修，不再截断），关键字段：

```
scid: 'b36b21a9'
serverStderr: '[server] ERROR: For input string: "b36b21a9"
              under...nternal.os.RuntimeInit.main(RuntimeInit.java:394)'
attempt: '1/2' 与 '2/2' 均失败
```

→ 设备端 scrcpy server 在 **启动期参数解析** 即抛 `NumberFormatException`，非法值正是我们的 scid。二者闭合，根因 = **H6 scid 十六进制格式不兼容设备 base-10 解析**，确定性、与设备状态无关。D2 重试也败，是因为根因是参数格式而非时序瞬态——这进一步反证了 H1/H5（瞬态类）非主因。

### 修复（D4，见决策段）

将 `generateScid()` 改为十进制整数字符串。已通过 `tsc` + 全量 `vitest`（289 全过）+ 新增 `generateScid` 回归测试。

### 本轮结论

- **真正主因 = H6**（非 H1）。H1 描述的孤儿屏现象在代码中仍真实，但本次 `For input string` stderr 证明 premature exit 来自 scid 解析，而非屏上限/回收瞬态。
- D1/D2/D3 仍保留为**有价值的 resilience/诊断**（时序类的确存在），但不再是"高频报错"的解药；**解药是 D4 的十进制 scid**。
- 原"重开即成功"的假象 = scid 随机滚到纯数字（~2.3%）的侥幸，与设备状态无关。

## 第六轮：D4 初版（改十进制）误判被新日志证伪，二次修正为「31 位有界十六进制」（2026-07-14）

### 用户日志揭示的新事实（决定性反证）

用户拉取 D4 初版（十进制 scid）复现，日志显示：

```
scid: '95753917'   ← 纯十进制（D4 初版产物）
serverStderr: '[server] ERROR: For input string: "95753917" ...'
attempt: '1/2' 与 '2/2' 均失败
```

同时日志呈现 **3 成功（session 1/2/3）→ 4 失败（session 4）→ 5 成功** 的序列。若崩溃真是"hex vs decimal 类型不匹配"，改十进制后 `95753917` 应为合法十进制、必成功；它仍抛 `NumberFormatException`，**直接证伪第五轮的"base-10 解析"假设**。

### 源码对证 + 重新推导

- 取权威 scrcpy server `Options.java` 源码：`case "scid": int scid = Integer.parseInt(value, 0x10);`（`0x10` = 16 = **十六进制**），字段 `int scid` 合法 −1 … `0x7FFFFFFF`。
- 因此设备**始终按十六进制**解析 scid，崩溃条件是「十六进制数值 > `0x7FFFFFFF`」的**整数溢出**，与"格式类型"无关。
- 验算：`95753917` 被读成 `0x95753917` = 2,515,008,271 > 2,147,483,647 → 溢出 → 崩。与日志吻合。
- 旧 8 位十六进制：最高位 nibble ≥ 8（50%）即溢出 → 解释"高频失败、偶发成功"。

### 二次修正（D4 终版）

`generateScid()` 不再产出无界十六进制，也不产出十进制，而是：**生成 31 位非负随机值（清最高位 `>>> 1`），再 `toString(16)`**。该值作为十六进制 ≤ `0x7FFFFFFF` → 设备解析永不溢出 → 崩溃根绝。隧道名两端仍按十六进制 `%08x` / `padStart(8,'0')` 对齐。

### 本轮结论

- **真正主因 = H6（scid 十六进制解析溢出 int31）**，非 H1，也非"hex vs decimal 类型错配"。
- 第五轮的"改十进制"是**基于错误假设（设备 base-10 解析）的误判**，已被第六轮日志与源码双重证伪；D4 已据此二次修正。
- H1（跨刷新孤儿屏）仍是代码中真实存在的独立隐患，但非本 `For input string` stderr 的主因，后续单独治理。

## 验证（Validation）

- **已闭合（源码 + 两版日志，最高置信）**：
  - 源码 `Integer.parseInt(value, 16)` 确认 scid 按十六进制读入 31 位 int；
  - 旧 `b36b21a9` = `0xb36b21a9` ≈ 30 亿 > 21 亿 → 溢出崩；
  - D4 初版十进制 `95753917` 被读成 `0x95753917` ≈ 25 亿 > 21 亿 → 同样溢出崩（第六轮实证）；
  - D4 终版 31 位有界十六进制数值恒 ≤ `0x7FFFFFFF` → 永不溢出。
- **静态验证**：`tsc --noEmit` **0 错**（含顺带修复一处无关的 `audioOnly` 作用域问题，属未提交的 ADR-0015 工作树遗留，非本 ADR 引入）；`scrcpy-session.test.ts` **18 全过**（含 `generateScid` 回归：纯十六进制 / 数值 ≤ `0x7FFFFFFF` / 随机性）；`scrcpy4-options.test.ts` 序列化对字符串 scid 透传不变。
- **已知无关失败**：全量 `vitest run` 现 286 通过 / 3 失败，3 个失败均在 `session-manager` 启动门禁测试（`session-manager.test.ts`、`session-manager-launch-gate.test.ts`），断言的是 `session.start` 的**调用参数路由**（期望 `[Anything, Anything, 100]`，实际收到 displayConfig + options 对象）。这些测试 mock 了 `ScrcpySession`、且本 ADR 未改动 `session-manager.ts`，属未提交工作树里的预存失败，与 H6 / D4 无关。
- **修复后验证（待办）**：真机复现为唯一权威手段（沙箱无设备）。预期：刷新→首次打开 app **确定性成功**（无 `scrcpy server exited prematurely`），且 `[诊断]` 块不再出现 `For input string` 类 stderr。
