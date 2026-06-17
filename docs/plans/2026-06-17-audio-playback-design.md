# 浏览器音频播放方案设计

## 背景

CarWeb 项目通过 scrcpy 镜像 Android 屏幕到车机浏览器。当前音频功能已禁（`audio: false`），需要实现从浏览器设备（车机扬声器）发声，并确保音频质量与性能。

## 需求

- 将 Android 设备的音频通过浏览器输出到车机扬声器
- 支持「手机发声 / 浏览器发声」路由切换（静默切换，无需重启 scrcpy）
- 支持静音开关
- 音频质量稳定、无爆音、解码不阻塞 UI

## 架构：三上下文隔离（方案 D）

音频系统跨越三个独立的执行上下文，各司其职：

```
[scrcpy audio stream]  (encoded Opus/AAC packets)
  │ 主线程读取 ScrcpyMediaStreamPacket
  │ postMessage(transfer)
  ▼
[AudioDecoder Worker]      →   解码层
  │ AudioDecoder(WebCodecs) → PCM Float32Array
  │ postMessage(transfer)
  ▼
[Main Thread]              →   路由 & 转发层
  │ 判断 route/muted，转发或丢弃
  │ worklet.port.postMessage(transfer)
  ▼
[AudioWorklet Thread]      →   渲染层
  │ 内部 PCM 队列 + OLA 重采样
  │ process() → AudioContext.destination
```

### 关键特征

- 解码在 Worker，完全不阻塞主线程 UI/触摸
- 渲染在 AudioWorklet，不受主线程 GC 影响
- 主线程只做消息转发（微秒级），负载 ≈ 0
- 全部通过 `postMessage` + transfer 传递 ArrayBuffer（零拷贝）
- 无需 SharedArrayBuffer，无 COOP/COEP 要求，GitHub Pages 可直接部署

## 消息协议

### Worker ↔ Main Thread

| 方向 | 消息 | 说明 |
|------|------|------|
| Main → Worker | `{ type: 'configure', codec, description? }` | 配置 AudioDecoder |
| Main → Worker | `{ type: 'data', chunk: { type, data, timestamp } }` | 编码数据帧 |
| Main → Worker | `{ type: 'reset' }` | 重置解码器 |
| Worker → Main | `{ type: 'pcm', buffer, sampleRate, channels }` | 解码后的 PCM 数据 |
| Worker → Main | `{ type: 'error', message }` | 解码错误 |
| Worker → Main | `{ type: 'configured' }` | 配置完成 |

### Main Thread ↔ AudioWorklet

| 方向 | 消息 | 说明 |
|------|------|------|
| Main → Worklet | `{ type: 'pcm', buffer, sampleRate, channels }` | PCM 数据投递 |
| Main → Worklet | `{ type: 'mute', value }` | 静音状态同步 |
| Main → Worklet | `{ type: 'reset' }` | 清空队列重置 |

## AudioWorklet 缓冲区管理

参考 Tango ADB `@yume-chan/pcm-player` 和 scrcpy C 客户端的设计：

- **启动门槛**：≥0.1s 缓冲才开始播放，避免首帧欠载
- **目标水位**：0.15s ~ 0.25s，正常播放
- **加速模式**：>0.25s，OLA 重采样（scale=0.9）加快消耗
- **恢复模式**：<0.15s，恢复正常速度

OLA 算法将输入窗口（3000 samples）以 90% 比例重叠输出（2700 samples），在不改变音调的前提下微调播放速度。

## 路由控制与静音

- Worker **始终解码**（切换零延迟）
- 主线程根据 `route` 和 `muted` 决定是否转发 PCM 到 AudioWorklet
- `route === 'phone'`：不转发（手机扬声器发声）
- `muted === true`：不转发（车机静音）
- `route === 'browser' && !muted`：正常转发

## 错误处理

| 错误 | 处理 |
|------|------|
| 设备不支持音频（Android < 11） | 图标灰显，视频/控制不受影响 |
| 解码器配置失败 | 自动重试 3 次，仍失败则标记 errored |
| AudioWorklet 崩溃 | 自动重建 WorkletNode |
| AudioContext suspended | 用户手势 resume |
| scrcpy 断开 | 随 scrcpy 停止自动清理 |

## 文件结构

```
src/hooks/scrcpy/
├── useAudioDecoder.ts        ← 编排 Worker + AudioWorklet + 路由状态
├── audio/
│   ├── types.ts              ← 跨上下文消息类型定义
│   ├── decoder-worker.ts     ← Web Worker：AudioDecoder 解码
│   └── renderer-worklet.ts   ← AudioWorklet：PCM 渲染 + OLA
```

## 集成点

- `useScrcpySession.ts`：`audioDecoder.startAudio(client)` 替换 `audioDecoder.setupAudioStream(client)`
- `ScrcpyContext`：新增 `audioRoute`、`setAudioRoute`、`isMuted`、`setMuted`、`audioStatus`
- `ControlSidebar`：喇叭图标（静音 toggle）+ 设置面板（路由选择）
- `VirtualScreen`：现有 `resumeAudio()` 在 `handlePointerEvent` 中保持不变

## Vite 构建

- Worker：Vite 原生支持 `new Worker(new URL('./path', import.meta.url))`
- AudioWorklet：通过 `audioContext.audioWorklet.addModule(url)` 加载
- 需要 `@types/audioworklet` 包提供类型
- 额外 `tsconfig.worker.json` 用于 worklet 文件编译

## 测试策略

- 解码逻辑提取为纯函数，Vitest 可测
- 消息协议格式验证（mock Worker/mock Worklet）
- 运行时日志监控（`console.debug('[audio]', ...)`）
- 手动测试覆盖：启动、静音、路由切换、设备不支持、长时间播放
