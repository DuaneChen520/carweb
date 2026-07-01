# CarWeb scrcpy 4.0 Flex Display 迁移设计

- 日期：2026-07-01
- 状态：草案（待用户审阅）
- 关联：`docs/superpowers/specs/2026-07-01-carweb-desktop-design.md`、`docs/adr/0003-virtual-display-auto-resize.md`

## 1. 背景与动机

CarWeb 当前使用 `@yume-chan/scrcpy` 2.3.0 + scrcpy server v3.3.3，虚拟屏通过 `ScrcpyNewDisplay(w,h,dpi)` 创建，**固定尺寸**。当容器尺寸变化时，必须整建销毁重建 scrcpy 会话（`VirtualScreen.tsx:129-176`）：防抖 500ms → 抓取前台应用 → `stopScrcpy` → 轮询 `dumpsys display` 确认旧虚拟屏销毁 → 触发重启 → Effect3 恢复前台应用。该流程带来三个痛点：

1. **尺寸变化要重启**：1–2s 黑屏，体验差。
2. **只支持同时开一个**：单例 session + 单 `displayIdRef` + 销毁重建式 resize 会误杀并存会话，是架构性限制（非 ADB 限制）。
3. **开启慢**：每次重启都付冷启动成本（push jar + 首帧）。

scrcpy 4.0（2026-05-12 发布）的 **flex display** 特性通过 `RESIZE_DISPLAY` 控制消息 + `VirtualDisplay.resize()` 实现**运行时动态改变虚拟屏尺寸，无需重启会话**，直接命中痛点 1。

### 关键约束

- **`@yume-chan` 生态不支持 4.0**：最新 `@yume-chan/scrcpy` 2.3.0（2025-10）早于 4.0 半年，monorepo 最高只到 `3_3_4.ts`，无 4.0 模块、上游零进展。scrcpy 协议版本强锁（client/server 必须完全一致），**不能**用 3.x 客户端驱动 4.0 server。
- **flex display 仍是「一个会话一个屏」**：它让单个虚拟屏可变尺寸，并非多屏并发。多屏需多会话架构（3.x 即可，非 4.0 能力）。

### 痛点与解法对应

| 痛点 | 解法 | 是否需要 4.0 |
|---|---|---|
| 尺寸变化要重启 | flex display（`RESIZE_DISPLAY` + 会话包） | 是，只有 4.0 有 |
| 只支持同时开一个 | 多会话架构（N 个 scrcpy session） | 否，3.x 即可，当前是 CarWeb 架构限制 |
| 开启慢 | 去掉重启后只在首次付冷启动成本 | 间接（4.0 去重启后改善） |

### 路线选择

选定 **路线 A：自研 4.0 flex，单会话先行**。直接交付 flex display 干掉重启，多屏留作后续（届时多会话里每个屏都能享受 flex，收益更大）。

## 2. 目标与范围

### 目标

在 CarWeb 中自研 scrcpy 4.0 客户端协议适配层，启用 flex display，使虚拟屏在运行时动态改变尺寸而**无需销毁重建会话**（消除当前 1–2s 黑屏重启）。

### 范围（In）

- `src/lib/scrcpy4/` 内实现 4.0 协议适配层（选项序列化、`RESIZE_DISPLAY` 控制消息、视频流会话包解复用），复用 `@yume-chan/adb-scrcpy` 的 `AdbScrcpyClient`、`@yume-chan/scrcpy-decoder-webcodecs`（已支持运行时 reconfigure）、`@yume-chan/adb`。
- flex display 客户端逻辑：ResizeObserver → RESIZE_DISPLAY、反抖动状态机、1:1 渲染协调。
- 替换 `VirtualScreen` 销毁重建式 resize 为 flex resize；displayId 会话内稳定，resize 不再重新探测/恢复应用。
- 替换 `public/scrcpy-server.jar` v3.3.3 → v4.0。
- 协议件 + 反抖动状态机的单元测试。

### 范围（Out / 非目标）

