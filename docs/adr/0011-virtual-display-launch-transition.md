# ADR-0011: 虚拟屏应用启动 / 尺寸变化的统一过渡

- 状态：已采纳（2026-07-14，经 `/grill-with-docs` 五轮质疑后收敛）
-  supersedes/fulfills：ADR-0001（方向锁定决策当年写好却从未落到代码）
- 相关：ADR-0010（全部应用窗口收敛）

## 背景（Context）

用户报告：在分屏桌面打开虚拟屏应用时，观感为 **白屏 → 黑屏 → 白屏 → 跳转到实际应用**，每次启动都复现。

经五轮 grill 核查代码与 scrcpy 4.x 官方文档（`--capture-orientation`、虚拟屏专页），定位到**两类不同的白闪**，触发源不同：

### 白闪 A：启动时的方向翻转（原始抱怨）

链路：
1. 虚拟屏路径 `src/lib/scrcpy-session.ts:335` 显式写死
   `captureOrientation: ScrcpyCaptureOrientation.Unlocked`。
2. 启动竖屏 app → Android 把虚拟屏旋转为竖屏 → `Unlocked` 让采集方向**跟随** → 视频帧尺寸翻转（如 1920×720 → 720×1920）。
3. `src/lib/scrcpy4/flex-client.ts:96-99` 的 `onSessionPacket` 每遇尺寸变化即调 `setCanvasSize` →
   `src/lib/scrcpy-session.ts:422-425` 执行 `canvas.width=w; canvas.height=h`，**该赋值会清空 canvas 为透明**。
4. 透明 canvas 透出分屏容器 `bg-slate-100`（`src/components/desktop/SplitPane.tsx:126`，浅色≈白）→ **二次白屏**；
   显示面重配置瞬间为黑（`vdSystemDecorations:false` 无 Launcher）→ **黑屏段**；随后 app 首帧绘上。

对照：平板 / 镜像路径（`displayId:0`，`scrcpy-session.ts:344` 仅 `{ displayId: 0 }`，**不设** `captureOrientation`）
走 scrcpy 默认 = 锁定初始方向（等价于 `LockedInitial`），故平板启动顺滑、不翻转。
即 **carweb 在虚拟屏路径主动放弃了默认锁定、改成 `Unlocked`，才制造了翻转**。

### 白闪 B：拖动窗口导致的尺寸变化（grill 第五轮发现）

链路：
1. carweb 开启 `flexDisplay`；`SplitPane` 的 `ResizeObserver`（`SplitPane.tsx:95-121`）监听容器尺寸 →
   调 `flexClient.onContainerResize`，该调用有 150ms 防抖 + pending squash（`flex-client.ts:43-84`）。
2. 拖拽中：虚拟屏**尚未** resize，canvas 仅被 CSS `width/height:100%` 拉伸 → 画面变形但**不闪白**。
3. 停顿/松手（>150ms）：防抖触发 `RESIZE_DISPLAY` → 虚拟屏尺寸改为竖屏 →
   server 回传新尺寸 → `onSessionPacket` → `setCanvasSize` 清空 canvas → **闪一下白**（透出浅色容器）。

**关键**：白闪 B 是 **display RESIZE**（flex-display 特性），与方向锁无关；
即便 `LockedInitial` 锁死采集方向，虚拟屏尺寸仍被 `RESIZE_DISPLAY` 改写 → `canvas.width/height` 仍要对调清空 → **照样闪白**。
故 `LockedInitial` 修不了 B，两者需分别处理。

## 决策（Decision）

采用**两层修复 + 统一过渡**：

### D1. 落地方向锁定 `LockedInitial`（治白闪 A， fulfillment of ADR-0001）

`src/lib/scrcpy-session.ts` 改为：
```ts
import { ScrcpyNewDisplay, ScrcpyCaptureOrientation, ScrcpyLockOrientation, ScrcpyOrientation, ... } from '@yume-chan/scrcpy';
// ...
captureOrientation: new ScrcpyCaptureOrientation(ScrcpyLockOrientation.LockedInitial, ScrcpyOrientation.Orient0),
```
（`CaptureOrientation` 构造函数签名为 `(lock, orientation, flip?)`；`lock===LockedInitial` 时 `orientation`/`flip` 被忽略、
`toOptionValue()` 恒返回 `"@"`，传 `Orient0` 仅为满足类型。）

