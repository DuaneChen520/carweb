# Audio Playback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable browser audio playback from Android device via scrcpy with Worker decoding and AudioWorklet rendering.

**Architecture:** Three-context isolation model — AudioDecoder runs in a Web Worker (no UI blocking), PCM data transfers via `postMessage` to main thread which forwards to AudioWorklet for sample-accurate rendering with OLA resampling. No SharedArrayBuffer, no COOP/COEP, GitHub Pages compatible.

**Tech Stack:** WebCodecs `AudioDecoder`, Web Audio API `AudioWorklet`, `postMessage` transferables, `@types/audioworklet`, Vite `new URL` asset handling.

**Design doc:** `docs/plans/2026-06-17-audio-playback-design.md`

---

### Task 1: Setup dependencies and directory structure

**Files:**
- Modify: `package.json`
- Create: `src/hooks/scrcpy/audio/`
- Create: `tsconfig.worker.json`

**Step 1: Install `@types/audioworklet`**

Run: `npm install --save-dev @types/audioworklet`
Expected: package added to devDependencies

**Step 2: Create audio directory**

Run: `mkdir -p src/hooks/scrcpy/audio`

**Step 3: Create `tsconfig.worker.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "AudioWorklet"],
    "types": ["audioworklet"],
    "strict": false,
    "skipLibCheck": true,
    "noEmit": false,
    "outDir": "./dist"
  },
  "include": ["src/hooks/scrcpy/audio/renderer-worklet.ts"]
}
```

**Step 4: Commit**

```bash
git add package.json tsconfig.worker.json src/hooks/scrcpy/audio/
git commit -m "chore: setup audio worklet dependencies and directory"
```

---

### Task 2: Shared message types

**Files:**
- Create: `src/hooks/scrcpy/audio/types.ts`

**Step 1: Define message protocol types**

```typescript
// Worker ↔ Main Thread
export interface ConfigureMessage {
  type: 'configure';
  codec: string;
  description?: ArrayBuffer;
}

export interface DataMessage {
  type: 'data';
  chunk: {
    type: 'key' | 'delta';
    data: ArrayBuffer;
    timestamp: number;
  };
}

export interface ResetMessage {
  type: 'reset';
}

export type WorkerInMessage = ConfigureMessage | DataMessage | ResetMessage;

export interface PcmMessage {
  type: 'pcm';
  buffer: ArrayBuffer;
  sampleRate: number;
  channels: number;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export interface ConfiguredMessage {
  type: 'configured';
}

export type WorkerOutMessage = PcmMessage | ErrorMessage | ConfiguredMessage;

// Main Thread ↔ AudioWorklet
export interface WorkletPcmMessage {
  type: 'pcm';
  buffer: ArrayBuffer;
  sampleRate: number;
  channels: number;
}

export interface WorkletMuteMessage {
  type: 'mute';
  value: boolean;
}

export interface WorkletResetMessage {
  type: 'reset';
}

export type WorkletMessage = WorkletPcmMessage | WorkletMuteMessage | WorkletResetMessage;
```

**Step 2: Commit**

```bash
git add src/hooks/scrcpy/audio/types.ts
git commit -m "feat(audio): define cross-context message protocol types"
```

---

### Task 3: AudioWorklet renderer

**Files:**
- Create: `src/hooks/scrcpy/audio/renderer-worklet.ts`

**Step 1: Implement PCM queue + OLA resampling + buffer management**

This is the most complex task. The worklet:

1. Receives PCM Float32Array via `port.onmessage`
2. Maintains internal buffer queue (0.1s~0.35s target)
3. Implements OLA (overlap-add) resampling for speed correction
4. `process()` writes to output channels

Reference: Tango ADB `@yume-chan/pcm-player` `worker/worker.ts`

```typescript
// 常量参数（继承自 scrcpy C 客户端经验值）
const INPUT_HOP_SIZE = 3000;
const SCALE = 0.9;
const OUTPUT_HOP_SIZE = (INPUT_HOP_SIZE * SCALE) | 0;
const WINDOW_SIZE = 6000;

// 预计算汉宁窗权重
const WINDOW_WEIGHT_TABLE = new Float32Array(WINDOW_SIZE);
for (let i = 0; i < WINDOW_SIZE / 2; i += 1) {
  const value = Math.sin((i / WINDOW_SIZE) * Math.PI);
  WINDOW_WEIGHT_TABLE[i] = value;
  WINDOW_WEIGHT_TABLE[WINDOW_SIZE - i - 1] = value;
}

const STARTING_THRESHOLD = 0.1;   // 启动门槛（秒）
const SPEED_UP_THRESHOLD = 0.25;  // 加速模式触发
const RECOVER_THRESHOLD = 0.15;   // 恢复正常模式
const MAX_BUFFER = 0.35;          // 最大缓冲上限

// ... (完整实现见设计文档)
```