- 多会话多虚拟屏（留待后续；当前仍单会话）。
- 冷启动加速：flex **不解决**首次 push jar + 首帧的冷启动耗时，仅消除重复重启；彻底解决「开启慢」需会话跨 desktop↔screen 常驻（属桌面特性的延后项）。
- 运行时改码率：scrcpy 无运行时码率控制消息，码率会话级固定，resize 时不变。
- `--start-app` 服务端启动参数：保留现有 ADB `am start --display`（displayId 已稳定）；`--start-app` 作为未来简化项。

### 成功标准

- 虚拟屏运行中改变容器尺寸，画面 <300ms 跟随、无黑屏、无会话重启、前台应用不中断。
- displayId 在 resize 前后不变，`am start --display` 始终命中同一屏。
- 单测覆盖 RESIZE_DISPLAY 序列化、会话包解析、反抖动状态机事件序列。

## 3. 架构总览

### 关键决策：不自研传输层、不 fork node_modules

`AdbScrcpyClient.start(adb, path, options)` 是泛型的（`client.js:47`）——只要 `options` 实现 `ScrcpyOptions` 接口（`version`/`serialize()`/`parseVideoStreamMetadata`/`createMediaStreamTransformer`/`controlMessageTypes`/`createConnection` 等），就能直接驱动。所以 4.0 协议层以**项目源码模块**形式存在于 `src/lib/scrcpy4/`，`extends ScrcpyOptions3_3_1` 复用基类默认值并局部覆盖，其余 @yume-chan 包原样复用。

### 新增模块

```
src/lib/scrcpy4/
  options.ts          # ScrcpyOptions4_0：extends ScrcpyOptions3_3_1
                      #  version="4.0"；覆盖 serialize()（加 flex_display/keep_active）
                      #  controlMessageTypes（追加 ResizeDisplay）
                      #  createMediaStreamTransformer（4.0 会话包解复用）
  adb-options.ts      # AdbScrcpyOptions4_0：extends ScrcpyOptions4_0，
                      #  混入 adb 层能力（createConnection/getDisplays，复用 2_1/impl）
  control/resize-display.ts   # {type:u8,width:u16,height:u16} BE struct + 序列化
  control/writer.ts           # 扩展控制写入器：resizeDisplay(w,h)
  video/session-packet.ts     # 会话包 struct + client-resized 标志解析
  video/demuxer.ts            # 区分会话包/媒体包，输出含 session 类型的 packet 联合
  flex-client.ts              # ResizeObserver→RESIZE_DISPLAY、反抖动状态机、1:1 渲染协调
  __tests__/                  # 协议件 + 状态机单测
public/scrcpy-server.jar      # 替换为 v4.0
```

### flex resize 数据流

```
容器 CSS 尺寸变化
 → ResizeObserver(防抖 ~150ms)
 → flex-client 算 target(w,h) = containerCSS × preset.scale × dpr
 → 若 ≠ currentDisplaySize：置 pendingResize，发 RESIZE_DISPLAY(w,h)
 → server 异步 VirtualDisplay.resize() + encoder 重配
 → 视频流下发 会话包{w,h,clientResized=true} + 新 config 包(SPS/PPS)
 → 4.0 demuxer 解出 session 包 → flex-client 更新 currentDisplaySize、清 pendingResize
 → WebCodecs 解码器收新 config 包自动 reconfigure → fire sizeChanged
 → canvas backing store 改为新尺寸（只改 canvas.width/height，不改 CSS）
 → WebGL 1:1 渲染
```

### 反抖动核心洞察

ResizeObserver 监听的是 **CSS 布局尺寸**（用户驱动）；收到会话包后只改 **canvas backing store**（位图尺寸），不改 CSS → 不触发 ResizeObserver → **天然无环路**。`client-resized` 标志作为协议级二次确认。于是 scrcpy flex display 最棘手的反抖动，变成「结构性隔离 + 纯逻辑状态机」，可单测覆盖。

## 4. 4.0 协议适配层（`src/lib/scrcpy4/`）

### 4.1 options.ts — 版本模块与序列化

`ScrcpyOptions4_0 extends ScrcpyOptions3_3_1`（从 `@yume-chan/scrcpy` 导入基类，复用其全部默认值与父类方法），仅局部覆盖四点：

