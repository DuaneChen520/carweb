import { describe, it, expect } from 'vitest';
import { calculateDpi, SW_TARGET, ANDROID_MDPI_BASELINE } from './display';

function computeSw(w: number, h: number, dpi: number): number {
  return Math.min(w, h) * ANDROID_MDPI_BASELINE / dpi;
}

describe('calculateDpi', () => {
  it('计算标准 800×600 分辨率下的 DPI', () => {
    // dpi = min(800, 600) * 160 / 840 ≈ 114
    const dpi = calculateDpi(800, 600);
    expect(dpi).toBe(114);
  });

  it('所有分辨率下 sw 均接近目标值 (840dp)，量化误差 < 15dp', () => {
    const cases = [
      { w: 1920, h: 1080 },
      { w: 800, h: 600 },
      { w: 400, h: 300 },
      { w: 600, h: 800 },
      { w: 1280, h: 720 },
      { w: 200, h: 150 },
    ];
    for (const { w, h } of cases) {
      const dpi = calculateDpi(w, h);
      const sw = computeSw(w, h, dpi);
      expect(Math.abs(sw - SW_TARGET)).toBeLessThan(15);
    }
  });

  it('所有分辨率下 sw 均 ≥ 600dp（大屏阈值）', () => {
    const cases = [
      { w: 1920, h: 1080 },
      { w: 800, h: 600 },
      { w: 400, h: 300 },
      { w: 600, h: 800 },
      { w: 1280, h: 720 },
      { w: 200, h: 150 },
    ];
    for (const { w, h } of cases) {
      const dpi = calculateDpi(w, h);
      const sw = computeSw(w, h, dpi);
      expect(sw).toBeGreaterThanOrEqual(600);
    }
  });

  it('DPR 翻倍时 sw 变化在量化误差范围内', () => {
    // DPR=1: 800×600 → dpi=114, sw≈842
    const dpi1 = calculateDpi(800, 600);
    const sw1 = computeSw(800, 600, dpi1);

    // DPR=2: 1600×1200 → dpi=229, sw≈838
    const dpi2 = calculateDpi(1600, 1200);
    const sw2 = computeSw(1600, 1200, dpi2);

    // 因 Math.round 量化误差，允许 ±5dp 偏差
    expect(Math.abs(sw1 - sw2)).toBeLessThan(5);
  });
});