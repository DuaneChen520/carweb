# CarWeb 车机桌面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 CarWeb 新增一个由网页承载的车机桌面，连上手机后作为入口层，提供音乐控制卡片 + 分页应用图标网格，点击应用经启动过渡动画进入虚拟屏。

**Architecture:** 在 `App.tsx` 现有连接状态机之上叠加 `view: 'desktop' | 'launching' | 'screen'` 视图态。桌面是新增的 React 组件层，复用现有应用数据层（`useAppManager` / `device-apps-store`）和应用启动能力（`startAppOnDisplay`）。新增 `useMediaSession` hook 通过 `dumpsys media_session` 读取播放信息并轮询，通过 `cmd media_session dispatch` 控制。启动过渡用模糊背景 + 居中图标填充 scrcpy 首帧前的等待。

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind CSS + Zustand + ya-webadb + Vitest（含 `fake-indexeddb`）

## Global Constraints

- 项目非 git 仓库（根目录无 `.git`），提交步骤用 `git` 命令前需先 `git init`；若用户不要求提交，可跳过 commit 步骤只保留文件改动。
- 现有测试运行命令：`npm test`（等价 `vitest run`）。
- 类型检查命令：`npm run check`（等价 `tsc -b --noEmit`）。
- 样式用 Tailwind CSS（项目已配置），不引入新 UI 库。
- 已有的 `runAdbCommand(adb, command)` 是所有 ADB shell 命令的统一入口，位于 `src/lib/adb-commands.ts`。
- 已有的 `useAppManager`（经 `useScrcpyContext` 暴露）提供：`getAllDeviceApps()`、`getAppIcon(pkg)`、`getCachedAppLabels(pkgs)`、`togglePin(pkg)`、`incrementLocalCount(pkg)`、`parseAllApps()`、`syncWithDevice()`。
- 已有的 `sortApps(allPkgs, pinned, counts)`（位于 `src/lib/app-sorter.ts`）实现三段排序，桌面网格应复用。
- 测试文件放在 `src/lib/__tests__/`，沿用 `app-sorter.test.ts` 的风格。
- 对话一律用中文（AGENTS.md 规则）。

---

## File Structure

### 新增文件

- `src/lib/media-session-parser.ts` — `dumpsys media_session` 输出解析纯函数（无 ADB 依赖，便于单测）
- `src/lib/__tests__/media-session-parser.test.ts` — 解析器单测，含多份 fixture
- `src/lib/app-pagination.ts` — 应用列表分页切片纯函数
- `src/lib/__tests__/app-pagination.test.ts` — 分页切片单测
- `src/components/AppIcon.tsx` — 从 `ControlSidebar` 抽取的独立应用图标组件
- `src/components/NowPlayingCard.tsx` — 音乐播放卡片
- `src/components/AppGrid.tsx` — 分页应用图标网格（scroll-snap）
- `src/components/DesktopView.tsx` — 桌面容器（组合卡片 + 网格）
- `src/components/AppLaunchingOverlay.tsx` — 启动过渡层（模糊背景 + 居中图标）
- `src/hooks/useMediaSession.ts` — 媒体会话轮询与控制 hook
- `src/lib/__tests__/adb-media-commands.test.ts` — `getMediaSession`/`dispatchMediaKey` 的 mock 测试

### 修改文件

- `src/lib/adb-commands.ts` — 新增 `getMediaSession` / `dispatchMediaKey` / `MediaInfo`
- `src/hooks/scrcpy/useVideoDecoder.ts` — `setupVideoStream` 增加 `onFirstFrame` 回调参数
- `src/hooks/scrcpy/useScrcpySession.ts` — `startScrcpy` 透传 `onFirstFrame`；新增 `firstFrameReady` state
- `src/components/VirtualScreen.tsx` — 接 `onFirstFrame`；新增 `active` 已有的渲染控制已足够（不渲染即不启动）
- `src/components/ControlSidebar.tsx` — 移除内联 `AppIcon`，改 import；Home 按钮接 `onHome`
- `src/App.tsx` — 新增 `view` 状态机，串起 DesktopView / AppLaunchingOverlay / VirtualScreen

---

## Task 1: MediaSession 解析器（纯函数 + 单测）

**Files:**
- Create: `src/lib/media-session-parser.ts`
- Test: `src/lib/__tests__/media-session-parser.test.ts`

**Interfaces:**
- Produces: `parseMediaSessionOutput(output: string): MediaInfo | null`，其中 `MediaInfo` 定义在本文件导出：
  ```ts
  export interface MediaInfo {
    packageName: string;
    title: string;
    artist: string;
    album: string;
    duration: number;   // ms
    position: number;   // ms
    state: 'playing' | 'paused' | 'other';
  }
  ```

- [ ] **Step 1: Write the failing test**

创建 `src/lib/__tests__/media-session-parser.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseMediaSessionOutput, type MediaInfo } from '../media-session-parser';

// 完整播放中 session
const PLAYING_OUTPUT = `
MediaSessionService (dump)

Sessions: #1 active
  package=com.netease.cloudmusic userId=0
  tag=CloudMusic
  PlaybackState {state=3, position=145320, buffered position=145320,
                 speed=1.0, updated=..., actions=..., error code=0}
  MediaMetadata {title=晴天, artist=周杰伦, album=叶惠美,
                 duration=269000, track number=5}
`;

// 暂停状态
const PAUSED_OUTPUT = `
MediaSessionService (dump)

Sessions: #1 active
  package=com.spotify.music userId=0
  tag=Spotify
  PlaybackState {state=2, position=30000, buffered position=30000, speed=0.0}
  MediaMetadata {title="Hotel California", artist="Eagles", album="Hell Freezes Over", duration=390000}
`;

// 多 session 并存
const MULTI_SESSION_OUTPUT = `
MediaSessionService (dump)

Sessions: #2 active
  package=com.android.systemui userId=0
  PlaybackState {state=1, position=0, buffered position=0, speed=0.0}

  package=com.netease.cloudmusic userId=0
  PlaybackState {state=3, position=10000, buffered position=10000, speed=1.0}
  MediaMetadata {title=七里香, artist=周杰伦, album=七里香, duration=299000}
`;

// metadata 部分缺失（无 album）
const PARTIAL_METADATA = `
Sessions: #1 active
  package=com.example.player userId=0
  PlaybackState {state=3, position=0, buffered position=0, speed=1.0}
  MediaMetadata {title=Some Song, artist=Some Artist, duration=180000}
`;

// 字段顺序与引号变体
const VARIANT_ORDER = `
Sessions: #1 active
  package=com.app.music userId=0
  MediaMetadata {duration=200000, title="带引号的歌", artist="A & B", album="精选"}
  PlaybackState {state=2, position=5000, speed=0.0}
`;

// 无活跃 session
const NO_SESSION = `
MediaSessionService (dump)