Implement `SourceProcessor` extending `AudioWorkletProcessor`:
- `port.onmessage` handler: push PCM to queue, clamp to MAX_BUFFER
- `process()`: three modes — starting (wait for buffer), speedUp (OLA), normal (passthrough)
- `#read()`: read interleaved PCM from queue at given sample offset
- `#copyChunks()`: direct copy for normal mode
- OLA overlap-add for speed correction

Register processors:
- `registerProcessor('float32-source-processor', Float32SourceProcessor)`

**Step 2: Commit**

```bash
git add src/hooks/scrcpy/audio/renderer-worklet.ts
git commit -m "feat(audio): add AudioWorklet PCM renderer with OLA resampling"
```

---

### Task 4: Web Worker AudioDecoder

**Files:**
- Create: `src/hooks/scrcpy/audio/decoder-worker.ts`

**Step 1: Implement AudioDecoder wrapper in Worker context**

```typescript
/// <reference lib="webworker" />

import type { WorkerInMessage, WorkerOutMessage } from './types';

let decoder: AudioDecoder | null = null;
let retryCount = 0;
const MAX_RETRIES = 3;

function postOut(msg: WorkerOutMessage) {
  postMessage(msg);
}

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'configure':
      handleConfigure(msg.codec, msg.description);
      break;
    case 'data':
      handleData(msg.chunk);
      break;
    case 'reset':
      handleReset();
      break;
  }
};

function handleConfigure(codec: string, description?: ArrayBuffer) {
  decoder?.close();
  retryCount = 0;

  decoder = new AudioDecoder({
    output: (audioData: AudioData) => {
      // 提取 interleaved Float32 PCM
      const { numberOfChannels, numberOfFrames, sampleRate } = audioData;
      const pcm = new Float32Array(numberOfFrames * numberOfChannels);
      for (let ch = 0; ch < numberOfChannels; ch++) {
        const channel = new Float32Array(numberOfFrames);
        audioData.copyTo(channel, { planeIndex: ch });
        pcm.set(channel, ch * numberOfFrames);
      }
      audioData.close();

      // transfer 回主线程
      const buffer = pcm.buffer;
      postOut({ type: 'pcm', buffer, sampleRate, channels: numberOfChannels });
    },
    error: (e) => {
      postOut({ type: 'error', message: e.message });
      // 自动重试
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        // 主线程会收到 error 后重发 configure
      }
    },
  });

  const config: AudioDecoderConfig = {
    codec,
    sampleRate: 48000,
    numberOfChannels: 2,
  };
  if (description && description.byteLength > 0) {
    config.description = new Uint8Array(description);
  }
  decoder.configure(config);
  postOut({ type: 'configured' });
}

function handleData(chunk: { type: 'key' | 'delta'; data: ArrayBuffer; timestamp: number }) {
  if (!decoder || decoder.state === 'closed') return;
  decoder.decode(new EncodedAudioChunk({
    type: chunk.type,
    data: new Uint8Array(chunk.data),
    timestamp: chunk.timestamp,
  }));
}

function handleReset() {
  decoder?.reset();
  retryCount = 0;
}
```

**Step 2: Commit**

```bash
git add src/hooks/scrcpy/audio/decoder-worker.ts
git commit -m "feat(audio): add Web Worker AudioDecoder"
```

---

### Task 5: Refactor useAudioDecoder

**Files:**
- Modify: `src/hooks/scrcpy/useAudioDecoder.ts`

**Step 1: Rewrite to orchestrate Worker + Worklet + route/mute**

New interface:
```typescript
export function useAudioDecoder() {
  return {
    startAudio(client, onStateChange?): Promise<void>
    stopAudio(): void
    setRoute(route: 'browser' | 'phone'): void
    setMuted(muted: boolean): void
    resumeAudio(): void
    getState(): AudioState
  }
}
```

Implementation outline:

