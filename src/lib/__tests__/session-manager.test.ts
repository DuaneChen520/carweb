import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSessionManager, type AppInstance } from '@/lib/session-manager';
import type { ScrcpySession, SessionState } from '@/lib/scrcpy-session';

/**
 * SessionManager 状态机测试。
 *
 * 测试策略：mock ScrcpySession 的 start/stop/reparentCanvas 等方法，
 * 验证状态转换矩阵的正确性，不依赖真实 ADB 连接。
 */

// mock ScrcpySession 构造函数
function createMockSession(id: string): ScrcpySession {
  const state: SessionState = {
    isStarting: false,
    isRunning: false,
    error: null,
    videoWidth: 0,
    videoHeight: 0,
    isVirtualDisplay: false,
  };
  return {
    id,
    displayId: 100,
    isRunning: false,
    isStarting: false,
    currentState: { ...state },
    canvas: null,
    flexClientInstance: null,
    start: vi.fn(async () => {
      state.isRunning = true;
      state.isVirtualDisplay = true;
    }),
    stop: vi.fn(async () => {
      state.isRunning = false;
    }),
    reparentCanvas: vi.fn(),
    dispose: vi.fn(async () => {}),
    ensureDisplayId: vi.fn(async () => 100),
    startAppOnDisplay: vi.fn(async () => {}),
    injectTouch: vi.fn(async () => {}),
    injectText: vi.fn(async () => {}),
    goBack: vi.fn(async () => {}),
    goHome: vi.fn(async () => {}),
    setAudioRoute: vi.fn(),
    setMuted: vi.fn(),
    resumeAudio: vi.fn(),
  } as unknown as ScrcpySession;
}

// 通过反射替换 _createSessionWithCallbacks
function installMockSessionFactory() {
  const store = useSessionManager.getState();
  store._createSessionWithCallbacks = (sessionId: string) => createMockSession(sessionId);
}

function resetStore() {
  useSessionManager.setState({
    sessions: {},
    apps: [],
    paneLeft: null,
    paneRight: null,
    fullscreenSessionId: null,
    adb: {} as never, // 非 null 即可，实际 mock 不使用
    allocatedDisplayIds: new Set(),
    _persistCallback: null,
  });
  installMockSessionFactory();
}

