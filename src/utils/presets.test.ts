import { describe, it, expect } from 'vitest';
import { RESOLUTION_PRESETS } from '@/hooks/scrcpy/useScrcpySession';

describe('RESOLUTION_PRESETS', () => {
  it('各预设不包含 dpiMultiplier 字段', () => {
    for (const preset of RESOLUTION_PRESETS) {
      expect(preset).not.toHaveProperty('dpiMultiplier');
    }
  });
});