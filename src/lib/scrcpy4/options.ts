// src/lib/scrcpy4/options.ts
import { AdbScrcpyOptions3_3_3, type AdbScrcpyClientOptions } from '@yume-chan/adb-scrcpy';
import type { ScrcpyControlMessageType, ScrcpyMediaStreamPacket, ScrcpyVideoStream } from '@yume-chan/scrcpy';
import type { TransformStream } from '@yume-chan/stream-extra';
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
   * 1. 调用父类读取元数据（codec id + 初始尺寸）
   * 2. 手动将剩余字节流通过 4.0 demuxer 解析为 packet 流
   * 3. 返回已解析的 packet 流，避免 pipeThrough 在浏览器中失效
   */
  override async parseVideoStreamMetadata(stream: ReadableStream<Uint8Array>): Promise<ScrcpyVideoStream> {
    const result = await super.parseVideoStreamMetadata(stream);
    const demuxer = createScrcpy4Demuxer();
    const rawReader = result.stream.getReader();
    const demuxerWriter = demuxer.writable.getWriter();

    // 手动从原始字节流读取并写入 demuxer，规避 pipeThrough 的 TransformStream 问题
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
      metadata: result.metadata,
      stream: demuxer.readable as unknown as ReadableStream<ScrcpyMediaStreamPacket>,
    };
  }

  override createMediaStreamTransformer(): TransformStream<Uint8Array, ScrcpyMediaStreamPacket> {
    // 数据已在 parseVideoStreamMetadata 中被解析为 packet 流，
    // 此处用恒等透传（不做任何转换）。
    // 注意：new TransformStream() 是无操作恒等变换，在浏览器中正常工作。
    return new (globalThis as any).TransformStream() as unknown as TransformStream<Uint8Array, ScrcpyMediaStreamPacket>;
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