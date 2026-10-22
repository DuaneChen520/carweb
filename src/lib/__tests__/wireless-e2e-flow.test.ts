import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Adb } from '@yume-chan/adb';
import { useAdbStore } from '@/hooks/useAdbStore';
import { markIntentionalClose } from '@/lib/adb-intent';
import { handleAdbDisconnected } from '@/lib/adb-disconnect';
import { AdbServerManager } from '@/lib/adb-server-manager';

describe('无线连接全链路端到端高阶接缝测试 (Wireless E2E Flow)', () => {
  let mockAdb: Adb;
  let disconnectedReject!: (reason?: unknown) => void;
  let disconnectedResolve!: () => void;
  let disconnectedPromise: Promise<void>;

  beforeEach(() => {
    useAdbStore.getState().reset();

    disconnectedPromise = new Promise((resolve, reject) => {
      disconnectedResolve = resolve;
      disconnectedReject = reject;
    });

    mockAdb = {
      disconnected: disconnectedPromise,
      close: vi.fn().mockImplementation(async () => {
        disconnectedResolve();
      }),
    } as unknown as Adb;
  });

  it('场景 1：用户首次上车免线配对全流程（pair → connect → attach）', async () => {
    const mockConnector = {
      connect: vi.fn(),
      addReverseTunnel: vi.fn(),
      removeReverseTunnel: vi.fn(),
      clearReverseTunnels: vi.fn(),
    };
    const manager = new AdbServerManager(mockConnector);

    const pairSpy = vi.spyOn(manager.rawClient.wireless, 'pair').mockResolvedValue(undefined);
    const connectSpy = vi.spyOn(manager.rawClient.wireless, 'connect').mockResolvedValue(undefined);
    const createAdbSpy = vi.spyOn(manager.rawClient, 'createAdb').mockResolvedValue(mockAdb);

    const store = useAdbStore.getState();
    store.setConnectionStatus('connecting');
    store.setConnectionType('wifi');

    // 1. 用户输入 6 位配对码和配对端口发起配对
    await manager.pair('192.168.1.100:37123', '654321');
    expect(pairSpy).toHaveBeenCalledWith('192.168.1.100:37123', '654321');

    // 2. 配对成功后自动连接主调试端口 5555
    await manager.connect('192.168.1.100:5555');
    expect(connectSpy).toHaveBeenCalledWith('192.168.1.100:5555');

    // 3. 建立 Adb 实例并挂载到全局状态
    const adb = await manager.createAdb({ serial: '192.168.1.100:5555' });
    expect(createAdbSpy).toHaveBeenCalledWith({ serial: '192.168.1.100:5555' });

    store.setAdb(adb);
    store.setDeviceInfo('WiFi-192.168.1.100', '192.168.1.100:5555');
    store.setWifiAddress('192.168.1.100');
    store.setConnectionStatus('connected');

    expect(useAdbStore.getState().connectionStatus).toBe('connected');
    expect(useAdbStore.getState().connectionType).toBe('wifi');
    expect(useAdbStore.getState().wifiAddress).toBe('192.168.1.100');
  });

  it('场景 2：无线连接偶发闪断诊断与状态流转', async () => {
    const store = useAdbStore.getState();
    store.setConnectionStatus('connected');
    store.setConnectionType('wifi');
    store.setAdb(mockAdb);
    store.setWifiAddress('192.168.1.100');

    // 监听断线事件
    mockAdb.disconnected.then(
      () => handleAdbDisconnected(useAdbStore.getState(), mockAdb),
      (err) => handleAdbDisconnected(useAdbStore.getState(), mockAdb, err),
    );

    // 模拟 WiFi 弱信号闪断
    disconnectedReject(new Error('WebSocket connection lost / timeout'));

    // 等待 promise 处理
    await new Promise((r) => setTimeout(r, 10));

    const updated = useAdbStore.getState();
    expect(updated.connectionStatus).toBe('disconnected');
    expect(updated.adb).toBeNull();
    expect(updated.error).toBe('WiFi 信号较弱或网络暂时中断');
  });

  it('场景 3：手机主动关闭无线调试权限失效', async () => {
    const store = useAdbStore.getState();
    store.setConnectionStatus('connected');
    store.setConnectionType('wifi');
    store.setAdb(mockAdb);

    mockAdb.disconnected.then(
      () => handleAdbDisconnected(useAdbStore.getState(), mockAdb),
      (err) => handleAdbDisconnected(useAdbStore.getState(), mockAdb, err),
    );

    // 模拟手机端关闭无线调试
    disconnectedReject(new Error('device unauthorized'));
    await new Promise((r) => setTimeout(r, 10));

    const updated = useAdbStore.getState();
    expect(updated.connectionStatus).toBe('disconnected');
    expect(updated.error).toBe('手机端无线调试授权已失效或关闭');
  });

  it('场景 4：用户主动在车机点击断开，不触发错误与重连警报', async () => {
    const store = useAdbStore.getState();
    store.setConnectionStatus('connected');
    store.setConnectionType('wifi');
    store.setAdb(mockAdb);

    mockAdb.disconnected.then(
      () => handleAdbDisconnected(useAdbStore.getState(), mockAdb),
      (err) => handleAdbDisconnected(useAdbStore.getState(), mockAdb, err),
    );

    // 用户在 UI 点击断开投屏
    markIntentionalClose(mockAdb);
    await store.disconnect();

    const updated = useAdbStore.getState();
    expect(updated.connectionStatus).toBe('idle');
    expect(updated.error).toBeNull();
    expect(updated.adb).toBeNull();
  });
});
