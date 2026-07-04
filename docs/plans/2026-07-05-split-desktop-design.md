# Web 原生分屏桌面设计

- 日期：2026-07-05
- 状态：已确认，待实施
- 替代：当前 VirtualScreen 主区域加载上一次打开应用的逻辑

## 1. 目标

用 Web 原生的左右分屏桌面替代当前"加载上一次应用"的入口逻辑，参考小米汽车车机桌面的分屏体验。两个分屏均可独立打开应用，支持分屏 ↔ 全屏切换、活动进程管理、状态持久化与多设备隔离。

## 2. 架构总览

### 2.1 核心改动：ScrcpySession 实例化

把 `useScrcpySession` 从模块级单例改成**实例化的 Session 类**。每个运行中的 app 对应一个 `ScrcpySession` 实例，各自维护 `client / controller / displayId / videoDecoder / audioDecoder / flexClient`，按 PID 精确 kill 自己的 scrcpy 进程（不再 `pkill -f scrcpy` 全杀）。

### 2.2 App 运行状态四态

| 状态 | 说明 | scrcpy | 虚拟屏 |
|---|---|---|---|
| `foreground-pane` | 在某分屏内前台显示 | 活，流式传输 | 活 |
| `foreground-fullscreen` | 全屏覆盖桌面区域 | 活，流式传输 | 活 |
| `background` | scrcpy 断开，app 进程在设备上跑 | 断 | 活（keepActive 保住） |
| `closed` | 完全销毁 | 断 | 销毁 |

### 2.3 并发上限

- 最多 3 个 streaming session：左分屏 + 右分屏 + 1 个全屏覆盖层
- N 个 background session（仅占设备虚拟屏，不占浏览器解码资源）

### 2.4 组件层级

```
App.tsx
└─ DesktopShell (新，替代当前 VirtualScreen 主区域)
   ├─ ControlSidebar (常驻，占据固定宽度，任何状态下都显示)
   └─ DesktopArea (侧边栏右侧的剩余区域，flex-1)
      ├─ SplitPane × 2 (新)
      │   └─ PaneCanvas + 顶部下拉悬浮控件
      ├─ FullscreenOverlay (新，全屏覆盖层，z-index 高于 SplitPane，覆盖 DesktopArea)
      └─ ActivityManagerPanel (新，活动进程管理浮窗，z-index 最高)
```

### 2.5 侧边栏常驻原则

ControlSidebar **任何时候都常驻**，且**占据屏幕固定宽度**（沿用现有 `w-13` ≈ 52px）：

- 分屏桌面状态：侧边栏 | 左 pane | 右 pane（左右 pane 平分侧边栏右侧的剩余宽度）
- 全屏覆盖状态：侧边栏 | FullscreenOverlay（覆盖层只覆盖 DesktopArea，不遮住侧边栏）
- 活动管理浮窗：浮在 DesktopArea 之上，侧边栏仍可见可点
- 全部应用浮窗：从侧边栏按钮触发，浮在侧边栏右侧

侧边栏的 z-index 低于浮窗（ActivityManagerPanel / 全部应用），但 DesktopArea 内部的覆盖层（FullscreenOverlay）不遮住侧边栏。

### 2.6 SessionManager

新 hook / store，统一管理所有 `ScrcpySession` 实例、状态机、displayId 池、活动列表。所有组件通过它读写，不直接持有 session。

## 3. 状态转换矩阵

| 触发动作 | 全屏 app | pane 1 | pane 2 |
|---|---|---|---|
| 分屏下拉「全屏」 | scrcpy 接管，来源 pane 显示占位 | 占位（"全屏中"） | 不变 |
| 全屏下拉「分屏」选来源 pane | scrcpy 切回 pane | 恢复 streaming | 不变 |
| 全屏下拉「分屏」选另一 pane | scrcpy 切到另一 pane | 来源 app → 关闭（force-stop） | 新增 streaming |
| 全屏下拉「关闭」 | force-stop + 销毁 | 不变 | 不变 |
| 全屏 → 点桌面（来自 pane） | 回来源 pane | 恢复 | 不变 |
| 全屏 → 点桌面（来自侧边栏 + 有空 pane） | 放空 pane | 不变 | 新增 streaming |
| 全屏 → 点桌面（来自侧边栏 + 无空 pane） | → background | 不变 | 不变 |
| 分屏下拉「切换」 | — | 旧 app 关闭，新 app 启动 | 不变 |
| 分屏下拉「关闭」 | — | 销毁，pane 空态 | 不变 |

### 3.1 关键原则：session 不重启，只换渲染目标

分屏 ↔ 全屏转换时，scrcpy session 全程不重启，只切换渲染目标 canvas。音频画面连续不断。唯一会断的情况是 app 被关闭或进 background（scrcpy 断开）。

### 3.2 分屏→全屏时另一 pane 的处理

另一 pane 的 app **保留不动**（被全屏覆盖层遮住，scrcpy 保持活着）。退出全屏时：
- 选来源 pane → 直接恢复，零成本
- 选另一 pane → 走覆盖确认流程

