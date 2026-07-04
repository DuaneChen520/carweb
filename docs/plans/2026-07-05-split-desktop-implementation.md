# Web 原生分屏桌面 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 用 Web 原生左右分屏桌面替代当前"加载上一次应用"的入口逻辑，支持分屏 ↔ 全屏切换、活动进程管理、状态持久化。

**Architecture:** 把 `useScrcpySession` 从模块级单例重构为可实例化的 `ScrcpySession` 类，通过 `SessionManager`（zustand store）统一管理多 app 并发。新增 `DesktopShell` 组件承载分屏布局、全屏覆盖层、活动管理面板。

**Tech Stack:** React 18 + TypeScript + zustand + Tailwind CSS + vitest + fake-indexeddb + scrcpy 4.0 (flexDisplay + keepActive)

**Design doc:** `docs/plans/2026-07-05-split-desktop-design.md`

---

## Task 1: ScrcpySession 类化（核心重构）

**目标：** 把 `useScrcpySession` hook 内部的 scrcpy 生命周期逻辑抽成可实例化的 `ScrcpySession` 类，支持多实例并发。

**Files:**
- Create: `src/lib/scrcpy-session.ts`
- Create: `src/lib/__tests__/scrcpy-session.test.ts`
- Reference: `src/hooks/scrcpy/useScrcpySession.ts`（参考现有逻辑，不删除）

**Step 1: 写 ScrcpySession 类骨架**

```typescript
// src/lib/scrcpy-session.ts
import type { AdbScrcpyClient } from '@yume-chan/adb-scrcpy';
import type { ScrcpyControlMessageWriter } from '@yume-chan/scrcpy';
import { ScrcpyNewDisplay, ScrcpyCaptureOrientation } from '@yume-chan/scrcpy';
import { AdbScrcpyOptions4_0, FlexDisplayClient, serializeResizeDisplay, RESIZE_DISPLAY_TYPE, ControllerHealth } from '@/lib/scrcpy4';
import type { Adb } from '@yume-chan/adb';
import {
  runAdbCommand,
  getRotationState,
  setRotationLocked,
  restoreRotation,
  getVirtualDisplayId,
  startAppOnDisplay,
  getDefaultHomePackage,
  forceStopPackage,
  killScrcpyServer,
} from '@/lib/adb-commands';
import type { RotationState } from '@/lib/adb-commands';
import type { DisplayConfig } from '@/hooks/scrcpy';

export interface ScrcpySessionCallbacks {
  onStateChange: (state: SessionState) => void;
  onVideoSize: (width: number, height: number) => void;
  onCanvasSize: (width: number, height: number) => void;
}

export interface SessionState {
  isStarting: boolean;
  isRunning: boolean;
  error: string | null;
  videoWidth: number;
  videoHeight: number;
  isVirtualDisplay: boolean;
}

export class ScrcpySession {
  public readonly id: string;
  public displayId: number | null = null;

  private client: AdbScrcpyClient<AdbScrcpyOptions4_0<true>> | null = null;
  private controller: ScrcpyControlMessageWriter | null = null;
  private adb: Adb | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private rotationState: RotationState | null = null;
  private flexClient: FlexDisplayClient | null = null;
  private health = new ControllerHealth();
  private callbacks: ScrcpySessionCallbacks;
  private state: SessionState = {
    isStarting: false, isRunning: false, error: null,
    videoWidth: 0, videoHeight: 0, isVirtualDisplay: false,
  };
  // videoStream reader + cleanup（从 useVideoDecoder 抽出）
  private videoCleanup: (() => Promise<void>) | null = null;
  private decoder: any = null; // WebCodecsVideoDecoder

  constructor(id: string, callbacks: ScrcpySessionCallbacks) {
    this.id = id;
    this.callbacks = callbacks;
  }

  get isRunning() { return this.state.isRunning; }
  get flexClientInstance() { return this.flexClient; }

  // ... start / stop / injectTouch / injectText / startAppOnDisplay 等方法
  // 从 useScrcpySession.ts 逐方法迁移，把 ref.current → this.xxx
}
```

**Step 2: 迁移 start 方法**

从 `useScrcpySession.ts` 的 `startScrcpy`（102-295 行）迁移，关键改动：
- `clientRef.current` → `this.client`
- `controllerRef.current` → `this.controller`
- `adbRef.current` → `this.adb`
- `displayIdRef.current` → `this.displayId`
- `setState(...)` → `this.updateState(...)`
- `videoDecoder.setupVideoStream(...)` → 内联 videoStream setup 逻辑（从 `useVideoDecoder.ts` 迁移）
- `audioDecoder.setupAudioStream(...)` → 内联或保留为独立模块

