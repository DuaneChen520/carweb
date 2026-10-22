import { describe, it, expect, beforeEach } from 'vitest';
import type { Adb } from '@yume-chan/adb';
import { useAdbStore } from '../../hooks/useAdbStore';
import { handleAdbDisconnected } from '../adb-disconnect';
import { markIntentionalClose } from '../adb-intent';

/** 仅用于测试的最小 Adb 桩（handleAdbDisconnected 只关心对象身份，不调用其方法）。 */
function makeFakeAdb(): Adb {
  return {} as unknown as Adb;
}

function connectedStore(adb: Adb) {
  useAdbStore.setState({
    connectionStatus: 'connected',
    adb,
    usbDevice: adb as never,
    error: null,
  });
}

describe('handleAdbDisconnected (docs/adr/0007)', () => {
  beforeEach(() => {
    useAdbStore.getState().reset();
  });

  it('有意断开 → 置 idle（不弹“USB 连接已断开”overlay）', () => {
    const adb = makeFakeAdb();
    markIntentionalClose(adb);
    connectedStore(adb);

    handleAdbDisconnected(useAdbStore.getState(), adb);

    const s = useAdbStore.getState();
    expect(s.connectionStatus).toBe('idle');
    expect(s.adb).toBeNull();
    expect(s.usbDevice).toBeNull();
    expect(s.error).toBeNull();
  });

  it('真实掉线（未标记） → 置 disconnected，无 error', () => {
    const adb = makeFakeAdb();
    connectedStore(adb);

    handleAdbDisconnected(useAdbStore.getState(), adb);

    const s = useAdbStore.getState();
    expect(s.connectionStatus).toBe('disconnected');
    expect(s.adb).toBeNull();
    expect(s.error).toBeNull();
  });

  it('真实掉线（异常分支，带 error） → disconnected + error', () => {
    const adb = makeFakeAdb();
    connectedStore(adb);

    handleAdbDisconnected(useAdbStore.getState(), adb, new Error('transport gone'));

    const s = useAdbStore.getState();
    expect(s.connectionStatus).toBe('disconnected');
    expect(s.error).toBe('USB 连接异常断开');
  });

  it('标记只读一次：两个分支中只有一个命中“有意断开”', () => {
    const adb = makeFakeAdb();
    markIntentionalClose(adb);
    connectedStore(adb);

    // 连续两次触发（正常/异常都可能），只有首次应识别为有意
    handleAdbDisconnected(useAdbStore.getState(), adb);
    expect(useAdbStore.getState().connectionStatus).toBe('idle');

    // 第二次不再有标记，应表现为真实掉线
    connectedStore(adb);
    handleAdbDisconnected(useAdbStore.getState(), adb, new Error('boom'));
    expect(useAdbStore.getState().connectionStatus).toBe('disconnected');
    expect(useAdbStore.getState().error).toBe('USB 连接异常断开');
  });

  it('无线连接真实掉线（异常分支） → disconnected + 友好 WiFi 错误文案', () => {
    const adb = makeFakeAdb();
    useAdbStore.setState({
      connectionStatus: 'connected',
      connectionType: 'wifi',
      adb,
      error: null,
    });

    handleAdbDisconnected(useAdbStore.getState(), adb, new Error('Connection reset by peer'));

    const s = useAdbStore.getState();
    expect(s.connectionStatus).toBe('disconnected');
    expect(s.error).toBe('WiFi 信号较弱或网络暂时中断');
  });

  it('无线连接授权失效 → disconnected + 提示授权已失效或关闭', () => {
    const adb = makeFakeAdb();
    useAdbStore.setState({
      connectionStatus: 'connected',
      connectionType: 'wifi',
      adb,
      error: null,
    });

    handleAdbDisconnected(useAdbStore.getState(), adb, new Error('device unauthorized'));

    const s = useAdbStore.getState();
    expect(s.connectionStatus).toBe('disconnected');
    expect(s.error).toBe('手机端无线调试授权已失效或关闭');
  });
});