Sessions: #0 active
`;

describe('parseMediaSessionOutput', () => {
  it('parses playing session with unquoted values', () => {
    const result = parseMediaSessionOutput(PLAYING_OUTPUT);
    expect(result).toEqual<MediaInfo>({
      packageName: 'com.netease.cloudmusic',
      title: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      duration: 269000,
      position: 145320,
      state: 'playing',
    });
  });

  it('parses paused session with quoted values', () => {
    const result = parseMediaSessionOutput(PAUSED_OUTPUT);
    expect(result).toEqual<MediaInfo>({
      packageName: 'com.spotify.music',
      title: 'Hotel California',
      artist: 'Eagles',
      album: 'Hell Freezes Over',
      duration: 390000,
      position: 30000,
      state: 'paused',
    });
  });

  it('returns first session with MediaMetadata among multiple', () => {
    const result = parseMediaSessionOutput(MULTI_SESSION_OUTPUT);
    expect(result).not.toBeNull();
    expect(result!.packageName).toBe('com.netease.cloudmusic');
    expect(result!.title).toBe('七里香');
  });

  it('handles missing album as empty string', () => {
    const result = parseMediaSessionOutput(PARTIAL_METADATA);
    expect(result).toEqual<MediaInfo>({
      packageName: 'com.example.player',
      title: 'Some Song',
      artist: 'Some Artist',
      album: '',
      duration: 180000,
      position: 0,
      state: 'playing',
    });
  });

  it('parses regardless of field order and quoted strings', () => {
    const result = parseMediaSessionOutput(VARIANT_ORDER);
    expect(result).toEqual<MediaInfo>({
      packageName: 'com.app.music',
      title: '带引号的歌',
      artist: 'A & B',
      album: '精选',
      duration: 200000,
      position: 5000,
      state: 'paused',
    });
  });

  it('returns null when no active session', () => {
    expect(parseMediaSessionOutput(NO_SESSION)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseMediaSessionOutput('')).toBeNull();
  });

  it('returns null when session has no MediaMetadata block', () => {
    const onlyPlayback = `
Sessions: #1 active
  package=com.no.meta userId=0
  PlaybackState {state=3, position=100, speed=1.0}
`;
    expect(parseMediaSessionOutput(onlyPlayback)).toBeNull();
  });

  it('treats state=4 (fast-forward) as other', () => {
    const ff = `
Sessions: #1 active
  package=com.app userId=0
  PlaybackState {state=4, position=100, speed=2.0}
  MediaMetadata {title=X, artist=Y, album=Z, duration=1000}
`;
    const result = parseMediaSessionOutput(ff);
    expect(result!.state).toBe('other');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/__tests__/media-session-parser.test.ts`
Expected: FAIL（模块不存在，导入报错）

- [ ] **Step 3: Write minimal implementation**

创建 `src/lib/media-session-parser.ts`：

```ts
export interface MediaInfo {
  packageName: string;
  title: string;
  artist: string;
  album: string;
  duration: number;   // ms
  position: number;   // ms
  state: 'playing' | 'paused' | 'other';
}

/**
 * 解析 `dumpsys media_session` 输出，返回第一个带 MediaMetadata 的活跃 session。
 *
 * 解析策略（基于可行性调研，不依赖行号/字段顺序）：
 * 1. 按 `package=` 行切分 session 块
 * 2. 取第一个同时含 MediaMetadata{} 的块
 * 3. 块内用宽松正则提取字段
 *
 * 字符串值可能带引号也可能不带，统一去引号。缺失字段置空串/0。
 * state: 3=playing, 2=paused, 其余归 other。
 */
export function parseMediaSessionOutput(output: string): MediaInfo | null {
  if (!output || output.trim().length === 0) return null;

  // 按 package= 切块（每块含该 session 的 PlaybackState + MediaMetadata）
  // 先找到所有 package 行的位置
  const packagePattern = /package=([^\s]+)/g;
  const matches: Array<{ pkg: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = packagePattern.exec(output)) !== null) {
    matches.push({ pkg: m[1]!, index: m.index });
  }

  if (matches.length === 0) return null;

  // 为每个 session 切出文本块（到下一个 package 行或结尾）
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i]!.index;
    const end = i + 1 < matches.length ? matches[i + 1]!.index : output.length;
    const block = output.slice(start, end);

    // 必须含 MediaMetadata 才算可用的播放 session
    if (!/MediaMetadata\s*\{/.test(block)) continue;

    const title = extractString(block, 'title');
    // 即使 title 为空也接受（有些 app 不上报 title），但必须有 packageName
    const state = extractState(block);
    const duration = extractNumber(block, 'duration');
    const position = extractNumber(block, 'position');

    return {
      packageName: matches[i]!.pkg,
      title,
      artist: extractString(block, 'artist'),
      album: extractString(block, 'album'),
      duration,
      position,
      state,
    };
  }

  return null;
}

/** 提取字符串字段，支持带引号和不带引号两种格式：title=晴天 或 title="晴天" */
function extractString(block: string, key: string): string {
  // 先尝试带引号：key="value"
  const quoted = new RegExp(`${key}="([^"]*)"`);
  const qm = block.match(quoted);
  if (qm) return qm[1]!;

  // 再尝试不带引号：key=value（值到逗号、空格或 } 结束）
  const unquoted = new RegExp(`${key}=([^,}\\s]+)`);
  const um = block.match(unquoted);
  if (um) return um[1]!;
  return '';
}

function extractNumber(block: string, key: string): number {
  const re = new RegExp(`${key}=(\\d+)`);
  const mm = block.match(re);
  return mm ? parseInt(mm[1]!, 10) : 0;
}

function extractState(block: string): MediaInfo['state'] {
  const m = block.match(/state=(\d+)/);
  if (!m) return 'other';
  const code = parseInt(m[1]!, 10);
  if (code === 3) return 'playing';
  if (code === 2) return 'paused';
  return 'other';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/__tests__/media-session-parser.test.ts`
Expected: PASS（全部 9 个用例）

- [ ] **Step 5: Type check**

Run: `npm run check`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add src/lib/media-session-parser.ts src/lib/__tests__/media-session-parser.test.ts
git commit -m "feat: 添加 MediaSession dumpsys 解析器"
```

---

## Task 2: 应用分页切片（纯函数 + 单测）

**Files:**
- Create: `src/lib/app-pagination.ts`
- Test: `src/lib/__tests__/app-pagination.test.ts`

**Interfaces:**
- Consumes: 一个已排序（置顶>常用>其他）的扁平包名数组（由 Task 7 的 DesktopView 用 `sortApps` 产出后传入）
- Produces: `paginateApps(sortedPackages: string[], perPage: number): string[][]` —— 把扁平数组切成每页 `perPage` 个的二维数组；空输入返回 `[]`（0 页）

- [ ] **Step 1: Write the failing test**

创建 `src/lib/__tests__/app-pagination.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { paginateApps } from '../app-pagination';

describe('paginateApps', () => {
  it('returns empty array for empty input', () => {
    expect(paginateApps([], 12)).toEqual([]);
  });

  it('returns single page when items fit', () => {
    const apps = ['a', 'b', 'c'];
    expect(paginateApps(apps, 12)).toEqual([['a', 'b', 'c']]);
  });

  it('splits into multiple pages exactly at boundary', () => {
    const apps = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(paginateApps(apps, 3)).toEqual([['a', 'b', 'c'], ['d', 'e', 'f']]);
  });

  it('last page is partial when not divisible', () => {
    const apps = ['a', 'b', 'c', 'd', 'e'];
    expect(paginateApps(apps, 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('preserves input order across pages', () => {
    const apps = Array.from({ length: 25 }, (_, i) => `app${i}`);
    const pages = paginateApps(apps, 12);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toHaveLength(12);
    expect(pages[1]).toHaveLength(12);
    expect(pages[2]).toHaveLength(1);
    // 第一页第一个是 app0，最后一页唯一一个是 app24
    expect(pages[0]![0]).toBe('app0');
    expect(pages[2]![0]).toBe('app24');
  });

  it('handles perPage of 1', () => {
    expect(paginateApps(['x', 'y'], 1)).toEqual([['x'], ['y']]);
  });

  it('returns empty array when perPage <= 0', () => {
    expect(paginateApps(['a', 'b'], 0)).toEqual([]);
    expect(paginateApps(['a', 'b'], -1)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/__tests__/app-pagination.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

创建 `src/lib/app-pagination.ts`：

```ts
/**
 * 把已排序的应用包名数组切成每页 perPage 个的二维数组。
 * 用于桌面分页网格。空输入或非法 perPage 返回 []。
 *
 * 切片是简单的顺序等分（不跨页移动应用），应用排序由调用方在上游用
 * sortApps 完成后传入。第一页因含音乐卡片，容量是否扣除由 UI 层决定，
 * 本函数只做纯切片。
 */
export function paginateApps(sortedPackages: string[], perPage: number): string[][] {
  if (!sortedPackages || sortedPackages.length === 0) return [];
  if (!perPage || perPage <= 0) return [];

  const pages: string[][] = [];
  for (let i = 0; i < sortedPackages.length; i += perPage) {
    pages.push(sortedPackages.slice(i, i + perPage));
  }
  return pages;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/__tests__/app-pagination.test.ts`
Expected: PASS（全部 7 个用例）

- [ ] **Step 5: Type check**

Run: `npm run check`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add src/lib/app-pagination.ts src/lib/__tests__/app-pagination.test.ts
git commit -m "feat: 添加应用列表分页切片工具"
```

---

## Task 3: ADB Media 命令封装（mock 单测）

**Files:**
- Modify: `src/lib/adb-commands.ts`（在文件末尾追加）
- Test: `src/lib/__tests__/adb-media-commands.test.ts`

**Interfaces:**
- Consumes: `runAdbCommand(adb, command)`（同文件已有）；`parseMediaSessionOutput`（Task 1）
- Produces:
  ```ts
  export async function getMediaSession(adb: Adb): Promise<MediaInfo | null>
  export async function dispatchMediaKey(
    adb: Adb,
    action: 'play-pause' | 'next' | 'previous'
  ): Promise<void>
  ```
  （`MediaInfo` 从 `media-session-parser.ts` re-export 或直接 import）

- [ ] **Step 1: Write the failing test**

创建 `src/lib/__tests__/adb-media-commands.test.ts`。采用 mock `runAdbCommand` 的方式（vi.mock 整个 adb-commands 模块中 `runAdbCommand` 的实现）：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock runAdbCommand；保留其它真实导出
vi.mock('../adb-commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../adb-commands')>();
  return {
    ...actual,
    runAdbCommand: vi.fn(),
  };
});

