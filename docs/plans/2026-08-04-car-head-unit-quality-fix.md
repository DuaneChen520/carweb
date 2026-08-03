# 车机实机问题优化方案：触控失灵 / 音频卡顿 / 触屏 UI

- 状态：方案评审中（待实施）
- 日期：2026-08-04
- 范围：`src/` 触控注入链路、音频解码/播放管线、触屏 UI 三个方向的根因分析与最优方案
- 相关：ADR-0005（ControllerHealth）、ADR-0013/0015（音频唤醒/专用采集连接）、ADR-0016（音频编解码容错）
- 验证纪律：本方案涉及 `src/` 行为改动，落地每个阶段后必须通过
  `npm run test` + `npm run check` + `npm run lint`（见 AGENTS.md）

### 复核记录（2026-08-04，已对照当前代码逐条核实）

外部 agent 复核后确认：三个方向的根因均与代码一致，可照此推进；以下 4 处修正已吸收进正文（本节为变更摘要）：

1. **触控 P0-1 示意缺「致命错误 → DEAD」分支**（原示意只写了可恢复分支，致命错误会滞留 DEGRADED 死循环）→ §2.3 已补全 else 分支；
2. **音频 drop-oldest 其实已存在**（`renderer-worklet.js:42-46`），`speedUp` 只是「提前抽水」→ §3.1/§3.3 改为「删除 speedUp + 调大阈值」，不再当作新功能；「PTS 透传」对保序 ADB 流非必需，降级为可选；
3. **`audio_buffer` 透传须先真机验证定制 server 是否识别**该参数，不识别则静默不传 → §3.3 P0-2 增加前置验证与降级策略；
4. **触控改造会破坏既有测试**：`controller-health.test.ts:50-54`（非 Socket closed → DEAD）、`:82-83`（fatal → DEAD 后 reset）需同步改断言 → §2.4/§6 已列入同步修改项。

另：根因 C 中「镜像 canvas 未受 touch-action 保护」的描述已按 `index.css:142-143` 全局 `canvas { touch-action: none }` 修正（canvas 本身已受保护，问题在容器/页面级手势）。

---

## 1. 问题现象与复现环境

车机（车机浏览器，Chromium 内核 WebView / WebUSB 连接 Android 手机）实测 carweb 出现三类问题：

| # | 现象 | 关键细节 |
|---|---|---|
| 1 | 虚拟屏触控失灵 | **应用没卡死、画面正常，但点按/滑动无效**；表现为「时灵时不灵」，常发生于操作一段时间后 |
| 2 | 音频卡顿不连贯 | 声音断续、忽快忽慢、偶发破音；视频画面本身尚可 |
| 3 | UI 对触控设备不友好 | 按钮小、按压无反馈、依赖 hover、误触率高 |

本文档对每个问题给出「代码级根因 → 开源方案对照 → 最优方案（含 P0/P1/P2 优先级）→ 验收标准」。

---

## 2. 问题 1：虚拟屏触控失灵

### 2.1 代码级根因（按可能性排序）

#### 根因 A（主因）：控制通道健康门控「一次瞬时错误 → 永久锁死触控」

触控数据通路：`Pointer Event → injectTouch → ControllerHealth.tryGetController → controller.injectTouch → ADB 控制 socket`。

`src/lib/scrcpy4/controller-health.ts` 的 `reportError()` 判定逻辑：

```ts
const isSocketClosed = msg.includes('Socket closed');
if (!isSocketClosed) {
  this._state = 'DEAD';          // ← 任何非 "Socket closed" 错误直接 DEAD
  this.emit('DEAD');
  return;
}
```

而 `tryGetController()` 在 `DEAD` 态**返回 null 拒绝发送**：

```ts
tryGetController<T>(ref) {
  if (this._state === 'DEAD') return null;   // ← 触控被静默丢弃
  return ref.current;
}
```

**问题链条**：车机 USB/WebUSB 传输抖动、视频高码率流抢占带宽时，控制 socket 写入可能瞬时失败，错误消息多为
`Backpressure failed`、`Cannot write to a CLOSED writable stream`、`Stream closed`、超时等——
这些消息**都不包含** `"Socket closed"` → 一次失败即进入 `DEAD` → 此后所有 `injectTouch` 被 `tryGetController` 静默拦截。
而视频流是**独立 socket**，继续正常渲染 → 完全吻合「应用没卡死但触控不了」。

