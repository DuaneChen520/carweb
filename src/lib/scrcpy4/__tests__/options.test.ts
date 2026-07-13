// src/lib/scrcpy4/__tests__/options.test.ts
import { describe, it, expect } from 'vitest';
import { ScrcpyNewDisplay } from '@yume-chan/scrcpy';
import { AdbScrcpyOptions4_0, RESIZE_DISPLAY_TYPE } from '../options';

describe('AdbScrcpyOptions4_0', () => {
  it('version 为 4.0', () => {
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

  it('controlMessageTypes 末尾为 ResizeDisplay', () => {
    const opts = new AdbScrcpyOptions4_0({ video: true, control: true });
    const types = opts.controlMessageTypes;
    expect(types[types.length - 1]).toBe(RESIZE_DISPLAY_TYPE);
    expect(types.indexOf(RESIZE_DISPLAY_TYPE)).toBe(18);
  });

  it('createMediaStreamTransformer 返回 TransformStream', () => {
    const opts = new AdbScrcpyOptions4_0({ video: true, control: true });
    const ts = opts.createMediaStreamTransformer();
    // 注意：demuxer 为避开 Node.js v24 TransformStream bug 而手动拼装 { readable, writable }，
    // 因此不是 TransformStream 实例，而是结构兼容的鸭子类型对象。
    expect(ts).toHaveProperty('readable');
    expect(ts).toHaveProperty('writable');
    expect(ts.readable instanceof ReadableStream).toBe(true);
    expect(ts.writable instanceof WritableStream).toBe(true);
  });
});

// ── parseAudioStreamMetadata：车机定制 scrcpy server 兼容（ADR-0015 修复）──
// 标准 scrcpy 4.0 仅上报 OPUS/AAC/FLAC/RAW 四种 4 字节标签；本项目定制
// scrcpy-server.jar 上报私有标签 0x32333034，需容错回退而非抛错。
function fourByteStream(bytes: number[]): ReadableStream<Uint8Array> {
  const buf = new Uint8Array(bytes);
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(buf);
      c.close();
    },
  });
}

describe('AdbScrcpyOptions4_0.parseAudioStreamMetadata', () => {
  it('未知标签 0x32333034 容错回退到协商 audioCodec=opus（不抛错）', async () => {
    const opts = new AdbScrcpyOptions4_0({
      video: true,
      audio: true,
      control: true,
      sendCodecMeta: true,
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
      sendCodecMeta: true,
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
      sendCodecMeta: true,
    });
    const meta = await opts.parseAudioStreamMetadata(fourByteStream([0, 0, 0, 0]));
    expect(meta.type).toBe('disabled');
  });

  it('errored(0x00000001) 透传 errored', async () => {
    const opts = new AdbScrcpyOptions4_0({
      video: true,
      audio: true,
      control: true,
      sendCodecMeta: true,
    });
    const meta = await opts.parseAudioStreamMetadata(fourByteStream([0, 0, 0, 1]));
    expect(meta.type).toBe('errored');
  });

  it('sendCodecMeta=false 时把 4 字节作为音频数据回推，按协商 codec=aac 推断', async () => {
    const opts = new AdbScrcpyOptions4_0({
      video: true,
      audio: true,
      control: true,
      sendCodecMeta: false,
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
