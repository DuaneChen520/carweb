/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks require any casts */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAdbCommand } from '../adb-commands';
import { getMediaSession, dispatchMediaKey } from '../media-commands';

/**
 * 构造一个 fake adb：记录传入命令，并按队列返回 stdout。
 * v3 结构：subprocess.shellProtocol.spawn(cmd) 返回「Promise 且带 .wait() 方法」的组合对象
 * （AdbSpawner 类型），wait() 返回带 .toString() 的 LazyPromise（resolve 为 {stdout, stderr, exitCode}）。
 */
function makeWaitable(stdout: string) {
  const lazy: any = Promise.resolve(new Uint8Array(0));
  lazy.toString = () => Promise.resolve({ stdout, stderr: '', exitCode: 0 });
  return lazy;
}

function makeFakeAdb(responses: string[] | (() => string)) {
  const calls: string[] = [];
  const queue = Array.isArray(responses) ? [...responses] : null;
  const resolver = Array.isArray(responses)
    ? () => queue!.shift() ?? ''
    : responses;
  const adb: any = {
    subprocess: {
      shellProtocol: {
        spawn: vi.fn((cmd: string) => {
          calls.push(cmd);
          const p: any = Promise.resolve({});
          p.wait = () => makeWaitable(resolver());
          return p;
        }),
      },
    },
  };
  return { adb, calls };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('getMediaSession', () => {
  it('runs dumpsys media_session and parses playing session', async () => {
    const { adb, calls } = makeFakeAdb([`
Sessions: #1 active
  package=com.app userId=0
  PlaybackState {state=3, position=1000, speed=1.0}
  MediaMetadata {title=歌, artist=家, album=辑, duration=60000}
`]);
    const result = await getMediaSession(adb);
    expect(result).not.toBeNull();
    expect(result!.packageName).toBe('com.app');
    expect(result!.title).toBe('歌');
    expect(result!.state).toBe('playing');
    expect(calls).toContain('dumpsys media_session');
  });

  it('returns null when no active session', async () => {
    const { adb } = makeFakeAdb(['Sessions: #0 active']);
    expect(await getMediaSession(adb)).toBeNull();
  });

  it('returns null when runAdbCommand throws', async () => {
    const adb: any = {
      subprocess: {
        shellProtocol: {
          spawn: vi.fn(async () => {
            throw new Error('adb error');
          }),
        },
      },
    };
    expect(await getMediaSession(adb)).toBeNull();
  });
});

describe('dispatchMediaKey', () => {
  it('uses cmd media_session dispatch as primary path', async () => {
    const { adb, calls } = makeFakeAdb(['']);
    await dispatchMediaKey(adb, 'play-pause');
    expect(calls).toContain('cmd media_session dispatch play-pause');
  });

  it('falls back to keyevent when dispatch throws', async () => {
    // 第一次抛错（dispatch），第二次成功（keyevent）
    let first = true;
    const adb: any = {
      subprocess: {
        shellProtocol: {
          spawn: vi.fn(() => {
            if (first) { first = false; throw new Error('dispatch not available'); }
            const p: any = Promise.resolve({});
            p.wait = () => makeWaitable('');
            return p;
          }),
        },
      },
    };
    await dispatchMediaKey(adb, 'next');
    expect(adb.subprocess.shellProtocol.spawn).toHaveBeenNthCalledWith(1, 'cmd media_session dispatch next');
    expect(adb.subprocess.shellProtocol.spawn).toHaveBeenNthCalledWith(2, 'input keyevent 87');
  });

  it('maps previous to keyevent 88 on fallback', async () => {
    let first = true;
    const adb: any = {
      subprocess: {
        shellProtocol: {
          spawn: vi.fn(() => {
            if (first) { first = false; throw new Error('fail'); }
            const p: any = Promise.resolve({});
            p.wait = () => makeWaitable('');
            return p;
          }),
        },
      },
    };
    await dispatchMediaKey(adb, 'previous');
    expect(adb.subprocess.shellProtocol.spawn).toHaveBeenNthCalledWith(2, 'input keyevent 88');
  });

  it('does not throw when both dispatch and fallback fail', async () => {
    const adb: any = {
      subprocess: {
        shellProtocol: {
          spawn: vi.fn(async () => {
            throw new Error('always fails');
          }),
        },
      },
    };
    await expect(dispatchMediaKey(adb, 'play-pause')).resolves.toBeUndefined();
  });
});

// 确保 runAdbCommand 仍可被独立调用（未被破坏）
describe('runAdbCommand (smoke)', () => {
  it('returns trimmed stdout via shellProtocol path', async () => {
    const { adb } = makeFakeAdb(['  hello  ']);
    expect(await runAdbCommand(adb, 'pwd')).toBe('hello');
  });
});
