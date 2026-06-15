/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks require any casts */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DeviceAppParser } from './device-app-parser';

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
    const mockWrite = vi.fn().mockResolvedValue(undefined);
    const mockAdb = {
      sync: vi.fn().mockResolvedValue({
        write: mockWrite,
      }),
    } as any;

    const result = await parser.pushDexToDevice(mockAdb, '/data/local/tmp/test.dex');
    expect(result).toBe(true);
    expect(mockWrite).toHaveBeenCalled();
  });

  it('should reject invalid target paths', async () => {
    const mockAdb = {
      sync: vi.fn().mockResolvedValue({ write: vi.fn() }),
    } as any;

    await expect(parser.pushDexToDevice(mockAdb, '/etc/passwd')).rejects.toThrow('Invalid target path');
    await expect(parser.pushDexToDevice(mockAdb, 'relative/path.dex')).rejects.toThrow('Invalid target path');
    await expect(parser.pushDexToDevice(mockAdb, '/data/local/tmp/evil; rm -rf /')).rejects.toThrow('Invalid target path');
  });

  it('should throw on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Not Found',
    }));
    const mockAdb = {
      sync: vi.fn().mockResolvedValue({ write: vi.fn() }),
    } as any;

    await expect(parser.pushDexToDevice(mockAdb, '/data/local/tmp/test.dex')).rejects.toThrow('Failed to fetch DEX file');
  });

  it('should throw when fetch returns empty DEX', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    }));
    const mockAdb = {
      sync: vi.fn().mockResolvedValue({ write: vi.fn() }),
    } as any;

    await expect(parser.pushDexToDevice(mockAdb, '/data/local/tmp/test.dex')).rejects.toThrow('DEX file is empty');
  });

  it('should execute DEX file on device', async () => {
    const mockAdb = {
      sync: vi.fn().mockResolvedValue({
        write: vi.fn().mockResolvedValue(undefined),
      }),
      subprocess: {
        noneProtocol: {
          spawnWaitText: vi.fn().mockResolvedValue('{"apps":[],"errors":[]}'),
        },
      },
    } as any;

    const result = await parser.executeDex(mockAdb, '/data/local/tmp/test.dex');
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
    const mockSpawn = vi.fn().mockResolvedValue('');
    const mockAdb = {
      subprocess: {
        shellProtocol: {
          spawnWaitText: mockSpawn,
        },
      },
    } as any;

    const result = await parser.cleanupDex(mockAdb, '/data/local/tmp/test.dex');
    expect(result).toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith("rm -f '/data/local/tmp/test.dex' '/data/local/tmp/run-app-info.sh'");
  });

  it('should parse all apps end-to-end', async () => {
    const jsonPayload = JSON.stringify({
      apps: [{ packageName: 'com.example', label: 'Example', iconBase64: null, versionCode: 1 }],
      errors: [],
    });
    const mockAdb = {
      sync: vi.fn().mockResolvedValue({
        write: vi.fn().mockResolvedValue(undefined),
      }),
      subprocess: {
        noneProtocol: {
          spawnWaitText: vi.fn().mockResolvedValue(jsonPayload),
        },
        shellProtocol: {
          spawnWaitText: vi.fn().mockResolvedValue({ stdout: jsonPayload, stderr: '' }),
        },
      },
    } as any;

    const result = await parser.parseAllApps(mockAdb);
    expect(result.apps).toHaveLength(1);
    expect(result.apps[0].packageName).toBe('com.example');
  });

  it('should clean up DEX even when executeDex fails', async () => {
    const mockAdb = {
      sync: vi.fn().mockResolvedValue({
        write: vi.fn().mockResolvedValue(undefined),
      }),
      subprocess: {
        noneProtocol: {
          spawnWaitText: vi.fn().mockRejectedValue(new Error('execute failed')),
        },
        shellProtocol: {
          spawnWaitText: vi.fn().mockResolvedValue(''),
        },
      },
    } as any;

    await expect(parser.parseAllApps(mockAdb)).rejects.toThrow('execute failed');
  });

  describe('Quick DEX', () => {
    it('should push Quick DEX file to device', async () => {
      const mockWrite = vi.fn().mockResolvedValue(undefined);
      const mockAdb = {
        sync: vi.fn().mockResolvedValue({
          write: mockWrite,
        }),
      } as any;

      const result = await parser.pushQuickDexToDevice(mockAdb, '/data/local/tmp/test-quick.dex');
      expect(result).toBe(true);
      expect(mockWrite).toHaveBeenCalled();
    });

    it('should reject invalid quick dex target paths', async () => {
      const mockAdb = {
        sync: vi.fn().mockResolvedValue({ write: vi.fn() }),
      } as any;

      await expect(parser.pushQuickDexToDevice(mockAdb, '/etc/passwd')).rejects.toThrow('Invalid target path');
      await expect(parser.pushQuickDexToDevice(mockAdb, 'relative/path.dex')).rejects.toThrow('Invalid target path');
    });

    it('should execute Quick DEX on device', async () => {
      const mockAdb = {
        sync: vi.fn().mockResolvedValue({
          write: vi.fn().mockResolvedValue(undefined),
        }),
        subprocess: {
          noneProtocol: {
            spawnWaitText: vi.fn().mockResolvedValue('{"apps":[{"packageName":"com.test","versionCode":1}]}'),
          },
          shellProtocol: {
            spawnWaitText: vi.fn().mockResolvedValue({ stdout: '{"apps":[{"packageName":"com.test","versionCode":1}]}', stderr: '' }),
          },
        },
      } as any;

      const result = await parser.executeQuickDex(mockAdb, '/data/local/tmp/test-quick.dex');
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
      const mockSpawn = vi.fn().mockResolvedValue('');
      const mockAdb = {
        subprocess: {
          shellProtocol: {
            spawnWaitText: mockSpawn,
          },
        },
      } as any;

      const result = await parser.cleanupQuickDex(mockAdb, '/data/local/tmp/test-quick.dex');
      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith("rm -f '/data/local/tmp/test-quick.dex' '/data/local/tmp/run-app-info-quick.sh'");
    });

    it('should fetch quick package list end-to-end', async () => {
      const mockWrite = vi.fn().mockResolvedValue(undefined);
      const mockAdb = {
        sync: vi.fn().mockResolvedValue({ write: mockWrite }),
        subprocess: {
          noneProtocol: {
            spawnWaitText: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
          },
          shellProtocol: {
            spawnWaitText: vi.fn().mockResolvedValue({ stdout: '{"apps":[{"packageName":"com.example","versionCode":1}]}', stderr: '' }),
          },
        },
      } as any;

      const result = await parser.fetchQuickPackageList(mockAdb);
      expect(result.apps).toHaveLength(1);
      expect(result.apps[0].packageName).toBe('com.example');
    });
  });
});
