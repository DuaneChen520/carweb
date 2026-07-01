# scrcpy 4.0 Flex Display 迁移实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 CarWeb 中自研 scrcpy 4.0 客户端协议适配层，启用 flex display，使虚拟屏运行时动态改尺寸无需销毁重建会话。

**Architecture:** 在 `src/lib/scrcpy4/` 内实现 4.0 协议适配层（`AdbScrcpyOptions4_0 extends AdbScrcpyOptions3_3_3`，override version/serialize/controlMessageTypes/createMediaStreamTransformer），复用 `@yume-chan/adb-scrcpy` 的 `AdbScrcpyClient` 与 `@yume-chan/scrcpy-decoder-webcodecs`（已支持运行时 reconfigure）。flex resize 通过 `RESIZE_DISPLAY` 控制消息 + 视频流会话包 + CSS/backing-store 隔离的反抖动状态机实现。

**Tech Stack:** TypeScript + React + @yume-chan/adb-scrcpy 2.3.2 + @yume-chan/scrcpy 2.3.0 + @yume-chan/scrcpy-decoder-webcodecs 2.5.3 + Vitest

## Global Constraints

- scrcpy server jar 必须是 v4.0，client `options.version` 必须是 `'4.0'`，两者强锁一致（scrcpy 协议无前后向兼容）。
- 不修改 `node_modules` 任何文件；4.0 适配层全部在 `src/lib/scrcpy4/` 项目源码内。
- 测试用 Vitest（`describe`/`it`/`expect`），测试文件放 `src/lib/scrcpy4/__tests__/*.test.ts`，被测代码用相对路径 `../` 导入。
- 测试命令：`npm test`（= `vitest run`）；类型检查：`npm run check`（= `tsc -b --noEmit`）。
- 中文注释与用户对话；代码标识符用英文。
- `@yume-chan/struct` **不**新增为依赖——所有字节序列化用 `DataView` 手写。

## 4.0 协议假设（需真机抓包验证，见 Task 4 前置手测）

基于 PR #6772 源码与协议文档推导。视频流（codec id 之后）每个 packet 用首字节 MSB 区分：

- **MSB=1 → 会话包**，固定 12 字节，无 payload：
  - `byte0..3`: flags，`byte0` MSB=1，`byte3` LSB=`clientResized`
  - `byte4..7`: width (u32 BE)
  - `byte8..11`: height (u32 BE)
- **MSB=0 → 媒体包**，12 字节头 + payload：
  - `byte0..7`: pts 字段 (u64 BE)，位域：`bit63=0`(media)，`bit62=config`，`bit61=keyframe`，`bit0..60`=61-bit PTS
  - `byte8..11`: size (u32 BE)
  - `byte12..(12+size-1)`: payload

> **注意**：4.0 的 PTS 位域与 3.x 不同（3.x: bit63=config, bit62=keyframe, 62-bit PTS）。这是需要全新 demuxer 的根因。若真机抓包发现位域不同，调整 `video/demuxer.ts` 中的常量即可。

---

## File Structure

| 文件 | 职责 | 创建/修改 |
|---|---|---|
| `src/lib/scrcpy4/control/resize-display.ts` | RESIZE_DISPLAY 控制消息序列化（5 字节 BE） | 创建 |
| `src/lib/scrcpy4/video/demuxer.ts` | 4.0 视频流解复用：区分会话包/媒体包，输出 Scrcpy4MediaPacket | 创建 |
| `src/lib/scrcpy4/options.ts` | `AdbScrcpyOptions4_0 extends AdbScrcpyOptions3_3_3`，override 4 个成员 | 创建 |
| `src/lib/scrcpy4/flex-client.ts` | FlexDisplayClient 反抖动状态机 | 创建 |
| `src/lib/scrcpy4/index.ts` | 模块公共导出 | 创建 |
| `src/lib/scrcpy4/__tests__/resize-display.test.ts` | 序列化单测 | 创建 |
| `src/lib/scrcpy4/__tests__/demuxer.test.ts` | 解复用单测 | 创建 |
| `src/lib/scrcpy4/__tests__/options.test.ts` | options 序列化单测 | 创建 |
| `src/lib/scrcpy4/__tests__/flex-client.test.ts` | 反抖动状态机单测 | 创建 |
| `public/scrcpy-server.jar` | 替换为 v4.0 | 修改 |
| `src/hooks/scrcpy/useScrcpySession.ts` | 切换 options + 接入 flex-client | 修改 |
| `src/hooks/scrcpy/useVideoDecoder.ts` | pump 循环加 session 包分流 | 修改 |
| `src/components/VirtualScreen.tsx` | 删除销毁重建，接入 flex resize | 修改 |
| `README.md` | 版本号更新 | 修改 |

---

## M1 — 协议件 + 单测

### Task 1: RESIZE_DISPLAY 控制消息序列化

**Files:**
- Create: `src/lib/scrcpy4/control/resize-display.ts`
- Test: `src/lib/scrcpy4/__tests__/resize-display.test.ts`

**Interfaces:**
- Produces: `serializeResizeDisplay(typeByte: number, width: number, height: number): Uint8Array` — 返回 5 字节（type + u16 BE width + u16 BE height）

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/scrcpy4/__tests__/resize-display.test.ts
import { describe, it, expect } from 'vitest';
import { serializeResizeDisplay } from '../control/resize-display';

