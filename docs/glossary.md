# 术语表（Glossary）

> 随 ADR-0010 收敛工作建立，统一「全部应用」相关概念表述。

## 组件与界面

- **VirtualScreen**：单屏界面组件。承载 `mirror`（屏幕镜像，单条 scrcpy 会话）与单虚拟屏两种内部模式；渲染 `ControlSidebar`。
- **DesktopScreen**：分屏桌面界面组件（`displayMode==='virtual'`）。由 `SessionManager` 管理多条会话的分屏桌面，渲染 `ControlSidebar` + `DesktopShell` + 各类浮窗。
- **ControlSidebar**：常驻侧边栏（两屏共用），含返回 / 桌面 / 全屏等按钮、pinned / 常用 dock、缓存设置等。
- **dock**：侧边栏中常驻显示的应用快捷区（pinned + 常用），点击直接启动。
- **AppPicker（统一全部应用浮窗）**：ADR-0010 后唯一的全应用窗口，取代旧的 ① 面板与 ② `AppPickerOverlay`。
- **AppGrid**：应用网格组件，被 `AppPicker` 包裹；负责列表拉取、排序（`sortApps`：置顶>常用>其他）、分页、图标懒加载、手动刷新。
- **AppIcon**：单个应用图标按钮（共享 `src/components/AppIcon.tsx`）；支持 `pinMode` / `isPinned` 角标与 `cacheVersion` 缓存刷新。

## 启动落点模式（AppPickerMode）

- **single**：镜像 / 单虚拟屏模式。启动 = `startApp(pkg)`，设备端直接起该 app，镜像流中显示。
- **pane**：桌面左 / 右半屏。启动 = `onLaunchOnPane(pkg, pane)`（foreground-pane 会话）。
- **fullscreen**：桌面全屏 pane（受 `SessionManager` 管理的 foreground 会话，之后可转后台 / 拆分 / 切换）。启动 = `onLaunchFullscreen(pkg)`。

> 关键区别：`fullscreen` 仍是桌面体系内的*受管会话*，并非镜像模式。

## 行为与状态

- **pin（置顶）模式**：`AppPicker` 头部开关；开启后点击应用 = `togglePin(pkg)`（切换侧栏 dock 置顶状态），而非启动。`togglePin` 全仓库唯一管理应用置顶的入口。
- **计数角标**：`AppPicker` 标题后的 `(N)`，N = 已装应用总数（`getAllDeviceApps().length`），随 `appListVersion` 刷新。
- **appListVersion**：`useAdbStore` 中的计数器；设备应用数据变更时 bump，驱动 `AppGrid` / dock 重读列表（见 ADR-0009 反馈环修复）。
- **AppPickerContext**：`openAppPicker(config)` / `closeAppPicker()`；两屏通过它触发统一浮窗，浮窗在 App 层单实例渲染。

## 虚拟屏渲染与方向（ADR-0011）

- **captureOrientation**：scrcpy 4.x 采集方向选项（官方 CLI 为 `--capture-orientation`）。决定"发送到电脑的视频帧方向"，即 canvas 帧尺寸的来源层。
  - **Unlocked**（协议值 0，无 `@`）：采集**跟随**设备/显示旋转 → app 启动旋转显示即翻转视频帧 → 触发 canvas 清屏白闪。carweb 虚拟屏路径原错用此项（`scrcpy-session.ts:335`）。
  - **LockedInitial**（协议值 1，CLI `@`）：采集方向**锁定到初始方向**（虚拟屏创建时的方向），显示旋转不改变采集帧方向 → 无翻转。scrcpy 默认值（平板/镜像路径即此行为）。
- **canvas-clear（清屏）**：`canvas.width=w; canvas.height=h` 赋值会清空 canvas 为透明（`scrcpy-session.ts:422-425`）。每当视频帧尺寸变化（`flex-client.ts` 的 `onSessionPacket`）即触发，是白闪的直接来源；透明 canvas 透出浅色容器即"白屏"。
- **flex-display resize（尺寸变化）**：`flexDisplay` 开启时，`SplitPane` 的 `ResizeObserver` 经 `flex-client` 防抖（150ms）向设备发 `RESIZE_DISPLAY`，把虚拟屏尺寸改为容器尺寸。尺寸变化同样触发 canvas-clear → 白闪（与方向锁无关，故 `LockedInitial` 修不了）。
- **统一过渡占位（transition placeholder）**：ADR-0011 的 D2——浅色背景 + 居中应用图标，作为**启动**与**尺寸变化**两类过渡的统一动画（参考 HyperOS 分屏 resize 占位）；canvas 无有效帧/过渡中显示，有效帧到达淡出。由 `AppTransitionPlaceholder.tsx` 实现，取代已删除的零引用死代码 `AppLaunchingOverlay.tsx`。
- **setRotationLocked(adb)**：Android 层旋转锁（`scrcpy-session.ts:392`，`try/catch` 防护），阻止虚拟屏被 app 转走，使方向不符 app 正立留黑边；`LockedInitial` 为其采集层双保险。

