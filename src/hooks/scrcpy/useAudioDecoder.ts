import { useRef, useCallback, useMemo } from 'react';
import type { AdbScrcpyClient } from '@yume-chan/adb-scrcpy';
import type { AdbScrcpyOptions4_0 } from '@/lib/scrcpy4';
import type { AudioState } from './audio/types';

/**
 * scrcpy 音频流原始包格式：MediaStreamRawPacket
 * 8 bytes PTS (big-endian uint64) + 4 bytes data length (big-endian uint32) + N bytes data
 *
 * 注意：AdbScrcpyOptions4_0 把 createMediaStreamTransformer 覆盖为恒等透传，
 * 音频流没有被解析为包对象，仍然是原始字节流。此处需手动解析。
 */
const PTS_CONFIG = 1n << 63n;   // 标准 MediaStream 配置包标志
const PTS_CONFIG_4 = 1n << 62n; // scrcpy 4.0 视频格式（兼容音频也可能用）

export function useAudioDecoder() {
  const workerRef = useRef<Worker | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const routeRef = useRef<'browser' | 'phone'>('browser');
  const mutedRef = useRef(false);
  const disposeRef = useRef(false);
  const readerRef = useRef<ReadableStreamDefaultReader<any> | null>(null);
  const audioBufRef = useRef<Uint8Array>(new Uint8Array(0));

  const setupAudioStream = useCallback(async (
    client: AdbScrcpyClient<AdbScrcpyOptions4_0<true>>,
    onStateChange?: (state: AudioState) => void,
  ) => {
    const audioMeta = await client.audioStream;
    if (!audioMeta) {
      console.warn('[audio] 音频流不可用: undefined');
      onStateChange?.({ status: 'disabled', route: 'browser', muted: false });
      return;
    }

    if (audioMeta.type !== 'success') {
      console.warn('[audio] 音频流不可用:', audioMeta.type);
      onStateChange?.({ status: audioMeta.type === 'disabled' ? 'disabled' : 'errored', route: 'browser', muted: false });
      return;
    }

    try {
      onStateChange?.({ status: 'starting', route: 'browser', muted: false });

      // 1. Create AudioContext
      const audioCtx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      audioCtxRef.current = audioCtx;

      // 2. Load AudioWorklet
      await audioCtx.audioWorklet.addModule(
        new URL('./audio/renderer-worklet.js', import.meta.url).href
      );

      if (disposeRef.current) {
        audioCtx.close();
        return;
      }

      // 3. Create WorkletNode
      const workletNode = new AudioWorkletNode(audioCtx, 'float32-source-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      workletNode.connect(audioCtx.destination);
      workletNodeRef.current = workletNode;

      workletNode.onprocessorerror = (e) => {
        console.error('[audio] AudioWorklet 错误:', e);
      };

      // 4. Create Worker decoder
      const worker = new Worker(
        new URL('./audio/decoder-worker.ts', import.meta.url),
        { type: 'module' }
      );
      workerRef.current = worker;

      worker.onmessage = (e) => {
        if (disposeRef.current) return;
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
            console.warn('[audio] 解码错误:', msg.message);
            break;
          case 'configured':
            console.log('[audio] 解码器配置完成');
            break;
        }
      };

      // 5. Connect scrcpy audio stream
      // 注意：音频流是原始字节（Uint8Array），需要手动解析为包对象
      const { codec, stream: audioStream } = audioMeta;
      const reader = audioStream.getReader();
      readerRef.current = reader;
      audioBufRef.current = new Uint8Array(0);

      const pump = async () => {
        try {
          while (!disposeRef.current) {
            const { done, value } = await reader.read();
            if (done) break;

            // value 是 Uint8Array 原始字节，非包对象
            // 注意：类型标注为 ScrcpyMediaStreamPacket，但运行时是 Uint8Array
            const chunk = value as unknown as Uint8Array;
            const merged = new Uint8Array(audioBufRef.current.byteLength + chunk.byteLength);
            merged.set(audioBufRef.current, 0);
            merged.set(chunk, audioBufRef.current.byteLength);
            audioBufRef.current = merged;

            // 尽可能多地解析出完整包
            while (audioBufRef.current.byteLength >= 12) {
              const dv = new DataView(audioBufRef.current.buffer, audioBufRef.current.byteOffset, audioBufRef.current.byteLength);
              const pts = dv.getBigUint64(0, false);  // big-endian
              const size = dv.getUint32(8, false);    // big-endian
              const totalLen = 12 + size;
              if (audioBufRef.current.byteLength < totalLen) break;

              const data = audioBufRef.current.slice(12, totalLen);
              const isConfig = (pts & PTS_CONFIG) !== 0n || (pts & PTS_CONFIG_4) !== 0n;

              if (isConfig) {
                const codecStr = codec.webCodecId || 'opus';
                const desc = data.byteLength > 0 ? data.slice(0) : undefined;
                worker.postMessage(
                  { type: 'configure', codec: codecStr, description: desc },
                  desc ? [desc.buffer] : []
                );
              } else {
                const dataBuf = data.slice(0).buffer;
                const realPts = pts & ((1n << 61n) - 1n); // 用 61-bit PTS 掩码
                worker.postMessage(
                  {
                    type: 'data',
                    chunk: {
                      type: 'key' as const,
                      data: dataBuf,
                      timestamp: Number(realPts),
                    },
                  },
                  [dataBuf]
                );
              }

              audioBufRef.current = audioBufRef.current.slice(totalLen);
            }
          }
        } catch (e) {
          console.warn('[audio] 流读取错误:', e);
        }
      };

      pump();

      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      onStateChange?.({ status: 'playing', route: 'browser', muted: false });
} catch (e) {
        console.error('[audio] 启动失败:', e);
        // 确保 AudioContext 在出错时被关闭，避免泄漏
        if (audioCtxRef.current) {
          audioCtxRef.current.close().catch(() => {});
          audioCtxRef.current = null;
        }
        onStateChange?.({ status: 'errored', route: 'browser', muted: false });
      }
  }, []);

  const setRoute = useCallback((route: 'browser' | 'phone') => {
    routeRef.current = route;
    console.log('[audio] 路由切换:', route);
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    console.log('[audio] 静音切换:', muted);
  }, []);

  const resume = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch((e: unknown) => {
        console.warn('[audio] AudioContext resume 失败:', e);
      });
    }
  }, []);

  const dispose = useCallback(() => {
    disposeRef.current = true;

    if (readerRef.current) {
      readerRef.current.cancel().catch(() => {});
      readerRef.current = null;
    }
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
  }, []);

  return useMemo(() => ({
    setupAudioStream,
    setRoute,
    setMuted,
    resume,
    dispose,
  }), [setupAudioStream, setRoute, setMuted, resume, dispose]);
}
