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
import type { Adb } from '@yume-chan/adb';
import { forceStopPackage } from './adb-commands';

export type PaneSlot = 'left' | 'right';
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
  /** ADB 连接（由 setAdb 设置） */
  adb: Adb | null;
  /** displayId 池：已分配的 displayId 集合，用于避免冲突 */
  allocatedDisplayIds: Set<number>;

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
  /** 让一个 app 进入 background 状态（断开 scrcpy，保留虚拟屏） */
  _backgroundify: (sessionId: string) => Promise<void>;
  /** 重启 background app 的 scrcpy session（恢复 streaming，复用原 displayId） */
  _restartSession: (sessionId: string, displayConfig: DisplayConfig) => Promise<void>;

  // ===== actions =====
  setAdb: (adb: Adb | null) => void;
  setPersistCallback: (cb: ((left: string | null, right: string | null) => void) | null) => void;
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
  resumeBackground: (sessionId: string, displayConfig: DisplayConfig) => Promise<void>;

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
  adb: null,
  allocatedDisplayIds: new Set(),
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
      onAudioStateChange: () => {},
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
      return { sessions: newSessions };
    });
  },

  _backgroundify: async (sessionId) => {
    const state = get();
    const app = state.apps.find((a) => a.sessionId === sessionId);
    const managed = state.sessions[sessionId];
    if (!app || !managed) return;

    const session = managed.session;
    // 断开 scrcpy（stop 会断开 client/controller，虚拟屏由 keepActive 保住）
    await session.stop();

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
    const adb = state.adb;
    if (!adb) return;

    // start 会复用 session 的 canvas（如果存在）
    await session.start(adb, displayConfig);

    // 重新在 displayId 上启动 app
    if (app.displayId !== null) {
      await session.startAppOnDisplay(app.packageName);
    }
  },

  // ===== actions =====

  setAdb: (adb) => set({ adb }),

  setPersistCallback: (cb) => set({ _persistCallback: cb }),

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
    const { adb } = get();
    if (!adb) {
      console.error('[SessionManager] launchOnPane 失败：adb 未连接');
      return null;
    }

    // 若 pane 已占用，先关闭旧 app
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
      await session.start(adb, displayConfig);
      const displayId = session.displayId;
      if (displayId !== null) {
        set((state) => ({ allocatedDisplayIds: new Set(state.allocatedDisplayIds).add(displayId) }));
        get()._updateAppState(sessionId, { displayId });
      }
      await session.startAppOnDisplay(packageName);
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
    const { adb, fullscreenSessionId, paneLeft, paneRight } = get();
    if (!adb) {
      console.error('[SessionManager] launchFullscreen 失败：adb 未连接');
      return null;
    }

    // 当前全屏 app（如有）→ background（§5.1）
    if (fullscreenSessionId) {
      await get()._backgroundify(fullscreenSessionId);
    }

    // 两 pane 的 app → background（§5.1）
    for (const paneId of [paneLeft, paneRight]) {
      if (paneId) {
        await get()._backgroundify(paneId);
      }
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
      await session.start(adb, displayConfig);
      const displayId = session.displayId;
      if (displayId !== null) {
        set((state) => ({ allocatedDisplayIds: new Set(state.allocatedDisplayIds).add(displayId) }));
        get()._updateAppState(sessionId, { displayId });
      }
      await session.startAppOnDisplay(packageName);
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
  },

  // ===== closeAll（遍历所有进程执行关闭）=====
  closeAll: async () => {
    const allApps = [...get().apps];
    for (const app of allApps) {
      await get().closeApp(app.sessionId);
    }
    set({ paneLeft: null, paneRight: null, fullscreenSessionId: null });
  },

  // ===== resumeBackground（§7.4 落点规则）=====
  resumeBackground: async (sessionId, displayConfig) => {
    const { fullscreenSessionId, paneLeft, paneRight } = get();
    const app = get().apps.find((a) => a.sessionId === sessionId);
    if (!app || app.state !== 'background') {
      console.warn('[SessionManager] resumeBackground: app 不是 background 状态');
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