describe('SessionManager 状态机', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('launchOnPane', () => {
    it('在空 pane 启动 app，设置 paneLeft 并创建 app 实例', async () => {
      const id = await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      expect(id).not.toBeNull();
      const state = useSessionManager.getState();
      expect(state.paneLeft).toBe(id);
      expect(state.paneRight).toBeNull();
      expect(state.apps).toHaveLength(1);
      expect(state.apps[0]!.packageName).toBe('com.test.a');
      expect(state.apps[0]!.state).toBe('foreground-pane');
      expect(state.apps[0]!.pane).toBe('left');
    });

    it('右 pane 启动 app，设置 paneRight', async () => {
      const id = await useSessionManager.getState().launchOnPane('com.test.b', 'right', { width: 800, height: 600 });
      expect(useSessionManager.getState().paneRight).toBe(id);
    });

    it('pane 已占用时先关闭旧 app', async () => {
      const id1 = await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      expect(useSessionManager.getState().apps).toHaveLength(1);

      const id2 = await useSessionManager.getState().launchOnPane('com.test.b', 'left', { width: 800, height: 600 });
      expect(useSessionManager.getState().apps).toHaveLength(1);
      expect(useSessionManager.getState().apps[0]!.sessionId).toBe(id2);
      expect(useSessionManager.getState().paneLeft).toBe(id2);
      expect(id1).not.toBe(id2);
    });

    it('启动后记录 displayId 到 allocatedDisplayIds', async () => {
      await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      expect(useSessionManager.getState().allocatedDisplayIds.has(100)).toBe(true);
    });

    it('启动后 app 的 displayId 字段被填充', async () => {
      const id = await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      const app = useSessionManager.getState().getApp(id!);
      expect(app?.displayId).toBe(100);
    });
  });

  describe('launchFullscreen', () => {
    it('启动全屏 app，设置 fullscreenSessionId', async () => {
      const id = await useSessionManager.getState().launchFullscreen('com.test.c', { width: 1920, height: 1080 });
      expect(id).not.toBeNull();
      const state = useSessionManager.getState();
      expect(state.fullscreenSessionId).toBe(id);
      expect(state.apps[0]!.state).toBe('foreground-fullscreen');
    });

    it('当前全屏 app 进入 background', async () => {
      const id1 = await useSessionManager.getState().launchFullscreen('com.test.a', { width: 1920, height: 1080 });
      const id2 = await useSessionManager.getState().launchFullscreen('com.test.b', { width: 1920, height: 1080 });

      const state = useSessionManager.getState();
      expect(state.fullscreenSessionId).toBe(id2);
      const oldApp = state.apps.find((a) => a.sessionId === id1);
      expect(oldApp?.state).toBe('background');
    });

    it('两 pane 的 app 进入 background', async () => {
      const paneId = await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      await useSessionManager.getState().launchOnPane('com.test.b', 'right', { width: 800, height: 600 });

      await useSessionManager.getState().launchFullscreen('com.test.c', { width: 1920, height: 1080 });

      const state = useSessionManager.getState();
      const paneApp = state.apps.find((a) => a.sessionId === paneId);
      expect(paneApp?.state).toBe('background');
    });
  });

  describe('paneToFullscreen', () => {
    it('pane app 转全屏，记录 sourcePane，清空 pane 引用', async () => {
      const paneId = await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });

      await useSessionManager.getState().paneToFullscreen('left');

      const state = useSessionManager.getState();
      expect(state.fullscreenSessionId).toBe(paneId);
      expect(state.paneLeft).toBeNull();
      const app = state.apps.find((a) => a.sessionId === paneId);
      expect(app?.state).toBe('foreground-fullscreen');
      expect(app?.sourcePane).toBe('left');
      expect(app?.pane).toBeUndefined();
    });
  });

  describe('fullscreenToPane', () => {
    it('回来源 pane，零成本恢复', async () => {
      const paneId = await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      await useSessionManager.getState().paneToFullscreen('left');

      await useSessionManager.getState().fullscreenToPane('left');

      const state = useSessionManager.getState();
      expect(state.fullscreenSessionId).toBeNull();
      expect(state.paneLeft).toBe(paneId);
      const app = state.apps.find((a) => a.sessionId === paneId);
      expect(app?.state).toBe('foreground-pane');
      expect(app?.pane).toBe('left');
      expect(app?.sourcePane).toBeUndefined();
    });

    it('覆盖另一 pane 时关闭旧 app', async () => {
      const leftId = await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      const rightId = await useSessionManager.getState().launchOnPane('com.test.b', 'right', { width: 800, height: 600 });

      // 左 pane 全屏
      await useSessionManager.getState().paneToFullscreen('left');
      // 全屏切到右 pane（覆盖右 pane 的 app）
      await useSessionManager.getState().fullscreenToPane('right');

      const state = useSessionManager.getState();
      expect(state.fullscreenSessionId).toBeNull();
      expect(state.paneRight).toBe(leftId);
      // 右 pane 的旧 app 应被关闭（从 apps 列表移除）
      const rightAppExists = state.apps.some((a) => a.sessionId === rightId);
      expect(rightAppExists).toBe(false);
    });
  });

  describe('fullscreenToDesktop（§6 规则）', () => {
    it('情况 1：来自 pane 的全屏 app 回来源 pane', async () => {
      const paneId = await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      await useSessionManager.getState().paneToFullscreen('left');

      await useSessionManager.getState().fullscreenToDesktop();

      const state = useSessionManager.getState();
      expect(state.fullscreenSessionId).toBeNull();
      expect(state.paneLeft).toBe(paneId);
    });

    it('情况 2：来自侧边栏 + 有空 pane，放进空 pane', async () => {
      // launchFullscreen 会 backgroundify 两 pane（§5.1），所以全屏后两 pane 都空
      // 左 pane 先有 app
      await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      const fullId = await useSessionManager.getState().launchFullscreen('com.test.b', { width: 1920, height: 1080 });
      // 此时两 pane 都空（被 backgroundify），全屏 app 无 sourcePane

      await useSessionManager.getState().fullscreenToDesktop();

      const state = useSessionManager.getState();
      expect(state.fullscreenSessionId).toBeNull();
      // 两 pane 都空，emptyPane = 'left'（优先左），全屏 app 进左 pane
      expect(state.paneLeft).toBe(fullId);
    });

    it('情况 3：两 pane 都占 + 全屏 app 无 sourcePane，全屏 app 进 background', async () => {
      // 构造场景：两 pane 有 app + 全屏 app 无 sourcePane
      // 通过 launchFullscreen（清空两 pane）后，用 resumeBackground 填充两 pane
      await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      await useSessionManager.getState().launchOnPane('com.test.b', 'right', { width: 800, height: 600 });
      const fullId = await useSessionManager.getState().launchFullscreen('com.test.c', { width: 1920, height: 1080 });
      // 此时两 pane 空，com.test.a 和 com.test.b 是 background

      // 恢复两个 background app 到 pane（§7.4 规则 2 填空 pane）
      const bgApps = useSessionManager.getState().apps.filter((a) => a.state === 'background');
      await useSessionManager.getState().resumeBackground(bgApps[0]!.sessionId, { width: 800, height: 600 });
      await useSessionManager.getState().resumeBackground(bgApps[1]!.sessionId, { width: 800, height: 600 });
      // 此时两 pane 都占，全屏 app 仍是 foreground-fullscreen

      await useSessionManager.getState().fullscreenToDesktop();

      const state = useSessionManager.getState();
      expect(state.fullscreenSessionId).toBeNull();
      const fullApp = state.apps.find((a) => a.sessionId === fullId);
      expect(fullApp?.state).toBe('background');
    });
  });

  describe('closeApp', () => {
    it('从列表移除并清理 pane 引用', async () => {
      const id = await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });

      await useSessionManager.getState().closeApp(id!);

      const state = useSessionManager.getState();
      expect(state.apps).toHaveLength(0);
      expect(state.paneLeft).toBeNull();
      expect(state.sessions[id!]).toBeUndefined();
    });

    it('清理 fullscreen 引用', async () => {
      const id = await useSessionManager.getState().launchFullscreen('com.test.a', { width: 1920, height: 1080 });

      await useSessionManager.getState().closeApp(id!);

      expect(useSessionManager.getState().fullscreenSessionId).toBeNull();
    });

    it('释放 displayId', async () => {
      const id = await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      expect(useSessionManager.getState().allocatedDisplayIds.has(100)).toBe(true);

      await useSessionManager.getState().closeApp(id!);
      expect(useSessionManager.getState().allocatedDisplayIds.has(100)).toBe(false);
    });
  });

  describe('closeAll', () => {
    it('遍历所有进程执行关闭', async () => {
      await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      await useSessionManager.getState().launchOnPane('com.test.b', 'right', { width: 800, height: 600 });
      await useSessionManager.getState().launchFullscreen('com.test.c', { width: 1920, height: 1080 });

      await useSessionManager.getState().closeAll();

      const state = useSessionManager.getState();
      expect(state.apps).toHaveLength(0);
      expect(state.paneLeft).toBeNull();
      expect(state.paneRight).toBeNull();
      expect(state.fullscreenSessionId).toBeNull();
    });
  });

  describe('switchPaneApp', () => {
    it('关闭旧 app 并启动新 app', async () => {
      const id1 = await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });

      await useSessionManager.getState().switchPaneApp('left', 'com.test.b', { width: 800, height: 600 });

      const state = useSessionManager.getState();
      expect(state.apps).toHaveLength(1);
      expect(state.apps[0]!.packageName).toBe('com.test.b');
      expect(state.apps[0]!.sessionId).not.toBe(id1);
    });
  });

  describe('resumeBackground（§7.4 落点规则）', () => {
    it('规则 2：有空 pane，放进空 pane', async () => {
      // 先创建一个 background app（通过 launchFullscreen + fullscreenToDesktop 情况 3）
      await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      await useSessionManager.getState().launchOnPane('com.test.b', 'right', { width: 800, height: 600 });
      const bgId = await useSessionManager.getState().launchFullscreen('com.test.c', { width: 1920, height: 1080 });
      await useSessionManager.getState().fullscreenToDesktop();
      // 现在 com.test.c 是 background

      await useSessionManager.getState().resumeBackground(bgId!, { width: 800, height: 600 });

      const state = useSessionManager.getState();
      const app = state.apps.find((a) => a.sessionId === bgId);
      expect(app?.state).toBe('foreground-pane');
    });

    it('非 background 状态的 app 调用 resumeBackground 安全返回', async () => {
      const id = await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      await useSessionManager.getState().resumeBackground(id!, { width: 800, height: 600 });
      // app 仍是 foreground-pane
      const app = useSessionManager.getState().getApp(id!);
      expect(app?.state).toBe('foreground-pane');
    });
  });

  describe('持久化回调', () => {
    it('pane 变化时触发持久化回调', async () => {
      const persistCb = vi.fn();
      useSessionManager.getState().setPersistCallback(persistCb);

      await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });

      expect(persistCb).toHaveBeenCalledWith('com.test.a', null);
    });

    it('关闭 pane 时持久化为 null', async () => {
      const persistCb = vi.fn();
      const id = await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });

      useSessionManager.getState().setPersistCallback(persistCb);
      await useSessionManager.getState().closeApp(id!);

      expect(persistCb).toHaveBeenCalledWith(null, null);
    });
  });

  describe('只读访问器', () => {
    it('getPaneApp 返回 pane 的 app', async () => {
      const id = await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      const app = useSessionManager.getState().getPaneApp('left');
      expect(app?.sessionId).toBe(id);
      expect(useSessionManager.getState().getPaneApp('right')).toBeNull();
    });

    it('getFullscreenApp 返回全屏 app', async () => {
      const id = await useSessionManager.getState().launchFullscreen('com.test.a', { width: 1920, height: 1080 });
      const app = useSessionManager.getState().getFullscreenApp();
      expect(app?.sessionId).toBe(id);
    });

    it('getStreamingCount 返回 streaming session 数', async () => {
      await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      await useSessionManager.getState().launchOnPane('com.test.b', 'right', { width: 800, height: 600 });
      expect(useSessionManager.getState().getStreamingCount()).toBe(2);

      await useSessionManager.getState().launchFullscreen('com.test.c', { width: 1920, height: 1080 });
      // 两 pane 进 background，全屏 1 个 streaming
      expect(useSessionManager.getState().getStreamingCount()).toBe(1);
    });
  });
});
