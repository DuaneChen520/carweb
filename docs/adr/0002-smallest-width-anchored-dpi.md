# ADR-0002: 基于 sw（Smallest Width）锚点的 DPI 计算方案

## 状态

已采纳

## 日期

2026-06-13

## 背景

车机浏览器通过 Scrcpy 创建虚拟屏时，需要在手机上模拟一个虚拟显示屏。Android 应用通过 **sw（smallest width）** 判断设备是大屏还是小屏设备，标准大屏阈值为 `sw >= 600dp`。

当前 DPI 使用固定公式 `dpi = 320 × dpiMultiplier × dpr`，这意味着对于 800×600 的虚拟屏（原始预设），DPI 固定为 320，计算出的 sw 仅为 `300dp`——远低于 600dp 的大屏阈值。这导致小红书、Bilibili 等应用无法触发平板/大屏布局，始终以手机竖屏模式呈现。

## 决策

将 DPI 计算方式从"固定基数 × 倍率"改为**以 sw 为锚点**，核心公式：

```
dpi = min(width, height) × 160 / sw_target
```

其中：
- **sw_target** = 600dp（Android 标准大屏阈值），固定值
- **width / height** 由容器尺寸 × 预设 scale × DPR 计算得出
- 160 是 Android 的 mdpi 基准密度常数

关键选择：

| 决策项 | 结论 |
|--------|------|
| sw_target | 固定 600dp，不做动态调整 |
| 预设间关系 | 所有预设共享同一 sw 目标，预设只控制分辨率缩放 |
| DPR 处理 | 自动继承——w/h 已含 dpr 因子，DPI 随之等比变化，sw 不受 DPR 影响 |
| DPI 上下限 | 暂不限制，遇到问题再调整 |

## 被否方案

| 方案 | 原因 |
|------|------|
| 当前固定 DPI 方案 | 无法达到 600dp 阈值，应用无法触发大屏布局 |
| 按预设各自设定 sw 目标 | 增加复杂度，且用户无法直观理解不同预设对应的 sw 值 |
| sw 作为用户可调参数 | 对用户暴露底层概念，增加学习成本，且核心目标是统一达到大屏阈值 |

## 影响

- ✅ 所有应用看到 sw ≥ 600dp，自动触发大屏/平板响应式布局
- ✅ DPR 不再影响 sw 计算结果（w/h 翻倍 → DPI 翻倍 → sw 不变），跨设备一致
- ✅ 移除 `dpiMultiplier` 预设字段，减少一个需要维护的参数
- ⚠️ 极低分辨率（如流畅预设 200×150）下 DPI 可能低于 Android 正常范围（~40dpi），UI 控件可能异常大
- ⚠️ 极高分辨率下 DPI 可能超过 640，UI 控件可能异常小

## 关联

- `CONTEXT.md` — 术语定义，新增 sw、DPI/Resolution 的解耦描述
- `src/components/VirtualScreen.tsx` — `displayConfig` DPI 计算逻辑
- `src/hooks/scrcpy/useScrcpySession.ts` — RESOLUTION_PRESETS 定义