恢复路径也脆弱：`DEAD` 后仅能靠 `LinkSupervisor` 整会话重连（退避 500/1000/2000ms ×3 次），期间触控持续不可用；
重连失败即 `failed` → 整个虚拟屏被停掉。**镜像路径（`ScrcpyContext` 单例）与桌面路径（`useInputInjector`）均走同一门控**，
所以分屏桌面同样中招。

#### 根因 B：镜像模式 `VirtualScreen` 未做 `setPointerCapture`

- 桌面模式 `src/hooks/scrcpy/useCanvasPointerInput.ts` 在 `pointerdown` 时
  `e.currentTarget.setPointerCapture(e.pointerId)`；
- 但镜像模式 `src/components/VirtualScreen.tsx` 的 `handlePointerEvent` **没有**捕获指针。

后果：快速滑动 / 手指拖出 canvas 边界 → 浏览器不再向 canvas 派发 `pointermove/pointerup` →
设备端**永远收不到 Up** → 触点残留 → 手机端认为有根手指一直按着 → 后续所有点击被误判 → 表现就是「触控失灵」。

#### 根因 C：`HoverMove` 事件洪水 + 容器/页面级手势干扰

- `VirtualScreen.tsx` 与 `useCanvasPointerInput.ts` 在 `pointermove` 且 `buttons === 0` 时仍发送
  `AndroidMotionEventAction.HoverMove`。触屏上手指「悬停移动」频率极高（move 事件每秒几十~上百条），
  全部排队写入控制 socket，与真实 down/move/up 竞争带宽，加剧写失败概率。
- 说明：`index.css:142-143` 已对**所有 `canvas` 全局**设 `touch-action: none`，镜像 canvas 本身已受保护；
  但镜像模式 canvas 外层容器 div、以及 pane 外的页面区域未设 `touch-action`，
  浏览器手势（滚动手势/双指缩放）仍可能触发 `pointercancel` → 设备端收到 Cancel → 应用交互状态错乱。

#### 根因 D（次要）：每条指针事件都调 `resumeAudio()`

`VirtualScreen.handlePointerEvent` 首行 `resumeAudio()`，`AudioContext` 处于 `suspended` 时每次都会发起
异步 `resume()`，与高频 touch 注入叠加，加重主线程抖动（不直接导致失灵，但放大前三个根因的影响）。

### 2.2 开源方案对照

| 方案来源 | 做法 | 对本项目的启示 |
|---|---|---|
| `yume-chan/ya-webadb`（3162★，本项目底层库）demo | `PcmPlayer` 直接 `feed`，无健康门控；输入注入失败仅打日志，不整体锁死 | **失败应可恢复**，不能一次错误永久门控 |
| `NetrisTV/ws-scrcpy`（2509★） | 输入走 WebSocket 转发，逐包独立处理，单包失败不影响后续 | 控制写入失败应「丢弃当前包 + 继续」，而非切断整条链 |
| `hqw700/ScrcpyOverWebRTC`（215★） | 基于 WebRTC DataChannel 的输入通道，天然有重传/顺序保证 | 传输层可用性监控可借鉴，但本项目 WebUSB 通道不适用重传 |
| 官方 `Genymobile/scrcpy` 桌面端 | 输入注入由 server 侧事件队列消化，客户端写失败即断开重连（有明确错误语义） | 重连是兜底，但不是唯一路径 |

**结论**：主流开源 Web scrcpy 实现都不存在「一次非致命写失败永久锁死触控」的设计；
本项目应把「错误分级 + 可恢复重试」作为触控修复的核心。

### 2.3 最优方案（推荐）

#### P0-1 控制通道错误分级，消除「一次错误永久 DEAD」

改造 `src/lib/scrcpy4/controller-health.ts`（配套 `src/lib/scrcpy4/__tests__/controller-health.test.ts`）：

1. **错误分级**：
   - **可恢复瞬时错误**（`Backpressure failed` / `Cannot write to a CLOSED` / `Stream closed` / `AbortError` / 超时）：
     不立即 DEAD，走 DEGRADED + 重试计数（复用现有 `maxRetries=3` 机制，甚至放宽到 5）；
   - **致命错误**（明确 socket 死亡，如 `Socket closed` 且连续失败、`ERRORED` 流）：才进入 DEAD 触发重连。
