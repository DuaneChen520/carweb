# 真机验收：scrcpy-server.jar 接受 `scid=` 参数（隧道隔离生效）

Status: ready-for-human
Type: task
Spec: ../spec.md（T4）
Blocked by: none

---

## What to verify

设备端 scrcpy server 必须接受 `--scid=<hex>` 参数，使每个会话走各自的反向隧道 `localabstract:scrcpy_<scid>`，互不拆毁。

## Why it matters

这是 T4「全屏作为第 3 路并发」的**物理前提**：

- @yume-chan 的 3_3_3/4_0 options 路径原本不暴露 `scid`，所有会话共用 `localabstract:scrcpy`；
- 后启动的会话在 `AdbScrcpyReverseConnection.initialize()` 中执行 `reverse.remove(localabstract:scrcpy)`，会**拆掉先启动会话已建立的隧道** → 先启动者 `AdbScrcpyExitedError`；
- 正因如此，旧代码才不得不用 `killScrcpyServer(pkill)` 先杀光其它会话。

代码侧已实现：每个 `ScrcpySession.start()` 生成独立 `scid`（`generateScid()`，31 位有界十六进制），由 `AdbScrcpyOptions4_0` 序列化产出 `scid=<value>`，连接层 `getSocketName` 用 `padStart(8,'0')` 零填充（见 ADR-0014 / ADR-0017）。单测已覆盖序列化格式，**但设备端 server 是否真的接受该参数未在真机验证**。

> 注：`scid` 必须为合法十六进制且数值 ≤ `0x7FFFFFFF`——设备端用 `Integer.parseInt(value, 16)` 读入 31 位有符号 int，溢出会在 server 启动期抛 `NumberFormatException` 并导致 `AdbScrcpyExitedError`。见 ADR-0014。

## Steps

1. 连接手机，进入分屏桌面模式，至少启动 2 个会话（左 pane + 右 pane）。
2. 抓设备端 scrcpy 进程的启动参数：
   ```bash
   adb shell "for p in \$(pidof app_process); do tr '\\0' ' ' < /proc/\$p/cmdline; echo; done" 2>/dev/null | grep scid
   ```
   或更直接地查反向隧道列表：
   ```bash
   adb reverse --list
   ```
3. 确认列表中存在**多个不同的** `scrcpy_<scid>` 条目。
4. 启动第 3 个会话（全屏），重复检查。

## Expected

- `adb reverse --list` 中同时存在 ≥ 2 个 `scrcpy_<不同 scid>` 条目，互不覆盖。
- 各会话的 scid 为 8 位十六进制、最高位 nibble ≤ `7`（数值 ≤ `0x7FFFFFFF`）。
- 后启动会话**不会**触发先启动会话的 `AdbScrcpyExitedError`。

## Actual

<!-- 待填 -->

## Notes

- 若 `adb reverse --list` 只有一条 `scrcpy_*`，说明隔离未生效——先查 `generateScid()` 是否产出唯一值、`serialize()` 是否真的带上 `scid=`。
- 若 server 因 scid 解析失败提前退出，Console 会有 `AdbScrcpyExitedError` 且 server stderr 出现 `For input string: "<scid>"`——那是 31 位溢出，与本条「参数不被接受」是两回事，参见 ADR-0014。
- 本条是 `issues/04` 与 `issues/05` 的前置。
