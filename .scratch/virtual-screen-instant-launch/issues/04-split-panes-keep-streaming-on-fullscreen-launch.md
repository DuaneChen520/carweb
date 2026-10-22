# 真机验收：全屏启动新 app 后左/右分屏画面继续流、不黑屏、不被杀

Status: ready-for-human
Type: task
Spec: ../spec.md（T4）
Blocked by: none

---

## What to verify

从应用抽屉**全屏启动**一个新 app 时，左/右常驻分屏的 scrcpy 流应**继续播放**（不黑屏、不被杀、不需重启）。

## Why it matters

这是 T4 的核心验收项。旧实现 `launchFullscreen` 开头会执行全局 `killScrcpyServer`（`pkill -f scrcpy`）并对两个分屏做 `backgroundify`，导致用户正在看的分屏被静默杀掉。

T4 去掉全局 pkill 后，「全屏作为第 3 路并发」在真机上**依赖 scid 隧道隔离**才成立——若隧道未隔离，新会话会 `reverse.remove` 拆掉先启动会话的隧道，导致先启动者崩溃（见 `issues/06-scid-tunnel-isolation.md`）。

因此本条与 `06` 互为前提：**若 06 失败，04 必然失败**。

## Steps

1. 连接手机，进入分屏桌面模式。
2. 左 pane 启动 app A，右 pane 启动 app B（两个分屏都有持续播放的画面，如视频/音乐）。
3. 从全部应用浮窗**全屏启动** app C。
4. 观察左、右两个 pane 的画面。

## Expected

- 左、右 pane **持续播放**，无黑屏、无卡死、无「重新加载」提示。
- 全屏层正常显示 app C。
- 三路并发不触发 `AdbScrcpyExitedError: scrcpy server exited prematurely`。

## Actual

<!-- 待填 -->

## Notes

- 若分屏黑屏，先看 Console 是否有 `AdbScrcpyExitedError`——那指向 scid 隧道问题（`issues/06`），不是本条验收项本身。
- 观察分屏画面时建议用有连续运动画面的 app（视频），静止画面容易掩盖「流停了但画面还在」的情况。