2. **DEGRADED 态下允许继续发送**：`tryGetController` 在 DEGRADED 时返回 controller，
   但 `injectTouch` 失败时直接丢弃该包并继续（不等重试），保证 UI 不卡、后续触摸仍可用；
3. **健康自愈**：`reportError` 统计连续失败次数，任意一次 `markHealthy()` 成功即清零——
   即「写失败 N 次且无成功 → DEAD；有成功 → 回 HEALTHY」，避免把瞬时抖动累积成永久故障。

```ts
// 改造示意（controller-health.ts）
// 可恢复瞬时错误集合：命中即走重试计数；未命中一律视为致命错误 → 直接 DEAD，
// 避免「致命错误在 DEGRADED 死循环」（复核补充）。
const RECOVERABLE = /Backpressure|CLOSED|Stream closed|AbortError|timed out/i;
reportError(error) {
  const msg = error instanceof Error ? error.message : String(error);
  if (RECOVERABLE.test(msg)) {              // 瞬时错误 → 可恢复路径（计数收敛到 DEAD）
    this.retryCount++;
    this._state = this.retryCount > this.maxRetries ? 'DEAD' : 'DEGRADED';
    this.emit(this._state);
    return;
  }
  // 致命错误（含明确 Socket closed、ERRORED 流等）→ 直接 DEAD，触发上层重连
  console.warn(`[CtrlHealth] DEAD (non-recoverable): ${msg}`);
  this._state = 'DEAD';
  this.emit('DEAD');
}
tryGetController(ref) {
  // DEGRADED 也放行（发送层自行丢弃失败包），仅 DEAD 拒绝
  return this._state === 'DEAD' ? null : ref.current;
}
```

#### P0-2 补齐 `setPointerCapture`（镜像模式）

`VirtualScreen.tsx` 的 `handlePointerEvent` 在 `pointerdown` 分支增加：

```ts
case 'pointerdown':
  action = AndroidMotionEventAction.Down;
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
  break;
```

确保手指拖出 canvas 后 move/up 仍持续送达，杜绝「触点残留」型失灵。`SplitPane`/`FullscreenOverlay`
已用 `useCanvasPointerInput`（自带 capture），无需改动。

#### P0-3 抑制 HoverMove 洪水 + 触控节流

- `useCanvasPointerInput.ts` 与 `VirtualScreen.tsx`：`pointermove` 且 `e.buttons === 0` 时**直接 return，不发送 HoverMove**（触屏场景不需要悬停语义，仅保留鼠标语义或在 `pointerType === 'mouse'` 时才发）；
- move 事件按 `requestAnimationFrame` 节流：同一 pointer 一帧内只发最后一次坐标，降低控制 socket 写队列拥塞；
- 镜像模式容器 div 补 `style={{ touchAction: 'none' }}`，并给根容器加 `overscroll-behavior: none`。

#### P1-4 触控失败可观测性

- 在 `injectTouch` 失败分支增加一次性计数上报（仅 console.warn 去重，不弹 UI），
  便于实车复现时从日志直接确认「是门控拦截还是写失败」；
- 区分日志：`[touch] gated by DEAD`（门控）vs `[touch] write failed, dropped`（瞬时失败丢弃）。

#### P2-5 唤醒收敛

- `VirtualScreen` 中 `resumeAudio()` 从每条指针事件改为「首次交互仅调用一次」或复用
  `DesktopScreen` 的全局手势监听模式（`pointerdown` 捕获阶段统一唤醒），减少主线程抖动。

### 2.4 验收标准（触控）

1. 长时间操作（>10 分钟连续点滑）不再出现触控失灵；
2. 拔插/抖动 USB 后画面继续播放时，下一次触摸立即恢复（不再需要整会话重连）；
3. 快速滑动跨出 canvas 边界再返回，设备端触点状态正确（无残留按死）；
4. **同步更新既有测试**（复核提醒，否则 `npm run test` 会挂）：
   `controller-health.test.ts:50-54`「非 Socket closed 错误直接 DEAD」与 `:80-86`「fatal → DEAD 后 reset」
   改为新语义（瞬时错误 → DEGRADED、致命错误 → DEAD），并新增
   「瞬时错误→DEGRADED→重试成功回 HEALTHY」「瞬时错误连续 N 次→DEAD」两条用例；
   `scrcpy-session.test.ts` 全绿。

