import { useCallback, useRef, useState } from 'react';
import type { AdbScrcpyClient, AdbScrcpyOptionsLatest } from '@yume-chan/adb-scrcpy';
import { AdbScrcpyExitedError } from '@yume-chan/adb-scrcpy';
import type { ScrcpyControlMessageWriter } from '@yume-chan/scrcpy';
import { ScrcpyNewDisplay, ScrcpyCaptureOrientation } from '@yume-chan/scrcpy';
import type { Adb } from '@yume-chan/adb';
import { useVideoDecoder } from './useVideoDecoder';
import { useAudioDecoder } from './useAudioDecoder';
import { useInputInjector } from './useInputInjector';
import { useAppManager } from './useAppManager';
import {
  getRotationState,
  setRotationLocked,
  restoreRotation,
  getDefaultIme,
  setIme,
  hideIme,
  turnOffScreen,
  turnOnScreen,
  resizeDisplay as adbResizeDisplay,
  getCurrentForegroundApp,
  getVirtualDisplayId,
  startAppOnDisplay,
  getDefaultHomePackage,
  forceStopPackage,
} from '@/lib/adb-commands';
import type { RotationState } from '@/lib/adb-commands';

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
}

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { key: 'original', label: '原画', scale: 1.0 },
  { key: 'ultra',   label: '超清', scale: 0.75 },
  { key: 'hd',      label: '高清', scale: 0.5 },
  { key: 'smooth',  label: '流畅', scale: 0.25 },
];

export interface ScrcpyState {
  isStarting: boolean;
  isRunning: boolean;
  error: string | null;
  videoWidth: number;
  videoHeight: number;
  isVirtualDisplay: boolean;
  fallbackToMirror: boolean;
}

