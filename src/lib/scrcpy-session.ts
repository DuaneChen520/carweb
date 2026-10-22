/**
 * ScrcpySession —— 可实例化的 scrcpy 会话管理类。
 *
 * 从 useScrcpySession hook 重构而来，支持多实例并发。
 *
 * 三项关键调整（相对原计划骨架）：
 * 1. session 持有 canvas：start() 时创建 canvas 元素，通过 getter 暴露给调用方插入 DOM。
 *    分屏 ↔ 全屏切换时通过 reparentCanvas() 移动 DOM 父节点，保持 WebGL context 不变。
 *    （Task 6 Canvas Reparenting 方案，替代原计划的 switchCanvas）
 * 2. 内联 audioDecoder：每个 session 实例独立持有音频解码资源，解决多实例并发冲突。
 * 3. stop 互斥锁：防止多 session 并发 stop 时 PID 误杀。
 *
 * 参考：src/hooks/scrcpy/useScrcpySession.ts（不删除，保留兼容）
 */

import type { AdbScrcpyClient } from '@yume-chan/adb-scrcpy';
import { AdbScrcpyExitedError } from '@yume-chan/adb-scrcpy';
import type { ScrcpyControlMessageWriter, ScrcpyVideoStreamPacket } from '@yume-chan/scrcpy';
import { ScrcpyNewDisplay, ScrcpyCaptureOrientation, ScrcpyLockOrientation, ScrcpyOrientation, AndroidKeyCode, AndroidKeyEventAction } from '@yume-chan/scrcpy';
import { FlexDisplayClient, ControllerHealth, AUDIO_CODEC_FALLBACK } from '@/lib/scrcpy4';
import type { AdbScrcpyOptions4_0 as AdbScrcpyOptions4_0Type } from '@/lib/scrcpy4';
import type { ControllerHealthState } from '@/lib/scrcpy4';
import type { Adb } from '@yume-chan/adb';
import type { WebCodecsVideoDecoder } from '@yume-chan/scrcpy-decoder-webcodecs';
import type { AudioState } from '@/hooks/scrcpy/audio/types';
import {
  runAdbCommand,
  getRotationState,
  setRotationLocked,
  restoreRotation,
  getVirtualDisplayId,
  killScrcpyByPid,
  getScrcpyServerPids,
  captureDeviceSnapshot,
} from '@/lib/adb-commands';
import type { RotationState } from '@/lib/adb-commands';

/** 启动韧性用的简单延时（ADR-0014 D2）。 */
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 视频流元数据等待超时（S2-P0-9）。
 *
 * server 未就绪（虚拟屏创建 / OpenGL capture 初始化阻塞，车机多 scrcpy server 并发
 * 时常见）时 video socket 一直不发元数据 → `await client.videoStream` 无限挂起 →
 * start() 卡死（controller 永远 unset → 触控全丢 + 占位层常显）。超时抛错让 start
 * 走失败路径，避免无限卡。车机虚拟屏首次初始化通常 < 5s，8s 足够且不误伤。
 */
const VIDEO_STREAM_TIMEOUT_MS = 8000;

/** 给 Promise 加超时：超时后 reject，避免任何 await 无限挂起（S2-P0-9）。导出以便单测。 */
export function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), ms)),
  ]);
}

/**
 * 判定「媒体流正常结束」错误。
 *
 * v3 的 BufferedReadableStream 在流正常结束（server 退出 / socket 关闭 / 主动取消）
 * 时抛 ExactReadableEndedError——这是终止信号而非真错误。判定必须用 message
 * 字面量而非 instanceof（项目既有经验）：
 * - error.name 恒为 "Error"（构造器未设置 this.name）；
 * - vite 依赖预构建 esbuild minify 后会改写类名（曾观察到 "Jl"），instanceof 不可靠；
 * - message "ExactReadable ended" 是字符串字面量，minify 不变，100% 可靠。
 */
function isStreamEndedError(e: unknown): boolean {
  return e instanceof Error && e.message.includes('ExactReadable');
}

/**
 * 判定 canvas 的既有 WebGL context 是否已丢失。
 *
 * 复用 canvas 的二次 start（分屏 ↔ 全屏切换 / resumeBackground）时，旧 context 可能
 * 已被浏览器回收（webglcontextlost；多 context 并发 + 车机 GPU 压力下更易触发）。
 * 在 lost context 上 new WebGLVideoFrameRenderer 会 createProgram 失败（shader 编译
 * 信息为 null → "Error: null"，见 @yume-chan webgl.js 抛错路径）→ 会话启动失败。
 *
 * 导出为独立函数以便单测（node 环境无 HTMLCanvasElement，传伪造 context 对象验证判定）。
 */
export function isCanvasContextLost(canvas: { getContext(id: string): unknown | null }): boolean {
  try {
    // 与 renderer 的 glCreateContext 一致：webgl2 优先，回退 webgl
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    return !!(gl as { isContextLost?: () => boolean } | null)?.isContextLost?.();
  } catch {
    return false;
  }
}

/**
 * ADR-0014 深化诊断：在 AdbScrcpyExitedError 时结构化打印设备侧快照，
 * 用于定位「更深一层原因」——
 *   - 虚拟屏累积超设备上限 / 并发 pane 数超限（虚拟屏数 ≥ 进程数且无对应进程）
 *   - 反向隧道被遗留进程占用（tunnel 列表含非本会话 scid）
 *   - 真 ROM/选项不兼容（server.stderr 非空且含 [server] ERROR）
 * 该辅助函数自身全程 try/catch，绝不向外抛错，避免干扰既有失败处理。
 */
async function diagnoseFailure(
  adb: Adb | null,
  ctx: {
    id: string;
    scid?: string;
    attempt: number;
    totalAttempts: number;
    displayConfig: DisplayConfig | null;
  },
  error: AdbScrcpyExitedError,
): Promise<void> {
  const serverOutput =
    error.output && error.output.length > 0 ? error.output.join('\n') : '(empty)';

  // 结构化诊断负载：合并「server stderr + 设备侧快照 + 自动判读」，
  // 以单条 console.error 输出（红色高亮、一整块、可直接复制回贴），避免被其它日志冲散。
  const payload: Record<string, unknown> = {
    sessionId: ctx.id,
    attempt: `${ctx.attempt}/${ctx.totalAttempts}`,
    scid: ctx.scid ?? '-',
    display: ctx.displayConfig ? `${ctx.displayConfig.width}x${ctx.displayConfig.height}` : 'physical',
    serverStderr: serverOutput,
    virtualDisplays: [] as Array<Record<string, unknown>>,
    scrcpyProcesses: [] as Array<Record<string, unknown>>,
    reverseTunnels: [] as string[],
    suspect: '需对照 ADR-0014 的 H1a–H5 判据表解读',
  };

  if (adb) {
    try {
      const snap = await captureDeviceSnapshot(adb);
      payload.virtualDisplays = snap.virtualDisplays.map((d) => ({
        id: d.id,
        ownContent: d.ownContent,
        touch: d.touchVirtual,
        private: d.isPrivate,
        uniqueId: d.uniqueId,
      }));
      payload.scrcpyProcesses = snap.scrcpyProcesses.map((p) => {
        const m = p.cmdline.match(/scid=([0-9a-f]{1,8})/i);
        return { pid: p.pid, scid: m ? m[1] : null };
      });
      payload.reverseTunnels = snap.reverseTunnels;

      // 自动判读：按优先级给出最可能假设，缩短定位路径
      if (snap.virtualDisplays.length > 0 && snap.virtualDisplays.length >= snap.scrcpyProcesses.length) {
        payload.suspect =
          `H1a 嫌疑：虚拟屏数(${snap.virtualDisplays.length})≥进程数(${snap.scrcpyProcesses.length})，` +
          `孤儿/累积虚拟屏撞设备上限（多刷新/多 pane 后更易触发）`;
      } else if (
        ctx.scid &&
        snap.reverseTunnels.find(
          (t) => t.includes(`scrcpy_${ctx.scid.padStart(8, '0')}`) &&
            !snap.scrcpyProcesses.some((p) => p.cmdline.includes(`scid=${ctx.scid}`)),
        )
      ) {
        payload.suspect = `H3 嫌疑：反向隧道 scrcpy_${ctx.scid.padStart(8, '0')} 存在但无进程持有 → 隧道泄漏`;
      } else if (serverOutput !== '(empty)') {
        payload.suspect = 'H4 嫌疑：server.stderr 非空，疑似 ROM/选项不兼容（见 stderr）';
      } else if (snap.virtualDisplays.length === snap.scrcpyProcesses.length) {
        payload.suspect = 'H5 嫌疑：虚拟屏数=进程数、stderr 空、重试仍败 → 回收瞬态窗口 > 1s';
      }
    } catch (e) {
      payload.snapshotError = String(e);
    }
  }

  console.error(`[诊断][${ctx.id}] AdbScrcpyExitedError 设备快照 ↓`, payload);
}

