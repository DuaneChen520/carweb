import { describe, it, expect, vi } from 'vitest';
import type { Adb, AdbServerClient } from '@yume-chan/adb';
import { AdbServerManager } from '../adb-server-manager';

describe('AdbServerManager', () => {
  it('正确代理 pair、connect、disconnect、getDevices 与 createAdb 指令', async () => {
    const mockConnector: AdbServerClient.ServerConnector = {
      connect: vi.fn(),
      addReverseTunnel: vi.fn(),
      removeReverseTunnel: vi.fn(),
      clearReverseTunnels: vi.fn(),
    };

    const manager = new AdbServerManager(mockConnector);
    const raw = manager.rawClient;

    // Mock 底层 client 的 wireless 及核心方法
    const pairSpy = vi.spyOn(raw.wireless, 'pair').mockResolvedValue(undefined);
    const connectSpy = vi.spyOn(raw.wireless, 'connect').mockResolvedValue(undefined);
    const disconnectSpy = vi.spyOn(raw.wireless, 'disconnect').mockResolvedValue(undefined);

    const mockDevices: AdbServerClient.Device[] = [
      {
        serial: '192.168.1.100:5555',
        state: 'device',
        authenticating: false,
        transportId: 1n,
      },
    ];
    const getDevicesSpy = vi.spyOn(raw, 'getDevices').mockResolvedValue(mockDevices);

    const mockAdb = { serial: '192.168.1.100:5555' } as unknown as Adb;
    const createAdbSpy = vi.spyOn(raw, 'createAdb').mockResolvedValue(mockAdb);

    // 1. 测试 pair
    await manager.pair('192.168.1.100:37123', '123456');
    expect(pairSpy).toHaveBeenCalledWith('192.168.1.100:37123', '123456');

    // 2. 测试 connect
    await manager.connect('192.168.1.100:5555');
    expect(connectSpy).toHaveBeenCalledWith('192.168.1.100:5555');

    // 3. 测试 disconnect
    await manager.disconnect('192.168.1.100:5555');
    expect(disconnectSpy).toHaveBeenCalledWith('192.168.1.100:5555');

    // 4. 测试 getDevices
    const devices = await manager.getDevices();
    expect(getDevicesSpy).toHaveBeenCalled();
    expect(devices).toEqual(mockDevices);

    // 5. 测试 createAdb
    const adb = await manager.createAdb({ serial: '192.168.1.100:5555' });
    expect(createAdbSpy).toHaveBeenCalledWith({ serial: '192.168.1.100:5555' });
    expect(adb).toBe(mockAdb);
  });
});
