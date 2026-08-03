import { useRef, useCallback, useMemo } from 'react';
import type { AdbScrcpyClient } from '@yume-chan/adb-scrcpy';
import type { AdbScrcpyOptions4_0 } from '@/lib/scrcpy4';
import type { AudioState } from './audio/types';

/**
 * scrcpy 音频流（v3 升级后）：上游 createMediaStreamTransformer 已把音频字节流
 * 解析为 ScrcpyAudioStreamPacket（{type:'configuration', data} / {type:'data', keyframe?, pts?, data}），
 * 此处直接消费包对象，无需手动 12 字节解析。
 */
export function useAudioDecoder() {
  const workerRef = useRef<Worker | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const routeRef = useRef<'browser' | 'phone'>('browser');
  const mutedRef = useRef(false);
  const disposeRef = useRef(false);
  const readerRef = useRef<ReadableStreamDefaultReader<unknown> | null>(null);

  const setupAudioStream = useCallback(async (
    client: AdbScrcpyClient<AdbScrcpyOptions4_0>,
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

      // 5. Connect scrcpy audio stream（v3：流已是 ScrcpyAudioStreamPacket 包对象）
      const { codec, stream: audioStream } = audioMeta;
      const reader = audioStream.getReader();
      readerRef.current = reader;

      const pump = async () => {
        try {
          while (!disposeRef.current) {
            const { done, value } = await reader.read();
            if (done) break;

            // v3：上游已解析为包对象，直接消费，无需手动 12 字节解析
            const packet = value as { type: string; data: Uint8Array; pts?: bigint };
            if (packet.type === 'configuration') {
              const codecStr = codec.webCodecId || 'opus';
              const desc = packet.data.byteLength > 0 ? packet.data.slice(0) : undefined;
              worker.postMessage(
                {
                  type: 'configure',
                  codec: codecStr,
                  description: desc,
                  // S2-P0-3：以 AudioContext 实际采样率为输出目标（解码 worker 侧重采样）
                  targetSampleRate: audioCtxRef.current?.sampleRate ?? 48000,
                },
                desc ? [desc.buffer] : []
              );
            } else {
              const dataBuf = packet.data.slice(0).buffer;
              worker.postMessage(
                {
                  type: 'data',
                  chunk: {
                    type: 'key' as const,
                    data: dataBuf,
                    timestamp: Number(packet.pts ?? 0n),
                  },
                },
                [dataBuf]
              );
            }
          }
        } catch (e) {
          console.warn('[audio] 流读取错误:', e);
        }
      };

      pump();

      // AudioContext 初始为 suspended 状态，不在这里 resume（没有用户手势会触发浏览器警告）
      // 延迟到用户首次触摸时由 resume() 回调处理
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
    if (!ctx) return;
    // AudioContext 已在运行 → 无需操作（后续触摸事件不会再刷警告）
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {
        // 静默处理：浏览器自行打印的警告无法抑制，
        // 但 resume 只在首次触摸（有用户手势）时才会真正执行，
        // 后续触摸因 state 已变为 'running' 而不会进入此处。
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