## 4. 顶部下拉菜单设计

### 4.1 分屏应用顶部下拉

| 左侧 | 右侧 |
|---|---|
| 应用名 + 切换 | 全屏 + 关闭 |

- 下拉图标透明悬浮于组件上，不占据画面尺寸
- 「切换」= 关闭旧 + 打开新（旧 app 走 closed 路径）
- 「全屏」= 进入全屏覆盖层
- 「关闭」= force-stop + 销毁 session + 销毁虚拟屏，pane 回空态

### 4.2 全屏应用顶部下拉

| 左侧 | 右侧 |
|---|---|
| 应用名 | 分屏（选左右 + 覆盖确认）+ 关闭 |

- 「分屏」点击后弹子菜单，展示左右 pane 当前状态：
  - 来源 pane 选项：显示 app 图标 + "恢复"标签，点击直接恢复，无确认
  - 另一 pane 选项：显示当前 app 图标（若有）或"空闲"
    - 有 app 时弹覆盖确认："覆盖将关闭 xx 应用" → 确认/取消
    - 空闲时直接放入
- 「关闭」= force-stop + 销毁 session + 销毁虚拟屏

### 4.3 覆盖语义

覆盖 = 关闭（force-stop + 销毁 session）。用户主动选的，音乐 app 被覆盖就断音乐。这是用户的主动选择，可接受。

## 5. 启动入口矩阵

| 触发入口 | 启动结果 | 状态 |
|---|---|---|
| 空 pane 中央"点击打开应用" → 全部应用选中 | 进该 pane（组件尺寸） | `foreground-pane` |
| 侧边栏 pinned app 点击 | 全屏启动 | `foreground-fullscreen` |
| 侧边栏"全部应用"按钮 → 选中 | 全屏启动 | `foreground-fullscreen` |
| 全屏覆盖层内触发任何侧边栏入口 → 选 app | 全屏切换（旧全屏 → background，新 app 全屏） | `foreground-fullscreen` |

### 5.1 全屏切换的旧 app 处理

侧边栏/全部应用触发全屏启动新 app 时：
- 当前全屏 app（如有）→ `background`（scrcpy 断开，虚拟屏 keepActive 保住，可从活动管理恢复）
- 两 pane 的 app → `background`
- 新 app 以 `foreground-fullscreen` 启动

### 5.2 pane 填充路径

pane 的填充路径只有三条：
1. 空 pane 中央点击 → 选 app 进 pane
2. 全屏 app 点桌面 → 落空 pane（§6 规则）
3. 全屏下拉「分屏」选 pane

## 6. 全屏 → 点桌面规则

按"优先来源 pane、其次空 pane、再次 background"的优先级判定：

| 情况 | 行为 |
|---|---|
| 全屏 app 来自某 pane（分屏→全屏） | 回来源 pane，恢复 streaming |
| 全屏 app 来自侧边栏/全部应用 + 有空 pane | 放进空 pane（左空先进左，左占右空进右），转 `foreground-pane` |
| 全屏 app 来自侧边栏/全部应用 + 两 pane 都占用 | 全屏 app → background，覆盖层关闭，露出原分屏桌面 |

覆盖层关闭后，分屏状态保持不变（用户点桌面前是什么样就什么样）。

## 7. 活动进程管理

### 7.1 触发

侧边栏底部新增「活动进程」按钮（与现有"全部应用"按钮区分），触发 `ActivityManagerPanel` 浮窗。

### 7.2 列表内容

所有非 closed 状态的 app，按状态排序展示：
1. `foreground-fullscreen` —— 标注"全屏中"，info 蓝边框
2. `foreground-pane` —— 标注"小窗中 · 左/右分屏"，info 蓝边框
3. `background` —— 标注"后台"，普通样式

### 7.3 每条进程的操作

- **进入**：
  - foreground-fullscreen → 关闭覆盖层外的其他显示，聚焦到全屏
  - foreground-pane → 关闭覆盖层（若有），聚焦到该 pane
  - background → 恢复 scrcpy 到某位置（见 §7.4）
- **关闭**：force-stop + 销毁 session + 销毁虚拟屏，从列表移除

### 7.4 background → 前台恢复落点规则

从活动管理点"进入"一个 background app 时：
1. 若当前有全屏覆盖层 → 该全屏 app 进 background，覆盖层承接新 app（转 foreground-fullscreen）
2. 否则有空 pane → 放进空 pane（转 foreground-pane）
3. 否则两 pane 都占 → 覆盖左 pane（force-stop 左 pane app），新 app 进左 pane

默认覆盖左 pane，不弹选择（活动管理是"快速切换"语义，避免多一步交互）。

### 7.5 全部关闭

遍历所有进程执行关闭，pane 回空态，覆盖层关闭。

## 8. 分屏状态持久化

### 8.1 存储结构

新增 IndexedDB store `carweb-desktop-state`，沿用项目现有模式（`deviceSerial` 为主键，多设备天然隔离）。

```ts
{
  deviceSerial: string;      // 主键，多设备隔离
  paneLeft: string | null;   // 左 pane 的 packageName
  paneRight: string | null;  // 右 pane 的 packageName
  savedAt: number;           // 写入时间戳
}
```