```ts
class ScrcpyOptions4_0 extends ScrcpyOptions3_3_1 {
  get version() { return '4.0'; }                    // 启动参数首值，协议强锁

  get controlMessageTypes() {
    // 3.x 数组 + ResizeDisplay，决定 RESIZE_DISPLAY 的线上 type 字节
    return [...PrevControlMessageTypes, ScrcpyControlMessageType.ResizeDisplay];
  }

  serialize() {
    // 调父类得到 3.x 参数，再追加 4.0 专属
    const args = super.serialize();
    if (this.value.flexDisplay) args.push('flex_display=true');
    if (this.value.keepActive)  args.push('keep_active=true');
    return args;
  }

  get createMediaStreamTransformer() { return createScrcpy4MediaStreamTransformer; }
}
```

**Init 类型扩展**：在 `3_3_1.Init` 基础上加 `flexDisplay?: boolean`、`keepActive?: boolean`。`newDisplay` 仍用 `ScrcpyNewDisplay(w,h,dpi)` 提供初始尺寸（flex 下默认 1280x960/160，但 CarWeb 仍按容器算初始尺寸，避免首帧尺寸跳变）。

**`flex_display` 而非 `--flex-display`**：scrcpy server 协议只认 `key=value`（`AdbScrcpyClient.start` 把 `serialize()` 输出展开为 args，见 `client.js:76`）。`-x` 是 C 客户端的命令行短选项，server 不识别裸 flag。所以序列化为 `flex_display=true`。

### 4.2 RESIZE_DISPLAY 控制消息

5 字节，大端：

```ts
// control/resize-display.ts
import { struct, u8, u16 } from '@yume-chan/struct';
export const ResizeDisplayControlMessage =
  struct({ type: u8, width: u16, height: u16 }, { littleEndian: false });
// 序列化：type 字节值由 controlMessageTypes.indexOf(ResizeDisplay) 决定
```

`control/writer.ts` 扩展 `ScrcpyControlMessageWriter`（包一层而非改 node_modules）：新增 `resizeDisplay(w,h)`，内部用 typeMap 取字节值并序列化。`flex-client` 通过此 writer 发送。

### 4.3 视频流 4.0 解复用器（最关键的协议差异）

**3.x 流结构**：`codec id` → 媒体包序列，每个媒体包 = 12 字节头（8 字节 PTS 位域 + 4 字节 size）+ payload。最高 bit（`1n<<63`）= PtsConfig。

**4.0 流结构**：`codec id` → packet 序列，每个 packet 用**首字节 MSB** 区分类型：

- **MSB=0 → 媒体包**：沿用 3.x 的 12 字节头 + payload（PTS 位域里 config/keyframe 标志不变）。
- **MSB=1 → 会话包**：固定 12 字节，无 payload：
  ```
  byte0..3:  1XXXXXXX 00000000 00000000 0000000Y   (Y = client-resized 标志)
  byte4..7:  width  (u32 BE)
  byte8..11: height (u32 BE)
  ```

**冲突点**：3.x 的 `MediaStreamRawPacket` 把前 8 字节统一当 `pts:u64`，无法在解包前 sniff 类型。4.0 必须在 struct 解包**之前**先看首字节 MSB。

**解法**：自定义 `video/demuxer.ts`，实现一个 `TransformStream<Uint8Array, Scrcpy4MediaPacket>`，不依赖 `@yume-chan` 的 `StructDeserializeStream`：

```ts
type Scrcpy4MediaPacket =
  | { type: 'configuration'; data: Uint8Array }
  | { type: 'data'; keyframe: boolean; pts: bigint; data: Uint8Array }
  | { type: 'session'; width: number; height: number; clientResized: boolean };  // 4.0 新增

// demuxer 维护内部 buffer，循环：
// 1. 若 buffer < 1 字节，等更多数据
// 2. sniff buffer[0] 的 MSB
// 3. MSB=1：需 12 字节，凑齐后解析会话包，enqueue session 包，消费 12 字节
// 4. MSB=0：按 3.x 媒体包解析（8字节PTS + 4字节size + payload），
//   PTS==PtsConfig→configuration，PTS&PtsKeyframe→keyframe data，否则 data
```