**关键：PID 精确 kill**

修改 `killScrcpyServer`，新增按 PID kill 的方法。在 `start` 成功后记录 server PID：

```typescript
// src/lib/adb-commands.ts 新增
export async function killScrcpyByPid(adb: Adb, pid: number): Promise<void> {
  try {
    await runAdbCommand(adb, `kill -9 ${pid} 2>/dev/null || true`);
  } catch { /* ignore */ }
}

export async function getScrcpyServerPid(adb: Adb): Promise<number | null> {
  try {
    const output = await runAdbCommand(adb, 'pidof scrcpy 2>/dev/null || pgrep -f scrcpy-server 2>/dev/null');
    const pid = parseInt(output.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}
```

> 注意：多实例并发时 `pidof` 会返回多个 PID。更可靠的方式是在 `AdbScrcpyClient.start` 后立即 `pgrep -f scrcpy` 获取最新 PID。若无法精确区分，降级为 `pkill -f scrcpy` 全杀并在 SessionManager 层串行化 stop 操作。

**Step 3: 迁移 stop 方法**

从 `useScrcpySession.ts` 的 `stopScrcpy`（297-347 行）迁移。关键改动：按 PID kill（若可获取）替代 `killScrcpyServer(adb, true)` 全杀。

**Step 4: 写测试**

```typescript
// src/lib/__tests__/scrcpy-session.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ScrcpySession } from '@/lib/scrcpy-session';

describe('ScrcpySession', () => {
  it('构造时初始化空闲状态', () => {
    const session = new ScrcpySession('test-1', {
      onStateChange: () => {},
      onVideoSize: () => {},
      onCanvasSize: () => {},
    });
    expect(session.isRunning).toBe(false);
    expect(session.displayId).toBeNull();
  });

  it('stop 在未启动时调用不报错', async () => {
    const session = new ScrcpySession('test-2', {
      onStateChange: () => {}, onVideoSize: () => {}, onCanvasSize: () => {},
    });
    await expect(session.stop()).resolves.not.toThrow();
  });
});
```

> scrcpy 启动涉及真实 ADB 连接，无法在单测中端到端测试。单测只覆盖状态机骨架和边界条件。集成测试在设备连接后手动验证。

**Step 5: 验证类型检查**

Run: `npx tsc -b --noEmit`
Expected: 无新增类型错误

**Step 6: Commit**

```bash
git add src/lib/scrcpy-session.ts src/lib/__tests__/scrcpy-session.test.ts src/lib/adb-commands.ts
git commit -m "feat: ScrcpySession 类化，支持多实例并发"
```

---

## Task 2: SessionManager（zustand store）

**目标：** 创建 zustand store 统一管理所有 ScrcpySession 实例、app 状态机、displayId 池。

**Files:**
- Create: `src/lib/session-manager.ts`
- Create: `src/lib/__tests__/session-manager.test.ts`

**Step 1: 定义类型**

```typescript
// src/lib/session-manager.ts
import { create } from 'zustand';
import { ScrcpySession } from './scrcpy-session';

export type PaneSlot = 'left' | 'right';
export type AppRuntimeState = 'foreground-pane' | 'foreground-fullscreen' | 'background' | 'closed';

export interface AppInstance {
  sessionId: string;        // ScrcpySession.id
  packageName: string;
  state: AppRuntimeState;
  pane?: PaneSlot;          // foreground-pane 时标注
  sourcePane?: PaneSlot;    // foreground-fullscreen 时记录来源 pane
  displayId: number | null; // background 恢复时复用
  appLabel?: string;
}

interface SessionManagerState {
  sessions: Map<string, ScrcpySession>;       // sessionId → ScrcpySession
  apps: AppInstance[];                         // 所有活跃 app（不含 closed）
  paneLeft: string | null;                     // sessionId
  paneRight: string | null;                    // sessionId
  fullscreenSessionId: string | null;          // 当前全屏覆盖层的 sessionId

  // actions
  launchOnPane: (packageName: string, pane: PaneSlot, adb: Adb, canvas: HTMLCanvasElement, displayConfig: DisplayConfig) => Promise<void>;
  launchFullscreen: (packageName: string, adb: Adb, canvas: HTMLCanvasElement, displayConfig: DisplayConfig) => Promise<void>;
  paneToFullscreen: (pane: PaneSlot) => Promise<void>;
  fullscreenToPane: (pane: PaneSlot) => Promise<void>;
  fullscreenToDesktop: () => Promise<void>;
  closePane: (pane: PaneSlot) => Promise<void>;
  closeFullscreen: () => Promise<void>;
  switchPaneApp: (pane: PaneSlot, packageName: string, adb: Adb, canvas: HTMLCanvasElement, displayConfig: DisplayConfig) => Promise<void>;
  closeApp: (sessionId: string) => Promise<void>;
  closeAll: () => Promise<void>;
  resumeBackground: (sessionId: string) => Promise<void>;
}
```

