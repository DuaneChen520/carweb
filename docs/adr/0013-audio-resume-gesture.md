# ADR-0013: 分屏桌面浏览器端音频恢复（AudioContext 手势唤醒）

- 状态：已采纳（2026-07-14，经 `/grill-with-docs` 确认）
- 相关：无（独立音频修复，不涉及其它 ADR）

## 背景（Context）

用户报告：在分屏桌面（`DesktopScreen`）下，浏览器端无法播放手机声音，而此前单屏镜像模式（`VirtualScreen`）正常。

音频链路：`scrcpy 音频流 → 原始字节 → Web Worker 内 WebCodecs AudioDecoder 解码 → AudioWorklet → AudioContext.destination`。

`AudioContext` 在 `ScrcpySession.setupAudioStream`（`scrcpy-session.ts:579`）创建时即处于 **suspended** 状态——浏览器自动播放策略要求媒体音频必须由用户手势激活。代码刻意不在 setup 中调用 `resume()`（注释见 `useAudioDecoder.ts:166-168`），改由用户手势触发 `resumeAudio()`。

核查调用点：
- `VirtualScreen.tsx:260` 的 `handlePointerEvent` 在 `pointerdown` 调 `resumeAudio()` → 单屏镜像模式可出声。
- 分屏桌面的触控全部经 `useCanvasPointerInput`（`SplitPane.tsx:76` / `FullscreenOverlay.tsx:162`），该 hook **只调 `session.injectTouch()`，从不调 `resumeAudio()`**。
- `git log -S "resumeAudio" -- src/hooks/scrcpy/useCanvasPointerInput.ts` 为空 → 该路径历史上从未唤醒音频。
- `AppTransitionPlaceholder` 为 `pointer-events-none`，排除其拦截触控的可能；未提交的 ADR-0011 改动与音频无关。

结论：分屏桌面每个 `ScrcpySession` 的 `AudioContext` 永久停留 `suspended`，浏览器端无声。

## 决策（Decision）

在 `DesktopScreen.tsx` 顶层挂一个**持久化**的全局手势监听，任意用户交互即唤醒 **SessionManager 中所有活跃 session** 的 `AudioContext`：

```tsx
useEffect(() => {
  const resumeAllAudio = () => {
    const { sessions } = useSessionManager.getState();
    for (const entry of Object.values(sessions)) {
      entry.session.resumeAudio();
    }
  };
  document.addEventListener('pointerdown', resumeAllAudio);
  document.addEventListener('keydown', resumeAllAudio);
  return () => {
    document.removeEventListener('pointerdown', resumeAllAudio);
    document.removeEventListener('keydown', resumeAllAudio);
  };
}, []);
```

- `ScrcpySession.resumeAudio()`（`scrcpy-session.ts:934`）仅在 `audioCtx.state === 'suspended'` 时调用 `resume()`，幂等、无副作用；`audioCtx` 未建（音频流不可用）时为 no-op。
- 监听**持久化**（不一次性移除），使**稍后启动**的 pane（用户尚未触控）也能在下次任意交互时被唤醒；遍历对象在 handler 内实时读取，天然覆盖动态增删的 session。
- 范围限定 `DesktopScreen`：单屏镜像模式 `VirtualScreen` 已有自己的 `resumeAudio()` 调用，无需改动。

## 后果与权衡（Consequences）

- ✅ 分屏桌面浏览器端恢复出声；多 pane 并发（最多 3 路）与后续启动的 pane 均被覆盖。
- ✅ 监听持久化但开销极低（仅在 `suspended` 时调用 `resume()`），不影响交互性能。
- ✅ 静音（`isMuted`）/ 路由切到手机（`audioRoute==='phone'`）仍由 worklet 层拦截，行为不变。
- ⚠️ 依赖浏览器自动播放策略：当前 Chrome/Edge/Safari/Firefox 均认可 `pointerdown` 为有效用户激活；若未来某浏览器仅认 `click`，可追加 `click` 监听。

## 验证

- `tsc --noEmit` 0 错误；`vitest run` 全绿；`vite build` 成功。
- 真机实测（沙箱无设备，无法自动化）：进入分屏桌面 → 启动任意发声 app → 首次点击/按键后浏览器应出声；切换 pane、后续启动新 app 后再次交互亦出声。
