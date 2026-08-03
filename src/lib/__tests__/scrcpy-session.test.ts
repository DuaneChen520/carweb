import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScrcpySession, generateScid, isCanvasContextLost, withTimeout } from '@/lib/scrcpy-session';
import { killScrcpyByPid, killScrcpyServer } from '@/lib/adb-commands';

// mock adb-commands 中的设备命令，便于断言 stop() 清理链在故障下仍精确 kill server
// （S2-P0-4 回归：videoCleanup reject 不得中断后续清理，否则设备端进程残留；
//  S2-P0-5 回归：serverPid 缺失时不得降级全杀，否则误杀同设备其它会话）。
vi.mock('@/lib/adb-commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/adb-commands')>();
  return {
    ...actual,
    killScrcpyByPid: vi.fn(async () => {}),
    killScrcpyServer: vi.fn(async () => {}),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateScid（ADR-0014 H6 回归）', () => {
  it('始终是合法十六进制串（设备端按 base-16 解析，含 g–z 会抛 NumberFormatException）', () => {
    for (let i = 0; i < 2000; i += 1) {
      const scid = generateScid();
      expect(scid).toMatch(/^[0-9a-f]+$/); // 纯 0–9a–f，无任何非法字符
      expect(parseInt(scid, 16)).not.toBeNaN();
    }
  });

  it('十六进制数值始终 ≤ 0x7FFFFFFF（设备端 int31 上限，否则溢出崩溃）', () => {
    for (let i = 0; i < 2000; i += 1) {
      const n = parseInt(generateScid(), 16);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(0x7fffffff);
    }
  });

  it('多次生成具有足够随机性（非恒定值）', () => {
    const set = new Set(Array.from({ length: 200 }, () => generateScid()));
    expect(set.size).toBeGreaterThan(150);
  });
});

function createSession(id: string) {
  const callbacks = {
    onStateChange: vi.fn(),
    onVideoSize: vi.fn(),
    onAudioStateChange: vi.fn(),
    onHealthChange: vi.fn(),
  };
  return { session: new ScrcpySession(id, callbacks), callbacks };
}

