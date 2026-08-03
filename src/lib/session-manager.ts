/**
 * SessionManager —— 统一管理所有 ScrcpySession 实例、app 状态机、displayId 池。
 *
 * 设计参考：docs/plans/2026-07-05-split-desktop-design.md
 *
 * 核心职责：
 * 1. 持有所有 ScrcpySession 实例（Record<sessionId, ManagedSession>）
 * 2. 维护 app 运行状态四态（foreground-pane / foreground-fullscreen / background / closed）
 * 3. 维护 paneLeft / paneRight / fullscreenSessionId 引用
 * 4. 实现设计文档 §3 的状态转换矩阵
 * 5. 管理 displayId 池（background 恢复时复用原 displayId）
 *
 * 关键原则（§3.1）：session 不重启，只换渲染目标 canvas。
 * 分屏 ↔ 全屏转换时，通过 ScrcpySession.reparentCanvas() 移动 DOM 父节点，
 * 保持 WebGL context 不变，音频画面连续不断。
 *
 * 并发上限（§2.3）：最多 3 个 streaming session（左 pane + 右 pane + 1 全屏覆盖层）
 * + N 个 background session（仅占设备虚拟屏，不占浏览器解码资源）。
 */

import { create } from 'zustand';
import { ScrcpySession, type DisplayConfig, type SessionState } from './scrcpy-session';

/** 音频编解码器名（与 AUDIO_CODEC_FALLBACK 的类型一致，ADR-0016 自愈用）。 */
type AudioCodecName = "opus" | "aac" | "flac" | "raw";
import type { Adb } from '@yume-chan/adb';
import { forceStopPackage, killScrcpyServer } from './adb-commands';
import { useAdbStore } from '@/hooks/useAdbStore';
import type { AudioState } from '@/hooks/scrcpy/audio/types';

/** 聚合多个 session 的音频状态，决定侧边栏音频/静音按钮的显示 */
function aggregateAudioStatus(states: AudioState[]): AudioState['status'] {
  if (states.length === 0) return 'idle';
  if (states.some((s) => s.status === 'playing')) return 'playing';
  if (states.some((s) => s.status === 'starting')) return 'starting';
  if (states.some((s) => s.status === 'disabled')) return 'disabled';
  if (states.some((s) => s.status === 'errored')) return 'errored';
  return 'idle';
}

export type PaneSlot = 'left' | 'right';

/**
 * 冷启动对账（ADR-0014 D1）：刷新/重连后，上一页面会话遗留的 scrcpy server 进程
 * （keepActive 虚拟屏的 owner）可能尚未被设备回收，其虚拟屏处于「回收瞬态」，
 * 首次 newDisplay 会撞上 → AdbScrcpyExitedError。
 *
 * 在「浏览器侧 0 会话」的冷启动窗口，安全地杀光设备端残留 scrcpy 进程
 * （不影响任何运行中会话），并短暂 settle 等待孤儿屏随 owner 死亡被回收，
 * 使首次启动从干净状态开始。仅冷启动跑一次（模块级 flag，刷新后重置）。
 */
let coldStartReconciled = false;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function reconcileVirtualDisplaysOnColdStart(adb: Adb): Promise<void> {
  if (coldStartReconciled) return;
  coldStartReconciled = true;
  try {
    // pkill -f scrcpy + 删 jar；仅冷启动（0 会话）调用，安全。jar 会在下次 start 重新推送。
    await killScrcpyServer(adb, true);
    await sleep(800); // 等待 keepActive 孤儿屏随 owner 进程死亡被回收
    console.log('[SessionManager] 冷启动对账完成：已清理设备端残留 scrcpy 进程');
  } catch (e) {
    console.warn('[SessionManager] 冷启动对账失败（可忽略，依赖启动重试兜底 D2）:', e);
  }
}
export type AppRuntimeState = 'foreground-pane' | 'foreground-fullscreen' | 'background' | 'closed';

export interface AppInstance {
  /** ScrcpySession.id */
  sessionId: string;
  packageName: string;
  state: AppRuntimeState;
  /** foreground-pane 时标注所在 pane */
  pane?: PaneSlot;
  /** foreground-fullscreen 时记录来源 pane（从哪个 pane 全屏的） */
  sourcePane?: PaneSlot;
  /** background 恢复时复用 */
  displayId: number | null;
  /** 应用显示名（可选，由 UI 层填充） */
  appLabel?: string;
}

/** SessionManager 内部使用的 session + state 快照 */
export interface ManagedSession {
  session: ScrcpySession;
  state: SessionState;
}