---

## 3. 问题 2：音频卡顿不连贯

### 3.1 代码级根因

音频数据通路：`ADB 原始字节流 → 主线程 pump 解析包（merge/slice/DataView）→ Worker(AudioDecoder) →
PCM(Float32Array) → postMessage → AudioWorkletNode → 扬声器`。

#### 根因 A（核心）：缓冲水位管理依赖「0.9x 变速播放」，听感差且音频线程过载

- `renderer-worklet.js`（源自 ya-webadb `pcm-player` 的 worker）在缓冲 > 0.25s 时进入 `speedUp` 模式：
  **以 SCALE=0.9（快 10%）的 WSOLA 时间拉伸播放**去追赶缓冲。这在传输抖动场景下表现为
  **忽快忽慢、音调漂移、听感「不连贯」**，且 `processSpeedUp` 的 `readSample` 逐样本线性扫描所有 chunk，
  在车机弱 CPU 上让**音频渲染线程过载**，直接制造破音。
- **复核修正**：drop-oldest 其实已存在（`renderer-worklet.js:42-46` 在 `totalSampleCount > MAX_BUFFER` 时
  `shift()` 最旧 chunk）；`speedUp` 只是「缓冲偏高时提前抽水」的应急手段，**不是水位管理本身**。
  因此修复重点是**删除 speedUp + 调大水位阈值**，而非新增丢旧逻辑；阈值调大后，
  正常抖动由 drop-oldest 消化即可，不需要变速。
- PTS 说明：ADB 通道**保序**，PCM 到达顺序即播放顺序，**无需按 PTS 重排序**；
  PTS 仅作为「首包锚定」与未来音画同步的预留，非本轮必需。

#### 根因 B：缓冲目标过小 + 服务端缓冲参数未透传

- worklet `STARTING_THRESHOLD=0.1s`、`MAX_BUFFER=0.35s`——对车机 WebUSB 抖动场景明显偏小；
- 官方 scrcpy 提供 `--audio-buffer`（默认 50ms，可调至 200ms+）与 `--audio-output-buffer`（默认 10ms），
  但 `@yume-chan/adb-scrcpy` **不透传**这两个参数（已核实本地 node_modules 无此字段）；
  `src/lib/scrcpy4/options.ts` 的 `serialize()` 目前只追加 `flex_display`/`keep_active`，可低成本扩展。

#### 根因 C：`latencyHint: 'interactive'` + 采样率硬编码 48000

- `new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })`：`interactive` 优先低延迟，
  在繁忙车机 SoC 上更易 underrun；
- AudioContext 与 worklet `SAMPLE_RATE=48000` 全部写死；若设备定制 server 输出 44100Hz（opus/aac 均可能出现），
  **无重采样** → 播放速度/音调偏移，主观即「不连贯」。

#### 根因 D：解码无背压 + 主线程高频分配

- worker 内 `decoder.decode()` 无 `decodeQueueSize` 检查，主线程 pump 无节制喂包 → 队列膨胀、内存增长；
- 主线程对每包做 `new Uint8Array` 合并 + `slice` + `DataView`，高频小对象分配 → GC 抖动，与触控/渲染抢 CPU；
- worklet `handleMessage` 在音频渲染线程做数组 `shift()/reduce()`（O(n)），每包都触发，非实时安全。

#### 根因 E：音视频共用一条 ADB 通道

视频（8Mbps+ H.264）+ 音频 + 控制共用一个 WebUSB/ADB 传输，无 QoS；视频突发传输造成音频包到达抖动，
这是「根因 A 的抖动源」——加大缓冲与 PTS 平滑是正确解法，而不是变速。

### 3.2 开源方案对照

