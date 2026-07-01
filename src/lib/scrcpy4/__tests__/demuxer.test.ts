// src/lib/scrcpy4/__tests__/demuxer.test.ts
import { describe, it, expect } from 'vitest';
import { createScrcpy4Demuxer, type Scrcpy4MediaPacket } from '../video/demuxer';

/** 把多个 Uint8Array 喂入 transform，收集所有输出 packet。 */
async function runDemuxer(chunks: Uint8Array[]): Promise<Scrcpy4MediaPacket[]> {
  const transform = createScrcpy4Demuxer();
  const reader = transform.readable.getReader();
  const writer = transform.writable.getWriter();
  for (const chunk of chunks) {
    await writer.write(chunk);
  }
  await writer.close();
  const packets: Scrcpy4MediaPacket[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    packets.push(value);
  }
  return packets;
}

/** 构造一个会话包（12 字节，MSB=1）。 */
function makeSessionPacket(width: number, height: number, clientResized: boolean): Uint8Array {
  const buf = new Uint8Array(12);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, 0x80); // MSB=1 标识会话包
  if (clientResized) dv.setUint8(3, 0x01); // byte3 LSB = clientResized
  dv.setUint32(4, width, false);  // BE
  dv.setUint32(8, height, false);
  return buf;
}

/** 构造一个媒体包（12 字节头 + payload）。pts 字段位域：bit62=config, bit61=keyframe。 */
function makeMediaPacket(pts: bigint, data: Uint8Array, isConfig = false, isKeyframe = false): Uint8Array {
  const buf = new Uint8Array(12 + data.length);
  const dv = new DataView(buf.buffer);
  let ptsField = pts;
  if (isConfig) ptsField |= (1n << 62n);
  if (isKeyframe) ptsField |= (1n << 61n);
  dv.setBigUint64(0, ptsField, false); // BE，bit63=0 媒体包
  dv.setUint32(8, data.length, false);
  buf.set(data, 12);
  return buf;
}

describe('createScrcpy4Demuxer', () => {
  it('解析会话包（MSB=1，12 字节）', async () => {
    const packets = await runDemuxer([makeSessionPacket(1920, 1080, true)]);
    expect(packets).toHaveLength(1);
    expect(packets[0]).toEqual({
      type: 'session',
      width: 1920,
      height: 1080,
      clientResized: true,
    });
  });

  it('会话包 clientResized=false', async () => {
    const packets = await runDemuxer([makeSessionPacket(800, 600, false)]);
    expect(packets[0]).toMatchObject({ type: 'session', clientResized: false });
  });

  it('解析 configuration 包（bit62=1）', async () => {
    const sps = new Uint8Array([0x67, 0x42, 0x00, 0x1e]);
    const packets = await runDemuxer([makeMediaPacket(0n, sps, true, false)]);
    expect(packets).toHaveLength(1);
    expect(packets[0]).toEqual({ type: 'configuration', data: sps });
  });

  it('解析 keyframe data 包（bit61=1）', async () => {
    const frame = new Uint8Array([1, 2, 3]);
    const packets = await runDemuxer([makeMediaPacket(5000n, frame, false, true)]);
    expect(packets).toHaveLength(1);
    expect(packets[0]).toEqual({
      type: 'data',
      keyframe: true,
      pts: 5000n,
      data: frame,
    });
  });

  it('解析普通 data 包', async () => {
    const frame = new Uint8Array([9, 8, 7]);
    const packets = await runDemuxer([makeMediaPacket(999n, frame, false, false)]);
    expect(packets[0]).toEqual({
      type: 'data',
      keyframe: false,
      pts: 999n,
      data: frame,
    });
  });

  it('混合序列按序输出', async () => {
    const chunks = [
      makeSessionPacket(1920, 1080, true),
      makeMediaPacket(0n, new Uint8Array([0x67]), true, false),      // config
      makeMediaPacket(100n, new Uint8Array([1]), false, true),       // keyframe
      makeSessionPacket(1280, 720, false),                            // 独立 resize
      makeMediaPacket(200n, new Uint8Array([2]), false, false),      // data
    ];
    const packets = await runDemuxer(chunks);
    expect(packets).toHaveLength(5);
    expect(packets.map(p => p.type)).toEqual([
      'session', 'configuration', 'data', 'session', 'data',
    ]);
  });

  it('跨 chunk 边界拼接', async () => {
    const whole = makeMediaPacket(42n, new Uint8Array([5, 6]), false, false);
    // 把 14 字节的包拆成两个 chunk
    const chunks = [whole.slice(0, 5), whole.slice(5)];
    const packets = await runDemuxer(chunks);
    expect(packets).toHaveLength(1);
    expect(packets[0]).toMatchObject({ type: 'data', pts: 42n });
  });

  it('空输入不报错', async () => {
    const packets = await runDemuxer([new Uint8Array(0)]);
    expect(packets).toHaveLength(0);
  });
});
