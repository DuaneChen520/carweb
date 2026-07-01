// src/lib/scrcpy4/__tests__/options.test.ts
import { describe, it, expect } from 'vitest';
import { ScrcpyNewDisplay } from '@yume-chan/scrcpy';
import { AdbScrcpyOptions4_0, RESIZE_DISPLAY_TYPE } from '../options';

describe('AdbScrcpyOptions4_0', () => {
  it('version 为 4.0', () => {
    const opts = new AdbScrcpyOptions4_0({
      video: true,
      audio: true,
      control: true,
    });
    expect(opts.version).toBe('4.0');
  });

  it('flexDisplay=true 时 serialize 含 flex_display=true', () => {
    const opts = new AdbScrcpyOptions4_0({
      video: true,
      audio: true,
      control: true,
      newDisplay: new ScrcpyNewDisplay(1920, 1080, 320),
      flexDisplay: true,
    });
    const args = opts.serialize();
    expect(args).toContain('flex_display=true');
  });

  it('flexDisplay 未设置时不输出 flex_display', () => {
    const opts = new AdbScrcpyOptions4_0({
      video: true,
      audio: true,
      control: true,
    });
    const args = opts.serialize();
    expect(args.some(a => a.startsWith('flex_display'))).toBe(false);
  });

  it('keepActive=true 时 serialize 含 keep_active=true', () => {
    const opts = new AdbScrcpyOptions4_0({
      video: true,
      control: true,
      keepActive: true,
    });
    expect(opts.serialize()).toContain('keep_active=true');
  });

  it('controlMessageTypes 含 ResizeDisplay（值为 18，在末尾）', () => {
    const opts = new AdbScrcpyOptions4_0({ video: true, control: true });
    const types = opts.controlMessageTypes;
    expect(types[types.length - 1]).toBe(RESIZE_DISPLAY_TYPE);
    expect(types.indexOf(RESIZE_DISPLAY_TYPE)).toBe(18);
  });

  it('createMediaStreamTransformer 返回 TransformStream', () => {
    const opts = new AdbScrcpyOptions4_0({ video: true, control: true });
    const ts = opts.createMediaStreamTransformer();
    // 注意：demuxer 为避开 Node.js v24 TransformStream bug 而手动拼装 { readable, writable }，
    // 因此不是 TransformStream 实例，而是结构兼容的鸭子类型对象。
    expect(ts).toHaveProperty('readable');
    expect(ts).toHaveProperty('writable');
    expect(ts.readable instanceof ReadableStream).toBe(true);
    expect(ts.writable instanceof WritableStream).toBe(true);
  });
});
