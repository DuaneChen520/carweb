# 真机验收：新屏无 home 闪、目标 app 直接显示、不再发送 `am task move-to-display`

Status: ready-for-human
Type: task
Spec: ../spec.md（T2）
Blocked by: none

---

## What to verify

启动 app 到虚拟屏的路径已切换为 **scrcpy 原生 `controller.startApp`**（控制消息 type 16），主路径不再走 `am` 搬运。需在真机确认三件事：

1. 新建虚拟屏后**无 home 闪帧**；
2. 目标 app **直接显示**在虚拟屏；
3. 设备端**不再出现** `am task move-to-display` 调用。

## Why it matters

旧路径为 `am start --display` + 「主屏启动 → `move-to-display` 搬运」双路径回退，伴随三个 sleep（2000/2500/1500ms，累计约 6s），且依赖 ROM 是否支持 `am --display`——不支持时会退化成搬运，产生可见跳转。

原生 `startApp` 直接在会话附着的虚拟屏上启动 app，不依赖 ROM 能力。

## Steps

1. 连接手机，进入分屏桌面模式。
2. 从侧栏 dock 或全部应用浮窗启动任一 app（如「设置」）。
3. 观察是否出现「home → 主屏 app → 搬运到虚拟屏」的多跳。
4. **抓取设备端日志**确认无 `am task move-to-display`：
   ```bash
   adb logcat -c && adb logcat | grep -iE "move-to-display|ActivityTaskManager.*moveTask|am_task"
   ```
   或在应用调试时于 `adb shell` 中监听 ActivityTaskManager 的 moveTask 记录。

## Expected

- 目标 app 直接出现在虚拟屏，全程只有一次「打开」过渡，无 home 闪、无主屏闪现。
- 无 `move-to-display` 相关日志。
- 启动耗时明显短于旧路径（无 6s sleep 叠加）。

## Actual

<!-- 待填 -->

## Notes

- 若 app 仍先出现在手机主屏再被搬进虚拟屏，说明该路径回退到了 `am` 分支——需检查 `startAppOnDisplay` 是否仍被调用（现代多屏路径应统一走 `SessionManager` → `ScrcpySession`）。
- `adb-commands.startAppOnDisplay` 的 `am` 分支在 legacy hook 中仍保留（未被任何 UI 组件调用），属已知遗留，见 spec 的 T2「范围说明」。
