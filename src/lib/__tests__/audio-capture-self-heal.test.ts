import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSessionManager } from '@/lib/session-manager';
import { useAdbStore } from '@/hooks/useAdbStore';

// 捕获每次 new ScrcpySession 的回调（重点是 onAudioDecodeError），
// 以便测试专用音频连接在 opus 解码失败时是否自动改用 aac 重试（ADR-0016 自愈）。
interface CreatedSession {
  id: string;
  onAudioDecodeError?: (sid: string) => void;
  start: ReturnType<typeof vi.fn>;
}
const created: CreatedSession[] = [];

vi.mock('@/lib/scrcpy-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/scrcpy-session')>();
  class MockScrcpySession {
    id: string;
    start = vi.fn(async () => {});
    stop = vi.fn(async () => {});
    constructor(id: string, callbacks: Record<string, unknown>) {
      this.id = id;
      created.push({
        id,
        onAudioDecodeError: callbacks.onAudioDecodeError as
          | ((sid: string) => void)
          | undefined,
        start: this.start,
      });
    }
  }
  return { ...actual, ScrcpySession: MockScrcpySession };
});

beforeEach(() => {
  created.length = 0;
  useSessionManager.setState({
    sessions: {},
    apps: [],
    paneLeft: null,
    paneRight: null,
    fullscreenSessionId: null,
    audioCaptureSessionId: null,
    audioCaptureCodec: null,
    audioCaptureRetried: false,
    adb: {} as never,
    allocatedDisplayIds: new Set(),
    _persistCallback: null,
  });
  useAdbStore.setState({ connectionStatus: 'connected', adb: {} as never });
});

// 等 fire-and-forget 的微任务（_ensureAudioCapture 内部 void 调用）排空
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('专用音频采集连接 codec 自愈（ADR-0016）', () => {
  it('opus 解码失败时自动改用 aac 重试一次', async () => {
    await useSessionManager.getState()._ensureAudioCapture({} as never, 'opus');
    expect(created.length).toBe(1);

    const first = created[0];
    // 首次请求 opus
    expect(first.start.mock.calls[0][4]).toMatchObject({
      audioOnly: true,
      audioCodecOverride: 'opus',
    });

    // 模拟 worker 上报「opus 解码失败」
    first.onAudioDecodeError?.(first.id);
    await flush();

    // 应自动改用 aac 重试，且只新建一个 session
    expect(created.length).toBe(2);
    const second = created[1];
    expect(second.start.mock.calls[0][4]).toMatchObject({
      audioOnly: true,
      audioCodecOverride: 'aac',
    });
  });

  it('aac 仍失败时不再无限重试', async () => {
    await useSessionManager.getState()._ensureAudioCapture({} as never, 'opus');
    const first = created[0];
    first.onAudioDecodeError?.(first.id);
    await flush();

    const second = created[1];

    // 第二个 session（aac）也报错
    second.onAudioDecodeError?.(second.id);
    await flush();

    // 不应再新建第三个 session（无更多回退）
    expect(created.length).toBe(2);
  });
});
