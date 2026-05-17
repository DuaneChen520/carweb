import { useCallback, useRef, useState } from 'react';
import type { AdbScrcpyClient, AdbScrcpyOptionsLatest } from '@yume-chan/adb-scrcpy';
import { AdbScrcpyExitedError } from '@yume-chan/adb-scrcpy';
import type { WebCodecsVideoDecoder } from '@yume-chan/scrcpy-decoder-webcodecs';
import type { ScrcpyControlMessageWriter } from '@yume-chan/scrcpy';
import { ScrcpyNewDisplay, AndroidKeyCode, AndroidKeyEventAction } from '@yume-chan/scrcpy';
import type { Adb } from '@yume-chan/adb';

export interface DisplayConfig {
  width: number;
  height: number;
  dpi?: number;
}

export interface ScrcpyState {
  isStarting: boolean;
  isRunning: boolean;
  error: string | null;
  videoWidth: number;
  videoHeight: number;
  isVirtualDisplay: boolean;
}

export function useScrcpy() {
  const [state, setState] = useState<ScrcpyState>({
    isStarting: false,
    isRunning: false,
    error: null,
    videoWidth: 0,
    videoHeight: 0,
    isVirtualDisplay: false,
  });

  const clientRef = useRef<AdbScrcpyClient<AdbScrcpyOptionsLatest<true>> | null>(null);
  const decoderRef = useRef<WebCodecsVideoDecoder | null>(null);
  const controllerRef = useRef<ScrcpyControlMessageWriter | null>(null);
  const cleanupRef = useRef<(() => Promise<void>) | null>(null);
  const adbRef = useRef<Adb | null>(null);

  const startScrcpy = useCallback(async (adb: Adb, canvas: HTMLCanvasElement, displayConfig?: DisplayConfig, isRetry?: boolean) => {
    try {
      setState(prev => ({ ...prev, isStarting: true, error: null, videoWidth: 0, videoHeight: 0 }));

      // 动态导入 Scrcpy 相关库
      const { AdbScrcpyClient, AdbScrcpyOptionsLatest } = await import('@yume-chan/adb-scrcpy');
      const { WebCodecsVideoDecoder } = await import('@yume-chan/scrcpy-decoder-webcodecs');
      const { WebGLVideoFrameRenderer } = await import('@yume-chan/scrcpy-decoder-webcodecs/esm/video/render/webgl.js');
      const { DefaultServerPath } = await import('@yume-chan/scrcpy');
      const { ReadableStream } = await import('@yume-chan/stream-extra');

      // 先检查并推送 scrcpy-server.jar 到设备
      const serverPath = '/data/local/tmp/scrcpy-server.jar';
      try {
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
      const useVirtualDisplay = !!displayConfig;
      const options = new AdbScrcpyOptionsLatest({
        video: true,
        videoCodec: 'h264',
        videoBitRate: 8000000,
        maxFps: 60,
        audio: false,
        control: true,
        stayAwake: true,
        showTouches: true,
        ...(useVirtualDisplay
          ? { newDisplay: new ScrcpyNewDisplay(displayConfig.width, displayConfig.height, displayConfig.dpi ?? 320) }
          : { displayId: 0 }
        ),
      });

      // 启动 Scrcpy 客户端
      const client = await AdbScrcpyClient.start(
        adb,
        serverPath,
        options,
      );

      clientRef.current = client;
      adbRef.current = adb;

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
        isVirtualDisplay: useVirtualDisplay,
      }));

      // 清理函数
      cleanupRef.current = async () => {
        sizeUnsubscribe();
        await reader.cancel();
      };

    } catch (error) {
      // 虚拟屏创建失败时自动回退到镜像模式
      if (!isRetry && displayConfig && error instanceof AdbScrcpyExitedError) {
        console.warn('虚拟屏创建失败，自动切换到镜像模式:', error);
        setState(prev => ({ ...prev, isStarting: true, error: '虚拟屏创建失败，自动切换到镜像模式...' }));
        return startScrcpy(adb, canvas, undefined, true);
      }

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

  const startApp = useCallback(async (appName: string) => {
    const controller = controllerRef.current;
    if (!controller) return;

    try {
      await controller.startApp(appName);
    } catch (error) {
      console.error('启动应用错误:', error);
    }
  }, []);

  const pressKey = useCallback(async (keyCode: AndroidKeyCode) => {
    const controller = controllerRef.current;
    if (!controller) return;

    try {
      await controller.injectKeyCode({
        action: AndroidKeyEventAction.Down,
        keyCode,
        repeat: 0,
        metaState: 0,
      });
      await controller.injectKeyCode({
        action: AndroidKeyEventAction.Up,
        keyCode,
        repeat: 0,
        metaState: 0,
      });
    } catch (error) {
      console.error('按键注入错误:', error);
    }
  }, []);

  const goHome = useCallback(async () => {
    await pressKey(AndroidKeyCode.AndroidHome);
  }, [pressKey]);

  const goBack = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller) return;
    try {
      await controller.backOrScreenOn(0);
    } catch (error) {
      console.error('返回错误:', error);
    }
  }, []);

  const showRecentApps = useCallback(async () => {
    await pressKey(AndroidKeyCode.AndroidAppSwitch);
  }, [pressKey]);

  const getAppList = useCallback(async (): Promise<string[]> => {
    const adb = adbRef.current;
    if (!adb) return [];

    try {
      const process = await adb.subprocess.spawn('pm', ['list', 'packages']);
      const reader = process.stdout.getReader();
      const decoder = new TextDecoder();
      const packages: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split('\n')) {
          if (line.startsWith('package:')) {
            packages.push(line.slice(8).trim());
          }
        }
      }

      return packages.sort((a, b) => a.localeCompare(b));
    } catch (error) {
      console.error('获取应用列表错误:', error);
      return [];
    }
  }, []);

  const stopScrcpy = useCallback(async () => {
    try {
      if (cleanupRef.current) {
        await cleanupRef.current();
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
        isVirtualDisplay: false,
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
    startApp,
    pressKey,
    goHome,
    goBack,
    showRecentApps,
    getAppList,
  };
}
