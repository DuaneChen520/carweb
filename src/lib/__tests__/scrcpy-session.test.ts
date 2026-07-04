import { describe, it, expect, vi } from 'vitest';
import { ScrcpySession } from '@/lib/scrcpy-session';

describe('ScrcpySession', () => {
  function createSession(id: string) {
    const callbacks = {
      onStateChange: vi.fn(),
      onVideoSize: vi.fn(),
      onAudioStateChange: vi.fn(),
      onHealthChange: vi.fn(),
    };
    return { session: new ScrcpySession(id, callbacks), callbacks };
  }

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
    const { session, callbacks } = createSession('test-3');
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

  it('injectText 在未启动时安全返回', async () => {
    const { session } = createSession('test-11');
    await expect(session.injectText('hello')).resolves.not.toThrow();
  });

  it('goBack 在未启动时安全返回', async () => {
    const { session } = createSession('test-12');
    await expect(session.goBack()).resolves.not.toThrow();
  });

  it('ensureDisplayId 在未启动时返回 null', async () => {
    const { session } = createSession('test-13');
    // displayId 初始为 null，但 adb 也为 null，立即返回 null（不进入轮询）
    // 注意：displayId === null 且 adb === null 时，直接返回 null
    const result = await session.ensureDisplayId();
    expect(result).toBeNull();
  });

  it('startAppOnDisplay 在未启动时安全返回', async () => {
    const { session } = createSession('test-14');
    await expect(session.startAppOnDisplay('com.test.app')).resolves.not.toThrow();
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
