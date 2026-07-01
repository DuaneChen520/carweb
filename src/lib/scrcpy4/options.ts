// src/lib/scrcpy4/options.ts
import { AdbScrcpyOptions3_3_3, type AdbScrcpyClientOptions } from '@yume-chan/adb-scrcpy';
import type { ScrcpyControlMessageType, ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy';
import { TransformStream } from '@yume-chan/stream-extra';

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
 * 与 3.x 协议层（parseVideoStreamMetadata 等），仅 override 4.0 变化的 4 个成员：
 * version、controlMessageTypes、serialize、createMediaStreamTransformer。
 */
export class AdbScrcpyOptions4_0<TVideo extends boolean> extends AdbScrcpyOptions3_3_3<TVideo> {
  constructor(init: AdbScrcpyOptions4_0.Init<TVideo>, clientOptions?: AdbScrcpyClientOptions) {
    super(init as AdbScrcpyOptions3_3_3.Init<TVideo>, clientOptions);
    // 父类的 version 是 readonly 字段，子类无法用 getter 覆盖，
    // 因此通过 defineProperty 替换为固定值 '4.0'
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

  override createMediaStreamTransformer(): TransformStream<Uint8Array, ScrcpyMediaStreamPacket> {
    // 恒等 TransformStream：直接将原始字节透传（不做解析），
    // 避免自定义 transformer 在 pipeThrough 中数据丢失。
    // 解析工作由 useVideoDecoder 的 pump 循环用 parseChunk 手动完成。
    return new TransformStream<Uint8Array, ScrcpyMediaStreamPacket>();
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
