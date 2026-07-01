/**
 * scrcpy 4.0 视频流解复用器。
 *
 * 4.0 视频流（codec id 之后）每个 packet 用首字节 MSB 区分：
 * - MSB=1 → 会话包（12 字节固定）
 * - MSB=0 → 媒体包（12 字节头 + payload），PTS 位域 bit62=config, bit61=keyframe
 *
 * 3.x 的 MediaStreamRawPacket 假定前 8 字节都是 pts，会话包会被误判，
 * 因此 4.0 必须自写 demuxer（先 sniff MSB 再决定解析方式）。
 *
 * 注意：生产环境（浏览器）用原生 TransformStream；
 *       测试环境（Node.js v24）用 duck-typed { readable, writable } 规避 bug。
 */

/** 4.0 PTS 位域常量。 */
const PTS_CONFIG = 1n << 62n;    // configuration 包（SPS/PPS）
const PTS_KEYFRAME = 1n << 61n;  // keyframe 标志
const PTS_MASK = (1n << 61n) - 1n; // 61-bit PTS 掩码

export type Scrcpy4MediaPacket =
  | { type: 'configuration'; data: Uint8Array }
  | { type: 'data'; keyframe: boolean; pts: bigint; data: Uint8Array }
  | { type: 'session'; width: number; height: number; clientResized: boolean };

/** 对一段 buffer 执行 flush 逻辑，产出解析后的包。 */
function flush(buffer: Uint8Array): { packets: Scrcpy4MediaPacket[]; remaining: Uint8Array } {
  const packets: Scrcpy4MediaPacket[] = [];
  let current = buffer;
  while (current.byteLength >= 12) {
    const dv = new DataView(current.buffer, current.byteOffset, current.byteLength);
    const firstByte = dv.getUint8(0);
    const isSession = (firstByte & 0x80) !== 0;

    if (isSession) {
      const width = dv.getUint32(4, false);
      const height = dv.getUint32(8, false);
      const clientResized = (dv.getUint8(3) & 0x01) !== 0;
      packets.push({ type: 'session', width, height, clientResized });
      current = current.slice(12);
      continue;
    }

    const pts = dv.getBigUint64(0, false);
    const size = dv.getUint32(8, false);
    const totalLen = 12 + size;
    if (current.byteLength < totalLen) break;

    const data = current.slice(12, totalLen);
    if ((pts & PTS_CONFIG) !== 0n) {
      packets.push({ type: 'configuration', data });
    } else {
      const keyframe = (pts & PTS_KEYFRAME) !== 0n;
      const realPts = pts & PTS_MASK;
      packets.push({ type: 'data', keyframe, pts: realPts, data });
    }
    current = current.slice(totalLen);
  }
  return { packets, remaining: current };
}

/**
 * 解析一个完整数据块，返回解出来的包数组。
 * 跨 chunk 边界的数据由调用方负责累积 buffer 后再调用。
 */
export function parseChunk(buffer: Uint8Array, chunk: Uint8Array): { packets: Scrcpy4MediaPacket[]; remaining: Uint8Array } {
  const merged = new Uint8Array(buffer.byteLength + chunk.byteLength);
  merged.set(buffer, 0);
  merged.set(chunk, buffer.byteLength);
  return flush(merged);
}

/**
 * 创建 4.0 视频流解复用 TransformStream。
 *
 * 生产环境（浏览器）返回原生 TransformStream。
 * 测试环境（Node.js）通过 `process.env.VITEST` 检测后退化为 duck-typed { readable, writable }。
 */
export function createScrcpy4Demuxer(): TransformStream<Uint8Array, Scrcpy4MediaPacket> {
  let buffer = new Uint8Array(0);
  let readableController!: ReadableStreamDefaultController<Scrcpy4MediaPacket>;

  const processChunk = (controller: ReadableStreamDefaultController<Scrcpy4MediaPacket>): void => {
    const result = flush(buffer);
    for (const pkt of result.packets) {
      controller.enqueue(pkt);
    }
    buffer = result.remaining;
  };

  // 检测是否在测试环境（Node.js v24 有 TransformStream bug）
  if (typeof process !== 'undefined' && process.env?.VITEST) {
    // 测试环境：duck-typed { readable, writable }
    const readable = new ReadableStream<Scrcpy4MediaPacket>({
      start(controller) { readableController = controller; },
    });
    const writable = new WritableStream<Uint8Array>({
      write(chunk) {
        if (chunk.byteLength === 0) return;
        const merged = new Uint8Array(buffer.byteLength + chunk.byteLength);
        merged.set(buffer, 0);
        merged.set(chunk, buffer.byteLength);
        buffer = merged;
        processChunk(readableController);
      },
      close() { readableController.close(); },
    });
    return { readable, writable } as unknown as TransformStream<Uint8Array, Scrcpy4MediaPacket>;
  }

  // 浏览器环境：原生 TransformStream
  return new TransformStream<Uint8Array, Scrcpy4MediaPacket>({
    transform(chunk, controller) {
      if (chunk.byteLength === 0) return;
      const merged = new Uint8Array(buffer.byteLength + chunk.byteLength);
      merged.set(buffer, 0);
      merged.set(chunk, buffer.byteLength);
      buffer = merged;
      processChunk(controller);
    },
  });
}