## 音频（ADR-0013 / ADR-0015）

- **REMOTE_SUBMIX（音频源）**：scrcpy 默认 `audio-source=output`，在设备级捕获**整机**音频输出。关键约束：同一设备同一时刻**仅 1 个** scrcpy 连接能成功获取音频流，其余连接会被 server 返回音频流元数据 `disabled`（见 @yume-chan `client.ts` `parseAudioStreamMetadata`）。因此分屏桌面**不能**让每个 pane 各自 `audio:true`，否则多数 pane 拿不到流 → 无 AudioContext → 无声。这是分屏桌面无声的真因（ADR-0015）。
- **专用音频采集连接（ADR-0015）**：`SessionManager` 持有的独立常驻 scrcpy 连接，作为全设备唯一的 `audio:true`「音频拥有者」。参数 `video:false, control:false, audio:true`，`displayId:0`（不新建虚拟屏、不渲染、不占视频解码资源），独占 `REMOTE_SUBMIX` 捕获**整机**声音（满足「听全部声音」）。生命周期与任何 pane 解耦：`launchOnPane`/`launchFullscreen`/`resumeBackground` 时经 `_ensureAudioCapture` 拉起，最后 app 关闭（`closeApp` 时 `apps.length===0`）或设备断开（`setAdb(null)`）时 `_stopAudioCapture` 清理；session id 存于 `audioCaptureSessionId`。是分屏桌面声音的唯一来源。
- **audioOnly（StartOptions）**：`ScrcpySession.start` 的可选开关（`scrcpy-session.ts:135`）。`true` 即「专用音频采集连接」形态：`video=false, control=false`，只抓整机音频、不创建虚拟屏、不渲染画面。`start()` 据此设 `audioEnabled = opts?.audio ?? true`，`audio:false` 的 pane 不建 AudioContext。
- **AudioContext 手势唤醒**：浏览器自动播放策略要求 `AudioContext.resume()` 必须在用户手势内同步调用。`DesktopScreen` 顶层持久化全局 `pointerdown`/`keydown` 监听（捕获阶段）遍历 `SessionManager` 所有 session 调 `resumeAudio()`；唤醒对象现为专用音频采集连接（其拥有 AudioContext）。镜像模式（VirtualScreen）仍走自身 pointer 处理器内 `resumeAudio()`（ADR-0013 的唤醒机制保留，现服务 ADR-0015）。
- **resumeAudio()**：`ScrcpySession` 方法，仅当 `AudioContext` 为 `suspended` 时 `resume()`，幂等；`!audioEnabled`（分屏 pane，`audio:false`）时直接静默返回 no-op（ADR-0015，音频由专用连接承载）；`audioEnabled` 但 `audioCtx` 未建时为 no-op（启动初期 1–2s 正常态，告警每会话仅一次）。
- **useCanvasPointerInput**：分屏/全屏桌面的触控 hook，把容器 div 的 pointer 事件路由到对应 session 的 `injectTouch`；**不再**调用 `resumeAudio()`（ADR-0015 起音频唤醒统一交由 `DesktopScreen` 全局手势监听处理）。
- **定制 scrcpy server 私有音频编解码器标签（ADR-0016）**：设备端运行的是项目自带**定制版 `public/scrcpy-server.jar`**（车机 OEM 修改的 scrcpy server）。其音频流元数据标签 `0x32333034` 不属于标准 scrcpy 4 种（`OPUS=0x6f707573` / `AAC=0x00616163` / `FLAC=0x666c6163` / `RAW=0x00726177`，官方 4.0 `AudioCodec.java` 已核实）。`@yume-chan/scrcpy@2.3.0` 的 `parseAudioStreamMetadata` 只认这 4 种，遇未知标签即抛 `Unknown audio codec metadata value` → 专用音频连接启动崩溃。这是 ADR-0015 之外「该设备浏览器端音频从未工作」的第二层独立根因。
- **AUDIO_CODEC_FALLBACK（ADR-0016）**：`scrcpy4/options.ts` 导出的**单一旋钮**（默认 `"opus"`），同时控制「发给 server 的 `--audio-codec` 请求」与「`parseAudioStreamMetadata` 对未知标签的回退 codec」。`AdbScrcpyOptions4_0.parseAudioStreamMetadata` 重写后，未知标签回退到该值（正常消费 4 字节元数据、不抛错）并打诊断日志；`scrcpy-session.ts` 的 options 构造以 `audioCodec: AUDIO_CODEC_FALLBACK` 接入。默认值 `opus` 与官方 scrcpy 默认编码一致（官方 `AudioCodec.java` / `doc/audio.md` 已核实）。若设备实际编码为 AAC（无 Opus 编码器），除手动改该常量外，运行时还可通过下方**自动自愈**自动改试 aac。
- **audioCodecOverride / 自动自愈（ADR-0016 D4）**：`ScrcpySession.start` 的 `StartOptions.audioCodecOverride` 覆盖本次 `--audio-codec` 请求（默认仍 `AUDIO_CODEC_FALLBACK`）。专用音频连接在 worker 上报「opus 解码失败」（`onAudioDecodeError` 回调；worker 内部对同 codec 重试 3 次后仍失败才上抛）时，`SessionManager` 自动以 `audioCodecOverride:'aac'` 重建该连接（仅一次，置 `audioCaptureRetried` 防无限循环），与官方 scrcpy「`Failed to initialize audio/opus` → `--audio-codec=aac`」回退指引对齐——用户无需手动翻 `AUDIO_CODEC_FALLBACK`。若 aac 仍失败则打「已无更多回退」日志、不再重试。

