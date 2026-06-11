import { useRef, useCallback, useMemo } from 'react';
import type { AdbScrcpyClient, AdbScrcpyOptionsLatest } from '@yume-chan/adb-scrcpy';
import type { WebCodecsVideoDecoder } from '@yume-chan/scrcpy-decoder-webcodecs';

export interface VideoDecoderState {
  videoWidth: number;
  videoHeight: number;
}

export function useVideoDecoder() {
  const decoderRef = useRef<WebCodecsVideoDecoder | null>(null);
  const cleanupRef = useRef<(() => Promise<void>) | null>(null);

  const setupVideoStream = useCallback(async (
    client: AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>,
    canvas: HTMLCanvasElement,
    onSizeChanged: (width: number, height: number) => void,
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
