# 真机验收：空屏（未启动 app）时不渲染 home 帧

Status: ready-for-human
Type: task
Spec: ../spec.md（T1）
Blocked by: none

---

## What to verify

虚拟屏处于「空屏」状态（未启动任何 app）时，**不应**渲染任何 home 帧——只能是黑屏或纯空白。

## Why it matters

与 `issues/01-first-frame-not-launcher.md` 是同一条机制的两个观察面：

- 01 看**首帧**（启动前的第一帧是什么）；
- 本条看**持续态**（空屏期间是否会被 Launcher 周期性绘制）。

若空屏期间偶发刷出 home 帧，用户在切换 pane / 恢复后台 app 时会看到「home 闪一下」，即原始工单描述的「多次跳转」。

## Steps

1. 连接手机，进入分屏桌面模式。
2. 启动一个 app，随后关闭它（或切到另一个空 pane）。
3. 观察空 pane 的画面至少 30 秒，留意是否有任何 home 帧闪现。
4. 期间做一次 pane 切换、一次分辨率切换（会触发 flex resize）。

## Expected

- 空 pane 始终黑屏/空白，无 Launcher 图标、无状态栏。
- pane 切换与分辨率切换过程中不出现 home 帧。

## Actual

<!-- 待填 -->

## Notes

- 相关：`issues/01-first-frame-not-launcher.md`（同一 `vdSystemDecorations` 开关）。
- 若出现 home 闪帧，记录闪帧时机（切换瞬间 / resize 瞬间 / 定时出现）。