## 应用显示名解析（ADR-0012）

- **displayName（应用显示名）**：顶部下拉（`PaneDropdown`/`FullscreenDropdown`）、分屏选择（`PaneSelector`）、活动进程（`ActivityManagerPanel`）、启动占位（`AppTransitionPlaceholder`）、应用网格（`AppGrid`）、侧栏 dock（`ControlSidebar`）中展示给用户的应用名称。
- **AppInfo.label**：设备端 `AppInfoFetcher.java` 解析出的应用真实名称（如"微信"），经 `app-info-service.parseAllApps` 缓存于 IndexedDB。是 displayName 的**唯一数据源**。
- **AppInstance.appLabel（已弃用）**：`AppInstance` 可选字段，原意图"由 UI 层在 launch 时填充"。因启动调用点（`DesktopScreen.tsx` 的 `launchOnPane`/`launchFullscreen`）从未传入，且写入后不随缓存刷新、跨 resume/backgroundify 易失配，ADR-0012 起不再作为显示名来源。
- **getCachedAppLabels(pkgs)**：`ScrcpyContext` 暴露的批量解析接口（`useAppManager` → `app-info-service`），按包名返回 `Map<pkg,label>`。
- **渲染时解析（pull 模型）**：ADR-0012 决策——所有 displayName 在**渲染时**经 `useAppDisplayName(pkg)` / `useAppLabels(pkgs)` 按包名查 `getCachedAppLabels` 获得；单一数据源、自动随缓存刷新、覆盖所有启动入口（选择器/侧栏/媒体/NowPlaying）。
- **兜底规则**：label 缺失（首次启动、设备未扫完）时显示**完整包名**（如 `com.tencent.mm`），不再用末段缩写（`com.tencent.mm → mm`）——后者不可读，已于 ADR-0012 全面废弃。

## 冗余 / 已清理项（ADR-0010）

- **① 全部应用面板**：`ControlSidebar` 内 `panelMode='apps'/'search'` 浮层，ADR-0010 已剔除。
- **`AppPickerOverlay`**：旧 ② 双模式浮窗，被统一 `AppPicker` 取代并删除。
- **孤儿组件**：`ConnectionPanel.tsx`、`DesktopView.tsx`（全仓库零引用），ADR-0010 已删除。

## 虚拟屏启动期错误（ADR-0014）