interface SessionManagerState {
  /** sessionId → ManagedSession */
  sessions: Record<string, ManagedSession>;
  /** 所有活跃 app（不含 closed） */
  apps: AppInstance[];
  /** 左 pane 的 sessionId */
  paneLeft: string | null;
  /** 右 pane 的 sessionId */
  paneRight: string | null;
  /** 当前全屏覆盖层的 sessionId */
  fullscreenSessionId: string | null;
  /** 专用音频采集连接的 sessionId（ADR-0015）：全设备唯一 audio:true 的连接，捕获整机声音。 */
  audioCaptureSessionId: string | null;
  /** 专用音频连接当前使用的音频编解码器（ADR-0016 自愈）：默认 opus，解码失败自动切 aac。 */
  audioCaptureCodec: AudioCodecName | null;
  /** 专用音频连接是否已尝试过 aac 回退，防止重复重试死循环。 */
  audioCaptureRetried: boolean;
  /** ADB 连接（由 setAdb 设置） */
  adb: Adb | null;
  /** displayId 池：已分配的 displayId 集合，用于避免冲突 */
  allocatedDisplayIds: Set<number>;
  /** 每个 session 的音频状态（供侧边栏音频/静音按钮聚合） */
  audioStatusBySession: Record<string, AudioState>;
  /** 全局桌面静音（作用于所有 streaming session） */
  isMuted: boolean;
  /** 聚合后的音频状态（供侧边栏显示） */
  audioStatus: AudioState['status'];

  // ===== 持久化回调（由外部设置，避免循环依赖）=====
  _persistCallback: ((left: string | null, right: string | null) => void) | null;

  // ===== 内部辅助 =====
  _generateSessionId: () => string;
  _createSessionWithCallbacks: (sessionId: string) => ScrcpySession;
  _getSession: (sessionId: string) => ScrcpySession | null;
  _updateAppState: (sessionId: string, patch: Partial<AppInstance>) => void;
  _removeApp: (sessionId: string) => void;
  _setPane: (pane: PaneSlot, sessionId: string | null) => void;
  _persistPanes: () => void;
  _registerSession: (sessionId: string, session: ScrcpySession) => void;
  _unregisterSession: (sessionId: string) => void;
  /** 返回「已连接且存活」的 adb；adb 为空或 connectionStatus 非 'connected' 时返回 null（见 2026-07-09 启动门禁诊断）。 */
  getLiveAdb: () => Adb | null;
  /** 让一个 app 进入 background 状态（断开 scrcpy，保留虚拟屏） */
  _backgroundify: (sessionId: string) => Promise<void>;
  /** 重启 background app 的 scrcpy session（恢复 streaming，复用原 displayId） */
  _restartSession: (sessionId: string, displayConfig: DisplayConfig) => Promise<void>;
  /** 确保专用音频采集连接存在并运行（全设备唯一 audio:true）。codec 指定请求编码，默认 opus；解码失败由 onAudioDecodeError 回调改用 aac 重试（ADR-0016）。 */
  _ensureAudioCapture: (adb: Adb, codec?: AudioCodecName) => Promise<void>;
  /** 停止并移除专用音频采集连接。 */
  _stopAudioCapture: () => Promise<void>;
  /** 更新某个 session 的音频状态并重新聚合全局 audioStatus */
  _setSessionAudio: (sessionId: string, audioState: AudioState) => void;

  // ===== actions =====
  setAdb: (adb: Adb | null) => void;
  setPersistCallback: (cb: ((left: string | null, right: string | null) => void) | null) => void;
  /** 全局静音切换（作用于所有 streaming session） */
  setMuted: (muted: boolean) => void;
  launchOnPane: (packageName: string, pane: PaneSlot, displayConfig: DisplayConfig, appLabel?: string) => Promise<string | null>;
  launchFullscreen: (packageName: string, displayConfig: DisplayConfig, appLabel?: string) => Promise<string | null>;
  paneToFullscreen: (pane: PaneSlot) => Promise<void>;
  fullscreenToPane: (pane: PaneSlot) => Promise<void>;
  fullscreenToDesktop: () => Promise<void>;
  closePane: (pane: PaneSlot) => Promise<void>;
  closeFullscreen: () => Promise<void>;
  switchPaneApp: (pane: PaneSlot, packageName: string, displayConfig: DisplayConfig, appLabel?: string) => Promise<void>;
  closeApp: (sessionId: string) => Promise<void>;
  closeAll: () => Promise<void>;
  resumeBackground: (sessionId: string, displayConfig: DisplayConfig, target?: 'pane' | 'fullscreen') => Promise<void>;

  // ===== 只读访问器（供 UI 层使用）=====
  getSession: (sessionId: string) => ScrcpySession | null;
  getApp: (sessionId: string) => AppInstance | undefined;
  getPaneApp: (pane: PaneSlot) => AppInstance | null;
  getFullscreenApp: () => AppInstance | null;
  /** 当前 streaming session 数量（用于并发上限检查） */
  getStreamingCount: () => number;
}

let sessionCounter = 0;

