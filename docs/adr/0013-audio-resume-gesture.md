# ADR-0013: 分屏桌面浏览器端音频恢复（AudioContext 手势唤醒）

- 状态：**已废弃（结论被 ADR-0015 推翻并取代）**；其中「D1 全局手势监听 / D1-bis」作为**唤醒机制**仍保留（现服务于 ADR-0015 的专用音频连接），但「根因 = 缺手势唤醒」的定性已不成立。
- 相关：ADR-0001（虚拟屏方向锁）、ADR-0004（scrcpy 4.0 flex display 迁移）、**ADR-0015（无声真因与修复，取代本 ADR）**

---

> ⚠️ **本 ADR 已被 ADR-0015 取代。** 本 ADR 把无声根因归为「分屏桌面缺手势唤醒 `AudioContext`」，但源码坐实真因为**设备级单一音频捕获（`REMOTE_SUBMIX`）被多个 `audio:true` 的 pane 争抢**——多数 pane 拿不到音频流 → 无 AudioContext → `resumeAudio` 永久 no-op。手势路径本身正确（用户日志已证 `resumeAudio` 被调用），治的是不存在的症状。修复方案见 ADR-0015（专用音频采集连接）。本 ADR 的 D1/D1-bis 唤醒机制仍保留，现服务于 ADR-0015 的专用连接。



## 背景（Context）

用户报告：分屏桌面（`DesktopScreen`）下浏览器端无法播放手机声音。

**关键事实（用户第二轮纠正，2026-07-14）：**
- 用户**基本没用过镜像模式**；即便单屏也是用虚拟屏（`--new-display`）开应用。
- **虚拟屏（flex display）音频在其设备上是正常的**——4.0 升级后那次音频问题已修复，之后测过 flex display 音频正常。
- 即：设备 + scrcpy server **能产出虚拟屏音频流**；`client.audioStream` 在虚拟屏下返回成功流。

**推论（推翻旧假设）：** 上一版 ADR 的「D2：虚拟屏下设备未产出音频流（上游根因）」**不成立**。无声根因在分屏桌面这条 UI 路径的**手势唤醒**环节。

git 历史核对（`src/lib/scrcpy-session.ts` `setupAudioStream` 自 `a449da6` 类化以来结构未变，浏览器侧链路完整正确）：
- 单屏 `VirtualScreen.tsx:260` 在 `handlePointerEvent`（画布 `onPointerDown`）里**直连** `resumeAudio()` → 单屏有声。
- 分屏桌面触控全部经 `useCanvasPointerInput`，该 hook 只调 `session.injectTouch()`、**从不调 `resumeAudio()`**。
- 第一版修复在 `DesktopScreen` 挂 `document` 全局 `pointerdown`/`keydown` 监听 → 用户实测**仍无声**，说明全局监听不足以覆盖（可能未触发/时序问题）。

---

## 决策（Decision）

### D1（已落地，必要但不充分）：全局手势监听
`DesktopScreen.tsx` 顶层挂全局监听，唤醒 `SessionManager` 所有 session 的 `resumeAudio()`。
- 初版为冒泡期；第三轮改为**捕获阶段**（`addEventListener(..., true)`），确保即使子元素 `stopPropagation` 也能唤醒，并兜底「未触控的 pane」。
- 用户实测仍无声 → 该路径在实践中不可靠，**不能作为唯一手段**。

### D1-bis（第三轮，主要修复）：触控 handler 直连 resumeAudio
在 `useCanvasPointerInput`（分屏/全屏画布的确定会触发的 pointer handler）的 `pointerdown` 分支**直接调 `session.resumeAudio()`**，与单屏 `VirtualScreen.tsx:260` 1:1 对齐。
- 理由：该 handler 由 `SplitPane`/`FullscreenOverlay` 挂在画布容器 div，触控注入可用即证明其必然触发；而全局 `document` 监听在分屏桌面实测未生效。被触控的 session 即时出声，最可靠。
- 全局捕获监听保留，兜底尚未触控的 pane（如左 pane 后台播视频、用户只在右 pane 操作）。

### D3（第三轮，诊断）：最小日志
- `resumeAudio()`：唤醒时打 `唤醒 suspended AudioContext`；无 `audioCtx` 时打 `无 AudioContext（音频流可能未建立）`。
- `setupAudioStream` 成功建流后打 `音频流已建立并开始播放（AudioContext state=…, codec=…）`。
- 用途：若仍无声，用户开 DevTools Console 即可区分「流未建立 / 流已建但未唤醒 / 已唤醒仍无声」三态，避免再猜。

---

## 后果与权衡（Consequences）

- ✅ D1-bis 与单屏工作路径完全一致，是最高置信度修复。
- ✅ 全局捕获监听 + 每触控唤醒双保险，覆盖多 pane 并发与后续启动 pane。
- ✅ `resumeAudio()` 仅在 `suspended` 时 `resume()`，幂等；`audioCtx` 未建时为 no-op（不会报错）。
- ⚠️ 仍需真机复核：分屏桌面进 app、点击/触控后是否出声；并看 Console 是否出现 `音频流已建立并开始播放`（确认流正常）+ `唤醒 suspended AudioContext`（确认唤醒链路通）。
- ❌ 旧 D2（上游流禁用）已否决：用户确认虚拟屏音频正常。

## 验证

- `tsc --noEmit` 0 错误。
- 真机：分屏桌面启动发声 app → 触控/点击后浏览器应出声；Console 应见 `音频流已建立并开始播放` 与 `唤醒 suspended AudioContext`。若仍无声，按 Console 三态日志定位。
