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
import type { ScrcpyControlMessageWriter } from '@yume-chan/scrcpy';
import { ScrcpyNewDisplay, ScrcpyCaptureOrientation, AndroidKeyCode, AndroidKeyEventAction } from '@yume-chan/scrcpy';
import { AdbScrcpyOptions4_0, FlexDisplayClient, serializeResizeDisplay, RESIZE_DISPLAY_TYPE, ControllerHealth } from '@/lib/scrcpy4';
import type { AdbScrcpyOptions4_0 as AdbScrcpyOptions4_0Type, Scrcpy4MediaPacket } from '@/lib/scrcpy4';
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
  startAppOnDisplay,
  getDefaultHomePackage,
  forceStopPackage,
  killScrcpyServer,
  killScrcpyByPid,
  getScrcpyServerPids,
} from '@/lib/adb-commands';
import type { RotationState } from '@/lib/adb-commands';

export interface DisplayConfig {
  width: number;
  height: number;
  dpi?: number;
  bitRate?: number;
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
}

// 音频流原始包解析常量（与 useAudioDecoder 一致）
const PTS_CONFIG = 1n << 63n;
const PTS_CONFIG_4 = 1n << 62n;
const PTS_MASK = (1n << 61n) - 1n;

export class ScrcpySession {
  public readonly id: string;
  public displayId: number | null = null;

  // ===== 持有的资源 =====
  /** session 拥有的 canvas 元素，start() 时创建，跨 pane/fullscreen 复用 */
  private _canvas: HTMLCanvasElement | null = null;
  private client: AdbScrcpyClient<AdbScrcpyOptions4_0Type<true>> | null = null;
  private controller: ScrcpyControlMessageWriter | null = null;
  private adb: Adb | null = null;
  private rotationState: RotationState | null = null;
  private flexClient: FlexDisplayClient | null = null;
  private health = new ControllerHealth();

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
  private audioBuf: Uint8Array = new Uint8Array(0);
  private audioRoute: 'browser' | 'phone' = 'browser';
  private audioMuted = false;
  private audioDisposed = false;

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