### 8.2 只记 pane，不记全屏和后台

- 全屏是临时态，下次进入应该看到分屏桌面，不是全屏
- 后台 app 进程在设备重启/scrcpy 断开后不可靠恢复，记了也白记
- pane 是用户"留下的桌面布局"，最该恢复

### 8.3 读取时机

`App.tsx` 连接成功 + Pin 校验通过后，读取该 serial 的记录，在对应 pane 调 `startAppOnDisplay` 启动 app。

### 8.4 写入时机

pane 打开/关闭/切换 app 时异步写入（不阻塞 UI）。仅记 packageName，不记运行态。

### 8.5 失效处理

读取到的 packageName 若设备已卸载，`startAppOnDisplay` 会失败，pane 保持空态并提示。

## 9. 侧边栏改造

### 9.1 新增按钮

- **活动进程**按钮 —— 触发 `ActivityManagerPanel`
- **桌面**按钮（现有 `Home` 按钮语义变更）—— 从"goHome（发 Android Home intent）"改为"切换到 Web 桌面视图"
  - 当前在全屏覆盖层 → 执行 §6 的"点桌面"规则
  - 当前在分屏桌面 → 无操作（或回到两 pane 默认聚焦）

### 9.2 保留按钮

返回、断开、全屏（浏览器全屏）、设置、音频、物理屏开关。

### 9.3 pinned app 列表

保留，但点击行为变更：从"全屏 startApp"沿用统一全屏启动语义（见 §5）。

## 10. 全部应用组件双模式

现有 `AppGrid` / `AppGridIcon` 触发的"全部应用"浮窗支持两种启动模式，由触发来源判定：

**模式 A：pane 模式**（来自空 pane 中央点击）
- 用户选中 app → 在该 pane 启动（`foreground-pane`）
- 若 pane 已占用（理论上不会，因为入口是空 pane），走覆盖确认

**模式 B：全屏模式**（来自侧边栏按钮，无论是否在覆盖层内）
- 用户选中 app → 当前全屏 app（如有）进 background → 新 app 以 `foreground-fullscreen` 启动
- 无需选择 pane

## 11. 首次进入桌面的空状态

两 pane 都空时，每个 pane 正中显示：
- App 图标占位（虚线框）
- 文案"点击打开应用"
- 点击 → 弹出"全部应用"浮窗（pane 模式），选中后在该 pane 启动

## 12. 布局

### 12.1 始终常驻的侧边栏

ControlSidebar **任何时候都常驻并占据屏幕固定宽度**（沿用现有 `w-13` ≈ 52px）。无论桌面处于分屏、全屏覆盖、活动管理浮窗、全部应用浮窗等任何状态，侧边栏始终可见可点。

### 12.2 分屏桌面布局

首次进入桌面展示布局：`侧边栏 | 左应用组件 | 右应用组件`。

- 侧边栏固定宽度（`w-13`）
- 左右应用组件平分侧边栏右侧的剩余宽度（各占 50%，中间留分隔间距）
- 尺寸随窗口大小响应式动态调整

### 12.3 全屏覆盖布局

全屏覆盖层只覆盖侧边栏右侧的 `DesktopArea`，不遮住侧边栏：`侧边栏 | FullscreenOverlay`。用户在全屏状态下仍可操作侧边栏的所有按钮（返回、桌面、活动进程、全部应用等）。

### 12.4 浮窗层级

| 层级 | 组件 | 说明 |
|---|---|---|
| 最底 | ControlSidebar + DesktopArea（SplitPane × 2） | 常驻布局 |
| 中 | FullscreenOverlay | 覆盖 DesktopArea，不遮侧边栏 |
| 高 | ActivityManagerPanel / 全部应用浮窗 | 覆盖整个区域（含侧边栏），但侧边栏按钮仍可点击触发 |

> 浮窗（ActivityManagerPanel / 全部应用）从侧边栏按钮触发，定位为 `fixed`，可覆盖侧边栏。点击侧边栏其他按钮会关闭当前浮窗。

## 13. 实施备注

### 13.1 关键技术点

- **ScrcpySession 实例化**：当前 `useScrcpySession` 用模块级 ref 持有单例，需重构为可实例化的类/factory，支持多实例并发
- **PID 精确 kill**：替代 `pkill -f scrcpy`，按 session 记录自己的 server PID，关闭时精确 kill
- **渲染目标切换**：scrcpy 的 videoDecoder 需支持动态切换输出 canvas，不重建解码器
- **displayId 池管理**：SessionManager 维护可用 displayId，background 恢复时复用原 displayId

### 13.2 待实施拆分建议

1. ScrcpySession 类化 + SessionManager
2. DesktopShell + SplitPane + 空状态
3. 顶部下拉菜单（分屏 + 全屏）
4. FullscreenOverlay + 渲染目标切换
5. ActivityManagerPanel
6. 分屏状态持久化 + 启动恢复
7. ControlSidebar 改造
8. 全部应用双模式