describe('ScrcpySession', () => {
  it('构造时初始化空闲状态', () => {
    const { session } = createSession('test-1');
    expect(session.isRunning).toBe(false);
    expect(session.isStarting).toBe(false);
    expect(session.displayId).toBeNull();
    expect(session.canvas).toBeNull();
  });

  it('构造时触发初始健康状态回调（IDLE）', () => {
    const { callbacks } = createSession('test-health');
    // 构造时注册了 onStateChange 监听，但初始状态不主动 emit
    // ControllerHealth 初始为 IDLE，不触发 emit
    expect(callbacks.onHealthChange).not.toHaveBeenCalled();
  });

  it('stop 在未启动时调用不报错', async () => {
    const { session } = createSession('test-2');
    await expect(session.stop()).resolves.not.toThrow();
  });

  it('stop 在未启动时调用不触发状态变更', async () => {
    const { session } = createSession('test-3');
    await session.stop();
    // stop 内部会调用 updateState（即使无变化也会通知）
    // 但 isRunning 保持 false
    expect(session.isRunning).toBe(false);
  });

  it('reparentCanvas 在 canvas 不存在时不报错', () => {
    const { session } = createSession('test-4');
    // canvas 为 null 时调用 reparentCanvas 应安全返回（无 DOM 操作）
    const fakeParent = {} as HTMLElement;
    expect(() => session.reparentCanvas(fakeParent)).not.toThrow();
  });

  // reparentCanvas 的 DOM 移动行为在 Task 6 集成测试中手动验证
  // （单测环境无 document，且计划明确：单测只覆盖状态机骨架和边界条件）

  it('currentState 返回状态副本', () => {
    const { session } = createSession('test-7');
    const state1 = session.currentState;
    const state2 = session.currentState;
    expect(state1).not.toBe(state2); // 不同引用
    expect(state1).toEqual(state2);  // 但值相同
    expect(state1.isRunning).toBe(false);
    expect(state1.error).toBeNull();
  });

  it('dispose 在未启动时调用不报错', async () => {
    const { session } = createSession('test-8');
    await expect(session.dispose()).resolves.not.toThrow();
  });

  it('多次 stop 调用安全（互斥锁生效）', async () => {
    const { session } = createSession('test-9');
    // 并发调用 stop 不应抛错
    const promises = [session.stop(), session.stop(), session.stop()];
    await Promise.all(promises);
    expect(session.isRunning).toBe(false);
  });

  it('injectTouch 在未启动时安全返回（controller 为 null）', async () => {
    const { session } = createSession('test-10');
    await expect(session.injectTouch({
      action: 0,
      pointerId: 0n,
      pointerX: 0,
      pointerY: 0,
      videoWidth: 100,
      videoHeight: 100,
      pressure: 1,
      actionButton: 0,
      buttons: 0,
    })).resolves.not.toThrow();
  });

  it('controller 缺失时 injectTouch 丢弃并打定位 warn（原因未变不重复，S2-P0-8）', async () => {
    const { session } = createSession('test-touch-drop');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const msg = {
      action: 0, pointerId: 0n, pointerX: 0, pointerY: 0,
      videoWidth: 100, videoHeight: 100, pressure: 1, actionButton: 0, buttons: 0,
    } as const;
    await session.injectTouch(msg);
    await session.injectTouch(msg); // 原因（unset）未变 → 不再重复告警
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ScrcpySession:test-touch-drop] 触控被丢弃'),
    );
    warnSpy.mockRestore();
  });

  it('触控丢弃原因变化（unset → DEAD）时重打 warn，可跟踪状态流转', async () => {
    const { session } = createSession('test-touch-drop2');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const msg = {
      action: 0, pointerId: 0n, pointerX: 0, pointerY: 0,
      videoWidth: 100, videoHeight: 100, pressure: 1, actionButton: 0, buttons: 0,
    } as const;

    await session.injectTouch(msg); // unset → 打一次
    // 模拟 controller 已建立但 health 已 DEAD（tryGetController 返回 null）
    (session as unknown as { controller: object | null }).controller = {};
    (session as unknown as {
      health: { state: string; tryGetController: <T>(ref: { current: T | null }) => T | null };
    }).health = {
      state: 'DEAD',
      tryGetController: () => null,
    };
    await session.injectTouch(msg); // present(DEAD) ≠ unset → 再打一次

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenLastCalledWith(
      expect.stringContaining('controller=present, health=DEAD'),
    );
    warnSpy.mockRestore();
  });

  it('injectText 在未启动时安全返回', async () => {
    const { session } = createSession('test-11');
    await expect(session.injectText('hello')).resolves.not.toThrow();
  });

  it('goBack 在未启动时安全返回', async () => {
    const { session } = createSession('test-12');
    await expect(session.goBack()).resolves.not.toThrow();
  });

  it('startAppOnDisplay 在未启动时安全返回', async () => {
    const { session } = createSession('test-14');
    await expect(session.startAppOnDisplay('com.test.app')).resolves.not.toThrow();
  });

  it('startAppOnDisplay 通过原生 controller.startApp 在虚拟屏启动（不再走 am）', async () => {
    const { session } = createSession('test-native');
    const startAppSpy = vi.fn().mockResolvedValue(undefined);
    // 注入 mock controller；health 初始为 IDLE，tryGetController 返回 ref.current
    (session as unknown as { controller: { startApp: typeof startAppSpy } }).controller = {
      startApp: startAppSpy,
    };
    await session.startAppOnDisplay('com.test.app');
    expect(startAppSpy).toHaveBeenCalledWith('com.test.app');
  });

  it('setAudioRoute / setMuted / resumeAudio 在未启动时安全调用', () => {
    const { session } = createSession('test-15');
    expect(() => session.setAudioRoute('phone')).not.toThrow();
    expect(() => session.setMuted(true)).not.toThrow();
    expect(() => session.resumeAudio()).not.toThrow();
  });

  it('flexClientInstance 初始为 null', () => {
    const { session } = createSession('test-16');
    expect(session.flexClientInstance).toBeNull();
  });
});

describe('isCanvasContextLost（S2-P0-6 回归）', () => {
  it('已丢失的 context 判定为 true（复用 canvas 二次 start 需换新 canvas）', () => {
    expect(isCanvasContextLost({
      getContext: () => ({ isContextLost: () => true }),
    })).toBe(true);
    // webgl2 不可用、回退 webgl 分支同样判定
    expect(isCanvasContextLost({
      getContext: (id: string) => (id === 'webgl' ? { isContextLost: () => true } : null),
    })).toBe(true);
  });

  it('未丢失 / 无 context / getContext 抛错均判定为 false', () => {
    expect(isCanvasContextLost({ getContext: () => ({ isContextLost: () => false }) })).toBe(false);
    expect(isCanvasContextLost({ getContext: () => null })).toBe(false);
    expect(isCanvasContextLost({
      getContext: () => { throw new Error('unsupported'); },
    })).toBe(false);
  });
});