**为什么不复用 @yume-chan 的 transformer**：它的 `StructDeserializeStream(MediaStreamRawPacket)` 假定「所有包前 8 字节都是 pts」，会话包会被误当 config 包（MSB=1 == PtsConfig）。4.0 的 sniff 分支是结构性差异，必须自写 demuxer。媒体包的**包头解析逻辑**（PTS 位域判定 config/keyframe）复用 `@yume-chan` 的位域常量（`PtsConfig`/`PtsKeyframe` 从 `@yume-chan/scrcpy` 导出），只是外层分发逻辑自写。

**配置选项**：4.0 flex 依赖会话包，会话包只在 `sendFrameMeta=true` 时存在。`control:true` 时 3.x 默认 `sendFrameMeta=true`，4.0 options 沿用，无需额外处理。

**与解码器对接**：`useVideoDecoder` 的 pump 循环把 packet `writer.write(value)` 到 `WebCodecsVideoDecoder.writable`。4.0 demuxer 输出的 `configuration`/`data` 包格式与 3.x 完全一致，解码器原样消费；新增的 `session` 包需要拦截——在 pump 循环里加分支：`session` 包不写解码器，而是通知 `flex-client` 更新 `currentDisplaySize` 并清 `pendingResize`。

### 4.4 flex-client — 反抖动状态机

```ts
class FlexDisplayClient {
  private currentDisplaySize: { w, h };     // server 端虚拟屏当前真实尺寸
  private pendingResize: { w, h } | null;   // 已发出但未确认的 resize 请求
  private debounceTimer;

  // ResizeObserver 回调（CSS 尺寸变化）
  onContainerResize(cssW, cssH, preset, dpr) {
    const target = { w: round(cssW * preset.scale * dpr), h: round(cssH * preset.scale * dpr) };
    if (eq(target, this.currentDisplaySize) && !this.pendingResize) return;  // 无变化
    this.scheduleDebounced(() => this.requestResize(target));  // ~150ms 防抖
  }

  private requestResize(target) {
    // squash：只保留最新请求
    this.pendingResize = target;
    this.writer.resizeDisplay(target.w, target.h);
  }

  // demuxer 解出 session 包时调用
  onSessionPacket(w, h, clientResized) {
    this.currentDisplaySize = { w, h };
    if (this.pendingResize && eq(this.pendingResize, {w,h})) {
      this.pendingResize = null;             // 请求已被确认
    }
    // 不改 CSS（避免触发 ResizeObserver 环路），只通知 canvas 改 backing store
    this.onDisplaySizeChanged(w, h);
  }

  // WebCodecs 解码器 sizeChanged（新 SPS/PPS 到达）时调用
  onDecoderSizeChanged(w, h) {
    // canvas backing store 跟随解码尺寸（1:1），CSS 不动
    this.canvas.width = w; this.canvas.height = h;
  }
}
```

**反抖动三道防线**：

1. **结构性隔离**（主防线）：ResizeObserver 监 CSS，会话包只改 canvas backing store（`canvas.width/height`，非 CSS）→ 不触发 ResizeObserver → 无环路。
2. **pendingResize squash**：resize 请求未确认前，新请求覆盖旧请求（scrcpy server 侧也 squash，客户端镜像此语义），避免堆积。
3. **clientResized 标志**：协议级二次确认，session 包 `clientResized=true` 才清 pendingResize；`clientResized=false`（App 自旋转等独立变化）只更新尺寸、不清请求——此时若 pendingResize 仍在，重发一次以校正。

## 5. CarWeb 集成层改动

### 5.1 useScrcpySession.ts 改动

**options 切换**：`startScrcpy` 里把 `new AdbScrcpyOptionsLatest(...)` 替换为 4.0 适配 options。`clientRef` 泛型从 `AdbScrcpyOptionsLatest<true>` 改为 `AdbScrcpyOptions4_0<true>`。下游 `videoDecoder.setupVideoStream` / `audioDecoder.setupAudioStream` 接收的 client 类型同步放宽（它们只用 `client.videoStream`/`audioStream`/`controller`，接口兼容）。

**resize 行为切换**：`useScrcpySession` 现有的 `resizeDisplay`（走 `adbResizeDisplay` shell + `resetVideo`）在 flex 模式下废弃。改为暴露 `flexClient`（`FlexDisplayClient` 实例）及其 `requestResize(w,h)` 方法给 `VirtualScreen`。新增启动后初始化 flex-client 的步骤：

