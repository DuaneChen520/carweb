import { useCallback, useRef, useState } from 'react';
import type { AdbScrcpyClient, AdbScrcpyOptionsLatest } from '@yume-chan/adb-scrcpy';
import { AdbScrcpyExitedError } from '@yume-chan/adb-scrcpy';
import type { WebCodecsVideoDecoder } from '@yume-chan/scrcpy-decoder-webcodecs';
import type { ScrcpyControlMessageWriter } from '@yume-chan/scrcpy';
import type { Adb } from '@yume-chan/adb';

export interface ScrcpyState {
  isStarting: boolean;
  isRunning: boolean;
  error: string | null;
  videoWidth: number;
  videoHeight: number;
}

export function useScrcpy() {
  const [state, setState] = useState<ScrcpyState>({
    isStarting: false,
    isRunning: false,
    error: null,
    videoWidth: 0,
    videoHeight: 0,
  });

  const clientRef = useRef<AdbScrcpyClient<AdbScrcpyOptionsLatest<true>> | null>(null);
  const decoderRef = useRef<WebCodecsVideoDecoder | null>(null);
  const controllerRef = useRef<ScrcpyControlMessageWriter | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const startScrcpy = useCallback(async (adb: Adb, canvas: HTMLCanvasElement) => {
    try {
      setState(prev => ({ ...prev, isStarting: true, error: null }));

      // 动态导入 Scrcpy 相关库
      const { AdbScrcpyClient, AdbScrcpyOptionsLatest } = await import('@yume-chan/adb-scrcpy');
      const { WebCodecsVideoDecoder } = await import('@yume-chan/scrcpy-decoder-webcodecs');
      const { WebGLVideoFrameRenderer } = await import('@yume-chan/scrcpy-decoder-webcodecs/esm/video/render/webgl.js');
      const { DefaultServerPath } = await import('@yume-chan/scrcpy');
      const { ReadableStream } = await import('@yume-chan/stream-extra');

      // 先检查并推送 scrcpy-server.jar 到设备
      const serverPath = '/data/local/tmp/scrcpy-server.jar';
      try {
        // 尝试从 public 目录获取服务器文件
        console.log('正在获取 scrcpy-server.jar...');
        const response = await fetch('/scrcpy-server.jar');
        console.log('fetch 结果:', response.ok, 'size:', response.headers.get('content-length'));
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          console.log('获取到文件大小:', arrayBuffer.byteLength);
          if (arrayBuffer.byteLength > 0) {
            console.log('正在推送 scrcpy-server.jar 到设备...');
            await AdbScrcpyClient.pushServer(
              adb,
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new Uint8Array(arrayBuffer));
                  controller.close();
                },
              }),
              serverPath,
            );
            console.log('推送完成');
          } else {
            console.warn('scrcpy-server.jar 文件为空');
          }
        } else {
          console.warn('无法获取 scrcpy-server.jar:', response.status);
        }
      } catch (pushError) {
        console.warn('推送 scrcpy-server.jar 失败，尝试使用设备上已有的文件:', pushError);
      }

      // 配置 Scrcpy 选项
      const options = new AdbScrcpyOptionsLatest({
        video: true,
        videoCodec: 'h264',
        videoBitRate: 8000000,
        maxFps: 60,
        audio: false,
        control: true,
        stayAwake: true,
        showTouches: true,
        displayId: 0,
      });

      // 启动 Scrcpy 客户端
      const client = await AdbScrcpyClient.start(
        adb,
        serverPath,
        options,
      );

      clientRef.current = client;

      // 获取控制器
      const controller = client.controller;
      if (controller) {
        controllerRef.current = controller;
      }

      // 获取视频流
      const videoStream = await client.videoStream;
      if (!videoStream) {
        throw new Error('无法获取视频流');
      }

      // 创建 WebGL 渲染器
      const renderer = new WebGLVideoFrameRenderer(canvas);

      // 创建视频解码器
      const decoder = new WebCodecsVideoDecoder({
        codec: videoStream.metadata.codec,
        renderer,
      });

      decoderRef.current = decoder;

      // 监听尺寸变化
      const sizeUnsubscribe = videoStream.sizeChanged((size: { width: number; height: number }) => {
        setState(prev => ({
          ...prev,
          videoWidth: size.width,
          videoHeight: size.height,
        }));
      });

      // 连接视频流到解码器
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

      setState(prev => ({
        ...prev,
        isStarting: false,
        isRunning: true,
        videoWidth: videoStream.width,
        videoHeight: videoStream.height,
      }));

      // 清理函数
      cleanupRef.current = () => {
        sizeUnsubscribe();
        reader.releaseLock();
      };

    } catch (error) {
      let message = '启动屏幕镜像失败';
      if (error instanceof AdbScrcpyExitedError) {
        message = 'scrcpy server exited prematurely';
        if (error.output.length > 0) {
          message += ': ' + error.output.join('; ');
        }
      } else if (error instanceof Error) {
        message = error.message;
      }
      setState(prev => ({
        ...prev,
        isStarting: false,
        error: message,
      }));
      console.error('Scrcpy 启动错误:', error);
    }
  }, []);

  const injectTouch = useCallback(async (message: {
    action: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
    pointerId: bigint;
    pointerX: number;
    pointerY: number;
    videoWidth: number;
    videoHeight: number;
    pressure: number;
    actionButton: number;
    buttons: number;
  }) => {
    const controller = controllerRef.current;
    if (!controller) return;

    try {
      await controller.injectTouch(message);
    } catch (error) {
      console.error('触摸事件转发错误:', error);
    }
  }, []);

  const stopScrcpy = useCallback(async () => {
    try {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      if (decoderRef.current) {
        decoderRef.current.dispose();
        decoderRef.current = null;
      }

      if (controllerRef.current) {
        controllerRef.current.close();
        controllerRef.current = null;
      }

      if (clientRef.current) {
        await clientRef.current.close();
        clientRef.current = null;
      }

      setState({
        isStarting: false,
        isRunning: false,
        error: null,
        videoWidth: 0,
        videoHeight: 0,
      });
    } catch (error) {
      console.error('停止 Scrcpy 错误:', error);
    }
  }, []);

  return {
    ...state,
    startScrcpy,
    stopScrcpy,
    injectTouch,
  };
}