describe('withTimeout（S2-P0-9：start 无限挂起兜底）', () => {
  it('Promise 按时 resolve 时返回结果（不误伤正常流程）', async () => {
    await expect(withTimeout(Promise.resolve(42), 100, 'timeout')).resolves.toBe(42);
  });

  it('Promise 超时未 resolve 时 reject（server 视频/音频元数据不发 → start 不再无限卡死）', async () => {
    await expect(withTimeout(new Promise<never>(() => {}), 50, '视频流元数据等待超时')).rejects.toThrow(
      '视频流元数据等待超时',
    );
  });

  it('Promise 先 reject 时透传原错误', async () => {
    await expect(withTimeout(Promise.reject(new Error('socket closed')), 100, 'timeout')).rejects.toThrow(
      'socket closed',
    );
  });
});

describe('stop 清理链容错（S2-P0-4 回归）', () => {
  /**
   * 注入「已启动」会话的私有资源：
   * - videoCleanup：reject 的清理器（模拟流已 errored 时 cancel 抛 ExactReadableEndedError）
   * - videoDecoder：带 dispose spy（验证清理链未被中断）
   * - adb + serverPid：验证设备端进程仍被精确 kill
   */
  function injectRunningResources(session: ScrcpySession, opts: { cleanupRejects?: boolean } = {}) {
    const disposeSpy = vi.fn();
    const cleanup = opts.cleanupRejects
      ? vi.fn().mockRejectedValue(new Error('ExactReadable ended'))
      : vi.fn().mockResolvedValue(undefined);
    (session as unknown as {
      videoCleanup: typeof cleanup;
      videoDecoder: { dispose: () => void };
      adb: unknown;
      serverPid: number | null;
    }).videoCleanup = cleanup;
    (session as unknown as { videoDecoder: { dispose: () => void } }).videoDecoder = { dispose: disposeSpy };
    (session as unknown as { adb: unknown }).adb = {} as never;
    (session as unknown as { serverPid: number | null }).serverPid = 12345;
    return { disposeSpy, cleanup };
  }

  it('videoCleanup reject 时 stop 不抛错，且剩余清理链不被中断（videoDecoder.dispose 仍执行、状态复位）', async () => {
    const { session } = createSession('test-stop-fault-1');
    const { disposeSpy } = injectRunningResources(session, { cleanupRejects: true });

    await expect(session.stop()).resolves.not.toThrow();
    expect(disposeSpy).toHaveBeenCalledTimes(1); // 后续清理仍执行
    expect(session.isRunning).toBe(false);      // 状态仍复位为停止
  });

  it('videoCleanup reject 时 server 进程仍被精确 kill（设备端不残留进程/虚拟屏）', async () => {
    const { session } = createSession('test-stop-fault-2');
    injectRunningResources(session, { cleanupRejects: true });

    await session.stop();
    expect(killScrcpyByPid).toHaveBeenCalledWith({}, 12345);
  });

  it('videoCleanup 正常时清理链行为不变', async () => {
    const { session } = createSession('test-stop-ok');
    const { disposeSpy } = injectRunningResources(session);

    await expect(session.stop()).resolves.not.toThrow();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(session.isRunning).toBe(false);
    expect(killScrcpyByPid).toHaveBeenCalledWith({}, 12345);
  });

  it('serverPid 为 null 时 stop 不再降级全杀（防误杀同设备其它会话，S2-P0-5 回归）', async () => {
    const { session } = createSession('test-stop-no-pid');
    // 模拟 start 失败（client/serverPid 均为 null）后的 stop
    (session as unknown as { adb: unknown }).adb = {} as never;

    await expect(session.stop()).resolves.not.toThrow();
    expect(killScrcpyByPid).not.toHaveBeenCalled();
    expect(killScrcpyServer).not.toHaveBeenCalled(); // 绝不 pkill 全杀
    expect(session.isRunning).toBe(false);
  });

  it('serverPid 存在时精确 kill 且不触发全杀', async () => {
    const { session } = createSession('test-stop-pid-only');
    injectRunningResources(session, { cleanupRejects: true });

    await session.stop();
    expect(killScrcpyByPid).toHaveBeenCalledWith({}, 12345);
    expect(killScrcpyServer).not.toHaveBeenCalled();
  });
});
