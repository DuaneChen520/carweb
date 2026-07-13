// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Adb } from '@yume-chan/adb';

// ── 受控 spy（hoisted 以便在 vi.mock 工厂与断言间共享）──
const mocks = vi.hoisted(() => ({
  setAdb: vi.fn(),
  syncAndParseIfNeeded: vi.fn().mockResolvedValue({ toParse: [] }),
  scrcpyStart: vi.fn().mockResolvedValue(undefined),
  scrcpyStop: vi.fn().mockResolvedValue(undefined),
  supervisorReset: vi.fn(),
  supervisorDispose: vi.fn(),
  supervisorOnLinkStateChange: vi.fn(() => () => {}),
  supervisorAttachAdbSignal: vi.fn(() => () => {}),
  publishLinkState: vi.fn(),
  controllerHealthReset: vi.fn(),
}));

// appManager：只把要断言的两个方法固定为 spy，其余访问返回 no-op fn（Proxy 兜底）。
vi.mock('./useAppManager', () => {
  const appManager = new Proxy(
    { setAdb: mocks.setAdb, syncAndParseIfNeeded: mocks.syncAndParseIfNeeded },
    {
      get(target, prop) {
        if (prop in target) return (target as Record<string, unknown>)[prop as string];
        return vi.fn();
      },
    }
  );
  return { useAppManager: () => appManager };
});

vi.mock('@/lib/scrcpy-session', () => ({
  ScrcpySession: class {
    start = mocks.scrcpyStart;
    stop = mocks.scrcpyStop;
    goHome = vi.fn();
    injectTouch = vi.fn();
    injectText = vi.fn();
    startApp = vi.fn();
    goBack = vi.fn();
    showRecentApps = vi.fn();
    resumeAudio = vi.fn();
    setAudioRoute = vi.fn();
    setMuted = vi.fn();
  },
}));

vi.mock('@/lib/link-supervisor', () => ({
  LinkSupervisor: class {
    reset = mocks.supervisorReset;
    dispose = mocks.supervisorDispose;
    onLinkStateChange = mocks.supervisorOnLinkStateChange;
    attachAdbSignal = mocks.supervisorAttachAdbSignal;
  },
}));

vi.mock('@/lib/link-state-bus', () => ({
  publishLinkState: mocks.publishLinkState,
}));

vi.mock('@/lib/scrcpy4', () => ({
  ControllerHealth: class {
    reset = mocks.controllerHealthReset;
  },
  FlexDisplayClient: class {},
}));

// ScrcpySession 类化后的真实实现在此模块；其余导入（adb-commands 等）为真实函数，
// 仅在用户回调中被调用，本测试不触发，无需 mock。
import { useScrcpySession } from './useScrcpySession';

describe('useScrcpySession — 连接级同步调用点（删除防护）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.syncAndParseIfNeeded.mockResolvedValue({ toParse: [] });
  });

  it('startScrcpy 必须触发 appManager.syncAndParseIfNeeded（该调用被删除时此测试将变红）', async () => {
    const { result } = renderHook(() => useScrcpySession());

    const fakeAdb = { subprocess: {} } as unknown as Adb;
    const canvas = document.createElement('canvas');

    await act(async () => {
      await result.current.startScrcpy(fakeAdb, canvas);
    });

    // 先 setAdb 注入 live adb 句柄
    expect(mocks.setAdb).toHaveBeenCalledWith(fakeAdb);
    // 紧接其后的连接级自动同步调用点
    expect(mocks.syncAndParseIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('重连（LinkSupervisor.reconnect 重入 startScrcpy）同样触发同步', async () => {
    const { result } = renderHook(() => useScrcpySession());

    const fakeAdb = { subprocess: {} } as unknown as Adb;
    const canvas = document.createElement('canvas');

    // 首次连接
    await act(async () => {
      await result.current.startScrcpy(fakeAdb, canvas);
    });
    // 模拟重连重入
    await act(async () => {
      await result.current.startScrcpy(fakeAdb, canvas);
    });

    expect(mocks.syncAndParseIfNeeded).toHaveBeenCalledTimes(2);
  });
});