export interface DisplayConfig {
  width: number;
  height: number;
  dpi?: number;
  bitRate?: number;
}

/**
 * ScrcpySession.start 的可选开关（ADR-0015）。
 * - audioOnly：仅音频采集连接。video:false / control:false，只捕获设备整机音频
 *   （REMOTE_SUBMIX），不创建虚拟屏、不渲染画面。用于分屏桌面的「专用音频拥有者」。
 * - audio：是否向设备请求音频流。分屏桌面的 pane 设为 false（音频由专用采集连接统一承担），
 *   镜像/默认 true。
 */
export interface StartOptions {
  /** 仅音频采集连接（ADR-0015）：true 时 video/control 关闭，只抓整机音频 */
  audioOnly?: boolean;
  /** 是否向设备请求音频流 */
  audio?: boolean;
  /**
   * 覆盖发给设备 server 的 --audio-codec 请求（ADR-0016 自愈）。
   * 默认沿用全局 AUDIO_CODEC_FALLBACK；专用音频采集连接在 opus 解码失败时
   * 由 SessionManager 改用 "aac" 重试，走本覆盖通道，不改全局默认值。
   */
  audioCodecOverride?: typeof AUDIO_CODEC_FALLBACK;
  /**
   * 是否启用 audio-dup 及捕获的 usages 列表（scrcpy 5.0+ 特性）。
   * - true: 等同于 'all'（抓取包括游戏在内的所有音频 usages，避免静音）；
   * - false: 不启用 audio-dup；
   * - string: 自定义 usages 列表，例如 'all'、'game' 或 'game,voice-communication'；
   * - undefined: 默认不启用（false）。
   */
  audioDup?: boolean | string;
  /**
   * 是否保持设备处于活跃状态（scrcpy 4.0+ --keep-active 特性）。
   * 通过定期模拟 userActivity 信号防止手机休眠，不修改设备全局持久休眠设置。
   */
  keepActive?: boolean;
}

export interface SessionState {
  isStarting: boolean;
  isRunning: boolean;
  error: string | null;
  videoWidth: number;
  videoHeight: number;
  isVirtualDisplay: boolean;
}

export interface ScrcpySessionCallbacks {
  onStateChange: (state: SessionState) => void;
  onVideoSize: (width: number, height: number) => void;
  onAudioStateChange?: (state: AudioState) => void;
  onHealthChange?: (state: ControllerHealthState) => void;
  /** flex-client 就绪/销毁时回调（供上层透传到渲染层）。 */
  onFlexClient?: (flexClient: FlexDisplayClient | null) => void;
  /** 音频解码失败（codec 不匹配或流损坏）时回调；专用音频连接据此触发 opus→aac 自愈（ADR-0016）。 */
  onAudioDecodeError?: (sessionId: string) => void;
}

/**
 * 模块级启动互斥锁。
 *
 * 同一设备并发启动多个 scrcpy 会话时，AdbScrcpyClient.start 内部会执行
 * `adb reverse remove localabstract:scrcpy` + `adb reverse add ...` 来建立反向隧道。
 * 由于 scrcpy 2.3 不支持 scid，所有会话共用同一个 socket 名 localabstract:scrcpy，
 * 并发时一个会话的 reverse.remove 会拆除另一个会话正在建立的反向隧道，
 * 导致设备端 scrcpy server 提前退出（AdbScrcpyExitedError: scrcpy server exited prematurely）。
 * 串行化「pushServer + start」这一段临界区即可彻底消除竞争，而各会话启动后依旧并发运行。
 */
let launchMutexChain: Promise<unknown> = Promise.resolve();
function withLaunchMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = launchMutexChain.then(fn, fn);
  // 无论成功或失败都接续链，避免单次失败阻塞后续启动
  launchMutexChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * 为每个 scrcpy 会话生成唯一 scid（十六进制字符串，数值 ≤ 0x7FFFFFFF）。
 *
 * 设备端 scrcpy server 在解析启动参数时用 `Integer.parseInt(value, 0x10)`
 * （十六进制）把 scid 读入一个 32 位有符号 int 字段，合法范围为 −1 … 0x7FFFFFFF
 * （= 2³¹−1）。若 scid 作为十六进制解析后数值 > 0x7FFFFFFF，会立即抛出
 * `NumberFormatException: For input string: "..."` → server 在启动期即退出 →
 * 浏览器侧 `AdbScrcpyExitedError: scrcpy server exited prematurely`。
 *
 * 这正是此前「高频但非 100% 报错」的真实根因：scid 始终是十六进制被解析，
 * 崩溃与否只取决于「十六进制数值是否溢出 int31」——
 *   - 旧实现产出 8 位十六进制（0x00000000–0xFFFFFFFF），最高位 nibble ≥ 8
 *     （约 50%）即 > 0x7FFFFFFF → 溢出崩溃；
 *   - 曾误改为十进制（如 95753917），设备仍按十六进制读 → 0x95753917 ≈ 25 亿
 *     > 21 亿 → 同样溢出崩溃。
 *
 * 因此 scid 必须同时满足：① 是合法十六进制串（纯 0–9a–f）；② 其十六进制数值
 * ≤ 0x7FFFFFFF。本函数生成 31 位非负随机值（清掉最高位，`>>> 1`），再 `toString(16)`，
 * 既保证 ① 又保证 ②，彻底消除溢出崩溃。每会话独立 scid 仍走各自的
 * `localabstract:scrcpy_<scid>` 隧道（见下）。
 *
 * 隧道名两端对齐：@yume-chan 连接层 `getSocketName` 用 `scid.padStart(8,'0')` 构造
 * `localabstract:scrcpy_<8位>`，设备端以 `%08x` 零填充还原同一名字，故两端隧道严格一致。
 * 不给 scid 时所有会话共用 `localabstract:scrcpy`，并发启动时后启动的会话会
 * `reverse.remove` 拆掉先启动会话已建立的隧道，故需每会话独立 scid 隔离（T4）。
 */
export function generateScid(): string {
  const buf = new Uint32Array(1);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf);
  } else {
    buf[0] = Math.floor(Math.random() * 0x80000000);
  }
  // 清掉最高位（>>>1）→ 31 位非负值，保证十六进制解析不溢出 int31（≤ 0x7FFFFFFF）
  const n = buf[0] >>> 1;
  return n.toString(16);
}

export class ScrcpySession {
  public readonly id: string;
  public displayId: number | null = null;

