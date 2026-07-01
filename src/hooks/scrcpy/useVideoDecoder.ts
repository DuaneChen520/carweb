import { useRef, useCallback, useMemo } from 'react';
import type { AdbScrcpyClient } from '@yume-chan/adb-scrcpy';
import type { AdbScrcpyOptions4_0, Scrcpy4MediaPacket } from '@/lib/scrcpy4';
import type { WebCodecsVideoDecoder } from '@yume-chan/scrcpy-decoder-webcodecs';

export interface VideoDecoderState {
  videoWidth: number;
  videoHeight: number;
}

export function useVideoDecoder() {
  const decoderRef = useRef<WebCodecsVideoDecoder | null>(null);
  const cleanupRef = useRef<(() => Promise<void>) | null>(null);

  const setupVideoStream = useCallback(async (
    client: AdbScrcpyClient<AdbScrcpyOptions4_0<true>>,
    canvas: HTMLCanvasElement,
    onSizeChanged: (width: number, height: number) => void,
    onSessionPacket?: (width: number, height: number, clientResized: boolean) => void,
  ) => {
    const { WebCodecsVideoDecoder } = await import('@yume-chan/scrcpy-decoder-webcodecs');
    const { WebGLVideoFrameRenderer } = await import('@yume-chan/scrcpy-decoder-webcodecs/esm/video/render/webgl.js');

    const videoStream = await client.videoStream;
    if (!videoStream) {
      throw new Error('无法获取视频流');
    }

    const renderer = new WebGLVideoFrameRenderer(canvas);
    const decoder = new WebCodecsVideoDecoder({
      codec: videoStream.metadata.codec,
      renderer,
    });

    decoderRef.current = decoder;

    const sizeUnsubscribe = videoStream.sizeChanged((size) => {
      onSizeChanged(size.width, size.height);
    });

    const stream = videoStream.stream;
    const reader = stream.getReader();

    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // 4.0 session 包：不写解码器，通知 flex-client
          const packet = value as Scrcpy4MediaPacket;
          if (packet.type === 'session') {
            onSessionPacket?.(packet.width, packet.height, packet.clientResized);
            continue;
          }

          // configuration / data 包原样写解码器
          const writer = decoder.writable.getWriter();
          try {
            await writer.write(value);
          } finally {
            writer.releaseLock();
          }
        }
      } catch (error) {
        console.error('视频流读取错误:', error);
      }
    };

    pump();

    cleanupRef.current = async () => {
      sizeUnsubscribe();
      await reader.cancel();
    };

    return {
      width: videoStream.width,
      height: videoStream.height,
    };
  }, []);

  const dispose = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (decoderRef.current) {
      decoderRef.current.dispose();
      decoderRef.current = null;
    }
  }, []);

  return useMemo(() => ({
    setupVideoStream,
    dispose,
  }), [setupVideoStream, dispose]);
}
