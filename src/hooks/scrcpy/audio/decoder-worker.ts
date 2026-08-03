/// <reference lib="webworker" />

import type { WorkerInMessage, WorkerOutMessage } from './types';

let decoder: AudioDecoder | null = null;
let retryCount = 0;
const MAX_RETRIES = 3;
let lastCodec = '';
let lastDescription: Uint8Array | undefined;
/** 输出目标采样率（AudioContext.sampleRate），解码 PCM 将重采样到该值（S2-P0-3）。 */
let targetSampleRate = 48000;
let pendingData: Array<{ type: 'key' | 'delta'; data: ArrayBuffer; timestamp: number }> = [];

// ── 解码背压（S2-P0-3）────────────────────────────────────────────
// 防止主线程无节制喂包导致 decodeQueue 无限膨胀（内存增长 + GC 抖动）。
// handleData 先入统一待解码队列，仅当 decoder.decodeQueueSize 低于水位才喂给解码器；
// 解码器 output 回调推进队列后继续排水。
const MAX_DECODE_QUEUE = 64;
let decodeBacklog: Array<{ type: 'key' | 'delta'; data: ArrayBuffer; timestamp: number }> = [];
let draining = false;

function tryDrain(): void {
  if (draining) return;
  if (!decoder || decoder.state === 'closed') return; // 配置前数据留在队列
  draining = true;
  try {
    while (decodeBacklog.length > 0 && decoder.decodeQueueSize < MAX_DECODE_QUEUE) {
      const chunk = decodeBacklog.shift()!;
      decoder.decode(
        new EncodedAudioChunk({
          type: 'key',
          data: new Uint8Array(chunk.data),
          timestamp: chunk.timestamp,
        })
      );
    }
  } finally {
    draining = false;
  }
}

function postOut(msg: WorkerOutMessage, transfer?: Transferable[]) {
  if (transfer) {
    postMessage(msg, transfer);
  } else {
    postMessage(msg);
  }
}

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'configure':
      handleConfigure(msg.codec, msg.description, msg.targetSampleRate);
      break;
    case 'data':
      handleData(msg.chunk);
      break;
    case 'reset':
      handleReset();
      break;
  }
};

let pcmOutputCount = 0;

/**
 * 交织 Float32 PCM 线性重采样（S2-P0-3）。
 * 解码器输出采样率（AudioData.sampleRate）与 AudioContext 不一致时调用，
 * 统一重采样到 targetSampleRate，消除「无重采样 → 播放速度/音调偏移」问题。
 */
function resampleInterleaved(
  input: Float32Array,
  channels: number,
  inRate: number,
  outRate: number,
): Float32Array {
  if (inRate === outRate || input.length === 0) return input;
  const inFrames = input.length / channels;
  const outFrames = Math.max(1, Math.ceil((inFrames * outRate) / inRate));
  const out = new Float32Array(outFrames * channels);
  const ratio = inRate / outRate; // 输入帧 / 输出帧
  for (let i = 0; i < outFrames; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, inFrames - 1);
    const frac = pos - i0;
    for (let ch = 0; ch < channels; ch++) {
      const a = input[i0 * channels + ch]!;
      const b = input[i1 * channels + ch]!;
      out[i * channels + ch] = a + (b - a) * frac;
    }
  }
  return out;
}

function pcmOutputHandler(audioData: AudioData) {
  try {
    const { numberOfChannels, numberOfFrames, sampleRate, format } = audioData;
    let pcm = new Float32Array(numberOfFrames * numberOfChannels);

    if (format === 'f32-planar') {
      for (let ch = 0; ch < numberOfChannels; ch++) {
        const channel = new Float32Array(numberOfFrames);
        audioData.copyTo(channel, { planeIndex: ch });
        pcm.set(channel, ch * numberOfFrames);
      }
    } else {
      audioData.copyTo(pcm, { planeIndex: 0 });
    }

    audioData.close();

    // S2-P0-3：采样率不一致 → 重采样到目标输出采样率（默认 48000）
    if (sampleRate !== targetSampleRate) {
      pcm = resampleInterleaved(pcm, numberOfChannels, sampleRate, targetSampleRate);
    }

    // [DEBUG-a3f2] 诊断：确认解码器是否产出 PCM + 是否为静音
    pcmOutputCount++;
    if (pcmOutputCount <= 5) {
      let nonZero = 0;
      for (let i = 0; i < pcm.length; i++) { if (pcm[i] !== 0) nonZero++; }
      console.log(`[DEBUG-a3f2] PCM #${pcmOutputCount}: ${numberOfFrames} frames, ${numberOfChannels}ch, ${sampleRate}Hz, format=${format}, samples=${pcm.length}, nonZero=${nonZero}`);
    }

    postOut(
      {
        type: 'pcm',
        buffer: pcm.buffer as ArrayBuffer,
        sampleRate: targetSampleRate,
        channels: numberOfChannels,
      },
      [pcm.buffer]
    );

    // 解码器产出推进 → 继续排水（背压）
    tryDrain();
  } catch (e) {
    console.warn('[audio worker] PCM conversion error:', e);
  }
}

function errorHandler(e: DOMException | unknown) {
  const message = e instanceof Error ? e.message : String(e);
  console.warn('[audio worker] Decoder error:', message);

  if (retryCount < MAX_RETRIES) {
    retryCount++;
    console.warn(`[audio worker] 重试 ${retryCount}/${MAX_RETRIES}`);
    try { decoder?.close(); } catch { /* ignore */ }
    decoder = null;
    rebuildDecoder();
  } else {
    postOut({ type: 'error', message });
  }
}

function rebuildDecoder() {
  try {
    decoder = new AudioDecoder({
      output: pcmOutputHandler,
      error: errorHandler,
    });

    const config: AudioDecoderConfig = {
      codec: lastCodec,
      sampleRate: 48000,
      numberOfChannels: 2,
    };

    if (lastDescription && lastDescription.byteLength > 0) {
      config.description = new Uint8Array(lastDescription);
    }

    decoder.configure(config);
    postOut({ type: 'configured' });

    const pending = pendingData;
    pendingData = [];
    // 配置期缓存的数据回到背压队列，由水位驱动解码
    decodeBacklog.push(...pending);
    tryDrain();
  } catch (e) {
    postOut({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

function handleConfigure(codec: string, description?: Uint8Array, outRate?: number) {
  if (decoder) {
    try { decoder.close(); } catch { /* decoder may already be closed */ }
  }
  retryCount = 0;
  lastCodec = codec;
  lastDescription = description;
  if (outRate && outRate > 0) {
    targetSampleRate = outRate;
  }

  try {
    decoder = new AudioDecoder({
      output: pcmOutputHandler,
      error: errorHandler,
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

    const pending = pendingData;
    pendingData = [];
    decodeBacklog.push(...pending);
    tryDrain();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    postOut({ type: 'error', message });
  }
}

function handleData(chunk: { type: 'key' | 'delta'; data: ArrayBuffer; timestamp: number }) {
  if (!decoder || decoder.state === 'closed') {
    pendingData.push(chunk);
    return;
  }

  if (chunk.data.byteLength === 0) {
    return;
  }

  // S2-P0-3：背压入队，decodeQueueSize 水位允许才实际解码
  decodeBacklog.push(chunk);
  tryDrain();
}

function handleReset() {
  if (decoder) {
    try { decoder.reset(); } catch { /* decoder may be closed */ }
  }
  retryCount = 0;
  pendingData = [];
  decodeBacklog = [];
}