describe('serializeResizeDisplay', () => {
  it('序列化为 5 字节，大端', () => {
    // typeByte=18, width=1920, height=1080
    const buf = serializeResizeDisplay(18, 1920, 1080);
    expect(buf).toHaveLength(5);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(dv.getUint8(0)).toBe(18);
    expect(dv.getUint16(1, false)).toBe(1920); // false = big-endian
    expect(dv.getUint16(3, false)).toBe(1080);
  });

  it('小尺寸正确编码', () => {
    const buf = serializeResizeDisplay(18, 1280, 960);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(dv.getUint16(1, false)).toBe(1280);
    expect(dv.getUint16(3, false)).toBe(960);
  });

  it('width=0 height=0 边界值', () => {
    const buf = serializeResizeDisplay(0, 0, 0);
    expect(buf).toHaveLength(5);
    expect(buf.every(b => b === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/scrcpy4/__tests__/resize-display.test.ts`
Expected: FAIL with "Cannot find module '../control/resize-display'"

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/scrcpy4/control/resize-display.ts
/**
 * 序列化 scrcpy 4.0 RESIZE_DISPLAY 控制消息。
 * 格式：[type:1] [width:u16 BE] [height:u16 BE] = 5 字节。
 *
 * @param typeByte RESIZE_DISPLAY 的线上 type 字节值，
 *   由 controlMessageTypes.indexOf(ResizeDisplay) 决定（4.0 为 18）。
 */
export function serializeResizeDisplay(
  typeByte: number,
  width: number,
  height: number,
): Uint8Array {
  const buf = new Uint8Array(5);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  dv.setUint8(0, typeByte);
  dv.setUint16(1, width, false);  // false = big-endian
  dv.setUint16(3, height, false);
  return buf;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/scrcpy4/__tests__/resize-display.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/scrcpy4/control/resize-display.ts src/lib/scrcpy4/__tests__/resize-display.test.ts
git commit -m "feat(scrcpy4): RESIZE_DISPLAY 控制消息序列化"
```

---

### Task 2: 4.0 视频流解复用器

**前置手测（非自动化，需真机）：** 在写 demuxer 测试前，建议用真机跑一次 scrcpy 4.0 flex display，用 Wireshark/adb 抓包确认会话包与媒体包的实际字节布局。若与下方假设不同，调整 `PTS_*` 常量。若无抓包条件，按假设实现，M3 手测验收时验证。

**Files:**
- Create: `src/lib/scrcpy4/video/demuxer.ts`
- Test: `src/lib/scrcpy4/__tests__/demuxer.test.ts`

**Interfaces:**
- Produces:
  - `Scrcpy4MediaPacket` 类型（含 `session` 类型的扩展包联合）
  - `createScrcpy4Demuxer(): TransformStream<Uint8Array, Scrcpy4MediaPacket>`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/scrcpy4/__tests__/demuxer.test.ts
import { describe, it, expect } from 'vitest';
import { createScrcpy4Demuxer, type Scrcpy4MediaPacket } from '../video/demuxer';

/** 把多个 Uint8Array 喂入 transform，收集所有输出 packet。 */
async function runDemuxer(chunks: Uint8Array[]): Promise<Scrcpy4MediaPacket[]> {
  const transform = createScrcpy4Demuxer();
  const reader = transform.readable.getReader();
  const writer = transform.writable.getWriter();
  for (const chunk of chunks) {
    await writer.write(chunk);
  }
  await writer.close();
  const packets: Scrcpy4MediaPacket[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    packets.push(value);
  }
  return packets;
}

/** 构造一个会话包（12 字节，MSB=1）。 */
function makeSessionPacket(width: number, height: number, clientResized: boolean): Uint8Array {
  const buf = new Uint8Array(12);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, 0x80); // MSB=1 标识会话包
  if (clientResized) dv.setUint8(3, 0x01); // byte3 LSB = clientResized
  dv.setUint32(4, width, false);  // BE
  dv.setUint32(8, height, false);
  return buf;
}

/** 构造一个媒体包（12 字节头 + payload）。pts 字段位域：bit62=config, bit61=keyframe。 */
function makeMediaPacket(pts: bigint, data: Uint8Array, isConfig = false, isKeyframe = false): Uint8Array {
  const buf = new Uint8Array(12 + data.length);
  const dv = new DataView(buf.buffer);
  let ptsField = pts;
  if (isConfig) ptsField |= (1n << 62n);
  if (isKeyframe) ptsField |= (1n << 61n);
  dv.setBigUint64(0, ptsField, false); // BE，bit63=0 媒体包
  dv.setUint32(8, data.length, false);
  buf.set(data, 12);
  return buf;
}

describe('createScrcpy4Demuxer', () => {
  it('解析会话包（MSB=1，12 字节）', async () => {
    const packets = await runDemuxer([makeSessionPacket(1920, 1080, true)]);
    expect(packets).toHaveLength(1);
    expect(packets[0]).toEqual({
      type: 'session',
      width: 1920,
      height: 1080,
      clientResized: true,
    });
  });

  it('会话包 clientResized=false', async () => {
    const packets = await runDemuxer([makeSessionPacket(800, 600, false)]);
    expect(packets[0]).toMatchObject({ type: 'session', clientResized: false });
  });

  it('解析 configuration 包（bit62=1）', async () => {
    const sps = new Uint8Array([0x67, 0x42, 0x00, 0x1e]);
    const packets = await runDemuxer([makeMediaPacket(0n, sps, true, false)]);
    expect(packets).toHaveLength(1);
    expect(packets[0]).toEqual({ type: 'configuration', data: sps });
  });

  it('解析 keyframe data 包（bit61=1）', async () => {
    const frame = new Uint8Array([1, 2, 3]);
    const packets = await runDemuxer([makeMediaPacket(5000n, frame, false, true)]);
    expect(packets).toHaveLength(1);
    expect(packets[0]).toEqual({
      type: 'data',
      keyframe: true,
      pts: 5000n,
      data: frame,
    });
  });

  it('解析普通 data 包', async () => {
    const frame = new Uint8Array([9, 8, 7]);
    const packets = await runDemuxer([makeMediaPacket(999n, frame, false, false)]);
    expect(packets[0]).toEqual({
      type: 'data',
      keyframe: false,
      pts: 999n,
      data: frame,
    });
  });

  it('混合序列按序输出', async () => {
    const chunks = [
      makeSessionPacket(1920, 1080, true),
      makeMediaPacket(0n, new Uint8Array([0x67]), true, false),      // config
      makeMediaPacket(100n, new Uint8Array([1]), false, true),       // keyframe
      makeSessionPacket(1280, 720, false),                            // 独立 resize
      makeMediaPacket(200n, new Uint8Array([2]), false, false),      // data
    ];
    const packets = await runDemuxer(chunks);
    expect(packets).toHaveLength(5);
    expect(packets.map(p => p.type)).toEqual([
      'session', 'configuration', 'data', 'session', 'data',
    ]);
  });

  it('跨 chunk 边界拼接', async () => {
    const whole = makeMediaPacket(42n, new Uint8Array([5, 6]), false, false);
    // 把 14 字节的包拆成两个 chunk
    const chunks = [whole.slice(0, 5), whole.slice(5)];
    const packets = await runDemuxer(chunks);
    expect(packets).toHaveLength(1);
    expect(packets[0]).toMatchObject({ type: 'data', pts: 42n });
  });

  it('空输入不报错', async () => {
    const packets = await runDemuxer([new Uint8Array(0)]);
    expect(packets).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/scrcpy4/__tests__/demuxer.test.ts`
Expected: FAIL with "Cannot find module '../video/demuxer'"

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/scrcpy4/video/demuxer.ts
/**
 * scrcpy 4.0 视频流解复用器。
 *
 * 4.0 视频流（codec id 之后）每个 packet 用首字节 MSB 区分：
 * - MSB=1 → 会话包（12 字节固定）
 * - MSB=0 → 媒体包（12 字节头 + payload），PTS 位域 bit62=config, bit61=keyframe
 *
 * 3.x 的 MediaStreamRawPacket 假定前 8 字节都是 pts，会话包会被误判，
 * 因此 4.0 必须自写 demuxer（先 sniff MSB 再决定解析方式）。
 */

/** 4.0 PTS 位域常量（3.x 分别是 1n<<63 / 1n<<62 / 62-bit PTS）。 */
const PTS_SESSION = 1n << 63n;   // MSB，会话包标志
const PTS_CONFIG = 1n << 62n;    // configuration 包（SPS/PPS）
const PTS_KEYFRAME = 1n << 61n;  // keyframe 标志
const PTS_MASK = (1n << 61n) - 1n; // 61-bit PTS 掩码

export type Scrcpy4MediaPacket =
  | { type: 'configuration'; data: Uint8Array }
  | { type: 'data'; keyframe: boolean; pts: bigint; data: Uint8Array }
  | { type: 'session'; width: number; height: number; clientResized: boolean };

/**
 * 创建 4.0 视频流解复用 TransformStream。
 * 输入原始字节流，输出 Scrcpy4MediaPacket（含 session 类型）。
 */
export function createScrcpy4Demuxer(): TransformStream<Uint8Array, Scrcpy4MediaPacket> {
  let buffer = new Uint8Array(0);

  const flush = (controller: TransformStreamDefaultController<Scrcpy4MediaPacket>): void => {
    while (buffer.byteLength >= 12) {
      const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const firstByte = dv.getUint8(0);
      const isSession = (firstByte & 0x80) !== 0;

      if (isSession) {
        // 会话包：固定 12 字节
        const width = dv.getUint32(4, false);
        const height = dv.getUint32(8, false);
        const clientResized = (dv.getUint8(3) & 0x01) !== 0;
        controller.enqueue({ type: 'session', width, height, clientResized });
        buffer = buffer.slice(12);
        continue;
      }

      // 媒体包：12 字节头
      const pts = dv.getBigUint64(0, false);
      const size = dv.getUint32(8, false);
      const totalLen = 12 + size;
      if (buffer.byteLength < totalLen) break; // payload 未到齐，等更多数据

      const data = buffer.slice(12, totalLen);

      if ((pts & PTS_CONFIG) !== 0n) {
        controller.enqueue({ type: 'configuration', data });
      } else {
        const keyframe = (pts & PTS_KEYFRAME) !== 0n;
        const realPts = pts & PTS_MASK;
        controller.enqueue({ type: 'data', keyframe, pts: realPts, data });
      }
      buffer = buffer.slice(totalLen);
    }
  };

  return new TransformStream<Uint8Array, Scrcpy4MediaPacket>({
    transform(chunk, controller) {
      if (chunk.byteLength === 0) return;
      // 追加到 buffer
      const merged = new Uint8Array(buffer.byteLength + chunk.byteLength);
      merged.set(buffer, 0);
      merged.set(chunk, buffer.byteLength);
      buffer = merged;
      flush(controller);
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/scrcpy4/__tests__/demuxer.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/scrcpy4/video/demuxer.ts src/lib/scrcpy4/__tests__/demuxer.test.ts
git commit -m "feat(scrcpy4): 4.0 视频流解复用器（会话包+媒体包）"
```

---

### Task 3: AdbScrcpyOptions4_0 — 版本模块与序列化

**Files:**
- Create: `src/lib/scrcpy4/options.ts`
- Test: `src/lib/scrcpy4/__tests__/options.test.ts`

**Interfaces:**
- Consumes: `createScrcpy4Demuxer` from Task 2
- Produces:
  - `AdbScrcpyOptions4_0` class（extends `AdbScrcpyOptions3_3_3`）
  - `AdbScrcpyOptions4_0.Init` 类型（在 3.3.3 Init 基础上加 `flexDisplay?: boolean`、`keepActive?: boolean`）
  - `RESIZE_DISPLAY_TYPE` 常量（= 18）

- [ ] **Step 1: Write the failing test**

```ts
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

  it('controlMessageTypes 含 ResizeDisplay（值为 18，在末尾）', () => {
    const opts = new AdbScrcpyOptions4_0({ video: true, control: true });
    const types = opts.controlMessageTypes;
    expect(types[types.length - 1]).toBe(RESIZE_DISPLAY_TYPE);
    expect(types.indexOf(RESIZE_DISPLAY_TYPE)).toBe(18);
  });

  it('createMediaStreamTransformer 返回 TransformStream', () => {
    const opts = new AdbScrcpyOptions4_0({ video: true, control: true });
    const ts = opts.createMediaStreamTransformer();
    expect(ts).toBeInstanceOf(TransformStream);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/scrcpy4/__tests__/options.test.ts`
Expected: FAIL with "Cannot find module '../options'"

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/scrcpy4/options.ts
import { AdbScrcpyOptions3_3_3, type AdbScrcpyClientOptions } from '@yume-chan/adb-scrcpy';
import { ScrcpyControlMessageType } from '@yume-chan/scrcpy';
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
 * 与 3.x 协议层（parseVideoStreamMetadata 等），仅 override 4.0 变化的 4 个成员：
 * version、controlMessageTypes、serialize、createMediaStreamTransformer。
 */
export class AdbScrcpyOptions4_0<TVideo extends boolean> extends AdbScrcpyOptions3_3_3<TVideo> {
  constructor(init: AdbScrcpyOptions4_0.Init<TVideo>, clientOptions?: AdbScrcpyClientOptions) {
    super(init as AdbScrcpyOptions3_3_3.Init<TVideo>, clientOptions);
  }

  override get version(): string {
    return '4.0';
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

  override createMediaStreamTransformer(): TransformStream<Uint8Array, import('@yume-chan/scrcpy').ScrcpyMediaStreamPacket> {
    // 4.0 demuxer 输出含 session 类型的扩展包，类型声明为 ScrcpyMediaStreamPacket 满足接口。
    // session 包会流过 AdbScrcpyVideoStream 的 inspect 逻辑（仅检查 configuration 类型），
    // 最终在 useVideoDecoder 的 pump 循环中被拦截。
    return createScrcpy4Demuxer() as unknown as TransformStream<Uint8Array, import('@yume-chan/scrcpy').ScrcpyMediaStreamPacket>;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/scrcpy4/__tests__/options.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Run type check**

Run: `npm run check`
Expected: 无新增类型错误（若 `AdbScrcpyOptions3_3_3.Init` 的类型导致 init 传入报错，调整 `as` 断言）

- [ ] **Step 6: Commit**

```bash
git add src/lib/scrcpy4/options.ts src/lib/scrcpy4/__tests__/options.test.ts
git commit -m "feat(scrcpy4): AdbScrcpyOptions4_0 版本模块与序列化"
```

---

### Task 4: FlexDisplayClient 反抖动状态机

**Files:**
- Create: `src/lib/scrcpy4/flex-client.ts`
- Test: `src/lib/scrcpy4/__tests__/flex-client.test.ts`

**Interfaces:**
- Consumes: `serializeResizeDisplay` from Task 1, `RESIZE_DISPLAY_TYPE` from Task 3
- Produces: `FlexDisplayClient` 类，方法：
  - `constructor(opts: { sendResize: (w: number, h: number) => Promise<void>; setCanvasSize: (w: number, h: number) => void; debounceMs?: number })`
  - `setInitialDisplaySize(w: number, h: number): void`
  - `onContainerResize(cssW: number, cssH: number, scale: number, dpr: number): void`
  - `onSessionPacket(w: number, h: number, clientResized: boolean): void`
  - `onDecoderSizeChanged(w: number, h: number): void`
  - `dispose(): void`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/scrcpy4/__tests__/flex-client.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/scrcpy4/__tests__/flex-client.test.ts`
Expected: FAIL with "Cannot find module '../flex-client'"

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/scrcpy4/flex-client.ts
/**
 * Flex display 反抖动状态机。
 *
 * 三道防线避免 resize 环路：
 * 1. 结构性隔离（主防线）：onContainerResize 由 CSS 变化驱动，
 *    onSessionPacket 只改 canvas backing store（setCanvasSize），不改 CSS → 无环路。
 * 2. pendingResize squash：未确认前新请求覆盖旧请求。
 * 3. clientResized 标志：仅 clientResized=true 的 session 包清除 pending。
 */

export interface FlexDisplayClientOptions {
  /** 发送 RESIZE_DISPLAY 控制消息（由调用方包装 writer.write）。 */
  sendResize: (width: number, height: number) => Promise<void>;
  /** 设置 canvas backing store 尺寸（canvas.width/height，非 CSS）。 */
  setCanvasSize: (width: number, height: number) => void;
  /** 防抖时间，默认 150ms。 */
  debounceMs?: number;
}

export class FlexDisplayClient {
  private currentDisplaySize: { w: number; h: number } | null = null;
  private pendingResize: { w: number; h: number } | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly sendResize: (w: number, h: number) => Promise<void>;
  private readonly setCanvasSize: (w: number, h: number) => void;

  constructor(opts: FlexDisplayClientOptions) {
    this.sendResize = opts.sendResize;
    this.setCanvasSize = opts.setCanvasSize;
    this.debounceMs = opts.debounceMs ?? 150;
  }

  /** 设置初始虚拟屏尺寸（来自 startScrcpy 的 displayConfig）。 */
  setInitialDisplaySize(w: number, h: number): void {
    this.currentDisplaySize = { w, h };
  }

  /** ResizeObserver 回调（CSS 尺寸变化）。 */
  onContainerResize(cssW: number, cssH: number, scale: number, dpr: number): void {
    const target = {
      w: Math.round(cssW * scale * dpr),
      h: Math.round(cssH * scale * dpr),
    };
    // 尺寸已匹配且无 pending → 不发
    if (
      this.pendingResize === null &&
      this.currentDisplaySize !== null &&
      this.currentDisplaySize.w === target.w &&
      this.currentDisplaySize.h === target.h
    ) {
      return;
    }

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.requestResize(target);
    }, this.debounceMs);
  }

  private requestResize(target: { w: number; h: number }): void {
    // squash：只保留最新请求
    this.pendingResize = target;
    this.sendResize(target.w, target.h).catch((e) => {
      console.warn('[FlexClient] RESIZE_DISPLAY 发送失败:', e);
    });
  }

  /** demuxer 解出 session 包时调用。 */
  onSessionPacket(w: number, h: number, clientResized: boolean): void {
    this.currentDisplaySize = { w, h };
    // 通知 canvas backing store 更新
    this.setCanvasSize(w, h);

    if (clientResized) {
      // 客户端请求的 resize 被确认，清除 pending
      if (
        this.pendingResize !== null &&
        this.pendingResize.w === w &&
        this.pendingResize.h === h
      ) {
        this.pendingResize = null;
      }
    } else {
      // 独立变化（如 App 自旋转），不清除 pending；若 pending 仍在，重发以校正
      if (this.pendingResize !== null) {
        this.sendResize(this.pendingResize.w, this.pendingResize.h).catch((e) => {
          console.warn('[FlexClient] RESIZE_DISPLAY 重发失败:', e);
        });
      }
    }
  }

  /** WebCodecs 解码器 sizeChanged（新 SPS/PPS 到达）时调用。 */
  onDecoderSizeChanged(w: number, h: number): void {
    this.setCanvasSize(w, h);
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingResize = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/scrcpy4/__tests__/flex-client.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/scrcpy4/flex-client.ts src/lib/scrcpy4/__tests__/flex-client.test.ts
git commit -m "feat(scrcpy4): FlexDisplayClient 反抖动状态机"
```

---

### Task 5: 模块公共导出

**Files:**
- Create: `src/lib/scrcpy4/index.ts`

**Interfaces:**
- Re-exports all public symbols from Tasks 1-4

- [ ] **Step 1: Write the module**

```ts
// src/lib/scrcpy4/index.ts
export { serializeResizeDisplay } from './control/resize-display';
export { createScrcpy4Demuxer, type Scrcpy4MediaPacket } from './video/demuxer';
export { AdbScrcpyOptions4_0, RESIZE_DISPLAY_TYPE } from './options';
export { FlexDisplayClient, type FlexDisplayClientOptions } from './flex-client';
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: 无错误

- [ ] **Step 3: Run all scrcpy4 tests**

Run: `npm test -- src/lib/scrcpy4`
Expected: PASS (全部 27 tests)

- [ ] **Step 4: Commit**

```bash
git add src/lib/scrcpy4/index.ts
git commit -m "feat(scrcpy4): 模块公共导出"
```

---

## M2 — server jar 替换 + options 接入

### Task 6: 替换 server jar 为 v4.0 + 更新 README

**Files:**
- Modify: `public/scrcpy-server.jar`（二进制，手动下载替换）
- Modify: `README.md`

- [ ] **Step 1: 下载 v4.0 server jar**

从 https://github.com/Genymobile/scrcpy/releases/tag/v4.0 下载 `scrcpy-server-v4.0`，替换 `public/scrcpy-server.jar`。

```bash
# 确认文件已替换且非空
ls -la public/scrcpy-server.jar
```

- [ ] **Step 2: 更新 README 版本声明**

在 `README.md` 中搜索 `3.3.3`（约第 90 行和第 122 行），替换为 `4.0`。

- [ ] **Step 3: Commit**

```bash
git add public/scrcpy-server.jar README.md
git commit -m "feat(scrcpy4): 替换 server jar 为 v4.0"
```

---

### Task 7: useScrcpySession 切换到 AdbScrcpyOptions4_0（不开 flex）

**Files:**
- Modify: `src/hooks/scrcpy/useScrcpySession.ts:2,5,77,103,136-153,157`

**目的：** 用 4.0 协议跑通现有功能（镜像 + 虚拟屏固定尺寸），`flexDisplay=false`，暂不接入 flex resize。尺寸变化仍走旧销毁重建（M3 再替换）。

- [ ] **Step 1: 更新 import**

在 `src/hooks/scrcpy/useScrcpySession.ts` 顶部，把 `@yume-chan/adb-scrcpy` 和 `@yume-chan/scrcpy` 的 import 调整为引入 4.0 options：

```ts
// 替换原有的 AdbScrcpyOptionsLatest import
import type { AdbScrcpyClient } from '@yume-chan/adb-scrcpy';
import { AdbScrcpyExitedError } from '@yume-chan/adb-scrcpy';
import type { ScrcpyControlMessageWriter } from '@yume-chan/scrcpy';
import { ScrcpyNewDisplay, ScrcpyCaptureOrientation } from '@yume-chan/scrcpy';
import { AdbScrcpyOptions4_0 } from '@/lib/scrcpy4';
```

- [ ] **Step 2: 更新 clientRef 泛型**

将 `clientRef` 的类型从 `AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>` 改为 `AdbScrcpyClient<AdbScrcpyOptions4_0<true>>`：

```ts
const clientRef = useRef<AdbScrcpyClient<AdbScrcpyOptions4_0<true>> | null>(null);
```

- [ ] **Step 3: 替换 options 构造**

在 `startScrcpy` 中（原第 103 行 `const { AdbScrcpyClient, AdbScrcpyOptionsLatest } = await import(...)` 处），改为动态导入 4.0 options：

```ts
const { AdbScrcpyClient } = await import('@yume-chan/adb-scrcpy');
const { AdbScrcpyOptions4_0 } = await import('@/lib/scrcpy4');
```

将原 `new AdbScrcpyOptionsLatest({...})` 替换为：

```ts
const options = new AdbScrcpyOptions4_0({
  video: true,
  videoCodec: 'h264',
  videoBitRate: displayConfig?.bitRate ?? 8000000,
  maxFps: 60,
  audio: true,
  control: true,
  stayAwake: true,
  showTouches: false,
  ...(useVirtualDisplay
    ? {
        newDisplay: new ScrcpyNewDisplay(displayConfig.width, displayConfig.height, displayConfig.dpi ?? 320),
        captureOrientation: ScrcpyCaptureOrientation.Unlocked,
        displayImePolicy: 'local' as const,
        // M2 阶段暂不开 flex，M3 接入
        flexDisplay: false,
      }
    : { displayId: 0 }
  ),
});
```

- [ ] **Step 4: Run type check**

Run: `npm run check`
Expected: 无类型错误。若 `useVideoDecoder`/`useAudioDecoder` 的 client 参数类型报错（因泛型从 Latest 改为 4_0），将其参数类型放宽为 `AdbScrcpyClient<AdbScrcpyOptions4_0<true>>`。

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: 全部 PASS（4.0 单测 + 现有测试）

- [ ] **Step 6: Commit**

```bash
git add src/hooks/scrcpy/useScrcpySession.ts
git commit -m "feat(scrcpy4): useScrcpySession 切换到 4.0 options（不开 flex）"
```

---

## M3 — flex resize 接入

### Task 8: useVideoDecoder 加 session 包分流

**Files:**
- Modify: `src/hooks/scrcpy/useVideoDecoder.ts`

**目的：** pump 循环识别 4.0 session 包，不写解码器，通过回调通知 flex-client。

- [ ] **Step 1: 更新 setupVideoStream 签名与 pump 循环**

修改 `src/hooks/scrcpy/useVideoDecoder.ts`，给 `setupVideoStream` 增加可选参数 `onSessionPacket`，并在 pump 循环中拦截 session 包：

```ts
// src/hooks/scrcpy/useVideoDecoder.ts（完整替换）
import { useRef, useCallback, useMemo } from 'react';
import type { AdbScrcpyClient } from '@yume-chan/adb-scrcpy';
import type { AdbScrcpyOptions4_0, Scrcpy4MediaPacket } from '@/lib/scrcpy4';
import type { WebCodecsVideoDecoder } from '@yume-chan/scrcpy-decoder-webcodecs';

export interface VideoDecoderState {
  videoWidth: number;
  videoHeight: number;
}

export function useVideoDecoder() {
  const decoderRef = useRef<WebCodecsVideoDecoder | null>(null);
  const cleanupRef = useRef<(() => Promise<void>) | null>(null);

  const setupVideoStream = useCallback(async (
    client: AdbScrcpyClient<AdbScrcpyOptions4_0<true>>,
    canvas: HTMLCanvasElement,
    onSizeChanged: (width: number, height: number) => void,
    onSessionPacket?: (width: number, height: number, clientResized: boolean) => void,
  ) => {
    const { WebCodecsVideoDecoder } = await import('@yume-chan/scrcpy-decoder-webcodecs');
    const { WebGLVideoFrameRenderer } = await import('@yume-chan/scrcpy-decoder-webcodecs/esm/video/render/webgl.js');

    const videoStream = await client.videoStream;
    if (!videoStream) {
      throw new Error('无法获取视频流');
    }

    const renderer = new WebGLVideoFrameRenderer(canvas);
    const decoder = new WebCodecsVideoDecoder({
      codec: videoStream.metadata.codec,
      renderer,
    });

    decoderRef.current = decoder;

    const sizeUnsubscribe = videoStream.sizeChanged((size) => {
      onSizeChanged(size.width, size.height);
    });

    const stream = videoStream.stream;
    const reader = stream.getReader();

    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // 4.0 session 包：不写解码器，通知 flex-client
          const packet = value as Scrcpy4MediaPacket;
          if (packet.type === 'session') {
            onSessionPacket?.(packet.width, packet.height, packet.clientResized);
            continue;
          }

          // configuration / data 包原样写解码器
          const writer = decoder.writable.getWriter();
          try {
            await writer.write(value);
          } finally {
            writer.releaseLock();
          }
        }
      } catch (error) {
        console.error('视频流读取错误:', error);
      }
    };

    pump();

    cleanupRef.current = async () => {
      sizeUnsubscribe();
      await reader.cancel();
    };

    return {
      width: videoStream.width,
      height: videoStream.height,
    };
  }, []);

  const dispose = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (decoderRef.current) {
      decoderRef.current.dispose();
      decoderRef.current = null;
    }
  }, []);

  return useMemo(() => ({
    setupVideoStream,
    dispose,
  }), [setupVideoStream, dispose]);
}
```

- [ ] **Step 2: Run type check**

Run: `npm run check`
Expected: 无类型错误

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add src/hooks/scrcpy/useVideoDecoder.ts
git commit -m "feat(scrcpy4): useVideoDecoder 加 session 包分流"
```

---

### Task 9: useScrcpySession 接入 FlexDisplayClient

**Files:**
- Modify: `src/hooks/scrcpy/useScrcpySession.ts`

**目的：** 启用 `flexDisplay=true`，创建 FlexDisplayClient，暴露给 VirtualScreen。

- [ ] **Step 1: 添加 flexClientRef 与 import**

在 `src/hooks/scrcpy/useScrcpySession.ts` 顶部增加 import：

```ts
import { FlexDisplayClient, serializeResizeDisplay, RESIZE_DISPLAY_TYPE } from '@/lib/scrcpy4';
```

在 ref 声明区（约第 77-82 行）增加：

```ts
const flexClientRef = useRef<FlexDisplayClient | null>(null);
```

- [ ] **Step 2: 启用 flexDisplay 并创建 FlexDisplayClient**

在 `startScrcpy` 的 options 构造中，把 `flexDisplay: false` 改为 `flexDisplay: true`，并加 `keepActive: true`：

```ts
...(useVirtualDisplay
  ? {
      newDisplay: new ScrcpyNewDisplay(displayConfig.width, displayConfig.height, displayConfig.dpi ?? 320),
      captureOrientation: ScrcpyCaptureOrientation.Unlocked,
      displayImePolicy: 'local' as const,
      flexDisplay: true,
      keepActive: true,
    }
  : { displayId: 0 }
),
```

在 `videoDecoder.setupVideoStream` 调用处（原第 176 行），改为传入 `onSessionPacket` 回调，并在之后创建 FlexDisplayClient：

```ts
// 计算 RESIZE_DISPLAY 的 type 字节值
const resizeTypeByte = options.controlMessageTypes.indexOf(RESIZE_DISPLAY_TYPE);

const flexClient = useVirtualDisplay ? new FlexDisplayClient({
  sendResize: async (w, h) => {
    const controller = controllerRef.current;
    if (!controller) return;
    await controller.write(serializeResizeDisplay(resizeTypeByte, w, h));
  },
  setCanvasSize: (w, h) => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = w;
      canvas.height = h;
    }
  },
}) : null;
flexClientRef.current = flexClient;

const { width, height } = await videoDecoder.setupVideoStream(
  client,
  canvas,
  // videoStream.sizeChanged（从 configuration 包解析尺寸）：
  // 既更新 state（供 CSS letterbox），也通知 flex-client 更新 canvas backing store
  (w, h) => {
    setState(prev => ({ ...prev, videoWidth: w, videoHeight: h }));
    flexClient?.onDecoderSizeChanged(w, h);
  },
  // 4.0 session 包回调（反抖动状态机）
  flexClient ? (w, h, clientResized) => flexClient.onSessionPacket(w, h, clientResized) : undefined,
);

if (flexClient && displayConfig) {
  flexClient.setInitialDisplaySize(displayConfig.width, displayConfig.height);
}
```

注意：`canvasRef` 在 `useScrcpySession` 中不存在（它在 VirtualScreen 里）。需要给 `startScrcpy` 增加一个 `canvasRef` 参数，或改为让 VirtualScreen 传入 `setCanvasSize` 回调。采用后者——给 `startScrcpy` 增加可选参数 `setCanvasSize?: (w: number, h: number) => void`：

```ts
const startScrcpy = useCallback(async (
  adb: Adb,
  canvas: HTMLCanvasElement,
  displayConfig?: DisplayConfig,
  setCanvasSize?: (w: number, h: number) => void,
) => {
```

`FlexDisplayClient` 的 `setCanvasSize` 用传入的回调：

```ts
setCanvasSize: setCanvasSize ?? ((w, h) => { canvas.width = w; canvas.height = h; }),
```

- [ ] **Step 3: 在 stopScrcpy 中清理 flexClient**

在 `stopScrcpy` 函数中（`videoDecoder.dispose()` 附近）增加：

```ts
if (flexClientRef.current) {
  flexClientRef.current.dispose();
  flexClientRef.current = null;
}
```

- [ ] **Step 4: 暴露 flexClient 给 VirtualScreen**

在 hook 的 return 对象中增加：

```ts
return {
  ...state,
  // ... 现有字段 ...
  flexClient: flexClientRef.current,
  // ... 其余 ...
};
```

- [ ] **Step 5: Run type check**

Run: `npm run check`
Expected: 无类型错误

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 7: Commit**

```bash
git add src/hooks/scrcpy/useScrcpySession.ts
git commit -m "feat(scrcpy4): useScrcpySession 接入 FlexDisplayClient"
```

---

### Task 10: VirtualScreen 删除销毁重建，接入 flex resize

**Files:**
- Modify: `src/components/VirtualScreen.tsx`

**目的：** 删除销毁重建式 resize（第 129-187 行），改为通过 flexClient 请求 resize。

- [ ] **Step 1: 移除销毁重建相关的 ref/state**

删除以下 ref/state 声明（约第 38-41 行附近）：
- `foregroundAppRef`
- `lastStartedDimensionsRef`
- `restartCount`（及其 setter）
- `debounceTimerRef`

- [ ] **Step 2: 从 context 获取 flexClient**

在 `VirtualScreen` 组件中，从 `useScrcpyContext()` 解构 `flexClient`：

```ts
const { startScrcpy, stopScrcpy, injectTouch, injectText, resumeAudio, isStarting, isRunning, error, videoWidth, videoHeight, isVirtualDisplay, getForegroundApp, startAppOnDisplay, flexClient } = useScrcpyContext();
```

- [ ] **Step 3: 替换 ResizeObserver 回调**

将 ResizeObserver 回调（约第 50-59 行）从 `setContainerSize` 改为调用 `flexClient.onContainerResize`：

```ts
const resizeObserver = new ResizeObserver((entries) => {
  const entry = entries[0];
  if (entry) {
    const { width, height } = entry.contentRect;
    setContainerSize({ width, height });
    // flex resize：通知 flex-client（仅虚拟屏模式）
    if (flexClient && !useMirrorMode) {
      flexClient.onContainerResize(width, height, currentPreset.scale, dpr);
    }
  }
});
```

注意：`setContainerSize` 仍保留（用于 `calculateAdaptiveSize` 的 CSS letterbox 计算），但不再触发重启。

- [ ] **Step 4: 删除销毁重建 resize effect**

**整块删除**第 129-176 行的 resize effect（防抖 500ms → getForegroundApp → stopScrcpy → 轮询 dumpsys → setRestartCount）。

**整块删除**第 178-187 行的 Effect3（恢复前台应用）——flex 下不重启会话，应用不中断。

- [ ] **Step 5: 简化启动 effect**

启动 effect（第 78-127 行）移除对 `restartCount` 的依赖，移除 `lastStartedDimensionsRef` 逻辑。首次启动仍用 `displayConfig` 作为初始尺寸，传 `setCanvasSize` 回调给 `startScrcpy`：

```ts
useEffect(() => {
  if (!active) return;
  const canvas = canvasRef.current;
  const adb = store.adb;
  if (!canvas || !adb) return;
  if (!useMirrorMode && (containerSize.width === 0 || containerSize.height === 0)) return;

  if (!isRunning && !isStarting && !hasStartedRef.current) {
    if (initialStartTimerRef.current) clearTimeout(initialStartTimerRef.current);
    initialStartTimerRef.current = setTimeout(() => {
      if (hasStartedRef.current) return;
      hasStartedRef.current = true;
      console.log('[VirtualScreen] 首次启动 scrcpy');
      const setCanvasSize = (w: number, h: number) => {
        if (canvasRef.current) {
          canvasRef.current.width = w;
          canvasRef.current.height = h;
        }
      };
      if (useMirrorMode) {
        startScrcpy(adb, canvas, undefined, setCanvasSize);
      } else {
        startScrcpy(adb, canvas, displayConfig, setCanvasSize);
      }
      initialStartDoneRef.current = true;
    }, 200);

    return () => {
      if (initialStartTimerRef.current) {
        clearTimeout(initialStartTimerRef.current);
        initialStartTimerRef.current = null;
      }
    };
  }
}, [active, store.adb, isRunning, isStarting, useMirrorMode, containerSize.width, containerSize.height, displayConfig, startScrcpy]);
```

- [ ] **Step 6: Run type check**

Run: `npm run check`
Expected: 无类型错误。若有未使用的 import（如 `runAdbCommand`、`getForegroundApp` 等仅在已删除 effect 中使用的），移除它们。

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 8: Commit**

```bash
git add src/components/VirtualScreen.tsx
git commit -m "feat(scrcpy4): VirtualScreen 删除销毁重建，接入 flex resize"
```

---

## M4 — 清理 + 文档

### Task 11: 移除废弃代码 + ADR + 文档更新

**Files:**
- Modify: `src/hooks/scrcpy/useScrcpySession.ts`（移除废弃的 `resizeDisplay` shell 路径）
- Modify: `src/lib/adb-commands.ts`（若 `resizeDisplay` 不再被任何代码调用，移除）
- Create: `docs/adr/0004-scrcpy4-flex-display.md`
- Modify: `README.md`

- [ ] **Step 1: 移除废弃的 resizeDisplay shell 路径**

在 `src/hooks/scrcpy/useScrcpySession.ts` 中，移除 `resizeDisplay` 函数（原第 342-352 行，走 `adbResizeDisplay` + `resetVideo`），以及 return 对象中的 `resizeDisplay` 字段。

在 `src/lib/adb-commands.ts` 中，检查 `resizeDisplay`（即 `adbResizeDisplay`）是否还被其他地方引用。若无，移除该函数。

Run: `npm run check` 确认无引用残留。

- [ ] **Step 2: 创建 ADR**

```markdown
<!-- docs/adr/0004-scrcpy4-flex-display.md -->
# ADR-0004: 迁移至 scrcpy 4.0 flex display

- 日期：2026-07-01
- 状态：已采纳

## 背景

CarWeb 使用 scrcpy 3.x 虚拟屏，尺寸变化需销毁重建会话（1–2s 黑屏）。

## 决策

自研 scrcpy 4.0 客户端协议适配层（`src/lib/scrcpy4/`），启用 flex display，
通过 RESIZE_DISPLAY 控制消息 + 视频流会话包实现运行时动态 resize。

不复用 @yume-chan/scrcpy 的 3.x demuxer（PTS 位域不同），自写 4.0 demuxer。
不 fork node_modules，通过 `AdbScrcpyOptions4_0 extends AdbScrcpyOptions3_3_3`
override 4 个成员复用全部 adb 层。

反抖动采用 CSS/backing-store 结构性隔离（ResizeObserver 监 CSS，
会话包只改 canvas.width/height），避免 resize 环路。

## 关联

- 设计文档：`docs/superpowers/specs/2026-07-01-scrcpy4-flex-display-design.md`
- 替代：ADR-0003（虚拟屏自动 resize 的销毁重建方案）
```

- [ ] **Step 3: 更新 README**

在 `README.md` 中更新 scrcpy 相关说明，反映 4.0 + flex display（移除 3.x 销毁重建式 resize 的描述，说明现在支持运行时动态 resize）。

- [ ] **Step 4: Run all tests + type check**

Run: `npm test && npm run check`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(scrcpy4): 移除废弃 resize 代码 + ADR-0004 + 文档更新"
```

---

## 手测验收清单（M3 完成后执行）

- [ ] 虚拟屏运行中拖动浏览器窗口改变尺寸：画面 <300ms 跟随、无黑屏、前台应用（如地图）不中断、无重启日志。
- [ ] resize 后 `am start --display <id>` 仍命中同一 displayId（`adb shell dumpsys display` 验证 displayId 未变）。
- [ ] 镜像模式正常工作（4.0 协议、不开 flex）。
- [ ] 首次启动冷启动时间与 3.x 基线相当（flex 不改善冷启动，不应劣化）。
- [ ] 连续快速 resize（拖拽中）不堆积请求、不抖动循环。

## 风险缓解

- **会话包字节布局假设错误**（高风险）：M1 Task 2 前置手测抓包验证。若位域不同，调整 `src/lib/scrcpy4/video/demuxer.ts` 中的 `PTS_*` 常量。
- **反抖动真机表现不符**：flex-client 单测锁死逻辑；手测覆盖连续快速 resize。
- **4.0 server 在目标设备不支持 flex**：手测验收包含目标设备；不支持时明确报错（不做 3.x 回退）。