import { runAdbCommand, getMediaSession, dispatchMediaKey } from '../adb-commands';

// Adb 桩——getMediaSession/dispatchMediaKey 只用到 runAdbCommand，adb 实例本身不直接用
const fakeAdb = {} as any;

beforeEach(() => {
  vi.mocked(runAdbCommand).mockReset();
});

describe('getMediaSession', () => {
  it('returns parsed MediaInfo when dumpsys has playing session', async () => {
    vi.mocked(runAdbCommand).mockResolvedValueOnce(`
Sessions: #1 active
  package=com.app userId=0
  PlaybackState {state=3, position=1000, speed=1.0}
  MediaMetadata {title=歌, artist=家, album=辑, duration=60000}
`);
    const result = await getMediaSession(fakeAdb);
    expect(result).not.toBeNull();
    expect(result!.packageName).toBe('com.app');
    expect(result!.title).toBe('歌');
    expect(result!.state).toBe('playing');
    expect(runAdbCommand).toHaveBeenCalledWith(fakeAdb, 'dumpsys media_session');
  });

  it('returns null when no active session', async () => {
    vi.mocked(runAdbCommand).mockResolvedValueOnce('Sessions: #0 active');
    expect(await getMediaSession(fakeAdb)).toBeNull();
  });

  it('returns null when dumpsys throws', async () => {
    vi.mocked(runAdbCommand).mockRejectedValueOnce(new Error('adb error'));
    expect(await getMediaSession(fakeAdb)).toBeNull();
  });
});