**Step 2: 实现核心 actions**

每个 action 按设计文档的状态转换矩阵实现。关键逻辑：

- `launchOnPane`：创建 ScrcpySession → start → 设置 paneLeft/paneRight → app state = foreground-pane
- `launchFullscreen`：当前全屏 app（如有）→ background（断 scrcpy）→ 新 session start → fullscreenSessionId
- `paneToFullscreen`：pane app 的 session 保持活 → 渲染目标切到 overlay canvas → sourcePane 记录 → fullscreenSessionId 设置 → pane 显示占位
- `fullscreenToPane(pane)`：若 pane == sourcePane → 恢复渲染到 pane canvas；否则 → 覆盖确认（由 UI 层处理）→ 关闭 pane 旧 app → 全屏 app 渲染切到 pane
- `fullscreenToDesktop`：按 §6 规则（来源 pane / 空 pane / background）
- `closeApp`：force-stop + session.stop() + 从 apps 移除 + 清 pane/fullscreen 引用

**Step 3: 写测试**

```typescript
// src/lib/__tests__/session-manager.test.ts
import { describe, it, expect } from 'vitest';
// 测试状态机逻辑（mock ScrcpySession）

describe('SessionManager 状态机', () => {
  it('launchOnPane 设置 paneLeft 并创建 app 实例', () => { /* ... */ });
  it('paneToFullscreen 设置 fullscreenSessionId 且 pane 显示占位', () => { /* ... */ });
  it('fullscreenToDesktop 优先回来源 pane', () => { /* ... */ });
  it('closeApp 从列表移除并清理引用', () => { /* ... */ });
});
```

**Step 4: Commit**

```bash
git add src/lib/session-manager.ts src/lib/__tests__/session-manager.test.ts
git commit -m "feat: SessionManager zustand store，统一管理多 app 状态机"
```

---

## Task 3: 分屏状态持久化 Store

**目标：** 新增 IndexedDB store 保存 pane 布局，按 deviceSerial 隔离。

**Files:**
- Create: `src/lib/desktop-state-store.ts`
- Create: `src/lib/__tests__/desktop-state-store.test.ts`

**Step 1: 写 store 类**

参照 `src/lib/device-apps-store.ts` 模式：

```typescript
// src/lib/desktop-state-store.ts
export interface DesktopState {
  deviceSerial: string;
  paneLeft: string | null;   // packageName
  paneRight: string | null;  // packageName
  savedAt: number;
}

export class DesktopStateStore {
  private dbName = 'carweb-desktop-state';
  private storeName = 'desktop';
  private dbVersion = 1;
  private db: IDBDatabase | null = null;

  private async openDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { this.db = request.result; resolve(this.db); };
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'deviceSerial' });
        }
      };
    });
  }

  async get(deviceSerial: string): Promise<DesktopState | null> { /* ... */ }
  async set(state: DesktopState): Promise<void> { /* ... */ }
  async clear(deviceSerial: string): Promise<void> { /* ... */ }
}
```

**Step 2: 写测试（用 fake-indexeddb）**

```typescript
// src/lib/__tests__/desktop-state-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { DesktopStateStore } from '@/lib/desktop-state-store';

describe('DesktopStateStore', () => {
  let store: DesktopStateStore;
  beforeEach(() => {
    indexedDB.deleteDatabase('carweb-desktop-state');
    store = new DesktopStateStore();
  });

  it('set 后 get 返回相同数据', async () => {
    await store.set({ deviceSerial: 'dev1', paneLeft: 'com.a', paneRight: null, savedAt: Date.now() });
    const result = await store.get('dev1');
    expect(result?.paneLeft).toBe('com.a');
  });

  it('不同 deviceSerial 隔离', async () => {
    await store.set({ deviceSerial: 'dev1', paneLeft: 'com.a', paneRight: null, savedAt: 1 });
    await store.set({ deviceSerial: 'dev2', paneLeft: 'com.b', paneRight: null, savedAt: 2 });
    expect((await store.get('dev1'))?.paneLeft).toBe('com.a');
    expect((await store.get('dev2'))?.paneLeft).toBe('com.b');
  });
});
```

