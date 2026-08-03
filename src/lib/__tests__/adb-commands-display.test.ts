import { describe, it, expect } from 'vitest';
import { pickLatestScrcpyDisplay, type ScrcpyDisplayInfo } from '@/lib/adb-commands';

function disp(id: number, opts: Partial<ScrcpyDisplayInfo> = {}): ScrcpyDisplayInfo {
  return { id, ownContent: false, touchVirtual: false, isPrivate: false, uniqueId: `scrcpy-${id}`, ...opts };
}

describe('pickLatestScrcpyDisplay（S2-P0-7 回归：多屏共存时取最新创建的屏）', () => {
  it('多屏共存（keepActive 旧屏 + 新屏都 hasOwnContent）时取 id 最大的新屏', () => {
    // 旧屏 D1（id 小）+ 新屏 D2（id 大）→ 必须选 D2，否则 resume 会 attach 到旧屏
    const result = pickLatestScrcpyDisplay([
      disp(100, { ownContent: true }),
      disp(103, { ownContent: true }),
    ]);
    expect(result).toBe(103);
  });

  it('单屏时返回该屏', () => {
    expect(pickLatestScrcpyDisplay([disp(100, { ownContent: true })])).toBe(100);
  });

  it('空列表返回 null', () => {
    expect(pickLatestScrcpyDisplay([])).toBeNull();
  });

  it('无 ownContent 时回退 touchVirtual（仍取最新）', () => {
    const result = pickLatestScrcpyDisplay([
      disp(100, { touchVirtual: true }),
      disp(101, { ownContent: true }),
      disp(102, { touchVirtual: true }),
    ]);
    // ownContent 优先且取 id 最大 → 101
    expect(result).toBe(101);
  });

  it('全部 private 时取 id 最大', () => {
    const result = pickLatestScrcpyDisplay([
      disp(200, { isPrivate: true }),
      disp(201, { isPrivate: true }),
    ]);
    expect(result).toBe(201);
  });

  it('id 乱序输入仍按 id 降序选取（不依赖 dumpsys 输出顺序）', () => {
    const result = pickLatestScrcpyDisplay([
      disp(300, { ownContent: true }),
      disp(298, { ownContent: true }),
      disp(299, { ownContent: true }),
    ]);
    expect(result).toBe(300);
  });
});
