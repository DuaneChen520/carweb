import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSessionManager } from '@/lib/session-manager';
import { useAdbStore } from '@/hooks/useAdbStore';
import type { ScrcpySession, SessionState } from '@/lib/scrcpy-session';

// mock adb-commands 副作用，避免触碰真实 ADB。
vi.mock('@/lib/adb-commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/adb-commands')>();
  return {
    ...actual,
    killScrcpyServer: vi.fn(async () => {}),
    forceStopPackage: vi.fn(async () => {}),
  };
});

// 共享的 start spy：用于断言「是否在死连接上调用了 session.start」。
const startSpy = vi.fn(async () => {});

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
    displayId: null,
    isRunning: false,
    isStarting: false,
    currentState: { ...state },
    canvas: null,
    flexClientInstance: null,
    start: startSpy,
    stop: vi.fn(async () => {}),
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

beforeEach(() => {
  useSessionManager.setState({
    sessions: {},
    apps: [],
    paneLeft: null,
    paneRight: null,
    fullscreenSessionId: null,
    adb: {} as never, // 非空（模拟「adb 引用非空但连接已死」的竞态现场）
    allocatedDisplayIds: new Set(),
    _persistCallback: null,
  });
  useSessionManager.getState()._createSessionWithCallbacks = (sid: string) => createMockSession(sid);
  // 默认还原真实 bug 现场：adb 非空，但连接已断开。
  useAdbStore.setState({ connectionStatus: 'disconnected', adb: {} as never });
  startSpy.mockClear();
});

describe('SessionManager 启动门禁（2026-07-09 诊断）', () => {
  it('connectionStatus=disconnected 且 adb 非空时，launchOnPane 不调用 session.start（拦截死连接）', async () => {
    const id = await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
    expect(id).toBeNull();
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('connectionStatus=disconnected 时，launchFullscreen 同样不调用 session.start', async () => {
    const id = await useSessionManager.getState().launchFullscreen('com.test.c', { width: 1920, height: 1080 });
    expect(id).toBeNull();
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('connectionStatus=idle（刚加载未连接）时，launchOnPane 不调用 session.start', async () => {
    useAdbStore.setState({ connectionStatus: 'idle' });
    const id = await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
    expect(id).toBeNull();
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('connectionStatus=connected 时，launchOnPane 正常调用 session.start', async () => {
    useAdbStore.setState({ connectionStatus: 'connected' });
    const id = await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
    expect(id).not.toBeNull();
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('connectionStatus=connected 时，resumeBackground(_restartSession) 也正常调用 session.start', async () => {
    useAdbStore.setState({ connectionStatus: 'connected' });
    // 先正常启动一个 app 进入 background
    const id = await useSessionManager.getState().launchOnPane('com.test.a', 'left', { width: 800, height: 600 });
    expect(id).not.toBeNull();
    await useSessionManager.getState()._backgroundify(id!);
    startSpy.mockClear();
    // 断开后尝试 resume（模拟用户点击后台 app）
    useAdbStore.setState({ connectionStatus: 'disconnected' });
    await useSessionManager.getState().resumeBackground(id!, { width: 800, height: 600 }, 'pane');
    expect(startSpy).not.toHaveBeenCalled();
  });
});
