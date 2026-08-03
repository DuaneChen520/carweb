// src/lib/scrcpy4/options.ts
import { AdbScrcpyOptions3_3_3, type AdbScrcpyClientOptions } from '@yume-chan/adb-scrcpy';
import type { ScrcpyControlMessageType, ScrcpyMediaStreamPacket, ScrcpyVideoStream } from '@yume-chan/scrcpy';
import { ScrcpyAudioCodec, ScrcpyAudioStreamMetadata, ScrcpyVideoCodecId } from '@yume-chan/scrcpy';
import { getUint32BigEndian } from '@yume-chan/no-data-view';
import { BufferedReadableStream, PushReadableStream, TransformStream } from '@yume-chan/stream-extra';
import { decodeUtf8 } from '@yume-chan/struct';
import { createScrcpy4Demuxer } from './video/demuxer';

/**
 * scrcpy 4.0 新增的 RESIZE_DISPLAY 控制消息类型。
 * @yume-chan/scrcpy 2.x 的 ScrcpyControlMessageType 枚举只到 17（ResetVideo），
 * 4.0 在末尾追加了 CAMERA_SET_TORCH(18) / CAMERA_ZOOM_IN(19) / CAMERA_ZOOM_OUT(20)，
 * RESIZE_DISPLAY 为 21（经 scrcpy v4.0 源码 ControlMessage.java 确认）。
 */
export const RESIZE_DISPLAY_TYPE = 21 as ScrcpyControlMessageType;

/**
 * 音频编解码器回退值（车机定制 scrcpy server 兼容）。
 *
 * 标准 scrcpy（含官方 4.0，见 scrcpy AudioCodec.java）只上报 OPUS/AAC/FLAC/RAW 四种，
 * 元数据值分别为 0x6f707573 / 0x00616163 / 0x666c6163 / 0x00726177。
 * 本项目车机定制 server（public/scrcpy-server.jar）却上报 0x32333034（四者皆非），
 * @yume-chan/scrcpy 2.3.0 的 parseAudioStreamMetadata 不认识 → 抛
 * "Unknown audio codec metadata value"，导致专用音频采集连接（ADR-0015）启动失败。
 *
 * parseAudioStreamMetadata 已重写：未知标签回退到本值，正常消费 4 字节元数据、不抛错。
 * 默认 opus（scrcpy 默认编码）。若设备实际用 AAC，把本常量改为 "aac" 即可
 * （会同时作为 --audio-codec 请求发给 server）。
 */
