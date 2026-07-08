import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSessionManager, type AppInstance } from '@/lib/session-manager';
import type { ScrcpySession, SessionState } from '@/lib/scrcpy-session';
import { killScrcpyServer } from '@/lib/adb-commands';

// mock adb-commands 中的副作用命令，便于断言 launchFullscreen 不再调用全局 killScrcpyServer。
vi.mock('@/lib/adb-commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/adb-commands')>();
  return {
    ...actual,
    killScrcpyServer: vi.fn(async () => {}),
    forceStopPackage: vi.fn(async () => {}),
  };
});

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

    it('常驻分屏不被 backgroundify（T4：全屏是第 3 路并发）', async () => {
      const paneIdL = await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      const paneIdR = await useSessionManager.getState().launchOnPane('com.test.b', 'right', { width: 800, height: 600 });

      await useSessionManager.getState().launchFullscreen('com.test.c', { width: 1920, height: 1080 });

      const state = useSessionManager.getState();
      const leftApp = state.apps.find((a) => a.sessionId === paneIdL);
      const rightApp = state.apps.find((a) => a.sessionId === paneIdR);
      // 左/右常驻分屏保持 streaming，不被静默杀死
      expect(leftApp?.state).toBe('foreground-pane');
      expect(rightApp?.state).toBe('foreground-pane');
      expect(state.paneLeft).toBe(paneIdL);
      expect(state.paneRight).toBe(paneIdR);
    });

    it('launchFullscreen 不调用全局 killScrcpyServer（T4）', async () => {
      await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      await useSessionManager.getState().launchOnPane('com.test.b', 'right', { width: 800, height: 600 });
      (killScrcpyServer as ReturnType<typeof vi.fn>).mockClear();

      await useSessionManager.getState().launchFullscreen('com.test.c', { width: 1920, height: 1080 });

      expect(killScrcpyServer).not.toHaveBeenCalled();
    });

    it('同包名 app 已在分屏运行时，全屏启动复用而非双开（去重）', async () => {
      const paneId = await useSessionManager.getState().launchOnPane('com.test.dup', 'left', { width: 800, height: 600 });

      const fullId = await useSessionManager.getState().launchFullscreen('com.test.dup', { width: 1920, height: 1080 });

      const state = useSessionManager.getState();
      // 关键：同一包名仅 1 个 app 实例（无第 2 个进程 / 虚拟屏）
      const dupApps = state.apps.filter((a) => a.packageName === 'com.test.dup');
      expect(dupApps).toHaveLength(1);
      // 复用 pane session，被提升为全屏（未新建 session）
      expect(fullId).toBe(paneId);
      expect(state.fullscreenSessionId).toBe(paneId);
      expect(state.apps.find((a) => a.sessionId === paneId)?.state).toBe('foreground-fullscreen');
      // 原左 pane 引用已释放（app 已转全屏）
      expect(state.paneLeft).toBeNull();
    });

    it('同包名 app 在 background 时，全屏启动走 resume 复用原 displayId（T5 协同）', async () => {
      // 构造 background 场景：两 pane 占满 + 全屏 app 退回 background
      await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      await useSessionManager.getState().launchOnPane('com.test.b', 'right', { width: 800, height: 600 });
      const bgId = await useSessionManager.getState().launchFullscreen('com.test.dup', { width: 1920, height: 1080 });
      await useSessionManager.getState().fullscreenToDesktop();
      const bgBefore = useSessionManager.getState().getApp(bgId!);
      expect(bgBefore?.state).toBe('background');
      const displayIdBefore = bgBefore?.displayId ?? 100;

      const fullId = await useSessionManager.getState().launchFullscreen('com.test.dup', { width: 1920, height: 1080 });

      const state = useSessionManager.getState();
      // 仍仅 1 个实例（复用 background session，未新建）
      const dupApps = state.apps.filter((a) => a.packageName === 'com.test.dup');
      expect(dupApps).toHaveLength(1);
      expect(fullId).toBe(bgId);
      expect(state.fullscreenSessionId).toBe(bgId);
      expect(state.apps.find((a) => a.sessionId === bgId)?.state).toBe('foreground-fullscreen');

      // T5：resume 到全屏时，start() 以 attach 模式传入原 displayId（不 newDisplay、不重建屏）
      const bgSession = state.sessions[bgId!]!.session as unknown as { start: ReturnType<typeof vi.fn> };
      expect(bgSession.start).toHaveBeenCalledWith(expect.anything(), expect.anything(), displayIdBefore);
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
      // T4：launchFullscreen 不再 backgroundify 分屏，故全屏后左 pane 仍被 com.test.a 占，
      // 右 pane 为空，全屏 app 无 sourcePane。
      await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      const fullId = await useSessionManager.getState().launchFullscreen('com.test.b', { width: 1920, height: 1080 });
      // 此时左 pane 占（com.test.a foreground-pane），右 pane 空，全屏 app 无 sourcePane

      await useSessionManager.getState().fullscreenToDesktop();

      const state = useSessionManager.getState();
      expect(state.fullscreenSessionId).toBeNull();
      // 左 pane 已占，emptyPane 优先右 → 全屏 app 进右 pane
      expect(state.paneRight).toBe(fullId);
    });

    it('情况 3：两 pane 都占 + 全屏 app 无 sourcePane，全屏 app 进 background', async () => {
      // 构造场景：两 pane 有 app（常驻）+ 全屏 app 无 sourcePane（直接来自应用抽屉）。
      // T4 下 launchFullscreen 保留两 pane，故这是「两 pane 都占 + 全屏无 sourcePane」的真实可达场景。
      await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
      await useSessionManager.getState().launchOnPane('com.test.b', 'right', { width: 800, height: 600 });
      const fullId = await useSessionManager.getState().launchFullscreen('com.test.c', { width: 1920, height: 1080 });
      // 此时两 pane 都占（foreground-pane），全屏 app 无 sourcePane

      await useSessionManager.getState().fullscreenToDesktop();

      const state = useSessionManager.getState();
      expect(state.fullscreenSessionId).toBeNull();
      // 两 pane 都满、全屏 app 无 sourcePane → 回到 background（保留虚拟屏，供后续 resume）
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

      // T5：resume 时 start() 以 attach 模式传入原 displayId（复用原虚拟屏，不 newDisplay）
      const bgSession = state.sessions[bgId!]!.session as unknown as { start: ReturnType<typeof vi.fn> };
      expect(bgSession.start).toHaveBeenCalledWith(expect.anything(), expect.anything(), app?.displayId ?? 100);
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
      // T4：左 + 右常驻分屏保持 streaming，全屏为第 3 路，共 3 个 streaming
      expect(useSessionManager.getState().getStreamingCount()).toBe(3);
    });
  });
});
