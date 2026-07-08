import { describe, it, expect } from 'vitest';
import { AdbScrcpyOptions4_0 } from '@/lib/scrcpy4';
import { ScrcpyNewDisplay, ScrcpyCaptureOrientation } from '@yume-chan/scrcpy';

/**
 * T1 验证：虚拟屏分支注入 vdSystemDecorations:false 后，
 * 序列化必须产出 `vd_system_decorations=false`（scrcpy --no-vd-system-decorations），
 * 使虚拟屏只渲染 app、不渲染 Launcher/系统 UI，从根上消除「新屏首帧是桌面」这一跳。
 *
 * 该测试不依赖真实设备，直接验证 options 层的序列化语义。
 */

function baseOptions() {
  return {
    video: true,
    videoCodec: 'h264' as const,
    videoBitRate: 8000000,
    maxFps: 60,
    audio: true,
    control: true,
    stayAwake: true,
    showTouches: false,
  };
}

function buildVirtualDisplayOptions() {
  return new AdbScrcpyOptions4_0({
    ...baseOptions(),
    newDisplay: new ScrcpyNewDisplay(1080, 1920, 320),
    captureOrientation: ScrcpyCaptureOrientation.Unlocked,
    displayImePolicy: 'local' as const,
    flexDisplay: true,
    keepActive: true,
    vdSystemDecorations: false,
  });
}

function buildPhysicalDisplayOptions() {
  return new AdbScrcpyOptions4_0({
    ...baseOptions(),
    displayId: 0,
  });
}

describe('AdbScrcpyOptions4_0 — T1 vdSystemDecorations', () => {
  it('虚拟屏分支序列化包含 vd_system_decorations=false', () => {
    const serialized = buildVirtualDisplayOptions().serialize();
    expect(serialized).toContain('vd_system_decorations=false');
  });

  it('虚拟屏分支同时保留 new_display / flex_display / keep_active', () => {
    const serialized = buildVirtualDisplayOptions().serialize();
    expect(serialized.some((s) => s.startsWith('new_display='))).toBe(true);
    expect(serialized).toContain('flex_display=true');
    expect(serialized).toContain('keep_active=true');
  });

  it('物理屏分支不包含 vd_system_decorations（作用域不被误扩）', () => {
    const serialized = buildPhysicalDisplayOptions().serialize();
    expect(serialized).not.toContain('vd_system_decorations=false');
    // 物理屏未设置该选项 → 回退默认 true → serialize 跳过（不出现在参数中）
    expect(serialized.some((s) => s.startsWith('vd_system_decorations'))).toBe(false);
  });
});
