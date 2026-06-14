import { describe, it, expect, vi } from 'vitest';
import { parseApk, getMaxMemoryBytes, pickLabel } from './apk-parser';

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

describe('pickLabel', () => {
  describe('zh-CN: prefers Simplified Chinese', () => {
    it('selects Simplified Chinese when available', () => {
      const values = ['WeChat', '微信', '微信'];
      expect(pickLabel(values, 'zh-CN')).toBe('微信');
    });

    it('selects Simplified over Traditional Chinese', () => {
      const values = ['微信', '微信', 'WeChat'];
      expect(pickLabel(values, 'zh-CN')).toBe('微信');
    });

    it('skips Japanese with kana for zh-CN', () => {
      const values = ['YouTube', 'カレンダー'];
      expect(pickLabel(values, 'zh-CN')).toBe('YouTube');
    });

    it('returns CJK when no kana present (kanji-only Japanese indistinguishable from Chinese)', () => {
      const values = ['YouTube', '日本語'];
      expect(pickLabel(values, 'zh-CN')).toBe('日本語');
    });

    it('does NOT select Traditional Chinese for zh-CN', () => {
      const values = ['微信', 'WeChat'];
      expect(pickLabel(values, 'zh-CN')).toBe('微信');
    });
  });

  describe('zh-TW: prefers Traditional Chinese', () => {
    it('selects Traditional Chinese when available', () => {
      const values = ['微信', '微信', 'WeChat'];
      expect(pickLabel(values, 'zh-TW')).toBe('微信');
    });

    it('selects Traditional over Simplified Chinese', () => {
      const values = ['微信', '微信', 'WeChat'];
      expect(pickLabel(values, 'zh-TW')).toBe('微信');
    });
  });

  describe('zh-Hans: same as zh-CN', () => {
    it('selects Simplified Chinese', () => {
      const values = ['微信', '微信'];
      expect(pickLabel(values, 'zh-Hans')).toBe('微信');
    });
  });

  describe('zh-Hant: same as zh-TW', () => {
    it('selects Traditional Chinese', () => {
      const values = ['微信', '微信'];
      expect(pickLabel(values, 'zh-Hant')).toBe('微信');
    });
  });

  describe('English fallback', () => {
    it('returns first value when no Chinese variants exist', () => {
      const values = ['YouTube', 'Calendar'];
      expect(pickLabel(values, 'zh-CN')).toBe('YouTube');
    });

    it('returns null for null input', () => {
      expect(pickLabel(null, 'zh-CN')).toBeNull();
    });

    it('returns null for empty array', () => {
      expect(pickLabel([], 'zh-CN')).toBeNull();
    });

    it('returns single value directly', () => {
      expect(pickLabel(['WeChat'], 'zh-CN')).toBe('WeChat');
    });
  });

  describe('mixed locales', () => {
    it('correctly handles 5 variants', () => {
      const values = ['Calendar', '日历', '日曆', 'カレンダー', '캘린더'];
      expect(pickLabel(values, 'zh-CN')).toBe('日历');
      expect(pickLabel(values, 'zh-TW')).toBe('日曆');
    });
  });
});