```typescript
export function useAudioDecoder() {
  const workerRef = useRef<Worker | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const routeRef = useRef<'browser' | 'phone'>('browser');
  const mutedRef = useRef(false);

  const startAudio = useCallback(async (client: AdbScrcpyClient, onStateChange?: (s: AudioState) => void) => {
    // 1. 创建 AudioContext（需要用户手势触发）
    const audioCtx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    audioCtxRef.current = audioCtx;

    // 2. 加载 AudioWorklet 模块
    await audioCtx.audioWorklet.addModule(
      new URL('./audio/renderer-worklet.ts', import.meta.url).href
    );

    // 3. 创建 WorkletNode
    const workletNode = new AudioWorkletNode(audioCtx, 'float32-source-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    workletNode.connect(audioCtx.destination);
    workletNodeRef.current = workletNode;

    // 4. 创建 Worker
    const worker = new Worker(
      new URL('./audio/decoder-worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    // 5. Worker → Main PCM 处理
    worker.onmessage = (e) => {
      const msg = e.data;
      switch (msg.type) {
        case 'pcm':
          if (routeRef.current === 'browser' && !mutedRef.current) {
            workletNode.port.postMessage(
              { type: 'pcm', buffer: msg.buffer, sampleRate: msg.sampleRate, channels: msg.channels },
              [msg.buffer]
            );
          }
          break;
        case 'error':
          console.warn('[audio] Worker error:', msg.message);
          // 自动重试逻辑：重新 configure
          if (msg.retryable) {
            // worker 会等待新的 configure 消息
          }
          break;
        case 'configured':
          break;
      }
    };

    // 6. 连接 scrcpy audio stream
    const audioMeta = await client.audioStream;
    if (!audioMeta || audioMeta.type !== 'success') {
      onStateChange?.({ status: audioMeta?.type === 'disabled' ? 'disabled' : 'errored', route: 'browser', muted: false });
      return;
    }

    onStateChange?.({ status: 'starting', route: 'browser', muted: false });

    const reader = audioMeta.stream.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type === 'configuration') {
          worker.postMessage(
            { type: 'configure', codec: audioMeta.codec.webCodecId, description: value.data },
            value.data.byteLength > 0 ? [value.data.buffer] : []
          );
        } else {
          worker.postMessage(
            { type: 'data', chunk: { type: value.keyframe ? 'key' : 'delta', data: value.data, timestamp: Number(value.pts ?? 0n) } },
            [value.data.buffer]
          );
        }
      }
    };
    pump().catch(e => console.warn('[audio] Pump error:', e));

    // WorkletNode error handler
    workletNode.onprocessorerror = () => {
      console.error('[audio] AudioWorklet error');
      onStateChange?.({ status: 'errored', ... });
    };

    onStateChange?.({ status: 'playing', route: 'browser', muted: false });
  }, []);

  // setRoute, setMuted, resumeAudio, stopAudio 实现...
}
```

**Step 2: Commit**

```bash
git add src/hooks/scrcpy/useAudioDecoder.ts
git commit -m "refactor(audio): rewrite useAudioDecoder with Worker+AudioWorklet"
```

---

### Task 6: Integrate into ScrcpyContext and useScrcpySession

**Files:**
- Modify: `src/hooks/scrcpy/useScrcpySession.ts`
- Modify: `src/contexts/ScrcpyContext.tsx`

**Step 1: Update useScrcpySession**

- Change `audioDecoder.setupAudioStream(client)` → `audioDecoder.startAudio(client, setAudioState)`
- Expose new state from audio decoder: `audioRoute`, `isMuted`, `audioStatus`
- Expose new controls: `setAudioRoute`, `setMuted`
- Keep `resumeAudio` as-is

**Step 2: Update ScrcpyContext**

Add to interface:
```typescript
audioRoute: 'browser' | 'phone'
setAudioRoute: (route: 'browser' | 'phone') => void
isMuted: boolean
setMuted: (muted: boolean) => void
audioStatus: 'idle' | 'starting' | 'playing' | 'disabled' | 'errored'
```

**Step 3: Commit**

```bash
git add src/hooks/scrcpy/useScrcpySession.ts src/contexts/ScrcpyContext.tsx
git commit -m "feat(audio): integrate audio state and controls into ScrcpyContext"
```

---

### Task 7: ControlSidebar audio UI

**Files:**
- Modify: `src/components/ControlSidebar.tsx`

**Step 1: Add speaker icon for mute toggle**

Add a button with `Volume2` / `VolumeX` lucide icon in the sidebar tool section.
On click: toggle muted state via `useScrcpyContext().setMuted(!isMuted)`.

When `audioStatus === 'disabled'` or `'errored'`, show icon in disabled state with tooltip.

**Step 2: Add audio route setting in sidebar settings panel**

In the settings/preferences panel, add:
```
音频输出
  ○ 手机
  ● 浏览器
```

Radio buttons bound to `setAudioRoute`.

**Step 3: Commit**

```bash
git add src/components/ControlSidebar.tsx
git commit -m "feat(audio): add mute toggle and audio route setting to sidebar"
```

---

### Task 8: Verify with build and lint

**Step 1: Run type check**

Run: `npm run check`
Expected: No TypeScript errors (worklet file excluded via tsconfig.json exclude)

**Step 2: Run lint**

Run: `npm run lint`
Expected: clean

**Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds, `dist/assets/` contains worklet chunk

**Step 4: Manual verification**

Start dev server: `npm run dev`
- Connect to Android device
- Verify audio plays from browser speakers
- Toggle mute → instant on/off
- Toggle route to phone → audio stops from browser
- Toggle route back to browser → audio resumes

**Step 5: Commit**

```bash
git commit -m "chore: finalize audio implementation"
```
