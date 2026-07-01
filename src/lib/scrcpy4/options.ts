// src/lib/scrcpy4/options.ts
import { AdbScrcpyOptions3_3_3, type AdbScrcpyClientOptions } from '@yume-chan/adb-scrcpy';
import type { ScrcpyControlMessageType, ScrcpyMediaStreamPacket, ScrcpyVideoStream } from '@yume-chan/scrcpy';
import { ScrcpyVideoCodecId } from '@yume-chan/scrcpy';
import { BufferedReadableStream, TransformStream } from '@yume-chan/stream-extra';
import { decodeUtf8 } from '@yume-chan/struct';
import { createScrcpy4Demuxer } from './video/demuxer';

/**
 * scrcpy 4.0 新增的 RESIZE_DISPLAY 控制消息类型。
 * @yume-chan/scrcpy 2.x 的 ScrcpyControlMessageType 枚举只到 17（ResetVideo），
 * 4.0 在末尾追加 RESIZE_DISPLAY，线上字节值 = 18。
 */
export const RESIZE_DISPLAY_TYPE = 18 as ScrcpyControlMessageType;

/**
 * scrcpy 4.0 ADB 选项。
 *
 * 继承 AdbScrcpyOptions3_3_3 复用全部 adb 层能力（createConnection 等）
 * 与 3.x 协议层（parseVideoStreamMetadata 等），仅 override 4.0 变化的成员：
 * version、controlMessageTypes、serialize、parseVideoStreamMetadata、
 * createMediaStreamTransformer。
 */
export class AdbScrcpyOptions4_0<TVideo extends boolean> extends AdbScrcpyOptions3_3_3<TVideo> {
  constructor(init: AdbScrcpyOptions4_0.Init<TVideo>, clientOptions?: AdbScrcpyClientOptions) {
    super(init as AdbScrcpyOptions3_3_3.Init<TVideo>, clientOptions);
    Object.defineProperty(this, 'version', {
      get: () => '4.0',
      configurable: true,
      enumerable: true,
    });
  }

  override get controlMessageTypes(): readonly ScrcpyControlMessageType[] {
    return [...super.controlMessageTypes, RESIZE_DISPLAY_TYPE];
  }

  override serialize(): string[] {
    const args = super.serialize();
    const value = this.value as AdbScrcpyOptions4_0.Init<TVideo>;
    if (value.flexDisplay) args.push('flex_display=true');
    if (value.keepActive) args.push('keep_active=true');
    return args;
  }

  /**
   * 覆盖 parseVideoStreamMetadata：
   *
   * 官方 scrcpy 服务器的视频流元数据格式为：
   *   若 sendDeviceMeta:  64 字节设备名（null-terminated）
   *   若 sendStreamMeta:   4 字节 codec ID（int32 BE）
   *   ─────────────────────────────────
   *   合计最多 68 字节
   *
   * 实测服务器**不**在视频流中发送 width/height（它们通过 session packet 传递）。
   * 但 @yume-chan/scrcpy 的 ScrcpyOptions2_0.parseVideoStreamMetadata 会多读 8 字节
   * （readU32 width + readU32 height），把实际视频数据的前 8 字节吃掉，
   * 导致 demuxer 从错误位置开始解析，产生零长度的空数据包。
   *
   * 此处自行解析元数据，不多读字节。
   */
  override async parseVideoStreamMetadata(stream: ReadableStream<Uint8Array>): Promise<ScrcpyVideoStream> {
    const ADB_BUFFERED = new BufferedReadableStream(stream as unknown as import('@yume-chan/stream-extra').ReadableStream<Uint8Array>);
    const value = this.value as Required<AdbScrcpyOptions4_0.Init<TVideo>>;

    // ── 1. 读取设备名（64 字节，null-terminated）────────────────────
    let deviceName: string | undefined;
    if (value.sendDeviceMeta) {
      const raw = await ADB_BUFFERED.readExactly(64);
      const nullIdx = raw.indexOf(0);
      deviceName = decodeUtf8(nullIdx >= 0 ? raw.subarray(0, nullIdx) : raw);
    }

    // ── 2. 读取 codec ID（4 字节 int32 BE）并可选的宽度和高度─────
    let codec: ScrcpyVideoCodecId = ScrcpyVideoCodecId.H264;
    let width: number | undefined;
    let height: number | undefined;
    if (value.sendCodecMeta) {
      // 读取 12 字节：codec(4) + width(4) + height(4)
      // 但服务器只发送 codec ID（4 字节），不发送 width/height！
      // width/height 通过 session packet 或 ADB 连接的其他通道获取
      const codecRaw = await ADB_BUFFERED.readExactly(4);
      codec = new DataView(codecRaw.buffer, codecRaw.byteOffset).getUint32(0, false) as unknown as ScrcpyVideoCodecId;

      // 尝试读取后续 8 字节（width + height），如果存在则解析
      // 但现代 scrcpy 服务器（含官方 4.0）**不发送**这 8 字节，
      // 所以不要在这里读取，以免吃掉视频数据
    }

    const rawStream = ADB_BUFFERED.release();
    const demuxer = createScrcpy4Demuxer();
    const rawReader = rawStream.getReader();
    const demuxerWriter = demuxer.writable.getWriter();

    // 手动泵送原始字节到 demuxer，规避 pipeThrough 的 TransformStream 问题
    (async () => {
      try {
        while (true) {
          const { done, value } = await rawReader.read();
          if (done) { await demuxerWriter.close(); break; }
          await demuxerWriter.write(value);
        }
      } catch (e) {
        // 流关闭时忽略错误
      }
    })();

    return {
      metadata: { deviceName, codec, width, height } as any,
      stream: demuxer.readable as unknown as ReadableStream<ScrcpyMediaStreamPacket>,
    } as unknown as ScrcpyVideoStream;
  }

  override createMediaStreamTransformer(): TransformStream<Uint8Array, ScrcpyMediaStreamPacket> {
    // 4.0 的 parseVideoStreamMetadata 已将原始字节解析为包对象（Scrcpy4MediaPacket），
    // 此处用显式恒等透传，避免原生 new TransformStream() 的可能问题，
    // 同时确保类型安全——输入的包对象直接作为输出。
    // 注意：输出流实际承载 Scrcpy4MediaPacket（含 'session' 类型），
    // 调用方（useVideoDecoder.ts）会先过滤 'session' 再写解码器。
    return new TransformStream<Uint8Array, ScrcpyMediaStreamPacket>({
      transform(chunk, controller) {
        controller.enqueue(chunk as unknown as ScrcpyMediaStreamPacket);
      },
    }) as unknown as TransformStream<Uint8Array, ScrcpyMediaStreamPacket>;
  }
}

export namespace AdbScrcpyOptions4_0 {
  export type Init<TVideo extends boolean = boolean> = AdbScrcpyOptions3_3_3.Init<TVideo> & {
    /** 启用 flex display，虚拟屏可运行时 resize。需配合 newDisplay。 */
    flexDisplay?: boolean;
    /** --keep-active，防止虚拟屏息屏。 */
    keepActive?: boolean;
  };
}