| 方案来源 | 做法 | 对本项目的启示 |
|---|---|---|
| 官方 `Genymobile/scrcpy` audio 文档 | `--audio-buffer` 默认 50ms、可调 100~200ms+；`--audio-output-buffer` 默认 10ms，破音时可调大 | **服务端缓冲是官方一等公民**，应透传/调大 |
| `yume-chan/ya-webadb` `pcm-player` | 队列 + 0.9x WSOLA speedup（即本项目现状来源） | 该 hack 只保证不爆缓冲，不保证听感；**应替换为 PTS 对齐抖动缓冲** |
| Chrome `AudioWorklet design pattern`（官方博客） | 环形缓冲 RingBuffer 处理 128 帧 vs 大块数据；underrun 静音补零；**overrun 丢最旧块** | worklet 内用固定容量 RingBuffer 替代 `chunks` 数组 shift；丢弃策略优于变速 |
| `pcm-ringbuf-player`（npm，SAB+Atomics） | SharedArrayBuffer 环形缓冲 + Atomics 同步，避免 postMessage 延迟 | 车机 Chromium ≥87 支持 SAB（需 COEP/COOP 头）；**进阶方案**，非必须 |

**结论**：业界统一做法是「抖动缓冲 + 丢弃最旧 + underrun 静音」，**没有**用变速播放解决抖动的先例；
本项目 `speedUp` 应**删除**（drop-oldest 保留并调大阈值，无需变速兜底）。

### 3.3 最优方案（推荐）

#### P0-1 删除变速 hack，调大缓冲水位（drop-oldest 已存在，保留并复用）

改造 `renderer-worklet.js`：

1. **删除 speedUp 相关代码**：`processSpeedUp()`、`SCALE`/`OUTPUT_HOP_SIZE`/`WINDOW_WEIGHT_TABLE`、
   以及 `mode/readOffset/inputOffset/outputOffset` 状态字段，`process()` 只保留顺序拷贝路径；
   （复核提示：`processSpeedUp` 与 `processNormal` 共享状态字段，删除需**分两步**——
   Step 1 先移除 `process()` 的 speedUp 分支与方法，`processNormal` 保持可用；
   Step 2 再清理仅被 speedUp 使用的 `readSample`/`advanceInputOffset` 与状态字段。每步跑 test/check/lint。）
2. **调大水位阈值**（替代变速的抽水作用）：
   - `STARTING_THRESHOLD`：0.1s → **0.25s**（车机档可配 0.3~0.5s）；
   - `MAX_BUFFER`：0.35s → **0.8s**；现有 drop-oldest（`renderer-worklet.js:42-46`）保留，
     超限即 `shift()` 最旧 chunk——阈值调大后正常抖动由它消化，**不需要变速兜底**；
   - underrun（无数据）：输出静音帧并打一次性日志（`underrun` 计数），等下一包到达继续。
3. PTS 说明：ADB 通道保序，**无需按 PTS 重排序**；`decoder-worker.ts` 已透传的 `timestamp`
   仅作「首包锚定 + 未来音画同步预留」，本轮不新增播放端排序逻辑（可选迭代）。

#### P0-2 服务端音频缓冲透传（`src/lib/scrcpy4/options.ts`）—— 需先真机验证

在 `serialize()` 追加服务端参数：

```ts
override serialize(): string[] {
  const args = super.serialize();
  const value = this.value as AdbScrcpyOptions4_0.Init<TVideo>;
  if (value.flexDisplay) args.push('flex_display=true');
  if (value.keepActive) args.push('keep_active=true');
  if (value.audioBufferMs) args.push(`audio_buffer=${value.audioBufferMs}`);        // 默认 100~200
  if (value.audioOutputBufferMs) args.push(`audio_output_buffer=${value.audioOutputBufferMs}`); // 默认 10
  return args;
}
```

- `audioBufferMs` 默认 **150ms**（车机档），`audioOnly` 专用采集连接可更大（200ms，因为无视频抢占）；
- 在 `Init` 类型中新增可选字段；`scrcpy-session.ts` 的 `start()` 从 `StartOptions` 传入。
- **复核提醒（落地前置）**：本项目跑的是车机 OEM 定制 `scrcpy-server.jar`，需**先真机验证
  该 server 是否识别 `audio_buffer`/`audio_output_buffer`**——启动后观察设备端 server 输出/行为；
  若不识别（报错或忽略），则**静默不传这两个参数**（参数化 + 启动探测日志），
  浏览器端 P0-1 的调大阈值已能兜底，不阻塞主线。

