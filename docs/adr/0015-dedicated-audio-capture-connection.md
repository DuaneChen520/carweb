# ADR-0015: 分屏桌面浏览器端无声的真因与修复（专用音频采集连接）

- 状态：已落地，待真机复核（2026-07-14）
- 相关：ADR-0013（**已被本 ADR 推翻并取代**）、ADR-0016（专用连接启动崩溃·音频流元数据容错解析）、ADR-0001（虚拟屏方向锁）、ADR-0017（scrcpy 4.0 flex display 迁移）

---

## 背景（Context）

用户报告：分屏桌面（`DesktopScreen`）下浏览器端无法播放手机声音；单屏镜像/虚拟屏（`VirtualScreen`）正常。

### 历史调查回顾（ADR-0013 三轮，结论已推翻）

ADR-0013 把根因归为「分屏桌面缺少手势唤醒 `AudioContext`」，并据此加了：
- D1：全局 `pointerdown`/`keydown` 监听唤醒所有 session；
- D1-bis：`useCanvasPointerInput` 每条指针事件直连 `resumeAudio()`；
- D3：诊断日志。

但用户实测**仍无声**，且 Console 明确输出 `resumeAudio: 无 AudioContext（音频流可能未建立）`。这指向一个被 ADR-0013 漏掉的事实：**根本没有 AudioContext 可唤醒**——`resumeAudio` 再怎么被正确调用也是 no-op。ADR-0013 治的是不存在的症状。

### 真因（源码坐实，2026-07-14 第四轮起）

scrcpy 的音频捕获在**设备级是单一的**。默认音频源 `audio-source=output` 即 `REMOTE_SUBMIX`，捕获**整机**音频输出；同一设备同一时刻**只有 1 个** scrcpy 连接能成功拿到音频流。

`@yume-chan/adb-scrcpy` 的证据链（非前端 bug，是 server 驱动）：
- `AdbScrcpyClient.audioStream` 在 `audio:true` 时总会在 `getStreams()` 里提供 `streams.audio`；
- 但 `#createAudioStream` 会解析 server 返回的音频流元数据；当该连接**未**被授权音频时，元数据 `type === 'disabled'`（`client.ts` `parseAudioStreamMetadata` 的 `case "disabled"`）；
- `setupAudioStream` 据此 `return` 提前结束 → 不创建 `AudioContext` → 后续 `resumeAudio` 永久 no-op。

分屏桌面的每个 pane 旧实现都硬编 `audio:true`。于是：
- N 个 pane 各自向设备请求音频；
- server 只把音频流授权给其中 1 个连接，其余返回 `disabled`；
- 拿到 `disabled` 的 pane 无 AudioContext → 无声；
- 即便某 pane 侥幸拿到音频，它也只能承载**那一个连接**的音频，而用户要听的是**全部** app 声音 → 表现即「分屏桌面无声 / 仅个别 app 有声 / 切焦点断音」。

关键澄清：**手势唤醒路径本身是正确的**。用户的 Console 日志证明 `resumeAudio` 确实被调用了，问题不在「没唤醒」，而在「无 AudioContext 可唤醒」——因为并发 `audio:true` 让多数连接拿不到流。ADR-0013 的 D1/D1-bis 作为唤醒机制保留，但其「这是无声根因」的定性不成立。

### 需求澄清（grill 流程）

经 grill 逐点确认：
- Q1 音频归属：用户最初选「跟随焦点切换」；
- Q2 音频期望：用户纠正——**「其实要听全部声音」**（所有 app 同时出声，而非只对焦 app）；
- Q3 拥有者形态：选**「专用音频采集连接（推荐，零闪烁）」**。

故否决「单音频拥有者跟随焦点」方案（无法满足「听全部声音」），采用设备级唯一 `audio:true` 连接捕获整机声音。

## 决策（Decision）

### D1（核心）：专用音频采集连接

