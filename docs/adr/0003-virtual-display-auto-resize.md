# ADR-0003: 虚拟屏自动调整与应用恢复

## 状态

已采纳

## 日期

2026-06-13

## 背景

用户连接手机后进入虚拟屏模式，虚拟屏尺寸基于车机浏览器窗口尺寸创建。当用户调整浏览器窗口大小时，虚拟屏需要同步调整以适配新尺寸。当前实现存在以下问题：

1. 窗口 resize 时没有防抖，导致频繁重启 scrcpy
2. 重启后虚拟屏中的应用丢失，需要用户手动重新打开
3. 侧边栏按钮在某些条件下不显示（如 `useMirrorMode` 检查过严）

## 决策

### 1. 默认模式

连接成功后默认进入虚拟屏模式（`useMirrorMode = false`），不再提供镜像模式作为默认选项。

### 2. 窗口 resize 防抖

使用 `useRef` + `setTimeout` 实现 300ms 防抖：
- 窗口尺寸变化时，清除上一个 timer 并设置新 timer
- 300ms 内没有新的尺寸变化时，才触发虚拟屏重启
- 避免用户拖动窗口过程中频繁重启 scrcpy

### 3. 虚拟屏前台应用恢复

重启虚拟屏前，通过 ADB 命令获取虚拟屏上的前台应用：

```bash
adb shell dumpsys activity activities | grep -E "mResumedActivity|displayId=<virtualDisplayId>"
```

重启完成后，自动启动记录的应用：

```typescript
// 记录前台应用
const foregroundApp = await getCurrentForegroundApp(adb, virtualDisplayId);

// 重启后恢复
await startApp(foregroundApp);
```

### 4. 侧边栏按钮显示条件

所有功能按钮（切换模式、调整尺寸、虚拟键盘等）仅检查 `isRunning`，不检查 `useMirrorMode`，确保在任何模式下都能操作。

## 实现流程

```
窗口 resize
    ↓
防抖 300ms
    ↓
获取虚拟屏前台应用包名
    ↓
stopScrcpy()
    ↓
等待 200ms（确保资源释放）
    ↓
restartCount++ → 触发 startScrcpy()
    ↓
新虚拟屏就绪
    ↓
启动记录的应用（如果有）
```

## 被否方案

| 方案 | 原因 |
|------|------|
| `wm size` 命令调整虚拟屏 | scrcpy 虚拟屏独立于 Android WindowManager，`wm size` 无效 |
| `resetVideo` 控制消息 | 仅重置视频流，不改变虚拟屏实际尺寸 |
| 实时无防抖 restart | 频繁重启导致 USB 连接不稳定 |
| 不恢复应用 | 用户体验差，每次 resize 都要手动重新打开应用 |

## 影响

- ✅ 窗口 resize 后虚拟屏自动适配新尺寸
- ✅ 重启后自动恢复之前打开的应用
- ✅ 侧边栏按钮在任何模式下都可用
- ✅ 300ms 防抖避免频繁重启
- ⚠️ 重启过程中有短暂黑屏（约 500ms）
- ⚠️ 如果虚拟屏上没有前台应用（如在桌面），重启后不会启动任何应用

## 关联

- `CONTEXT.md` — 术语定义（虚拟屏、镜像模式）
- `src/components/VirtualScreen.tsx` — 窗口 resize 监听与重启逻辑
- `src/hooks/scrcpy/useScrcpySession.ts` — scrcpy 启动/停止
- `src/lib/adb-commands.ts` — ADB 命令封装
