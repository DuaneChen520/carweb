# ADR-0001: 虚拟屏创建方向锁定方案

## 状态

**已被 2026-08-04 决策推翻**：`LockedInitial` 已改为 `Unlocked`（`src/lib/scrcpy-session.ts` 虚拟屏分支
`captureOrientation` 构造处，注释含完整论证）。原因：① `@` 锁首帧方向，宽屏容器仍显示竖屏画面，
与 flex display「宽窄自由调整」冲突；② server 端初始假设 `displayRotation=0` 与窄屏虚拟屏（w<h）
实际 rotation（部分 ROM 为 90）错位 → 窄屏 90° 翻转。`Unlocked` 下方向 = 虚拟屏 rotation = 容器宽窄方向，
由官方 4.0 server 的 OpenGL 过滤器 + DisplayMonitor 自愈保证方向正确，flex 全开。

原决策历史（已废弃）：曾以 `LockedInitial` 落地（2026-07 确认），用于防止 app 请求旋转导致尺寸翻转。

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

- `GLOSSARY.md` — 术语定义（「方向锁定（captureOrientation）」一节）
- `src/lib/scrcpy-session.ts` — 实现代码（`ScrcpySession.start()` 的 `captureOrientation` 选项）
- ADR-0011 — 虚拟屏启动过渡（本决策随其实施落地）