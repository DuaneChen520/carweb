// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Adb } from '@yume-chan/adb';
import { useWifiConnection } from '../useWifiConnection';
import { useAdbStore } from '../useAdbStore';
import type { IAdbWirelessService } from '@/lib/adb-server-manager';

// Mock adb-commands
vi.mock('@/lib/adb-commands', () => ({
  killScrcpyServer: vi.fn().mockResolvedValue(undefined),
}));

// Mock adb-disconnect
vi.mock('@/lib/adb-disconnect', () => ({
  handleAdbDisconnected: vi.fn(),
}));

describe('useWifiConnection', () => {
  let mockService: IAdbWirelessService;
  let mockAdb: Adb;
  let disconnectedPromise: Promise<void>;

  beforeEach(() => {
    useAdbStore.getState().reset();
    disconnectedPromise = new Promise(() => {});

    mockAdb = {
      disconnected: disconnectedPromise,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Adb;

    mockService = {
      pair: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getDevices: vi.fn().mockResolvedValue([]),
      createAdb: vi.fn().mockResolvedValue(mockAdb),
    };
  });

  it('connectWifi 验证非法 IP 地址并报错', async () => {
    const { result } = renderHook(() => useWifiConnection({ service: mockService }));

    await act(async () => {
      await result.current.connectWifi('invalid-ip');
    });

    const store = useAdbStore.getState();
    expect(store.connectionStatus).toBe('error');
    expect(store.error).toBe('IP 地址格式无效');
    expect(mockService.connect).not.toHaveBeenCalled();
  });

  it('connectWifi 正常连接成功并登记至 useAdbStore', async () => {
    const { result } = renderHook(() => useWifiConnection({ service: mockService }));

    await act(async () => {
      await result.current.connectWifi('192.168.1.100:5555');
    });

    const store = useAdbStore.getState();
    expect(mockService.connect).toHaveBeenCalledWith('192.168.1.100:5555');
    expect(mockService.createAdb).toHaveBeenCalledWith({ serial: '192.168.1.100:5555' });
    expect(store.connectionStatus).toBe('connected');
    expect(store.connectionType).toBe('wifi');
    expect(store.wifiAddress).toBe('192.168.1.100');
    expect(store.deviceSerial).toBe('192.168.1.100:5555');
    expect(store.adb).toBe(mockAdb);
  });

  it('connectWifi 遇到底层连接异常时置 error 态', async () => {
    vi.mocked(mockService.connect).mockRejectedValueOnce(new Error('Connection refused'));
    const { result } = renderHook(() => useWifiConnection({ service: mockService }));

    await act(async () => {
      await result.current.connectWifi('192.168.1.100');
    });

    const store = useAdbStore.getState();
    expect(store.connectionStatus).toBe('error');
    expect(store.error).toBe('Connection refused');
  });

  it('pairAndConnect 校验空配对码并报错', async () => {
    const { result } = renderHook(() => useWifiConnection({ service: mockService }));

    await act(async () => {
      await result.current.pairAndConnect('192.168.1.100:37123', '');
    });

    const store = useAdbStore.getState();
    expect(store.connectionStatus).toBe('error');
    expect(store.error).toBe('请输入 6 位配对码');
    expect(mockService.pair).not.toHaveBeenCalled();
  });

  it('pairAndConnect 成功执行配对与自动建连', async () => {
    const { result } = renderHook(() => useWifiConnection({ service: mockService }));

    await act(async () => {
      await result.current.pairAndConnect('192.168.1.100:37123', '123456');
    });

    expect(mockService.pair).toHaveBeenCalledWith('192.168.1.100:37123', '123456');
    expect(mockService.connect).toHaveBeenCalledWith('192.168.1.100:5555');
    expect(mockService.createAdb).toHaveBeenCalledWith({ serial: '192.168.1.100:5555' });

    const store = useAdbStore.getState();
    expect(store.connectionStatus).toBe('connected');
    expect(store.wifiAddress).toBe('192.168.1.100');
  });

  it('connectWithPairing 解析合法 QR 码并完成全链路配对建连', async () => {
    const { result } = renderHook(() => useWifiConnection({ service: mockService }));
    const qr = 'WIFI:T:ADB;S:Pixel7;P:654321;H:192.168.1.88;D:41234;;';

    await act(async () => {
      await result.current.connectWithPairing(qr);
    });

    expect(mockService.pair).toHaveBeenCalledWith('192.168.1.88:41234', '654321');
    expect(mockService.connect).toHaveBeenCalledWith('192.168.1.88:5555');
    expect(useAdbStore.getState().connectionStatus).toBe('connected');
  });

  it('scanDevices 从 ADB 宿主获取已连接网络设备', async () => {
    vi.mocked(mockService.getDevices).mockResolvedValue([
      { serial: '192.168.1.100:5555', state: 'device', authenticating: false, transportId: 1n },
      { serial: 'usb-1234', state: 'device', authenticating: false, transportId: 2n },
    ]);

    const { result } = renderHook(() => useWifiConnection({ service: mockService }));

    await act(async () => {
      await result.current.scanDevices();
    });

    expect(result.current.discoveredDevices).toEqual([
      { ip: '192.168.1.100', port: 5555 },
    ]);
  });

  it('tryAutoConnectWifi 首次即成功直接返回', async () => {
    const { result } = renderHook(() => useWifiConnection({ service: mockService }));
    const onProgress = vi.fn();

    let res!: { success: boolean; cancelled: boolean };
    await act(async () => {
      res = await result.current.tryAutoConnectWifi('192.168.1.100:5555', onProgress);
    });

    expect(res).toEqual({ success: true, cancelled: false });
    expect(mockService.connect).toHaveBeenCalledTimes(1);
    expect(useAdbStore.getState().connectionStatus).toBe('connected');
    expect(onProgress).toHaveBeenCalledWith({ attempt: 1, maxAttempts: 3, retrying: false });
  });

  it('tryAutoConnectWifi 首次失败、第二次重试成功', async () => {
    vi.mocked(mockService.connect)
      .mockRejectedValueOnce(new Error('temporarily unreachable'))
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useWifiConnection({ service: mockService }));
    const onProgress = vi.fn();

    let res!: { success: boolean; cancelled: boolean };
    await act(async () => {
      res = await result.current.tryAutoConnectWifi('192.168.1.100:5555', onProgress);
    });

    expect(res).toEqual({ success: true, cancelled: false });
    expect(mockService.connect).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenCalledWith({ attempt: 2, maxAttempts: 3, retrying: true });
    expect(useAdbStore.getState().connectionStatus).toBe('connected');
  });

  it('tryAutoConnectWifi 连续失败三次用尽重试温和降级至 idle', async () => {
    vi.mocked(mockService.connect).mockRejectedValue(new Error('host down'));

    const { result } = renderHook(() => useWifiConnection({ service: mockService }));

    let res!: { success: boolean; cancelled: boolean };
    await act(async () => {
      res = await result.current.tryAutoConnectWifi('192.168.1.100:5555');
    });

    expect(res).toEqual({ success: false, cancelled: false });
    expect(mockService.connect).toHaveBeenCalledTimes(3);
    expect(useAdbStore.getState().connectionStatus).toBe('idle');
  });

  it('tryAutoConnectWifi 中途取消时中止重试', async () => {
    vi.mocked(mockService.connect).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error('fail');
    });

    const { result } = renderHook(() => useWifiConnection({ service: mockService }));

    let promise!: Promise<{ success: boolean; cancelled: boolean }>;
    act(() => {
      promise = result.current.tryAutoConnectWifi('192.168.1.100:5555');
      result.current.cancelAutoConnect();
    });

    const res = await promise;
    expect(res).toEqual({ success: false, cancelled: true });
    expect(useAdbStore.getState().connectionStatus).toBe('idle');
  });
});