  // ===== 持有的资源 =====
  /** session 拥有的 canvas 元素，start() 时创建，跨 pane/fullscreen 复用 */
  private _canvas: HTMLCanvasElement | null = null;
  private client: AdbScrcpyClient<AdbScrcpyOptions4_0Type> | null = null;
  private controller: ScrcpyControlMessageWriter | null = null;
  private adb: Adb | null = null;
  private rotationState: RotationState | null = null;
  private flexClient: FlexDisplayClient | null = null;
  /** 健康状态机：构造时带会话 id 标签，DEGRADED/DEAD 日志可区分多会话归属。 */
  private health: ControllerHealth;

  /** scrcpy server PID，用于精确 kill（多实例并发时区分） */
  private serverPid: number | null = null;

  // ===== 视频解码（内联自 useVideoDecoder） =====
  private videoDecoder: WebCodecsVideoDecoder | null = null;
  private videoCleanup: (() => Promise<void>) | null = null;

  // ===== 音频解码（内联自 useAudioDecoder） =====
  private audioWorker: Worker | null = null;
  private audioCtx: AudioContext | null = null;
  private audioWorkletNode: AudioWorkletNode | null = null;
  private audioReader: ReadableStreamDefaultReader<unknown> | null = null;
  private audioRoute: 'browser' | 'phone' = 'browser';
  private audioMuted = false;
  /** 仅音频采集连接（ADR-0015）：true 时 video/control 关闭，只抓整机音频；供 setupAudioStream 内部判读 */
  private audioOnly = false;
  // 启动初期音频流尚未建立、audioCtx 为 null 属正常态；resumeAudio 在每条指针事件上被调用，
  // 若每次都告警会把控制台淹没、埋掉真正的报错。用此 flag 限制「无 AudioContext」告警每会话仅一次。
  private audioNoCtxWarned = false;
  private audioDisposed = false;
  /** 触控丢弃告警限流（S2-P0-8）：原因（unset/DEAD）变化时重打，避免刷屏同时可跟踪状态变化。 */
  private lastTouchDropReason: string | null = null;
  /** 本 session 是否被设计为承载音频。pane 为 false（音频交给专用采集连接），专用连接/镜像为 true。 */
  private audioEnabled = true;

  // ===== 状态 =====
  private state: SessionState = {
    isStarting: false,
    isRunning: false,
    error: null,
    videoWidth: 0,
    videoHeight: 0,
    isVirtualDisplay: false,
  };
  private callbacks: ScrcpySessionCallbacks;

  // ===== 互斥锁 =====
  private startingLock = false;
  private stoppingLock = false;

  // ===== 健康监听取消订阅 =====
  private healthUnsubscribe: (() => void) | null = null;

  constructor(id: string, callbacks: ScrcpySessionCallbacks, health?: ControllerHealth) {
    this.id = id;
    this.callbacks = callbacks;
    // 允许外部注入共享的健康实例（如与 LinkSupervisor 共用同一个 ControllerHealth）；
    // 未注入时默认带会话 id 标签，使多会话并发的健康日志可定位归属。
    this.health = health ?? new ControllerHealth({ tag: id });

    // 监听健康状态变化
    this.healthUnsubscribe = this.health.onStateChange((s) => {
      this.callbacks.onHealthChange?.(s);
    });
  }

  // ===== 只读访问器 =====

  get isRunning(): boolean {
    return this.state.isRunning;
  }

  get isStarting(): boolean {
    return this.state.isStarting;
  }

  get canvas(): HTMLCanvasElement | null {
    return this._canvas;
  }

  get flexClientInstance(): FlexDisplayClient | null {
    return this.flexClient;
  }

  get currentState(): SessionState {
    return { ...this.state };
  }

  /**
   * 将 canvas 元素重新挂载到新的 DOM 父节点。
   *
   * 用于 Task 6 的分屏 ↔ 全屏切换：同一 canvas 元素改变 DOM 父节点，
   * WebGL context 保持不变，画面连续无中断。
   */
  reparentCanvas(newParent: HTMLElement): void {
    if (this._canvas && this._canvas.parentElement !== newParent) {
      newParent.appendChild(this._canvas);
    }
  }

  /**
   * 使本 session 缓存的 adb 引用失效。
   *
   * 设备断开（setAdb(null)）时调用：底层 ADB 传输已关闭，
   * 若不清空，后续 stop() 会在已死的连接上尝试写命令 / kill server，
   * 从而抛 "Cannot write to a CLOSED writable stream"。
   * 失效后 stop() 会跳过所有依赖 adb 的步骤，仅做本地资源清理。
   */
  invalidateAdb(): void {
    this.adb = null;
  }

  /**
   * controller ref 适配器。
   *
   * ControllerHealth.tryGetController 期望 { current: T | null } 形态（原 React ref）。
   * 此处用 getter 返回一个符合该接口的临时对象。
   */
  private get controllerRefAdapter(): { current: ScrcpyControlMessageWriter | null } {
    return { current: this.controller };
  }

  private updateState(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    this.callbacks.onStateChange(this.state);
  }

  // ===== 启动 =====