- 官方 scrcpy 4.x：`--capture-orientation=@` = 锁定初始方向；无 `@` = 跟随旋转。`LockedInitial` 即 `@`。
- **本决策即"锁=窗口宽高比"，无需硬编码 `LockedPortrait`/`LockedLandscape`**：
  虚拟屏由 `new ScrcpyNewDisplay(窗口宽, 窗口高)` 创建——竖窗创建出竖屏显示、横窗创建出横屏显示，
  `LockedInitial` 锁定的正是"这块显示创建时的初始方向"，而该方向由窗口宽高比（displayConfig）决定。
  故：竖窗(分屏左/右)→锁竖；横窗/全屏→锁横。**自适应横/竖车机屏与分屏竖 pane**，
  且优于硬编码 `LockedPortrait`（后者会把横窗里的横 app 强制侧躺）。
- **逐会话生效**：每个 left/right pane 与 fullscreen 都是独立 `ScrcpySession`、各自 `new ScrcpyNewDisplay(pane 尺寸)`
  （`buildPaneDisplayConfig` 从真实 DOM `[data-pane]` 尺寸 × dpr 推导，`DesktopScreen.tsx:43-59`）。
- 顺手**校验 `setRotationLocked(adb)`**（`scrcpy-session.ts:392`，Android 层旋转锁）对虚拟屏的可靠性：
  它阻止显示被 app 转走，使方向不符的 app 以"正立留黑边"而非"侧躺"呈现；`LockedInitial` 为其采集层双保险。

### D2. 统一「浅白背景 + 应用图标」过渡动画（治白闪 A 残白 + 白闪 B，覆盖启动与尺寸变化）

将浅色背景 + 应用图标占位作为**启动**与**尺寸变化**两类过渡的**统一动画**，参考 HyperOS 分屏尺寸变化占位：

- 触发：canvas 处于"无有效帧 / 过渡中"状态时显示，有效帧到达即淡出（与画面交叉淡入）。
  - 启动：`videoWidth === 0`（首帧未到）。
  - 尺寸变化：`onContainerResize` 发起 resize → 直到 `onSessionPacket(clientResized=true)` 确认新尺寸帧到达。
- 视觉：浅色底（与 pane 浅色主题一致）+ 居中应用图标（经 `getAppIcon(pkg)` 取）+ 轻量 scale-in / fade 动画。
- 新建 `src/components/desktop/AppTransitionPlaceholder.tsx` 取代原零引用死代码 `AppLaunchingOverlay.tsx`（已删除）；
  图标经 `useScrcpyContext().getAppIcon` 取得，容器内居中、浅色主题，而非全屏黑遮罩。

> 选择"浅白+图标"而非"容器改黑底"的依据：黑底仅把白闪变"黑闪"，仍是突变；
> 浅白+图标把间隙变成**有意的、带品牌感的过渡**，且一处实现统管启动与 resize 两类事件（用户在 grill 末轮指定）。

## 后果与权衡（Consequences）

- ✅ 启动不再白→黑→白：D1 消除方向翻转（白②+黑段），D2 把残白①变成有意的图标过渡。
- ✅ 拖动窗口横↔竖不再白闪：D2 把 resize 清屏间隙变成图标过渡（HyperOS 式）。
- ✅ 自适应横/竖车机屏与分屏竖 pane（D1 逐会话锁定）。
- ⚠️ 方向不符的 app（如竖 app 在横采集框）以**正立留黑边**呈现，而非铺满——车机横屏场景可接受（ADR-0001 ⚠️）。
  若将来需某 app 全屏竖屏，应改 `displayConfig` 初始方向，而非回退 `Unlocked` 翻转。
- ⚠️ 仍依赖 `setRotationLocked(adb)` 使显示不旋转，否则方向不符 app 可能被 scrcpy 采集层旋转成侧躺；
  D1 的 `LockedInitial` 为采集层兜底，但正立vs侧躺取决于显示层是否旋转。

## 验证

- `tsc --noEmit` 0 错误；`vitest run` 全绿；`vite build` 成功。
- 实测：虚拟屏启动 app 应呈"图标过渡 → 应用"而非白→黑→白；拖动分屏横↔竖应呈"图标过渡 → 新尺寸画面"而非白闪。