describe('dispatchMediaKey', () => {
  it('uses cmd media_session dispatch as primary path', async () => {
    vi.mocked(runAdbCommand).mockResolvedValueOnce('');
    await dispatchMediaKey(fakeAdb, 'play-pause');
    expect(runAdbCommand).toHaveBeenCalledWith(fakeAdb, 'cmd media_session dispatch play-pause');
  });

  it('falls back to keyevent when dispatch throws', async () => {
    vi.mocked(runAdbCommand)
      .mockRejectedValueOnce(new Error('dispatch not available')) // primary fails
      .mockResolvedValueOnce(''); // fallback succeeds
    await dispatchMediaKey(fakeAdb, 'next');
    expect(runAdbCommand).toHaveBeenNthCalledWith(1, fakeAdb, 'cmd media_session dispatch next');
    expect(runAdbCommand).toHaveBeenNthCalledWith(2, fakeAdb, 'input keyevent 87');
  });

  it('maps previous to keyevent 88 on fallback', async () => {
    vi.mocked(runAdbCommand)
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('');
    await dispatchMediaKey(fakeAdb, 'previous');
    expect(runAdbCommand).toHaveBeenNthCalledWith(2, fakeAdb, 'input keyevent 88');
  });

  it('does not throw when both dispatch and fallback fail', async () => {
    vi.mocked(runAdbCommand)
      .mockRejectedValueOnce(new Error('dispatch fail'))
      .mockRejectedValueOnce(new Error('keyevent fail'));
    await expect(dispatchMediaKey(fakeAdb, 'play-pause')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/__tests__/adb-media-commands.test.ts`
Expected: FAIL（`getMediaSession` / `dispatchMediaKey` 未导出）

- [ ] **Step 3: Write minimal implementation**

在 `src/lib/adb-commands.ts` **文件顶部**（其它 import 之后）追加导入：

```ts
import { parseMediaSessionOutput, type MediaInfo } from './media-session-parser';
export type { MediaInfo };
```

在 `src/lib/adb-commands.ts` **文件末尾**追加：

```ts
/**
 * 读取当前活跃的媒体 session 信息（歌名/艺术家/状态等）。
 * 失败或无活跃 session 时返回 null（best-effort，不抛错）。
 */
export async function getMediaSession(adb: Adb): Promise<MediaInfo | null> {
  try {
    const output = await runAdbCommand(adb, 'dumpsys media_session');
    return parseMediaSessionOutput(output);
  } catch (error) {
    console.warn('[getMediaSession] 读取媒体会话失败:', error);
    return null;
  }
}

const MEDIA_KEYCODE: Record<'play-pause' | 'next' | 'previous', number> = {
  'play-pause': 85,
  next: 87,
  previous: 88,
};

/**
 * 发送媒体控制按键。优先用 cmd media_session dispatch（Android 11+，走系统
 * MediaSession 路由，比 keyevent 可靠）；失败降级 input keyevent。
 * best-effort：两条都失败也不抛错。
 */
export async function dispatchMediaKey(
  adb: Adb,
  action: 'play-pause' | 'next' | 'previous'
): Promise<void> {
  try {
    await runAdbCommand(adb, `cmd media_session dispatch ${action}`);
    return;
  } catch {
    // 降级到 keyevent
  }
  try {
    await runAdbCommand(adb, `input keyevent ${MEDIA_KEYCODE[action]}`);
  } catch (error) {
    console.warn(`[dispatchMediaKey] ${action} 发送失败:`, error);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/__tests__/adb-media-commands.test.ts`
Expected: PASS（全部 7 个用例）

- [ ] **Step 5: Type check**

Run: `npm run check`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add src/lib/adb-commands.ts src/lib/__tests__/adb-media-commands.test.ts
git commit -m "feat: 添加 getMediaSession / dispatchMediaKey 命令封装"
```

---

## Task 4: 抽取 AppIcon 独立组件

**Files:**
- Create: `src/components/AppIcon.tsx`
- Modify: `src/components/ControlSidebar.tsx`（移除内联 `AppIcon`，改 import）

**Interfaces:**
- Produces: `AppIcon` 组件，props 与原 `ControlSidebar` 内联版本完全一致：
  ```ts
  interface AppIconProps {
    pkg: string;
    name: string;
    getAppIcon: (pkg: string) => Promise<string | null>;
    onLaunch: (pkg: string) => void;
    compact?: boolean;
    pinMode?: boolean;
    isPinned?: boolean;
    cacheVersion?: number;
  }
  ```

- [ ] **Step 1: Create AppIcon component**

创建 `src/components/AppIcon.tsx`，把 `ControlSidebar.tsx` 中第 19–96 行的 `AppIcon` 组件（连同其 `interface AppIconProps`）**原样搬过来**，改为具名导出：

```tsx
import { useEffect, useRef, useState } from 'react';
import { Pin } from 'lucide-react';

export interface AppIconProps {
  pkg: string;
  name: string;
  getAppIcon: (pkg: string) => Promise<string | null>;
  onLaunch: (pkg: string) => void;
  compact?: boolean;
  pinMode?: boolean;
  isPinned?: boolean;
  cacheVersion?: number;
}

export function AppIcon({ pkg, name, getAppIcon, onLaunch, compact, pinMode, isPinned, cacheVersion }: AppIconProps) {
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = btnRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    setIconUrl(null);
    getAppIcon(pkg).then((url) => {
      if (!cancelled) setIconUrl(url);
    });
    return () => { cancelled = true; };
  }, [pkg, getAppIcon, isVisible, cacheVersion]);

  const displayName = name || pkg.split('.').pop() || pkg;
  const firstLetter = displayName.charAt(0).toUpperCase();
  const hue = pkg.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  return (
    <button
      ref={btnRef}
      onClick={() => onLaunch(pkg)}
      className="flex flex-col items-center gap-1 p-1.5 rounded-lg hover:bg-black/10 transition-colors group relative"
      title={name}
    >
      {iconUrl ? (
        <img src={iconUrl} alt={name} className="w-9 h-9 rounded-lg object-cover" />
      ) : (
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-medium text-sm"
          style={{ backgroundColor: `hsl(${hue}, 45%, 35%)` }}
        >
          {firstLetter}
        </div>
      )}
      {pinMode && (
        <div className={`absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center ${
          isPinned ? 'bg-blue-500' : 'bg-white/20'
        }`}>
          <Pin className={`w-2.5 h-2.5 ${isPinned ? 'text-white fill-white' : 'text-white/60'}`} />
        </div>
      )}
      {!compact && (
        <span className="text-[10px] text-black/50 truncate w-full text-center group-hover:text-black/80 transition-colors">
          {displayName}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 2: Update ControlSidebar to import AppIcon**

修改 `src/components/ControlSidebar.tsx`：

(a) 在文件顶部 import 区（第 3 行 `import { AppGridIcon } from './AppGridIcon';` 附近）添加：
```tsx
import { AppIcon } from './AppIcon';
```

(b) 删除文件内联的 `interface AppIconProps { ... }`（第 19–28 行）和内联 `function AppIcon(...) { ... }`（第 30–96 行整段）。

(c) 确认文件内对 `<AppIcon .../>` 的引用（第 363、378、697、718 行附近）保持不变——它们现在使用 import 进来的版本，props 接口一致，无需改动。

- [ ] **Step 3: Type check + run full test suite**

Run: `npm run check && npm test`
Expected: 类型检查无错误；全部已有测试仍 PASS（此步是纯重构，行为不变）

- [ ] **Step 4: Commit**

```bash
git add src/components/AppIcon.tsx src/components/ControlSidebar.tsx
git commit -m "refactor: 抽取 AppIcon 为独立组件供桌面与侧栏共用"
```

---

## Task 5: useMediaSession hook

**Files:**
- Create: `src/hooks/useMediaSession.ts`

**Interfaces:**
- Consumes: `Adb | null`；`getMediaSession(adb)`、`dispatchMediaKey(adb, action)`（Task 3）
- Produces:
  ```ts
  interface UseMediaSessionResult {
    media: MediaInfo | null;      // null = 未在播放
    loading: boolean;
    refresh: () => Promise<void>;
    control: (action: 'play-pause' | 'next' | 'previous') => Promise<void>;
    // 进度外推：基于上次快照 position + 经过时间推算的当前进度（ms）
    estimatedPosition: number;
  }
  function useMediaSession(adb: Adb | null): UseMediaSessionResult
  ```

此 hook 无独立单测（轮询/定时器/ADB 依赖，按 spec 第 6 节归入手动验收）。

- [ ] **Step 1: Write implementation**

创建 `src/hooks/useMediaSession.ts`：

```ts
import { useEffect, useRef, useState, useCallback } from 'react';
import type { Adb } from '@yume-chan/adb';
import { getMediaSession, dispatchMediaKey, type MediaInfo } from '@/lib/adb-commands';

export interface UseMediaSessionResult {
  media: MediaInfo | null;
  loading: boolean;
  refresh: () => Promise<void>;
  control: (action: 'play-pause' | 'next' | 'previous') => Promise<void>;
  estimatedPosition: number;
}

const POLL_INTERVAL = 5000; // 5 秒轮询

export function useMediaSession(adb: Adb | null): UseMediaSessionResult {
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [loading, setLoading] = useState(false);
  // 进度外推：记录快照时刻 + position
  const snapshotRef = useRef<{ position: number; timestamp: number } | null>(null);
  const [estimatedPosition, setEstimatedPosition] = useState(0);

  const refresh = useCallback(async () => {
    if (!adb) {
      setMedia(null);
      return;
    }
    setLoading(true);
    try {
      const info = await getMediaSession(adb);
      setMedia(info);
      if (info) {
        snapshotRef.current = { position: info.position, timestamp: Date.now() };
        setEstimatedPosition(info.position);
      } else {
        snapshotRef.current = null;
        setEstimatedPosition(0);
      }
    } catch {
      setMedia(null);
    } finally {
      setLoading(false);
    }
  }, [adb]);

  // 挂载 + adb 变化时立即拉一次，然后起 5s 轮询
  useEffect(() => {
    refresh();
    if (!adb) return;
    const timer = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [adb, refresh]);

  // 进度外推：每秒根据 playing 状态推进
  useEffect(() => {
    if (!media || media.state !== 'playing') return;
    const snap = snapshotRef.current;
    if (!snap) return;
    const timer = setInterval(() => {
      const elapsed = Date.now() - snap.timestamp;
      setEstimatedPosition(snap.position + elapsed);
    }, 1000);
    return () => clearInterval(timer);
  }, [media]);

  const control = useCallback(async (action: 'play-pause' | 'next' | 'previous') => {
    if (!adb) return;
    await dispatchMediaKey(adb, action);
    // 控制后立即刷新，保证 UI 即时反馈
    await refresh();
  }, [adb, refresh]);

  return { media, loading, refresh, control, estimatedPosition };
}
```

- [ ] **Step 2: Type check**

Run: `npm run check`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMediaSession.ts
git commit -m "feat: 添加 useMediaSession hook（轮询 + 进度外推 + 控制）"
```

---

## Task 6: 首帧就绪信号（onFirstFrame）

**Files:**
- Modify: `src/hooks/scrcpy/useVideoDecoder.ts`
- Modify: `src/hooks/scrcpy/useScrcpySession.ts`
- Modify: `src/contexts/ScrcpyContext.tsx`

**Interfaces:**
- Produces:
  - `useVideoDecoder().setupVideoStream(...)` 新增第 4 个可选参数 `onFirstFrame?: () => void`，在 pump 循环首次成功写入一帧后调用一次。
  - `useScrcpySession().startScrcpy(adb, canvas, displayConfig?, onFirstFrame?)` 新增第 4 个可选参数，透传给 setupVideoStream；同时新增 `firstFrameReady: boolean` state。

- [ ] **Step 1: Modify useVideoDecoder to accept onFirstFrame**

修改 `src/hooks/scrcpy/useVideoDecoder.ts` 的 `setupVideoStream` 签名与 pump：

把第 14–18 行的函数签名改为：
```ts
const setupVideoStream = useCallback(async (
  client: AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>,
  canvas: HTMLCanvasElement,
  onSizeChanged: (width: number, height: number) => void,
  onFirstFrame?: () => void,
) => {
```

在 pump 函数内（约第 42–58 行），首次写入成功后调用 `onFirstFrame`。把 pump 改为：

```ts
    let firstFrameFired = false;
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const writer = decoder.writable.getWriter();
          try {
            await writer.write(value);
            if (!firstFrameFired) {
              firstFrameFired = true;
              onFirstFrame?.();
            }
          } finally {
            writer.releaseLock();
          }
        }
      } catch (error) {
        console.error('视频流读取错误:', error);
      }
    };
```

- [ ] **Step 2: Modify useScrcpySession to thread onFirstFrame + add firstFrameReady state**

修改 `src/hooks/scrcpy/useScrcpySession.ts`：

(a) 在 `ScrcpyState` interface（第 54–61 行）添加字段：
```ts
export interface ScrcpyState {
  isStarting: boolean;
  isRunning: boolean;
  error: string | null;
  videoWidth: number;
  videoHeight: number;
  isVirtualDisplay: boolean;
  firstFrameReady: boolean;
}
```

(b) 初始 state（第 64–71 行）加 `firstFrameReady: false`。

(c) `startScrcpy` 签名（第 89 行）改为接收第 4 参数：
```ts
const startScrcpy = useCallback(async (
  adb: Adb, canvas: HTMLCanvasElement, displayConfig?: DisplayConfig,
  onFirstFrame?: () => void,
) => {
```

(d) 调用 `setupVideoStream` 处（第 176 行）改为传入 `onFirstFrame`，并在设置 `isRunning: true` 时把 `firstFrameReady: false` 重置。但首帧回调需要触发 state——在 `startScrcpy` 内包装一个本地回调：
```ts
  const { width, height } = await videoDecoder.setupVideoStream(
    client, canvas,
    (w, h) => setState(prev => ({ ...prev, videoWidth: w, videoHeight: h })),
    () => setState(prev => ({ ...prev, firstFrameReady: true })),
  );
```

(e) `stopScrcpy` 内 setState（第 269–276 行）加 `firstFrameReady: false`。

(f) return 对象（第 386 行 `...state`）已自动包含 `firstFrameReady`。

- [ ] **Step 3: Update ScrcpyContext interface**

修改 `src/contexts/ScrcpyContext.tsx`：

(a) `ScrcpyContextValue extends ScrcpyState`（第 7 行）—— 因 `firstFrameReady` 已在 ScrcpyState 中，自动包含。

(b) `startScrcpy` 签名（第 8 行）改为：
```ts
startScrcpy: (adb: Adb, canvas: HTMLCanvasElement, displayConfig?: DisplayConfig, onFirstFrame?: () => void) => Promise<void>;
```

(c) `useMemo` 依赖数组（第 64 行附近）添加 `session.firstFrameReady`。

- [ ] **Step 4: Type check + run tests**

Run: `npm run check && npm test`
Expected: 无类型错误；已有测试仍 PASS（新增可选参数不破坏现有调用）

- [ ] **Step 5: Commit**

```bash
git add src/hooks/scrcpy/useVideoDecoder.ts src/hooks/scrcpy/useScrcpySession.ts src/contexts/ScrcpyContext.tsx
git commit -m "feat: scrcpy 暴露首帧就绪信号 onFirstFrame / firstFrameReady"
```

---

## Task 7: NowPlayingCard 组件

**Files:**
- Create: `src/components/NowPlayingCard.tsx`

**Interfaces:**
- Consumes: `UseMediaSessionResult`（Task 5）；`onLaunchApp(pkg: string): void`（点击卡片主体启动来源 app）
- Produces: `NowPlayingCard` 组件，props：
  ```ts
  interface NowPlayingCardProps {
    media: MediaInfo | null;
    estimatedPosition: number;
    onControl: (action: 'play-pause' | 'next' | 'previous') => void;
    onLaunchApp: (pkg: string) => void;
    getAppIcon: (pkg: string) => Promise<string | null>;
  }
  ```

- [ ] **Step 1: Write implementation**

创建 `src/components/NowPlayingCard.tsx`：

```tsx
import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Music } from 'lucide-react';
import type { MediaInfo } from '@/lib/adb-commands';

interface NowPlayingCardProps {
  media: MediaInfo | null;
  estimatedPosition: number;
  onControl: (action: 'play-pause' | 'next' | 'previous') => void;
  onLaunchApp: (pkg: string) => void;
  getAppIcon: (pkg: string) => Promise<string | null>;
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function NowPlayingCard({ media, estimatedPosition, onControl, onLaunchApp, getAppIcon }: NowPlayingCardProps) {
  const [iconUrl, setIconUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!media) { setIconUrl(null); return; }
    let cancelled = false;
    getAppIcon(media.packageName).then((url) => {
      if (!cancelled) setIconUrl(url);
    });
    return () => { cancelled = true; };
  }, [media?.packageName, getAppIcon]);

  // 空状态：未在播放
  if (!media) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/5 border border-white/10">
        <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
          <Music className="w-6 h-6 text-white/40" />
        </div>
        <div className="text-white/40 text-sm">未在播放</div>
      </div>
    );
  }

  const isPlaying = media.state === 'playing';
  const progress = media.duration > 0
    ? Math.min(100, (estimatedPosition / media.duration) * 100)
    : 0;

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/5 border border-white/10">
      {/* 图标占位（无真实封面）— 点击启动来源 app */}
      <button
        onClick={() => onLaunchApp(media.packageName)}
        className="w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-white/10 flex items-center justify-center"
        title={`打开 ${media.packageName}`}
      >
        {iconUrl ? (
          <img src={iconUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <Music className="w-6 h-6 text-white/40" />
        )}
      </button>

      {/* 歌曲信息 — 点击启动来源 app */}
      <button
        onClick={() => onLaunchApp(media.packageName)}
        className="flex-1 min-w-0 text-left"
      >
        <div className="text-white text-sm font-medium truncate">
          {media.title || '未知曲目'}
        </div>
        <div className="text-white/50 text-xs truncate">
          {media.artist}{media.album ? ` · ${media.album}` : ''}
        </div>
      </button>

      {/* 控制按钮区 —— stopPropagation 不触发启动 */}
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => onControl('previous')}
          className="p-2 rounded-full hover:bg-white/10 transition-colors"
          title="上一首"
        >
          <SkipBack className="w-5 h-5 text-white/80" />
        </button>
        <button
          onClick={() => onControl('play-pause')}
          className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          title={isPlaying ? '暂停' : '播放'}
        >
          {isPlaying
            ? <Pause className="w-5 h-5 text-white" />
            : <Play className="w-5 h-5 text-white ml-0.5" />}
        </button>
        <button
          onClick={() => onControl('next')}
          className="p-2 rounded-full hover:bg-white/10 transition-colors"
          title="下一首"
        >
          <SkipForward className="w-5 h-5 text-white/80" />
        </button>
      </div>

      {/* 进度条 */}
      <div className="hidden sm:flex flex-col items-end gap-0.5 w-20 shrink-0">
        <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full bg-white/40 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-[10px] text-white/40 font-mono">
          {formatTime(estimatedPosition)} / {formatTime(media.duration)}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type check**

Run: `npm run check`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/components/NowPlayingCard.tsx
git commit -m "feat: 添加 NowPlayingCard 音乐播放卡片"
```

---

## Task 8: AppGrid 分页网格组件

**Files:**
- Create: `src/components/AppGrid.tsx`

**Interfaces:**
- Consumes: `AppIcon`（Task 4）；`paginateApps`（Task 2）；`getAllDeviceApps()`、`getAppIcon()`、`getCachedAppLabels()`、`togglePin()`、`incrementLocalCount()` 经 `useScrcpyContext`；`sortApps` from `@/lib/app-sorter`
- Produces: `AppGrid` 组件，props：
  ```ts
  interface AppGridProps {
    onLaunchApp: (pkg: string) => void;
  }
  ```
  暴露回到第一页的能力：用 `forwardRef` + `useImperativeHandle` 暴露 `goToFirstPage()`。
  ```ts
  export interface AppGridHandle {
    goToFirstPage: () => void;
  }
  ```

- [ ] **Step 1: Write implementation**

创建 `src/components/AppGrid.tsx`：

```tsx
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AppIcon } from './AppIcon';
import { useScrcpyContext } from '@/contexts/ScrcpyContext';
import { sortApps } from '@/lib/app-sorter';
import { paginateApps } from '@/lib/app-pagination';
import type { DeviceAppRecord } from '@/lib/device-apps-store';

export interface AppGridHandle {
  goToFirstPage: () => void;
}

interface AppGridProps {
  onLaunchApp: (pkg: string) => void;
}

const COLS = 4;

export const AppGrid = forwardRef<AppGridHandle, AppGridProps>(function AppGrid(
  { onLaunchApp },
  ref,
) {
  const scrcpy = useScrcpyContext();
  const { getAllDeviceApps, getAppIcon, getCachedAppLabels, incrementLocalCount } = scrcpy;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [deviceApps, setDeviceApps] = useState<DeviceAppRecord[]>([]);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());

  // 拉取应用列表（复用 useAppManager 能力）
  const refresh = useCallback(async () => {
    const apps = await getAllDeviceApps();
    setDeviceApps(apps);
    const pkgs = apps.map((a) => a.packageName);
    const labelMap = await getCachedAppLabels(pkgs);
    setLabels(labelMap);
  }, [getAllDeviceApps, getCachedAppLabels]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 用 sortApps 做三段排序（置顶>常用>其他），传 sortApps 需要的入参格式
  const allPkgs = deviceApps.map((a) => a.packageName);
  const pinned = new Map<string, number>();
  const counts = new Map<string, { localCount: number; dexBaseline: number }>();
  for (const a of deviceApps) {
    if (a.pinned) pinned.set(a.packageName, a.pinOrder);
    counts.set(a.packageName, { localCount: a.localCount, dexBaseline: a.launchCount });
  }
  const sortedPkgs = sortApps(allPkgs, pinned, counts);

  // 计算每页容量（4 列 × 行数）。行数按视口高度简单估算（每行 ~96px）。
  // 第一页容量与后续页相同；音乐卡片定位在桌面容器外，不占网格。
  const [perPage, setPerPage] = useState(12);
  useEffect(() => {
    const calc = () => {
      const rows = Math.max(2, Math.floor((window.innerHeight - 240) / 110));
      setPerPage(COLS * rows);
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  const pages = paginateApps(sortedPkgs, perPage);

  const handleLaunch = useCallback((pkg: string) => {
    incrementLocalCount(pkg).then(() => refresh()).catch(() => {});
    onLaunchApp(pkg);
  }, [incrementLocalCount, refresh, onLaunchApp]);

  // 暴露回第一页
  useImperativeHandle(ref, () => ({
    goToFirstPage: () => {
      if (scrollRef.current) {
        scrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
      }
    },
  }), []);

  if (deviceApps.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/40 text-sm py-12">
        正在加载应用列表...
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        className="h-full overflow-x-auto overflow-y-hidden flex snap-x snap-mandatory scrollbar-none"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {pages.map((pageApps, pageIdx) => (
          <div
            key={pageIdx}
            className="w-full shrink-0 snap-start px-6 py-4"
            style={{ scrollSnapAlign: 'start' }}
          >
            <div
              className="grid gap-x-4 gap-y-5"
              style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
            >
              {pageApps.map((pkg) => (
                <AppIcon
                  key={pkg}
                  pkg={pkg}
                  name={labels.get(pkg) || pkg.split('.').pop() || pkg}
                  getAppIcon={getAppIcon}
                  onLaunch={handleLaunch}
                  cacheVersion={0}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 页面指示器 */}
      {pages.length > 1 && (
        <div className="flex justify-center gap-1.5 py-2">
          {pages.map((_, i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-white/20"
            />
          ))}
        </div>
      )}
    </div>
  );
});
```

- [ ] **Step 2: Verify sortApps signature compatibility**

Run（确认 `sortApps` 入参类型与本任务一致）：
```bash
grep -n "export function sortApps" src/lib/app-sorter.ts
grep -n "export interface LaunchCountData" src/lib/app-sorter.ts
```
Expected: 看到 `sortApps(allPkgs, pinned, counts)` 签名，`LaunchCountData` 含 `localCount`、`dexBaseline`（与 app-sorter.test.ts 用法一致）。若字段名不同，按实际调整本任务的 `counts` 构造。

- [ ] **Step 3: Type check**

Run: `npm run check`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/components/AppGrid.tsx
git commit -m "feat: 添加 AppGrid 分页应用网格组件"
```

---

## Task 9: AppLaunchingOverlay 过渡层

**Files:**
- Create: `src/components/AppLaunchingOverlay.tsx`

**Interfaces:**
- Consumes: `getAppIcon(pkg)`（经 `useScrcpyContext`）；应用包名 + 显示名
- Produces:
  ```ts
  interface AppLaunchingOverlayProps {
    pkg: string;
    name: string;
  }
  ```

- [ ] **Step 1: Write implementation**

创建 `src/components/AppLaunchingOverlay.tsx`：

```tsx
import { useEffect, useState } from 'react';
import { useScrcpyContext } from '@/contexts/ScrcpyContext';

interface AppLaunchingOverlayProps {
  pkg: string;
  name: string;
}

export function AppLaunchingOverlay({ pkg, name }: AppLaunchingOverlayProps) {
  const { getAppIcon } = useScrcpyContext();
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // 淡入
    const t = setTimeout(() => setShow(true), 10);
    let cancelled = false;
    getAppIcon(pkg).then((url) => {
      if (!cancelled) setIconUrl(url);
    });
    return () => { cancelled = true; clearTimeout(t); };
  }, [pkg, getAppIcon]);

  const displayName = name || pkg.split('.').pop() || pkg;
  const hue = pkg.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center backdrop-blur-xl bg-black/60 transition-opacity duration-300"
      style={{ opacity: show ? 1 : 0 }}
    >
      <div
        className="w-24 h-24 rounded-3xl overflow-hidden flex items-center justify-center mb-4 shadow-2xl transition-transform duration-300"
        style={{ transform: show ? 'scale(1)' : 'scale(0.8)' }}
      >
        {iconUrl ? (
          <img src={iconUrl} alt={displayName} className="w-full h-full object-cover" />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-white text-4xl font-medium"
            style={{ backgroundColor: `hsl(${hue}, 45%, 35%)` }}
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="text-white text-base font-medium">{displayName}</div>
      <div className="text-white/40 text-xs mt-1">正在启动...</div>
    </div>
  );
}
```

- [ ] **Step 2: Type check**

Run: `npm run check`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/components/AppLaunchingOverlay.tsx
git commit -m "feat: 添加 AppLaunchingOverlay 启动过渡层"
```

---

## Task 10: DesktopView 桌面容器

**Files:**
- Create: `src/components/DesktopView.tsx`

**Interfaces:**
- Consumes: `NowPlayingCard`（Task 7）；`AppGrid`/`AppGridHandle`（Task 8）；`useMediaSession`（Task 5）；`useScrcpyContext`（`getAppIcon`、`startApp`）
- Produces:
  ```ts
  interface DesktopViewProps {
    adb: Adb | null;
    onLaunchApp: (pkg: string) => void;   // 切到 launching/screen
  }
  export interface DesktopViewHandle {
    goToFirstPage: () => void;
  }
  ```
  用 `forwardRef` 暴露 `goToFirstPage`（转发给 AppGrid）。

- [ ] **Step 1: Write implementation**

创建 `src/components/DesktopView.tsx`：

```tsx
import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { Adb } from '@yume-chan/adb';
import { NowPlayingCard } from './NowPlayingCard';
import { AppGrid, type AppGridHandle } from './AppGrid';
import { useMediaSession } from '@/hooks/useMediaSession';
import { useScrcpyContext } from '@/contexts/ScrcpyContext';

export interface DesktopViewHandle {
  goToFirstPage: () => void;
}

interface DesktopViewProps {
  adb: Adb | null;
  onLaunchApp: (pkg: string) => void;
}

export const DesktopView = forwardRef<DesktopViewHandle, DesktopViewProps>(function DesktopView(
  { adb, onLaunchApp },
  ref,
) {
  const { media, estimatedPosition, control } = useMediaSession(adb);
  const { getAppIcon } = useScrcpyContext();
  const gridRef = useRef<AppGridHandle>(null);

  useImperativeHandle(ref, () => ({
    goToFirstPage: () => gridRef.current?.goToFirstPage(),
  }), []);

  return (
    <div className="w-full h-screen bg-slate-900 flex flex-col p-4 gap-4">
      {/* 音乐卡片（仅第 1 页可见，位于桌面顶部） */}
      <div className="shrink-0">
        <NowPlayingCard
          media={media}
          estimatedPosition={estimatedPosition}
          onControl={control}
          onLaunchApp={onLaunchApp}
          getAppIcon={getAppIcon}
        />
      </div>

      {/* 分页应用网格 */}
      <AppGrid ref={gridRef} onLaunchApp={onLaunchApp} />
    </div>
  );
});
```

- [ ] **Step 2: Type check**

Run: `npm run check`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/components/DesktopView.tsx
git commit -m "feat: 添加 DesktopView 桌面容器"
```

---

## Task 11: 串联 App.tsx 状态机 + ControlSidebar Home 改造

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/ControlSidebar.tsx`
- Modify: `src/components/VirtualScreen.tsx`

**Interfaces:**
- Consumes: 所有 Task 1–10 产物
- Produces: 完整的 `desktop → launching → screen` 视图流转

- [ ] **Step 1: Modify ControlSidebar to support onHome callback**

`ControlSidebar` 当前 Home 按钮调用 `goHome`（手机 Home）。改为优先调用传入的 `onHome`（回车机桌面）。

修改 `src/components/ControlSidebar.tsx`：

(a) `ControlSidebarProps`（约第 98–111 行）添加可选 prop：
```ts
interface ControlSidebarProps {
  // ...existing fields...
  onHome?: () => void;   // 回车机桌面（覆盖默认 goHome 手机 Home）
}
```

(b) 解构参数处（第 113 行 `export function ControlSidebar({...}`）加入 `onHome`。

(c) Home 按钮（约第 412–414 行）：
```tsx
<NeumorphicButton onClick={() => onHome ? onHome() : goHome()} title="桌面">
  <Home size={ICON_SIZE} />
</NeumorphicButton>
```

- [ ] **Step 2: Modify VirtualScreen to pass through onHome + onFirstFrame**

修改 `src/components/VirtualScreen.tsx`：

(a) `VirtualScreenProps`（第 12–16 行）添加：
```ts
interface VirtualScreenProps {
  active?: boolean;
  displayMode?: 'virtual' | 'mirror';
  onStop: () => void;
  onHome?: () => void;       // 回车机桌面
  onFirstFrame?: () => void; // 首帧就绪
}
```

(b) 解构（第 18 行）加入 `onHome`、`onFirstFrame`。

(c) `<ControlSidebar .../>`（约第 366–379 行）添加 `onHome={onHome}`：
```tsx
      <ControlSidebar
        // ...existing props...
        onHome={onHome}
      />
```

(d) `startScrcpy` 调用处（第 99 行和第 102 行附近，共 4 处 `startScrcpy(adb, canvas, ...)`），在第 4 个参数传入 `onFirstFrame`。把这 4 处改为：
```ts
          startScrcpy(adb, canvas, undefined, onFirstFrame);  // mirror 分支
          // 和
          startScrcpy(adb, canvas, displayConfig, onFirstFrame);  // virtual 分支
```
（注意：原有的 `displayConfig ? {...}` 传参逻辑保留，只在末尾加 `onFirstFrame`。）

- [ ] **Step 3: Modify App.tsx to add the view state machine**

修改 `src/App.tsx`，替换整个 `App` 函数体为加入 `view` 状态机的版本：

(a) 顶部 import（第 1–9 行区域）添加：
```tsx
import { DesktopView, type DesktopViewHandle } from './components/DesktopView';
```

(b) 在 `App` 函数内（第 23 行 `function App() {` 之后），`overlayState` 等现有 state 旁，添加：
```tsx
  const [view, setView] = useState<'desktop' | 'launching' | 'screen'>('desktop');
  const [launchingPkg, setLaunchingPkg] = useState<string | null>(null);
  const [launchingName, setLaunchingName] = useState('');
  const desktopRef = useRef<DesktopViewHandle>(null);
  const firstFrameTimerRef = useRef<NodeJS.Timeout | null>(null);
```
（在文件顶部已有的 `import { useState, useEffect, useCallback } from 'react';` 中补 `useRef`。）

(c) 添加启动应用的处理函数（在 `handleStop` 附近）：
```tsx
  const handleLaunchApp = useCallback((pkg: string) => {
    const name = pkg.split('.').pop() || pkg;
    setLaunchingPkg(pkg);
    setLaunchingName(name);
    setView('launching');

    // 8 秒超时：未首帧则回桌面
    if (firstFrameTimerRef.current) clearTimeout(firstFrameTimerRef.current);
    firstFrameTimerRef.current = setTimeout(() => {
      setView('desktop');
      setLaunchingPkg(null);
      console.warn('[App] 启动超时，回桌面');
    }, 8000);
  }, []);

  const handleFirstFrame = useCallback(() => {
    if (firstFrameTimerRef.current) {
      clearTimeout(firstFrameTimerRef.current);
      firstFrameTimerRef.current = null;
    }
    setView('screen');
  }, []);

  const handleHome = useCallback(() => {
    // 回桌面并重置到第一页
    setView('desktop');
    setLaunchingPkg(null);
    desktopRef.current?.goToFirstPage();
  }, []);
```

(d) 修改 `finishConnect`（第 42–48 行），连接成功后确保 `view` 重置为 desktop：
```tsx
  const finishConnect = useCallback(() => {
    setIsFading(true);
    setTimeout(() => {
      setOverlayState('hidden');
      setView('desktop');
      setIsFading(false);
    }, 300);
  }, []);
```

(e) 修改 `handleStop`（第 121–125 行）增加 view 重置：
```tsx
  const handleStop = useCallback(() => {
    setPinGuard({ type: 'none' });
    store.disconnect();
    setOverlayState('manual');
    setView('desktop');
  }, [store]);
```

(f) 替换 return 的 JSX（第 132–176 行）。把原来的 `<VirtualScreen .../>` 部分改为根据 `view` 条件渲染：
```tsx
  return (
    <ScrcpyProvider>
      <div className="w-full h-screen bg-slate-900">
        {view === 'desktop' && (
          <DesktopView
            ref={desktopRef}
            adb={store.adb}
            onLaunchApp={handleLaunchApp}
          />
        )}

        {(view === 'launching' || view === 'screen') && (
          <VirtualScreen
            active={true}
            displayMode={displayMode}
            onStop={handleStop}
            onHome={handleHome}
            onFirstFrame={handleFirstFrame}
          />
        )}

        {view === 'launching' && launchingPkg && (
          <AppLaunchingOverlay pkg={launchingPkg} name={launchingName} />
        )}

        {(overlayState !== 'hidden' || isFading) && (
          <ConnectionOverlay
            overlayState={
              overlayState === 'hidden'
                ? 'manual'
                : (overlayState as 'auto-connecting' | 'auto-reconnecting' | 'auto-failed' | 'manual')
            }
            displayMode={displayMode}
            rememberedDevices={devices}
            onSelectMode={setDisplayMode}
            onConnect={handleConnect}
            onForget={forget}
            onCancelAutoConnect={handleCancelAutoConnect}
            fading={isFading}
          />
        )}

        {pinGuard.type === 'required' && (
          <PinDialog
            mode="verify"
            deviceId={pinGuard.deviceId}
            deviceName={pinGuard.deviceName}
            hasExistingPin={true}
            onSuccess={() => {
              setPinGuard({ type: 'none' });
              finishConnect();
            }}
            onForgot={() => {
              removePin(pinGuard.deviceId);
              forget(pinGuard.deviceId);
              store.disconnect();
              setPinGuard({ type: 'none' });
            }}
          />
        )}
      </div>
    </ScrcpyProvider>
  );
```

并在文件顶部 import 区添加：
```tsx
import { AppLaunchingOverlay } from './components/AppLaunchingOverlay';
```

- [ ] **Step 4: Type check**

Run: `npm run check`
Expected: 无类型错误

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: 全部测试 PASS

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/ControlSidebar.tsx src/components/VirtualScreen.tsx
git commit -m "feat: App 串联桌面/启动/虚拟屏三态视图流转"
```

---

## Task 12: lint + 全量验证 + 收尾

**Files:**
- None (verification only)

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: 无错误。若有 ESLint 报错（如未使用变量、hooks 依赖），按提示修复。

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: 无错误

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: 全部测试 PASS（含 Task 1/2/3 新增测试 + 所有原有测试）

- [ ] **Step 4: Manual smoke test (dev server)**

Run: `npm run dev`
然后在浏览器手动验收（按 spec 第 6 节"难以单元测试的部分"）：
1. 连接手机 → 应进入桌面（音乐卡片 + 应用网格），而非直接虚拟屏。
2. 桌面应用列表加载、图标显示正常。
3. 点应用图标 → 出现模糊背景 + 居中图标过渡 → 首帧后进入虚拟屏。
4. 虚拟屏 Home 按钮 → 回桌面第 1 页。
5. 手机播放音乐 → 桌面音乐卡片显示歌名/艺术家/进度，控制按钮可用。
6. 无音乐播放 → 卡片显示"未在播放"占位。
7. 应用数超出一页 → 可左右滑动翻页，底部圆点指示器。

Expected: 以上流程均正常。若首帧过渡或 scrcpy 启动时序异常，回到 Task 6/11 检查 `onFirstFrame` 透传与 `active` 渲染时机。

- [ ] **Step 5: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: lint 修复与全量验证"
```

---

## Self-Review

**1. Spec coverage:**
- §1 背景目标（入口层桌面）→ Task 11（默认进 desktop）✅
- §2 状态机（desktop/launching/screen）→ Task 11 ✅
- §3 布局（音乐卡片置顶 + 分页网格）→ Task 7/8/10 ✅
- §3 抽取 AppIcon → Task 4 ✅
- §3 scroll-snap 分页、4 列、圆点 → Task 8 ✅
- §3 空状态降级 → Task 7（未播放）、Task 8（loading）✅
- §4 useMediaSession + dumpsys 解析 + 5s 轮询 + 进度外推 + dispatch 控制 → Task 1/3/5 ✅
- §4 封面占位（用应用图标）→ Task 7 ✅
- §5 scrcpy 启停/暂停渲染 → Task 11（互斥渲染，切走 desktop 即卸载 VirtualScreen）✅
- §5 启动过渡（模糊背景+居中图标+8s 超时）→ Task 9/11 ✅
- §5 首帧就绪信号 → Task 6 ✅
- §5 Home 回第一页 → Task 8（goToFirstPage）/Task 10/Task 11 ✅
- §6 测试（解析、分页、命令 mock）→ Task 1/2/3 ✅
- §6 不做 E2E/快照 → 无相关任务 ✅

**2. Placeholder scan:** 已检查，无 TBD/TODO/"类似 Task N"；每步含完整代码或确切命令。

**3. Type consistency:**
- `MediaInfo`：Task 1 定义 → Task 3 re-export → Task 5 import → Task 7 props ✅ 一致
- `parseMediaSessionOutput`：Task 1 → Task 3 调用 ✅
- `paginateApps(sortedPackages, perPage)`：Task 2 → Task 8 调用 ✅
- `AppIconProps`：Task 4 定义 → ControlSidebar/Task 8 使用 ✅ 一致
- `onFirstFrame`：Task 6 useVideoDecoder → useScrcpySession → VirtualScreen → App ✅
- `AppGridHandle.goToFirstPage`：Task 8 → Task 10（转发）→ Task 11（调用）✅
- `dispatchMediaKey(adb, action)` action 类型 `'play-pause'|'next'|'previous'`：Task 3 → Task 5 → Task 7 ✅

**注（实现者须知）：** spec §5 提到"桌面状态下暂停渲染而非销毁 session"，但 Task 11 采用的是 `view==='desktop'` 时**卸载 VirtualScreen**（更简单、且 `active=false` 时 VirtualScreen 本就不启动 scrcpy）。这是对 spec 的合理简化：当前 VirtualScreen 的 scrcpy 生命周期与组件挂载绑定，卸载即 stopScrcpy（组件卸载 effect 第 189–195 行）。若严格要求"保留 session 后台运行"，需额外改造 VirtualScreen 解耦 scrcpy 生命周期与挂载——这超出 MVP，建议作为后续优化。在 Task 12 手测时验证"回桌面→再进应用"的黑屏等待是否可接受。
