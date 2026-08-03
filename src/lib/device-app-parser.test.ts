/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks require any casts */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DeviceAppParser } from './device-app-parser';

/**
 * v3 mock 工具：
 * - adb.sync 是属性（AdbSync.Service 实例），不再是方法；
 * - subprocess.spawn(cmd) 返回「Promise 且带 .wait() 方法」的组合对象（AdbSpawner 类型）。
 *   noneProtocol：wait().toString() → string
 *   shellProtocol：wait().toString() → {stdout, stderr, exitCode}
 *   cleanup 路径：wait()（await 得 Uint8Array，被忽略）
 */
function makeLazyString(result: string) {
  const lazy: any = Promise.resolve(new Uint8Array(0));
  lazy.toString = () => Promise.resolve(result);
  return lazy;
}

function makeLazyShellResult(stdout: string, stderr = '') {
  const lazy: any = Promise.resolve(new Uint8Array(0));
  lazy.toString = () => Promise.resolve({ stdout, stderr, exitCode: 0 });
  return lazy;
}

/** 构造带 sync 属性 + noneProtocol/shellProtocol spawn 的 fake adb。 */
function makeMockAdb(options: {
  json?: string;
  shellJson?: string;
  spawnImpl?: (cmd: string) => unknown;
} = {}) {
  const { json = '{"apps":[],"errors":[]}', shellJson, spawnImpl } = options;
  const mockWrite = vi.fn().mockResolvedValue(undefined);
  const impl = spawnImpl ?? (() => Promise.resolve({}));
  const noneSpawn = vi.fn((cmd: string) => {
    const p: any = impl(cmd);
    if (p && typeof p.then === 'function' && !p.wait) {
      p.wait = () => makeLazyString(json);
    }
    return p;
  });
  const shellSpawn = vi.fn((cmd: string) => {
    const p: any = impl(cmd);
    if (p && typeof p.then === 'function' && !p.wait) {
      p.wait = () => makeLazyShellResult(shellJson ?? json);
    }
    return p;
  });
  return {
    adb: {
      sync: { write: mockWrite },
      subprocess: {
        noneProtocol: { spawn: noneSpawn },
        shellProtocol: { spawn: shellSpawn },
      },
    } as any,
    mockWrite,
    noneSpawn,
    shellSpawn,
  };
}

