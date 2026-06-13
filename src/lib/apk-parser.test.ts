import { describe, it, expect, vi } from 'vitest';
import { parseApk, getMaxMemoryBytes } from './apk-parser';

vi.mock('app-info-parser', () => {
  return {
    default: class MockAppInfoParser {
      file: Blob;
      constructor(file: Blob) {
        this.file = file;
      }
      parse() {
        return Promise.resolve({
          package: 'com.example.app',
          label: 'Test App',
          icon: 'data:image/png;base64,mockIconData',
          versionCode: 42,
        });
      }
    },
  };
});

describe('parseApk', () => {
  it('getMaxMemoryBytes returns deviceMemory/4 with fallback to 4GB', () => {
    const result = getMaxMemoryBytes();
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(4 * 1024 * 1024 * 1024);
  });

  it('parseApk returns null when APK exceeds memory limit', async () => {
    const tinyLimit = 100;
    const apkData = new ArrayBuffer(1024);

    const result = await parseApk(apkData, tinyLimit);
    expect(result).toBeNull();
  });

  it('parseApk parses valid APK and returns ParsedApkInfo', async () => {
    const apkData = new ArrayBuffer(2048);

    const result = await parseApk(apkData);

    expect(result).not.toBeNull();
    expect(result!.packageName).toBe('com.example.app');
    expect(result!.label).toBe('Test App');
    expect(result!.iconBase64).toBe('data:image/png;base64,mockIconData');
    expect(result!.versionCode).toBe(42);
  });
});