#### P0-3 解码背压 + 采样率自适应

- `decoder-worker.ts`：每次 `handleData` 前检查 `decoder.decodeQueueSize > 64` 则暂缓入队
  （把超出的 chunk 暂存 `pendingData`，随 `output` 回调继续），防止队列无限膨胀；
- `scrcpy-session.ts`：`AudioContext` 不再硬编码 48000——
  收到解码器 `configured` 消息中的真实 `sampleRate` 后，若与 AudioContext 不同则：
  ① 优先在 worklet 内做**线性重采样**（新增 `resample` 参数，简单实现，车机够用）；
  ② 或直接以真实采样率创建 AudioContext（一次性，需在流建立前确定）。

#### P1-4 worklet 数据结构改造（实时安全）

- 把 `chunks`/`chunkSampleCounts` 数组 + `shift()` 替换为**固定容量环形缓冲**
  （Chrome 官方 design pattern：`RingBuffer` 类，`write`/`read` 均 O(1)）；
- `handleMessage` 内只做入队与水位判断，不做 `reduce` 全量求和（用增量计数器）。

#### P1-5 音频包解析移出主线程（进阶，二选一）

- 方案 A（低侵入）：主线程 pump 保留，但用**复用型 BufferPool**（预分配大 Uint8Array + 偏移游标）替代
  每包 `new Uint8Array`，消除高频分配；
- 方案 B（彻底）：把「原始字节 → 包解析 → 解码」整条链路搬进 worker（原始字节流直接 postMessage 给 worker），
  主线程零解析开销。推荐后续迭代做 B。

#### P2-6 车机档性能参数（与视频联动，保障整体性能）

- 车机检测到弱 SoC 时（解码帧率持续 < 阈值或解码耗时 > 预算），自动降档：
  `maxFps 60 → 30`、分辨率预设默认 `hd`（0.5x）、`bitRate` 上限 8Mbps → 4Mbps，
  降低音视频对共享 ADB 通道的争抢——这是音频卡顿的「源头治理」。

### 3.4 验收标准（音频）

1. 播放音乐/视频 app 10 分钟无「忽快忽慢」现象（变速痕迹消失）；
2. USB 拔插抖动 / 页面切后台再回前台，音频 1~2 秒内恢复连贯，不出现长期破音；
3. `renderer-worklet.js` 删除 speedUp（分两步完成）后 worklet 负载明显下降
   （Performance 面板 AudioWorklet 线程）；
4. **真机验证**：定制 `scrcpy-server.jar` 是否识别 `audio_buffer`/`audio_output_buffer`；
   识别 → 按默认值生效；不识别 → 静默不传，验证浏览器端缓冲兜底可用；
5. 新增/更新测试：`audio-capture-self-heal.test.ts` 覆盖 `audio_buffer` 参数序列化断言；
   解码背压逻辑可单测（mock AudioDecoder.decodeQueueSize）。

---

## 4. 问题 3：UI 对触控设备不友好

### 4.1 代码级根因

| 根因 | 代码位置 | 说明 |
|---|---|---|
| 触控目标 36px < 48dp（Material 下限）< 76×76dp（AAOS 驾驶场景建议） | `NeumorphicButton.tsx` `BTN=36`、图标 `ICON_SIZE=16` | 车机屏幕距离远、行驶中操作，36px 明显偏小且相邻按钮间距不足 |
| 按压反馈用鼠标事件 | `NeumorphicButton.tsx` `onMouseDown/onMouseUp/onMouseLeave` | 触屏无 hover，mouse 事件为合成且延迟 ~300ms → 按压态反馈缺失/错位 |
| hover-only 交互 | 各处 `hover:bg-*`、`title` tooltip、设置/分辨率下拉「点击外部关闭」 | 触屏无法 hover；下拉易误触、难关闭 |
| 设置菜单控件过小 | `ControlSidebar.tsx` `text-[10px]` 按钮、`text-[9px]` 角标、小 select | 全部低于可触控下限 |
| 侧栏过窄、图标过小 | `ControlSidebar.tsx` `w-13`(52px) 竖排 36px 按钮 | 误触率高 |
| 无触控全局防护 | 除 canvas 外无 `touch-action` 约束 | 双指缩放/双击放大可能干扰 |

