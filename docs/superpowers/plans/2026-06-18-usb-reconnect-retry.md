# USB 自动重连重试机制实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 页面刷新后 USB 自动重连不再因手机端旧 adbd 连接未清理而报错，改为乐观立即尝试 + 指数退避重试，重试过程对用户表现为加载态而非错误态，最终失败才温和降级到手动连接。

**Architecture:** 将可测试的重试策略与错误分类逻辑提取为纯函数模块 `usb-retry.ts`（vitest 覆盖），`useUsbConnection` 作为集成层调用这些纯函数；`App.tsx` 的 overlay 状态机细化出"重试中"与"失败兜底"两个子阶段；`ConnectionOverlay.tsx` 配合渲染对应的无错误加载/降级 UI。

**Tech Stack:** React 18、TypeScript、Zustand、vitest、@yume-chan/adb-daemon-webusb、tailwindcss、lucide-react。

---

## File Structure

| 文件 | 操作 | 职责 |
|---|---|---|
| `src/lib/usb-retry.ts` | 创建 | 纯函数：重试退避序列、瞬时错误判定、设备引用刷新策略。无 React / WebUSB 副作用依赖，可单测。 |
| `src/lib/__tests__/usb-retry.test.ts` | 创建 | 覆盖 `RETRY_DELAYS`、`isTransientError`、`isFatalError` 的单测。 |
| `src/hooks/useUsbConnection.ts` | 修改 | 重写 `tryAutoConnectUsb` 为带退避重试循环；调整 `ensureDeviceReady` 为 reset 优先；手动路径 `connectUsb` 保留错误展示但去掉噪音日志。 |
| `src/components/ConnectionOverlay.tsx` | 修改 | 新增 `reconnecting` / `reconnect-failed` 两个 overlayState 子态的渲染分支（加载脉冲动画 + 温和降级提示，无红色 error）。 |
| `src/App.tsx` | 修改 | 扩展 `OverlayState` 类型；`useUsbConnection` 暴露重试进度回调驱动 overlay 状态切换；`beforeunload` 改为 `void adb.close()`。 |

**设计取舍说明（不做"自适应退避"）：** 用户明确指出并非每次连接都撞到刷新竞态，自适应记忆难度会引入 localStorage 复杂度且收益有限。本计划用**固定退避序列**：`[0, 500, 1200, 2000]`（首次立即乐观），P50 < 1s，最坏 ~3.7s。

---

## Task 1: 创建重试策略纯函数模块

**Files:**
- Create: `src/lib/usb-retry.ts`
- Test: `src/lib/__tests__/usb-retry.test.ts`

- [ ] **Step 1: Write the failing test**

创建 `src/lib/__tests__/usb-retry.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { RETRY_DELAYS, isTransientError, isFatalError } from '../usb-retry';

describe('usb-retry', () => {
  describe('RETRY_DELAYS', () => {
    it('首次尝试延迟为 0（乐观立即连）', () => {
      expect(RETRY_DELAYS[0]).toBe(0);
    });

    it('总共提供 4 次尝试机会', () => {
      expect(RETRY_DELAYS).toHaveLength(4);
    });

    it('延迟严格递增（指数退避）', () => {
      for (let i = 1; i < RETRY_DELAYS.length; i++) {
        expect(RETRY_DELAYS[i]).toBeGreaterThan(RETRY_DELAYS[i - 1]);
      }
    });

    it('最坏总耗时不超过 5 秒', () => {
      const total = RETRY_DELAYS.reduce((a, b) => a + b, 0);
      expect(total).toBeLessThanOrEqual(5000);
    });
  });

  describe('isTransientError', () => {
    it('识别 Connection closed unexpectedly 为瞬时错误', () => {
      expect(isTransientError(new Error('Connection closed unexpectedly'))).toBe(true);
    });

    it('识别 Failed to open device 为瞬时错误', () => {
      expect(isTransientError(new Error('Failed to open device.'))).toBe(true);
    });

    it('识别 Unable to claim interface 为瞬时错误', () => {
      expect(isTransientError(new Error('Unable to claim interface.'))).toBe(true);
    });

    it('对未知错误返回 false', () => {
      expect(isTransientError(new Error('something else'))).toBe(false);
    });

    it('对非 Error 对象返回 false', () => {
      expect(isTransientError('string error')).toBe(false);
      expect(isTransientError(null)).toBe(false);
      expect(isTransientError(undefined)).toBe(false);
    });
  });

  describe('isFatalError', () => {
    it('识别 Access Denied 为致命错误（用户未授权）', () => {
      expect(isFatalError(new Error('Access Denied.'))).toBe(true);
    });

    it('识别 Not Found 为致命错误（设备已拔出）', () => {
      expect(isFatalError(new Error('NotFoundError: No device'))).toBe(true);
    });

    it('对瞬时错误返回 false', () => {
      expect(isFatalError(new Error('Connection closed unexpectedly'))).toBe(false);
    });

    it('对未知错误返回 false（默认走重试）', () => {
      expect(isFatalError(new Error('weird'))).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/usb-retry.test.ts`
