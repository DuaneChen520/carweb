import { describe, it, expect } from 'vitest';
import { resolveAppDisplayName } from '../useAppDisplayName';

describe('resolveAppDisplayName (ADR-0012)', () => {
  it('优先使用真实 label', () => {
    expect(resolveAppDisplayName('微信', 'com.tencent.mm')).toBe('微信');
  });

  it('label 缺失时兜底完整包名（不再用末段缩写）', () => {
    expect(resolveAppDisplayName(undefined, 'com.tencent.mm')).toBe('com.tencent.mm');
    expect(resolveAppDisplayName('', 'com.tencent.mm')).toBe('com.tencent.mm');
  });
});