对照规范：Android Automotive OS 设计系统要求触控目标 **≥76×76dp**、目标间距 **≥24dp**、
字体 ≥24sp；Material 无障碍下限 48dp（四周 ≥8dp 间距）。

### 4.2 开源方案对照

| 方案来源 | 做法 |
|---|---|
| Android Automotive OS Design System（Google 官方） | 触控目标 ≥76×76dp、间距 ≥24dp、图标 24~44dp 居中于触控区内 |
| Material Design 无障碍指南 | 触控目标 ≥48dp、间距 ≥8dp；实测目标 7~10mm |
| `ws-scrcpy` 触屏版 UI | 侧栏按钮 ≥48px、图标 24px、按压态用 `:active`/pointer 事件，触屏优先 |

### 4.3 最优方案（推荐）

#### P0-1 触控目标与间距标准化

- `NeumorphicButton`：`BTN` 36 → **48px**（最小）、间距 ≥8px；驾驶场景档位可切 56px；
- 图标 `ICON_SIZE` 16 → **20px**（AAOS 次图标档），居中于触控区；
- 侧栏宽度 `w-13`(52px) → **64px**，按钮间距增大；
- 全局基础样式补：

```css
button, select, input, [role="button"] {
  touch-action: manipulation;   /* 消除双击缩放延迟 */
  -webkit-tap-highlight-color: transparent;
}
```

#### P0-2 按压反馈改 Pointer 事件（触屏可用）

- `NeumorphicButton` 用 `onPointerDown/onPointerUp/onPointerCancel/onPointerLeave` 替换
  `onMouse*`（保留 `onMouseLeave` 兼容），并加 CSS `:active` 兜底（`transform: scale(0.96)` + 背景反馈）；
- 全局：所有 hover 态样式**必须配套 active 态**，触屏上点击即有视觉反馈。

#### P1-3 去除 hover-only 交互

- 下拉菜单（设置、分辨率、Pane 下拉）：点击式 toggle + 显式关闭按钮 / 点击遮罩关闭，去掉「仅点击外部关闭」；
- 去掉 `title` tooltip 依赖，关键操作旁放常驻文字标签（触屏无 hover）；
- 设置菜单内控件高度 ≥44px、字号 ≥12px；角标 `text-[9px]` → ≥12px 且扩大热区。

#### P1-4 触控热区与防误触

- 分屏 pane 之间保留 ≥8px 间隔；全屏浮层按钮 ≥48px；
- 所有可交互元素保证「视觉尺寸 + padding 扩展热区 ≥48×48px」（可用 `::after` 扩展或 wrapper padding）；
- 侧栏滚动区 `scrollbar-none` 保留，但增加滚动阻尼提示（非 hover）。

#### P2-5 触屏可用性增强（可选）

- 增加「长按返回/主页」等触屏快捷手势（车机常见交互）；
- 根据 `pointer: coarse` 媒体查询切换驾驶舱高对比/大目标主题档位。

### 4.4 验收标准（UI）

1. 全量触控目标扫描：无任何可交互元素热区 < 48×48px（驾驶档 ≥64px）；
2. 触屏点按所有按钮均有即时按压反馈（无 300ms 延迟感）；
3. 设置/分辨率下拉在触屏上可开、可关、可选中，无误触；
4. `npm run lint` 通过（无 onMouse* 残留于按钮组件）。

---

## 5. 性能质量保障（贯穿全局）

| 保障项 | 做法 |
|---|---|
| 解码渲染不变 | 维持 WebCodecs 硬解码 + WebGL `WebGLVideoFrameRenderer`，不引入软解 |
| 车机档自适应 | 按解码帧率/耗时自动降档（fps、分辨率、码率），档位可被用户手动覆盖 |
| 主线程减负 | 音频包解析（P1-5）、触控 move 节流（P0-3）、worklet 实时安全（P1-4） |
| 内存控制 | 解码背压（P0-3）、BufferPool 复用（P1-5）、worklet 环形缓冲定容（P1-4） |
| 监控埋点 | 触控丢弃计数、音频 underrun/overrun 计数、解码队列水位 → 单次 console 汇总，不刷屏 |
| 回归保障 | 每阶段落地后 `npm run test` + `npm run check` + `npm run lint` 全绿；核心区（`src/lib/`、`src/hooks/scrcpy/`）改动附测试（AGENTS.md） |