由 `SessionManager` 持有一条**独立、常驻**的 scrcpy 连接作为「音频拥有者」：
- `video: false, control: false, audio: true`；
- 走 `displayId: 0`（不新建虚拟屏、不渲染画面、不占视频解码资源）；
- 是全设备**唯一**的 `audio:true` 连接 → 独占设备级 `REMOTE_SUBMIX` 音频捕获，捕获**整机**声音（满足「听全部声音」）；
- 其 `AudioContext` 由 `DesktopScreen` 全局手势监听（`pointerdown`/`keydown`，捕获阶段）唤醒，与单屏镜像路径一致。

生命周期与任何 pane **解耦**：
- 首个 app 启动时（`launchOnPane`/`launchFullscreen` 成功后）经 `_ensureAudioCapture` 拉起；
- `resumeBackground` 恢复 app 时也确保它存在；
- 最后一个 app 关闭（`closeApp` 时 `apps.length === 0`）或设备断开（`setAdb(null)`）时 `_stopAudioCapture` 清理；
- session id 存于 `audioCaptureSessionId`，受 `_ensureAudioCapture`/`_stopAudioCapture` 管理（幂等、失败自愈）。

### D2：所有 pane / 全屏设为 audio:false

`launchOnPane` / `launchFullscreen` / `_restartSession` 一律以 `{ audio: false }` 启动：
- server 不为 pane 提供音频流，`setupAudioStream` 在 `audioEnabled === false` 时静默 `return`（不再误告警）；
- pane 的 `resumeAudio()` 因 `!audioEnabled` 直接 no-op（`scrcpy-session.ts:1137`）；
- 彻底消除「多 pane 抢设备级音频」这一根因；关 pane / 切焦点 / 全屏切换均**不闪烁、不断音**。

### D3：`ScrcpySession.start` 增加 `StartOptions`

```ts
export interface StartOptions {
  audioOnly?: boolean;   // 专用音频采集连接：video/control 关闭
  audio?: boolean;       // 是否向设备请求音频流（pane=false，镜像/默认 true）
}
```
`start()` 内部：`audioOnly` → `video=false, control=false`；`audioEnabled = opts?.audio ?? true`；`audioOnly` 也走 `trackPid`（独立 server 进程需精确 PID）；`displayOptions` 在 `audioOnly` 时用 `{ displayId: 0 }`；视频流/解码 setup 包在 `if (video)` 内；`setupAudioStream` 不再受 `video` 门控但 `audioEnabled===false` 时静默 no-op；`audioOnly` 连接成功建流后 `health.markHealthy()`（无 control 通道，健康检查改以「音频流已建立」为健康判据，避免被误杀）。

### D4：清理 ADR-0013 的诊断残留

- 删除 `ScrcpySession` 中诊断用的 `hasAudioContext()` 等方法；
- `DesktopScreen` 移除 `[AudioAudit]` 调试日志，`resumeAllAudio` 简为遍历所有 session 调 `resumeAudio()`（注释更新为 ADR-0015：音频由专用连接统一承载，pane 为静默 no-op）；
- `useCanvasPointerInput` 移除 pane 直连 `resumeAudio()`（音频唤醒交由 `DesktopScreen` 全局手势监听统一处理）。

### 未改：镜像模式（VirtualScreen）

单屏镜像/虚拟屏维持 `audio:true`（其本就单连接、独占音频，无并发争抢，历史正常）。仅分屏桌面（多连接）受本 ADR 影响。

## 后果与权衡（Consequences）

