import { useRef, useCallback, useMemo } from 'react';
import type { AdbScrcpyClient, AdbScrcpyOptionsLatest } from '@yume-chan/adb-scrcpy';
import type { AudioState } from './audio/types';

export function useAudioDecoder() {
  const workerRef = useRef<Worker | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const routeRef = useRef<'browser' | 'phone'>('browser');
  const mutedRef = useRef(false);
  const disposeRef = useRef(false);

  const setupAudioStream = useCallback(async (
    client: AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>,
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
        new URL('./audio/renderer-worklet.ts', import.meta.url).href
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
      const { codec, stream: audioStream } = audioMeta;
      const reader = audioStream.getReader();

      const pump = async () => {
        try {
          while (!disposeRef.current) {
            const { done, value } = await reader.read();
            if (done) break;

            if (value.type === 'configuration') {
              const codecStr = codec.webCodecId || 'opus';
              const desc = value.data.byteLength > 0 ? value.data.slice(0) : undefined;
              worker.postMessage(
                { type: 'configure', codec: codecStr, description: desc },
                desc ? [desc.buffer] : []
              );
            } else {
              worker.postMessage(
                {
                  type: 'data',
                  chunk: {
                    type: value.keyframe ? 'key' : 'delta' as const,
                    data: value.data.slice(0).buffer,
                    timestamp: value.pts != null ? Number(value.pts) : 0,
                  },
                },
                [value.data.slice(0).buffer]
              );
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
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: 'mute', value: muted });
    }
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