---

## 6. 实施计划（建议分 3 个阶段，可独立交付）

| 阶段 | 内容 | 涉及文件（主要） | 验证 |
|---|---|---|---|
| S1 触控修复 | P0-1 错误分级（**含同步改 `controller-health.test.ts:50-54/82-83` 既有断言**）、P0-2 capture、P0-3 HoverMove 抑制/节流、P1-4 可观测、P2-5 唤醒收敛 | `controller-health.ts`、`controller-health.test.ts`、`useCanvasPointerInput.ts`、`VirtualScreen.tsx`、`useInputInjector.ts`、`scrcpy-session.ts` | test/check/lint + 实车 10min 连续操作 |
| S2 音频修复 | P0-1 删 speedUp + 调阈值（**分两步：先删分支/方法，再清状态字段**）、P0-2 服务端缓冲透传（**先真机验证定制 server 识别性**）、P0-3 背压/采样率、P1-4 worklet 环形缓冲、P2-6 车机档联动 | `renderer-worklet.js`、`decoder-worker.ts`、`scrcpy-session.ts`、`scrcpy4/options.ts`、`session-manager.ts` | test/check/lint + 实车 10min 音频 |
| S3 UI 触屏化 | P0-1 目标尺寸、P0-2 pointer 反馈、P1-3 去 hover、P1-4 热区、P2-5 触屏增强 | `NeumorphicButton.tsx`、`ControlSidebar.tsx`、`SplitPane.tsx`、`FullscreenOverlay.tsx`、`index.css`、`DESIGN.md` 增补触控规范 | lint + 触屏走查清单 |

> S1/S2/S3 相互独立，建议按顺序交付并各自实车验证；每阶段独立提交，避免大改合并。

---

## 7. 风险与回退

| 风险 | 应对 |
|---|---|
| 定制车机 server 不识别 `audio_buffer` 参数 | **落地前先真机验证**（§3.3 P0-2 前置）；不识别则参数化静默不传，浏览器端缓冲（P0-1 调大阈值）兜底，不阻塞主线 |
| 删除 speedUp 涉及状态字段耦合 | 分两步实施（先删 `process()` 分支与方法、再清 `readSample`/`advanceInputOffset` 与字段），每步 test/check/lint 全绿 |
| 移除 speedUp 后缓冲水位调大 → 延迟上升 | 车机档默认 0.25s 起步，提供设置项；交互场景（游戏）可手动调小 |
| DEGRADED 放行导致「死通道狂发」 | 放行但每个失败包直接丢弃（不重试、不等待），由连续失败计数收敛到 DEAD；致命错误路径保留直接 DEAD 分支，杜绝死循环 |
| 触控热区放大挤压画面 | 仅放大可交互元素热区（padding/::after），不改变虚拟屏画面布局 |
| SAB 环形缓冲（P1-4 进阶）需 COEP/COOP 头 | 车机部署环境可能无法加头；故 P1-4 首选**非 SAB 的普通环形缓冲**，SAB 作为可选迭代 |

---

## 8. 参考链接

- 官方 scrcpy 音频文档（`--audio-buffer` / `--audio-output-buffer`）：https://github.com/Genymobile/scrcpy/blob/master/doc/audio.md
- ya-webadb（`pcm-player`，本项目音频管线来源）：https://github.com/yume-chan/ya-webadb
- ws-scrcpy（Web scrcpy 参考实现）：https://github.com/NetrisTV/ws-scrcpy
- ScrcpyOverWebRTC（WebRTC 方案）：https://github.com/hqw700/ScrcpyOverWebRTC
- Chrome「Audio worklet design pattern」（RingBuffer 实时安全模式）：https://developers.google.com/web/updates/2018/06/audio-worklet-design-pattern
- Android Automotive OS Design System「Sizing」（触控目标 ≥76×76dp、间距 ≥24dp）：https://developers.google.cn/cars/design/automotive-os/design-system/sizing
- Material Design 无障碍（触控目标 ≥48dp、间距 ≥8dp）：https://support.google.cn/scanner/answer/7101858