**Step 3: 运行测试**

Run: `npx vitest run src/lib/__tests__/desktop-state-store.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/lib/desktop-state-store.ts src/lib/__tests__/desktop-state-store.test.ts
git commit -m "feat: 分屏状态持久化 store（IndexedDB + deviceSerial 隔离）"
```

---

## Task 4: DesktopShell + SplitPane 基础布局

**目标：** 创建桌面壳组件，承载侧边栏 + 左右分屏 + 空状态，响应式布局。

**Files:**
- Create: `src/components/desktop/DesktopShell.tsx`
- Create: `src/components/desktop/SplitPane.tsx`
- Create: `src/components/desktop/PaneEmptyState.tsx`
- Modify: `src/App.tsx`（连接成功后渲染 DesktopShell 替代 VirtualScreen 主区域）

**Step 1: SplitPane 组件**

```tsx
// src/components/desktop/SplitPane.tsx
interface SplitPaneProps {
  pane: 'left' | 'right';
  app: AppInstance | null;
  onOpenAppPicker: () => void;  // 弹全部应用（pane 模式）
  onDropdownToggle: () => void;
  isDropdownOpen: boolean;
}
```

- canvas ref 传给 SessionManager 对应 pane 的 session
- ResizeObserver 监听容器尺寸 → flexClient.onContainerResize
- 空状态：虚线框 + "点击打开应用"
- 顶部下拉图标（透明悬浮，不占画面尺寸）

**Step 2: DesktopShell 布局**

```tsx
// src/components/desktop/DesktopShell.tsx
export function DesktopShell({ adb }: { adb: Adb | null }) {
  const { paneLeft, paneRight, apps, fullscreenSessionId } = useSessionManager();
  // 布局（侧边栏常驻占据固定宽度）：
  // <ControlSidebar w-13 /> | <DesktopArea flex-1>
  //   DesktopArea 内：
  //     <SplitPane left flex-1 /> | <SplitPane right flex-1 />
  //     {fullscreenSessionId && <FullscreenOverlay absolute inset-0 />}  // 覆盖 DesktopArea，不遮侧边栏
  //     {showActivityMgr && <ActivityManagerPanel fixed />}  // 浮窗，z-index 最高
  //   </DesktopArea>
}
```

关键点：
- ControlSidebar 在 DesktopShell 最外层，固定宽度 `w-13`，任何状态下都常驻
- DesktopArea 是 `flex-1`，承载 SplitPane 和 FullscreenOverlay
- FullscreenOverlay 用 `absolute inset-0` 定位在 DesktopArea 内部，不遮侧边栏
- ActivityManagerPanel 和全部应用浮窗用 `fixed` 定位，可覆盖整个屏幕（含侧边栏），但从侧边栏按钮触发

**Step 3: 空状态组件**

```tsx
// src/components/desktop/PaneEmptyState.tsx
export function PaneEmptyState({ onClick }: { onClick: () => void }) {
  return (
    <div className="w-full h-full flex items-center justify-center cursor-pointer"
         onClick={onClick}>
      <div className="text-center text-slate-400">
        <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-slate-300 mx-auto mb-3" />
        <p className="text-sm">点击打开应用</p>
      </div>
    </div>
  );
}
```

**Step 4: 类型检查**

Run: `npx tsc -b --noEmit`

**Step 5: Commit**

```bash
git add src/components/desktop/ src/App.tsx
git commit -m "feat: DesktopShell + SplitPane 基础布局与空状态"
```

---

## Task 5: 顶部下拉菜单

**目标：** 分屏和全屏的顶部下拉悬浮控件。

**Files:**
- Create: `src/components/desktop/PaneDropdown.tsx`
- Create: `src/components/desktop/FullscreenDropdown.tsx`
- Create: `src/components/desktop/PaneSelector.tsx`（全屏→分屏的选 pane + 覆盖确认）

**Step 1: PaneDropdown（分屏下拉）**

```tsx
// src/components/desktop/PaneDropdown.tsx
// 透明悬浮，不占画面尺寸
// 左：应用名 + 切换按钮
// 右：全屏 + 关闭
```

**Step 2: FullscreenDropdown（全屏下拉）**

```tsx
// src/components/desktop/FullscreenDropdown.tsx
// 左：应用名
// 右：分屏（展开 PaneSelector）+ 关闭
```

