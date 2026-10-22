// src/lib/scrcpy4/options.ts
//
// 升级 @yume-chan 到 v3.0.0-beta.1 后：
// - v3 的 AdbScrcpyOptions4_0 原生支持 scrcpy 4.0/4.1 server 协议（PR #854），
//   serialize()/parseVideoStreamMetadata()/createMediaStreamTransformer()/controlMessageTypes
//   等全部由上游基类实现，不再需要逐方法 override。
// - v3 的 Init 已含 flexDisplay/keepActive/sendStreamMeta 等 4.0 字段；
//   sendCodecMeta 在 4_0 中已移除（Omit<PrevImpl.Init, "sendCodecMeta">）。
// - 音频 buffer 透传（audioBufferMs/audioOutputBufferMs）经官方 v4.0 源码核实为
//   无效透传（桌面 client 本地播放缓冲参数，server 不识别），已删除。
//
// 唯一保留的私有逻辑：parseAudioStreamMetadata 对未知音频 codec 标签的容错兜底。
// v3 原生 parseAudioMetadataCodec 对未知标签抛 "Unknown audio codec metadata value"
// （2_3/impl/parse-audio-stream-metadata.ts），真机环境可能因 OEM 预装其它 scrcpy
// 进程/旧 server 残留/并发会话干扰出现非预期标签（历史观察 0x32333034），
// 此处重写为：标准 4 种 codec 正常解析；未知标签回退到协商 audioCodec、不抛错。

import {
  AdbScrcpyOptions4_0,
  type AdbScrcpyClientOptions,
} from '@yume-chan/adb-scrcpy';
import type { ScrcpyAudioStreamMetadata } from '@yume-chan/scrcpy';
import { ScrcpyAudioCodec } from '@yume-chan/scrcpy';
import { getUint32BigEndian } from '@yume-chan/no-data-view';
import type { ReadableStream } from '@yume-chan/stream-extra';
import { BufferedReadableStream, PushReadableStream } from '@yume-chan/stream-extra';

/**
 * 音频编解码器回退值。
 *
 * 标准 scrcpy（含官方 4.0，见 scrcpy AudioCodec.java）只上报 OPUS/AAC/FLAC/RAW 四种，
 * 元数据值分别为 0x6f707573 / 0x00616163 / 0x666c6163 / 0x00726177。
 * 真机环境曾观察到非标准标签（如 0x32333034，其 ASCII 为 "3204"，非任何 codec 名，
 * 官方 server 不可能发出），@yume-chan v3 原生解析器不认识 → 抛错，
 * 导致专用音频采集连接（ADR-0015）启动失败。
 *
 * parseAudioStreamMetadata 已重写（见下）：未知标签回退到本值，正常消费 4 字节
 * 元数据、不抛错。默认 opus（scrcpy 默认编码）。若设备实际用 AAC，
 * 把本常量改为 "aac" 即可（会同时作为 --audio-codec 请求发给 server）。
 */
export const AUDIO_CODEC_FALLBACK: 'opus' | 'aac' | 'flac' | 'raw' = 'opus';

/**
 * 扩展后的 Options Init 类型：
 * 在官方 AdbScrcpyOptions4_0.Init 基础上，允许 audioDup 传入 boolean 或 string
 * （如 'all' 或 'game,voice-communication' 等自定义 usages）。
 */
export type Scrcpy4Init = Omit<AdbScrcpyOptions4_0.Init, 'audioDup'> & {
  audioDup?: boolean | string | undefined;
};

/**
 * 车机容错版 AdbScrcpyOptions4_0。
 *
 * 继承 v3 官方 AdbScrcpyOptions4_0（原生支持 scrcpy 4.0/4.1），
 * 仅 override 一项：parseAudioStreamMetadata 的未知 codec 标签容错（防御性兜底）。
 *
 * 语义对齐 v3 4_0：用 this.value.sendStreamMeta 控制是否读 codec 元数据
 * （4_0 的 Init 已移除 sendCodecMeta）。sendStreamMeta=true（默认）时读 4 字节
 * codec 标签 → 标准匹配 / 未知回退；sendStreamMeta=false 时按协商 codec 推断，
 * 并把前 4 字节回推到流（它们是真实音频数据）。
 */
export class AdbScrcpyOptions4_0Tolerant<
  TInit extends Scrcpy4Init = Scrcpy4Init,
> extends AdbScrcpyOptions4_0<AdbScrcpyOptions4_0.Init> {
  constructor(init: TInit, clientOptions?: AdbScrcpyClientOptions) {
    super(init as unknown as AdbScrcpyOptions4_0.Init, clientOptions);
  }

  override async parseAudioStreamMetadata(
    stream: ReadableStream<Uint8Array>,
  ): Promise<ScrcpyAudioStreamMetadata> {
    const buffered = new BufferedReadableStream(stream as unknown as import('@yume-chan/stream-extra').ReadableStream<Uint8Array>);
    const buffer = await buffered.readExactly(4);
    const codecMetadataValue = getUint32BigEndian(buffer, 0);

    // 0x00000000 / 0x00000001 仍为 disabled / errored（标准语义，原样透传）
    if (codecMetadataValue === 0x00_00_00_00) return { type: 'disabled' };
    if (codecMetadataValue === 0x00_00_00_01) return { type: 'errored' };

    const fallback = audioCodecFromOption(this.value.audioCodec ?? AUDIO_CODEC_FALLBACK);
    const sendStreamMeta = this.value.sendStreamMeta ?? true;

    if (sendStreamMeta) {
      // 先匹配标准编解码器（覆盖绝大多数标准 server）
      switch (codecMetadataValue) {
        case ScrcpyAudioCodec.Raw.metadataValue:
          return { type: 'success', codec: ScrcpyAudioCodec.Raw, stream: buffered.release() };
        case ScrcpyAudioCodec.Opus.metadataValue:
          return { type: 'success', codec: ScrcpyAudioCodec.Opus, stream: buffered.release() };
        case ScrcpyAudioCodec.Aac.metadataValue:
          return { type: 'success', codec: ScrcpyAudioCodec.Aac, stream: buffered.release() };
        case ScrcpyAudioCodec.Flac.metadataValue:
          return { type: 'success', codec: ScrcpyAudioCodec.Flac, stream: buffered.release() };
        default:
          // 容错兜底：未知标签回退到协商 codec，4 字节元数据照常消费，不抛错。
          console.warn(
            `[AdbScrcpyOptions4_0] 未知音频编解码器标签 0x${codecMetadataValue.toString(16)}, 回退到协商 audioCodec=${fallback.optionValue}`,
          );
          return { type: 'success', codec: fallback, stream: buffered.release() };
      }
    }

    // sendStreamMeta=false：4 字节是真实音频数据，回推到流，按协商 codec 推断。
    return {
      type: 'success',
      codec: fallback,
      stream: new PushReadableStream<Uint8Array>(async (controller) => {
        await controller.enqueue(buffer);
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
}

/** 把协商的 audioCodec 选项字符串映射为 ScrcpyAudioCodec（默认 opus）。 */
function audioCodecFromOption(c: string): ScrcpyAudioCodec {
  switch (c) {
    case 'raw':
      return ScrcpyAudioCodec.Raw;
    case 'aac':
      return ScrcpyAudioCodec.Aac;
    case 'flac':
      return ScrcpyAudioCodec.Flac;
    case 'opus':
    default:
      return ScrcpyAudioCodec.Opus;
  }
}