  constructor(id: string, callbacks: ScrcpySessionCallbacks) {
    this.id = id;
    this.callbacks = callbacks;

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
  async start(adb: Adb, displayConfig?: DisplayConfig): Promise<void> {
    // 复用或创建 canvas
    if (!this._canvas) {
      this._canvas = document.createElement('canvas');
      this._canvas.className = 'scrcpy-canvas';
      this._canvas.style.width = '100%';
      this._canvas.style.height = '100%';
      this._canvas.style.display = 'block';
    }
    const canvas = this._canvas;

    this.health.reset();

    if (this.startingLock) {
      console.warn(`[ScrcpySession:${this.id}] start 被跳过：已有启动正在进行中`);
      return;
    }
    this.startingLock = true;

    const startTime = Date.now();
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
      const pidsBefore = displayConfig ? await getScrcpyServerPids(adb) : [];

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

      const useVirtualDisplay = !!displayConfig;
      const options = new AdbScrcpyOptions4_0({
        video: true,
        videoCodec: 'h264',
        videoBitRate: displayConfig?.bitRate ?? 8000000,
        maxFps: 60,
        audio: true,
        control: true,
        stayAwake: true,
        showTouches: false,
        ...(useVirtualDisplay
          ? {
              newDisplay: new ScrcpyNewDisplay(displayConfig.width, displayConfig.height, displayConfig.dpi ?? 320),
              captureOrientation: ScrcpyCaptureOrientation.Unlocked,
              displayImePolicy: 'local' as const,
              flexDisplay: true,
              keepActive: true,
            }
          : { displayId: 0 }
        ),
      });

      const client = await AdbScrcpyClient.start(adb, serverPath, options);
      this.client = client;
      this.adb = adb;

      // 启动后对比 PID，确定本次启动的 server PID
      if (useVirtualDisplay) {
        const pidsAfter = await getScrcpyServerPids(adb);
        const newPids = pidsAfter.filter((p) => !pidsBefore.includes(p));
        this.serverPid = newPids.length === 1 ? newPids[0]! : (pidsAfter[pidsAfter.length - 1] ?? null);
        if (this.serverPid) {
          console.log(`[ScrcpySession:${this.id}] 记录 server PID: ${this.serverPid}`);
        }
      }

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
      }

      const resizeTypeByte = RESIZE_DISPLAY_TYPE;

      const flexClient = useVirtualDisplay ? new FlexDisplayClient({
        sendResize: async (w, h) => {
          const ctrl = this.health.tryGetController(this.controllerRefAdapter);
          if (!ctrl) {
            console.warn(`[FlexResize:${this.id}] sendResize skipped: controller DEAD, pending=${w}x${h}`);
            return;
          }
          try {
            const bytes = serializeResizeDisplay(resizeTypeByte, w, h);
            await ctrl.write(bytes);
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

      // 视频流 setup（内联自 useVideoDecoder）
      await this.setupVideoStream(client, canvas, (w, h) => {
        this.updateState({ videoWidth: w, videoHeight: h });
        this.callbacks.onVideoSize(w, h);
        flexClient?.onDecoderSizeChanged(w, h);
      }, flexClient ? (w, h, clientResized) => flexClient.onSessionPacket(w, h, clientResized) : undefined);

      if (flexClient && displayConfig) {
        flexClient.setInitialDisplaySize(displayConfig.width, displayConfig.height);
      }

      // 音频流 setup（内联自 useAudioDecoder）
      await this.setupAudioStream(client);

      if (useVirtualDisplay) {
        const vid = await getVirtualDisplayId(adb);
        this.displayId = vid;

        try {
          const homePkg = await getDefaultHomePackage(adb);
          if (homePkg) await forceStopPackage(adb, homePkg);
        } catch (e) {
          console.warn('关闭虚拟屏 Launcher 失败:', e);
        }
      } else {
        this.displayId = 0;
      }

      this.updateState({
        isStarting: false,
        isRunning: true,
        isVirtualDisplay: useVirtualDisplay,
      });
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
    } finally {
      this.startingLock = false;
    }
  }

  // ===== 视频流 setup（内联自 useVideoDecoder） =====

  private async setupVideoStream(
    client: AdbScrcpyClient<AdbScrcpyOptions4_0Type<true>>,
    canvas: HTMLCanvasElement,
    onSizeChanged: (width: number, height: number) => void,
    onSessionPacket?: (width: number, height: number, clientResized: boolean) => void,
  ): Promise<void> {
    const { WebCodecsVideoDecoder } = await import('@yume-chan/scrcpy-decoder-webcodecs');
    const { WebGLVideoFrameRenderer } = await import('@yume-chan/scrcpy-decoder-webcodecs/esm/video/render/webgl.js');

    const videoStream = await client.videoStream;
    if (!videoStream) {
      throw new Error('无法获取视频流');
    }

    const renderer = new WebGLVideoFrameRenderer(canvas);
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

          const packet = value as Scrcpy4MediaPacket;
          if (packet.type === 'session') {
            onSessionPacket?.(packet.width, packet.height, packet.clientResized);
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
        console.error(`[ScrcpySession:${this.id}] 视频流读取错误:`, error);
      }
    };

    pump();

    this.videoCleanup = async () => {
      sizeUnsubscribe();
      await reader.cancel();
    };
  }

  // ===== 音频流 setup（内联自 useAudioDecoder） =====

  private async setupAudioStream(client: AdbScrcpyClient<AdbScrcpyOptions4_0Type<true>>): Promise<void> {
    const audioMeta = await client.audioStream;
    if (!audioMeta) {
      console.warn(`[ScrcpySession:${this.id}] 音频流不可用: undefined`);
      this.callbacks.onAudioStateChange?.({ status: 'disabled', route: 'browser', muted: false });
      return;
    }

    if (audioMeta.type !== 'success') {
      console.warn(`[ScrcpySession:${this.id}] 音频流不可用:`, audioMeta.type);
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
        audioCtx.close();
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
            }
            break;
          case 'error':
            console.warn(`[ScrcpySession:${this.id}] 音频解码错误:`, msg.message);
            break;
          case 'configured':
            console.log(`[ScrcpySession:${this.id}] 音频解码器配置完成`);
            break;
        }
      };

      const { codec, stream: audioStream } = audioMeta;
      const reader = audioStream.getReader();
      this.audioReader = reader;
      this.audioBuf = new Uint8Array(0);

      const pump = async () => {
        try {
          while (!this.audioDisposed) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = value as unknown as Uint8Array;
            const merged = new Uint8Array(this.audioBuf.byteLength + chunk.byteLength);
            merged.set(this.audioBuf, 0);
            merged.set(chunk, this.audioBuf.byteLength);
            this.audioBuf = merged;

            while (this.audioBuf.byteLength >= 12) {
              const dv = new DataView(this.audioBuf.buffer, this.audioBuf.byteOffset, this.audioBuf.byteLength);
              const pts = dv.getBigUint64(0, false);
              const size = dv.getUint32(8, false);
              const totalLen = 12 + size;
              if (this.audioBuf.byteLength < totalLen) break;

              const data = this.audioBuf.slice(12, totalLen);
              const isConfig = (pts & PTS_CONFIG) !== 0n || (pts & PTS_CONFIG_4) !== 0n;

              if (isConfig) {
                const codecStr = codec.webCodecId || 'opus';
                const desc = data.byteLength > 0 ? data.slice(0) : undefined;
                worker.postMessage(
                  { type: 'configure', codec: codecStr, description: desc },
                  desc ? [desc.buffer] : []
                );
              } else {
                const dataBuf = data.slice(0).buffer;
                const realPts = pts & PTS_MASK;
                worker.postMessage(
                  {
                    type: 'data',
                    chunk: {
                      type: 'key' as const,
                      data: dataBuf,
                      timestamp: Number(realPts),
                    },
                  },
                  [dataBuf]
                );
              }

              this.audioBuf = this.audioBuf.slice(totalLen);
            }
          }
        } catch (e) {
          console.warn(`[ScrcpySession:${this.id}] 音频流读取错误:`, e);
        }
      };

