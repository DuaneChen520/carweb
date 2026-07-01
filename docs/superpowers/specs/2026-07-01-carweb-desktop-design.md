# CarWeb 车机桌面设计

- **日期**：2026-07-01
- **状态**：已评审，待实现
- **范围**：为 CarWeb 虚拟屏新增一个由网页承载的车机桌面（类 CarPlay 车机 Home），作为应用的入口层

## 1. 背景与目标

CarWeb 当前形态是"连接手机 → 直接显示虚拟屏"。连上手机后用户第一眼看到的是手机的 Android 镜像/虚拟显示，左侧挂一个 `ControlSidebar` 提供应用列表和控制。

本设计新增一层**车机桌面**：连上手机后默认进入桌面，桌面提供"快速启动应用 + 音乐控制"两类高频操作，点击应用图标后才切换到虚拟屏。虚拟屏里的"桌面/Home"按钮改为回到这个车机桌面。

### 核心定位

- 桌面是**入口层**（覆盖式），取代"手机 Android 桌面"在交互中的角色。
- 桌面由 CarWeb 的 React 层渲染，不是手机 Launcher 的镜像。
- 点桌面应用图标 → 通过 ADB `startAppOnDisplay` 在手机虚拟显示上启动应用 → 切换到虚拟屏视图。
- 虚拟屏的 Home 按钮 → 回到车机桌面（不回手机 Home）。

### 非 MVP 范围（YAGNI）

明确排除以下内容，避免范围蔓延：

- 应用文件夹、多页分页动画。
- 壁纸/主题系统（纯色背景）。
- 桌面搜索框（侧栏已有搜索面板）。
- 媒体封面图（shell 无法获取，见第 3 节）。
- 进度条拖动 seek。
- 多虚拟显示 / 分屏。
- 应用切换的共享元素动画。
- 时钟、天气卡片（已排除）。

## 2. 整体架构与状态机

### 视图状态机

`App.tsx` 在现有连接流程状态（`overlayState`）之外，新增顶层视图态：

```ts
type View = 'desktop' | 'launching' | 'screen';
```

```
连接中(overlay) ──连上──▶ desktop ──点应用──▶ launching ──首帧就绪──▶ screen
                            ▲                    │                       │
                            │                    │ 超时/失败(8s)          │
                            └────────────────────┴──Home键────────────────┘
```

- 连接成功（`overlayState === 'hidden'`）后**默认 `view='desktop'`**（当前是直接进 `VirtualScreen`，改为先进桌面）。
- 桌面点应用 → `startAppOnDisplay(pkg)` → `setView('launching')`。
- `launching` 态收到首帧就绪 → `setView('screen')`。
- 虚拟屏 Home 键 → `setView('desktop')`，并重置桌面到第一页。

### 视图渲染

两个主视图互斥渲染（切走即卸载 `desktop`，但 scrcpy session 保留，见第 4 节）：

```tsx
{view === 'desktop' && <DesktopView onLaunchApp={...} />}
{(view === 'launching' || view === 'screen') && (
  <>
    <VirtualScreen active onFirstFrame={...} onHome={...} />
    {view === 'launching' && <AppLaunchingOverlay pkg={launchingPkg} />}
  </>
)}
```

### 涉及的现有文件

- `App.tsx`：扩展状态机，新增 `view` 态，管理 `launchingPkg`、首帧/超时流转。
- `ControlSidebar.tsx`：Home 按钮行为改为切回 `DesktopView`（不做手机 Home）。
- `VirtualScreen.tsx` / `useScrcpy.ts`：暴露 `onFirstFrame` 回调；进入桌面时暂停渲染。

### 不改动的部分

- 连接流程（`ConnectionOverlay` / `useUsbConnection` 等）完全不动。
- scrcpy 核心（视频解码渲染机制不动，仅增加首帧信号与暂停渲染能力）。
- 应用数据层（`device-apps-store`、`useAppManager`、图标解析）不动，桌面复用。

## 3. 桌面布局与组件

### 布局

```
┌─────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────┐ │
│ │ 🎵 ▣  歌名                ⏮  ▶  ⏭       │ │  ← 音乐卡片（顶部通栏，仅第 1 页）
│ │        艺术家 · 专辑                    │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│   ▢    ▢    ▢    ▢                        │
│  地图  音乐  电话  相册                      │  ← 应用图标网格（分页）
│   ▢    ▢    ▢    ▢                        │
│  消息  日历  设置  视频                      │
│                                             │
│                  ● ○ ○                       ← 页面指示器
└─────────────────────────────────────────────┘
```