export const AUDIO_CODEC_FALLBACK: "opus" | "aac" | "flac" | "raw" = "opus";

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
    // S2-P0-2：服务端音频缓冲透传（车机抖动场景调大；定制 server 不识别则需真机验证后关闭）
    if (value.audioBufferMs) args.push(`audio_buffer=${value.audioBufferMs}`);
    if (value.audioOutputBufferMs) args.push(`audio_output_buffer=${value.audioOutputBufferMs}`);
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

  /**
   * 覆盖 parseAudioStreamMetadata：
   *
   * 标准 4 种 codec（OPUS/AAC/FLAC/RAW）走原逻辑；未知标签（车机定制 server
   * 上报的 0x32333034 等）容错回退到 AUDIO_CODEC_FALLBACK，正常消费 4 字节
   * 元数据、不抛错，使专用音频采集连接（ADR-0015）得以启动。
   *
   * 依据：scrcpy 官方 4.0 AudioCodec.java 仅定义上述 4 种，而本项目定制
   * scrcpy-server.jar 上报私有标签，@yume-chan/scrcpy 2.3.0 不认识即抛错。
   */
  override async parseAudioStreamMetadata(
    stream: ReadableStream<Uint8Array>,
  ): Promise<ScrcpyAudioStreamMetadata> {
    const buffered = new BufferedReadableStream(
      stream as unknown as import('@yume-chan/stream-extra').ReadableStream<Uint8Array>,
    );
    const buffer = await buffered.readExactly(4);

    // [DEBUG-a3f2] 诊断：dump 音频流前 32 字节，定位定制 server 实际发送的格式
    let debugExtra: Uint8Array | null = null;
    try {
      debugExtra = await buffered.readExactly(28);
    } catch { /* 流数据不足 28 字节，正常——仅 dump 已有部分 */ }
    const debugAll = debugExtra
      ? new Uint8Array([...buffer, ...debugExtra])
      : buffer;
    const hexStr = Array.from(debugAll).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asciiStr = Array.from(debugAll).map(b => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.').join('');
    console.log(`[DEBUG-a3f2] 音频流前 ${debugAll.length} 字节 | hex: ${hexStr} | ascii: "${asciiStr}"`);

    // 辅助：将 debugExtra 回推到 released stream 前，避免丢失数据
    const releaseWithExtra = (): any => {
      const remaining = buffered.release();
      if (!debugExtra || debugExtra.byteLength === 0) return remaining;
      return new PushReadableStream<Uint8Array>(async (controller) => {
        await controller.enqueue(debugExtra!);
        const reader = remaining.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await controller.enqueue(value);
        }
      }) as unknown as typeof remaining;
    };

    const codecMetadataValue = getUint32BigEndian(buffer, 0);

    // 0x00000000 / 0x00000001 仍为 disabled / errored（标准语义，原样透传）
    if (codecMetadataValue === 0x00_00_00_00) return { type: "disabled" };
    if (codecMetadataValue === 0x00_00_00_01) return { type: "errored" };

    const value = this.value as Required<AdbScrcpyOptions4_0.Init<TVideo>>;
    const fallback = audioCodecFromOption(value.audioCodec ?? AUDIO_CODEC_FALLBACK);
    const sendCodecMeta = value.sendCodecMeta ?? true;

    if (sendCodecMeta) {
      // 先匹配标准编解码器（覆盖绝大多数标准 server）
      switch (codecMetadataValue) {
        case ScrcpyAudioCodec.Raw.metadataValue:
          return { type: "success", codec: ScrcpyAudioCodec.Raw, stream: releaseWithExtra() };
        case ScrcpyAudioCodec.Opus.metadataValue:
          return { type: "success", codec: ScrcpyAudioCodec.Opus, stream: releaseWithExtra() };
        case ScrcpyAudioCodec.Aac.metadataValue:
          return { type: "success", codec: ScrcpyAudioCodec.Aac, stream: releaseWithExtra() };
        case ScrcpyAudioCodec.Flac.metadataValue:
          return { type: "success", codec: ScrcpyAudioCodec.Flac, stream: releaseWithExtra() };
        default:
          // 定制 server 私有标签：回退到协商 codec，4 字节元数据照常消费，不抛错。
          console.warn(
            `[AdbScrcpyOptions4_0] 未知音频编解码器标签 0x${codecMetadataValue
              .toString(16)}, 回退到协商 audioCodec=${fallback.optionValue}（设备定制 scrcpy server）`,
          );
          return { type: "success", codec: fallback, stream: releaseWithExtra() };
      }
    }

    // sendCodecMeta=false：4 字节是真实音频数据，回推到流，按协商 codec 推断。
    return {
      type: "success",
      codec: fallback,
      stream: new PushReadableStream<Uint8Array>(async (controller) => {
        await controller.enqueue(buffer);
        if (debugExtra) await controller.enqueue(debugExtra);
        const s = buffered.release();
        const reader = s.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await controller.enqueue(value);
        }
      }),
    };
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

/** 把协商的 audioCodec 选项字符串映射为 ScrcpyAudioCodec（默认 opus）。 */
function audioCodecFromOption(c: string): ScrcpyAudioCodec {
  switch (c) {
    case "raw":
      return ScrcpyAudioCodec.Raw;
    case "aac":
      return ScrcpyAudioCodec.Aac;
    case "flac":
      return ScrcpyAudioCodec.Flac;
    case "opus":
    default:
      return ScrcpyAudioCodec.Opus;
  }
}

export namespace AdbScrcpyOptions4_0 {
  export type Init<TVideo extends boolean = boolean> = AdbScrcpyOptions3_3_3.Init<TVideo> & {
    /** 启用 flex display，虚拟屏可运行时 resize。需配合 newDisplay。 */
    flexDisplay?: boolean;
    /** --keep-active，防止虚拟屏息屏。 */
    keepActive?: boolean;
    /**
     * 服务端音频缓冲（`--audio-buffer`，毫秒）。官方 scrcpy 默认 50ms；
     * 车机 WebUSB 抖动场景调大（如 150ms）可显著降低卡顿。
     * 注意：车机定制 server 若不识别该参数会忽略/报错，需真机验证（S2-P0-2）。
     */
    audioBufferMs?: number;
    /**
     * 服务端音频输出缓冲（`--audio-output-buffer`，毫秒）。官方默认 10ms；
     * 仅在出现机械音/破音时调整。默认不传。
     */
    audioOutputBufferMs?: number;
  };
}