```ts
// startScrcpy 末尾（flex 模式分支内）
if (useVirtualDisplay) {
  const flexClient = new FlexDisplayClient({
    writer: controllerRef.current!,
    canvas,
    onDisplaySizeChanged: (w,h) => setState(prev => ({...prev, videoWidth:w, videoHeight:h})),
  });
  flexClientRef.current = flexClient;
  flexClient.setInitialDisplaySize(displayConfig.width, displayConfig.height);
}
```

**保留的逻辑**：旋转锁定（`getRotationState`→`setRotationLocked`）、`getVirtualDisplayId` 探测（启动时一次，flex 下会话内稳定）、`forceStopPackage(home)`。这些 flex 下语义不变，原样保留。

**废弃但暂留的逻辑**：`resizeDisplay` 走 shell 的实现（`adbResizeDisplay` + `resetVideo`）在 flex 模式下不再调用，但 M3 阶段暂不删除代码（留到 M4 清理）。注意：这**不是**运行时降级路径——5.4 明确 flex resize 失败时不降级到销毁重建。

### 5.2 VirtualScreen.tsx 改动（删减最多的地方）

**整块删除**：`VirtualScreen.tsx:129-176` 的 resize effect（防抖 500ms → `getForegroundApp` → `stopScrcpy` → 轮询 `dumpsys display` 确认销毁 → `setRestartCount`）。以及 `VirtualScreen.tsx:178-187` 的 Effect3（恢复前台应用）——flex 下不重启会话，应用不中断，无需恢复。

**保留的 ResizeObserver**（`VirtualScreen.tsx:50-59`）：仍监听容器尺寸，但回调改为调用 `flexClient.onContainerResize(cssW, cssH, preset, dpr)`，不再触发 `setContainerSize`→`displayConfig` 重算→重启链路。

**displayConfig 的角色变化**：从「每次尺寸变化都重算并触发重启」变为「仅用于首次启动的初始尺寸」。`displayConfig` 的 `useMemo` 保留，但只被首次 `startScrcpy` 消费；后续尺寸变化走 `flexClient`。

**移除的 ref/state**：`lastStartedDimensionsRef` / `foregroundAppRef` / `restartCount` / `debounceTimerRef` 全部移除（flex 下无销毁重建，无前台应用恢复）。

**canvas backing store 更新**：由 `flexClient.onDecoderSizeChanged` 直接设 `canvas.width/height`。`calculateAdaptiveSize`（CSS contain 计算，`VirtualScreen.tsx:207-230`）保留——它管 CSS 尺寸的 letterbox，与 backing store 正交。

**渲染模式**：flex 下画面 1:1 贴 backing store 渲染，CSS 层仍用 contain 居中。容器尺寸变化时，CSS 拉伸 backing store（短暂的尺寸不匹配），等会话包确认后 backing store 跟上——过渡期可能有轻微拉伸/黑边，这是 flex display 异步特性的固有代价，可接受（远好于 1–2s 黑屏）。

### 5.3 useVideoDecoder.ts 改动

pump 循环加 session 包分支：

```ts
const pump = async () => {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.type === 'session') {
      // 4.0 会话包：不写解码器，通知 flex-client
      flexClientRef.current?.onSessionPacket(value.width, value.height, value.clientResized);
      continue;
    }
    // configuration / data 包原样写解码器
    const writer = decoder.writable.getWriter();
    try { await writer.write(value); } finally { writer.releaseLock(); }
  }
};
```

**问题**：当前 `useVideoDecoder` 不知道 `flexClient`。解法——`setupVideoStream` 增加可选参数 `onSessionPacket?: (w,h,clientResized)=>void`，由 `useScrcpySession` 传入（指向 `flexClient.onSessionPacket`）。这样 `useVideoDecoder` 不耦合 flex-client，仅做「session 包分流」。

**`videoStream.sizeChanged` 订阅**（`useVideoDecoder.ts:35-37`）保留——它是 `AdbScrcpyVideoStream` 从 configuration 包解析尺寸并 fire 的，与 4.0 session 包是**双重信号**：session 包通知 flex-client 反抖动状态机，sizeChanged 通知 canvas backing store。两者指向同一尺寸，互不冲突。

