import { useCallback, useRef, useState } from 'react';
import type { AdbScrcpyClient, AdbScrcpyOptionsLatest } from '@yume-chan/adb-scrcpy';
import { AdbScrcpyExitedError } from '@yume-chan/adb-scrcpy';
import type { WebCodecsVideoDecoder } from '@yume-chan/scrcpy-decoder-webcodecs';
import type { ScrcpyControlMessageWriter } from '@yume-chan/scrcpy';
import { ScrcpyNewDisplay, ScrcpyCaptureOrientation, ScrcpyLockOrientation, ScrcpyOrientation, AndroidKeyCode, AndroidKeyEventAction } from '@yume-chan/scrcpy';
import type { Adb } from '@yume-chan/adb';

export interface DisplayConfig {
  width: number;
  height: number;
  dpi?: number;
  bitRate?: number;
}

export type ResolutionPresetKey = 'original' | 'ultra' | 'hd' | 'smooth';

export interface ResolutionPreset {
  key: ResolutionPresetKey;
  label: string;
  scale: number;
  dpiMultiplier: number;
}

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { key: 'original', label: '原画', scale: 1.0, dpiMultiplier: 1.0 },
  { key: 'ultra',   label: '超清', scale: 0.75, dpiMultiplier: 1.33 },
  { key: 'hd',      label: '高清', scale: 0.5,  dpiMultiplier: 2.0 },
  { key: 'smooth',  label: '流畅', scale: 0.25, dpiMultiplier: 4.0 },
];

export interface AppInfo {
  package: string;
  name: string;
}

export interface ScrcpyState {
  isStarting: boolean;
  isRunning: boolean;
  error: string | null;
  videoWidth: number;
  videoHeight: number;
  isVirtualDisplay: boolean;
}