describe('DeviceAppParser', () => {
  let parser: DeviceAppParser;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    }));
    parser = new DeviceAppParser();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should push DEX file to device', async () => {
    const { adb, mockWrite } = makeMockAdb();
    const result = await parser.pushDexToDevice(adb, '/data/local/tmp/test.dex');
    expect(result).toBe(true);
    expect(mockWrite).toHaveBeenCalled();
  });

  it('should reject invalid target paths', async () => {
    const { adb } = makeMockAdb();
    await expect(parser.pushDexToDevice(adb, '/etc/passwd')).rejects.toThrow('Invalid target path');
    await expect(parser.pushDexToDevice(adb, 'relative/path.dex')).rejects.toThrow('Invalid target path');
    await expect(parser.pushDexToDevice(adb, '/data/local/tmp/evil; rm -rf /')).rejects.toThrow('Invalid target path');
  });

  it('should throw on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Not Found',
    }));
    const { adb } = makeMockAdb();
    await expect(parser.pushDexToDevice(adb, '/data/local/tmp/test.dex')).rejects.toThrow('Failed to fetch DEX file');
  });

  it('should throw when fetch returns empty DEX', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    }));
    const { adb } = makeMockAdb();
    await expect(parser.pushDexToDevice(adb, '/data/local/tmp/test.dex')).rejects.toThrow('DEX file is empty');
  });

  it('should execute DEX file on device', async () => {
    const { adb } = makeMockAdb({ json: '{"apps":[],"errors":[]}' });
    const result = await parser.executeDex(adb, '/data/local/tmp/test.dex');
    expect(result).toEqual({ apps: [], errors: [] });
  });

  it('should parse JSON result correctly', () => {
    const jsonResult = '{"apps":[{"packageName":"com.example","label":"Example","iconBase64":null,"versionCode":1}],"errors":[]}';
    const result = parser.parseJsonResult(jsonResult);
    expect(result.apps).toHaveLength(1);
    expect(result.apps[0].packageName).toBe('com.example');
  });

  it('should handle missing apps array in JSON', () => {
    const jsonResult = '{"errors":[]}';
    expect(() => parser.parseJsonResult(jsonResult)).toThrow('Invalid result structure: missing apps array');
  });

  it('should handle invalid JSON gracefully', () => {
    const invalidJson = 'invalid json';
    expect(() => parser.parseJsonResult(invalidJson)).toThrow();
  });

  it('should filter out app entries with missing required fields', () => {
    const jsonResult = JSON.stringify({
      apps: [
        { packageName: 'com.good', label: 'Good', iconBase64: null, versionCode: 1 },
        { packageName: null, label: 'Bad', iconBase64: null, versionCode: 1 },
        { label: 'NoPkg', iconBase64: null, versionCode: 1 },
        { packageName: 'com.noversion', label: 'NoVer', iconBase64: null },
        'invalid-string',
      ],
      errors: [],
    });
    const result = parser.parseJsonResult(jsonResult);
    expect(result.apps).toHaveLength(1);
    expect(result.apps[0].packageName).toBe('com.good');
  });

  it('should cleanup DEX file from device', async () => {
    const { adb, shellSpawn } = makeMockAdb();
    const result = await parser.cleanupDex(adb, '/data/local/tmp/test.dex');
    expect(result).toBe(true);
    expect(shellSpawn).toHaveBeenCalledWith("rm -f '/data/local/tmp/test.dex' '/data/local/tmp/run-app-info.sh'");
  });

  it('should parse all apps end-to-end', async () => {
    const jsonPayload = JSON.stringify({
      apps: [{ packageName: 'com.example', label: 'Example', iconBase64: null, versionCode: 1 }],
      errors: [],
    });
    const { adb } = makeMockAdb({ json: jsonPayload, shellJson: jsonPayload });
    const result = await parser.parseAllApps(adb);
    expect(result.apps).toHaveLength(1);
    expect(result.apps[0].packageName).toBe('com.example');
  });

  it('should clean up DEX even when executeDex fails', async () => {
    // v3：executeDex 失败来自 spawn(...).wait().toString() reject（进程执行失败），
    // 而非 spawn 本身 reject。cleanup 走 shellProtocol spawn(...).wait()（成功）。
    const mockWrite = vi.fn().mockResolvedValue(undefined);
    const makeRejectingSpawn = () => {
      const p: any = Promise.resolve({});
      const lazy: any = Promise.resolve(new Uint8Array(0));
      lazy.toString = () => Promise.reject(new Error('execute failed'));
      p.wait = () => lazy;
      return p;
    };
    const adb: any = {
      sync: { write: mockWrite },
      subprocess: {
        noneProtocol: { spawn: vi.fn(makeRejectingSpawn) },
        shellProtocol: { spawn: vi.fn(makeRejectingSpawn) },
      },
    };
    await expect(parser.parseAllApps(adb)).rejects.toThrow('execute failed');
  });

  describe('Quick DEX', () => {
    it('should push Quick DEX file to device', async () => {
      const { adb, mockWrite } = makeMockAdb();
      const result = await parser.pushQuickDexToDevice(adb, '/data/local/tmp/test-quick.dex');
      expect(result).toBe(true);
      expect(mockWrite).toHaveBeenCalled();
    });

    it('should reject invalid quick dex target paths', async () => {
      const { adb } = makeMockAdb();
      await expect(parser.pushQuickDexToDevice(adb, '/etc/passwd')).rejects.toThrow('Invalid target path');
      await expect(parser.pushQuickDexToDevice(adb, 'relative/path.dex')).rejects.toThrow('Invalid target path');
    });

    it('should execute Quick DEX on device', async () => {
      const quickJson = '{"apps":[{"packageName":"com.test","versionCode":1}]}';
      const { adb } = makeMockAdb({ json: quickJson, shellJson: quickJson });
      const result = await parser.executeQuickDex(adb, '/data/local/tmp/test-quick.dex');
      expect(result.apps).toHaveLength(1);
      expect(result.apps[0].packageName).toBe('com.test');
      expect(result.apps[0].versionCode).toBe(1);
    });

    it('should parse Quick JSON result correctly', () => {
      const jsonResult = '{"apps":[{"packageName":"com.example","versionCode":42}]}';
      const result = parser.parseQuickJsonResult(jsonResult);
      expect(result.apps).toHaveLength(1);
      expect(result.apps[0].packageName).toBe('com.example');
      expect(result.apps[0].versionCode).toBe(42);
    });

    it('should throw on Quick DEX error response', () => {
      expect(() => parser.parseQuickJsonResult('Error: something failed')).toThrow('Quick DEX execution failed');
      expect(() => parser.parseQuickJsonResult('Exception: crash')).toThrow('Quick DEX execution failed');
    });

    it('should handle missing apps array in Quick JSON', () => {
      expect(() => parser.parseQuickJsonResult('{"errors":[]}')).toThrow('Invalid quick result structure');
    });

    it('should filter invalid entries in Quick JSON', () => {
      const jsonResult = JSON.stringify({
        apps: [
          { packageName: 'com.good', versionCode: 1 },
          { packageName: null, versionCode: 1 },
          { packageName: 'com.noversion' },
          'invalid-string',
        ],
      });
      const result = parser.parseQuickJsonResult(jsonResult);
      expect(result.apps).toHaveLength(1);
      expect(result.apps[0].packageName).toBe('com.good');
    });

    it('should cleanup Quick DEX from device', async () => {
      const { adb, shellSpawn } = makeMockAdb();
      const result = await parser.cleanupQuickDex(adb, '/data/local/tmp/test-quick.dex');
      expect(result).toBe(true);
      expect(shellSpawn).toHaveBeenCalledWith("rm -f '/data/local/tmp/test-quick.dex' '/data/local/tmp/run-app-info-quick.sh'");
    });

    it('should fetch quick package list end-to-end', async () => {
      const quickJson = '{"apps":[{"packageName":"com.example","versionCode":1}]}';
      const { adb } = makeMockAdb({ json: quickJson, shellJson: quickJson });
      const result = await parser.fetchQuickPackageList(adb);
      expect(result.apps).toHaveLength(1);
      expect(result.apps[0].packageName).toBe('com.example');
    });
  });
});
