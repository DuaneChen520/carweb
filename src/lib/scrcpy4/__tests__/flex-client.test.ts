import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FlexDisplayClient } from '../flex-client';

describe('FlexDisplayClient', () => {
  let sendResize: ReturnType<typeof vi.fn>;
  let setCanvasSize: ReturnType<typeof vi.fn>;
  let client: FlexDisplayClient;
  let timers: ReturnType<typeof vi.useFakeTimers>;

  beforeEach(() => {
    timers = vi.useFakeTimers();
    sendResize = vi.fn().mockResolvedValue(undefined);
    setCanvasSize = vi.fn();
    client = new FlexDisplayClient({ sendResize, setCanvasSize, debounceMs: 150 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('初始尺寸已匹配时不发请求', () => {
    client.setInitialDisplaySize(1920, 1080);
    client.onContainerResize(1920, 1080, 1.0, 1);
    vi.advanceTimersByTime(200);
    expect(sendResize).not.toHaveBeenCalled();
  });

  it('防抖期内回到原尺寸时清除旧定时器，不发陈旧请求', () => {
    client.setInitialDisplaySize(1920, 1080);
    // 1) resize 到不同尺寸 → 启动 150ms 防抖
    client.onContainerResize(1280, 720, 1.0, 1);
    // 2) 100ms 后回到原始尺寸 → 应清除旧定时器并跳过
    vi.advanceTimersByTime(100);
    client.onContainerResize(1920, 1080, 1.0, 1);
    // 3) 再等 200ms → 旧定时器已被清除，不应发送任何请求
    vi.advanceTimersByTime(200);
    expect(sendResize).not.toHaveBeenCalled();
  });

  it('尺寸变化时防抖后发送 RESIZE_DISPLAY', () => {
    client.setInitialDisplaySize(1920, 1080);
    client.onContainerResize(1280, 720, 1.0, 1);
    // 防抖期内不发送
    vi.advanceTimersByTime(100);
    expect(sendResize).not.toHaveBeenCalled();
    // 防抖到期后发送
    vi.advanceTimersByTime(60);
    expect(sendResize).toHaveBeenCalledTimes(1);
    expect(sendResize).toHaveBeenCalledWith(1280, 720);
  });

  it('连续多次 resize 只发最后一个（squash）', () => {
    client.setInitialDisplaySize(1920, 1080);
    client.onContainerResize(1800, 1000, 1.0, 1);
    client.onContainerResize(1600, 900, 1.0, 1);
    client.onContainerResize(1280, 720, 1.0, 1);
    vi.advanceTimersByTime(200);
    expect(sendResize).toHaveBeenCalledTimes(1);
    expect(sendResize).toHaveBeenCalledWith(1280, 720);
  });

  it('session 包 clientResized=true 清除 pendingResize', () => {
    client.setInitialDisplaySize(1920, 1080);
    client.onContainerResize(1280, 720, 1.0, 1);
    vi.advanceTimersByTime(200);
    expect(sendResize).toHaveBeenCalledTimes(1);
    // 收到确认
    client.onSessionPacket(1280, 720, true);
    // 再次 resize 同尺寸 → 不应发送（已匹配）
    client.onContainerResize(1280, 720, 1.0, 1);
    vi.advanceTimersByTime(200);
    expect(sendResize).toHaveBeenCalledTimes(1);
  });

  it('session 包 clientResized=false 不清除 pending，并重发', () => {
    client.setInitialDisplaySize(1920, 1080);
    client.onContainerResize(1280, 720, 1.0, 1);
    vi.advanceTimersByTime(200);
    expect(sendResize).toHaveBeenCalledTimes(1);
    // 收到独立变化（非客户端请求），尺寸不同
    client.onSessionPacket(800, 600, false);
    // pending 未清除，应重发
    expect(sendResize).toHaveBeenCalledTimes(2);
    expect(sendResize).toHaveBeenLastCalledWith(1280, 720);
  });

  it('session 包更新 currentDisplaySize', () => {
    client.setInitialDisplaySize(1920, 1080);
    client.onSessionPacket(1000, 800, false);
    // 现在 current 是 1000x800，resize 到 1000x800 不发送
    client.onContainerResize(1000, 800, 1.0, 1);
    vi.advanceTimersByTime(200);
    expect(sendResize).not.toHaveBeenCalled();
  });

  it('onSessionPacket 通知 setCanvasSize 但不设 CSS', () => {
    client.setInitialDisplaySize(1920, 1080);
    client.onSessionPacket(1280, 720, true);
    expect(setCanvasSize).toHaveBeenCalledWith(1280, 720);
  });

  it('onDecoderSizeChanged 调用 setCanvasSize', () => {
    client.onDecoderSizeChanged(1920, 1080);
    expect(setCanvasSize).toHaveBeenCalledWith(1920, 1080);
  });

  it('scale 和 dpr 参与目标尺寸计算', () => {
    client.setInitialDisplaySize(1920, 1080);
    // css 800x600, scale=0.5, dpr=2 → target = 800*0.5*2 x 600*0.5*2 = 800x600
    client.onContainerResize(800, 600, 0.5, 2);
    vi.advanceTimersByTime(200);
    expect(sendResize).toHaveBeenCalledWith(800, 600);
  });

  it('dispose 取消未触发的防抖', () => {
    client.setInitialDisplaySize(1920, 1080);
    client.onContainerResize(1280, 720, 1.0, 1);
    client.dispose();
    vi.advanceTimersByTime(500);
    expect(sendResize).not.toHaveBeenCalled();
  });
});