export const useSessionManager = create<SessionManagerState>((set, get) => ({
  sessions: {},
  apps: [],
  paneLeft: null,
  paneRight: null,
  fullscreenSessionId: null,
  audioCaptureSessionId: null,
  audioCaptureCodec: null,
  audioCaptureRetried: false,
  adb: null,
  allocatedDisplayIds: new Set(),
  audioStatusBySession: {},
  isMuted: false,
  audioStatus: 'idle',
  _persistCallback: null,

  // ===== 内部辅助实现 =====

  _generateSessionId: () => {
    sessionCounter += 1;
    return `session-${Date.now()}-${sessionCounter}`;
  },

  _createSessionWithCallbacks: (sessionId) => {
    return new ScrcpySession(sessionId, {
      onStateChange: (newState) => {
        set((state) => {
          const existing = state.sessions[sessionId];
          if (!existing) return state;
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: { session: existing.session, state: newState },
            },
          };
        });
      },
      onVideoSize: () => {},
      onAudioStateChange: (state) => {
        get()._setSessionAudio(sessionId, state);
        // 专用音频连接流结束（server 退出）→ 清理并自动重启
        const s = get();
        if (sessionId === s.audioCaptureSessionId && state.status === 'errored') {
          console.warn('[SessionManager] 专用音频连接流已结束，自动重启');
          set({ audioCaptureSessionId: null, audioCaptureCodec: null, audioCaptureRetried: false });
          get()._unregisterSession(sessionId);
          const liveAdb = get().getLiveAdb();
          if (liveAdb) void get()._ensureAudioCapture(liveAdb, 'opus');
        }
      },
      onAudioDecodeError: (sid) => {
        const s = get();
        if (sid !== s.audioCaptureSessionId) return; // 仅专用音频连接触发自愈
        if (s.audioCaptureCodec === 'opus' && !s.audioCaptureRetried) {
          set({ audioCaptureRetried: true });
          console.warn('[SessionManager] 专用音频 opus 解码失败，自动改用 aac 重试（ADR-0016 自愈）');
          const liveAdb = get().getLiveAdb();
          if (liveAdb) void get()._ensureAudioCapture(liveAdb, 'aac');
        } else {
          console.error(`[SessionManager] 专用音频解码失败（codec=${s.audioCaptureCodec}），已无更多回退`);
        }
      },
      onHealthChange: () => {},
    });
  },

  _getSession: (sessionId) => {
    return get().sessions[sessionId]?.session ?? null;
  },

  _updateAppState: (sessionId, patch) => {
    set((state) => ({
      apps: state.apps.map((app) =>
        app.sessionId === sessionId ? { ...app, ...patch } : app
      ),
    }));
  },

  _removeApp: (sessionId) => {
    set((state) => ({
      apps: state.apps.filter((app) => app.sessionId !== sessionId),
    }));
  },

  _setPane: (pane, sessionId) => {
    if (pane === 'left') {
      set({ paneLeft: sessionId });
    } else {
      set({ paneRight: sessionId });
    }
    get()._persistPanes();
  },

  _persistPanes: () => {
    const { paneLeft, paneRight, apps, _persistCallback } = get();
    if (!_persistCallback) return;
    const leftPkg = paneLeft ? apps.find((a) => a.sessionId === paneLeft)?.packageName ?? null : null;
    const rightPkg = paneRight ? apps.find((a) => a.sessionId === paneRight)?.packageName ?? null : null;
    _persistCallback(leftPkg, rightPkg);
  },

  _registerSession: (sessionId, session) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: { session, state: session.currentState },
      },
    }));
  },

  _unregisterSession: (sessionId) => {
    set((state) => {
      const newSessions = { ...state.sessions };
      delete newSessions[sessionId];
      const audioStatusBySession = { ...state.audioStatusBySession };
      delete audioStatusBySession[sessionId];
      return {
        sessions: newSessions,
        audioStatusBySession,
        audioStatus: aggregateAudioStatus(Object.values(audioStatusBySession)),
      };
    });
  },

  _setSessionAudio: (sessionId, audioState) => {
    set((state) => {
      const audioStatusBySession = { ...state.audioStatusBySession, [sessionId]: audioState };
      return {
        audioStatusBySession,
        audioStatus: aggregateAudioStatus(Object.values(audioStatusBySession)),
      };
    });
    // 新开始播放的 session 继承全局静音
    if (audioState.status === 'playing' && get().isMuted) {
      get()._getSession(sessionId)?.setMuted(true);
    }
  },

  _backgroundify: async (sessionId) => {
    const state = get();
    const app = state.apps.find((a) => a.sessionId === sessionId);
    const managed = state.sessions[sessionId];
    if (!app || !managed) return;

    const session = managed.session;
    // 断开 scrcpy（stop 会断开 client/controller，虚拟屏由 keepActive 保住）
    await session.stop();

    // 音频随 scrcpy 断开而停止，显式重置防止聚合状态残留导致静音按钮误显示
    get()._setSessionAudio(sessionId, { status: 'idle', route: 'browser', muted: false });

    get()._updateAppState(sessionId, {
      state: 'background',
      pane: undefined,
      sourcePane: undefined,
    });

    // 清理 pane/fullscreen 引用
    const current = get();
    if (current.paneLeft === sessionId) get()._setPane('left', null);
    if (current.paneRight === sessionId) get()._setPane('right', null);
    if (current.fullscreenSessionId === sessionId) {
      set({ fullscreenSessionId: null });
    }
  },

  _restartSession: async (sessionId, displayConfig) => {
    const state = get();
    const app = state.apps.find((a) => a.sessionId === sessionId);
    const managed = state.sessions[sessionId];
    if (!app || !managed) return;

    const session = managed.session;
    const adb = get().getLiveAdb();
    if (!adb) return;

    // start 会复用 session 的 canvas（如果存在）。
    // 2026-08-04（推翻 T5 的 attach 恢复，S2-P0-9 查证）：
    // - scrcpy 官方无 "client 断开后保留虚拟屏" 能力（无 keep-display 选项），
    //   keepActive 仅是防休眠（userActivity）且 v3 未序列化——backgroundify 后
    //   旧虚拟屏必被系统回收；
    // - 实测 attach 旧屏（app.displayId）存在两条失败路径：抛错（已降级 newDisplay）
    //   或 attach 成功但 server 数秒后退出（Socket closed 触控失效）——均不可靠；
    // - 因此 resume 一律 newDisplay 重建屏 + 重新启动 app（稳定可靠，app 重新加载）。
    // 注意：pane 恢复也必须是 audio:false（音频由专用采集连接统一承担，ADR-0015）。
    await session.start(adb, displayConfig, undefined, undefined, { audio: false });

    // 在新屏上启动 app，并回写新 displayId（旧 app.displayId 已随旧屏回收失效）
    await session.startAppOnDisplay(app.packageName);
    const newDisplayId = session.displayId;
    if (newDisplayId !== null) {
      get()._updateAppState(sessionId, { displayId: newDisplayId });
    }
  },

  // ===== 专用音频采集连接（ADR-0015）=====
  // 分屏桌面的每个 pane 都请求 audio:true 时，设备只会向其中一个连接授予音频
  // （scrcpy 音频捕获在设备级是单一的，REMOTE_SUBMIX）。因此改为：全设备仅由
  // 一条「专用音频采集连接」（video:false, control:false, audio:true）统一捕获
  // 整机声音，与任何 pane 的生命周期解耦——关 pane / 切焦点均不闪烁、不断音。

  _ensureAudioCapture: async (adb, codec: AudioCodecName = 'opus') => {
    const state = get();
    // 已存在且 codec 一致 → 无需动作
    if (state.audioCaptureSessionId && state.audioCaptureCodec === codec) return;
    // 已存在但 codec 不同（opus→aac 自愈切换中）→ 先停旧的再起新的
    if (state.audioCaptureSessionId && state.audioCaptureCodec !== codec) {
      const oldId = state.audioCaptureSessionId;
      const old = get()._getSession(oldId);
      set({ audioCaptureSessionId: null, audioCaptureCodec: null, audioCaptureRetried: false });
      if (old) {
        await old.stop();
        get()._unregisterSession(oldId);
      }
    }
    const sessionId = get()._generateSessionId();
    const session = get()._createSessionWithCallbacks(sessionId);
    get()._registerSession(sessionId, session);
    set({ audioCaptureSessionId: sessionId, audioCaptureCodec: codec, audioCaptureRetried: false });
    try {
      // 专用音频采集连接：video:false + audio:true + control:false。
      // sendDeviceMeta:false 防止设备名写入音频 socket 污染 codec 解析。
      // audioCodecOverride 指定本次请求的编码；opus 解码失败时上层 onAudioDecodeError 会用 'aac' 重试（ADR-0016 自愈）。
      await session.start(adb, undefined, undefined, undefined, { audioOnly: true, audioCodecOverride: codec });
    } catch (e) {
      console.error('[SessionManager] 专用音频采集连接启动失败:', e);
      get()._unregisterSession(sessionId);
      set({ audioCaptureSessionId: null, audioCaptureCodec: null, audioCaptureRetried: false });
    }
  },

  _stopAudioCapture: async () => {
    const { audioCaptureSessionId } = get();
    if (!audioCaptureSessionId) return;
    const session = get()._getSession(audioCaptureSessionId);
    set({ audioCaptureSessionId: null, audioCaptureCodec: null, audioCaptureRetried: false });
    if (session) {
      await session.stop();
      get()._unregisterSession(audioCaptureSessionId);
    }
  },

  // ===== actions =====

  setAdb: (adb) => {
    // 设备断开（adb 置空）时，各 session 缓存的 this.adb 已失效，
    // 置空避免后续 stop() 在已死的连接上执行 adb 命令 / kill server。
    if (!adb) {
      Object.values(get().sessions).forEach(({ session }) => session.invalidateAdb());
      // 设备断开：停止专用音频采集连接（其 adb 已失效，stop 仅做本地清理）
      void get()._stopAudioCapture();
    }
    set({ adb });
  },

  getLiveAdb: () => {
    const { adb } = get();
    if (!adb) return null;
    // 仅 connectionStatus === 'connected' 视为存活：拦截「store.adb 非空但底层
    // transport 已死」的竞态（断开处理先置 status 再置空 adb 的窗口、或残留引用），
    // 避免对死连接调用 session.start 导致 scrcpy server 立即退出
    // （AdbScrcpyExitedError: scrcpy server exited prematurely）。见 2026-07-09 诊断。
    if (useAdbStore.getState().connectionStatus !== 'connected') return null;
    return adb;
  },

  setPersistCallback: (cb) => set({ _persistCallback: cb }),

  setMuted: (muted) => {
    set({ isMuted: muted });
    Object.values(get().sessions).forEach(({ session }) => session.setMuted(muted));
  },

  getSession: (sessionId) => get()._getSession(sessionId),

  getApp: (sessionId) => get().apps.find((a) => a.sessionId === sessionId),

  getPaneApp: (pane) => {
    const { paneLeft, paneRight, apps } = get();
    const paneId = pane === 'left' ? paneLeft : paneRight;
    if (!paneId) return null;
    return apps.find((a) => a.sessionId === paneId) ?? null;
  },

  getFullscreenApp: () => {
    const { fullscreenSessionId, apps } = get();
    if (!fullscreenSessionId) return null;
    return apps.find((a) => a.sessionId === fullscreenSessionId) ?? null;
  },

  getStreamingCount: () => {
    return get().apps.filter(
      (a) => a.state === 'foreground-pane' || a.state === 'foreground-fullscreen'
    ).length;
  },

  // ===== launchOnPane（§5 启动入口）=====
  launchOnPane: async (packageName, pane, displayConfig, appLabel) => {
    const adb = get().getLiveAdb();
    if (!adb) {
      console.error('[SessionManager] launchOnPane 失败：adb 未连接');
      return null;
    }

    // D1 冷启动对账（仅浏览器侧 0 会话的冷启动窗口）：杀光设备端残留 scrcpy 进程，
    // 等待 keepActive 孤儿虚拟屏随 owner 死亡被回收，使首次 newDisplay 从干净状态开始。
    // 见 ADR-0014。非冷启动（已有运行/后台会话）跳过，避免误杀运行中会话。
    if (get().apps.length === 0) {
      await reconcileVirtualDisplaysOnColdStart(adb);
    }

    // T6：不再于每次启动前全局 pkill 设备端 scrcpy server。
    // 原因：T4 已为各会话分配独立 scid，分别走各自的 localabstract:scrcpy_<scid>
    // 隧道，旧会话的残留 server 不再占用同一 socket、不会阻塞新会话启动；
    // 而全局 pkill 会误杀同屏其它正在 streaming 的分屏/全屏（H3 黑屏停顿）。
    // 设备端孤儿 server（如浏览器崩溃导致 serverPid 丢失）的清理，
    // 已由 useUsbConnection 在 USB 连接引导时统一执行（killScrcpyServer 兜底）。

    // 若 pane 已占用，先关闭旧 app（closeApp 走 session.stop 的 PID 精确 kill，不误伤）
    const existingPaneId = pane === 'left' ? get().paneLeft : get().paneRight;
    if (existingPaneId) {
      await get().closeApp(existingPaneId);
    }

    const sessionId = get()._generateSessionId();
    const session = get()._createSessionWithCallbacks(sessionId);

    const app: AppInstance = {
      sessionId,
      packageName,
      state: 'foreground-pane',
      pane,
      displayId: null,
      appLabel,
    };

    get()._registerSession(sessionId, session);
    set((state) => ({ apps: [...state.apps, app] }));
    get()._setPane(pane, sessionId);

    try {
      // pane 启动必须是 audio:false（音频由专用采集连接统一承担，ADR-0015）
      await session.start(adb, displayConfig, undefined, undefined, { audio: false });
      const displayId = session.displayId;
      if (displayId !== null) {
        set((state) => ({ allocatedDisplayIds: new Set(state.allocatedDisplayIds).add(displayId) }));
        get()._updateAppState(sessionId, { displayId });
      }
      await session.startAppOnDisplay(packageName);
      // ADR-0015：确保专用音频采集连接运行（全设备唯一 audio:true），捕获整机声音
      await get()._ensureAudioCapture(adb);
      return sessionId;
    } catch (error) {
      console.error('[SessionManager] launchOnPane 启动失败:', error);
      await session.stop();
      get()._unregisterSession(sessionId);
      get()._removeApp(sessionId);
      get()._setPane(pane, null);
      return null;
    }
  },

  // ===== launchFullscreen（§5 启动入口）=====
  launchFullscreen: async (packageName, displayConfig, appLabel) => {
    const { fullscreenSessionId } = get();
    const adb = get().getLiveAdb();
    if (!adb) {
      console.error('[SessionManager] launchFullscreen 失败：adb 未连接');
      return null;
    }

    // D1 冷启动对账（仅浏览器侧 0 会话的冷启动窗口）：同 launchOnPane 说明。
    // 见 ADR-0014。非冷启动跳过，避免误杀运行中会话。
    if (get().apps.length === 0) {
      await reconcileVirtualDisplaysOnColdStart(adb);
    }

    // 同包名去重（修复「分屏运行中的 app 从侧边栏再全屏 → 双实例」bug）：
    // 若同一 packageName 已在某状态运行，走状态转换路径复用既有 session/屏/进程，
    // 而非新建第 2 个实例。优先级：foreground-pane > foreground-fullscreen > background。
    // background 分支依赖 T5 的 attach 模式（resumeBackground 复用原 displayId，不重建屏）。
    const samePkgApps = get().apps.filter((a) => a.packageName === packageName);
    const existingApp =
      samePkgApps.find((a) => a.state === 'foreground-pane') ??
      samePkgApps.find((a) => a.state === 'foreground-fullscreen') ??
      samePkgApps.find((a) => a.state === 'background');
    if (existingApp) {
      if (existingApp.state === 'foreground-pane' && existingApp.pane) {
        // 复用现有 pane session，直接 reparent 到全屏（零重建，画面连续）
        await get().paneToFullscreen(existingApp.pane);
        return existingApp.sessionId;
      }
      if (existingApp.state === 'foreground-fullscreen') {
        // 已在全屏，无需动作（替代旧「backgroundify 旧全屏再新建」）
        return existingApp.sessionId;
      }
      // background → resume 到全屏（T5 使其复用原 displayId，无重建跳转）
      await get().resumeBackground(existingApp.sessionId, displayConfig, 'fullscreen');
      return existingApp.sessionId;
    }

    // T4：全屏是第 3 路并发叠加层（设计 §2.3 并发上限 = 左 + 右 + 全屏），
    // 不再 pkill 设备端 scrcpy server，也不再 backgroundify 常驻分屏——
    // 否则常驻分屏会被静默杀死（路径3 缺陷，违反「全屏是第3个 streaming 叠加层」）。
    //
    // 并发上限（§2.3）由启动顺序隐式保证：先 backgroundify「上一个全屏」释放 1 个名额，
    // 再启动新全屏作为第 3 路叠加，因此总数恒 ≤ 3，左/右常驻分屏始终 streaming、互不影响。
    // （getStreamingCount 仅用于侧边栏显示/断言，不在此处做硬性上限拦截。）
    // 各会话已通过独立 scid 走各自的 localabstract:scrcpy_<scid> 隧道（scrcpy-session.ts），
    // 互不抢占，因此此处无需全局 pkill（其 PID 精确 kill 由 session.stop 负责）。
    if (fullscreenSessionId) {
      await get()._backgroundify(fullscreenSessionId);
    }

    const sessionId = get()._generateSessionId();
    const session = get()._createSessionWithCallbacks(sessionId);

    const app: AppInstance = {
      sessionId,
      packageName,
      state: 'foreground-fullscreen',
      displayId: null,
      appLabel,
    };

    get()._registerSession(sessionId, session);
    set((state) => ({
      apps: [...state.apps, app],
      fullscreenSessionId: sessionId,
    }));

    try {
      // pane 启动必须是 audio:false（音频由专用采集连接统一承担，ADR-0015）
      await session.start(adb, displayConfig, undefined, undefined, { audio: false });
      const displayId = session.displayId;
      if (displayId !== null) {
        set((state) => ({ allocatedDisplayIds: new Set(state.allocatedDisplayIds).add(displayId) }));
        get()._updateAppState(sessionId, { displayId });
      }
      await session.startAppOnDisplay(packageName);
      // ADR-0015：确保专用音频采集连接运行（全设备唯一 audio:true），捕获整机声音
      await get()._ensureAudioCapture(adb);
      return sessionId;
    } catch (error) {
      console.error('[SessionManager] launchFullscreen 启动失败:', error);
      await session.stop();
      get()._unregisterSession(sessionId);
      get()._removeApp(sessionId);
      set({ fullscreenSessionId: null });
      return null;
    }
  },

  // ===== paneToFullscreen（§3 状态转换）=====
  paneToFullscreen: async (pane) => {
    const { paneLeft, paneRight, fullscreenSessionId, sessions } = get();
    const paneId = pane === 'left' ? paneLeft : paneRight;
    if (!paneId) {
      console.warn('[SessionManager] paneToFullscreen: pane 为空');
      return;
    }

    // 防御性：若已有全屏 app，先 backgroundify
    if (fullscreenSessionId && fullscreenSessionId !== paneId) {
      await get()._backgroundify(fullscreenSessionId);
    }

    const session = sessions[paneId]?.session;
    if (!session) {
      console.warn('[SessionManager] paneToFullscreen: session 不存在');
      return;
    }

    // 关键：session 不重启，只换渲染目标（Canvas Reparenting）
    // UI 层通过 getSession(fullscreenSessionId).reparentCanvas(overlayContainer) 移动 canvas
    get()._updateAppState(paneId, {
      state: 'foreground-fullscreen',
      sourcePane: pane,
      pane: undefined,
    });

    // pane 显示占位（清空 pane 引用，但保留 app 在 apps 列表中）
    get()._setPane(pane, null);
    set({ fullscreenSessionId: paneId });
  },

  // ===== fullscreenToPane（§3 状态转换）=====
  fullscreenToPane: async (pane) => {
    const { fullscreenSessionId, sessions, paneLeft, paneRight } = get();
    if (!fullscreenSessionId) {
      console.warn('[SessionManager] fullscreenToPane: 无全屏 app');
      return;
    }

    const app = get().apps.find((a) => a.sessionId === fullscreenSessionId);
    if (!app) {
      console.warn('[SessionManager] fullscreenToPane: app 不存在');
      return;
    }

    const session = sessions[fullscreenSessionId]?.session;
    if (!session) return;

    // 若 pane == sourcePane → 直接恢复（§3.2 零成本）
    if (app.sourcePane === pane) {
      get()._updateAppState(fullscreenSessionId, {
        state: 'foreground-pane',
        pane,
        sourcePane: undefined,
      });
      get()._setPane(pane, fullscreenSessionId);
      set({ fullscreenSessionId: null });
      // UI 层 reparentCanvas 移回 pane 容器
      return;
    }

    // 否则 → 覆盖逻辑：关闭 pane 旧 app + 全屏 app 切到 pane
    // （覆盖确认由 UI 层 PaneSelector 处理，这里执行实际覆盖）
    const existingPaneId = pane === 'left' ? paneLeft : paneRight;
    if (existingPaneId) {
      await get().closeApp(existingPaneId);
    }

    get()._updateAppState(fullscreenSessionId, {
      state: 'foreground-pane',
      pane,
      sourcePane: undefined,
    });
    get()._setPane(pane, fullscreenSessionId);
    set({ fullscreenSessionId: null });
    // UI 层 reparentCanvas
  },

  // ===== fullscreenToDesktop（§6 规则）=====
  fullscreenToDesktop: async () => {
    const { fullscreenSessionId, paneLeft, paneRight } = get();
    if (!fullscreenSessionId) return;

    const app = get().apps.find((a) => a.sessionId === fullscreenSessionId);
    if (!app) return;

    // 情况 1：全屏 app 来自某 pane（sourcePane 存在）→ 回来源 pane
    if (app.sourcePane) {
      get()._updateAppState(fullscreenSessionId, {
        state: 'foreground-pane',
        pane: app.sourcePane,
        sourcePane: undefined,
      });
      get()._setPane(app.sourcePane, fullscreenSessionId);
      set({ fullscreenSessionId: null });
      return;
    }

    // 情况 2：来自侧边栏/全部应用 + 有空 pane → 放进空 pane
    const emptyPane: PaneSlot | null = !paneLeft ? 'left' : (!paneRight ? 'right' : null);
    if (emptyPane) {
      get()._updateAppState(fullscreenSessionId, {
        state: 'foreground-pane',
        pane: emptyPane,
        sourcePane: undefined,
      });
      get()._setPane(emptyPane, fullscreenSessionId);
      set({ fullscreenSessionId: null });
      return;
    }

    // 情况 3：两 pane 都占 → 全屏 app → background
    await get()._backgroundify(fullscreenSessionId);
  },

  // ===== closePane =====
  closePane: async (pane) => {
    const paneId = pane === 'left' ? get().paneLeft : get().paneRight;
    if (paneId) {
      await get().closeApp(paneId);
    }
  },

  // ===== closeFullscreen =====
  closeFullscreen: async () => {
    const { fullscreenSessionId } = get();
    if (fullscreenSessionId) {
      await get().closeApp(fullscreenSessionId);
    }
  },

  // ===== switchPaneApp（分屏下拉「切换」= 关闭旧 + 打开新）=====
  switchPaneApp: async (pane, packageName, displayConfig, appLabel) => {
    const paneId = pane === 'left' ? get().paneLeft : get().paneRight;
    if (paneId) {
      await get().closeApp(paneId);
    }
    await get().launchOnPane(packageName, pane, displayConfig, appLabel);
  },

  // ===== closeApp（force-stop + session.stop + 清理）=====
  closeApp: async (sessionId) => {
    const { adb } = get();
    const app = get().apps.find((a) => a.sessionId === sessionId);
    if (!app) return;

    const session = get()._getSession(sessionId);

    // force-stop app（§4.1 关闭 = force-stop + 销毁 session + 销毁虚拟屏）
    if (adb && app.packageName) {
      try {
        await forceStopPackage(adb, app.packageName);
      } catch (e) {
        console.warn('[SessionManager] forceStopPackage 失败:', e);
      }
    }

    // session.stop（会 kill scrcpy server，虚拟屏随之销毁）
    if (session) {
      await session.stop();
    }

    // 释放 displayId
    if (app.displayId !== null) {
      set((state) => {
        const newSet = new Set(state.allocatedDisplayIds);
        newSet.delete(app.displayId!);
        return { allocatedDisplayIds: newSet };
      });
    }

    // 清理 pane/fullscreen 引用
    const { paneLeft, paneRight, fullscreenSessionId } = get();
    if (paneLeft === sessionId) get()._setPane('left', null);
    if (paneRight === sessionId) get()._setPane('right', null);
    if (fullscreenSessionId === sessionId) set({ fullscreenSessionId: null });

    get()._removeApp(sessionId);
    get()._unregisterSession(sessionId);

    // ADR-0015：最后一个 app 关闭后，停止专用音频采集连接
    if (get().apps.length === 0) {
      await get()._stopAudioCapture();
    }
  },

  // ===== closeAll（遍历所有进程执行关闭）=====
  closeAll: async () => {
    const allApps = [...get().apps];
    for (const app of allApps) {
      await get().closeApp(app.sessionId);
    }
    // ADR-0015：停止专用音频采集连接（closeApp 在最后一个 app 时也会触发，此处兜底）
    await get()._stopAudioCapture();
    set({ paneLeft: null, paneRight: null, fullscreenSessionId: null });
  },

  // ===== resumeBackground（§7.4 落点规则）=====
  resumeBackground: async (sessionId, displayConfig, target = 'pane') => {
    const { fullscreenSessionId, paneLeft, paneRight } = get();
    const app = get().apps.find((a) => a.sessionId === sessionId);
    if (!app || app.state !== 'background') {
      console.warn('[SessionManager] resumeBackground: app 不是 background 状态');
      return;
    }

    // ADR-0015：恢复一个 app 即确保专用音频采集连接运行（全设备唯一 audio:true）
    const adb = get().getLiveAdb();
    if (adb) await get()._ensureAudioCapture(adb);

    // target === 'fullscreen'（来自 launchFullscreen 同包名去重）：强制落全屏覆盖层，
    // 复用原 displayId（T5 attach 模式，不重建屏），不抢占 pane。
    if (target === 'fullscreen') {
      if (fullscreenSessionId && fullscreenSessionId !== sessionId) {
        await get()._backgroundify(fullscreenSessionId);
      }
      await get()._restartSession(sessionId, displayConfig);
      get()._updateAppState(sessionId, {
        state: 'foreground-fullscreen',
        sourcePane: undefined,
        pane: undefined,
      });
      set({ fullscreenSessionId: sessionId });
      return;
    }

    // 规则 1：当前有全屏覆盖层 → 该全屏 app 进 background，覆盖层承接新 app
    if (fullscreenSessionId) {
      await get()._backgroundify(fullscreenSessionId);
      await get()._restartSession(sessionId, displayConfig);
      get()._updateAppState(sessionId, {
        state: 'foreground-fullscreen',
        sourcePane: undefined,
        pane: undefined,
      });
      set({ fullscreenSessionId: sessionId });
      return;
    }

    // 规则 2：有空 pane → 放进空 pane
    const emptyPane: PaneSlot | null = !paneLeft ? 'left' : (!paneRight ? 'right' : null);
    if (emptyPane) {
      await get()._restartSession(sessionId, displayConfig);
      get()._updateAppState(sessionId, {
        state: 'foreground-pane',
        pane: emptyPane,
        sourcePane: undefined,
      });
      get()._setPane(emptyPane, sessionId);
      return;
    }

    // 规则 3：两 pane 都占 → 覆盖左 pane（§7.4 默认覆盖左 pane，不弹选择）
    if (paneLeft) {
      await get().closeApp(paneLeft);
    }
    await get()._restartSession(sessionId, displayConfig);
    get()._updateAppState(sessionId, {
      state: 'foreground-pane',
      pane: 'left',
      sourcePane: undefined,
    });
    get()._setPane('left', sessionId);
  },
}));
