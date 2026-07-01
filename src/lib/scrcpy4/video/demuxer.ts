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
 * 注意：Node.js v24 原生 TransformStream 存在 writer.write() 永不 resolve 的 bug，
 * 因此这里手动将 ReadableStream 与 WritableStream 串联，替代 TransformStream 构造函数。
 */

/** 4.0 PTS 位域常量（3.x 分别是 1n<<63 / 1n<<62 / 62-bit PTS）。 */
const PTS_SESSION = 1n << 63n;   // MSB，会话包标志
const PTS_CONFIG = 1n << 62n;    // configuration 包（SPS/PPS）
const PTS_KEYFRAME = 1n << 61n;  // keyframe 标志
const PTS_MASK = (1n << 61n) - 1n; // 61-bit PTS 掩码

export type Scrcpy4MediaPacket =
  | { type: 'configuration'; data: Uint8Array }
  | { type: 'data'; keyframe: boolean; pts: bigint; data: Uint8Array }
  | { type: 'session'; width: number; height: number; clientResized: boolean };

/**
 * 创建 4.0 视频流解复用 TransformStream。
 * 输入原始字节流，输出 Scrcpy4MediaPacket（含 session 类型）。
 */
export function createScrcpy4Demuxer(): TransformStream<Uint8Array, Scrcpy4MediaPacket> {
  let buffer = new Uint8Array(0);
  let readableController!: ReadableStreamDefaultController<Scrcpy4MediaPacket>;

  const flush = (controller: ReadableStreamDefaultController<Scrcpy4MediaPacket>): void => {
    while (buffer.byteLength >= 12) {
      const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const firstByte = dv.getUint8(0);
      const isSession = (firstByte & 0x80) !== 0;

      if (isSession) {
        // 会话包：固定 12 字节
        const width = dv.getUint32(4, false);
        const height = dv.getUint32(8, false);
        const clientResized = (dv.getUint8(3) & 0x01) !== 0;
        controller.enqueue({ type: 'session', width, height, clientResized });
        buffer = buffer.slice(12);
        continue;
      }

      // 媒体包：12 字节头
      const pts = dv.getBigUint64(0, false);
      const size = dv.getUint32(8, false);
      const totalLen = 12 + size;
      if (buffer.byteLength < totalLen) break; // payload 未到齐，等更多数据

      const data = buffer.slice(12, totalLen);

      if ((pts & PTS_CONFIG) !== 0n) {
        controller.enqueue({ type: 'configuration', data });
      } else {
        const keyframe = (pts & PTS_KEYFRAME) !== 0n;
        const realPts = pts & PTS_MASK;
        controller.enqueue({ type: 'data', keyframe, pts: realPts, data });
      }
      buffer = buffer.slice(totalLen);
    }
  };

  const readable = new ReadableStream<Scrcpy4MediaPacket>({
    start(controller) {
      readableController = controller;
    },
  });

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      if (chunk.byteLength === 0) return;
      // 追加到 buffer
      const merged = new Uint8Array(buffer.byteLength + chunk.byteLength);
      merged.set(buffer, 0);
      merged.set(chunk, buffer.byteLength);
      buffer = merged;
      flush(readableController);
    },
    close() {
      readableController.close();
    },
  });

  return { readable, writable };
}