### 5.4 降级路径（镜像模式 + flex 不可用）

**镜像模式**（`useMirrorMode=true`）：无虚拟屏，不创建 flex-client，`VirtualScreen` 走原有镜像逻辑（`displayId:0`，无 resize）。4.0 options 在镜像模式下不启用 `flexDisplay`（`newDisplay` 为 undefined），退化为纯 4.0 协议的镜像——但镜像模式不涉及尺寸重启问题，4.0 协议层仍需生效（因为 server 是 v4.0 jar）。所以镜像模式也用 `AdbScrcpyOptions4_0`，只是 `flexDisplay=false`。

**server 启动失败降级**：若 4.0 server 启动报错（如设备 Android 版本不支持 flex、或 server 崩溃），`startScrcpy` 的 catch 已有 `AdbScrcpyExitedError` 处理。**不**做自动回退到 3.x jar（会引入双 jar 管理复杂度），而是明确报错引导用户。这是 YAGNI——若 4.0 不稳定，是 bug 要修，不是要兜底。

**flex resize 失败**：若发 `RESIZE_DISPLAY` 后超时（如 2s）未收到会话包确认，flex-client 记录警告并保留 pendingResize（下次 ResizeObserver 触发会覆盖）。不降级到销毁重建——若 flex resize 不工作，是协议层 bug，应在单测阶段捕获。

### 5.5 server jar 替换

`public/scrcpy-server.jar` 从 v3.3.3 替换为 v4.0（从 scrcpy releases 下载 `scrcpy-server-v4.0`）。`README.md:122,90` 的版本声明同步更新为 v4.0。`@yume-chan/fetch-scrcpy-server`（devDep，源码未用）保持不动或移除（YAGNI，不影响功能）。

**版本一致性约束**：server jar 必须是 v4.0，client options.version 必须是 `'4.0'`，两者必须匹配（scrcpy 协议强锁）。这是硬约束，单测可加一条：断言 `options.version === '4.0'` 且 jar 内 version 标记匹配。

## 6. 测试策略

### 协议件单测（必做，纯函数，易测）

| 测试文件 | 覆盖目标 |
|---|---|
| `scrcpy4/__tests__/resize-display.test.ts` | `ResizeDisplayControlMessage` 序列化字节序（type + u16 BE width + u16 BE height = 5 字节）；type 字节值由 `controlMessageTypes.indexOf` 正确映射 |
| `scrcpy4/__tests__/options.test.ts` | `serialize()` 输出含 `flex_display=true`/`keep_active=true`；`version==='4.0'`；`controlMessageTypes` 数组含 ResizeDisplay 且为末尾；`newDisplay` 序列化为 `new_display=WxH/dpi` |
| `scrcpy4/__tests__/demuxer.test.ts` | 喂手工构造的字节流，断言：① MSB=1 的 12 字节 → session 包（width/height/clientResized 正确）② MSB=0 的 12 字节头 + payload → configuration/data 包（PTS 位域 config/keyframe 判定正确）③ 混合序列（session→config→data→session→keyframe）按序输出 ④ 跨 chunk 边界的包能正确拼接 |
| `scrcpy4/__tests__/flex-client.test.ts` | 假 writer + 假时钟：① 连续 3 次 `onContainerResize` 只发 1 个 RESIZE_DISPLAY（squash）② `onSessionPacket` 带 `clientResized=true` 清 pending ③ `clientResized=false` 不清 pending 且重发 ④ session 尺寸 === current 时不重复发 ⑤ `onContainerResize` 只通知 canvas backing store、不改 CSS（断言未调用 CSS setter） |

**为什么测这些**：协议件是纯逻辑、无 I/O，单测投入产出比最高；反抖动状态机是方案最易出 bug 处，必须用事件序列断言锁死行为。

### 不测的（YAGNI）

- `AdbScrcpyClient.start` 的传输层（@yume-chan 已测，我们复用）。
- WebCodecs 解码器 reconfigure（库已支持，非我们的代码）。
- E2E 真机 resize 全链路——依赖真机 + USB，CI 不可重现，归入手测验收。
- React 组件渲染快照。

### 手测验收清单