function formatAppName(pkg: string): string {
  const segments = pkg.split('.');
  const last = segments[segments.length - 1];
  return last
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
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
        videoBitRate: displayConfig?.bitRate ?? 8000000,
        maxFps: 60,
        audio: false,
        control: true,
        stayAwake: true,
        showTouches: true,
        ...(useVirtualDisplay
          ? {
              newDisplay: new ScrcpyNewDisplay(displayConfig.width, displayConfig.height, displayConfig.dpi ?? 320),
              captureOrientation: new ScrcpyCaptureOrientation(ScrcpyLockOrientation.LockedInitial, ScrcpyOrientation.Orient0),
            }
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

  const injectText = useCallback(async (text: string) => {
    const controller = controllerRef.current;
    if (!controller) return;

    try {
      await controller.injectText(text);
    } catch (error) {
      console.error('文本输入错误:', error);
    }
  }, []);

  const showKeyboard = useCallback(async () => {
    const adb = adbRef.current;
    const controller = controllerRef.current;
    if (!adb) return;

    try {
      const cmd = 'ime list -s | head -1';
      let ime: string;

      if (adb.subprocess.shellProtocol) {
        const result = await adb.subprocess.shellProtocol.spawnWaitText(cmd);
        ime = result.stdout.trim().split('\n')[0];
      } else {
        ime = await adb.subprocess.noneProtocol.spawnWaitText(['sh', '-c', `${cmd} 2>&1`]);
        ime = ime.trim().split('\n')[0];
      }

      if (ime) {
        await adb.subprocess.noneProtocol.spawnWaitText(['sh', '-c', `settings put secure default_input_method "${ime}" &&ime enable ${ime} && ime set ${ime} 2>&1`]);
      }

      if (controller) {
        await controller.injectKeyCode({
          action: AndroidKeyEventAction.Down,
          keyCode: AndroidKeyCode.AndroidHome,
          repeat: 0,
          metaState: 0,
        });
        await controller.injectKeyCode({
          action: AndroidKeyEventAction.Up,
          keyCode: AndroidKeyCode.AndroidHome,
          repeat: 0,
          metaState: 0,
        });
      }
    } catch (error) {
      console.error('显示键盘错误:', error);
    }
  }, []);

  const hideKeyboard = useCallback(async () => {
    const adb = adbRef.current;
    if (!adb) return;

    try {
      await adb.subprocess.noneProtocol.spawnWaitText(['sh', '-c', 'ime hide com.android.inputmethod.latin/.LatinIME 2>&1 || input keyevent 111 2>&1']);
    } catch (error) {
      console.error('隐藏键盘错误:', error);
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

  const getAppList = useCallback(async (showSystem = false): Promise<string[]> => {
    const adb = adbRef.current;
    if (!adb) return [];

    try {
      const cmd = showSystem ? 'pm list packages' : 'pm list packages -3';
      let output: string;

      if (adb.subprocess.shellProtocol) {
        const result = await adb.subprocess.shellProtocol.spawnWaitText(cmd);
        console.log('[getAppList] cmd:', cmd, 'exitCode:', result.exitCode, 'stderr:', result.stderr);
        output = result.stdout;
      } else {
        output = await adb.subprocess.noneProtocol.spawnWaitText(['sh', '-c', `${cmd} 2>&1`]);
      }

      console.log('[getAppList] raw output length:', output.length);

      const packages: string[] = [];
      for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('package:')) {
          packages.push(trimmed.slice(8));
        }
      }

      console.log('[getAppList] found packages:', packages.length);
      return packages.sort((a, b) => a.localeCompare(b));
    } catch (error) {
      console.error('获取应用列表错误:', error);
      return [];
    }
  }, []);

  const iconCacheRef = useRef<Map<string, string | null>>(new Map());
  const labelCacheRef = useRef<Map<string, string | null>>(new Map());

  const getAppLabel = useCallback(async (pkg: string): Promise<string> => {
    const cached = labelCacheRef.current.get(pkg);
    if (cached !== undefined) return cached ?? formatAppName(pkg);

    const adb = adbRef.current;
    if (!adb) return formatAppName(pkg);

    try {
      const cmd = [
        'sh', '-c',
        `LABEL=$(dumpsys package ${pkg} 2>/dev/null | grep -m1 "android:label=" | sed "s/.*android:label=//" | tr -d "'" | xargs); ` +
        `if [ -z "$LABEL" ]; then ` +
          `LABEL=$(cmd package resolve-activity --brief ${pkg} 2>/dev/null | grep "label=" | head -1 | sed "s/.*label=//" | xargs); ` +
        `fi; ` +
        `if [ -z "$LABEL" ]; then ` +
          `APK=$(pm path ${pkg} 2>/dev/null | head -1 | sed 's/^package://'); ` +
          `if [ -n "$APK" ] && [ -f "$APK" ] && command -v aapt >/dev/null 2>&1; then ` +
            `LABEL=$(aapt dump badging "$APK" 2>/dev/null | grep "application-label:" | head -1 | sed "s/application-label:'\\(.*\\)'/\\1/"); ` +
          `fi; ` +
        `fi; ` +
        `echo "$LABEL"`
      ];

      const output = await adb.subprocess.noneProtocol.spawnWaitText(cmd);
      const label = output.trim();
      if (label && label !== 'null' && label !== '' && !label.includes('not found')) {
        labelCacheRef.current.set(pkg, label);
        return label;
      }
      labelCacheRef.current.set(pkg, null);
      return formatAppName(pkg);
    } catch {
      labelCacheRef.current.set(pkg, null);
      return formatAppName(pkg);
    }
  }, []);

  const getAppIcon = useCallback(async (pkg: string): Promise<string | null> => {
    const cached = iconCacheRef.current.get(pkg);
    if (cached !== undefined) return cached;

    const adb = adbRef.current;
    if (!adb) return null;

    try {
      const cmd = [
        'sh', '-c',
        `APK=$(pm path ${pkg} 2>/dev/null | head -1 | sed 's/^package://'); ` +
        `if [ -z "$APK" ] || [ ! -f "$APK" ]; then exit 1; fi; ` +
        `ICON_PATH=$(dumpsys package ${pkg} 2>/dev/null | grep -m1 "android:icon=" | sed 's/.*android:icon=//' | tr -d "'" | xargs); ` +
        `if [ -z "$ICON_PATH" ]; then ` +
          `ICON_PATH=$(unzip -l "$APK" 2>/dev/null | grep -oE 'mipmap[^ ]*/(ic_launcher|ic_launcher_round|ic_launcher_foreground)[^ ]*\\.png' | head -1); ` +
        `fi; ` +
        `if [ -z "$ICON_PATH" ] && command -v aapt >/dev/null 2>&1; then ` +
          `ICON_PATH=$(aapt dump badging "$APK" 2>/dev/null | grep "application-icon:" | head -1 | sed "s/.*:'\\(.*\\)'/\\1/"); ` +
        `fi; ` +
        `if [ -n "$ICON_PATH" ]; then ` +
          `unzip -p "$APK" "$ICON_PATH" 2>/dev/null | base64 -w0; ` +
        `fi`
      ];

      const output = await adb.subprocess.noneProtocol.spawnWaitText(cmd);
      const trimmed = output.trim();
      if (!trimmed || trimmed.includes('error') || trimmed.includes('Archive') || trimmed.includes('Bad zip') || trimmed.length < 100) {
        iconCacheRef.current.set(pkg, null);
        return null;
      }

      const dataUrl = `data:image/png;base64,${trimmed.replace(/\n/g, '')}`;
      iconCacheRef.current.set(pkg, dataUrl);
      return dataUrl;
    } catch (error) {
      console.error('获取应用图标错误:', error);
      iconCacheRef.current.set(pkg, null);
      return null;
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

  const togglePhysicalScreen = useCallback(async () => {
    const adb = adbRef.current;
    if (!adb) return;

    try {
      // 发送电源键事件（KEYCODE_POWER = 26）
      await adb.subprocess.noneProtocol.spawnWaitText(['input', 'keyevent', '26']);
    } catch (error) {
      console.error('切换物理屏幕状态错误:', error);
    }
  }, []);

  const turnOffPhysicalScreen = useCallback(async () => {
    const adb = adbRef.current;
    if (!adb) return;

    try {
      // 检查屏幕是否已开启
      let isScreenOn = false;
      try {
        const output = await adb.subprocess.noneProtocol.spawnWaitText(['sh', '-c', 'dumpsys power | grep mWakefulness']);
        isScreenOn = output.includes('Awake');
      } catch {
        isScreenOn = true;
      }

      if (isScreenOn) {
        // 发送电源键关闭屏幕
        await adb.subprocess.noneProtocol.spawnWaitText(['input', 'keyevent', '26']);
      }
    } catch (error) {
      console.error('关闭物理屏幕错误:', error);
    }
  }, []);

  const turnOnPhysicalScreen = useCallback(async () => {
    const adb = adbRef.current;
    if (!adb) return;

    try {
      // 检查屏幕是否已关闭
      let isScreenOff = false;
      try {
        const output = await adb.subprocess.noneProtocol.spawnWaitText(['sh', '-c', 'dumpsys power | grep mWakefulness']);
        isScreenOff = output.includes('Asleep');
      } catch {
        isScreenOff = true;
      }

      if (isScreenOff) {
        // 发送电源键唤醒屏幕
        await adb.subprocess.noneProtocol.spawnWaitText(['input', 'keyevent', '26']);
      }
    } catch (error) {
      console.error('唤醒物理屏幕错误:', error);
    }
  }, []);

  return {
    ...state,
    startScrcpy,
    stopScrcpy,
    injectTouch,
    injectText,
    showKeyboard,
    hideKeyboard,
    startApp,
    pressKey,
    goHome,
    goBack,
    showRecentApps,
    getAppList,
    getAppIcon,
    getAppLabel,
    togglePhysicalScreen,
    turnOffPhysicalScreen,
    turnOnPhysicalScreen,
  };
}