**Step 3: PaneSelector（选 pane + 覆盖确认）**

```tsx
// src/components/desktop/PaneSelector.tsx
// 展示左右 pane 当前 app
// 来源 pane → "恢复"标签，直接恢复
// 另一 pane 有 app → "覆盖将关闭 xx" + 确认/取消
// 另一 pane 空 → 直接放入
```

**Step 4: Commit**

```bash
git add src/components/desktop/PaneDropdown.tsx src/components/desktop/FullscreenDropdown.tsx src/components/desktop/PaneSelector.tsx
git commit -m "feat: 顶部下拉菜单（分屏 + 全屏 + 覆盖确认）"
```

---

## Task 6: FullscreenOverlay + 渲染目标切换

**目标：** 全屏覆盖层组件 + scrcpy 渲染目标 canvas 切换（不重启 session）。

**Files:**
- Create: `src/components/desktop/FullscreenOverlay.tsx`
- Modify: `src/lib/scrcpy-session.ts`（新增 `switchCanvas` 方法）

**Step 1: ScrcpySession.switchCanvas 方法**

```typescript
// src/lib/scrcpy-session.ts 新增
switchCanvas(newCanvas: HTMLCanvasElement): void {
  // WebCodecsVideoDecoder 的 renderer 需要重新绑定到新 canvas
  // 方案：renderer.setCanvas(newCanvas) 或重建 renderer（不重建 decoder）
  // 测试音频是否中断
}
```

> 关键技术验证点：`WebGLVideoFrameRenderer` 是否支持运行时换 canvas。若不支持，需要重建 renderer 但保持 decoder 和 videoStream reader 不变。验证音频不中断。

**Step 2: FullscreenOverlay 组件**

```tsx
// src/components/desktop/FullscreenOverlay.tsx
// 覆盖整个桌面区域（侧边栏保留）
// 承载 fullscreenSessionId 对应 session 的 canvas
// 顶部 FullscreenDropdown
```

**Step 3: 集成 paneToFullscreen / fullscreenToPane**

调用 SessionManager 的对应 action，触发 `switchCanvas`。

**Step 4: 手动验证**

连接设备 → 分屏开 app → 点全屏 → 确认音频不断、画面连续 → 点返回分屏 → 确认恢复。

**Step 5: Commit**

```bash
git add src/components/desktop/FullscreenOverlay.tsx src/lib/scrcpy-session.ts
git commit -m "feat: FullscreenOverlay + 渲染目标切换（session 不重启）"
```

---

## Task 7: ActivityManagerPanel

**目标：** 活动进程管理浮窗，列表展示 + 单/全部关闭。

**Files:**
- Create: `src/components/desktop/ActivityManagerPanel.tsx`

**Step 1: 组件实现**

```tsx
// src/components/desktop/ActivityManagerPanel.tsx
// 从 SessionManager 读取 apps 列表
// 排序：foreground-fullscreen > foreground-pane > background
// 每条：图标 + 名称 + 状态标注（全屏中/小窗中·左/右分屏/后台）+ 进入按钮 + 关闭按钮
// 底部：全部关闭按钮
```

**Step 2: background → 前台恢复落点逻辑**

调用 SessionManager.resumeBackground，按 §7.4 规则：
1. 有全屏覆盖层 → 当前全屏进 background，新 app 转全屏
2. 有空 pane → 放空 pane
3. 两 pane 占 → 覆盖左 pane

**Step 3: Commit**

```bash
git add src/components/desktop/ActivityManagerPanel.tsx
git commit -m "feat: 活动进程管理面板"
```

---

## Task 8: ControlSidebar 改造

**目标：** 侧边栏新增活动进程按钮、桌面按钮语义变更、pinned app 统一全屏启动。

**Files:**
- Modify: `src/components/ControlSidebar.tsx`

**Step 1: 新增活动进程按钮**

在底部功能区（设置按钮附近）新增 `AppWindow` 图标按钮，触发 `ActivityManagerPanel`。

**Step 2: 桌面按钮语义变更**

现有 `Home` 按钮：从 `goHome()`（Android Home intent）改为调用 `SessionManager.fullscreenToDesktop()`。

**Step 3: pinned app 点击行为**

从 `startApp(pkg)`（全屏 startApp intent）改为 `SessionManager.launchFullscreen(pkg, ...)`。

**Step 4: 全部应用按钮**

保持现有触发 AppGrid 浮窗，但 onLaunch 回调改为 `launchFullscreen`（全屏模式）。

