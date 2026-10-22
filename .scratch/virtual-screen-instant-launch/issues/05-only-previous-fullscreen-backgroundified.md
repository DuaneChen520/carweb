# 真机验收：仅上一全屏被 backgroundify（画面退回常驻虚拟屏、不停流）

Status: ready-for-human
Type: task
Spec: ../spec.md（T4）
Blocked by: none

---

## What to verify

连续两次「全屏启动」时，**只有上一个全屏**被 backgroundify（转为后台常驻，画面退回常驻虚拟屏且**流不中断**）；左/右常驻分屏不受影响。

## Why it matters

并发上限是 3（左 + 右 + 全屏）。启动新全屏前必须释放 1 个名额，释放方式必须是「精确 backgroundify 上一全屏」而不是「pkill 全局 scrcpy」。

`backgroundify` 的语义是：断开 scrcpy 流但**保留设备端虚拟屏**，画面退回该屏的常驻显示位。因此验证点有两个：
1. 上一全屏的 app **确实还在设备端虚拟屏里活着**（可恢复）；
2. 它的**流是断开的**（不占浏览器解码资源），而不是仍在后台解码。

## Steps

1. 进入分屏桌面模式，全屏启动 app A。
2. 再全屏启动 app B（A 被 backgroundify）。
3. 检查：app A 是否仍可见（画面退回某个 pane / 区域）？
4. 把 app A 从后台恢复（点侧栏对应项或切回），观察是否**瞬间回到前台**（复用原 displayId，不重建屏、不出现 Launcher 闪）。
5. 观察浏览器内存/CPU：被 backgroundify 的 A 不应继续占用视频解码。

## Expected

- app A 仍在运行，画面退回常驻位置且**不闪 home、不黑屏重建**。
- 恢复 A 时画面连续（`reparentCanvas` / attach 复用原 displayId）。
- 浏览器侧只保留 3 路活跃解码（两 pane + 一个全屏）。

## Actual

<!-- 待填 -->

## Notes

- 若恢复 A 时出现「Launcher 闪 → 黑 → app」，说明走的是新建虚拟屏而非 attach 复用，与 T5 的 `attachDisplayId` 实现不符。
- 相关：`issues/04-split-panes-keep-streaming-on-fullscreen-launch.md`（同一 T4 的另一验收面）。
