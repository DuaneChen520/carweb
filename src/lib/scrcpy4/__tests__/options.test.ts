// src/lib/scrcpy4/__tests__/options.test.ts
import { describe, it, expect } from 'vitest';
import { ScrcpyNewDisplay } from '@yume-chan/scrcpy';
import { AdbScrcpyOptions4_0Tolerant as AdbScrcpyOptions4_0 } from '../options';

describe('AdbScrcpyOptions4_0（v3 车机容错版）', () => {
  it('version 为 4.0（v3 clientOptions?.version 默认）', () => {
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

  it('controlMessageTypes 含 21（ResizeDisplay，v3 数字索引映射）', () => {
    const opts = new AdbScrcpyOptions4_0({ video: true, control: true });
    const types = opts.controlMessageTypes;
    expect(21 in types).toBe(true);
    expect(types[21]).toBe(21);
  });

  it('createMediaStreamTransformer 返回 TransformStream（v3 上游实现）', () => {
    const opts = new AdbScrcpyOptions4_0({ video: true, control: true });
    const ts = opts.createMediaStreamTransformer();
    expect(ts).toHaveProperty('readable');
    expect(ts).toHaveProperty('writable');
    expect(ts.readable instanceof ReadableStream).toBe(true);
    expect(ts.writable instanceof WritableStream).toBe(true);
  });
});

// ── parseAudioStreamMetadata：车机防御性容错（ADR-0015 修复 + 升级 v3 后保留兜底）──
// 官方 scrcpy 4.0 仅上报 OPUS/AAC/FLAC/RAW 四种 4 字节标签；真机环境曾观察到
// 非预期标签（如 0x32333034），v3 原生解析器对未知标签抛错，本容错版回退到
// 协商 audioCodec 而非抛错。
// v3 的 parseAudioStreamMetadata 参数类型是 stream-extra 的 ReadableStream
// （getReader().closed 声明为 Promise<undefined>，与原生流类型不兼容），
// 测试用原生 ReadableStream 构造后断言为 stream-extra 类型。
type SxReadableStream = import('@yume-chan/stream-extra').ReadableStream<Uint8Array>;

function fourByteStream(bytes: number[]): SxReadableStream {
  const buf = new Uint8Array(bytes);
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(buf);
      c.close();
    },
  }) as unknown as SxReadableStream;
}

describe('AdbScrcpyOptions4_0.parseAudioStreamMetadata（容错版）', () => {
  it('未知标签 0x32333034 容错回退到协商 audioCodec=opus（不抛错）', async () => {
    const opts = new AdbScrcpyOptions4_0({
      video: true,
      audio: true,
      control: true,
      sendStreamMeta: true,
      audioCodec: 'opus',
    });
    const meta = await opts.parseAudioStreamMetadata(
      fourByteStream([0x32, 0x33, 0x30, 0x34]),
    );
    expect(meta.type).toBe('success');
    if (meta.type === 'success') {
      expect(meta.codec.webCodecId).toBe('opus');
    }
  });

  it('标准 opus 标签 0x6f707573 直接识别', async () => {
    const opts = new AdbScrcpyOptions4_0({
      video: true,
      audio: true,
      control: true,
      sendStreamMeta: true,
    });
    const meta = await opts.parseAudioStreamMetadata(
      fourByteStream([0x6f, 0x70, 0x75, 0x73]),
    );
    expect(meta.type).toBe('success');
    if (meta.type === 'success') {
      expect(meta.codec.webCodecId).toBe('opus');
    }
  });

  it('disabled(0x00000000) 透传 disabled', async () => {
    const opts = new AdbScrcpyOptions4_0({
      video: true,
      audio: true,
      control: true,
      sendStreamMeta: true,
    });
    const meta = await opts.parseAudioStreamMetadata(fourByteStream([0, 0, 0, 0]));
    expect(meta.type).toBe('disabled');
  });

  it('errored(0x00000001) 透传 errored', async () => {
    const opts = new AdbScrcpyOptions4_0({
      video: true,
      audio: true,
      control: true,
      sendStreamMeta: true,
    });
    const meta = await opts.parseAudioStreamMetadata(fourByteStream([0, 0, 0, 1]));
    expect(meta.type).toBe('errored');
  });

  it('sendStreamMeta=false 时把 4 字节作为音频数据回推，按协商 codec=aac 推断', async () => {
    const opts = new AdbScrcpyOptions4_0({
      video: true,
      audio: true,
      control: true,
      sendStreamMeta: false,
      audioCodec: 'aac',
    });
    const meta = await opts.parseAudioStreamMetadata(
      fourByteStream([0x32, 0x33, 0x30, 0x34]),
    );
    expect(meta.type).toBe('success');
    if (meta.type === 'success') {
      // Aac 的 webCodecId 为 mp4a.66（见 @yume-chan ScrcpyAudioCodec）
      expect(meta.codec.webCodecId).toBe('mp4a.66');
    }
  });
});