**Step 5: Commit**

```bash
git add src/components/ControlSidebar.tsx
git commit -m "feat: ControlSidebar 改造（活动进程按钮 + 桌面导航 + 全屏启动）"
```

---

## Task 9: 全部应用双模式

**目标：** AppGrid 浮窗支持 pane 模式（来自空 pane 点击）和全屏模式（来自侧边栏）。

**Files:**
- Modify: `src/components/AppGrid.tsx`
- Modify: `src/components/ControlSidebar.tsx`（传 mode 参数）

**Step 1: AppGrid 增加 mode prop**

```tsx
interface AppGridProps {
  onLaunchApp: (pkg: string) => void;
  mode?: 'fullscreen' | 'pane';  // 默认 fullscreen
}
```

**Step 2: 空 pane 点击触发 pane 模式**

`SplitPane` 的 `PaneEmptyState` 点击 → 弹 AppGrid 浮窗（mode='pane'）→ 选中 → `launchOnPane(pkg, pane, ...)`。

**Step 3: 侧边栏触发全屏模式**

侧边栏"全部应用"按钮 → AppGrid（mode='fullscreen'）→ 选中 → `launchFullscreen(pkg, ...)`。

**Step 4: Commit**

```bash
git add src/components/AppGrid.tsx src/components/ControlSidebar.tsx src/components/desktop/SplitPane.tsx
git commit -m "feat: 全部应用组件双模式（pane 模式 + 全屏模式）"
```

---

## Task 10: 启动恢复 + 集成

**目标：** 设备连接成功后读取持久化的 pane 状态，自动恢复分屏布局。清理旧 VirtualScreen 入口。

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/contexts/ScrcpyContext.tsx`（适配 SessionManager）
- Delete/Archive: `src/components/VirtualScreen.tsx`（或保留作为 mirror 模式入口）

**Step 1: App.tsx 启动恢复流程**

连接成功 + Pin 校验通过后：
1. 读取 `DesktopStateStore.get(deviceSerial)`
2. 若有 paneLeft → `launchOnPane(paneLeft, 'left', ...)`
3. 若有 paneRight → `launchOnPane(paneRight, 'right', ...)`
4. 失败（app 已卸载）→ pane 保持空态 + 提示

**Step 2: pane 变更时持久化**

SessionManager 的 pane 状态变化时，异步写入 `DesktopStateStore`。

**Step 3: 清理旧入口**

移除 `App.tsx` 中对 `VirtualScreen` 的引用（mirror 模式可保留为独立路径）。

**Step 4: 端到端手动验证**

- 连接设备 → 空桌面 → 左 pane 开高德 → 右 pane 开音乐 → 断开重连 → 两 pane 自动恢复
- 分屏 → 全屏 → 返回分屏 → 音频不断
- 活动管理 → 后台 app 恢复 → 关闭单个 → 全部关闭

**Step 5: Commit**

```bash
git add src/App.tsx src/contexts/ScrcpyContext.tsx
git rm src/components/VirtualScreen.tsx  # 若完全移除
git commit -m "feat: 启动恢复 + 旧 VirtualScreen 入口清理"
```

---

## 依赖关系

```
Task 1 (ScrcpySession) ─┬─→ Task 2 (SessionManager) ─┬─→ Task 4 (DesktopShell) ─┬─→ Task 5 (Dropdown)
                        │                             │                          ├─→ Task 6 (Fullscreen)
Task 3 (StateStore) ────┘                             │                          ├─→ Task 7 (ActivityMgr)
                                                      │                          ├─→ Task 8 (Sidebar)
                                                      │                          ├─→ Task 9 (AppGrid dual)
                                                      └─→ Task 10 (Integration)
```

Task 1 和 Task 3 可并行。Task 4-9 依赖 Task 2。Task 10 依赖全部。

## 风险点

1. **WebGLVideoFrameRenderer 换 canvas**：Task 6 的核心风险，需先验证 `@yume-chan/scrcpy-decoder-webcodecs` 是否支持运行时换 canvas。若不支持，需在 decoder 层做适配。
2. **多 scrcpy server PID 精确 kill**：`pidof scrcpy` 多实例时返回多个 PID，需确认能否精确区分。降级方案：串行化 stop。
3. **音频路由**：多 session 并发时音频如何混合/切换需验证。当前 `audioDecoder` 是单例，多 session 需要每实例独立或共享管理。
4. **设备资源**：3 个 streaming session + N 个 background 虚拟屏，设备端内存和 GPU 压力需实测。