- **音乐卡片**：顶部通栏，**只在第 1 页**显示。点击卡片主体 → 启动来源应用；控制按钮区单独拦截点击，不触发启动。无活跃 session 时显示"未在播放"占位（保持位置稳定，不隐藏）。
- **应用网格**：横向分页（左右翻页），所有应用分页展示，符合平板桌面习惯。

### 组件拆分

| 组件 | 职责 | 数据来源 |
|------|------|---------|
| `DesktopView.tsx`（新增） | 桌面容器，组合音乐卡片 + 应用分页网格 | — |
| `NowPlayingCard.tsx`（新增） | 显示当前播放信息 + 控制按钮 | `useMediaSession`（新增） |
| `AppGrid.tsx`（新增） | 应用分页网格容器，排序/分页切片 | `useAppManager`（复用） |
| `AppIcon`（抽取复用） | 单个应用图标 | 抽取自 `ControlSidebar`，桌面和侧栏共用 |
| `AppLaunchingOverlay.tsx`（新增） | 启动过渡层：模糊背景 + 居中图标 | `getAppIcon` |

### 关键设计决策

1. **音乐卡片置顶通栏，仅第 1 页**：横屏车机场景下，顶部通栏视觉清晰、不挤压网格。Home 键回桌面总是回到第 1 页，即音乐卡片可见。

2. **应用网格复用现有排序**：直接采用 `ControlSidebar.refreshSidebarApps` 已验证的三段排序——`置顶(pinned) > 常用(localCount>0) > 其他(launchCount)`，扁平排序后按每页容量切片分页。

3. **抽取 `AppIcon` 为独立组件**：当前 `AppIcon` 私有定义在 `ControlSidebar.tsx` 内。抽取为 `src/components/AppIcon.tsx`，桌面和侧栏共用，避免重复。

4. **分页交互**：
   - 触摸/鼠标左右拖拽（车机触屏主交互）。
   - 翻页吸附（snap），不会停在中间。
   - 底部页面指示器圆点。
   - 不做左右箭头按钮（车机触屏首选手势）。
   - 每页网格规格：**4 列**，行数随视口高度自适应。

5. **分页技术实现**：CSS scroll-snap（`scroll-snap-type: x mandatory` + 每页 `scroll-snap-align: start`），原生支持触摸拖拽和吸附，无需第三方轮播库。

6. **空状态降级**：
   - 无活跃媒体 session → 音乐卡片显示"未在播放"占位（保持位置）。
   - 应用列表为空（首次连接未解析）→ 网格区显示 loading/引导。

## 4. `useMediaSession` 数据流

音乐卡片的数据引擎，全部新建。

### 命令封装层（`adb-commands.ts` 新增）

在现有 `adb-commands.ts` 新增纯函数（与 `runAdbCommand` 同风格，不依赖 React）：

```ts
// 读：解析 dumpsys media_session，返回活跃 session 信息
getMediaSession(adb): Promise<MediaInfo | null>

// 控：优先 cmd media_session dispatch（Android 11+），失败降级 keyevent
dispatchMediaKey(adb, action: 'play-pause' | 'next' | 'previous'): Promise<void>
```

### `MediaInfo` 结构（只保留可靠字段）

```ts
interface MediaInfo {
  packageName: string;   // 来源 app（用于启动）
  title: string;
  artist: string;
  album: string;
  duration: number;      // ms
  position: number;      // ms（快照）
  state: 'playing' | 'paused' | 'other';
}
```

### 解析策略（基于可行性调研结论）

- 执行 `dumpsys media_session` 全量输出。
- **按 `package=` 分块**识别多个 session，取第一个带 `MediaMetadata{}` 的活跃 session（通常是当前播放者）。
- 块内用**锚点 + 宽松正则**，不依赖行号/字段顺序：
  - `state=(\d+)` → `3`=playing、`2`=paused、其余归 other
  - `title="([^"]*)"`、`artist="([^"]*)"`、`album="([^"]*)"`
  - `duration=(\d+)`、`position=(\d+)`
- 字符串字段可能缺失（部分 app 不上报），缺失则置空串。

### 控制实现