export function useScrcpySession() {
  const [state, setState] = useState<ScrcpyState>({
    isStarting: false,
    isRunning: false,
    error: null,
    videoWidth: 0,
    videoHeight: 0,
    isVirtualDisplay: false,
    fallbackToMirror: false,
  });

  const clientRef = useRef<AdbScrcpyClient<AdbScrcpyOptionsLatest<true>> | null>(null);
  const controllerRef = useRef<ScrcpyControlMessageWriter | null>(null);
  const adbRef = useRef<Adb | null>(null);
  const rotationStateRef = useRef<RotationState | null>(null);
  const displayIdRef = useRef<number | null>(null);

  const videoDecoder = useVideoDecoder();
  const audioDecoder = useAudioDecoder();
  const inputInjector = useInputInjector(controllerRef);
  const appManager = useAppManager();

  const startScrcpy = useCallback(async (adb: Adb, canvas: HTMLCanvasElement, displayConfig?: DisplayConfig, isRetry?: boolean) => {
    try {
      displayIdRef.current = null;
      setState(prev => ({ ...prev, isStarting: true, error: null, videoWidth: 0, videoHeight: 0 }));

      const { AdbScrcpyClient, AdbScrcpyOptionsLatest } = await import('@yume-chan/adb-scrcpy');
      const { ReadableStream } = await import('@yume-chan/stream-extra');

      const serverPath = '/data/local/tmp/scrcpy-server.jar';
      try {
        const response = await fetch(import.meta.env.BASE_URL + 'scrcpy-server.jar');
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          if (arrayBuffer.byteLength > 0) {
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
          }
        }
      } catch (pushError) {
        console.warn('推送 scrcpy-server.jar 失败，尝试使用设备上已有的文件:', pushError);
      }

      const useVirtualDisplay = !!displayConfig;
      const options = new AdbScrcpyOptionsLatest({
        video: true,
        videoCodec: 'h264',
        videoBitRate: displayConfig?.bitRate ?? 8000000,
        maxFps: 60,
        audio: false,
        control: true,
        stayAwake: true,
        showTouches: false,
        ...(useVirtualDisplay
          ? {
              newDisplay: new ScrcpyNewDisplay(displayConfig.width, displayConfig.height, displayConfig.dpi ?? 320),
              captureOrientation: ScrcpyCaptureOrientation.Unlocked,
              displayImePolicy: 'local' as const,
            }
          : { displayId: 0 }
        ),
      });
      const client = await AdbScrcpyClient.start(adb, serverPath, options);
      clientRef.current = client;
      adbRef.current = adb;
      appManager.setAdb(adb);

      if (useVirtualDisplay) {
        try {
          const prevRotation = await getRotationState(adb);
          rotationStateRef.current = prevRotation;
          await setRotationLocked(adb);
        } catch (e) {
          console.warn('锁定旋转方向失败:', e);
        }
      }

      const controller = client.controller;
      if (controller) {
        controllerRef.current = controller;
      }

      const { width, height } = await videoDecoder.setupVideoStream(client, canvas, (w, h) => {
        setState(prev => ({ ...prev, videoWidth: w, videoHeight: h }));
      });

      audioDecoder.setupAudioStream(client);

      if (useVirtualDisplay) {
        const vid = await getVirtualDisplayId(adb);
        displayIdRef.current = vid;

        try {
          const homePkg = await getDefaultHomePackage(adb);
          if (homePkg) await forceStopPackage(adb, homePkg);
        } catch (e) {
          console.warn('关闭虚拟屏 Launcher 失败:', e);
        }
      } else {
        displayIdRef.current = 0;
      }

      setState(prev => ({
        ...prev,
        isStarting: false,
        isRunning: true,
        videoWidth: width,
        videoHeight: height,
        isVirtualDisplay: useVirtualDisplay,
      }));

      // 后台自动同步应用列表
      appManager.syncWithDevice().then(async (syncResult) => {
        if (syncResult.toParse.length > 0) {
          console.log(`[ScrcpySession] 需要解析 ${syncResult.toParse.length} 个应用`);
          // 执行完整 dex 解析
          await appManager.parseAllApps();
        } else {
          console.log('[ScrcpySession] 缓存完全命中，跳过 dex 解析');
        }
      }).catch((err) => {
        console.warn('[ScrcpySession] 后台同步应用列表失败:', err);
      });
    } catch (error) {
      if (!isRetry && displayConfig && error instanceof AdbScrcpyExitedError) {
        console.warn('虚拟屏创建失败，回退到镜像模式');
        // 设置 fallbackToMirror 标志，让 VirtualScreen 知道发生了回退
        // 递归调用 startScrcpy 时，...prev 会保留 fallbackToMirror: true
        setState(prev => ({ ...prev, isStarting: true, error: null, fallbackToMirror: true }));
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
      setState(prev => ({ ...prev, isStarting: false, error: message }));
      console.error('Scrcpy 启动错误:', error);
    }
  }, [videoDecoder, audioDecoder, appManager]);

  const stopScrcpy = useCallback(async () => {
    try {
      const adb = adbRef.current;
      if (adb && rotationStateRef.current) {
        try {
          await restoreRotation(adb, rotationStateRef.current);
        } catch (e) {
          console.warn('恢复旋转方向失败:', e);
        }
        rotationStateRef.current = null;
      }

      videoDecoder.dispose();
      audioDecoder.dispose();

      if (controllerRef.current) {
        controllerRef.current.close();
        controllerRef.current = null;
      }

      if (clientRef.current) {
        await clientRef.current.close();
        clientRef.current = null;
      }

      displayIdRef.current = null;

      // 立即更新状态，不等待虚拟屏销毁
      setState({
        isStarting: false,
        isRunning: false,
        error: null,
        videoWidth: 0,
        videoHeight: 0,
        isVirtualDisplay: false,
        fallbackToMirror: false,
      });
    } catch (error) {
      console.error('停止 Scrcpy 错误:', error);
    }
  }, [videoDecoder, audioDecoder]);

  const showKeyboard = useCallback(async () => {
    const adb = adbRef.current;
    if (!adb) return;

    try {
      const ime = await getDefaultIme(adb);
      if (ime) {
        await setIme(adb, ime);
      }
      await inputInjector.goHome();
    } catch (error) {
      console.error('显示键盘错误:', error);
    }
  }, [inputInjector]);

  const hideKeyboard = useCallback(async () => {
    const adb = adbRef.current;
    if (!adb) return;

    try {
      await hideIme(adb);
    } catch (error) {
      console.error('隐藏键盘错误:', error);
    }
  }, []);

  const togglePhysicalScreen = useCallback(async () => {
    const adb = adbRef.current;
    if (!adb) return;

    try {
      const { toggleScreen } = await import('@/lib/adb-commands');
      await toggleScreen(adb);
    } catch (error) {
      console.error('切换物理屏幕状态错误:', error);
    }
  }, []);

  const turnOffPhysicalScreen = useCallback(async () => {
    const adb = adbRef.current;
    if (!adb) return;

    try {
      await turnOffScreen(adb);
    } catch (error) {
      console.error('关闭物理屏幕错误:', error);
    }
  }, []);

  const turnOnPhysicalScreen = useCallback(async () => {
    const adb = adbRef.current;
    if (!adb) return;

    try {
      await turnOnScreen(adb);
    } catch (error) {
      console.error('唤醒物理屏幕错误:', error);
    }
  }, []);

  const resizeDisplay = useCallback(async (width: number, height: number, dpi: number) => {
    const adb = adbRef.current;
    if (!adb) return;

    try {
      await adbResizeDisplay(adb, 0, width, height, dpi);
      controllerRef.current?.resetVideo();
    } catch (error) {
      console.error('调整虚拟屏尺寸错误:', error);
    }
  }, []);

  const ensureDisplayId = useCallback(async (): Promise<number | null> => {
    if (displayIdRef.current !== null) return displayIdRef.current;
    const adb = adbRef.current;
    if (!adb) return null;

    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 500));
      const vid = await getVirtualDisplayId(adb);
      if (vid !== null) {
        displayIdRef.current = vid;
        return vid;
      }
    }
    return null;
  }, []);

  const getForegroundApp = useCallback(async (): Promise<string | null> => {
    const adb = adbRef.current;
    if (!adb) return null;
    const displayId = await ensureDisplayId();
    return getCurrentForegroundApp(adb, displayId ?? 0);
  }, [ensureDisplayId]);

  const startAppOnDisplayFn = useCallback(async (packageName: string) => {
    const adb = adbRef.current;
    if (!adb) return;
    const displayId = await ensureDisplayId();
    if (displayId !== null) {
      await startAppOnDisplay(adb, packageName, displayId);
    }
  }, [ensureDisplayId]);

  const clearFallback = useCallback(() => {
    setState(prev => ({ ...prev, fallbackToMirror: false }));
  }, []);

  return {
    ...state,
    startScrcpy,
    stopScrcpy,
    clearFallback,
    injectTouch: inputInjector.injectTouch,
    injectText: inputInjector.injectText,
    showKeyboard,
    hideKeyboard,
    startApp: inputInjector.startApp,
    goHome: inputInjector.goHome,
    goBack: inputInjector.goBack,
    showRecentApps: inputInjector.showRecentApps,
    getAppList: appManager.getAppList,
    getAppIcon: appManager.getAppIcon,
    getAppLabel: appManager.getAppLabel,
    batchGetAppLabels: appManager.batchGetAppLabels,
    parseAllApps: appManager.parseAllApps,
    abortParseApps: appManager.abortParseApps,
    getCachedAppLabels: appManager.getCachedAppLabels,
    getAllCachedPackages: appManager.getAllCachedPackages,
    clearAppInfoCache: appManager.clearAppInfoCache,
    getCacheInfo: appManager.getCacheInfo,
    togglePhysicalScreen,
    turnOffPhysicalScreen,
    turnOnPhysicalScreen,
    resizeDisplay,
    getForegroundApp,
    startAppOnDisplay: startAppOnDisplayFn,
    resumeAudio: audioDecoder.resume,
    getAllDeviceApps: appManager.getAllDeviceApps,
    incrementLocalCount: appManager.incrementLocalCount,
    togglePin: appManager.togglePin,
    getPinnedApps: appManager.getPinnedApps,
    clearDeviceApps: appManager.clearDeviceApps,
    clearAll: appManager.clearAll,
    syncWithDevice: appManager.syncWithDevice,
  };
}
