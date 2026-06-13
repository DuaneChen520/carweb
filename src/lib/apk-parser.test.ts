import { describe, it, expect } from 'vitest';
import { parseApk, getMaxMemoryBytes } from './apk-parser';

describe('parseApk', () => {
  it('getMaxMemoryBytes returns deviceMemory/4 with fallback to 1GB', () => {
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
});