- 优先 `cmd media_session dispatch play-pause / next / previous`（Android 11+，走系统 MediaSession 路由，比 keyevent 可靠）。
- 失败降级 `input keyevent`：`85`（播放/暂停）、`87`（下一首）、`88`（上一首）。

### React 层：`useMediaSession` hook（新增 `src/hooks/useMediaSession.ts`）

```ts
function useMediaSession(adb: Adb | null): {
  media: MediaInfo | null;          // null = 未在播放
  loading: boolean;
  refresh: () => Promise<void>;     // 手动刷新
  control: (action) => Promise<void>; // 播放/暂停/上下首
}
```

**轮询机制：**

- **轮询节奏**：每 **5 秒**拉一次 `getMediaSession`。车机场景常驻显示，5 秒在"歌名变化感知"和"ADB 通道压力"间平衡。
- **进度外推**：`position` 是快照、不会自走。hook 内根据 `state==='playing'` 用 `setInterval(1s)` **本地外推**进度，下次轮询时校准。这样进度条平滑走动，无需频繁请求。
- **生命周期**：挂载时立即拉一次 → 起 5s 轮询 → 卸载/ADB 断开时停止轮询。
- **控制后立即刷新**：`control()` 发完 dispatch 后立即触发一次 `refresh()`，保证按键后 UI 即时反馈。

### 失败/降级

- `dumpsys` 解析失败或无活跃 session → `media = null` → 卡片显示"未在播放"占位。
- `dispatchMediaKey` 失败 → 静默失败，不阻断 UI（控制是 best-effort）。
- ADB 未连接 → hook 返回 `media=null`，卡片占位。

### 封面图

纯 shell 无法获取 MediaMetadata 的 bitmap（`dumpsys` 文本不含像素数据）。MVP 用**应用图标作为占位**，不显示真实封面。后续若需真实封面，需引入辅助 app（超出 MVP 范围）。

## 5. 桌面↔虚拟屏切换与启动过渡

### scrcpy session 的启停

- **桌面状态下 scrcpy session 保留但暂停渲染**：回桌面时不销毁 session（销毁重建会有 1–2 秒黑屏），应用仍在手机虚拟显示上跑（音乐继续放、导航继续走），符合 CarPlay"应用后台继续运行"语义。
- **进入桌面时暂停渲染**：让 `VirtualScreen` 停止拉帧/暂停解码器（不渲染画面），保留 session 连接，省算力。回虚拟屏时恢复渲染。
- **代价缓解**：桌面状态下不浪费解码算力。

### 应用启动过渡动画

点应用图标启动虚拟屏期间（1–2 秒加载），显示**模糊背景 + 居中应用图标**作为过渡，避免空白黑屏。

**`launching` 态视觉：**

```
┌───────────────────────────────────────────┐
│                                           │
│          (桌面背景，backdrop-blur + 暗化)   │
│                                           │
│                  ┌────┐                   │
│                  │ ▣  │   ← 居中应用图标    │
│                  └────┘     (放大 ~96px)   │
│                  地图                      │
│                                           │
└───────────────────────────────────────────┘
```

- **背景**：实时模糊底层桌面 DOM（`backdrop-blur`）+ 半透明暗化遮罩。
- **图标**：应用图标居中，比网格里大（约 96px），带轻微缩放/淡入动画 + 柔光。

### 状态流转与数据流

1. **`desktop` → `launching`**：桌面应用图标被点。
   - 记录 `launchingPkg`（用于显示图标）。
   - `setView('launching')`。
   - 触发 `startAppOnDisplay(pkg)` + 启动 scrcpy session。
2. **`launching` → `screen`**：scrcpy **首帧渲染成功**。
   - `VirtualScreen`/`useScrcpy` 暴露的 `onFirstFrame` 回调触发 → `setView('screen')`，过渡层淡出露出 VirtualScreen。
3. **`launching` → `desktop`**：启动超时或失败。
   - **超时阈值 8 秒**未收到首帧 → 视为失败 → 回桌面 + 提示错误。
4. **`screen` → `desktop`**：Home 键 → 重置桌面到第一页。

### 关键：scrcpy 何时启动

- `launching` 态下 scrcpy session 已启动并在解码（否则拿不到首帧）。
- 过渡动画层覆盖在 `VirtualScreen` 之上：VirtualScreen 在底层默默解码，过渡层在上层显示模糊背景 + 图标，首帧就绪后过渡层淡出 → 露出 VirtualScreen。