- **AdbScrcpyExitedError**：@yume-chan 在 `AdbScrcpyClient.start()` 中，当设备端 scrcpy server 进程先于 `connection.getStreams()` 建立而退出时抛出的错误（`client.ts:181-186`）。`.output` 为 server 的 stderr 行数组；因填充 `lines` 的是一条**并发 pipe**，进程退出瞬间 `lines` 常为空——**空 output 不能判定"沉默崩溃"**，须靠真机 server 真实 stderr 确证。
- **newDisplay（虚拟屏新建）**：scrcpy 4.0 `--new-display`，在设备端新建一块虚拟显示；carweb 每条 foreground 启动都新建一块（不受 `launchMutex` 保护旧屏释放）。与设备虚拟屏数量上限强相关。
- **keepActive**：scrcpy `--keep-active`（4.0）；server 进程存活期间即便 client 断开也保住虚拟屏，使 `resumeBackground` 能复用原 displayId。代价：背景 app **持续占用**设备虚拟屏名额。
- **flex_display / vdSystemDecorations**：`--flex-display`（虚拟屏运行时 resize）、`--no-vd-system-decorations`（虚拟屏不渲染状态栏/导航栏/Launcher）。均 ADR-0011 引入。
- **scid（每会话隧道标识）**：`localabstract:scrcpy_<scid>` 端点。**必须是合法十六进制串，且其十六进制数值 ≤ `0x7FFFFFFF`**（31 位有界），因为设备端 scrcpy server 用 `Integer.parseInt(value, 16)`（**十六进制**）把 scid 读入 32 位有符号 int 字段（合法 −1 … `0x7FFFFFFF`）；当十六进制数值 > `0x7FFFFFFF` 时整数溢出 → 抛 `NumberFormatException: For input string: "..."` → server 提前退出（`AdbScrcpyExitedError`）。隧道名两端均按**十六进制**构造：设备端 `%08x` 零填充、`@yume-chan` 连接层 `getSocketName` 用 `padStart(8,'0')`，故 scid 必须合法且两端零填充一致（ADR-0014 H6 / D4）。`launchMutex` 为模块级 Promise 链，串行化 `pushServer+start`，消除并发启动的反向隧道冲突。
- **虚拟屏瞬态叠加**：pane 切换时 `closeApp(old)` 异步释放旧屏、`launchOnPane(new)` 立即 `newDisplay`，窗口内设备虚拟屏数瞬态超出 ROM 上限 → `newDisplay` 失败 → `AdbScrcpyExitedError`。
- **跨刷新孤儿泄漏（H1，ADR-0014 次因/潜在隐患）**：`keepActive:true`（`scrcpy-session.ts`）使虚拟屏在 server 断开后驻留设备；`beforeunload`（`App.tsx`）仅 `void adb.close()`、**不清理虚拟屏**；每次 foreground 启动恒 `newDisplay`（不复用）。该现象在代码中真实存在，是独立潜在隐患，但**非**"高频 premature exit"主因。主因见下条 H6。
- **scid 十六进制解析溢出 int31（H6，ADR-0014 决定性根因）**：设备端 scrcpy server 以 `Integer.parseInt(value, 16)`（十六进制）把 scid 读入 31 位有符号 int（−1 … `0x7FFFFFFF`）。`generateScid()` 旧实现产出 8 位十六进制（如 `b36b21a9` = `0xb36b21a9` ≈ 30 亿 > 21 亿）→ **整数溢出** → `NumberFormatException: For input string: "b36b21a9"` → server 启动期即退出。旧实现最高位 nibble ≥ 8 的概率约 **50%** → 高频失败；≤ 7 则 ≤ `0x7FFFFFFF` → 侥幸成功，故呈现"高频但非 100%、重开常成功"假象。**第六轮修正**：第五轮曾误判为"hex vs decimal 类型错配、改十进制即可"；第六轮日志显示十进制 `95753917` 仍崩——因设备始终按十六进制读，`0x95753917` ≈ 25 亿同样溢出。修复（D4 终版）：`generateScid` 产出 **31 位有界十六进制**（清最高位 `>>> 1`，数值恒 ≤ `0x7FFFFFFF`），永不溢出。
- **冷启动对账（D1 修复）**：`session-manager.ts` 的 `reconcileVirtualDisplaysOnColdStart`——浏览器侧 0 会话的冷启动窗口跑一次 `killScrcpyServer` + settle 800ms，杀光残留 scrcpy 进程、等孤儿屏回收；模块级 flag 保证每页面加载仅一次，非冷启动跳过以保后台 app。
- **启动自愈重试（D2 修复）**：`scrcpy-session.ts` `start()` 对 `AdbScrcpyExitedError` 重试一次（sleep 1000ms 等回收），把"手动重开即成功"自动化；重试不 pkill，避免误杀其它会话。
- **设备侧快照诊断（D3 深化，ADR-0014 第三/四轮）**：`adb-commands.ts` 的 `captureDeviceSnapshot(adb)` 在 `AdbScrcpyExitedError` 时采集三类证据——虚拟屏清单（`dumpsys display`，含 id/flag/uniqueId）、scrcpy 进程（`pidof` + `/proc/<pid>/cmdline` 含 `scid=`）、反向隧道（`adb.reverse.list()` 过滤 `scrcpy_<scid>`）；由 `diagnoseFailure` 在重试前与最终失败两处输出**单条 `console.error` 结构化对象**（字段含 `suspect` 自动判读），逐字附 `error.output`（server stderr）。`generateScid()` 现为 31 位有界十六进制（`>>> 1` 后 `toString(16)`，数值恒 ≤ `0x7FFFFFFF`）→ **scid 隧道碰撞与溢出均可排除**；若 `serverStderr` 仍出现 `For input string:` 即指向其它参数解析问题。据此可区分 H1a 虚拟屏累积超上限 / H1b 并发 pane 超限 / H3 反向隧道泄漏 / H4 真 ROM 不兼容 / H5 回收瞬态窗口>1s 五类更深原因。**第四轮**：原多行 `console.warn` 被 `resumeAudio` 日志洪流淹没，已重构为单块 `console.error` 并给 `suspect`，确保诊断可见。
