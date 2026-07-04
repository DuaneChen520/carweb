import { describe, it, expect } from 'vitest';
import { serializeResizeDisplay } from '../control/resize-display';

describe('serializeResizeDisplay', () => {
  it('序列化为 5 字节，大端', () => {
    // typeByte=21 (scrcpy 4.0 TYPE_RESIZE_DISPLAY), width=1920, height=1080
    const buf = serializeResizeDisplay(21, 1920, 1080);
    expect(buf).toHaveLength(5);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(dv.getUint8(0)).toBe(21);
    expect(dv.getUint16(1, false)).toBe(1920); // false = big-endian
    expect(dv.getUint16(3, false)).toBe(1080);
  });

  it('小尺寸正确编码', () => {
    const buf = serializeResizeDisplay(21, 1280, 960);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(dv.getUint16(1, false)).toBe(1280);
    expect(dv.getUint16(3, false)).toBe(960);
  });

  it('width=0 height=0 边界值', () => {
    const buf = serializeResizeDisplay(0, 0, 0);
    expect(buf).toHaveLength(5);
    expect(buf.every(b => b === 0)).toBe(true);
  });
});