- 虚拟屏运行中拖动浏览器窗口改变尺寸：画面 <300ms 跟随、无黑屏、前台应用（如地图）不中断、无重启日志。
- resize 后 `am start --display <id>` 仍命中同一 displayId（dumpsys 验证 displayId 未变）。
- 镜像模式正常工作（4.0 协议、不开 flex）。
- 首次启动冷启动时间与 3.x 基线相当（flex 不改善冷启动，不应劣化）。
- 连续快速 resize（拖拽中）不堆积请求、不抖动循环。

## 7. 风险与里程碑

### 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| **4.0 会话包字节布局假设错误** | 高 | 调研基于 PR #6772 源码与协议文档，但 scrcpy 协议文档自称「内部协议、无兼容保证」。**缓解**：先用一段真机抓包验证会话包实际字节布局，再固化 demuxer；demuxer 单测用抓包数据作为 fixture。 |
| **反抖动状态机在真机表现不符** | 中 | CSS/backing-store 隔离是理论推导，真机可能有时序差异（如会话包延迟）。**缓解**：flex-client 单测锁死逻辑；手测覆盖连续快速 resize；pendingResize 超时保留而非清空，避免假确认。 |
| **4.0 server 在目标车机 Android 版本不支持 flex** | 中 | flex display 依赖 `VirtualDisplay.resize()`（API 级要求低），但 encoder 动态重配需 Android 5.0+/特定 encoder 支持。**缓解**：手测验收包含目标设备；不支持时明确报错（不做 3.x 回退，见 5.4）。 |
| **@yume-chan 3.x 基类与 4.0 行为有未发现的耦合** | 中 | `extends ScrcpyOptions3_3_1` 复用父类默认值，某些默认值（如 `sendFrameMeta`、`sendDummyByte`）可能在 4.0 变化。**缓解**：抓包验证 server 实际收发的协议帧；options 单测断言关键默认值。 |
| **WebCodecs 解码器在新尺寸 reconfigure 时丢帧/花屏** | 低 | 库已处理 reset+reconfigure 路径（`h26x.js:44-48`）。**缓解**：手测观察 resize 过渡期画面；若有花屏，flex-client 可在 pendingResize 期间暂停解码器输入。 |

### 里程碑（分 4 个阶段）

**M1 — 协议件 + 单测**（无运行时依赖，可纯本地验证）
- `scrcpy4/` 全部模块 + 单测。
- 抓包 fixture 准备（真机跑一次 4.0 scrcpy，录会话包字节）。
- **验收**：所有单测绿。

**M2 — server jar 替换 + options 接入**（最小可运行）
- `public/scrcpy-server.jar` 换 v4.0。
- `useScrcpySession` 切换到 `AdbScrcpyOptions4_0`，**不开 flex**（`flexDisplay=false`）。
- 验证现有功能（镜像、虚拟屏固定尺寸）在 4.0 协议下正常。
- **验收**：虚拟屏能起、画面正常、displayId 探测正常，只是尺寸变化仍走旧销毁重建（暂留）。

**M3 — flex resize 接入**（核心特性）
- `VirtualScreen` 删除销毁重建，接入 flex-client。
- `useVideoDecoder` 加 session 包分流。
- **验收**：运行时 resize 无黑屏、无重启、应用不中断（手测清单）。

**M4 — 清理 + 文档**
- 移除 `resizeDisplay` shell 降级路径（若 M3 稳定后确认不需要）。
- 更新 README 版本号、ADR（新增 ADR 记录 4.0 迁移决策）。
- 更新过时的 `note.md`/`CONTEXT.md`（趁机修正探索时发现的文档/代码不一致）。
- **验收**：文档与代码一致。

## 8. 参考资料

- scrcpy 4.0 release notes: https://github.com/Genymobile/scrcpy/releases/tag/v4.0
- flex display PR #6772: https://github.com/Genymobile/scrcpy/pull/6772
- 虚拟显示文档: https://github.com/Genymobile/scrcpy/blob/master/doc/virtual-display.md
- 开发者协议文档: https://github.com/Genymobile/scrcpy/blob/master/doc/develop.md
- @yume-chan/scrcpy npm: https://www.npmjs.com/package/@yume-chan/scrcpy
- ya-webadb monorepo: https://github.com/yume-chan/ya-webadb/tree/main/libraries/scrcpy