      pump();

      this.callbacks.onAudioStateChange?.({ status: 'playing', route: 'browser', muted: false });
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

      // 视频解码清理
      if (this.videoCleanup) {
        await this.videoCleanup();
        this.videoCleanup = null;
      }
      if (this.videoDecoder) {
        this.videoDecoder.dispose();
        this.videoDecoder = null;
      }

      // 音频解码清理
      this.disposeAudio();

      if (this.flexClient) {
        this.flexClient.dispose();
        this.flexClient = null;
      }

      if (this.controller) {
        this.controller.close();
        this.controller = null;
      }

      if (this.client) {
        await this.client.close();
        this.client = null;
      }

      // PID 精确 kill（多实例安全）
      if (adb && this.serverPid !== null) {
        await killScrcpyByPid(adb, this.serverPid).catch(() => {});
        this.serverPid = null;
      } else if (adb) {
        // 降级：PID 不可用时全杀（仅在单实例场景安全）
        await killScrcpyServer(adb, true).catch(() => {});
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
      this.audioCtx.close();
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
    if (!controller) return;

    try {
      await controller.injectTouch(message);
      this.health.markHealthy();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('Socket closed')) {
        console.error(`[ScrcpySession:${this.id}] 触摸事件转发错误:`, error);
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

  async ensureDisplayId(): Promise<number | null> {
    if (this.displayId !== null) return this.displayId;
    if (!this.adb) return null;

    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const vid = await getVirtualDisplayId(this.adb);
      if (vid !== null) {
        this.displayId = vid;
        return vid;
      }
    }
    return null;
  }

  async startAppOnDisplay(packageName: string): Promise<void> {
    if (!this.adb) return;
    const displayId = await this.ensureDisplayId();
    if (displayId !== null) {
      await startAppOnDisplay(this.adb, packageName, displayId);
    }
  }

  // ===== 音频控制 =====

  setAudioRoute(route: 'browser' | 'phone'): void {
    this.audioRoute = route;
  }

  setMuted(muted: boolean): void {
    this.audioMuted = muted;
  }

  resumeAudio(): void {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
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
