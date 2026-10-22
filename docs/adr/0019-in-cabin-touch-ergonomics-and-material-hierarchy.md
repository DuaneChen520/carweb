# ADR-0019: 座舱触控工效整行化与材质分层隔离

- 日期：2026-10-23
- 状态：已采纳

## 背景

ADR-0018 确立了 $\ge 48\times 48\text{px}$ 物理触控靶区与语义 Design Tokens。然而在深入全系统 20 余个组件的改造实施时，面临两大工程与视觉权衡：
1. **紧凑设置弹窗排版与 48px 靶区的冲突**：`ControlSidebar` 设置面板、`CacheSettingsDialog` 等组件内存在大量高度仅 20px 的独立药丸按钮。若简单加大按钮内边距，弹窗会过度膨胀且视觉失衡；
2. **拟态（Neumorphic）光影的滥用风险**：若将 `NeumorphicButton` 泛化到全系统所有浮层与分屏控件，厚重的拟态投影会严重遮挡并干扰投屏视频流本身。

## 决策

1. **车机原生整行触控 (List Row Touch Target)**：
   - 弹窗与设置项废弃微型药丸按钮，改为整行作为单一交互靶区（`min-h-[48px]`），点击整行切换状态或调出二级视图；
   - 独立小图标（如 20px）通过透明外壳容器（`w-12 h-12 flex items-center justify-center`）补足 48px 物理靶区，相邻元素强制保持 $\ge 8\text{px}$ 间距。
2. **材质分层隔离体系**：
   - **硬件常驻控制台**（`ControlSidebar` 主操作、PIN 码拨号盘）：保留 `NeumorphicButton` 物理机械质感与 Pointer 0 延迟即时下沉反馈；
   - **视频叠加层与动态浮窗**（分屏顶栏、`AppPicker`、`ActivityManagerPanel`）：统一采用 **座舱冷调微毛玻璃（Translucent Cockpit Glass）**（`surface.elevated` 配合 `backdrop-blur-md` 与微弱冷阴影），以低侵入度保障视频流内容可见度。
3. **字号硬性门禁与溢出截断**：
   - 彻底清除全库 `text-[10px]`，正文与标签统一不低于 12px（`text-xs`）；横向受限统一使用 `truncate`，杜绝车载视距下的不可读文本。
4. **三阶段波次演进 (3-Wave Incremental Rollout)**：
   - Wave 1: 常驻控制与全局外壳（`ControlSidebar`、`AppIcon`、`NowPlayingCard`、`App.tsx`）
   - Wave 2: 桌面流媒体与多窗区（`DesktopScreen`、`TopBarActionButton`、`PaneDropdown` 等）
   - Wave 3: 模态设置与连接遮罩区（`AppPicker`、`AppGrid`、`ConnectionOverlay` 等）

## 影响与后果

- **正面影响**：
  - 弹窗布局保持整洁紧凑，同时杜绝颠簸环境下的误触；
  - 投屏视频内容不再受到重拟态阴影干扰，软硬分明；
  - 建立清晰的分批演进路径，降低回归风险。
- **代价**：
  - 设置弹窗需要从“零散按钮组”重构为“List Row 列表布局”，重构工作量略有增加。