Expected: FAIL — 模块不存在，报 `Failed to resolve import "../usb-retry"`。

- [ ] **Step 3: Write minimal implementation**

创建 `src/lib/usb-retry.ts`：

```ts
/**
 * USB 自动重连的纯策略函数。
 *
 * 设计目标：页面刷新后手机端 adbd 旧连接尚未释放，新连接会被对端关闭
 * （"Connection closed unexpectedly"）。本模块用固定的指数退避序列覆盖该竞态，
 * 而非做任何持久化记忆——因为并非每次连接都撞到刷新竞态。
 */

/** 每次尝试前的等待毫秒数；索引即第几次尝试（0 = 立即乐观）。 */
export const RETRY_DELAYS: readonly number[] = [0, 500, 1200, 2000] as const;

/** 匹配刷新竞态/USB 接口暂被占用类错误的正则。 */
const TRANSIENT_PATTERNS: RegExp[] = [
  /connection closed unexpectedly/i,
  /failed to open/i,
  /unable to claim interface/i,
  /device not configured/i,
  /network error/i,
];

/** 匹配不可恢复、重试无意义的错误正则（用户未授权、设备已移除）。 */
const FATAL_PATTERNS: RegExp[] = [
  /access denied/i,
  /not found/i,
  /securityerror/i,
  /no device/i,
];

/** 判定一个错误是否值得继续重试（瞬时错误）。 */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message;
  return TRANSIENT_PATTERNS.some((re) => re.test(message));
}

/** 判定一个错误是否致命（重试无意义，应立即停止）。 */
export function isFatalError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message;
  return FATAL_PATTERNS.some((re) => re.test(message));
}

/**
 * 判定是否应该继续重试。
 *
 * 约定：致命错误永不重试；其余未知错误默认重试（保守策略——宁可多试一次
 * 让用户连上，也不轻易放弃进手动态）。
 */
export function shouldRetry(error: unknown): boolean {
  return !isFatalError(error);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/usb-retry.test.ts`
Expected: PASS — 全部用例通过。

- [ ] **Step 5: Commit**

```bash
git add src/lib/usb-retry.ts src/lib/__tests__/usb-retry.test.ts
git commit -m "feat(usb): add pure retry-strategy helpers for reconnect"
```

---

## Task 2: 用纯函数驱动重试循环的连接编排器

把"按序列重试 + 每轮重新枚举设备 + 报告进度"封装成一个**不依赖 React、但接受注入依赖**的函数 `retryConnectUsb`，便于单测其编排行为（重试次数、进度回调、提前终止）。

**Files:**
- Create: `src/lib/usb-connect.ts`
- Test: `src/lib/__tests__/usb-connect.test.ts`

- [ ] **Step 1: Write the failing test**