- ✅ 根因消除：设备级单一音频捕获不再被多 pane 争抢，唯一 `audio:true` 连接稳定拿到整机会话。
- ✅ 满足「听全部声音」：`REMOTE_SUBMIX` 捕获整机输出，所有 app 同时出声；关 pane / 切焦点 / 全屏切换均不断音、不闪烁（与 pane 生命周期解耦）。
- ✅ 手势唤醒路径保留且有效：全局 `pointerdown`/`keydown` 监听仍唤醒专用连接的 `AudioContext`（其 `audioEnabled===true`），与单屏一致，且现在**有 AudioContext 可唤醒**。
- ✅ 资源可控：专用连接 `video:false, control:false`，只跑音频解码 + AudioWorklet，开销远低于一条视频连接；且不新建虚拟屏，不占设备显示名额。
- ✅ 测试：新增断言 `launchOnPane` 现触发 2 次 `session.start`（pane + 专用音频连接），直接证明修复生效；`scrcpy-session.test.ts` 18 项 + `session-manager-launch-gate.test.ts` 5 项全绿。
- ⚠️ 仍需真机复核：分屏桌面启动发声 app → 任意点击/按键后浏览器应出声（整机会话）；Console 应见专用连接的 `音频流已建立并开始播放` + `唤醒 suspended AudioContext`。
- ⚠️ 潜在边界：若设备端 `REMOTE_SUBMIX` 不可用（部分 ROM / 无音频设备），专用连接同样会拿到 `disabled`；此属设备能力问题，与多 pane 争抢无关，且现在至多 1 个连接受此影响、日志清晰。
- ❌ ADR-0013 结论已推翻：其「根因 = 缺手势唤醒」不成立（手势路径正确，问题是并发 `audio:true` 导致无 AudioContext）。ADR-0013 的 D1/D1-bis 作为**唤醒机制**仍保留（现服务于专用连接），但其「这是无声根因」的定性已废弃。

## 追加（2026-07-14 真机实测暴露的二次根因）

ADR-0015 落地后，真机实测显示专用音频连接自身启动崩溃：`Error: Unknown audio codec metadata value: 842215476`（`0x32333034`），位于 `parseAudioStreamMetadata`。原判断：设备端运行的是项目自带**定制版 `scrcpy-server.jar`**（车机 OEM 修改），其音频编解码器标签 `0x32333034` 不属于标准 scrcpy 4 种（`OPUS/AAC/FLAC/RAW`，已在 scrcpy 4.0 `AudioCodec.java` 核实），而 `AdbScrcpyOptions4_0` 只重写了视频元数据解析、未重写音频，沿用了 @yume-chan 2.0 解析器遇私有标签即抛错。

> ⚠️ **上段根因表述已被推翻**（2026-10-22 更正，见 ADR-0016 附录）：jar 经 SHA256 核对是**官方 scrcpy v4.0 原版**，不存在 OEM 定制；
> `0x32333034` 实为 `sendDeviceMeta` 写入的 **64 字节设备名**的前 4 字节（`video:false` 时写进音频 socket，解析器未跳过），已由 `sendDeviceMeta: !audioOnly` 修复。

修复（详见 **ADR-0016**）：重写 `AdbScrcpyOptions4_0.parseAudioStreamMetadata` 对未知标签容错回退到协商的 `audioCodec`（单一旋钮 `AUDIO_CODEC_FALLBACK`，默认 `opus`），并加测试锁定。这与本 ADR 的「并发 `audio:true` 争抢 `disabled`」是**两个独立问题**——虚拟屏 pane 无音频（server 返回 `disabled`）由本 ADR 的 `audio:false` 解决；专用连接崩溃由 ADR-0016 解决。两者叠加解释了「该设备浏览器端音频从未工作」。

## 验证

- `tsc --noEmit` 0 错误。
- `npx vitest run src/lib/__tests__/session-manager-launch-gate.test.ts src/lib/__tests__/scrcpy-session.test.ts` → 23/23 通过（含新增「launchOnPane 触发 pane + 专用音频连接两次 start」断言）。
- 真机：分屏桌面启动多个发声 app → 任意交互后浏览器应听到**所有** app 声音；关闭某 pane 后其余 app 声音不中断。对照旧症状（无声 / 仅个别 app 有声 / 切焦点断音）应消失。
- 对照 ADR-0013 的 D3 三态日志：`无 AudioContext` 告警**不应再出现**（专用连接建流成功）；若出现则指向设备 `REMOTE_SUBMIX` 不可用而非前端。
