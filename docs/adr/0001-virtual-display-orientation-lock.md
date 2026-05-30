# ADR-0001: 虚拟屏创建方向锁定方案

## 状态

已采纳

## 日期

2026-05-26

## 背景

当以 `ScrcpyNewDisplay` 创建虚拟屏（如 800×600 横向）后，某些 Android 应用（特别是 Launcher/桌面）启动时会调用 `setRequestedOrientation()` 请求竖屏方向，导致虚拟屏显示内容旋转为 600×800（纵向）。虽然车机浏览器的容器尺寸不变，但 scrcpy 视频流报告的尺寸翻转，Canvas 渲染区域也随之变化，最终在横向容器内出现竖屏画面。

## 决策

在虚拟屏场景下，通过 `captureOrientation` 选项锁定视频捕捉方向为初始方向：

```typescript
captureOrientation: new ScrcpyCaptureOrientation(
  ScrcpyLockOrientation.LockedInitial, // 锁定到初始方向
  ScrcpyOrientation.Orient0,           // 0°
)
```

## 被否方案

| 方案 | 原因 |
|------|------|
| Android 层锁方向（adb 广播） | 粗暴，影响同一设备上的其他连接 |
| Freeform 多窗口模式 | 需要修改 Android 系统配置，复杂性高 |
| `angle` 选项 | 仅旋转画面，不解决尺寸翻转问题 |
| 不做处理 | 应用反复旋转导致画面跳动，体验差 |

## 影响

- ✅ 视频流尺寸始终保持创建时的方向，Canvas 渲染区域稳定
- ✅ Android 侧的虚拟屏仍然可以正常旋转（不影响应用本身的行为）
- ✅ 改动量小（一行配置），无侵入性
- ⚠️ 如果虚拟屏初始方向不一定是用户想要的（如某些应用设计为竖屏），app 内容可能会在横向框架内显示，但这对车机横向场景是合理的

## 关联

- `CONTEXT.md` — 术语定义
- `src/hooks/useScrcpy.ts` — 实现代码