创建 `src/lib/__tests__/usb-connect.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { retryConnectUsb } from '../usb-connect';
import type { RetryConnectDeps } from '../usb-connect';

class MockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Error';
  }
}

function makeDeps(overrides: Partial<RetryConnectDeps> = {}): RetryConnectDeps {
  return {
    findDevice: vi.fn().mockResolvedValue({ serial: 'S1' } as never),
    connectOnce: vi.fn().mockResolvedValue(undefined),
    prepareDevice: vi.fn().mockResolvedValue(undefined),
    sleep: vi.fn().mockResolvedValue(undefined),
    isCancelled: () => false,
    ...overrides,
  };
}

describe('retryConnectUsb', () => {
  it('首次成功则不重试、不 sleep', async () => {
    const deps = makeDeps();
    const result = await retryConnectUsb('S1', deps);
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(deps.connectOnce).toHaveBeenCalledTimes(1);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('瞬时错误触发重试直到成功', async () => {
    const deps = makeDeps({
      connectOnce: vi
        .fn()
        .mockRejectedValueOnce(new MockError('Connection closed unexpectedly'))
        .mockResolvedValueOnce(undefined),
    });
    const result = await retryConnectUsb('S1', deps);
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(deps.sleep).toHaveBeenCalledTimes(1);
  });

  it('致命错误立即终止，不重试', async () => {
    const deps = makeDeps({
      connectOnce: vi.fn().mockRejectedValue(new MockError('Access Denied.')),
    });
    const result = await retryConnectUsb('S1', deps);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(deps.connectOnce).toHaveBeenCalledTimes(1);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('用尽重试次数后失败', async () => {
    const deps = makeDeps({
      connectOnce: vi.fn().mockRejectedValue(new MockError('Connection closed unexpectedly')),
    });
    const result = await retryConnectUsb('S1', deps);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(4); // RETRY_DELAYS.length
    expect(deps.connectOnce).toHaveBeenCalledTimes(4);
  });

  it('每次尝试前重新枚举设备（prepareDevice）', async () => {
    const deps = makeDeps({
      connectOnce: vi
        .fn()
        .mockRejectedValueOnce(new MockError('Connection closed unexpectedly'))
        .mockResolvedValueOnce(undefined),
    });
    await retryConnectUsb('S1', deps);
    expect(deps.prepareDevice).toHaveBeenCalledTimes(2);
  });

  it('设备枚举不到时立即失败（不重试）', async () => {
    const deps = makeDeps({
      findDevice: vi.fn().mockResolvedValue(null),
    });
    const result = await retryConnectUsb('S1', deps);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
    expect(deps.connectOnce).not.toHaveBeenCalled();
  });

  it('进度回调报告每次尝试的序号', async () => {
    const deps = makeDeps({
      connectOnce: vi
        .fn()
        .mockRejectedValueOnce(new MockError('Connection closed unexpectedly'))
        .mockRejectedValueOnce(new MockError('Connection closed unexpectedly'))
        .mockResolvedValueOnce(undefined),
    });
    const onProgress = vi.fn();
    await retryConnectUsb('S1', { ...deps, onProgress });
    // 第 1 次：attempt=1/4；重试；第 2 次 attempt=2/4；重试；第 3 次成功
    expect(onProgress).toHaveBeenCalledWith({ attempt: 1, total: 4, retrying: false });
    expect(onProgress).toHaveBeenCalledWith({ attempt: 2, total: 4, retrying: true });
    expect(onProgress).toHaveBeenCalledWith({ attempt: 3, total: 4, retrying: true });
  });

  it('外部取消时立即停止', async () => {
    let cancelled = false;
    const deps = makeDeps({
      connectOnce: vi.fn().mockRejectedValue(new MockError('Connection closed unexpectedly')),
      isCancelled: () => cancelled,
    });
    // 在第一次失败后触发取消
    setTimeout(() => { cancelled = true; }, 0);
    const result = await retryConnectUsb('S1', deps);
    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/usb-connect.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: Write minimal implementation**

创建 `src/lib/usb-connect.ts`：

```ts
import { RETRY_DELAYS, shouldRetry } from './usb-retry';

/** 单次连接尝试所用的依赖（注入以便测试）。 */
export interface RetryConnectDeps {
  /** 根据序列号重新枚举并返回当前可用的设备引用；找不到返回 null。 */
  findDevice: (serial: string) => Promise<unknown | null>;
  /** 在 connect 前恢复设备到干净状态（reset/close）。 */
  prepareDevice: (device: unknown) => Promise<void>;
  /** 真正执行一次 device.connect → authenticate → adb 建立。失败则 reject。 */
  connectOnce: (device: unknown) => Promise<void>;
  /** 可注入的 sleep，便于测试同步化。 */
  sleep: (ms: number) => Promise<void>;
  /** 外部取消探测；返回 true 时立即停止重试。 */
  isCancelled: () => boolean;
}

export interface RetryProgress {
  /** 本次是第几次尝试（从 1 开始）。 */
  attempt: number;
  /** 总尝试次数上限。 */
  total: number;
  /** 本次是否处于重试（attempt > 1）。 */
  retrying: boolean;
}

export interface RetryResult {
  success: boolean;
  cancelled?: boolean;
  /** 实际尝试了几次（设备找不到时为 0）。 */
  attempts: number;
}

/**
 * 按固定退避序列尝试连接 USB 设备。
 *
 * - 每轮先 `findDevice` 重新枚举（USB reset 会让旧引用失效）；
 * - 找不到设备直接失败，不重试；
 * - `connectOnce` 失败：致命错误立即停，瞬时/未知错误按 RETRY_DELAYS 退避后重试；
 * - 每轮开始前通过 `onProgress` 报告进度（供 UI 显示加载态）。
 */
