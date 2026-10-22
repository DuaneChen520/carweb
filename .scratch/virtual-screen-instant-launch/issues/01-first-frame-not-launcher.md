# 真机验收：新建虚拟屏后视频流首帧不是 Launcher 桌面

Status: ready-for-human
Type: task
Spec: ../spec.md（T1）
Blocked by: none

---

## What to verify

新建虚拟屏后，视频流的**首帧**不应是 Launcher 桌面（home），而应是黑屏/空屏，直到 app 被启动。

## Why it matters

T1 通过 `vdSystemDecorations:false`（scrcpy `--no-vd-system-decorations`）让虚拟屏不渲染状态栏/导航栏/Launcher。机制已由单测证明（`scrcpy4-options.test.ts` 断言虚拟屏分支 `serialize()` 含 `vd_system_decorations=false`，物理屏分支不含），但**真实设备上的渲染行为未验证**。

这是「多次跳转启动动画」的根因之一：若首帧仍是 home，用户会看到「home → app」两跳。

## Steps

1. USB 或无线连接手机（Android，开启 USB 调试）。
2. 进入分屏桌面模式（虚拟屏，非镜像）。
3. **不要**启动任何 app，观察左侧（或右侧）pane 的画面。
4. 记录首帧内容。

## Expected

- 首帧为**黑屏或空白**，不是 Launcher 桌面（无图标网格、无状态栏）。
- 启动 app 后画面直接显示 app，**没有** home → app 的两跳闪烁。

## Actual

<!-- 待填 -->

## Notes

- 若首帧仍是 Launcher，说明 `vd_system_decorations=false` 未被设备端 server 接受，需检查设备 ROM 对该选项的支持。
- 相关：`issues/02-empty-screen-no-home-frame.md`。