  /**
   * 启动 scrcpy 会话。
   *
   * canvas 由 session 创建并持有，调用方通过 `session.canvas` 获取后插入 DOM。
   * 若 canvas 已存在（如重连场景），复用旧 canvas。
   */
  /**
   * 启动 scrcpy 会话。
   *
   * canvas 由 session 创建并持有，调用方通过 `session.canvas` 获取后插入 DOM。
   * 若 canvas 已存在（如重连场景），复用旧 canvas。
   *
   * @param attachDisplayId 可选。提供时以 attach 模式接管已有的虚拟屏
   *   （沿用 resumeBackground 的 keepActive 屏，不 newDisplay、不重建），
   *   而非创建新虚拟屏。用于 T5：后台 app resume 时复用原 displayId，
   *   画面瞬间回前台、无「Launcher 闪→黑→app」重建跳动。
   */
  async start(
    adb: Adb,
    displayConfig?: DisplayConfig,
    attachDisplayId?: number,
    externalCanvas?: HTMLCanvasElement,
    opts?: StartOptions,
  ): Promise<void> {
    // 音频/视频模式解析（ADR-0015）：
    // - 分屏桌面的 pane：audio:false（音频由专用采集连接统一承担），video:true
    // - 专用音频采集连接：audioOnly:true → video:false, control:false，只抓整机声音
    // - 镜像/默认：audio:true, video:true
    const audioOnly = opts?.audioOnly ?? false;
    const audioEnabled = opts?.audio ?? true;
    const video = !audioOnly;
    const negotiatedAudioCodec = opts?.audioCodecOverride ?? AUDIO_CODEC_FALLBACK;
    const control = !audioOnly;
    this.audioEnabled = audioEnabled;
    this.audioOnly = audioOnly;

    // 仅视频模式需要 canvas；audioOnly 模式不创建。
    if (video && !this._canvas) {
      this._canvas = externalCanvas ?? document.createElement('canvas');
      if (!externalCanvas) {
        this._canvas.className = 'scrcpy-canvas';
        this._canvas.style.width = '100%';
        this._canvas.style.height = '100%';
        this._canvas.style.display = 'block';
      }
    }
    const canvas = this._canvas;

    this.health.reset();

    if (this.startingLock) {
      console.warn(`[ScrcpySession:${this.id}] start 被跳过：已有启动正在进行中`);
      return;
    }
    this.startingLock = true;

    // 每会话独立 scid：避免并发会话抢占同一 `localabstract:scrcpy` 隧道（见 generateScid）。
    // 提到 try 之前声明，使 catch/finally 中的诊断也能引用。
    const scid = generateScid();
    // 启动韧性重试参数（ADR-0014 D2），提到 try 之前供诊断引用。
    const MAX_LAUNCH_RETRIES = 1; // 共 2 次：首试 + 1 次自愈重试
    const RETRY_SETTLE_MS = 1000;

    console.log(`[ScrcpySession:${this.id}] start 开始, displayConfig:`, displayConfig ? `${displayConfig.width}x${displayConfig.height}` : 'mirror');
    try {
      this.displayId = null;
      this.updateState({ isStarting: true, error: null, videoWidth: 0, videoHeight: 0 });

      const { AdbScrcpyClient } = await import('@yume-chan/adb-scrcpy');
      const { AdbScrcpyOptions4_0 } = await import('@/lib/scrcpy4');
      const { ReadableStream } = await import('@yume-chan/stream-extra');

      const serverPath = '/data/local/tmp/scrcpy-server.jar';
      const response = await fetch(import.meta.env.BASE_URL + 'scrcpy-server.jar');
      if (!response.ok) {
        throw new Error(`获取 scrcpy-server.jar 失败: HTTP ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength === 0) {
        throw new Error('scrcpy-server.jar 文件为空');
      }

      // 启动前记录已有 PID，用于启动后对比确定本次 PID
      // attach 模式（resumeBackground 接管旧虚拟屏）：用 { displayId } 直接 attach。
      // let + 锁内可降级：旧虚拟屏随其 server 退出已被系统回收（scrcpy 无保留屏能力）
      // 时 attach 必失败 → 降级 newDisplay 重建，后续 displayId 设置走重建分支（S2-P0-9）。
      let attachMode = attachDisplayId != null;
      const useVirtualDisplay = attachMode || !!displayConfig;
      // 专用音频采集连接（audioOnly）也是独立的 scrcpy server 进程，需精确记录 PID，
      // 否则 stop() 无法精确 kill 本会话的 server，误伤同设备其它会话（含分屏 pane）。
      // pidsBefore 必须与 pidsAfter 同在 withLaunchMutex 锁内、与 pushServer+start 原子化：
      // 并发会话若在锁外各自取 before/after，相互污染（把对方刚启动的 server 算作
      // "本次新增"或漏算），导致 serverPid 错配 → stop 时 kill 错进程（S2-P0-5）。
      const trackPid = useVirtualDisplay || audioOnly;

      let client!: AdbScrcpyClient<AdbScrcpyOptions4_0Type>;

      // 串行化「pushServer + start + PID 对比」临界区，避免并发会话在设备端争夺同一
      // localabstract:scrcpy 反向隧道（详见文件顶部 withLaunchMutex 注释）。
      await withLaunchMutex(async () => {
        const pidsBefore = trackPid ? await getScrcpyServerPids(adb) : [];

        // 每次推送（S2-P0-10 结论）：scrcpy server 默认 cleanup 会在每次启动时经
        // CleanUp.unlinkSelf 删除设备端 jar；v3 的 cleanup 字段只声明不序列化（无法关闭）。
        // 故 jar 缓存/跳过推送不可行，必须每次推送（车机 USB 传输 732KB 为启动固有成本）。
        await AdbScrcpyClient.pushServer(
          adb,
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(arrayBuffer));
              controller.close();
            },
          }),
          serverPath,
        );

        const verifyOutput = await runAdbCommand(adb, `ls -la ${serverPath} 2>&1`);
        if (verifyOutput.includes('No such file') || verifyOutput.includes('not found')) {
          throw new Error('scrcpy-server.jar 推送验证失败：设备上未找到文件');
        }

        // attach 模式选项（attachMode 为外层 let，attach 失败时降级为 newDisplay）
        const buildOptions = () => {
          const displayOptions = audioOnly
            ? { displayId: 0 }
            : attachMode
              ? { displayId: attachDisplayId }
              : useVirtualDisplay
                ? {
                  newDisplay: new ScrcpyNewDisplay(displayConfig.width, displayConfig.height, displayConfig.dpi ?? 320),
                  // 2026-08-04（推翻 ADR-0001 的 LockedInitial）：方向锁改为 Unlocked，
                  // 让虚拟屏方向跟随容器宽窄方向 —— 官方 scrcpy 4.0 flex display 的正确姿势。
                  //
                  // 官方 4.0 server（Genymobile/scrcpy NewDisplayCapture.java）机制：
                  // 1. 虚拟屏 Surface 本身不旋转：triggerResize 里
                  //    vdSize = (displayRotation % 2)==0 ? size : size.rotate()，跨轴 resize 时 Surface 保物理方向；
                  // 2. 方向补偿在 capture 的 OpenGL 过滤器：prepare() 每次 capture reset 重读
                  //    displayInfo.getRotation() → filter.addOrientation(...)，DisplayMonitor 检测
                  //    rotation 变化即 reset 重建，输出帧方向 = 虚拟屏当前 rotation；
                  // 3. videoSize = 旋转后逻辑尺寸，经 session packet 上报，客户端按此 contain 渲染即可。
                  //
                  // 为什么不能再用 LockedInitial（"@"）：
                  // - "@" 锁「首帧方向」，输出帧方向恒为首帧方向 —— 宽屏容器里仍是竖屏画面（黑边），
                  //   与「宽窄屏自由调整」的 flex 精神冲突；
                  // - server 端 prepare() 初始硬编码 displayRotation=0（virtualDisplay==null 分支），
                  //   而窄屏虚拟屏（w<h）在部分 ROM 上实际 rotation=90，首帧/锁定方向与真实错位 →
                  //   正是「特定分辨率、尤其窄屏下画面 90° 翻转」的机制来源；宽屏（w>h）rotation=0
                  //   与假设一致，故不触发。
                  //
                  // Unlocked（不传 --capture-orientation）下：方向 = 虚拟屏 rotation = 容器宽窄方向，
                  // 宽屏→横屏画面、窄屏→竖屏画面，始终方向正确且 flex 全开；跨轴瞬间的 1~2 帧
                  // rotation 过渡由 server DisplayMonitor+reset 自愈，客户端侧尺寸变化白闪由
                  // AppTransitionPlaceholder（ADR-0011）兜底。
                  captureOrientation: new ScrcpyCaptureOrientation(ScrcpyLockOrientation.Unlocked, ScrcpyOrientation.Orient0),
                  displayImePolicy: 'local' as const,
                  flexDisplay: true,
                  // keepActive（防休眠）：由 opts.keepActive 控制（默认 false）。
                  // 官方 4.0+ 支持 --keep-active，周期性发送 userActivity 信号保持设备唤醒，
                  // 避免修改 Android 系统级休眠设置，断开即自动恢复。
                  keepActive: opts?.keepActive ?? false,
                  // T1: 禁用虚拟屏系统装饰（状态栏/导航栏/Launcher）。
                  // 关闭后虚拟屏只渲染 app，空屏不出 home 帧，从根上消除
                  // 「新屏首帧是 Launcher 桌面」这一跳（scrcpy --no-vd-system-decorations）。
                  vdSystemDecorations: false,
                }
              : {
                  displayId: 0,
                  keepActive: opts?.keepActive ?? false,
                };

          // audioDup 选项处理：
          // - opts.audioDup 为 true 时，默认使用 'all'（覆盖所有 usages，如游戏等非媒体应用）
          // - opts.audioDup 为 string 时直接透传（如 'all'、'game' 等）
          // - 仅在 audioEnabled 时生效
          const audioDupValue = audioEnabled
            ? (opts?.audioDup === true ? 'all' : (opts?.audioDup || false))
            : false;

          return new AdbScrcpyOptions4_0({
            video,
            ...(video
              ? {
                  videoCodec: 'h264',
                  videoBitRate: displayConfig?.bitRate ?? 8000000,
                  maxFps: 60,
                }
              : {}),
            audio: audioEnabled,
            // 音频编解码器：与 AUDIO_CODEC_FALLBACK 单一旋钮联动，
            // parseAudioStreamMetadata 对未知标签回退到同一值。默认 opus。
            // negotiatedAudioCodec 允许专用音频连接在解码失败时改用 aac 重试（ADR-0016 自愈）。
            audioCodec: negotiatedAudioCodec,
            ...(audioDupValue !== false ? { audioDup: audioDupValue } : {}),
            control,
            // 2026-08-04（S2-P0-10）：移除 stayAwake:true——那是手机场景遗留（防投屏时
            // 手机熄屏）；车机通电常亮不需要。注：曾尝试 cleanup:false 让 server 不删
            // jar（CleanUp.unlinkSelf）以启用 jar 缓存，但核验发现 v3 的 cleanup 字段
            // 只声明不序列化（同 keepActive），无效——jar 缓存方案不可行，保持每次推送。
            ...(control ? { showTouches: false } : {}),
            // audioOnly 模式下只存在音频 socket，设备名（sendDeviceMeta）会写入音频 socket
            // 污染 codec 解析。官方 scrcpy 4.0 默认 sendDeviceMeta=true，此处显式关闭。
            sendDeviceMeta: !audioOnly,
            // 每会话独立隧道端点（见 generateScid）：并发会话互不抢占
            scid,
            ...displayOptions,
          });
        };
        let options = buildOptions();

        // 启动韧性（ADR-0014 D2）：设备端虚拟屏孤儿回收瞬态可能导致
        // AdbScrcpyExitedError（scrcpy server exited prematurely）。刷新/重连后，
        // 上一会话 keepActive 虚拟屏的 owner 进程刚被 kill，屏处于回收瞬态，
        // 此时 newDisplay 易撞上 → 启动失败。等待屏随 owner 死亡被回收后重试一次即可自愈，
        // 无需 pkill（避免误杀同设备其它运行中会话）。
        const START_TIMEOUT_MS = 15000;
        let launchError: unknown = null;
        for (let attempt = 0; attempt <= MAX_LAUNCH_RETRIES; attempt++) {
          try {
            const startWithTimeout = Promise.race([
              AdbScrcpyClient.start(adb, serverPath, options),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () =>
                    reject(
                      new Error(
                        `[ScrcpySession:${this.id}] AdbScrcpyClient.start 超时 (${START_TIMEOUT_MS}ms)，可能 USB 已断开)`,
                      ),
                    ),
                  START_TIMEOUT_MS,
                ),
              ),
            ]);
            // v3 泛型为完整 Init 类型（start 返回 Tolerant<具体init>），
            // 与声明的 Tolerant<Init> 逆变不兼容；运行时一致，此处断言收窄。
            client = (await startWithTimeout) as AdbScrcpyClient<AdbScrcpyOptions4_0Type>;
            launchError = null;
            break;
          } catch (e) {
            if (e instanceof AdbScrcpyExitedError && attempt < MAX_LAUNCH_RETRIES) {
              if (attachMode) {
                // attach 失败：旧虚拟屏已随其 server 退出被系统回收（scrcpy 无
                // "client 断开保留虚拟屏"能力，keepActive 仅是防休眠且 v3 未序列化）。
                // 降级为 newDisplay 重建，避免 resume 永久卡死（S2-P0-9）。
                console.warn(
                  `[ScrcpySession:${this.id}] attach display ${attachDisplayId} 失败（旧虚拟屏已被回收），降级 newDisplay 重建`,
                );
                attachMode = false;
                options = buildOptions();
              }
              console.warn(
                `[ScrcpySession:${this.id}] start 提前退出(${(e as Error).message})，` +
                  `等待设备回收残留虚拟屏后重试 (${attempt + 1}/${MAX_LAUNCH_RETRIES + 1})`,
              );
              // ADR-0014 深化诊断：重试前采集设备侧快照，看首试失败时的真实状态
              await diagnoseFailure(
                adb,
                { id: this.id, scid, attempt: attempt + 1, totalAttempts: MAX_LAUNCH_RETRIES + 1, displayConfig },
                e,
              );
              await sleep(RETRY_SETTLE_MS);
              launchError = e;
              continue;
            }
            throw e; // 非瞬态错误或重试耗尽 → 交由外层 catch 统一处理
          }
        }
        if (launchError && !client) {
          throw launchError;
        }

        // 锁内原子化 PID 对比（并发会话严格串行，before/after 不互相污染）：
        // start 成功则本会话 server 必然是最新出现的 PID（此前已排除 before 集合）。
        if (trackPid) {
          const pidsAfter = await getScrcpyServerPids(adb);
          const newPids = pidsAfter.filter((p) => !pidsBefore.includes(p));
          this.serverPid = newPids.length === 1 ? newPids[0]! : (pidsAfter[pidsAfter.length - 1] ?? null);
          if (this.serverPid) {
            console.log(`[ScrcpySession:${this.id}] 记录 server PID: ${this.serverPid}`);
          }
        }
      });
      this.client = client;
      this.adb = adb;

      if (useVirtualDisplay) {
        try {
          const prevRotation = await getRotationState(adb);
          this.rotationState = prevRotation;
          await setRotationLocked(adb);
        } catch (e) {
          console.warn('锁定旋转方向失败:', e);
        }
      }

      const controller = client.controller;
      if (controller) {
        this.controller = controller;
        this.health.markHealthy();
        console.log(`[ScrcpySession:${this.id}] controller 已建立（control=true, attach=${attachMode}）`);
      } else if (control) {
        // 仅需要 control 的会话（video 会话）才告警；audioOnly（control=false）无
        // controller 属预期（专用音频连接只抓声音、不承载触控），不打噪音日志。
        console.warn(`[ScrcpySession:${this.id}] controller 未建立（client.controller 为 null, control=${control}）`);
      }

      const flexClient = useVirtualDisplay ? new FlexDisplayClient({
        sendResize: async (w, h) => {
          const ctrl = this.health.tryGetController(this.controllerRefAdapter);
          if (!ctrl) {
            console.warn(`[FlexResize:${this.id}] sendResize skipped: controller DEAD, pending=${w}x${h}`);
            return;
          }
          try {
            // v3：改用 ScrcpyControlMessageWriter.resizeDisplay（上游原生序列化，取代自研 5 字节）
            await ctrl.resizeDisplay({ width: w, height: h });
            this.health.markHealthy();
          } catch (error) {
            console.warn(`[FlexResize:${this.id}] sendResize failed: ${error instanceof Error ? error.message : String(error)}`);
            this.health.reportError(error);
          }
        },
        setCanvasSize: (w, h) => {
          if (this._canvas) {
            this._canvas.width = w;
            this._canvas.height = h;
          }
        },
      }) : null;
      this.flexClient = flexClient;
      this.callbacks.onFlexClient?.(flexClient);

      // 视频流 setup（内联自 useVideoDecoder）；仅视频模式需要
      if (video) {
        await this.setupVideoStream(client, canvas, (w, h) => {
          this.updateState({ videoWidth: w, videoHeight: h });
          this.callbacks.onVideoSize(w, h);
          flexClient?.onDecoderSizeChanged(w, h);
        }, flexClient ? (w, h, isClientResize) => flexClient.onSessionPacket(w, h, isClientResize) : undefined);
      }

      if (flexClient && displayConfig) {
        flexClient.setInitialDisplaySize(displayConfig.width, displayConfig.height);
      }

      // 音频流 setup（内联自 useAudioDecoder）
      await this.setupAudioStream(client);

      if (attachMode) {
        // attach 模式：displayId 已知，无需再探测设备端新屏
        this.displayId = attachDisplayId!;
      } else if (useVirtualDisplay) {
        const vid = await getVirtualDisplayId(adb);
        this.displayId = vid;
      } else {
        this.displayId = 0;
      }

      this.updateState({
        isStarting: false,
        isRunning: true,
        isVirtualDisplay: useVirtualDisplay,
      });
      // 诊断（S2-P0-9）：start 完成标志。video 会话无"音频流已建立"日志，
      // 若无本日志则 start 卡在 setupVideoStream/setupAudioStream/displayId 探测。
      console.log(`[ScrcpySession:${this.id}] start 完成, displayId=${this.displayId}, isRunning=true`);
    } catch (error) {
      console.error(`[ScrcpySession:${this.id}] 启动失败:`, error);
      let message = '启动屏幕镜像失败';
      if (error instanceof AdbScrcpyExitedError) {
        message = 'scrcpy server exited prematurely';
        if (error.output.length > 0) {
          message += ': ' + error.output.join('; ');
        }
      } else if (error instanceof Error) {
        message = error.message;
      }
      this.updateState({ isStarting: false, error: message });
      console.error(`[ScrcpySession:${this.id}] 启动错误:`, error);

      // D3 深化诊断（ADR-0014）：AdbScrcpyExitedError 时采集设备侧快照，
      // 定位虚拟屏累积/并发 pane 超限/反向隧道泄漏/真 ROM 不兼容等更深一层原因。
      // 仅打日志，不影响状态与既有失败处理。
      if (error instanceof AdbScrcpyExitedError && adb) {
        await diagnoseFailure(
          adb,
          { id: this.id, scid, attempt: MAX_LAUNCH_RETRIES + 1, totalAttempts: MAX_LAUNCH_RETRIES + 1, displayConfig },
          error,
        );
      }
    } finally {
      this.startingLock = false;
    }
  }

  // ===== 视频流 setup（内联自 useVideoDecoder） =====

  private async setupVideoStream(
    client: AdbScrcpyClient<AdbScrcpyOptions4_0Type>,
    canvas: HTMLCanvasElement,
    onSizeChanged: (width: number, height: number) => void,
    onSessionPacket?: (width: number, height: number, isClientResize: boolean) => void,
  ): Promise<void> {
    const { WebCodecsVideoDecoder } = await import('@yume-chan/scrcpy-decoder-webcodecs');
    const { WebGLVideoFrameRenderer } = await import('@yume-chan/scrcpy-decoder-webcodecs/esm/video/render/webgl.js');

    // 超时兜底：server 未就绪（虚拟屏创建/GPU capture 初始化阻塞，车机多 server
    // 并发时常见）时 videoStream 元数据可能一直不发 → await 无限挂起 → start 卡死
    // （controller 永远 unset → 触控全丢 + 占位层常显，S2-P0-9）。必须超时抛错，
    // 让 start 走失败路径（有日志、UI 有反馈），而非无限卡。
    const videoStream = await withTimeout(
      client.videoStream,
      VIDEO_STREAM_TIMEOUT_MS,
      `[ScrcpySession:${this.id}] 视频流元数据等待超时 (${VIDEO_STREAM_TIMEOUT_MS}ms)：server 视频未就绪（虚拟屏创建 / GPU capture 初始化阻塞？）`,
    );
    if (!videoStream) {
      throw new Error('无法获取视频流');
    }

    // 复用 canvas（分屏↔全屏切换 / resumeBackground 二次 start）时旧 WebGL context
    // 可能已被浏览器回收。lost context 上 new renderer 会 createProgram 失败
    // （"Error: null"）→ 会话启动失败。检测到 lost 即用新 canvas 替换 DOM 旧节点并
    // 更新 this._canvas（上层引用均动态读 this._canvas，无需额外通知）。
    if (isCanvasContextLost(canvas)) {
      console.warn(`[ScrcpySession:${this.id}] canvas WebGL context 已丢失，替换新 canvas 重建渲染`);
      const fresh = document.createElement('canvas');
      fresh.className = canvas.className;
      fresh.style.cssText = canvas.style.cssText;
      if (canvas.parentElement) {
        canvas.parentElement.replaceChild(fresh, canvas);
      }
      canvas = fresh;
      this._canvas = fresh;
    }

    // canvasSize 走默认 'video'：v3 renderer 自动按视频尺寸设置 canvas，首帧即可正常渲染，
    // 无 'external' 模式下等待 flex-client 尺寸链路的延迟；flex-client 的 setCanvasSize
    // 设的同样是视频尺寸，二者一致无冲突。
    const renderer = new WebGLVideoFrameRenderer({ canvas });
    const decoder = new WebCodecsVideoDecoder({
      codec: videoStream.metadata.codec,
      renderer,
    });

    this.videoDecoder = decoder;

    const sizeUnsubscribe = videoStream.sizeChanged((size) => {
      onSizeChanged(size.width, size.height);
    });

    const stream = videoStream.stream;
    const reader = stream.getReader();

    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // v3 的 AdbScrcpyVideoStream.stream 已由上游 createMediaStreamTransformer
          // 解析为 ScrcpyVideoStreamPacket；session 包不写解码器，通知 flex-client。
          const packet = value as ScrcpyVideoStreamPacket;
          if (packet.type === 'session') {
            onSessionPacket?.(packet.width, packet.height, packet.isClientResize);
            continue;
          }

          const writer = decoder.writable.getWriter();
          try {
            await writer.write(value);
          } finally {
            writer.releaseLock();
          }
        }
      } catch (error) {
        // 媒体流正常结束（server 退出 / stop 取消）是会话终止的正常信号而非错误，
        // 静默退出即可——生命周期由 stop()/健康监护负责。
        // 其它异常才是真正的流错误，保留 error 日志便于排查。
        if (!isStreamEndedError(error)) {
          console.error(`[ScrcpySession:${this.id}] 视频流读取错误:`, error);
        }
      }
    };

    pump();

    this.videoCleanup = async () => {
      sizeUnsubscribe();
      // 流可能已因 server 退出 / 连接断开进入 errored 态，此时 cancel 会以
      // ExactReadableEndedError reject。必须接住——否则 stop() 清理链在
      // 「await this.videoCleanup()」处中断，后续 disposeAudio / kill server /
      // 状态更新全部跳过，造成 WebGL context 与设备端进程泄漏（S2-P0-4）。
      await reader.cancel().catch(() => {});
    };
  }

  // ===== 音频流 setup（内联自 useAudioDecoder） =====

  private async setupAudioStream(client: AdbScrcpyClient<AdbScrcpyOptions4_0Type>): Promise<void> {
    // 与视频流同理：server 未就绪时音频元数据可能不发 → await 无限挂起（S2-P0-9）。
    // audio:false 时 audioStream 立即为 undefined（不等待网络），超时不误伤。
    const audioMeta = await withTimeout(
      client.audioStream,
      VIDEO_STREAM_TIMEOUT_MS,
      `[ScrcpySession:${this.id}] 音频流元数据等待超时 (${VIDEO_STREAM_TIMEOUT_MS}ms)：server 音频未就绪`,
    );
    if (!audioMeta) {
      // audio:false（分屏 pane）时 server 不提供音频流，属预期，不告警；
      // 仅当本 session 设计上应承载音频（audioEnabled）却拿不到流才告警。
      if (this.audioEnabled) {
        console.warn(`[ScrcpySession:${this.id}] 音频流不可用: undefined`);
      }
      this.callbacks.onAudioStateChange?.({ status: 'disabled', route: 'browser', muted: false });
      return;
    }

    if (audioMeta.type !== 'success') {
      if (this.audioEnabled) {
        console.warn(`[ScrcpySession:${this.id}] 音频流不可用:`, audioMeta.type);
      }
      this.callbacks.onAudioStateChange?.({
        status: audioMeta.type === 'disabled' ? 'disabled' : 'errored',
        route: 'browser',
        muted: false,
      });
      return;
    }

    try {
      this.callbacks.onAudioStateChange?.({ status: 'starting', route: 'browser', muted: false });

      const audioCtx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      this.audioCtx = audioCtx;

      await audioCtx.audioWorklet.addModule(
        new URL('../hooks/scrcpy/audio/renderer-worklet.js', import.meta.url).href
      );

      if (this.audioDisposed) {
        audioCtx.close().catch(() => {});
        return;
      }

      const workletNode = new AudioWorkletNode(audioCtx, 'float32-source-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      workletNode.connect(audioCtx.destination);
      this.audioWorkletNode = workletNode;

      workletNode.onprocessorerror = (e) => {
        console.error(`[ScrcpySession:${this.id}] AudioWorklet 错误:`, e);
      };

      const worker = new Worker(
        new URL('../hooks/scrcpy/audio/decoder-worker.ts', import.meta.url),
        { type: 'module' }
      );
      this.audioWorker = worker;

      worker.onmessage = (e) => {
        if (this.audioDisposed) return;
        const msg = e.data;
        switch (msg.type) {
          case 'pcm':
            if (this.audioRoute === 'browser' && !this.audioMuted) {
              workletNode.port.postMessage(
                { type: 'pcm', buffer: msg.buffer, sampleRate: msg.sampleRate, channels: msg.channels },
                [msg.buffer]
              );
            } else {
              console.log(`[DEBUG-a3f2] PCM 收到但未转发: route=${this.audioRoute}, muted=${this.audioMuted}`);
            }
            break;
            case 'error':
            console.warn(`[ScrcpySession:${this.id}] 音频解码错误:`, msg.message);
            // 上抛给 SessionManager：专用音频连接据此触发 opus→aac 自愈（ADR-0016）
            this.callbacks.onAudioDecodeError?.(this.id);
            break;
          case 'configured':
            console.log(`[ScrcpySession:${this.id}] 音频解码器配置完成`);
            break;
        }
      };

      const { codec, stream: audioStream } = audioMeta;
      const reader = audioStream.getReader();
      this.audioReader = reader;

      const pump = async () => {
        try {
          while (!this.audioDisposed) {
            const { done, value } = await reader.read();
            if (done) break;

            // v3：上游 createMediaStreamTransformer 已把音频字节流解析为
            // ScrcpyAudioStreamPacket（configuration / data），无需手动 12 字节解析。
            const packet = value as { type: string; data: Uint8Array; pts?: bigint };
            if (packet.type === 'configuration') {
              const codecStr = codec.webCodecId || 'opus';
              const desc = packet.data.byteLength > 0 ? packet.data.slice(0) : undefined;
              worker.postMessage(
                {
                  type: 'configure',
                  codec: codecStr,
                  description: desc,
                  // S2-P0-3：以 AudioContext 实际采样率为输出目标（解码 worker 侧重采样）
                  targetSampleRate: this.audioCtx?.sampleRate ?? 48000,
                },
                desc ? [desc.buffer] : []
              );
            } else {
              const dataBuf = packet.data.slice(0).buffer;
              worker.postMessage(
                {
                  type: 'data',
                  chunk: {
                    type: 'key' as const,
                    data: dataBuf,
                    timestamp: Number(packet.pts ?? 0n),
                  },
                },
                [dataBuf]
              );
            }
          }
          // 音频流结束（server 退出或 socket 关闭）——通知上层以便重启专用音频连接
          if (this.audioOnly) {
            this.callbacks.onAudioStateChange?.({ status: 'errored', route: 'browser', muted: false });
          }
        } catch (e) {
          // 主动停止（disposeAudio 已置 audioDisposed）：静默退出，不触发上层自愈
          if (this.audioDisposed) return;
          // 媒体流正常结束（server 退出 / 连接断开）语义等同 while 循环正常结束，
          // 非错误；audioOnly 连接据此通知上层自愈（ADR-0016）。
          if (!isStreamEndedError(e)) {
            console.warn(`[ScrcpySession:${this.id}] 音频流读取错误:`, e);
          }
          if (this.audioOnly) {
            this.callbacks.onAudioStateChange?.({ status: 'errored', route: 'browser', muted: false });
          }
        }
      };

      pump();

      console.log(`[ScrcpySession:${this.id}] 音频流已建立并开始播放（AudioContext state=${this.audioCtx?.state}, codec=${audioMeta.codec.webCodecId}）`);
      this.callbacks.onAudioStateChange?.({ status: 'playing', route: 'browser', muted: false });
      if (this.audioOnly) {
        // 仅音频连接无 control 通道，健康检查无法经 controller 验证；
        // 音频流已成功建立即视为健康，避免被健康监护误杀。
        this.health.markHealthy();
      }
    } catch (e) {
      console.error(`[ScrcpySession:${this.id}] 音频启动失败:`, e);
      if (this.audioCtx) {
        this.audioCtx.close().catch(() => {});
        this.audioCtx = null;
      }
      this.callbacks.onAudioStateChange?.({ status: 'errored', route: 'browser', muted: false });
    }
  }

  // ===== 停止 =====

  /**
   * 停止 scrcpy 会话。
   *
   * 使用 stop 互斥锁防止多 session 并发 stop 时 PID 误杀。
   * 优先按 PID 精确 kill，PID 不可用时降级为全杀（仅单实例场景安全）。
   */
  async stop(): Promise<void> {
    if (this.stoppingLock) {
      console.warn(`[ScrcpySession:${this.id}] stop 被跳过：已有停止正在进行中`);
      return;
    }
    this.stoppingLock = true;

    try {
      const adb = this.adb;
      if (adb && this.rotationState) {
        try {
          await restoreRotation(adb, this.rotationState);
        } catch (e) {
          console.warn(`[ScrcpySession:${this.id}] 恢复旋转方向失败:`, e);
        }
        this.rotationState = null;
      }

      // 视频解码清理：每个清理步骤独立容错。
      // 流已 errored（server 提前退出）时 videoCleanup 的 cancel 会以
      // ExactReadableEndedError reject——若不做隔离，单个失败会把整条清理链带进
      // catch，导致后续 disposeAudio / kill server / 状态更新全部跳过，
      // 造成 WebGL context 与设备端 scrcpy 进程残留（S2-P0-4 泄漏根因）。
      if (this.videoCleanup) {
        const cleanup = this.videoCleanup;
        this.videoCleanup = null;
        await cleanup().catch((e) => {
          console.warn(`[ScrcpySession:${this.id}] 视频流清理失败（已忽略，继续清理）:`, e);
        });
      }
      if (this.videoDecoder) {
        try {
          this.videoDecoder.dispose();
        } catch (e) {
          // WebGL context 已丢失时 dispose 可能失败，忽略但保留日志
          console.warn(`[ScrcpySession:${this.id}] videoDecoder.dispose 失败（已忽略）:`, e);
        }
        this.videoDecoder = null;
      }

      // 音频解码清理
      this.disposeAudio();

      if (this.flexClient) {
        this.flexClient.dispose();
        this.flexClient = null;
        this.callbacks.onFlexClient?.(null);
      }

      if (this.controller) {
        try {
          // 连接断开时 controller 的底层流可能已处于 errored 状态，
          // close() 会 reject（Cannot close a ERRORED writable stream），接住即可。
          await this.controller.close();
        } catch {
          // 忽略：本地清理不依赖该结果。
        }
        this.controller = null;
      }

      if (this.client) {
        try {
          await this.client.close();
        } catch {
          // 设备已断开时 scrcpy server 进程不存在，close 可能失败，忽略。
        }
        this.client = null;
      }

      // PID 精确 kill（多实例安全）。
      // 注意：不提供「PID 不可用时全杀」降级——`pkill -f scrcpy` 会误杀同设备其它
      // 运行中会话（全屏 pane / 专用音频连接），是「start 失败 → stop → 全部会话
      // 被连带杀死」连锁的根因（S2-P0-5）。
      // - 正常启动的会话：PID 追踪已在互斥锁内原子化，serverPid 必然非 null；
      // - start 失败（client 为 null，serverPid 为 null）：失败的 server 已自行退出
      //   （Aborted）或残留孤儿进程，由冷启动对账（0 会话时 killScrcpyServer）统一清理；
      // - v3 的 client.close() 已可靠关闭本 server 的 socket → 进程退出，无需额外 kill。
      if (adb && this.serverPid !== null) {
        await killScrcpyByPid(adb, this.serverPid).catch(() => {});
        this.serverPid = null;
      }

      this.displayId = null;

      this.updateState({
        isStarting: false,
        isRunning: false,
        error: null,
        videoWidth: 0,
        videoHeight: 0,
        isVirtualDisplay: false,
      });
    } catch (error) {
      console.error(`[ScrcpySession:${this.id}] 停止错误:`, error);
    } finally {
      this.stoppingLock = false;
    }
  }

  // ===== 音频清理 =====

  private disposeAudio(): void {
    this.audioDisposed = true;

    if (this.audioReader) {
      this.audioReader.cancel().catch(() => {});
      this.audioReader = null;
    }
    if (this.audioWorker) {
      this.audioWorker.terminate();
      this.audioWorker = null;
    }
    if (this.audioWorkletNode) {
      this.audioWorkletNode.disconnect();
      this.audioWorkletNode = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }

  // ===== 输入注入 =====

  async injectTouch(message: {
    action: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
    pointerId: bigint;
    pointerX: number;
    pointerY: number;
    videoWidth: number;
    videoHeight: number;
    pressure: number;
    actionButton: number;
    buttons: number;
  }): Promise<void> {
    const controller = this.health.tryGetController(this.controllerRefAdapter);
    if (!controller) {
      // 诊断（S2-P0-8）：controller 缺失 / health DEAD 时触控静默丢弃。
      // HoverMove（鼠标悬停，action=7）丢弃不打日志——车机上无意义且高频，
      // 用户"未点击"也会因鼠标移动触发，易被误读为点击失败（S2-P0-9 教训）。
      // 仅真实按键事件（Down/Move/Up 等）在原因（unset/DEAD）变化时打一条 warn。
      const isHover = message.action === 7; // AndroidMotionEventAction.HoverMove
      if (!isHover) {
        const reason = this.controller === null ? 'unset' : `present(${this.health.state})`;
        if (this.lastTouchDropReason !== reason) {
          this.lastTouchDropReason = reason;
          console.warn(
            `[ScrcpySession:${this.id}] 触控被丢弃: controller=${this.controller === null ? 'unset' : 'present'}, health=${this.health.state}`,
          );
        }
      }
      return;
    }

    try {
      await controller.injectTouch(message);
      this.health.markHealthy();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('Socket closed')) {
        console.error(`[ScrcpySession:${this.id}] 触摸事件转发错误:`, error);
      } else {
        // controller 通道已关闭（本会话被 stop / 设备端断开 / server 退出）。
        // 保留一条带会话 id 的 warn，便于多会话并发时定位「哪个会话的触控失效」。
        console.warn(`[ScrcpySession:${this.id}] 触摸事件转发失败: 控制器通道已关闭 (Socket closed, health=${this.health.state})`);
      }
      this.health.reportError(error);
    }
  }

  async injectText(text: string): Promise<void> {
    const controller = this.health.tryGetController(this.controllerRefAdapter);
    if (!controller) return;

    try {
      await controller.injectText(text);
      this.health.markHealthy();
    } catch (error) {
      this.health.reportError(error);
    }
  }

  async injectKeyCode(keyCode: AndroidKeyCode): Promise<void> {
    const controller = this.health.tryGetController(this.controllerRefAdapter);
    if (!controller) return;

    try {
      await controller.injectKeyCode({
        action: AndroidKeyEventAction.Down,
        keyCode,
        repeat: 0,
        metaState: 0,
      });
      await controller.injectKeyCode({
        action: AndroidKeyEventAction.Up,
        keyCode,
        repeat: 0,
        metaState: 0,
      });
      this.health.markHealthy();
    } catch (error) {
      this.health.reportError(error);
    }
  }

  async goHome(): Promise<void> {
    await this.injectKeyCode(AndroidKeyCode.AndroidHome);
  }

  async goBack(): Promise<void> {
    const controller = this.health.tryGetController(this.controllerRefAdapter);
    if (!controller) return;
    try {
      await controller.backOrScreenOn(0);
      this.health.markHealthy();
    } catch (error) {
      this.health.reportError(error);
    }
  }

  async showRecentApps(): Promise<void> {
    await this.injectKeyCode(AndroidKeyCode.AndroidAppSwitch);
  }

  async startApp(packageName: string): Promise<void> {
    const controller = this.health.tryGetController(this.controllerRefAdapter);
    if (!controller) return;
    try {
      await controller.startApp(packageName);
      this.health.markHealthy();
    } catch (error) {
      this.health.reportError(error);
    }
  }

  // ===== 虚拟屏应用管理 =====

  /**
   * 在虚拟屏启动指定 app（原生 scrcpy startApp 控制消息）。
   *
   * T2：改用 scrcpy server 原生的 startApp（控制消息 type 16）直接在本次会话
   * 附着的虚拟屏上启动 app，替代 adb-commands 的 `am start --display` + 策略2
   * 「主屏启动 + move-to-display 搬运」回退 + 三个 sleep。
   *
   * 本 session 已通过 newDisplay 附着到虚拟屏，controller.startApp 即落到该屏，
   * 不再有「先在主屏出现再被搬进虚拟屏」的跳转，也不依赖 ROM 是否支持 `am --display`。
   */
  async startAppOnDisplay(packageName: string): Promise<void> {
    await this.startApp(packageName);
  }

  // ===== 音频控制 =====

  setAudioRoute(route: 'browser' | 'phone'): void {
    this.audioRoute = route;
  }

  setMuted(muted: boolean): void {
    this.audioMuted = muted;
  }

  resumeAudio(): void {
    // 本 session 设计上不承载音频（分屏 pane，音频由专用采集连接统一处理）→ 静默跳过
    if (!this.audioEnabled) return;

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      console.log(`[ScrcpySession:${this.id}] resumeAudio: 唤醒 suspended AudioContext`);
      this.audioCtx.resume().catch((e) => console.warn(`[ScrcpySession:${this.id}] resume 失败:`, e));
    } else if (!this.audioCtx) {
      // 无 audioCtx ⇒ 音频流尚未建立（client.audioStream 返回 disabled/undefined），resume 无效。
      // 启动后 1~2 秒内属正常态，且仅在每条指针事件上被调用，故每会话仅告警一次，避免淹没控制台。
      if (!this.audioNoCtxWarned) {
        this.audioNoCtxWarned = true;
        console.warn(`[ScrcpySession:${this.id}] resumeAudio: 无 AudioContext（音频流可能未建立，启动初期正常）`);
      }
    }
  }

  // ===== 销毁 =====

  /**
   * 完全销毁 session，释放所有资源。
   *
   * 与 stop() 的区别：dispose() 额外清理 canvas 元素和健康监听，
   * 用于 session 从 SessionManager 移除时调用。
   */
  async dispose(): Promise<void> {
    await this.stop();

    if (this.healthUnsubscribe) {
      this.healthUnsubscribe();
      this.healthUnsubscribe = null;
    }

    // canvas 在 stop 后仍保留（可能在 DOM 中），由调用方从 DOM 移除后再置空
    // 此处置空引用，但 DOM 节点的清理由调用方负责
    this._canvas = null;
  }
}