export async function retryConnectUsb(
  serial: string,
  deps: RetryConnectDeps & { onProgress?: (p: RetryProgress) => void },
): Promise<RetryResult> {
  const total = RETRY_DELAYS.length;
  let attempts = 0;

  for (let i = 0; i < total; i++) {
    if (deps.isCancelled()) {
      return { success: false, cancelled: true, attempts };
    }

    // 退避等待（首次 i=0 时 delay=0，sleep(0) 不阻塞）
    const delay = RETRY_DELAYS[i];
    if (delay > 0) {
      await deps.sleep(delay);
    }

    if (deps.isCancelled()) {
      return { success: false, cancelled: true, attempts };
    }

    const device = await deps.findDevice(serial);
    if (!device) {
      return { success: false, attempts };
    }

    attempts += 1;
    deps.onProgress?.({ attempt: attempts, total, retrying: i > 0 });

    await deps.prepareDevice(device);

    try {
      await deps.connectOnce(device);
      return { success: true, attempts };
    } catch (error) {
      if (!shouldRetry(error)) {
        return { success: false, attempts };
      }
      // 继续下一轮
    }
  }

  return { success: false, attempts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/usb-connect.test.ts`
Expected: PASS — 全部用例通过。

- [ ] **Step 5: Commit**

```bash
git add src/lib/usb-connect.ts src/lib/__tests__/usb-connect.test.ts
git commit -m "feat(usb): add dependency-injected retry connect orchestrator"
```

---

## Task 3: 调整 `ensureDeviceReady` 为 reset 优先

在把 hook 接入编排器之前，先修正设备恢复顺序——刷新场景下接口常处于半开，`close()` 对异常接口常无效，应优先 USB 总线级 `reset()`。

**Files:**
- Modify: `src/hooks/useUsbConnection.ts:8-14`

- [ ] **Step 1: Write the failing test**

由于 `ensureDeviceReady` 是模块私有函数且耦合了 `AdbDaemonWebUsbDevice` 类型，直接测它需要 mock WebUSB，成本高。采用**导出为可注入的纯函数风格**：把核心逻辑提取为接受 `{ reset, close }` 接口的纯函数，便于单测，`useUsbConnection` 内用它适配真实 device。

创建测试 `src/lib/__tests__/usb-device-restore.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { restoreDevice } from '../usb-device-restore';

describe('restoreDevice', () => {
  it('优先调用 reset，成功后等待重新枚举稳定', async () => {
    const reset = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const sleep = vi.fn().mockResolvedValue(undefined);
    await restoreDevice({ reset, close }, sleep);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it('reset 失败时降级调用 close', async () => {
    const reset = vi.fn().mockRejectedValue(new Error('reset boom'));
    const close = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await restoreDevice({ reset, close }, sleep);
    expect(reset).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('reset 与 close 都失败时不抛出（静默恢复）', async () => {
    const reset = vi.fn().mockRejectedValue(new Error('reset boom'));
    const close = vi.fn().mockRejectedValue(new Error('close boom'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(restoreDevice({ reset, close }, sleep)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/usb-device-restore.test.ts`
Expected: FAIL — `restoreDevice` 未定义。

- [ ] **Step 3: Write minimal implementation**

创建 `src/lib/usb-device-restore.ts`：

```ts
/**
 * 把 USB 设备恢复到干净状态，优先做总线级 reset。
 *
 * 页面刷新后接口常处于"半开"，对已异常的接口调 close 通常无效；
 * reset 是 USB 级别硬复位，更彻底，重置后给设备 ~250ms 重新枚举。
 */

export interface RestorableDevice {
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

const DEFAULT_STABILIZE_MS = 250;

export async function restoreDevice(
  device: RestorableDevice,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  stabilizeMs: number = DEFAULT_STABILIZE_MS,
): Promise<void> {
  try {
    await device.reset();
    await sleep(stabilizeMs);
  } catch {
    try { await device.close(); } catch { /* 静默：两个都失败也交给上层重试 */ }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/usb-device-restore.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/usb-device-restore.ts src/lib/__tests__/usb-device-restore.test.ts
git commit -m "feat(usb): add reset-first device restore helper"
```

---

## Task 4: 接入 —— 重写 `useUsbConnection` 的自动重连逻辑

把 Task 1~3 的纯函数接到 React hook 里。`tryAutoConnectUsb` 改为调用 `retryConnectUsb`，`ensureDeviceReady` 改用 `restoreDevice`；保留并暴露**取消能力**与**进度回调**给上层 UI。

**Files:**
- Modify: `src/hooks/useUsbConnection.ts`

- [ ] **Step 1: 重写 useUsbConnection**

将 `src/hooks/useUsbConnection.ts` 全文替换为：

```ts
import { useCallback, useRef } from 'react';
import { Adb, AdbDaemonTransport } from '@yume-chan/adb';
import { AdbDaemonWebUsbDevice, AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';
import { useAdbStore, type AdbStore } from './useAdbStore';
import { killScrcpyServer } from '@/lib/adb-commands';
import { retryConnectUsb, type RetryProgress } from '@/lib/usb-connect';
import { restoreDevice } from '@/lib/usb-device-restore';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 执行一次完整的 device.connect → authenticate → adb 建立。失败则 reject。 */
async function connectOnce(store: AdbStore, device: AdbDaemonWebUsbDevice): Promise<void> {
  let conn: Awaited<ReturnType<(typeof device)['connect']>> | null = null;
  try {
    conn = await device.connect();
    const credentialManager = new AdbWebCredentialStore('carweb-adb-key');
    const transport = await AdbDaemonTransport.authenticate({
      serial: device.serial,
      connection: conn,
      credentialStore: credentialManager,
    });
    const adb = new Adb(transport);
    await killScrcpyServer(adb, true);

    store.setAdb(adb);
    store.setDeviceInfo(device.name || '未知设备', device.serial);
    store.setConnectionStatus('connected');

    adb.disconnected.then(() => {
      store.setConnectionStatus('disconnected');
      store.setAdb(null);
      store.setUsbDevice(null);
      store.setDeviceInfo(null, null);
    });
  } catch (error) {
    // authenticate 失败后 USB 接口可能被占用，尝试释放以便下一轮重试
    try { await restoreDevice({ reset: () => device.raw.reset(), close: () => device.raw.close() }); } catch {}
    throw error;
  }
}

export interface UseUsbConnectionResult {
  connectUsb: () => Promise<void>;
  tryAutoConnectUsb: (
    serial: string,
    onProgress?: (p: RetryProgress) => void,
  ) => Promise<{ success: boolean; cancelled: boolean }>;
  /** 取消正在进行的自动重连重试循环。 */
  cancelAutoConnect: () => void;
  disconnect: () => Promise<void>;
  isConnecting: boolean;
  isConnected: boolean;
  error: string | null;
}

export function useUsbConnection(): UseUsbConnectionResult {
  const store = useAdbStore();
  const cancelRef = useRef(false);

  const cancelAutoConnect = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const tryAutoConnectUsb = useCallback(async (
    serial: string,
    onProgress?: (p: RetryProgress) => void,
  ): Promise<{ success: boolean; cancelled: boolean }> => {
    cancelRef.current = false;
    store.setConnectionType('usb');
    store.setError(null);
    store.setConnectionStatus('connecting');

    const manager = AdbDaemonWebUsbDeviceManager.BROWSER;

    const result = await retryConnectUsb(serial, {
      findDevice: async (s) => {
        if (!manager) return null;
        const devices = await manager.getDevices();
        return devices.find((d) => d.serial === s) ?? null;
      },
      prepareDevice: (device) =>
        restoreDevice({
          reset: () => (device as AdbDaemonWebUsbDevice).raw.reset(),
          close: () => (device as AdbDaemonWebUsbDevice).raw.close(),
        }),
      connectOnce: (device) => connectOnce(store, device as AdbDaemonWebUsbDevice),
      sleep,
      isCancelled: () => cancelRef.current,
      onProgress,
    });

    if (result.success) {
      // connectOnce 内部已置 connected；补记设备引用
      const matched = manager ? (await manager.getDevices()).find((d) => d.serial === serial) : null;
      if (matched) store.setUsbDevice(matched);
      return { success: true, cancelled: false };
    }

    if (result.cancelled) {
      store.setConnectionStatus('idle');
      return { success: false, cancelled: true };
    }

    // 重试用尽：温和降级，不写 error（避免 UI 显示红色错误），仅置 idle。
    store.setConnectionStatus('idle');
    return { success: false, cancelled: false };
  }, [store]);

  const connectUsb = useCallback(async () => {
    try {
      store.setConnectionStatus('connecting');
      store.setConnectionType('usb');
      store.setError(null);

      const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
      if (!manager) {
        throw new Error('浏览器不支持 WebUSB API');
      }

      const device = await manager.requestDevice();
      if (!device) {
        store.setConnectionStatus('idle');
        store.setConnectionType(null);
        return;
      }

      store.setUsbDevice(device);
      await restoreDevice({ reset: () => device.raw.reset(), close: () => device.raw.close() });
      await connectOnce(store, device);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'USB 连接失败';
      store.setError(message);
      store.setConnectionStatus('error');
      // 手动连接路径保留 warn（便于排查），但不刷屏
      console.warn('USB 连接错误:', error);
    }
  }, [store]);

  const disconnect = useCallback(async () => {
    await store.disconnect();
  }, [store]);

  return {
    connectUsb,
    tryAutoConnectUsb,
    cancelAutoConnect,
    disconnect,
    isConnecting: store.connectionStatus === 'connecting',
    isConnected: store.connectionStatus === 'connected',
    error: store.error,
  };
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc -b --noEmit`
Expected: 通过，无类型错误。

- [ ] **Step 3: 全量测试回归**

Run: `npx vitest run`
Expected: Task 1~3 的测试仍全绿；无破坏既有测试。

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useUsbConnection.ts
git commit -m "feat(usb): retry-driven auto reconnect with progress + cancel"
```

---

## Task 5: 细化 App 的 overlay 状态机

扩展 `OverlayState` 以区分「自动连接中 / 重试中 / 自动连接失败兜底」，并把重试进度回调与取消能力接到 `useEffect`。

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 修改 App.tsx**

在 `src/App.tsx` 中做如下编辑（注意保持其余逻辑不变）：

(1) 扩展 `OverlayState` 类型（第 11 行）：

```ts
type OverlayState =
  | 'auto-connecting'      // 首次尝试中
  | 'auto-reconnecting'    // 进入重试阶段
  | 'auto-failed'          // 重试用尽，温和降级
  | 'manual'
  | 'hidden';
```

(2) 把 `beforeunload` 的 `try { adb.close() }` 改为尽力发送（第 29~34 行）：

```ts
    const handleBeforeUnload = () => {
      const adb = useAdbStore.getState().adb;
      if (adb) { void adb.close(); } // 尽力发送关闭包，不等完成
    };
```

(3) 重写自动连接 `useEffect`（第 48~66 行）为接入进度回调 + 失败兜底：

```ts
  // 自动连接已记忆设备
  useEffect(() => {
    const lastDevice = getLastDevice();
    if (!lastDevice) {
      setOverlayState('manual');
      return;
    }

    setOverlayState('auto-connecting');
    setDisplayMode(lastDevice.mode);

    if (lastDevice.type === 'usb') {
      usb.tryAutoConnectUsb(
        lastDevice.id,
        (p) => {
          // 进入第二次及以后尝试 → 切到「重试中」态
          if (p.retrying) setOverlayState((prev) => (prev === 'auto-connecting' ? 'auto-reconnecting' : prev));
        },
      ).then(({ success, cancelled }) => {
        if (cancelled) {
          setOverlayState('manual');
        } else if (!success) {
          setOverlayState('auto-failed');
        }
        // success 时由下面的「连接成功」effect 接管进入 hidden
      });
    } else {
      // WiFi 自动连接暂不支持，降级到手动
      setOverlayState('manual');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
```

(4) 修改「连接成功进入桌面」effect 的触发条件（第 69~77 行），使其在 `auto-connecting` 或 `auto-reconnecting` 时都能接管：

```ts
  // 自动连接成功后进入桌面
  useEffect(() => {
    const autoConnecting =
      overlayState === 'auto-connecting' || overlayState === 'auto-reconnecting';
    if (autoConnecting && store.connectionStatus === 'connected' && store.deviceSerial) {
      if (hasPin(store.deviceSerial)) {
        setPinGuard({ type: 'required', deviceId: store.deviceSerial, deviceName: store.deviceName || '未知设备' });
      } else {
        finishConnect();
      }
    }
  }, [store.connectionStatus, store.deviceSerial, store.deviceName, overlayState, hasPin, finishConnect]);
```

(5) 修改 `ConnectionOverlay` 渲染条件（第 119~129 行），把新增的 `auto-reconnecting`、`auto-failed` 也归入「显示 overlay」并透传：

```ts
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
            onCancelAutoConnect={usb.cancelAutoConnect}
            fading={isFading}
          />
        )}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc -b --noEmit`
Expected: 此时会报 `ConnectionOverlay` 的 props 类型不匹配（`overlayState` 取值增多、新增 `onCancelAutoConnect`）——这正是下一任务要补的。先记录，继续。

- [ ] **Step 3: 暂不提交（与 Task 6 一起提交以保持可编译）**

---

## Task 6: ConnectionOverlay 渲染重试/兜底 UI

为新增的 overlay 子态加渲染分支：重试中显示脉冲加载动画（无错误字样），兜底态显示温和提示 + 手动连接入口；并提供「取消自动连接」按钮。

**Files:**
- Modify: `src/components/ConnectionOverlay.tsx`

- [ ] **Step 1: 修改 props 类型**

将 `ConnectionOverlayProps`（第 9~17 行）替换为：

```ts
interface ConnectionOverlayProps {
  overlayState: 'auto-connecting' | 'auto-reconnecting' | 'auto-failed' | 'manual';
  displayMode: DisplayMode;
  rememberedDevices: RememberedDevice[];
  onSelectMode: (mode: DisplayMode) => void;
  onConnect: (device: { id: string; name: string; type: 'usb' | 'wifi'; address: string }, mode: DisplayMode, remember: boolean) => void;
  onForget: (id: string) => void;
  onCancelAutoConnect?: () => void;
  fading?: boolean;
}
```

- [ ] **Step 2: 替换 auto-connecting 渲染分支并新增 reconnecting/failed 分支**

将第 88~97 行的 `if (overlayState === 'auto-connecting') { ... }` 整块替换为：

```tsx
  if (overlayState === 'auto-connecting' || overlayState === 'auto-reconnecting') {
    const message = overlayState === 'auto-reconnecting' ? '正在重新建立连接…' : '正在自动连接…';
    return (
      <div className={`fixed inset-0 z-50 bg-black/40 backdrop-blur-xl flex items-center justify-center transition-opacity duration-300 ${fading ? 'opacity-0' : 'opacity-100'}`}>
        <div className="text-center">
          <div className="relative w-12 h-12 mx-auto mb-4">
            <RefreshCw className="w-12 h-12 text-blue-400/30" />
            <RefreshCw className="absolute inset-0 w-12 h-12 text-blue-400 animate-spin" />
          </div>
          <p className="text-white text-lg">{message}</p>
          {onCancelAutoConnect && (
            <button
              onClick={onCancelAutoConnect}
              className="mt-6 text-slate-400 text-sm hover:text-slate-200 transition-colors"
            >
              取消
            </button>
          )}
        </div>
      </div>
    );
  }

  if (overlayState === 'auto-failed') {
    return (
      <div className={`fixed inset-0 z-50 bg-black/40 backdrop-blur-xl flex items-center justify-center transition-opacity duration-300 ${fading ? 'opacity-0' : 'opacity-100'}`}>
        <div className="text-center max-w-sm px-6">
          <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center mx-auto mb-4">
            <Usb className="w-6 h-6 text-slate-300" />
          </div>
          <p className="text-slate-200 text-lg mb-1">暂时无法自动连接</p>
          <p className="text-slate-400 text-sm mb-6">
            设备可能正忙，可在下方手动重新连接。
          </p>
          <button
            onClick={() => { /* 退到手动面板：由父组件控制状态，这里触发一次连接入口 */ }}
            className="hidden"
          />
          <button
            onClick={onCancelAutoConnect ?? (() => {})}
            className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors"
          >
            手动连接
          </button>
        </div>
      </div>
    );
  }
```

> 说明：兜底态的「手动连接」按钮直接复用 `onCancelAutoConnect`（语义=退出自动流程）。父组件 `App` 在收到取消/失败后已把 overlay 置为 `manual` 或 `auto-failed`；这里点击即调用同一回调回到 `manual`。为保证父组件能把 `auto-failed` 切回 `manual`，`onCancelAutoConnect` 应同时支持该用途——见 Step 3 在 App 中补一个轻量切换。

- [ ] **Step 3: 在 App 中补兜底→手动的切换**

回到 `src/App.tsx`，把 `onCancelAutoConnect` 传入改成一个同时负责「取消 + 回到 manual」的处理函数（替代 Task 5 Step 1 (5) 里的 `usb.cancelAutoConnect`）：

在组件内（`handleStop` 附近）新增：

```ts
  const handleCancelAutoConnect = useCallback(() => {
    usb.cancelAutoConnect();
    setOverlayState('manual');
  }, [usb]);
```

并把 `ConnectionOverlay` 的 `onCancelAutoConnect={usb.cancelAutoConnect}` 改为 `onCancelAutoConnect={handleCancelAutoConnect}`。

- [ ] **Step 4: 类型检查**

Run: `npx tsc -b --noEmit`
Expected: 通过，无类型错误。

- [ ] **Step 5: 构建校验**

Run: `npm run build`
Expected: 构建成功，无 TS / 打包错误。

- [ ] **Step 6: 全量测试回归**

Run: `npx vitest run`
Expected: 全绿。

- [ ] **Step 7: Commit**

```bash
git add src/components/ConnectionOverlay.tsx src/App.tsx
git commit -m "feat(usb): transparent retry UI + graceful manual fallback"
```

---

## 验收清单（手动）

- [ ] 连接手机，进入桌面后按 F5 刷新：应在 <1s 内重新连上，全程只看到「正在自动连接…」加载态，无红色错误，无控制台 error。
- [ ] 复现慢清理场景（拔插一次制造旧连接残留）：刷新后先显示「正在自动连接…」，~0.5s 后切到「正在重新建立连接…」，最终连上，无报错。
- [ ] 制造彻底连不上（拔掉设备再刷新）：~3.7s 后显示「暂时无法自动连接」兜底页（灰色，非红色），点「手动连接」回到手动面板。
- [ ] 在自动连接过程中点「取消」：立即停止并回到手动面板。
- [ ] 手动 USB 连接失败时：面板内仍显示红色 error（保留原有体验），控制台为 `warn` 不再是 `error`。

---

## Self-Review

**1. Spec coverage（对照用户认可的五点方案）：**
- 点 1「乐观尝试 + 退避重试」→ Task 1 `RETRY_DELAYS=[0,500,1200,2000]` + Task 2 `retryConnectUsb`。✅
- 点 1「错误分类」→ Task 1 `isTransientError`/`isFatalError`/`shouldRetry`。✅
- 点 1「每轮重新 getDevices」→ Task 2 `findDevice` 每轮调用 + Task 4 注入。✅
- 点 2「ensureDeviceReady reset 优先」→ Task 3 `restoreDevice`。✅
- 点 3「UI 重试态无错误、可取消、温和兜底」→ Task 5/6。✅
- 点 4「无后台轮询/心跳、最多 4 次、成功即停」→ Task 2 循环天然保证。✅
- 点 5「beforeunload 尽力关闭」→ Task 5 Step 1 (2) `void adb.close()`。✅
- 用户否决的「自适应退避」→ 未做。✅

**2. Placeholder scan：**
- Task 6 Step 2 里有一个 `onClick={() => { ... }}` 的空 button——这是误留的中间产物。已用注释标明用 `onCancelAutoConnect` 替代，且 Step 3 明确删除/替换。**修正**：见下方 fix。

**Fix（Task 6 Step 2 内联修正）：** 删除那行多余的 `hidden` 按钮，兜底态只保留一个「手动连接」按钮调用 `onCancelAutoConnect`。替换后的 `auto-failed` 分支体应为：

```tsx
  if (overlayState === 'auto-failed') {
    return (
      <div className={`fixed inset-0 z-50 bg-black/40 backdrop-blur-xl flex items-center justify-center transition-opacity duration-300 ${fading ? 'opacity-0' : 'opacity-100'}`}>
        <div className="text-center max-w-sm px-6">
          <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center mx-auto mb-4">
            <Usb className="w-6 h-6 text-slate-300" />
          </div>
          <p className="text-slate-200 text-lg mb-1">暂时无法自动连接</p>
          <p className="text-slate-400 text-sm mb-6">设备可能正忙，可在下方手动重新连接。</p>
          <button
            onClick={onCancelAutoConnect ?? (() => {})}
            className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors"
          >
            手动连接
          </button>
        </div>
      </div>
    );
  }
```

**3. Type consistency：**
- `RetryProgress { attempt, total, retrying }` —— Task 2 定义、Task 4 `onProgress?: (p: RetryProgress)` 引用、Task 5 `(p) => p.retrying` 使用：一致。✅
- `RetryConnectDeps` 字段 `findDevice/prepareDevice/connectOnce/sleep/isCancelled` —— Task 2 定义、Task 4 注入实现：一致。✅
- `restoreDevice({ reset, close }, sleep)` —— Task 3 定义、Task 4 两处调用（prepareDevice 与 connectOnce catch）：签名一致。✅
- `tryAutoConnectUsb` 返回 `Promise<{ success, cancelled }>` —— Task 4 定义、Task 5 `.then(({ success, cancelled })` 解构：一致。✅
- `OverlayState` 新增 `auto-reconnecting`/`auto-failed` —— Task 5 定义、Task 6 `ConnectionOverlayProps.overlayState` 联合类型对齐：一致。✅
- `handleCancelAutoConnect` —— Task 6 Step 3 定义并替换 props 透传：一致。✅

无悬空引用、无类型不一致。