### "首帧就绪"信号

现有 `useScrcpy` 在解码出第一帧时有渲染回调。需要在 `VirtualScreen`/`useScrcpy` 上**暴露一个 `onFirstFrame` 回调**（如未现成则新增 state/事件）。这是对现有 hook 的小幅扩展。

### 涉及文件

- `App.tsx`：`view` 加 `'launching'` 态，管理 `launchingPkg`、超时定时器。
- 新增 `src/components/AppLaunchingOverlay.tsx`：模糊背景 + 居中图标的过渡层。
- `VirtualScreen.tsx` / `useScrcpy.ts`：暴露 `onFirstFrame`；进入桌面时暂停渲染。
- `useAppManager`：提供 `getAppIcon(pkg)` 给过渡层（已有）。

### 关键交互行为

- **Home 键回桌面**：每次从虚拟屏回桌面都**回到第 1 页**（`scrollTo` 到第 0 页 snap 点），音乐卡片可见。
- **音乐卡片来源应用启动**：点击卡片主体 → `startApp(媒体 session 的 packageName)` → `setView('launching')`。卡片控制按钮区单独 `stopPropagation`。

## 6. 测试策略

测试沿用项目现有模式（Vitest + `fake-indexeddb`，见 `src/lib/__tests__/`）。

### 可单元测试的部分

| 测试目标 | 类型 | 测试文件 |
|---------|------|---------|
| `dumpsys media_session` 解析 | 单元测试 | `src/lib/__tests__/media-session-parser.test.ts` |
| `getMediaSession` / `dispatchMediaKey` 命令封装 | 单元测试（mock `runAdbCommand`） | `src/lib/__tests__/adb-commands.test.ts`（新增） |
| 应用列表分页切片 | 单元测试 | `src/lib/__tests__/app-pagination.test.ts` |
| 应用三段排序 | 单元测试 | 复用现有 `app-sorter.test.ts`（已存在） |

**媒体解析的健壮性测试**（技术风险点，必须用真实样例覆盖）：

准备多份 `dumpsys` 输出样本作为测试 fixture，覆盖：
- 正在播放的完整 session（含 title/artist/album/duration/position/state=3）。
- 暂停状态（state=2）。
- 多 session 并存（取第一个活跃的）。
- metadata 部分缺失（无 album）。
- 字段顺序不同的变体（验证不依赖行号/顺序）。
- 无活跃 session（返回 null）。

### 难以单元测试的部分（靠手动验收）

- scrcpy 启停、首帧就绪信号、过渡动画时序。
- 桌面↔虚拟屏切换、Home 回第一页。
- 触摸翻页 scroll-snap 行为。
- ADB 轮询与进度外推的真实时序。

### 测试优先级

1. **必做**：媒体解析（风险最高，格式多变）。
2. **应做**：分页切片（纯逻辑、易测、防回归）。
3. **可选**：命令封装 mock 测试。

### 不做的测试

- 不为过渡动画、scrcpy 时序做 E2E。
- 不为 React 组件渲染做快照测试。

## 7. 文件清单总览

### 新增

- `src/components/DesktopView.tsx` — 桌面容器
- `src/components/NowPlayingCard.tsx` — 音乐卡片
- `src/components/AppGrid.tsx` — 应用分页网格
- `src/components/AppIcon.tsx` — 抽取自 `ControlSidebar` 的独立应用图标组件
- `src/components/AppLaunchingOverlay.tsx` — 启动过渡层
- `src/hooks/useMediaSession.ts` — 媒体会话轮询与控制
- `src/lib/media-session-parser.ts` — `dumpsys` 解析纯函数（便于单测）
- `src/lib/app-pagination.ts` — 应用列表分页切片纯函数（便于单测）
- 测试：`media-session-parser.test.ts`、`app-pagination.test.ts`、`adb-commands.test.ts`

### 修改

- `App.tsx` — 新增 `view` 状态机、`launching` 流转、超时管理
- `ControlSidebar.tsx` — Home 按钮改为切回桌面
- `VirtualScreen.tsx` / `useScrcpy.ts` — 暴露 `onFirstFrame`、进入桌面时暂停渲染
- `adb-commands.ts` — 新增 `getMediaSession` / `dispatchMediaKey`
